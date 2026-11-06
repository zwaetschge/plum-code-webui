package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** CLI providers, the harness login flow, and the model provider registry. */
interface ProvidersApi {
    /** GET /api/cli-providers */
    suspend fun getCLIProviders(): ApiResponse<List<CLIProviderConfig>>

    /** GET /api/cli-providers/diagnostics — install state and every runnable model. */
    suspend fun getCliProviderDiagnostics(): ApiResponse<List<CliProviderDiagnostic>>

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

    // ---- Model provider registry -------------------------------------------
    // API keys, base URLs and model lists for z-ai, mistral, deepseek,
    // anthropic and custom endpoints; Pi, model chat and voice read them.

    /** GET /api/model-providers/providers */
    suspend fun getModelProviders(): ApiResponse<List<ModelProvider>>

    /** PUT /api/model-providers/providers */
    suspend fun saveModelProvider(input: SaveModelProviderInput): ApiResponse<ModelProvider>

    /** DELETE /api/model-providers/providers/:id */
    suspend fun deleteModelProvider(id: String): ApiResponse<Unit>

    /** POST /api/model-providers/providers/:id/test */
    suspend fun testModelProvider(id: String): ApiResponse<ModelProviderTest>
}

class ProvidersApiImpl(private val http: ApiHttp) : ProvidersApi {

    override suspend fun getCLIProviders(): ApiResponse<List<CLIProviderConfig>> =
        http.get("/api/cli-providers")

    override suspend fun getCliProviderDiagnostics(): ApiResponse<List<CliProviderDiagnostic>> =
        http.get("/api/cli-providers/diagnostics")

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

    override suspend fun getModelProviders(): ApiResponse<List<ModelProvider>> =
        http.get("/api/model-providers/providers")

    override suspend fun saveModelProvider(input: SaveModelProviderInput): ApiResponse<ModelProvider> =
        http.put("/api/model-providers/providers") { setBody(input) }

    override suspend fun deleteModelProvider(id: String): ApiResponse<Unit> =
        http.delete("/api/model-providers/providers/${http.pathSegment(id)}")

    override suspend fun testModelProvider(id: String): ApiResponse<ModelProviderTest> =
        http.post("/api/model-providers/providers/${http.pathSegment(id)}/test")
}
