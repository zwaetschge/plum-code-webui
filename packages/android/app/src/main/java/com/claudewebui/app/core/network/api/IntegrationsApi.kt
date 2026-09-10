package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** ComfyUI, Discord and Home Assistant settings plus their connection probes. */
interface IntegrationsApi {
    /** GET /api/comfyui/settings */
    suspend fun getComfyUiSettings(): ApiResponse<ComfyUiSettings>

    /** PUT /api/comfyui/settings — admin-only; url must be absolute. */
    suspend fun updateComfyUiSettings(url: String?, enabled: Boolean?): ApiResponse<ComfyUiSettings>

    /** GET /api/comfyui/test — probes ComfyUI's /system_stats. */
    suspend fun testComfyUi(): ApiResponse<JsonElement>

    /** GET /api/discord/settings */
    suspend fun getDiscordSettings(): ApiResponse<DiscordSettings>

    /** PUT /api/discord/settings — webhook or bot transport. */
    suspend fun updateDiscordSettings(input: UpdateDiscordSettingsInput): ApiResponse<DiscordSettings>

    /** POST /api/discord/test */
    suspend fun testDiscord(): ApiResponse<JsonElement>

    /** GET /api/home-assistant/settings */
    suspend fun getHomeAssistantSettings(): ApiResponse<HomeAssistantSettings>

    /** PUT /api/home-assistant/settings — admin-only. */
    suspend fun updateHomeAssistantSettings(
        input: UpdateHomeAssistantSettingsInput,
    ): ApiResponse<HomeAssistantSettings>

    /** POST /api/home-assistant/test */
    suspend fun testHomeAssistant(): ApiResponse<JsonElement>
}

class IntegrationsApiImpl(private val http: ApiHttp) : IntegrationsApi {

    override suspend fun getComfyUiSettings(): ApiResponse<ComfyUiSettings> =
        http.get("/api/comfyui/settings")

    override suspend fun updateComfyUiSettings(url: String?, enabled: Boolean?): ApiResponse<ComfyUiSettings> =
        http.put("/api/comfyui/settings") {
            setBody(
                buildMap<String, Any> {
                    url?.let { put("url", it) }
                    enabled?.let { put("enabled", it) }
                }
            )
        }

    override suspend fun testComfyUi(): ApiResponse<JsonElement> =
        http.get("/api/comfyui/test")

    override suspend fun getDiscordSettings(): ApiResponse<DiscordSettings> =
        http.get("/api/discord/settings")

    override suspend fun updateDiscordSettings(input: UpdateDiscordSettingsInput): ApiResponse<DiscordSettings> =
        http.put("/api/discord/settings") { setBody(input) }

    override suspend fun testDiscord(): ApiResponse<JsonElement> =
        http.post("/api/discord/test")

    override suspend fun getHomeAssistantSettings(): ApiResponse<HomeAssistantSettings> =
        http.get("/api/home-assistant/settings")

    override suspend fun updateHomeAssistantSettings(
        input: UpdateHomeAssistantSettingsInput,
    ): ApiResponse<HomeAssistantSettings> =
        http.put("/api/home-assistant/settings") { setBody(input) }

    override suspend fun testHomeAssistant(): ApiResponse<JsonElement> =
        http.post("/api/home-assistant/test")
}
