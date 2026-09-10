package com.claudewebui.app.data.repository

import android.database.sqlite.SQLiteConstraintException

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import androidx.room.withTransaction
import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.local.AppDatabase
import com.claudewebui.app.data.local.dao.DraftDao
import com.claudewebui.app.data.local.dao.MessageDao
import com.claudewebui.app.data.local.dao.OutboxDao
import com.claudewebui.app.data.local.dao.SessionReadStateDao
import com.claudewebui.app.data.local.entity.DraftEntity
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.local.entity.toEntity
import com.claudewebui.app.data.local.entity.toModel
import com.claudewebui.app.data.model.Message
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

data class MessageHistoryPage(
    val messages: List<Message>,
    val total: Int,
    val hasMore: Boolean,
    val hasMoreBefore: Boolean,
    val hasMoreAfter: Boolean,
    val oldestId: String?,
    val newestId: String?,
    val aroundId: String? = null,
    val anchorIndex: Int? = null,
    val chatId: String? = null,
    val snapshot: com.claudewebui.app.data.model.MessageHistorySnapshot? = null,
    val readState: com.claudewebui.app.data.model.SessionReadState? = null,
    /** True only after an accepted full latest snapshot atomically reset a legacy cursor. */
    val replayCursorReset: Boolean = false,
)

/**
 * Single source of truth for chat [Message] data.
 *
 * Messages are fetched from the network and persisted to Room.
 * Real-time streaming is handled by [SocketManager] and piped
 * directly to [MessageDao] — see [ChatViewModel] for the wiring.
 */
