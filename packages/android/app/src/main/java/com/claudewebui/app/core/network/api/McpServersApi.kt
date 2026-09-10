package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/mcp-servers` and `/api/cli-tools` — tool servers available to the harnesses. */
interface McpServersApi {
    /** GET /api/mcp-servers */
    suspend fun getMcpServers(): ApiResponse<List<McpServer>>

    /** POST /api/mcp-servers */
    suspend fun createMcpServer(input: CreateMcpServerInput): ApiResponse<McpServer>

    /** PUT /api/mcp-servers/:id */
    suspend fun updateMcpServer(id: String, input: UpdateMcpServerInput): ApiResponse<McpServer>

    /** DELETE /api/mcp-servers/:id */
    suspend fun deleteMcpServer(id: String): ApiResponse<Unit>

    /**
     * POST /api/mcp-servers/:id/test — actually spawn the subprocess (or open
     * the SSE URL) and report whether it came up. Admin-only.
     */
    suspend fun testMcpServer(id: String): ApiResponse<McpTestResult>

    // ---- CLI tools ---------------------------------------------------------

    /** GET /api/cli-tools */
    suspend fun getCliTools(): ApiResponse<List<JsonElement>>

    /** POST /api/cli-tools */
    suspend fun createCliTool(input: JsonElement): ApiResponse<JsonElement>

    /** PUT /api/cli-tools/:id */
    suspend fun updateCliTool(id: String, input: JsonElement): ApiResponse<JsonElement>

    /** DELETE /api/cli-tools/:id */
    suspend fun deleteCliTool(id: String): ApiResponse<Unit>
}

class McpServersApiImpl(private val http: ApiHttp) : McpServersApi {

    override suspend fun getMcpServers(): ApiResponse<List<McpServer>> =
        http.get("/api/mcp-servers")

    override suspend fun createMcpServer(input: CreateMcpServerInput): ApiResponse<McpServer> =
        http.post("/api/mcp-servers") { setBody(input) }

    override suspend fun updateMcpServer(id: String, input: UpdateMcpServerInput): ApiResponse<McpServer> =
        http.put("/api/mcp-servers/$id") { setBody(input) }

    override suspend fun deleteMcpServer(id: String): ApiResponse<Unit> =
        http.delete("/api/mcp-servers/$id")

    override suspend fun testMcpServer(id: String): ApiResponse<McpTestResult> =
        http.post("/api/mcp-servers/$id/test")

    override suspend fun getCliTools(): ApiResponse<List<JsonElement>> =
        http.get("/api/cli-tools")

    override suspend fun createCliTool(input: JsonElement): ApiResponse<JsonElement> =
        http.post("/api/cli-tools") { setBody(input) }

    override suspend fun updateCliTool(id: String, input: JsonElement): ApiResponse<JsonElement> =
        http.put("/api/cli-tools/$id") { setBody(input) }

    override suspend fun deleteCliTool(id: String): ApiResponse<Unit> =
        http.delete("/api/cli-tools/$id")
}
