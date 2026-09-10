package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** The control gateway: the account-wide overview and its bearer tokens. */
interface GatewayApi {
    /**
     * GET /api/gateway/overview — every session's live state plus all pending
     * approvals in one call. Replaces the per-session permission fan-out.
     */
    suspend fun getGatewayOverview(includeArchived: Boolean = false): ApiResponse<GatewayOverview>

    /** GET /api/gateway/tokens */
    suspend fun getGatewayTokens(): ApiResponse<List<GatewayToken>>

    /** POST /api/gateway/tokens — the only response that carries the secret. */
    suspend fun createGatewayToken(
        name: String,
        scope: String = "write",
    ): ApiResponse<GatewayToken>

    /** DELETE /api/gateway/tokens/:id */
    suspend fun revokeGatewayToken(id: String): ApiResponse<JsonElement>
}

class GatewayApiImpl(private val http: ApiHttp) : GatewayApi {

    override suspend fun getGatewayOverview(includeArchived: Boolean): ApiResponse<GatewayOverview> =
        http.get("/api/gateway/overview") {
            if (includeArchived) parameter("archived", "1")
        }

    override suspend fun getGatewayTokens(): ApiResponse<List<GatewayToken>> =
        http.get("/api/gateway/tokens")

    override suspend fun createGatewayToken(
        name: String,
        scope: String,
    ): ApiResponse<GatewayToken> =
        http.post("/api/gateway/tokens") { setBody(CreateGatewayTokenInput(name, scope)) }

    override suspend fun revokeGatewayToken(id: String): ApiResponse<JsonElement> =
        http.delete("/api/gateway/tokens/$id")
}
