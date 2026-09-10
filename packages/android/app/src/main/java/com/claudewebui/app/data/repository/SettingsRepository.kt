package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CodexPlugin
import com.claudewebui.app.data.model.GatewayToken
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CLIProviderConfig
import com.claudewebui.app.data.model.CliLoginSession
import com.claudewebui.app.data.model.CliSubagentEntry
import com.claudewebui.app.data.model.ConfigAgent
import com.claudewebui.app.data.model.ConfigDocument
import com.claudewebui.app.data.model.ConfigItemKind
import com.claudewebui.app.data.model.ConfigMarketplace
import com.claudewebui.app.data.model.ConfigPlugin
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.data.model.CreateCategoryInput
import com.claudewebui.app.data.model.CreateCustomAgentInput
import com.claudewebui.app.data.model.CreateMcpServerInput
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.SaveSubagentUpstreamInput
import com.claudewebui.app.data.model.SubagentModelGroup
import com.claudewebui.app.data.model.SubagentUpstream
import com.claudewebui.app.data.model.McpTestResult
import com.claudewebui.app.data.model.OpenCodeProvider
import com.claudewebui.app.data.model.OpenCodeProviderTest
import com.claudewebui.app.data.model.InstallPluginInput
import com.claudewebui.app.data.model.SaveConfigAgentInput
import com.claudewebui.app.data.model.SaveConfigPluginInput
import com.claudewebui.app.data.model.SaveConfigSkillInput
import com.claudewebui.app.data.model.SlashCommand
import com.claudewebui.app.data.model.StyleLibrary
import com.claudewebui.app.data.model.Theme
import com.claudewebui.app.data.model.UiProvider
import com.claudewebui.app.data.model.UpdateCategoryInput
import com.claudewebui.app.data.model.UpdateCustomAgentInput
import com.claudewebui.app.data.model.UpdateMcpServerInput
import com.claudewebui.app.data.model.UpdateSettingsInput
import com.claudewebui.app.data.model.UserSettings
import com.claudewebui.app.data.model.UpdateZaiApiInput
import com.claudewebui.app.data.model.SaveOpenCodeProviderInput
import com.claudewebui.app.data.model.ZaiApiStatus
import kotlinx.serialization.json.JsonElement

/**
 * Repository for user settings and configuration data.
 *
 * All methods wrap [ApiClient] calls in [Result] so callers can handle
 * network errors without try/catch boilerplate.
 */