class MessageRepository(
    private val api: ApiClient,
    private val dao: MessageDao,
    private val draftDao: DraftDao,
    private val outboxDao: OutboxDao,
    private val readStateDao: SessionReadStateDao,
    private val database: AppDatabase,
) {

    // ---- Observable streams ------------------------------------------------

    /**
     * Observe all cached messages for a session in chronological order.
     * Backed by Room — updates automatically when new messages arrive.
     */
    fun getMessages(sessionId: String, chatId: String?, limit: Int): Flow<List<Message>> =
        dao.getByChat(sessionId, chatId, limit).map { list -> list.map { it.toModel() } }

    /** Paging keeps a bounded set of cached rows resident even in long sessions. */
    fun pagedMessages(sessionId: String, chatId: String?): Flow<PagingData<Message>> =
        Pager(
            config = PagingConfig(
                pageSize = 50,
                initialLoadSize = 150,
                prefetchDistance = 20,
                maxSize = 600,
                enablePlaceholders = false,
            ),
            pagingSourceFactory = { dao.pageByChat(sessionId, chatId) },
        ).flow.map { page -> page.map { it.toModel() } }

    fun getOutbox(sessionId: String): Flow<List<OutboxEntity>> =
        outboxDao.observeForSession(sessionId)

    fun getReadState(sessionId: String): Flow<SessionReadStateEntity?> =
        readStateDao.observe(sessionId)

    // ---- Network + cache ---------------------------------------------------

    /**
     * Fetch full message history from the network and store in Room.
     * @param sessionId the session whose history to load.
     * @param clearExisting when true, clears stale cache before inserting.
     */
    suspend fun fetchMessages(
        sessionId: String,
        clearExisting: Boolean = false,
        limit: Int = 200,
        before: String? = null,
        after: String? = null,
        around: String? = null,
        chatId: String? = null,
        useServerActiveChat: Boolean = false,
        resetReplayCursor: Boolean = false,
        acceptResponse: () -> Boolean = { true },
    ): Result<MessageHistoryPage> {
        return apiCall {
            require(listOf(before, after, around).count { it != null } <= 1) {
                "before, after and around are mutually exclusive"
            }
            val response = api.getMessages(
                sessionId,
                limit = limit,
                before = before,
                after = after,
                around = around,
                // Omitted means server-active; empty explicitly targets the NULL main thread.
                chatId = if (useServerActiveChat) null else chatId.orEmpty(),
            )
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to fetch messages")
            }
            val resolvedChatId = if (response.snapshot != null) response.snapshot.chatId else chatId
            if (!useServerActiveChat && response.snapshot != null && resolvedChatId != chatId) {
                error("Message snapshot belongs to another chat")
            }
            val messages = response.data.map { message ->
                require(message.sessionId == sessionId) { "Message belongs to another session" }
                if (message.chatId != null && message.chatId != resolvedChatId) {
                    error("Message belongs to another chat")
                }
                message.copy(chatId = message.chatId ?: resolvedChatId)
            }

            var replayCursorReset = false
            database.withTransaction {
                if (!acceptResponse()) throw SupersededHistoryResponse()
                val current = readStateDao.get(sessionId) ?: SessionReadStateEntity(sessionId)
                val snapshot = response.snapshot
                val staleSnapshot = snapshot != null &&
                    current.chatId == resolvedChatId &&
                    snapshot.revision < current.snapshotRevision

                if (clearExisting) {
                    val cached = dao.getByChatOnce(sessionId, resolvedChatId).map { it.toModel() }
                    val preserved = if (staleSnapshot) {
                        cached
                    } else {
                        cached.filter { message ->
                            val sequence = message.eventSequence
                            sequence != null && sequence > (snapshot?.highWatermark ?: Long.MAX_VALUE)
                        }
                    }
                    val merged = mergeMessagesByIdentity(messages + preserved)
                    dao.deleteByChat(sessionId, resolvedChatId)
                    if (merged.isNotEmpty()) dao.insertAll(merged.map { it.toEntity() })
                } else {
                    messages.forEach { upsertDeduplicatedLocked(it) }
                }

                response.readState?.takeUnless { staleSnapshot }?.let { server ->
                    if (server.chatId != null && server.chatId != resolvedChatId) {
                        error("Read state belongs to another chat")
                    }
                    writeReadState(server.toEntity(readStateDao.get(sessionId)))
                }
                snapshot?.takeUnless { staleSnapshot }?.let {
                    val latest = readStateDao.get(sessionId) ?: current
                    writeReadState(
                        latest.copy(
                            chatId = it.chatId,
                            highWatermark = maxOf(latest.highWatermark, it.highWatermark),
                            snapshotRevision = maxOf(latest.snapshotRevision, it.revision),
                        )
                    )
                }
                // Protocol v1 could persist an issued cursor ahead of a missing
                // durable event. Only a full, accepted latest snapshot can repair
                // it; around/older pages do not prove a complete live tail.
                if (resetReplayCursor && clearExisting && before == null && after == null &&
                    around == null && snapshot != null && !response.pagination.hasMoreAfter) {
                    val latest = readStateDao.get(sessionId) ?: current
                    readStateDao.upsert(latest.copy(
                        lastSeenSequence = snapshot.highWatermark,
                        highWatermark = snapshot.highWatermark,
                        snapshotRevision = snapshot.revision,
                    ))
                    replayCursorReset = true
                }
                // DAO calls suspend. If a newer navigation wins while they run,
                // rolling back here preserves both messages and the read cursor.
                if (!acceptResponse()) throw SupersededHistoryResponse()
            }
            MessageHistoryPage(
                messages = messages,
                total = response.pagination.total,
                hasMore = response.pagination.hasMoreBefore,
                hasMoreBefore = response.pagination.hasMoreBefore,
                hasMoreAfter = response.pagination.hasMoreAfter,
                oldestId = response.pagination.oldestId,
                newestId = response.pagination.newestId,
                aroundId = response.pagination.aroundId,
                anchorIndex = response.pagination.anchorIndex,
                chatId = resolvedChatId,
                snapshot = response.snapshot,
                readState = response.readState,
                replayCursorReset = replayCursorReset,
            )
        }
    }

    suspend fun fetchAroundMessage(
        sessionId: String,
        messageId: String,
        chatId: String?,
        acceptResponse: () -> Boolean = { true },
    ): Result<MessageHistoryPage> =
        fetchMessages(
            sessionId,
            clearExisting = true,
            limit = 80,
            around = messageId,
            chatId = chatId,
            acceptResponse = acceptResponse,
        )

    suspend fun fetchAfterMessage(
        sessionId: String,
        messageId: String,
        chatId: String?,
    ): Result<MessageHistoryPage> =
        fetchMessages(sessionId, limit = 200, after = messageId, chatId = chatId)

    suspend fun fetchLatestMessages(
        sessionId: String,
        chatId: String?,
        acceptResponse: () -> Boolean = { true },
    ): Result<MessageHistoryPage> = fetchMessages(
        sessionId, clearExisting = true, limit = 200, chatId = chatId,
        acceptResponse = acceptResponse,
    )

    /**
     * Return the N most recent cached messages without subscribing to updates.
     * Used for quick context summaries.
     */
    suspend fun getCachedMessages(
        sessionId: String,
        chatId: String?,
        limit: Int = 20,
    ): List<Message> = dao.getLatest(sessionId, chatId, limit).map { it.toModel() }

    /**
     * Persist a single message to the local cache (used when a streaming
     * message is completed and delivered via Socket.IO).
     */
    suspend fun cacheMessage(message: Message, chatId: String?) {
        val contextual = contextualizeMessage(message, chatId)
        database.withTransaction { upsertDeduplicatedLocked(contextual) }
    }

    /**
     * Persist a batch of messages (e.g. after a full history sync).
     */
    suspend fun cacheMessages(messages: List<Message>, chatId: String?) {
        database.withTransaction {
            messages.forEach { upsertDeduplicatedLocked(contextualizeMessage(it, chatId)) }
        }
    }

    /** Remove all cached messages for a session. */
    suspend fun clearMessages(sessionId: String) {
        dao.deleteBySessionId(sessionId)
    }

    suspend fun clearMessages(sessionId: String, chatId: String?) {
        dao.deleteByChat(sessionId, chatId)
    }

    private fun contextualizeMessage(message: Message, expectedChatId: String?): Message {
        require(message.sessionId.isNotBlank()) { "Message has no session" }
        if (message.chatId != null && message.chatId != expectedChatId) {
            error("Message belongs to another chat")
        }
        return message.copy(chatId = message.chatId ?: expectedChatId)
    }

    private suspend fun upsertDeduplicatedLocked(message: Message) {
        val matches = dao.findIdentityMatches(
            sessionId = message.sessionId,
            chatId = message.chatId,
            id = message.id,
            clientMessageId = message.clientMessageId,
            eventSequence = message.eventSequence,
        ).map { it.toModel() }
        // Usually one winner. When the merge keeps more than one — two cached
        // rows that each match the incoming message on a different identity key
        // (a restore, or clientMessageId and eventSequence pointing at different
        // rows) — write all of them. Collapsing to `message` and deleting every
        // match dropped one of the two rows outright.
        val winners = mergeMessagesByIdentity(matches + message).ifEmpty { listOf(message) }
        val survivingIds = winners.mapTo(mutableSetOf()) { it.id }
        val superseded = matches.map { it.id }.filterNot { it in survivingIds }
        if (superseded.isNotEmpty()) dao.deleteByIds(superseded)
        winners.forEach { dao.insert(it.toEntity()) }
    }

    // ---- Drafts ------------------------------------------------------------

    /** Load the current draft for a session, or null if none. */
    suspend fun getDraft(sessionId: String, chatId: String?): String? =
        draftDao.getBySessionId(sessionId, chatId.orEmpty())?.content

    /** Save or update the draft for a session. */
    suspend fun saveDraft(sessionId: String, content: String, chatId: String?) {
        draftDao.upsert(DraftEntity(sessionId = sessionId, content = content, chatId = chatId.orEmpty()))
    }

    /** Delete the draft for a session (called after a message is sent). */
    suspend fun clearDraft(sessionId: String, chatId: String?) {
        draftDao.delete(sessionId, chatId.orEmpty())
    }

    // ---- Durable outbox ----------------------------------------------------

    fun observePendingOutbox(): Flow<List<OutboxEntity>> = outboxDao.observePending()

    suspend fun discardFailedOutbox(clientMessageId: String) = outboxDao.discardFailed(clientMessageId)

    suspend fun putOutbox(item: OutboxEntity) = outboxDao.upsert(item)

    suspend fun retargetFailedOutbox(clientMessageId: String, chatId: String?): OutboxEntity? =
        database.withTransaction {
            val old = outboxDao.get(clientMessageId) ?: return@withTransaction null
            if (old.deliveryStatus != com.claudewebui.app.data.local.entity.OutboxStatus.FAILED) return@withTransaction null
            val replacement = old.retarget(chatId, java.util.UUID.randomUUID().toString())
            outboxDao.upsert(replacement)
            outboxDao.delete(clientMessageId)
            replacement
        }

    suspend fun getOutboxItem(clientMessageId: String): OutboxEntity? = outboxDao.get(clientMessageId)

    suspend fun pendingOutbox(sessionId: String): List<OutboxEntity> =
        outboxDao.pendingForSession(sessionId)

    suspend fun removeOutbox(clientMessageId: String) = outboxDao.delete(clientMessageId)

    suspend fun pruneAcceptedOutbox(before: Long) = outboxDao.pruneAccepted(before)

    // ---- Read position -----------------------------------------------------

    /**
     * Read state hangs off a cached session row by foreign key. A chat can be
     * opened before that row exists — a notification deep link into a session
     * the list has not synced yet, or the design preview — and the insert then
     * fails the constraint and takes the whole app down. Bookkeeping is not
     * worth a crash: skip the write and let the next sync store it.
     */
    private suspend fun writeReadState(state: SessionReadStateEntity) {
        try {
            database.withTransaction {
                val current = readStateDao.get(state.sessionId)
                readStateDao.upsert(state.copy(
                    // Scroll/read receipts can finish after a protocol reset.
                    // Only advanceAppliedSequence owns an existing replay cursor.
                    lastSeenSequence = current?.lastSeenSequence ?: state.lastSeenSequence,
                    highWatermark = maxOf(state.highWatermark, current?.highWatermark ?: 0L),
                    snapshotRevision = maxOf(state.snapshotRevision, current?.snapshotRevision ?: 0L),
                ))
            }
        } catch (error: SQLiteConstraintException) {
            android.util.Log.w(
                "MessageRepository",
                "read state for ${state.sessionId} skipped: session not cached yet",
                error,
            )
        }
    }

    suspend fun cachedReadState(sessionId: String): SessionReadStateEntity? = readStateDao.get(sessionId)

    suspend fun saveReadState(state: SessionReadStateEntity) = writeReadState(state)

    /** Commit only a contiguous, applied server prefix, atomically and monotonically. */
    suspend fun advanceAppliedSequence(sessionId: String, sequence: Long?, revision: Long? = null) {
        if (sequence == null && revision == null) return
        database.withTransaction {
            val current = readStateDao.get(sessionId) ?: SessionReadStateEntity(sessionId)
            readStateDao.upsert(current.copy(
                lastSeenSequence = maxOf(current.lastSeenSequence, sequence ?: 0L),
                highWatermark = maxOf(current.highWatermark, sequence ?: 0L),
                snapshotRevision = maxOf(current.snapshotRevision, revision ?: 0L),
            ))
        }
    }

    suspend fun syncReadState(sessionId: String): Result<SessionReadStateEntity> = apiCall {
        val response = api.getSessionReadState(sessionId)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to load read position")
        }
        val value = response.data.toEntity(readStateDao.get(sessionId))
        writeReadState(value)
        value
    }

    suspend fun markRead(
        sessionId: String,
        chatId: String?,
        messageId: String?,
    ): Result<SessionReadStateEntity> = apiCall {
        val response = api.updateSessionReadState(sessionId, chatId, messageId)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to save read position")
        }
        val value = response.data.toEntity(readStateDao.get(sessionId))
        writeReadState(value)
        value
    }
}

