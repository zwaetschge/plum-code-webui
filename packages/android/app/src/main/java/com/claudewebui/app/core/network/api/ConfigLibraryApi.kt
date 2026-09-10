package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/**
 * The on-disk configuration library: `/api/claude-config` (skills, agents,
 * plugins, styles, marketplaces), slash commands, and Codex plugins.
 */
interface ConfigLibraryApi {
    /**
     * GET /api/claude-config/skills — the on-disk skill catalogue.
     *
     * `library` selects the catalogue slice: `skill` (default) returns coding
     * skills only, `all` additionally folds in the design and writing style
     * presets, `design` / `writing` return just those.
     */
    suspend fun getConfigSkills(library: String = "skill"): ApiResponse<List<ConfigSkill>>

    /** GET /api/claude-config/agents — agents defined as markdown in `~/.claude/agents`. */
    suspend fun getConfigAgents(): ApiResponse<List<ConfigAgent>>

    /** GET /api/claude-config/plugins */
    suspend fun getConfigPlugins(): ApiResponse<List<ConfigPlugin>>

    /** GET /api/claude-config/style-library */
    suspend fun getStyleLibrary(): ApiResponse<StyleLibrary>

    /**
     * PUT /api/claude-config/skill/:name/toggle
     *
     * These three routes flip the stored state themselves and ignore the
     * request body, so there is no desired-state parameter — the response
     * reports which way it landed. Admin-only on the server.
     */
    suspend fun toggleConfigSkill(name: String): ApiResponse<ToggleResult>

    /** PUT /api/claude-config/agent/:name/toggle */
    suspend fun toggleConfigAgent(name: String): ApiResponse<ToggleResult>

    /** PUT /api/claude-config/plugin/:name/toggle */
    suspend fun toggleConfigPlugin(name: String): ApiResponse<ToggleResult>

    suspend fun getConfigAgent(name: String): ApiResponse<ConfigAgentContent>

    suspend fun saveConfigAgent(
        key: String?,
        input: SaveConfigAgentInput,
    ): ApiResponse<ConfigAgent>

    suspend fun deleteConfigAgent(name: String): ApiResponse<Unit>

    suspend fun getConfigSkill(name: String): ApiResponse<ConfigSkillContent>

    suspend fun saveConfigSkill(
        key: String?,
        input: SaveConfigSkillInput,
    ): ApiResponse<ConfigSkill>

    suspend fun deleteConfigSkill(name: String): ApiResponse<Unit>

    suspend fun getConfigPlugin(name: String): ApiResponse<ConfigPluginContent>

    suspend fun saveConfigPlugin(
        key: String?,
        input: SaveConfigPluginInput,
    ): ApiResponse<ConfigPlugin>

    suspend fun deleteConfigPlugin(id: String): ApiResponse<Unit>

    suspend fun getConfigMarketplaces(): ApiResponse<List<ConfigMarketplace>>

    suspend fun installConfigPlugin(input: InstallPluginInput): ApiResponse<ConfigPlugin>

    // ---- Slash commands ----------------------------------------------------

    /** GET /api/commands */
    suspend fun getCommands(): ApiResponse<List<SlashCommand>>

    // ---- Codex plugins -----------------------------------------------------

    /** GET /api/codex/plugins */
    suspend fun getCodexPlugins(): ApiResponse<List<CodexPlugin>>

    /** POST /api/codex/plugins/:id — enable or disable. */
    suspend fun setCodexPluginEnabled(id: String, enabled: Boolean): ApiResponse<JsonElement>

    /** POST /api/codex/plugins/install — admin-only on the server. */
    suspend fun installCodexPlugin(
        pluginName: String,
        marketplaceId: String,
    ): ApiResponse<JsonElement>
}

class ConfigLibraryApiImpl(private val http: ApiHttp) : ConfigLibraryApi {

    override suspend fun getConfigSkills(library: String): ApiResponse<List<ConfigSkill>> =
        http.get("/api/claude-config/skills") { parameter("library", library) }

