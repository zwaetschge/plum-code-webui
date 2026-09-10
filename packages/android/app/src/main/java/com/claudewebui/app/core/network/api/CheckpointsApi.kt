package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/checkpoints` — workspace snapshots per session. */
interface CheckpointsApi {
    /** GET /api/checkpoints/sessions/:sessionId */
    suspend fun getCheckpoints(sessionId: String): ApiResponse<List<Checkpoint>>

    /** POST /api/checkpoints — sessionId travels in the body, not the path. */
    suspend fun createCheckpoint(
        sessionId: String,
        input: CreateCheckpointInput,
    ): ApiResponse<Checkpoint>

    /** POST /api/checkpoints/:checkpointId/restore */
    suspend fun restoreCheckpoint(checkpointId: String): ApiResponse<JsonElement>

    /** DELETE /api/checkpoints/:checkpointId */
    suspend fun deleteCheckpoint(checkpointId: String): ApiResponse<Unit>
}

class CheckpointsApiImpl(private val http: ApiHttp) : CheckpointsApi {

    override suspend fun getCheckpoints(sessionId: String): ApiResponse<List<Checkpoint>> =
        http.get("/api/checkpoints/sessions/$sessionId")

    override suspend fun createCheckpoint(
        sessionId: String,
        input: CreateCheckpointInput,
    ): ApiResponse<Checkpoint> =
        http.post("/api/checkpoints") {
            setBody(mapOf(
                "sessionId" to sessionId,
                "name" to input.name,
                "description" to input.description,
            ))
        }

    override suspend fun restoreCheckpoint(checkpointId: String): ApiResponse<JsonElement> =
        http.post("/api/checkpoints/$checkpointId/restore")

    override suspend fun deleteCheckpoint(checkpointId: String): ApiResponse<Unit> =
        http.delete("/api/checkpoints/$checkpointId")
}
