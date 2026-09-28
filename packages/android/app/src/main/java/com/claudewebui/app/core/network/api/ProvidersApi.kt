package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** CLI providers, the harness login flow, and OpenCode provider entries. */
interface ProvidersApi {
    /** GET /api/cli-providers */
    suspend fun getCLIProviders(): ApiResponse<List<CLIProviderConfig>>

    // ---- CLI harness login -------------------------------------------------

    /** POST /api/cli-login/:provider/start — spawns the harness's auth command. */
    suspend fun startCliLogin(provider: String): ApiResponse<CliLoginSession>

    /** GET /api/cli-login/:id — poll for the code, URL, or completion. */
    suspend fun getCliLogin(id: String): ApiResponse<CliLoginSession>

    /** POST /api/cli-login/:id/code — answer a prompt that wants a pasted code. */
    suspend fun submitCliLoginCode(id: String, code: String): ApiResponse<CliLoginSession>

    /** DELETE /api/cli-login/:id — abandon the run. */
    suspend fun cancelCliLogin(id: String): ApiResponse<Unit>

    // ---- Mistral Vibe credentials ------------------------------------------
    // Vibe signs in through its ACP agent (the generic flow above) or with a
    // pasted key. The key itself is write-only: the status endpoint reports
    // flags and the key's source, never its value.

    /** GET /api/cli-login/vibe/status */
    suspend fun getVibeAuthStatus(): ApiResponse<VibeAuthStatus>

    /** POST /api/cli-login/vibe/key */
    suspend fun saveVibeApiKey(input: VibeApiKeyInput): ApiResponse<VibeAuthStatus>

    /** DELETE /api/cli-login/vibe/key — sign out by removing the stored key. */
    suspend fun clearVibeApiKey(): ApiResponse<Unit>

    // ---- OpenCode providers ------------------------------------------------

    suspend fun getOpenCodeProviders(): ApiResponse<List<OpenCodeProvider>>

    suspend fun saveOpenCodeProvider(input: SaveOpenCodeProviderInput): ApiResponse<OpenCodeProvider>

    suspend fun deleteOpenCodeProvider(id: String): ApiResponse<Unit>

    suspend fun testOpenCodeProvider(id: String): ApiResponse<OpenCodeProviderTest>
}

class ProvidersApiImpl(private val http: ApiHttp) : ProvidersApi {

    override suspend fun getCLIProviders(): ApiResponse<List<CLIProviderConfig>> =
        http.get("/api/cli-providers")

    override suspend fun startCliLogin(provider: String): ApiResponse<CliLoginSession> =
        http.post("/api/cli-login/$provider/start")

    override suspend fun getCliLogin(id: String): ApiResponse<CliLoginSession> =
        http.get("/api/cli-login/$id")

    override suspend fun submitCliLoginCode(id: String, code: String): ApiResponse<CliLoginSession> =
        http.post("/api/cli-login/$id/code") { setBody(CliLoginCodeInput(code)) }

    override suspend fun cancelCliLogin(id: String): ApiResponse<Unit> =
        http.delete("/api/cli-login/$id")

    override suspend fun getVibeAuthStatus(): ApiResponse<VibeAuthStatus> =
        http.get("/api/cli-login/vibe/status")

    override suspend fun saveVibeApiKey(input: VibeApiKeyInput): ApiResponse<VibeAuthStatus> =
        http.post("/api/cli-login/vibe/key") { setBody(input) }

    override suspend fun clearVibeApiKey(): ApiResponse<Unit> =
        http.delete("/api/cli-login/vibe/key")

    override suspend fun getOpenCodeProviders(): ApiResponse<List<OpenCodeProvider>> =
        http.get("/api/opencode/providers")

    override suspend fun saveOpenCodeProvider(input: SaveOpenCodeProviderInput): ApiResponse<OpenCodeProvider> =
        http.put("/api/opencode/providers") { setBody(input) }

    override suspend fun deleteOpenCodeProvider(id: String): ApiResponse<Unit> =
        http.delete("/api/opencode/providers/${http.pathSegment(id)}")

    override suspend fun testOpenCodeProvider(id: String): ApiResponse<OpenCodeProviderTest> =
        http.post("/api/opencode/providers/${http.pathSegment(id)}/test")
}