class SettingsRepository(
    private val api: ApiClient
) {

    // ---- User Settings -----------------------------------------------------

    /** Fetch the current user's settings. */
    suspend fun getSettings(): Result<UserSettings> = apiCall {
        val response = api.getSettings()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch settings")
        }
        response.data
    }

    // ---- Control gateway tokens ---------------------------------------------

    suspend fun getGatewayTokens(): Result<List<GatewayToken>> = apiCall {
        val response = api.getGatewayTokens()
        if (!response.success) error(response.error?.message ?: "Failed to fetch tokens")
        response.data.orEmpty()
    }

    /** The response carries the secret exactly once; it is never retrievable later. */
    suspend fun createGatewayToken(name: String, scope: String): Result<GatewayToken> = apiCall {
        val response = api.createGatewayToken(name, scope)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create token")
        }
        response.data
    }

    suspend fun revokeGatewayToken(id: String): Result<Unit> = apiCall {
        val response = api.revokeGatewayToken(id)
        if (!response.success) error(response.error?.message ?: "Failed to revoke token")
        Unit
    }

    // ---- Codex plugins -------------------------------------------------------

    suspend fun getCodexPlugins(): Result<List<CodexPlugin>> = apiCall {
        val response = api.getCodexPlugins()
        if (!response.success) error(response.error?.message ?: "Failed to fetch plugins")
        response.data.orEmpty()
    }

    suspend fun installCodexPlugin(pluginName: String, marketplaceId: String): Result<Unit> =
        apiCall {
            val response = api.installCodexPlugin(pluginName, marketplaceId)
            if (!response.success) error(response.error?.message ?: "Failed to install plugin")
            Unit
        }

    suspend fun setCodexPluginEnabled(id: String, enabled: Boolean): Result<Unit> = apiCall {
        val response = api.setCodexPluginEnabled(id, enabled)
        if (!response.success) error(response.error?.message ?: "Failed to update plugin")
        Unit
    }

    // ---- Subagent layer ------------------------------------------------------

    suspend fun getSubagentUpstreams(): Result<List<SubagentUpstream>> = apiCall {
        val response = api.getSubagentUpstreams()
        if (!response.success) error(response.error?.message ?: "Failed to fetch upstreams")
        response.data.orEmpty()
    }

    /** Replaces the whole list; entries without a token keep the stored one. */
    suspend fun saveSubagentUpstreams(
        input: List<SaveSubagentUpstreamInput>,
    ): Result<List<SubagentUpstream>> = apiCall {
        val response = api.saveSubagentUpstreams(input)
        if (!response.success) error(response.error?.message ?: "Failed to save upstreams")
        response.data.orEmpty()
    }

    suspend fun getSubagentModels(): Result<List<SubagentModelGroup>> = apiCall {
        val response = api.getSubagentModels()
        if (!response.success) error(response.error?.message ?: "Failed to fetch models")
        response.data.orEmpty()
    }

    suspend fun getCliSubagents(): Result<List<CliSubagentEntry>> = apiCall {
        val response = api.getCliSubagents()
        if (!response.success) error(response.error?.message ?: "Failed to fetch subagents")
        response.data.orEmpty()
    }

    suspend fun saveCliSubagents(
        input: List<CliSubagentEntry>,
    ): Result<List<CliSubagentEntry>> = apiCall {
        val response = api.saveCliSubagents(input)
        if (!response.success) error(response.error?.message ?: "Failed to save subagents")
        response.data.orEmpty()
    }

    /** Update settings with only the fields that changed. */
    suspend fun updateSettings(
        theme: Theme? = null,
        defaultWorkingDir: String? = null,
        allowedTools: List<String>? = null,
        customSystemPrompt: String? = null,
        uiProvider: UiProvider? = null,
        defaultCliProvider: CLIProvider? = null,
        cliProviderModels: Map<String, String>? = null,
        cliProviderReasoning: Map<String, String>? = null,
        cliProviderServiceTiers: Map<String, String>? = null,
        codexWebSearch: String? = null,
        usageAlerts: com.claudewebui.app.data.model.UsageAlertSettings? = null,
    ): Result<UserSettings> = apiCall {
        val input = UpdateSettingsInput(
            theme = theme,
            defaultWorkingDir = defaultWorkingDir,
            allowedTools = allowedTools,
            customSystemPrompt = customSystemPrompt,
            uiProvider = uiProvider,
            defaultCliProvider = defaultCliProvider,
            cliProviderModels = cliProviderModels,
            cliProviderReasoning = cliProviderReasoning,
            cliProviderServiceTiers = cliProviderServiceTiers,
            codexWebSearch = codexWebSearch,
            usageAlerts = usageAlerts,
        )
        val response = api.updateSettings(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update settings")
        }
        response.data
    }

    suspend fun getZaiApi(): Result<ZaiApiStatus> = apiCall {
        val response = api.getZaiApi()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch Z.AI configuration")
        }
        response.data
    }

    suspend fun updateZaiApi(input: UpdateZaiApiInput): Result<ZaiApiStatus> = apiCall {
        val response = api.updateZaiApi(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to save Z.AI configuration")
        }
        response.data
    }

    suspend fun deleteZaiApi(): Result<Unit> = apiCall {
        val response = api.deleteZaiApi()
        if (!response.success) error(response.error?.message ?: "Failed to reset Z.AI configuration")
    }

    suspend fun getOpenCodeProviders(): Result<List<OpenCodeProvider>> = apiCall {
        val response = api.getOpenCodeProviders()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch OpenCode providers")
        }
        response.data
    }

    suspend fun saveOpenCodeProvider(input: SaveOpenCodeProviderInput): Result<OpenCodeProvider> =
        apiCall {
            val response = api.saveOpenCodeProvider(input)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to save OpenCode provider")
            }
            response.data
        }

    suspend fun deleteOpenCodeProvider(id: String): Result<Unit> = apiCall {
        val response = api.deleteOpenCodeProvider(id)
        if (!response.success) error(response.error?.message ?: "Failed to delete OpenCode provider")
    }

    suspend fun testOpenCodeProvider(id: String): Result<OpenCodeProviderTest> = apiCall {
        val response = api.testOpenCodeProvider(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to test OpenCode provider")
        }
        response.data
    }

    // ---- CLI Providers -----------------------------------------------------

    /** Fetch the canonical CLI provider registry, including enabled/auth status. */
    suspend fun getCLIProviders(): Result<List<CLIProviderConfig>> = apiCall {
        val response = api.getCLIProviders()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch CLI providers")
        }
        response.data
    }

    // ---- MCP Servers -------------------------------------------------------

    /** Fetch all configured MCP servers. */
    suspend fun getMcpServers(): Result<List<McpServer>> = apiCall {
        val response = api.getMcpServers()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch MCP servers")
        }
        response.data
    }

    /** Add a new MCP server. */
    suspend fun createMcpServer(input: CreateMcpServerInput): Result<McpServer> = apiCall {
        val response = api.createMcpServer(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create MCP server")
        }
        response.data
    }

    /** Update an MCP server. */
    suspend fun updateMcpServer(id: String, input: UpdateMcpServerInput): Result<McpServer> = apiCall {
        val response = api.updateMcpServer(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update MCP server")
        }
        response.data
    }

    /** Ask the server to actually start the MCP server and report back. */
    suspend fun testMcpServer(id: String): Result<McpTestResult> = apiCall {
        val response = api.testMcpServer(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to test MCP server")
        }
        response.data
    }

    /** Delete an MCP server. */
    suspend fun deleteMcpServer(id: String): Result<Unit> = apiCall {
        val response = api.deleteMcpServer(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete MCP server")
        }
    }

    // ---- Custom agents ----------------------------------------------------

    suspend fun getAgents(): Result<List<CustomAgent>> = apiCall {
        val response = api.getAgents()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch agents")
        }
        response.data
    }

    suspend fun createAgent(input: CreateCustomAgentInput): Result<CustomAgent> = apiCall {
        val response = api.createAgent(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create agent")
        }
        response.data
    }

    suspend fun updateAgent(id: String, input: UpdateCustomAgentInput): Result<CustomAgent> = apiCall {
        val response = api.updateAgent(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update agent")
        }
        response.data
    }

    suspend fun deleteAgent(id: String): Result<Unit> = apiCall {
        val response = api.deleteAgent(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete agent")
        }
    }

    // ---- Claude config library ---------------------------------------------
    //
    // Distinct from the custom-agent CRUD above: these read the on-disk
    // catalogue that actually ships to the CLI harnesses, which is what the
    // WebUI's Extensions pane shows.

    suspend fun getConfigSkills(): Result<List<ConfigSkill>> = apiCall {
        val response = api.getConfigSkills()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch skills")
        }
        response.data
    }

    suspend fun getConfigAgents(): Result<List<ConfigAgent>> = apiCall {
        val response = api.getConfigAgents()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch agents")
        }
        response.data
    }

    suspend fun getConfigPlugins(): Result<List<ConfigPlugin>> = apiCall {
        val response = api.getConfigPlugins()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch plugins")
        }
        response.data
    }

    suspend fun getConfigMarketplaces(): Result<List<ConfigMarketplace>> = apiCall {
        val response = api.getConfigMarketplaces()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch marketplaces")
        }
        response.data
    }

    suspend fun installConfigPlugin(pluginName: String, marketplaceId: String): Result<Unit> =
        apiCall {
            val response = api.installConfigPlugin(InstallPluginInput(pluginName, marketplaceId))
            if (!response.success) error(response.error?.message ?: "Failed to install plugin")
        }

    suspend fun getStyleLibrary(): Result<StyleLibrary> = apiCall {
        val response = api.getStyleLibrary()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch style library")
        }
        response.data
    }

    /** Flip a skill between active and on-demand. Returns the resulting state. */
    suspend fun toggleConfigSkill(name: String): Result<Boolean> = apiCall {
        val response = api.toggleConfigSkill(name)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to toggle skill")
        }
        response.data.enabled
    }

    suspend fun toggleConfigAgent(name: String): Result<Boolean> = apiCall {
        val response = api.toggleConfigAgent(name)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to toggle agent")
        }
        response.data.enabled
    }

    suspend fun toggleConfigPlugin(name: String): Result<Boolean> = apiCall {
        val response = api.toggleConfigPlugin(name)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to toggle plugin")
        }
        response.data.enabled
    }

    suspend fun getConfigDocument(kind: ConfigItemKind, key: String): Result<ConfigDocument> =
        apiCall {
            when (kind) {
                ConfigItemKind.AGENT -> {
                    val response = api.getConfigAgent(key)
                    val item = response.data
                        ?.takeIf { response.success }
                        ?: error(response.error?.message ?: "Failed to fetch agent")
                    ConfigDocument(
                        kind = kind,
                        key = key,
                        name = item.name,
                        description = item.description,
                        content = item.prompt,
                        tools = item.tools,
                        model = item.model.orEmpty(),
                        enabled = item.enabled,
                    )
                }
                ConfigItemKind.SKILL -> {
                    val response = api.getConfigSkill(key)
                    val item = response.data
                        ?.takeIf { response.success }
                        ?: error(response.error?.message ?: "Failed to fetch skill")
                    ConfigDocument(
                        kind = kind,
                        key = key,
                        name = item.name,
                        description = item.description,
                        content = item.content,
                        tools = item.allowedTools,
                        model = item.model.orEmpty(),
                        enabled = item.enabled,
                    )
                }
                ConfigItemKind.PLUGIN -> {
                    val response = api.getConfigPlugin(key)
                    val item = response.data
                        ?.takeIf { response.success }
                        ?: error(response.error?.message ?: "Failed to fetch plugin")
                    ConfigDocument(
                        kind = kind,
                        key = key,
                        name = item.name,
                        description = item.description,
                        content = item.content,
                        version = item.version,
                        author = item.author.orEmpty(),
                        category = item.category.orEmpty(),
                        enabled = item.enabled,
                    )
                }
            }
        }

    suspend fun saveConfigDocument(document: ConfigDocument): Result<Unit> = apiCall {
        when (document.kind) {
            ConfigItemKind.AGENT -> {
                val response = api.saveConfigAgent(
                    document.key,
                    SaveConfigAgentInput(
                        name = document.name,
                        description = document.description,
                        tools = document.tools,
                        model = document.model.takeIf { it.isNotBlank() },
                        prompt = document.content,
                    ),
                )
                if (!response.success) error(response.error?.message ?: "Failed to save agent")
            }
            ConfigItemKind.SKILL -> {
                val response = api.saveConfigSkill(
                    document.key,
                    SaveConfigSkillInput(
                        name = document.name,
                        description = document.description,
                        allowedTools = document.tools,
                        model = document.model.takeIf { it.isNotBlank() },
                        content = document.content,
                    ),
                )
                if (!response.success) error(response.error?.message ?: "Failed to save skill")
            }
            ConfigItemKind.PLUGIN -> {
                val response = api.saveConfigPlugin(
                    document.key,
                    SaveConfigPluginInput(
                        name = document.name,
                        description = document.description,
                        version = document.version.ifBlank { "1.0.0" },
                        author = document.author.takeIf { it.isNotBlank() },
                        category = document.category.takeIf { it.isNotBlank() },
                        content = document.content,
                    ),
                )
                if (!response.success) error(response.error?.message ?: "Failed to save plugin")
            }
        }
    }

    suspend fun deleteConfigDocument(document: ConfigDocument): Result<Unit> = apiCall {
        val key = document.key ?: error("Unsaved entries cannot be deleted")
        val response = when (document.kind) {
            ConfigItemKind.AGENT -> api.deleteConfigAgent(key)
            ConfigItemKind.SKILL -> api.deleteConfigSkill(key)
            // This delete route expects user-<slug> for local plugins.
            ConfigItemKind.PLUGIN -> api.deleteConfigPlugin("user-$key")
        }
        if (!response.success) error(response.error?.message ?: "Failed to delete entry")
    }

    /** Custom CLI tools registered on the server. Payloads stay opaque JSON. */
    suspend fun getCliTools(): Result<List<JsonElement>> = apiCall {
        val response = api.getCliTools()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch CLI tools")
        }
        response.data
    }

    suspend fun getCommands(): Result<List<SlashCommand>> = apiCall {
        val response = api.getCommands()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch commands")
        }
        response.data
    }

    // ---- CLI harness login -------------------------------------------------

    suspend fun startCliLogin(provider: String): Result<CliLoginSession> = apiCall {
        val response = api.startCliLogin(provider)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to start login")
        }
        response.data
    }

    suspend fun pollCliLogin(id: String): Result<CliLoginSession> = apiCall {
        val response = api.getCliLogin(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Login session not found")
        }
        response.data
    }

    suspend fun submitCliLoginCode(id: String, code: String): Result<CliLoginSession> = apiCall {
        val response = api.submitCliLoginCode(id, code)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to submit code")
        }
        response.data
    }

    suspend fun cancelCliLogin(id: String): Result<Unit> = apiCall {
        api.cancelCliLogin(id)
        Unit
    }

    // ---- Categories --------------------------------------------------------

    /** Fetch all session categories. */
    suspend fun getCategories(): Result<List<Category>> = apiCall {
        val response = api.getCategories()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch categories")
        }
        response.data
    }

    /** Create a new category. */
    suspend fun createCategory(input: CreateCategoryInput): Result<Category> = apiCall {
        val response = api.createCategory(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create category")
        }
        response.data
    }

    /** Update a category. */
    suspend fun updateCategory(id: String, input: UpdateCategoryInput): Result<Category> = apiCall {
        val response = api.updateCategory(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update category")
        }
        response.data
    }

    /** Delete a category. */
    suspend fun deleteCategory(id: String): Result<Unit> = apiCall {
        val response = api.deleteCategory(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete category")
        }
    }
}
