package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** `/api/agents` — custom agents stored in the database. */
interface AgentsApi {
    /** GET /api/agents */
    suspend fun getAgents(): ApiResponse<List<CustomAgent>>

    /** GET /api/agents/:id */
    suspend fun getAgent(id: String): ApiResponse<CustomAgent>

    /** POST /api/agents */
    suspend fun createAgent(input: CreateCustomAgentInput): ApiResponse<CustomAgent>

    /** PUT /api/agents/:id */
    suspend fun updateAgent(id: String, input: UpdateCustomAgentInput): ApiResponse<CustomAgent>

    /** DELETE /api/agents/:id */
    suspend fun deleteAgent(id: String): ApiResponse<Unit>
}

class AgentsApiImpl(private val http: ApiHttp) : AgentsApi {

    override suspend fun getAgents(): ApiResponse<List<CustomAgent>> =
        http.get("/api/agents")

    override suspend fun getAgent(id: String): ApiResponse<CustomAgent> =
        http.get("/api/agents/$id")

    override suspend fun createAgent(input: CreateCustomAgentInput): ApiResponse<CustomAgent> =
        http.post("/api/agents") { setBody(input) }

    override suspend fun updateAgent(id: String, input: UpdateCustomAgentInput): ApiResponse<CustomAgent> =
        http.put("/api/agents/$id") { setBody(input) }

    override suspend fun deleteAgent(id: String): ApiResponse<Unit> =
        http.delete("/api/agents/$id")
}
