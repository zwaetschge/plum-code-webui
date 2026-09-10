package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** Tool-approval prompts and OpenCode question prompts. */
interface PermissionsApi {
    /**
     * POST /api/permissions/respond — answer a hooks-based permission request.
     * The socket has no handler for this; REST is the only working path
     * (mirrors the WebUI frontend).
     */
    suspend fun respondToPermission(input: PermissionResponse): PermissionRespondResult

    /** GET /api/permissions/pending/:sessionId — outstanding approval prompts. */
    suspend fun getPendingPermissions(sessionId: String): ApiResponse<List<PendingPermissionItem>>

    /** POST /api/opencode/questions/respond — answer an OpenCode question prompt. */
    suspend fun respondToQuestion(
        requestId: String,
        answers: List<List<String>>,
        providerSessionId: String?,
    ): ApiResponse<Unit>

    /** POST /api/opencode/questions/reject — dismiss an OpenCode question prompt. */
    suspend fun rejectQuestion(requestId: String, providerSessionId: String?): ApiResponse<Unit>
}

class PermissionsApiImpl(private val http: ApiHttp) : PermissionsApi {

    override suspend fun respondToPermission(input: PermissionResponse): PermissionRespondResult =
        http.post("/api/permissions/respond") { setBody(input) }

    override suspend fun getPendingPermissions(sessionId: String): ApiResponse<List<PendingPermissionItem>> =
        http.get("/api/permissions/pending/${http.pathSegment(sessionId)}")

    override suspend fun respondToQuestion(
        requestId: String,
        answers: List<List<String>>,
        providerSessionId: String?,
    ): ApiResponse<Unit> =
        http.post("/api/opencode/questions/respond") {
            setBody(QuestionRespondInput(requestId, answers, providerSessionId))
        }

    override suspend fun rejectQuestion(requestId: String, providerSessionId: String?): ApiResponse<Unit> =
        http.post("/api/opencode/questions/reject") {
            setBody(QuestionRejectInput(requestId, providerSessionId))
        }
}
