package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.http.*
import kotlinx.serialization.json.JsonElement

/**
 * `/api/workspace` — session templates, the notification feed, drafts, turn
 * diffs — plus discovered projects and speech transcription.
 */
interface WorkspaceApi {
    suspend fun getSessionTemplates(): ApiResponse<List<SessionTemplate>>

    suspend fun createSessionTemplate(
        input: CreateSessionTemplateInput,
    ): ApiResponse<SessionTemplate>

    suspend fun deleteSessionTemplate(id: String): ApiResponse<Unit>

    suspend fun getNotifications(limit: Int = 50): ApiResponse<NotificationFeed>

    /** Empty [ids] marks the whole feed read. */
    suspend fun markNotificationsRead(ids: List<String> = emptyList()): ApiResponse<Unit>

    suspend fun clearNotifications(): ApiResponse<Unit>

    /** Fires one sample notification through database, socket and web push. */
    suspend fun sendTestNotification(): ApiResponse<Unit>

    suspend fun getSessionDraft(sessionId: String, chatId: String? = null): ApiResponse<SessionDraft>

    suspend fun putSessionDraft(
        sessionId: String,
        content: String,
        chatId: String? = null,
    ): ApiResponse<Unit>

    suspend fun getTurnDiffs(sessionId: String, limit: Int = 20): ApiResponse<List<TurnDiffSummary>>

    suspend fun getTurnDiff(diffId: String): ApiResponse<TurnDiffDetail>

    /** GET /api/projects */
    suspend fun getDiscoveredProjects(): ApiResponse<List<DiscoveredProject>>

    /** Whether the server has a transcription backend configured. */
    suspend fun transcriptionAvailable(): ApiResponse<JsonElement>

    suspend fun transcribe(audio: ByteArray, fileName: String = "speech.m4a"): ApiResponse<TranscriptionResult>
}

class WorkspaceApiImpl(private val http: ApiHttp) : WorkspaceApi {

    override suspend fun getSessionTemplates(): ApiResponse<List<SessionTemplate>> =
        http.get("/api/workspace/templates")

    override suspend fun createSessionTemplate(
        input: CreateSessionTemplateInput,
    ): ApiResponse<SessionTemplate> =
        http.post("/api/workspace/templates") { setBody(input) }

    override suspend fun deleteSessionTemplate(id: String): ApiResponse<Unit> =
        http.delete("/api/workspace/templates/${http.pathSegment(id)}")

    override suspend fun getNotifications(limit: Int): ApiResponse<NotificationFeed> =
        http.get("/api/workspace/notifications") { parameter("limit", limit) }

    override suspend fun markNotificationsRead(ids: List<String>): ApiResponse<Unit> =
        http.post("/api/workspace/notifications/read") {
            setBody(if (ids.isEmpty()) emptyMap<String, String>() else mapOf("ids" to ids))
        }

    override suspend fun clearNotifications(): ApiResponse<Unit> =
        http.delete("/api/workspace/notifications")

    override suspend fun sendTestNotification(): ApiResponse<Unit> =
        http.post("/api/workspace/notifications/test") { setBody(emptyMap<String, String>()) }

    override suspend fun getSessionDraft(sessionId: String, chatId: String?): ApiResponse<SessionDraft> =
        http.get("/api/workspace/sessions/${http.pathSegment(sessionId)}/draft") {
            parameter("chatId", chatId.orEmpty())
        }

    override suspend fun putSessionDraft(
        sessionId: String,
        content: String,
        chatId: String?,
    ): ApiResponse<Unit> =
        http.put("/api/workspace/sessions/${http.pathSegment(sessionId)}/draft") {
            setBody(mapOf("content" to content, "chatId" to chatId.orEmpty()))
        }

    override suspend fun getTurnDiffs(sessionId: String, limit: Int): ApiResponse<List<TurnDiffSummary>> =
        http.get("/api/workspace/sessions/${http.pathSegment(sessionId)}/turn-diffs") {
            parameter("limit", limit)
        }

    override suspend fun getTurnDiff(diffId: String): ApiResponse<TurnDiffDetail> =
        http.get("/api/workspace/turn-diffs/${http.pathSegment(diffId)}")

    override suspend fun getDiscoveredProjects(): ApiResponse<List<DiscoveredProject>> =
        http.get("/api/projects")

    override suspend fun transcriptionAvailable(): ApiResponse<JsonElement> =
        http.get("/api/transcribe/status")

    override suspend fun transcribe(audio: ByteArray, fileName: String): ApiResponse<TranscriptionResult> =
        http.client.submitFormWithBinaryData(
            url = http.url("/api/transcribe"),
            formData = formData {
                append("audio", audio, Headers.build {
                    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                    append(HttpHeaders.ContentType, "audio/mp4")
                })
            }
        ).body()
}