    override suspend fun getConfigAgents(): ApiResponse<List<ConfigAgent>> =
        http.get("/api/claude-config/agents")

    override suspend fun getConfigPlugins(): ApiResponse<List<ConfigPlugin>> =
        http.get("/api/claude-config/plugins")

    override suspend fun getStyleLibrary(): ApiResponse<StyleLibrary> =
        http.get("/api/claude-config/style-library")

    override suspend fun toggleConfigSkill(name: String): ApiResponse<ToggleResult> =
        http.put("/api/claude-config/skill/${http.pathSegment(name)}/toggle")

    override suspend fun toggleConfigAgent(name: String): ApiResponse<ToggleResult> =
        http.put("/api/claude-config/agent/${http.pathSegment(name)}/toggle")

    override suspend fun toggleConfigPlugin(name: String): ApiResponse<ToggleResult> =
        http.put("/api/claude-config/plugin/${http.pathSegment(name)}/toggle")

    override suspend fun getConfigAgent(name: String): ApiResponse<ConfigAgentContent> =
        http.get("/api/claude-config/agent/${http.pathSegment(name)}")

    override suspend fun saveConfigAgent(
        key: String?,
        input: SaveConfigAgentInput,
    ): ApiResponse<ConfigAgent> = if (key == null) {
        http.post("/api/claude-config/agents") { setBody(input) }
    } else {
        http.put("/api/claude-config/agent/${http.pathSegment(key)}") { setBody(input) }
    }

    override suspend fun deleteConfigAgent(name: String): ApiResponse<Unit> =
        http.delete("/api/claude-config/agent/${http.pathSegment(name)}")

    override suspend fun getConfigSkill(name: String): ApiResponse<ConfigSkillContent> =
        http.get("/api/claude-config/skill/${http.pathSegment(name)}")

    override suspend fun saveConfigSkill(
        key: String?,
        input: SaveConfigSkillInput,
    ): ApiResponse<ConfigSkill> = if (key == null) {
        http.post("/api/claude-config/skills") { setBody(input) }
    } else {
        http.put("/api/claude-config/skill/${http.pathSegment(key)}") { setBody(input) }
    }

    override suspend fun deleteConfigSkill(name: String): ApiResponse<Unit> =
        http.delete("/api/claude-config/skill/${http.pathSegment(name)}")

    override suspend fun getConfigPlugin(name: String): ApiResponse<ConfigPluginContent> =
        http.get("/api/claude-config/plugin/${http.pathSegment(name)}")

    override suspend fun saveConfigPlugin(
        key: String?,
        input: SaveConfigPluginInput,
    ): ApiResponse<ConfigPlugin> = if (key == null) {
        http.post("/api/claude-config/plugins") { setBody(input) }
    } else {
        http.put("/api/claude-config/plugin/${http.pathSegment(key)}") { setBody(input) }
    }

    override suspend fun deleteConfigPlugin(id: String): ApiResponse<Unit> =
        http.delete("/api/claude-config/plugin/${http.pathSegment(id)}")

    override suspend fun getConfigMarketplaces(): ApiResponse<List<ConfigMarketplace>> =
        http.get("/api/claude-config/marketplaces")

    override suspend fun installConfigPlugin(input: InstallPluginInput): ApiResponse<ConfigPlugin> =
        http.post("/api/claude-config/plugins/install") { setBody(input) }

    override suspend fun getCommands(): ApiResponse<List<SlashCommand>> =
        http.get("/api/commands")

    override suspend fun getCodexPlugins(): ApiResponse<List<CodexPlugin>> =
        http.get("/api/codex/plugins")

    override suspend fun setCodexPluginEnabled(id: String, enabled: Boolean): ApiResponse<JsonElement> =
        http.post("/api/codex/plugins/$id") { setBody(CodexPluginToggleInput(enabled)) }

    override suspend fun installCodexPlugin(
        pluginName: String,
        marketplaceId: String,
    ): ApiResponse<JsonElement> =
        http.post("/api/codex/plugins/install") {
            setBody(CodexPluginInstallInput(pluginName, marketplaceId))
        }
}
