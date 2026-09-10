package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/memories` — the agent memory files of one working directory. */
interface MemoryApi {
    /** GET /api/memories?workingDirectory=:cwd */
    suspend fun getMemories(workingDirectory: String): ApiResponse<MemoryListing>

    /** GET /api/memories/content?path=:path&workingDirectory=:cwd */
    suspend fun getMemoryContent(path: String, workingDirectory: String): ApiResponse<MemoryContent>

    /** PUT /api/memories/content */
    suspend fun saveMemoryContent(
        path: String,
        content: String,
        workingDirectory: String,
    ): ApiResponse<JsonElement>

    /** POST /api/memories — create a new memory file. */
    suspend fun createMemory(
        name: String,
        content: String,
        workingDirectory: String,
    ): ApiResponse<JsonElement>

    /** DELETE /api/memories?path=:path&workingDirectory=:cwd — params, not a body. */
    suspend fun deleteMemory(path: String, workingDirectory: String): ApiResponse<JsonElement>
}

class MemoryApiImpl(private val http: ApiHttp) : MemoryApi {

    override suspend fun getMemories(workingDirectory: String): ApiResponse<MemoryListing> =
        http.get("/api/memories") { parameter("workingDirectory", workingDirectory) }

    override suspend fun getMemoryContent(path: String, workingDirectory: String): ApiResponse<MemoryContent> =
        http.get("/api/memories/content") {
            parameter("path", path)
            parameter("workingDirectory", workingDirectory)
        }

    override suspend fun saveMemoryContent(
        path: String,
        content: String,
        workingDirectory: String,
    ): ApiResponse<JsonElement> =
        http.put("/api/memories/content") { setBody(SaveMemoryInput(workingDirectory, path, content)) }

    override suspend fun createMemory(
        name: String,
        content: String,
        workingDirectory: String,
    ): ApiResponse<JsonElement> =
        http.post("/api/memories") { setBody(CreateMemoryInput(workingDirectory, name, content)) }

    override suspend fun deleteMemory(path: String, workingDirectory: String): ApiResponse<JsonElement> =
        http.delete("/api/memories") {
            parameter("path", path)
            parameter("workingDirectory", workingDirectory)
        }
}
