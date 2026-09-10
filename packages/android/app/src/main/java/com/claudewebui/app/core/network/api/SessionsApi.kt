package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import kotlinx.serialization.json.JsonElement

/** `/api/sessions` — the session records, their chat threads and settings. */
interface SessionsApi {
    /** GET /api/sessions */
    suspend fun getSessions(): ApiResponse<List<Session>>

    /** `archived = true` swaps the list over to the archive. */
    suspend fun getSessions(archived: Boolean): ApiResponse<List<Session>>

    /** GET /api/sessions/:id */
    suspend fun getSession(id: String): ApiResponse<Session>

    /** POST /api/sessions */
    suspend fun createSession(input: CreateSessionInput): ApiResponse<Session>

    /** PUT /api/sessions/:id */
    suspend fun updateSession(id: String, input: UpdateSessionInput): ApiResponse<Session>

    /** DELETE /api/sessions/:id */
    suspend fun deleteSession(id: String): ApiResponse<Unit>

    /** Archive, restore, star or delete many sessions in one call. */
    suspend fun bulkSessions(input: BulkSessionInput): ApiResponse<JsonElement>

    /** PATCH /api/sessions/:id/star — returns only the new flag, not a Session. */
    suspend fun starSession(id: String): ApiResponse<StarResult>

    /** PATCH /api/sessions/:id/provider */
    suspend fun switchProvider(id: String, input: SwitchProviderInput): ApiResponse<Session>

    /** PATCH /api/sessions/:id/model — null restores the provider default. */
    suspend fun setSessionModel(id: String, model: String?): ApiResponse<Session>

    /**
     * PATCH /api/sessions/:id/styles — per-session design/writing preset.
     * Sending null clears the preset; omitted keys stay untouched.
     */
    suspend fun setSessionStyles(
        id: String,
        designStyleSkill: String? = null,
        writingStyleSkill: String? = null,
        clearDesign: Boolean = false,
        clearWriting: Boolean = false,
    ): ApiResponse<Session>

    /** PATCH /api/sessions/:id/reasoning */
    suspend fun setSessionReasoning(id: String, reasoning: String?): ApiResponse<Session>

    /** PATCH /api/sessions/:id/category — returns only the assignment, not a Session. */
    suspend fun updateSessionCategory(id: String, categoryId: String?): ApiResponse<CategoryAssignment>

    suspend fun getAllowedDirectories(id: String): ApiResponse<List<String>>

    suspend fun addAllowedDirectory(id: String, directory: String): ApiResponse<List<String>>

    suspend fun removeAllowedDirectory(id: String, directory: String): ApiResponse<List<String>>

    /** GET /api/sessions/:id/chats — chat threads inside one session. */
    suspend fun getSessionChats(id: String): ApiResponse<SessionChatList>

    /** POST /api/sessions/:id/chats — new thread with fresh context, auto-activated. */
    suspend fun createSessionChat(id: String, title: String? = null): ApiResponse<SessionChatList>

    /** POST /api/sessions/:id/chats/:chatId/activate — switch threads. */
    suspend fun activateSessionChat(id: String, chatId: String): ApiResponse<SessionChatList>

    /** DELETE /api/sessions/:id/chats/:chatId — drop a thread and its messages. */
    suspend fun deleteSessionChat(id: String, chatId: String): ApiResponse<SessionChatList>

    suspend fun getSessionReadState(sessionId: String): ApiResponse<SessionReadState>

    suspend fun updateSessionReadState(
        sessionId: String,
        chatId: String?,
        lastReadMessageId: String?,
    ): ApiResponse<SessionReadState>

    /** GET /api/sessions/:id/peers — connected sessions in the mesh. */
    suspend fun getSessionPeers(sessionId: String): ApiResponse<List<SessionPeerLink>>

    /**
     * Whole transcript as Markdown. Returns raw text rather than an ApiResponse
     * envelope — the same endpoint doubles as the WebUI's file download.
     */
    suspend fun exportSessionTranscript(sessionId: String): String
}

class SessionsApiImpl(private val http: ApiHttp) : SessionsApi {

    override suspend fun getSessions(): ApiResponse<List<Session>> =
        http.get("/api/sessions")

    override suspend fun getSessions(archived: Boolean): ApiResponse<List<Session>> =
        http.get("/api/sessions") { if (archived) parameter("archived", "1") }

