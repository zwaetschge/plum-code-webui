package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/**
 * `/api/settings` — user settings, the Z.AI endpoint, the subagent layer, and
 * the Basic Auth credential rotation.
 */
interface SettingsApi {
    /** GET /api/settings */
    suspend fun getSettings(): ApiResponse<UserSettings>

    /** PUT /api/settings */
    suspend fun updateSettings(input: UpdateSettingsInput): ApiResponse<UserSettings>

    suspend fun getZaiApi(): ApiResponse<ZaiApiStatus>

    suspend fun updateZaiApi(input: UpdateZaiApiInput): ApiResponse<ZaiApiStatus>

    suspend fun deleteZaiApi(): ApiResponse<Unit>

    // ---- Subagent layer ----------------------------------------------------
    // Upstreams swap the API endpoint under a Claude-transport agent; CLI
    // subagents let any harness spawn a whole other provider CLI as a one-shot
    // worker. Tokens travel up only — the server never sends one back.

    suspend fun getSubagentUpstreams(): ApiResponse<List<SubagentUpstream>>

    /** PUT replaces the whole list; omit authToken to keep the stored one. */
    suspend fun saveSubagentUpstreams(
        input: List<SaveSubagentUpstreamInput>,
    ): ApiResponse<List<SubagentUpstream>>

    /** GET /api/settings/subagent-models — the groups an agent picker offers. */
    suspend fun getSubagentModels(): ApiResponse<List<SubagentModelGroup>>

    suspend fun getCliSubagents(): ApiResponse<List<CliSubagentEntry>>

    suspend fun saveCliSubagents(
        input: List<CliSubagentEntry>,
    ): ApiResponse<List<CliSubagentEntry>>

    /** PUT /api/basic-auth/credentials — rotate the local login. */
    suspend fun updateBasicAuthCredentials(
        currentPassword: String,
        newUsername: String?,
        newPassword: String?,
    ): ApiResponse<JsonElement>
}

class SettingsApiImpl(private val http: ApiHttp) : SettingsApi {

    override suspend fun getSettings(): ApiResponse<UserSettings> =
        http.get("/api/settings")

    override suspend fun updateSettings(input: UpdateSettingsInput): ApiResponse<UserSettings> =
        http.put("/api/settings") { setBody(input) }

    override suspend fun getZaiApi(): ApiResponse<ZaiApiStatus> =
        http.get("/api/settings/zai-api")

    override suspend fun updateZaiApi(input: UpdateZaiApiInput): ApiResponse<ZaiApiStatus> =
        http.put("/api/settings/zai-api") { setBody(input) }

    override suspend fun deleteZaiApi(): ApiResponse<Unit> =
        http.delete("/api/settings/zai-api")

    override suspend fun getSubagentUpstreams(): ApiResponse<List<SubagentUpstream>> =
        http.get("/api/settings/subagent-upstreams")

    override suspend fun saveSubagentUpstreams(
        input: List<SaveSubagentUpstreamInput>,
    ): ApiResponse<List<SubagentUpstream>> =
        http.put("/api/settings/subagent-upstreams") { setBody(input) }

    override suspend fun getSubagentModels(): ApiResponse<List<SubagentModelGroup>> =
        http.get("/api/settings/subagent-models")

    override suspend fun getCliSubagents(): ApiResponse<List<CliSubagentEntry>> =
        http.get("/api/settings/cli-subagents")

    override suspend fun saveCliSubagents(
        input: List<CliSubagentEntry>,
    ): ApiResponse<List<CliSubagentEntry>> =
        http.put("/api/settings/cli-subagents") { setBody(input) }

    override suspend fun updateBasicAuthCredentials(
        currentPassword: String,
        newUsername: String?,
        newPassword: String?,
    ): ApiResponse<JsonElement> =
        http.put("/api/basic-auth/credentials") {
            setBody(
                buildMap<String, String> {
                    put("currentPassword", currentPassword)
                    newUsername?.takeIf { it.isNotBlank() }?.let { put("newUsername", it) }
                    newPassword?.takeIf { it.isNotBlank() }?.let { put("newPassword", it) }
                }
            )
        }
}