/**
 * Coalesces optimistic/live/REST copies of the same durable message. Identity
 * is the server id first, then the stable client id and monotone event cursor.
 */
internal fun mergeMessagesByIdentity(input: List<Message>): List<Message> {
    val records = linkedMapOf<String, Message>()
    val identityToRecord = hashMapOf<String, String>()

    input.forEach { candidate ->
        val candidateIdentities = candidate.identityKeys()
        val collidedRecordIds = candidateIdentities.mapNotNull(identityToRecord::get).toSet()
        val collided = collidedRecordIds.mapNotNull(records::get)
        val winner = (collided + candidate).reduce(::preferredMessage)

        collidedRecordIds.forEach { recordId ->
            records.remove(recordId)?.identityKeys()?.forEach { identity ->
                if (identityToRecord[identity] == recordId) identityToRecord.remove(identity)
            }
        }
        records[winner.id] = winner
        winner.identityKeys().forEach { identity -> identityToRecord[identity] = winner.id }
    }

    return records.values.sortedWith(
        compareBy<Message> { it.createdAt }
            .thenBy { it.eventSequence ?: Long.MAX_VALUE }
            .thenBy { it.id }
    )
}

private fun Message.identityKeys(): List<String> = buildList {
    add("id:$id")
    clientMessageId?.takeIf { it.isNotBlank() }?.let { add("client:$it") }
    eventSequence?.let { add("sequence:$it") }
}

private fun preferredMessage(left: Message, right: Message): Message {
    val leftSequence = left.eventSequence
    val rightSequence = right.eventSequence
    if (leftSequence != null && rightSequence != null && leftSequence != rightSequence) {
        return if (rightSequence > leftSequence) right else left
    }
    fun richness(message: Message): Int =
        (if (message.eventSequence != null) 8 else 0) +
            (if (message.clientMessageId != null) 4 else 0) +
            (if (!message.media.isNullOrEmpty()) 2 else 0) +
            (if (!message.attachments.isNullOrEmpty() || !message.images.isNullOrEmpty()) 1 else 0)
    return if (richness(right) >= richness(left)) right else left
}

/** A rejected replacement is rolled back without cancelling its socket subscription. */
internal class SupersededHistoryResponse : CancellationException("Superseded history response")

internal suspend fun ignoreSupersededHistory(block: suspend () -> Unit) {
    try {
        block()
    } catch (_: SupersededHistoryResponse) {
        // Navigation already started a newer authoritative load.
    }
}
