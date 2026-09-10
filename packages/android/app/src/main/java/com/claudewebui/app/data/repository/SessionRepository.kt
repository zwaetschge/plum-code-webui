package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.local.dao.SessionDao
import com.claudewebui.app.data.local.dao.SessionReadStateDao
import com.claudewebui.app.data.local.entity.toEntity
import com.claudewebui.app.data.local.entity.toModel
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CreateSessionInput
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionResponse
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.StyleKind
import com.claudewebui.app.data.model.SessionChatList
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.SwitchProviderInput
import com.claudewebui.app.data.model.UpdateSessionInput
import com.claudewebui.app.data.model.withFlattenedRuntime
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Single source of truth for [Session] data.
 *
 * Strategy: Room is the primary data source for the UI (via [Flow]).
 * Network calls write their results back to Room, which automatically
 * triggers recomposition in consumers.
 */
class SessionRepository(
    private val api: ApiClient,
    private val dao: SessionDao,
    private val readStateDao: SessionReadStateDao,
) {

    // ---- Observable streams ------------------------------------------------

    /** All sessions, ordered by most recently updated. Backed by Room. */
    val sessions: Flow<List<Session>> = combine(dao.getAll(), readStateDao.observeAll()) { list, reads ->
        val counts = reads.associate { it.sessionId to it.unreadCount }
        list.map { entity ->
            val model = entity.toModel()
            // `session_read_state` owns the badge; the cached session column is
            // only a seed for the moment between a session appearing and its
            // read-state row being written.
            model.copy(unreadCount = counts[entity.id] ?: model.unreadCount)
        }
    }
        // Room invalidates per table, so every read-state write (one per socket
        // event) re-emitted the identical list and re-ran every collector —
        // dashboard filtering, shortcut publishing, the lot.
        .distinctUntilChanged()

    /** Sessions filtered by category. */
    fun getByCategory(categoryId: String): Flow<List<Session>> =
        dao.getByCategory(categoryId).map { list -> list.map { it.toModel() } }

    /** Starred sessions. */
    val starredSessions: Flow<List<Session>> =
        dao.getStarred().map { list -> list.map { it.toModel() } }

    /** Single session observed by ID (emits null while not cached). */
    fun observeSession(id: String): Flow<Session?> =
        dao.getById(id).map { it?.toModel() }

    // ---- Network + cache operations ----------------------------------------

    /**
     * Refresh sessions from the network and persist to Room.
     * @param forceRefresh when true, clears the local cache before inserting.
     */
    suspend fun getSessions(forceRefresh: Boolean = false): Result<List<Session>> {
        return apiCall {
            val response = api.getSessions()
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to fetch sessions")
            }
            val sessions = response.data.map { it.withFlattenedRuntime() }
            // Upsert first, then prune rows absent from the authoritative
            // snapshot. Clearing first would cascade-delete cached messages.
            dao.syncRemote(sessions.map { it.toEntity() })
            // One REST snapshot, then local Room updates only — never an N+1
            // read-state request across a large dashboard.
            readStateDao.syncServerUnreadCounts(sessions.associate { it.id to it.unreadCount })
            sessions
        }
    }

    /**
     * Fetch a single session from the network and update the local cache.
     */
    suspend fun getSession(id: String): Result<Session> {
        return apiCall {
            val response = api.getSession(id)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Session not found")
            }
            val session = response.data.withFlattenedRuntime()
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Network first, Room second. An offline chat must still open — otherwise
     * a send is refused as "still loading" and never reaches the outbox that
     * exists precisely for the offline case.
     */
    suspend fun getSessionOrCached(id: String): Result<Session> {
        val live = getSession(id)
        if (live.isSuccess) return live
        val cached = dao.getByIdOnce(id)?.toModel() ?: return live
        return Result.success(cached)
    }

    /**
     * Create a new session on the server and insert it into the local cache.
     */
    suspend fun createSession(
        name: String,
        workingDirectory: String? = null,
        cliProvider: CLIProvider? = null
    ): Result<Session> {
        return apiCall {
            val response = api.createSession(
                CreateSessionInput(
                    name = name,
                    workingDirectory = workingDirectory,
                    cliProvider = cliProvider
                )
            )
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to create session")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Update a session's name or working directory and refresh the cache.
     */
    suspend fun updateSession(
        id: String,
        name: String? = null,
        workingDirectory: String? = null
    ): Result<Session> {
        return apiCall {
            val response = api.updateSession(id, UpdateSessionInput(name, workingDirectory))
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to update session")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Delete a session from the server and remove it from the local cache.
     */
    suspend fun deleteSession(id: String): Result<Unit> {
        return apiCall {
            val response = api.deleteSession(id)
            if (!response.success) {
                error(response.error?.message ?: "Failed to delete session")
            }
            dao.deleteById(id)
        }
    }

    suspend fun cacheSession(session: Session) {
        dao.insert(session.toEntity())
    }

    /**
     * Apply a live socket lifecycle event to the cached row.
     *
     * Without this the cache only ever learned about a session from a REST
     * refresh, so the dashboard kept showing "running" for a session that had
     * already errored — every screen but the open chat was stale until the next
     * poll. A targeted UPDATE rather than an upsert: the event does not carry a
     * whole session, and an upsert would blank the columns it omits.
     */
    suspend fun cacheStatus(sessionId: String, status: SessionStatus) {
        apiCall { dao.setStatus(sessionId, status.name) }
    }

    /**
     * A turn started or finished.
     *
     * [lastActivityAt] is the device clock, which is only ever read for relative
     * "2 min ago" rendering; the next REST refresh replaces it with the server's.
     */
    suspend fun cacheBusy(sessionId: String, busy: Boolean, lastActivityAt: String? = nowIso()) {
        apiCall { dao.setBusy(sessionId, busy, lastActivityAt) }
    }

    /** What the agent is doing right now, from a tool or subagent event. */
    suspend fun cacheActivity(sessionId: String, summary: String?) {
        apiCall { dao.setActivity(sessionId, summary, nowIso()) }
    }

    /** The turn ended: idle, and nothing left to describe. */
    suspend fun cacheIdle(sessionId: String) {
        apiCall { dao.setIdle(sessionId, nowIso()) }
    }

    /** Queue depth from a queue event, so the badge is right outside the chat too. */
    suspend fun cacheQueue(sessionId: String, depth: Int, busy: Boolean) {
        apiCall { dao.setQueue(sessionId, depth, busy) }
    }

    private fun nowIso(): String =
        java.time.Instant.now().toString()

    /**
     * Star/unstar a session. The route returns only the new flag, so the
     * cached entity is patched in place instead of replaced.
     */
    suspend fun starSession(id: String): Result<Session> {
        return apiCall {
            val response = api.starSession(id)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to star session")
            }
            val cached = dao.getByIdOnce(id)?.copy(starred = response.data.starred)
            if (cached != null) {
                dao.insert(cached)
                cached.toModel()
            } else {
                getSession(id).getOrThrow()
            }
        }
    }

    /**
     * Switch the CLI provider for a session.
     */
    suspend fun switchProvider(id: String, provider: CLIProvider): Result<Session> {
        return apiCall {
            val switchInput = SwitchProviderInput(cliProvider = provider)
            val response = api.switchProvider(id, switchInput)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to switch provider")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /** Set the model this session runs; null restores the provider default. */
    suspend fun setModel(id: String, model: String?): Result<Session> = apiCall {
        val response = api.setSessionModel(id, model)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to set model")
        }
        dao.insert(response.data.toEntity())
        response.data
    }

    /** Set the reasoning level, where the provider supports one. */
    suspend fun setReasoning(id: String, reasoning: String?): Result<Session> = apiCall {
        val response = api.setSessionReasoning(id, reasoning)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to set reasoning")
        }
        dao.insert(response.data.toEntity())
        response.data
    }

    /** Apply or clear one presentation preset for this session. */
    suspend fun setStyleSkill(
        id: String,
        kind: StyleKind,
        skill: String?,
    ): Result<Session> = apiCall {
        val response = when (kind) {
            StyleKind.DESIGN -> api.setSessionStyles(id, designStyleSkill = skill, clearDesign = true)
            StyleKind.WRITING -> api.setSessionStyles(id, writingStyleSkill = skill, clearWriting = true)
        }
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to set style preset")
        }
        dao.insert(response.data.toEntity())
        response.data
    }

    suspend fun getAllowedDirectories(id: String): Result<List<String>> = apiCall {
        val response = api.getAllowedDirectories(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to load allowed directories")
        }
        response.data
    }

    suspend fun addAllowedDirectory(id: String, directory: String): Result<List<String>> = apiCall {
        val response = api.addAllowedDirectory(id, directory)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to allow directory")
        }
        response.data
    }

    suspend fun removeAllowedDirectory(id: String, directory: String): Result<List<String>> = apiCall {
        val response = api.removeAllowedDirectory(id, directory)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to remove directory")
        }
        response.data
    }

    /**
     * Update the category for a session. The route returns only the
     * assignment, so the cached entity is patched in place.
     */
    suspend fun updateCategory(id: String, categoryId: String?): Result<Session> {
        return apiCall {
            val response = api.updateSessionCategory(id, categoryId)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to update category")
            }
            val cached = dao.getByIdOnce(id)?.copy(categoryId = response.data.category)
            if (cached != null) {
                dao.insert(cached)
                cached.toModel()
            } else {
                getSession(id).getOrThrow()
            }
        }
    }

    /** List chat threads of a session. */
    suspend fun getChats(id: String): Result<SessionChatList> = apiCall {
        val response = api.getSessionChats(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to load chats")
        }
        response.data.normalizedChatIdentity()
    }

    /** Start a fresh chat thread; the server activates it and stops the CLI. */
    suspend fun createChat(id: String): Result<SessionChatList> = apiCall {
        val response = api.createSessionChat(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create chat")
        }
        response.data.normalizedChatIdentity()
    }

    /** Switch to another chat thread. */
    suspend fun activateChat(id: String, chatId: String): Result<SessionChatList> = apiCall {
        val response = api.activateSessionChat(id, chatId)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to switch chat")
        }
        response.data.normalizedChatIdentity()
    }

    /** Delete a chat thread with its messages. */
    suspend fun deleteChat(id: String, chatId: String): Result<SessionChatList> = apiCall {
        val response = api.deleteSessionChat(id, chatId)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to delete chat")
        }
        response.data.normalizedChatIdentity()
    }

    /**
     * Answer a hooks-based permission request. The socket has no handler for
     * this event; the REST route is the only path that resumes the CLI turn.
     */
    suspend fun respondToPermission(
        sessionId: String,
        requestId: String,
        action: PermissionAction,
        pattern: String? = null
    ): Result<Unit> = apiCall {
        val result = api.respondToPermission(
            PermissionResponse(sessionId, requestId, action, pattern)
        )
        if (!result.success) error("Permission response rejected")
    }

    /** Answer an OpenCode question prompt so the turn can continue. */
    suspend fun respondToQuestion(
        requestId: String,
        answers: List<List<String>>,
        providerSessionId: String?
    ): Result<Unit> = apiCall {
        val response = api.respondToQuestion(requestId, answers, providerSessionId)
        if (!response.success) {
            error(response.error?.message ?: "Failed to answer question")
        }
    }

    /** Dismiss an OpenCode question prompt. */
    suspend fun rejectQuestion(requestId: String, providerSessionId: String?): Result<Unit> =
        apiCall {
            val response = api.rejectQuestion(requestId, providerSessionId)
            if (!response.success) {
                error(response.error?.message ?: "Failed to dismiss question")
            }
        }
}

/** The synthetic menu entry 'main' represents the database NULL thread. */
internal fun SessionChatList.normalizedChatIdentity(): SessionChatList =
    if (activeChatId == "main") copy(activeChatId = null) else this