    override suspend fun getSession(id: String): ApiResponse<Session> =
        http.get("/api/sessions/$id")

    override suspend fun createSession(input: CreateSessionInput): ApiResponse<Session> =
        http.post("/api/sessions") { setBody(input) }

    override suspend fun updateSession(id: String, input: UpdateSessionInput): ApiResponse<Session> =
        http.put("/api/sessions/$id") { setBody(input) }

    override suspend fun deleteSession(id: String): ApiResponse<Unit> =
        http.delete("/api/sessions/$id")

    override suspend fun bulkSessions(input: BulkSessionInput): ApiResponse<JsonElement> =
        http.post("/api/sessions/bulk") { setBody(input) }

    override suspend fun starSession(id: String): ApiResponse<StarResult> =
        http.patch("/api/sessions/$id/star")

    override suspend fun switchProvider(id: String, input: SwitchProviderInput): ApiResponse<Session> =
        http.patch("/api/sessions/$id/provider") { setBody(input) }

    override suspend fun setSessionModel(id: String, model: String?): ApiResponse<Session> =
        http.patch("/api/sessions/$id/model") { setBody(mapOf("model" to model)) }

    override suspend fun setSessionStyles(
        id: String,
        designStyleSkill: String?,
        writingStyleSkill: String?,
        clearDesign: Boolean,
        clearWriting: Boolean,
    ): ApiResponse<Session> =
        http.patch("/api/sessions/$id/styles") {
            setBody(
                buildMap<String, String?> {
                    if (designStyleSkill != null || clearDesign) put("designStyleSkill", designStyleSkill)
                    if (writingStyleSkill != null || clearWriting) put("writingStyleSkill", writingStyleSkill)
                }
            )
        }

    override suspend fun setSessionReasoning(id: String, reasoning: String?): ApiResponse<Session> =
        http.patch("/api/sessions/$id/reasoning") { setBody(mapOf("reasoning" to reasoning)) }

    override suspend fun updateSessionCategory(id: String, categoryId: String?): ApiResponse<CategoryAssignment> =
        http.patch("/api/sessions/$id/category") { setBody(mapOf("categoryId" to categoryId)) }

    override suspend fun getAllowedDirectories(id: String): ApiResponse<List<String>> =
        http.get("/api/sessions/$id/allowed-directories")

    override suspend fun addAllowedDirectory(id: String, directory: String): ApiResponse<List<String>> =
        http.post("/api/sessions/$id/allowed-directories") { setBody(mapOf("directory" to directory)) }

    override suspend fun removeAllowedDirectory(id: String, directory: String): ApiResponse<List<String>> =
        http.delete("/api/sessions/$id/allowed-directories") { parameter("directory", directory) }

    override suspend fun getSessionChats(id: String): ApiResponse<SessionChatList> =
        http.get("/api/sessions/$id/chats")

    override suspend fun createSessionChat(id: String, title: String?): ApiResponse<SessionChatList> =
        http.post("/api/sessions/$id/chats") {
            setBody(if (title != null) mapOf("title" to title) else emptyMap<String, String>())
        }

    override suspend fun activateSessionChat(id: String, chatId: String): ApiResponse<SessionChatList> =
        http.post("/api/sessions/$id/chats/$chatId/activate")

    override suspend fun deleteSessionChat(id: String, chatId: String): ApiResponse<SessionChatList> =
        http.delete("/api/sessions/$id/chats/$chatId")

    override suspend fun getSessionReadState(sessionId: String): ApiResponse<SessionReadState> =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/read-state")

    override suspend fun updateSessionReadState(
        sessionId: String,
        chatId: String?,
        lastReadMessageId: String?,
    ): ApiResponse<SessionReadState> =
        http.put("/api/sessions/${http.pathSegment(sessionId)}/read-state") {
            setBody(
                mapOf(
                    "chatId" to chatId,
                    "lastReadMessageId" to lastReadMessageId,
                )
            )
        }

    override suspend fun getSessionPeers(sessionId: String): ApiResponse<List<SessionPeerLink>> =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/peers")

    override suspend fun exportSessionTranscript(sessionId: String): String =
        http.rawGet("/api/sessions/${http.pathSegment(sessionId)}/export").bodyAsText()
}
