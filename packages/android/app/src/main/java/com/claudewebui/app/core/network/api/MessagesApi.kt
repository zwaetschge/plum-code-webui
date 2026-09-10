package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import io.ktor.http.*

/** Messages, search, resumable chat uploads and durable media of one session. */
interface MessagesApi {
    /**
     * GET /api/sessions/:id/messages. The newest page is returned when
     * [before] is null; subsequent calls page backwards from the oldest id.
     */
    suspend fun getMessages(
        sessionId: String,
        limit: Int = 200,
        before: String? = null,
        after: String? = null,
        around: String? = null,
        chatId: String? = null,
    ): MessagePageResponse<Message>

    /** Full-text search scoped to one session. */
    suspend fun searchSessionMessages(
        sessionId: String,
        query: String,
        limit: Int = 50,
    ): ApiResponse<List<MessageSearchResult>>

    /** Full-text search across all sessions owned by the current user. */
    suspend fun searchMessages(query: String, limit: Int = 50): ApiResponse<List<MessageSearchResult>>

    /** Create a resumable chat upload before sending its id over Socket.IO. */
    suspend fun createChatUpload(
        sessionId: String,
        input: CreateChatUploadInput,
    ): ApiResponse<ChatUpload>

    /** Upload one idempotent binary chunk. Re-sending the same index is safe. */
    suspend fun putChatUploadChunk(
        sessionId: String,
        uploadId: String,
        index: Int,
        bytes: ByteArray,
        byteOffset: Long,
        totalBytes: Long,
    ): ApiResponse<ChatUpload>

    suspend fun getChatUpload(sessionId: String, uploadId: String): ApiResponse<ChatUpload>

    suspend fun cancelChatUpload(sessionId: String, uploadId: String): ApiResponse<ChatUpload>

    /** Authenticated bytes for a durable chat attachment. */
    suspend fun getSessionMedia(sessionId: String, mediaId: String): ByteArray
}

class MessagesApiImpl(private val http: ApiHttp) : MessagesApi {

    override suspend fun getMessages(
        sessionId: String,
        limit: Int,
        before: String?,
        after: String?,
        around: String?,
        chatId: String?,
    ): MessagePageResponse<Message> =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/messages") {
            parameter("limit", limit)
            before?.let { parameter("before", it) }
            after?.let { parameter("after", it) }
            around?.let { parameter("around", it) }
            chatId?.let { parameter("chatId", it) }
        }

    override suspend fun searchSessionMessages(
        sessionId: String,
        query: String,
        limit: Int,
    ): ApiResponse<List<MessageSearchResult>> =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/messages/search") {
            parameter("q", query)
            parameter("limit", limit)
        }

    override suspend fun searchMessages(query: String, limit: Int): ApiResponse<List<MessageSearchResult>> =
        http.get("/api/sessions/messages/search") {
            parameter("q", query)
            parameter("limit", limit)
        }

    override suspend fun createChatUpload(
        sessionId: String,
        input: CreateChatUploadInput,
    ): ApiResponse<ChatUpload> =
        http.post("/api/sessions/${http.pathSegment(sessionId)}/uploads") { setBody(input) }

    override suspend fun putChatUploadChunk(
        sessionId: String,
        uploadId: String,
        index: Int,
        bytes: ByteArray,
        byteOffset: Long,
        totalBytes: Long,
    ): ApiResponse<ChatUpload> =
        http.put(
            "/api/sessions/${http.pathSegment(sessionId)}/uploads/" +
                "${http.pathSegment(uploadId)}/chunks/$index"
        ) {
            contentType(ContentType.Application.OctetStream)
            header("X-Chunk-SHA256", http.sha256Hex(bytes))
            header(
                HttpHeaders.ContentRange,
                "bytes $byteOffset-${byteOffset + bytes.size - 1}/$totalBytes",
            )
            setBody(bytes)
        }

    override suspend fun getChatUpload(sessionId: String, uploadId: String): ApiResponse<ChatUpload> =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/uploads/${http.pathSegment(uploadId)}")

    override suspend fun cancelChatUpload(sessionId: String, uploadId: String): ApiResponse<ChatUpload> =
        http.delete("/api/sessions/${http.pathSegment(sessionId)}/uploads/${http.pathSegment(uploadId)}")

    override suspend fun getSessionMedia(sessionId: String, mediaId: String): ByteArray =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/media/${http.pathSegment(mediaId)}")
}
