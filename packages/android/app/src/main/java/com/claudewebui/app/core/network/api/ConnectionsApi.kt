package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/connections` — saved SSH hosts and the ones attached to a session. */
interface ConnectionsApi {
    /** GET /api/connections */
    suspend fun listConnections(): ApiResponse<List<SshConnection>>

    /** GET /api/connections/ssh-keys — file names only, never key content. */
    suspend fun listSshKeyFiles(): ApiResponse<SshKeyFiles>

    /** POST /api/connections */
    suspend fun createConnection(input: SshConnectionInput): ApiResponse<SshConnection>

    /** PATCH /api/connections/:id */
    suspend fun updateConnection(id: String, input: SshConnectionInput): ApiResponse<SshConnection>

    /** DELETE /api/connections/:id */
    suspend fun deleteConnection(id: String): ApiResponse<JsonElement>

    /** POST /api/connections/:id/test */
    suspend fun testConnection(id: String): ApiResponse<SshConnectionTestResult>

    /** GET /api/sessions/:sessionId/connections */
    suspend fun getSessionConnections(sessionId: String): ApiResponse<SessionConnections>

    /** PUT /api/sessions/:sessionId/connections — replaces the attached set. */
    suspend fun setSessionConnections(sessionId: String, connectionIds: List<String>): ApiResponse<SessionConnections>
}

class ConnectionsApiImpl(private val http: ApiHttp) : ConnectionsApi {

    override suspend fun listConnections(): ApiResponse<List<SshConnection>> =
        http.get("/api/connections")

    override suspend fun listSshKeyFiles(): ApiResponse<SshKeyFiles> =
        http.get("/api/connections/ssh-keys")

    override suspend fun createConnection(input: SshConnectionInput): ApiResponse<SshConnection> =
        http.post("/api/connections") { setBody(input) }

    override suspend fun updateConnection(id: String, input: SshConnectionInput): ApiResponse<SshConnection> =
        http.patch("/api/connections/${http.pathSegment(id)}") { setBody(input) }

    override suspend fun deleteConnection(id: String): ApiResponse<JsonElement> =
        http.delete("/api/connections/${http.pathSegment(id)}")

    override suspend fun testConnection(id: String): ApiResponse<SshConnectionTestResult> =
        http.post("/api/connections/${http.pathSegment(id)}/test") { setBody(emptyMap<String, String>()) }

    override suspend fun getSessionConnections(sessionId: String): ApiResponse<SessionConnections> =
        http.get("/api/sessions/${http.pathSegment(sessionId)}/connections")

    override suspend fun setSessionConnections(
        sessionId: String,
        connectionIds: List<String>,
    ): ApiResponse<SessionConnections> =
        http.put("/api/sessions/${http.pathSegment(sessionId)}/connections") {
            setBody(SetSessionConnectionsInput(connectionIds))
        }
}
