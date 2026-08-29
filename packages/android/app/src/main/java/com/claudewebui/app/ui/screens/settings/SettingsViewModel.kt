package com.claudewebui.app.ui.screens.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.core.notifications.NotificationPreferences
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AuthUser
import com.claudewebui.app.data.model.CreateCustomAgentInput
import com.claudewebui.app.data.model.CLIProviderConfig
import com.claudewebui.app.data.model.CliLoginSession
import com.claudewebui.app.data.model.CliSubagentEntry
import com.claudewebui.app.data.model.ConfigAgent
import com.claudewebui.app.data.model.ConfigDocument
import com.claudewebui.app.data.model.ConfigItemKind
import com.claudewebui.app.data.model.ConfigMarketplace
import com.claudewebui.app.data.model.ConfigPlugin
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.data.model.CreateMcpServerInput
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.data.model.CodexPlugin
import com.claudewebui.app.data.model.GatewayToken
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.SaveSubagentUpstreamInput
import com.claudewebui.app.data.model.SubagentModelGroup
import com.claudewebui.app.data.model.SubagentUpstream
import com.claudewebui.app.data.model.McpServerType
import com.claudewebui.app.data.model.OpenCodeProvider
import com.claudewebui.app.data.model.SlashCommand
import com.claudewebui.app.data.model.Theme
import com.claudewebui.app.data.model.UpdateCustomAgentInput
import com.claudewebui.app.data.model.UpdateMcpServerInput
import com.claudewebui.app.data.model.UserSettings
import com.claudewebui.app.data.model.UpdateZaiApiInput
import com.claudewebui.app.data.model.SaveOpenCodeProviderInput
import com.claudewebui.app.data.model.ZaiApiStatus
import com.claudewebui.app.data.repository.AuthRepository
import com.claudewebui.app.data.repository.SettingsRepository
import com.claudewebui.app.ui.theme.AppThemeOption
import com.claudewebui.app.ui.theme.AppThemeStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// ── CLI tool (opaque from the API but we surface key fields) ──────────────────

data class CliTool(
    val id: String,
    val name: String,
    val description: String,
    val enabled: Boolean,
    val category: CliToolCategory,
    val command: String? = null,
    val rawJson: JsonElement? = null,
)

enum class CliToolCategory { BUILTIN, CUSTOM, MCP_PROVIDED }

// ── Connection test result ────────────────────────────────────────────────────

sealed class TestResult {
    data object Idle : TestResult()
    data object Testing : TestResult()
    data object Success : TestResult()
    data class Failure(val message: String) : TestResult()
}

// ── UI state ──────────────────────────────────────────────────────────────────

data class SettingsUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val toastMessage: String? = null,

    // Server / account
    val serverUrl: String = "",
    val currentUser: AuthUser? = null,

    // Local-only prefs
    val theme: AppThemeOption = AppThemeOption.SYSTEM,
    val fontSize: FontSize = FontSize.MEDIUM,
    val notificationsEnabled: Boolean = true,
    val notificationsAllowedBySystem: Boolean = true,
    val biometricEnabled: Boolean = false,
    val sessionTimeoutMinutes: Int = 30,

    // Server-synced settings
    val userSettings: UserSettings? = null,

    // Providers
    val cliProviders: List<CLIProviderConfig> = emptyList(),
    val zaiApi: ZaiApiStatus? = null,
    val zaiApiSaving: Boolean = false,
    val openCodeProviders: List<OpenCodeProvider> = emptyList(),
    val openCodeSaving: Boolean = false,
    val openCodeTestResults: Map<String, TestResult> = emptyMap(),
    val openCodeTestMessages: Map<String, String> = emptyMap(),

    // Control gateway tokens and the Codex plugin catalogue — both were
    // reachable only from the WebUI before.
    val gatewayTokens: List<GatewayToken> = emptyList(),
    val newGatewayTokenSecret: String? = null,
    val codexPlugins: List<CodexPlugin> = emptyList(),
    val parityBusy: Boolean = false,

    // Subagent layer: endpoint-swapping upstreams and cross-harness CLI
    // workers. Both were WebUI-only, so a phone could see delegation happen
    // but not configure who may be delegated to.
    val subagentUpstreams: List<SubagentUpstream> = emptyList(),
    val subagentModelGroups: List<SubagentModelGroup> = emptyList(),
    val cliSubagents: List<CliSubagentEntry> = emptyList(),
    val subagentBusy: Boolean = false,

    // MCP
    val mcpServers: List<McpServer> = emptyList(),
    val mcpTestResults: Map<String, TestResult> = emptyMap(),
    val expandedMcpIds: Set<String> = emptySet(),

    // CLI Tools
    val cliTools: List<CliTool> = emptyList(),
    val cliToolSearchQuery: String = "",

    // Agents (user-authored, stored in the WebUI database)
    val agents: List<CustomAgent> = emptyList(),

    // On-disk catalogue served to the CLI harnesses (the claude-config routes).
    // This — not `agents` above — is what the WebUI's Extensions pane counts.
    val configAgents: List<ConfigAgent> = emptyList(),
    val configSkills: List<ConfigSkill> = emptyList(),
    val configPlugins: List<ConfigPlugin> = emptyList(),
    val configMarketplaces: List<ConfigMarketplace> = emptyList(),
    val marketplaceBusyIds: Set<String> = emptySet(),
    val designStyles: List<ConfigSkill> = emptyList(),
    val writingStyles: List<ConfigSkill> = emptyList(),
    val commands: List<SlashCommand> = emptyList(),
    val libraryLoading: Boolean = false,
    val libraryEditorKind: ConfigItemKind? = null,
    val libraryDocument: ConfigDocument? = null,
    val libraryEditorLoading: Boolean = false,
    val librarySaving: Boolean = false,

    // CLI harness login in progress
    val cliLogin: CliLoginSession? = null,
    val cliLoginProvider: String? = null,
    val cliLoginError: String? = null,

    // App info
    val appVersion: String = "1.0.0",
    val cacheSize: String = "0 MB",
)

// ── Local preference enums (mirrors Theme but for local storage) ──────────────

// Theme options live in AppThemeStore so the activity can read them without
// depending on this ViewModel.

enum class FontSize(val label: String, val scale: Float) {
    SMALL("Small", 0.85f),
    MEDIUM("Medium", 1.0f),
    LARGE("Large", 1.15f),
    EXTRA_LARGE("Extra large", 1.3f),
}

// ── ViewModel ─────────────────────────────────────────────────────────────────

private const val PREFS_NAME = "settings_prefs"
// The theme key is owned by AppThemeStore — deliberately not duplicated here.
private const val KEY_FONT_SIZE = "font_size"
private const val KEY_BIOMETRIC = "biometric_enabled"
private const val KEY_SESSION_TIMEOUT = "session_timeout_minutes"

class SettingsViewModel(
    private val settingsRepository: SettingsRepository,
    private val authRepository: AuthRepository,
    private val context: Context,
) : ViewModel() {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()
    private var cliLoginJob: Job? = null

    init {
        loadLocalPrefs()
        loadSettings()
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    private fun loadLocalPrefs() {
        val fontSizeName = prefs.getString(KEY_FONT_SIZE, FontSize.MEDIUM.name) ?: FontSize.MEDIUM.name
        _uiState.update {
            it.copy(
                serverUrl = TokenStore.getServerUrl() ?: "",
                theme = AppThemeStore.theme.value,
                fontSize = FontSize.entries.firstOrNull { e -> e.name == fontSizeName } ?: FontSize.MEDIUM,
                notificationsEnabled = NotificationPreferences.isEnabled(context),
                notificationsAllowedBySystem = NotificationPreferences.systemAllowsNotifications(context),
                biometricEnabled = prefs.getBoolean(KEY_BIOMETRIC, false),
                sessionTimeoutMinutes = prefs.getInt(KEY_SESSION_TIMEOUT, 30),
            )
        }
    }

    /**
     * Load everything the settings and library screens render.
     *
     * The requests are independent, so they run concurrently rather than in
     * sequence — served over the internet, a serial chain left the Library
     * screen sitting on zeros for the better part of a minute, which reads as
     * "nothing configured" rather than "still loading".
     */
    fun loadSettings() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, libraryLoading = true, error = null) }

            coroutineScope {
                launch {
                    authRepository.getAuthUser()
                        .onSuccess { user -> _uiState.update { it.copy(currentUser = user) } }
                }
                launch {
                    settingsRepository.getSettings()
                        .onSuccess { settings ->
                            _uiState.update { it.copy(userSettings = settings) }
                            // Only follows the account when the user enabled
                            // appearance sync in the WebUI.
                            AppThemeStore.applyServerTheme(
                                context,
                                settings.theme.name.lowercase(),
                                settings.appearanceSync,
                            )
                        }
                        .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
                    // Depends on the allowedTools allowlist from the call above.
                    loadCliToolsInternal()
                }
                launch {
                    settingsRepository.getCLIProviders()
                        .onSuccess { providers -> _uiState.update { it.copy(cliProviders = providers) } }
                }
                launch {
                    settingsRepository.getZaiApi()
                        .onSuccess { status -> _uiState.update { it.copy(zaiApi = status) } }
                }
                launch {
                    settingsRepository.getOpenCodeProviders()
                        .onSuccess { providers -> _uiState.update { it.copy(openCodeProviders = providers) } }
                }
                launch {
                    settingsRepository.getMcpServers()
                        .onSuccess { servers -> _uiState.update { it.copy(mcpServers = servers) } }
                }
                launch {
                    settingsRepository.getAgents()
                        .onSuccess { agents -> _uiState.update { it.copy(agents = agents) } }
                }
                launch { loadConfigLibraryInternal() }
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    /**
     * Load the on-disk catalogue from the claude-config routes, plus commands.
     *
     * Each source is fetched independently so one unavailable endpoint doesn't
     * blank out the rest of the Library screen.
     */
    /**
     * Load once if we have nothing yet.
     *
     * The shared instance is created with the navigation graph, which happens
     * before the user has authenticated. That first load fails silently, and
     * without this the screens would sit on empty lists for the rest of the
     * session. Screens call this when they appear.
     */
    fun ensureLoaded() {
        val state = _uiState.value
        val hasNothing = state.cliProviders.isEmpty() &&
            state.mcpServers.isEmpty() &&
            state.configAgents.isEmpty()
        if (hasNothing && !state.isLoading) loadSettings()
    }

    fun loadConfigLibrary() {
        viewModelScope.launch { loadConfigLibraryInternal() }
    }

    private suspend fun loadConfigLibraryInternal() {
        _uiState.update { it.copy(libraryLoading = true) }
        coroutineScope {
            launch {
                settingsRepository.getConfigAgents()
                    .onSuccess { agents -> _uiState.update { it.copy(configAgents = agents) } }
            }
            launch {
                settingsRepository.getConfigSkills()
                    .onSuccess { skills -> _uiState.update { it.copy(configSkills = skills) } }
            }
            launch {
                settingsRepository.getConfigPlugins()
                    .onSuccess { plugins -> _uiState.update { it.copy(configPlugins = plugins) } }
            }
            launch {
                settingsRepository.getConfigMarketplaces()
                    .onSuccess { marketplaces ->
                        _uiState.update { it.copy(configMarketplaces = marketplaces) }
                    }
            }
            launch {
                settingsRepository.getStyleLibrary()
                    .onSuccess { library ->
                        _uiState.update {
                            it.copy(
                                designStyles = library.designStyles,
                                writingStyles = library.writingStyles,
                            )
                        }
                    }
            }
            launch {
                settingsRepository.getCommands()
                    .onSuccess { commands -> _uiState.update { it.copy(commands = commands) } }
            }
        }
        _uiState.update { it.copy(libraryLoading = false) }
    }

    /**
     * Built-in harness tools plus any custom tools registered on the server.
     *
     * The built-ins are a fixed set the CLI always exposes; their enabled state
     * comes from the user's `allowedTools` allowlist. Custom entries come from
     * `/api/cli-tools`, which returns opaque JSON, so we pull out the fields we
     * render and keep the raw payload for the detail sheet.
     */
    fun loadCliTools() {
        viewModelScope.launch { loadCliToolsInternal() }
    }

    private suspend fun loadCliToolsInternal() {
        run {
            val allowedTools = _uiState.value.userSettings?.allowedTools ?: emptyList()
            val builtinNames = listOf(
                "Bash" to "Execute shell commands",
                "Read" to "Read file contents",
                "Write" to "Write files to disk",
                "Edit" to "Edit file contents",
                "Glob" to "Find files by pattern",
                "Grep" to "Search file contents",
                "WebSearch" to "Search the web",
                "WebFetch" to "Fetch web pages",
            )
            val builtins = builtinNames.mapIndexed { i, (name, desc) ->
                CliTool(
                    id = "builtin_$i",
                    name = name,
                    description = desc,
                    enabled = allowedTools.isEmpty() || allowedTools.contains(name),
                    category = CliToolCategory.BUILTIN,
                )
            }

            val custom = settingsRepository.getCliTools()
                .getOrDefault(emptyList())
                .mapIndexedNotNull { index, element -> parseCliTool(element, index) }

            _uiState.update { it.copy(cliTools = builtins + custom) }
        }
    }

    private fun parseCliTool(element: JsonElement, index: Int): CliTool? {
        val obj = element as? JsonObject ?: return null
        fun string(key: String): String? =
            (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val name = string("name") ?: return null
        return CliTool(
            id = string("id") ?: "custom_$index",
            name = name,
            description = string("description").orEmpty(),
            enabled = (obj["enabled"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: true,
            category = CliToolCategory.CUSTOM,
            command = string("command"),
            rawJson = element,
        )
    }

    fun loadAgents() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            settingsRepository.getAgents()
                .onSuccess { agents -> _uiState.update { it.copy(agents = agents) } }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
            loadConfigLibrary()
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    // ── Config library toggles ────────────────────────────────────────────────

    // The server flips these itself and reports the resulting state, so we patch
    // the matching entry with what came back rather than what the UI requested.

    fun toggleConfigSkill(key: String) {
        viewModelScope.launch {
            settingsRepository.toggleConfigSkill(key)
                .onSuccess { enabled ->
                    _uiState.update { state ->
                        state.copy(
                            configSkills = state.configSkills.map {
                                if (it.baseName == key || it.id.removePrefix("user-") == key) {
                                    it.copy(enabled = enabled)
                                } else it
                            },
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun toggleConfigAgent(key: String) {
        viewModelScope.launch {
            settingsRepository.toggleConfigAgent(key)
                .onSuccess { enabled ->
                    _uiState.update { state ->
                        state.copy(
                            configAgents = state.configAgents.map {
                                if (it.id.removePrefix("user-") == key) it.copy(enabled = enabled) else it
                            },
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun toggleConfigPlugin(key: String) {
        viewModelScope.launch {
            settingsRepository.toggleConfigPlugin(key)
                .onSuccess { enabled ->
                    _uiState.update { state ->
                        state.copy(
                            configPlugins = state.configPlugins.map {
                                if (it.id.removePrefix("user-") == key) it.copy(enabled = enabled) else it
                            },
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun createConfigDocument(kind: ConfigItemKind) {
        _uiState.update {
            it.copy(
                libraryEditorKind = kind,
                libraryDocument = ConfigDocument(kind = kind),
                libraryEditorLoading = false,
            )
        }
    }

    fun openConfigDocument(kind: ConfigItemKind, key: String) {
        _uiState.update {
            it.copy(
                libraryEditorKind = kind,
                libraryDocument = null,
                libraryEditorLoading = true,
                error = null,
            )
        }
        viewModelScope.launch {
            settingsRepository.getConfigDocument(kind, key)
                .onSuccess { document ->
                    _uiState.update {
                        it.copy(libraryDocument = document, libraryEditorLoading = false)
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            libraryEditorKind = null,
                            libraryEditorLoading = false,
                            error = error.message,
                        )
                    }
                }
        }
    }

    fun dismissConfigEditor() {
        _uiState.update {
            it.copy(
                libraryEditorKind = null,
                libraryDocument = null,
                libraryEditorLoading = false,
                librarySaving = false,
            )
        }
    }

    fun saveConfigDocument(document: ConfigDocument) {
        _uiState.update { it.copy(librarySaving = true, error = null) }
        viewModelScope.launch {
            settingsRepository.saveConfigDocument(document)
                .onSuccess {
                    dismissConfigEditor()
                    _uiState.update { it.copy(toastMessage = "${document.kind.label()} saved") }
                    loadConfigLibraryInternal()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(librarySaving = false, error = error.message) }
                }
        }
    }

    fun deleteConfigDocument(document: ConfigDocument) {
        _uiState.update { it.copy(librarySaving = true, error = null) }
        viewModelScope.launch {
            settingsRepository.deleteConfigDocument(document)
                .onSuccess {
                    dismissConfigEditor()
                    _uiState.update { it.copy(toastMessage = "${document.kind.label()} removed") }
                    loadConfigLibraryInternal()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(librarySaving = false, error = error.message) }
                }
        }
    }

    fun installMarketplacePlugin(pluginName: String, marketplaceId: String) {
        val id = "$pluginName@$marketplaceId"
        _uiState.update { it.copy(marketplaceBusyIds = it.marketplaceBusyIds + id, error = null) }
        viewModelScope.launch {
            settingsRepository.installConfigPlugin(pluginName, marketplaceId)
                .onSuccess {
                    _uiState.update { it.copy(toastMessage = "$pluginName installed") }
                    loadConfigLibraryInternal()
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
            _uiState.update { it.copy(marketplaceBusyIds = it.marketplaceBusyIds - id) }
        }
    }

    private fun ConfigItemKind.label(): String = name.lowercase().replaceFirstChar { it.uppercase() }

    // ── Theme / appearance ────────────────────────────────────────────────────

    /**
     * Persist the theme through [AppThemeStore] rather than this ViewModel's
     * own prefs: the activity observes that store, and it is what actually
     * repaints the app. Writing only to local state here would leave the
     * setting visibly inert, which is what it used to do.
     */
    fun updateTheme(option: AppThemeOption) {
        AppThemeStore.set(context, option)
        _uiState.update { it.copy(theme = option) }
    }

    fun updateFontSize(size: FontSize) {
        prefs.edit().putString(KEY_FONT_SIZE, size.name).apply()
        _uiState.update { it.copy(fontSize = size) }
    }

    // ── Notifications / security ──────────────────────────────────────────────

    /**
     * Mirror the account-wide alert thresholds into the widget prefs so the
     * background worker applies them without another settings request.
     */
    /** Persist alert thresholds account-wide; both clients read them. */
    fun updateUsageAlerts(
        enabled: Boolean? = null,
        quotaPercent: Int? = null,
        dailyCostUsd: Double? = null,
    ) {
        viewModelScope.launch {
            val current = _uiState.value.userSettings?.usageAlerts
                ?: com.claudewebui.app.data.model.UsageAlertSettings()
            val next = current.copy(
                enabled = enabled ?: current.enabled,
                quotaPercent = quotaPercent ?: current.quotaPercent,
                dailyCostUsd = dailyCostUsd ?: current.dailyCostUsd,
            )
            runCatching {
                settingsRepository.updateSettings(usageAlerts = next)
            }
        }
    }

    fun cacheUsageAlerts(context: android.content.Context) {
        _uiState.value.userSettings?.usageAlerts?.let {
            com.claudewebui.app.widget.UsageAlerts.cacheServerSettings(context, it)
        }
    }

    fun setNotificationsEnabled(enabled: Boolean) {
        NotificationPreferences.setEnabled(context, enabled)
        LocalNotificationManager.onNotificationsPreferenceChanged()
        _uiState.update {
            it.copy(
                notificationsEnabled = enabled,
                notificationsAllowedBySystem = NotificationPreferences.systemAllowsNotifications(context),
            )
        }
    }

    fun onNotificationPermissionResult(granted: Boolean) {
        NotificationPreferences.setEnabled(context, granted)
        val allowedBySystem = NotificationPreferences.systemAllowsNotifications(context)
        LocalNotificationManager.onNotificationsPreferenceChanged()
        _uiState.update {
            it.copy(
                notificationsEnabled = granted,
                notificationsAllowedBySystem = allowedBySystem,
            )
        }
    }

    // ── Control gateway tokens ──────────────────────────────────────────────
    // A gateway token cannot manage gateway tokens, so this only ever works
    // from a real signed-in session — same rule as the WebUI.

    fun loadGatewayTokens() {
        viewModelScope.launch {
            _uiState.update { it.copy(parityBusy = true) }
            val tokens = settingsRepository.getGatewayTokens().getOrNull()
            _uiState.update { it.copy(gatewayTokens = tokens.orEmpty(), parityBusy = false) }
        }
    }

    fun createGatewayToken(name: String, readOnly: Boolean = false) {
        val clean = name.trim()
        if (clean.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(parityBusy = true, error = null) }
            val result = settingsRepository.createGatewayToken(clean, if (readOnly) "read" else "write")
            _uiState.update {
                it.copy(
                    // Shown once and never again; the server only stores a hash.
                    newGatewayTokenSecret = result.getOrNull()?.token,
                    error = result.exceptionOrNull()?.message ?: it.error,
                    parityBusy = false,
                )
            }
            loadGatewayTokens()
        }
    }

    fun dismissGatewayTokenSecret() {
        _uiState.update { it.copy(newGatewayTokenSecret = null) }
    }

    fun revokeGatewayToken(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(parityBusy = true, error = null) }
            val result = settingsRepository.revokeGatewayToken(id)
            _uiState.update {
                it.copy(
                    error = result.exceptionOrNull()?.message ?: it.error,
                    toastMessage = if (result.isSuccess) "Token revoked" else it.toastMessage,
                    parityBusy = false,
                )
            }
            loadGatewayTokens()
        }
    }

    // ── Codex plugins ───────────────────────────────────────────────────────

    fun loadCodexPlugins() {
        viewModelScope.launch {
            _uiState.update { it.copy(parityBusy = true) }
            val plugins = settingsRepository.getCodexPlugins().getOrNull()
            _uiState.update { it.copy(codexPlugins = plugins.orEmpty(), parityBusy = false) }
        }
    }

    /** Server-side this is admin-only; a non-admin gets a 403 surfaced as an error. */
    fun installCodexPlugin(pluginName: String, marketplaceId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(parityBusy = true, error = null) }
            val result = settingsRepository.installCodexPlugin(pluginName, marketplaceId)
            _uiState.update {
                it.copy(
                    error = result.exceptionOrNull()?.message ?: it.error,
                    toastMessage = if (result.isSuccess) "Plugin installed" else it.toastMessage,
                    parityBusy = false,
                )
            }
            loadCodexPlugins()
        }
    }

    // ── Subagent layer ──────────────────────────────────────────────────────

    fun loadSubagents() {
        viewModelScope.launch {
            _uiState.update { it.copy(subagentBusy = true) }
            val upstreams = settingsRepository.getSubagentUpstreams().getOrNull()
            val groups = settingsRepository.getSubagentModels().getOrNull()
            val entries = settingsRepository.getCliSubagents().getOrNull()
            _uiState.update {
                it.copy(
                    subagentUpstreams = upstreams ?: it.subagentUpstreams,
                    subagentModelGroups = groups ?: it.subagentModelGroups,
                    cliSubagents = entries ?: it.cliSubagents,
                    subagentBusy = false,
                )
            }
        }
    }

    /**
     * The list is replaced wholesale, so every existing upstream is sent back
     * by id without a token — that is what tells the server to keep the stored
     * one, since it never hands a token to a client.
     */
    fun addSubagentUpstream(label: String, baseUrl: String, authToken: String, models: String) {
        val cleanLabel = label.trim()
        val cleanUrl = baseUrl.trim().trimEnd('/')
        val cleanToken = authToken.trim()
        val modelList = models.split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }
        if (cleanLabel.isEmpty() || cleanUrl.isEmpty() || cleanToken.isEmpty() || modelList.isEmpty()) {
            _uiState.update { it.copy(error = "Label, endpoint, token and at least one model are required") }
            return
        }
        val next = _uiState.value.subagentUpstreams.map { it.toKeepInput() } +
            SaveSubagentUpstreamInput(
                label = cleanLabel,
                baseUrl = cleanUrl,
                authToken = cleanToken,
                models = modelList,
            )
        persistSubagentUpstreams(next, "Upstream added")
    }

    fun removeSubagentUpstream(id: String) {
        val next = _uiState.value.subagentUpstreams
            .filter { it.id != id }
            .map { it.toKeepInput() }
        persistSubagentUpstreams(next, "Upstream removed")
    }

    private fun SubagentUpstream.toKeepInput() = SaveSubagentUpstreamInput(
        id = id,
        label = label,
        baseUrl = baseUrl,
        authToken = null,
        models = models,
    )

    private fun persistSubagentUpstreams(next: List<SaveSubagentUpstreamInput>, toast: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(subagentBusy = true, error = null) }
            val result = settingsRepository.saveSubagentUpstreams(next)
            _uiState.update {
                it.copy(
                    subagentUpstreams = result.getOrNull() ?: it.subagentUpstreams,
                    error = result.exceptionOrNull()?.message ?: it.error,
                    toastMessage = if (result.isSuccess) toast else it.toastMessage,
                    subagentBusy = false,
                )
            }
            // The model picker groups follow the upstream list.
            if (result.isSuccess) {
                val groups = settingsRepository.getSubagentModels().getOrNull()
                if (groups != null) _uiState.update { it.copy(subagentModelGroups = groups) }
            }
        }
    }

    fun addCliSubagent(provider: String, label: String, model: String) {
        val entry = CliSubagentEntry(
            label = label.trim().ifEmpty { provider.replaceFirstChar { c -> c.uppercase() } },
            provider = provider,
            model = model.trim(),
            enabled = true,
        )
        persistCliSubagents(_uiState.value.cliSubagents + entry, "Subagent added")
    }

    fun setCliSubagentEnabled(id: String, enabled: Boolean) {
        val next = _uiState.value.cliSubagents.map {
            if (it.id == id) it.copy(enabled = enabled) else it
        }
        persistCliSubagents(next, null)
    }

    fun setCliSubagentModel(id: String, model: String) {
        val next = _uiState.value.cliSubagents.map {
            if (it.id == id) it.copy(model = model.trim()) else it
        }
        persistCliSubagents(next, "Model saved")
    }

    fun removeCliSubagent(id: String) {
        persistCliSubagents(_uiState.value.cliSubagents.filter { it.id != id }, "Subagent removed")
    }

    private fun persistCliSubagents(next: List<CliSubagentEntry>, toast: String?) {
        viewModelScope.launch {
            // Optimistic: the row reflects the tap immediately, and the server
            // response replaces it a moment later (new rows gain their id here).
            _uiState.update { it.copy(cliSubagents = next, subagentBusy = true, error = null) }
            val result = settingsRepository.saveCliSubagents(next)
            _uiState.update {
                it.copy(
                    cliSubagents = result.getOrNull() ?: it.cliSubagents,
                    error = result.exceptionOrNull()?.message ?: it.error,
                    toastMessage = if (result.isSuccess && toast != null) toast else it.toastMessage,
                    subagentBusy = false,
                )
            }
            if (result.isFailure) loadSubagents()
        }
    }

    fun setCodexPluginEnabled(id: String, enabled: Boolean) {
        viewModelScope.launch {
            _uiState.update { it.copy(parityBusy = true, error = null) }
            val result = settingsRepository.setCodexPluginEnabled(id, enabled)
            _uiState.update {
                it.copy(
                    error = result.exceptionOrNull()?.message ?: it.error,
                    parityBusy = false,
                )
            }
            loadCodexPlugins()
        }
    }

    fun refreshNotificationPermission() {
        LocalNotificationManager.onNotificationsPreferenceChanged()
        _uiState.update {
            it.copy(
                notificationsAllowedBySystem = NotificationPreferences.systemAllowsNotifications(context),
            )
        }
    }

    fun setBiometricEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC, enabled).apply()
        _uiState.update { it.copy(biometricEnabled = enabled) }
    }

    fun setSessionTimeout(minutes: Int) {
        prefs.edit().putInt(KEY_SESSION_TIMEOUT, minutes).apply()
        _uiState.update { it.copy(sessionTimeoutMinutes = minutes) }
    }

    // ── Providers ─────────────────────────────────────────────────────────────

    /**
     * Choose which model a CLI harness runs for new sessions.
     *
     * Merges into the existing per-provider map rather than replacing it, so
     * setting one provider's model doesn't clear the others.
     */
    fun setProviderModel(providerId: String, model: String) {
        viewModelScope.launch {
            val current = _uiState.value.userSettings?.cliProviderModels ?: emptyMap()
            val merged = current + (providerId.lowercase() to model)
            settingsRepository.updateSettings(cliProviderModels = merged)
                .onSuccess { settings ->
                    _uiState.update {
                        it.copy(userSettings = settings, toastMessage = "Model set to $model")
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun setProviderReasoning(providerId: String, reasoning: String) {
        viewModelScope.launch {
            val current = _uiState.value.userSettings?.cliProviderReasoning ?: emptyMap()
            val merged = current + (providerId.lowercase() to reasoning)
            settingsRepository.updateSettings(cliProviderReasoning = merged)
                .onSuccess { settings ->
                    _uiState.update {
                        it.copy(userSettings = settings, toastMessage = "Reasoning set to $reasoning")
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun setCodexWebSearch(mode: String) {
        viewModelScope.launch {
            settingsRepository.updateSettings(codexWebSearch = mode)
                .onSuccess { settings ->
                    _uiState.update {
                        it.copy(userSettings = settings, toastMessage = "Web search set to $mode")
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun setCodexFastTier(enabled: Boolean) {
        viewModelScope.launch {
            val current = _uiState.value.userSettings?.cliProviderServiceTiers ?: emptyMap()
            val merged = if (enabled) current + ("codex" to "fast") else current - "codex"
            settingsRepository.updateSettings(cliProviderServiceTiers = merged)
                .onSuccess { settings ->
                    _uiState.update {
                        it.copy(
                            userSettings = settings,
                            toastMessage = if (enabled) "Fast tier enabled" else "Default tier restored",
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun saveZaiApi(
        baseUrl: String,
        authToken: String,
        opusModel: String,
        sonnetModel: String,
        haikuModel: String,
    ) {
        _uiState.update { it.copy(zaiApiSaving = true, error = null) }
        viewModelScope.launch {
            settingsRepository.updateZaiApi(
                UpdateZaiApiInput(
                    baseUrl = baseUrl.trim(),
                    authToken = authToken.trim().takeIf { it.isNotBlank() },
                    opusModel = opusModel.trim().takeIf { it.isNotBlank() },
                    sonnetModel = sonnetModel.trim().takeIf { it.isNotBlank() },
                    haikuModel = haikuModel.trim().takeIf { it.isNotBlank() },
                ),
            ).onSuccess { status ->
                _uiState.update {
                    it.copy(zaiApi = status, zaiApiSaving = false, toastMessage = "Z.AI configuration saved")
                }
            }.onFailure { error ->
                _uiState.update { it.copy(zaiApiSaving = false, error = error.message) }
            }
        }
    }

    fun resetZaiApi() {
        _uiState.update { it.copy(zaiApiSaving = true, error = null) }
        viewModelScope.launch {
            settingsRepository.deleteZaiApi()
                .onSuccess {
                    _uiState.update {
                        it.copy(zaiApi = ZaiApiStatus(), zaiApiSaving = false, toastMessage = "Z.AI configuration removed")
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(zaiApiSaving = false, error = error.message) }
                }
        }
    }

    fun saveOpenCodeProvider(
        id: String,
        name: String,
        apiKey: String,
        baseUrl: String,
        enabled: Boolean,
    ) {
        _uiState.update { it.copy(openCodeSaving = true, error = null) }
        viewModelScope.launch {
            settingsRepository.saveOpenCodeProvider(
                SaveOpenCodeProviderInput(
                    id = id.trim(),
                    name = name.trim(),
                    apiKey = apiKey.trim().takeIf { it.isNotBlank() },
                    baseUrl = baseUrl.trim().takeIf { it.isNotBlank() },
                    enabled = enabled,
                ),
            ).onSuccess { provider ->
                _uiState.update { state ->
                    state.copy(
                        openCodeProviders = state.openCodeProviders
                            .filterNot { it.id == provider.id } + provider,
                        openCodeSaving = false,
                        toastMessage = "${provider.name} saved",
                    )
                }
            }.onFailure { error ->
                _uiState.update { it.copy(openCodeSaving = false, error = error.message) }
            }
        }
    }

    fun deleteOpenCodeProvider(id: String) {
        _uiState.update { it.copy(openCodeSaving = true, error = null) }
        viewModelScope.launch {
            settingsRepository.deleteOpenCodeProvider(id)
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            openCodeProviders = it.openCodeProviders.filterNot { provider -> provider.id == id },
                            openCodeSaving = false,
                            toastMessage = "OpenCode provider removed",
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(openCodeSaving = false, error = error.message) }
                }
        }
    }

    fun testOpenCodeProvider(id: String) {
        _uiState.update {
            it.copy(openCodeTestResults = it.openCodeTestResults + (id to TestResult.Testing))
        }
        viewModelScope.launch {
            settingsRepository.testOpenCodeProvider(id)
                .onSuccess { test ->
                    _uiState.update {
                        it.copy(
                            openCodeTestResults = it.openCodeTestResults + (
                                id to if (test.connected) TestResult.Success else TestResult.Failure(test.message)
                            ),
                            openCodeTestMessages = it.openCodeTestMessages + (id to test.message),
                        )
                    }
                }
                .onFailure { error ->
                    val message = error.message ?: "Test failed"
                    _uiState.update {
                        it.copy(
                            openCodeTestResults = it.openCodeTestResults + (id to TestResult.Failure(message)),
                            openCodeTestMessages = it.openCodeTestMessages + (id to message),
                        )
                    }
                }
        }
    }

    // ── MCP Servers ───────────────────────────────────────────────────────────

    fun addMcpServer(
        name: String,
        type: McpServerType,
        url: String?,
        command: String?,
        args: List<String>,
        env: Map<String, String>,
    ) {
        viewModelScope.launch {
            val input = CreateMcpServerInput(
                name = name,
                type = type,
                url = url?.takeIf { it.isNotBlank() },
                command = command?.takeIf { it.isNotBlank() },
                args = args.takeIf { it.isNotEmpty() },
                env = env.takeIf { it.isNotEmpty() },
                enabled = true,
            )
            settingsRepository.createMcpServer(input)
                .onSuccess { server ->
                    _uiState.update {
                        it.copy(
                            mcpServers = it.mcpServers + server,
                            toastMessage = "MCP server '${server.name}' added",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun updateMcpServer(
        id: String,
        name: String? = null,
        url: String? = null,
        command: String? = null,
        enabled: Boolean? = null,
    ) {
        viewModelScope.launch {
            val input = UpdateMcpServerInput(
                name = name,
                url = url,
                command = command,
                enabled = enabled,
            )
            settingsRepository.updateMcpServer(id, input)
                .onSuccess { updated ->
                    _uiState.update { state ->
                        state.copy(
                            mcpServers = state.mcpServers.map { if (it.id == id) updated else it },
                            toastMessage = "MCP server updated",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun deleteMcpServer(id: String) {
        viewModelScope.launch {
            settingsRepository.deleteMcpServer(id)
                .onSuccess {
                    _uiState.update { state ->
                        state.copy(
                            mcpServers = state.mcpServers.filter { it.id != id },
                            toastMessage = "MCP server removed",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    /**
     * Actually start the MCP server through the backend and report the result.
     *
     * This used to sleep 1.5s and then report success whenever the local
     * `enabled` flag was set, which meant the button said "Connected" without
     * ever contacting anything.
     */
    fun testMcpConnection(id: String) {
        _uiState.update { it.copy(mcpTestResults = it.mcpTestResults + (id to TestResult.Testing)) }
        viewModelScope.launch {
            val result = settingsRepository.testMcpServer(id).fold(
                onSuccess = { test ->
                    if (test.connected) TestResult.Success
                    else TestResult.Failure(test.error ?: "Server did not start")
                },
                onFailure = { error -> TestResult.Failure(error.message ?: "Test failed") },
            )
            _uiState.update { state ->
                state.copy(mcpTestResults = state.mcpTestResults + (id to result))
            }
        }
    }

    fun toggleMcpExpanded(id: String) {
        _uiState.update { state ->
            val expanded = state.expandedMcpIds.toMutableSet()
            if (id in expanded) expanded.remove(id) else expanded.add(id)
            state.copy(expandedMcpIds = expanded)
        }
    }

    // ── CLI Tools ─────────────────────────────────────────────────────────────

    fun toggleTool(id: String, enabled: Boolean) {
        _uiState.update { state ->
            val updated = state.cliTools.map { if (it.id == id) it.copy(enabled = enabled) else it }
            // Sync allowed tools to server settings
            val allowedTools = updated.filter { it.enabled }.map { it.name }
            state.copy(cliTools = updated)
        }
        syncAllowedTools()
    }

    fun setCliToolSearchQuery(query: String) {
        _uiState.update { it.copy(cliToolSearchQuery = query) }
    }

    private fun syncAllowedTools() {
        viewModelScope.launch {
            val allowedTools = _uiState.value.cliTools.filter { it.enabled }.map { it.name }
            settingsRepository.updateSettings(allowedTools = allowedTools)
        }
    }

    // ── Agents ────────────────────────────────────────────────────────────────

    fun addAgent(input: CreateCustomAgentInput) {
        viewModelScope.launch {
            settingsRepository.createAgent(input)
                .onSuccess { agent ->
                    _uiState.update { it.copy(agents = it.agents + agent, toastMessage = "Agent created") }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun updateAgent(id: String, input: UpdateCustomAgentInput) {
        viewModelScope.launch {
            settingsRepository.updateAgent(id, input)
                .onSuccess { updated ->
                    _uiState.update { state ->
                        state.copy(
                            agents = state.agents.map { if (it.id == id) updated else it },
                            toastMessage = "Agent updated",
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun deleteAgent(id: String) {
        viewModelScope.launch {
            settingsRepository.deleteAgent(id)
                .onSuccess {
                    _uiState.update { state ->
                        state.copy(
                            agents = state.agents.filter { it.id != id },
                            toastMessage = "Agent removed",
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun toggleAgent(id: String, enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.updateAgent(id, UpdateCustomAgentInput(enabled = enabled))
                .onSuccess { updated ->
                    _uiState.update { state ->
                        state.copy(agents = state.agents.map { if (it.id == id) updated else it })
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun duplicateAgent(agent: CustomAgent) {
        val copy = agent.copy(
            id = java.util.UUID.randomUUID().toString(),
            name = "${agent.name} (copy)",
        )
        _uiState.update { state ->
            state.copy(agents = state.agents + copy, toastMessage = "Agent duplicated")
        }
    }

    // ── CLI harness login ─────────────────────────────────────────────────────

    /**
     * Run the harness's own auth command on the server and follow it.
     *
     * There is no push channel for this, so the state is polled. Polling stops
     * as soon as the run finishes or the caller cancels — the job is held so a
     * second start can't leave two pollers running.
     */
    fun startCliLogin(providerId: String) {
        cliLoginJob?.cancel()
        _uiState.update { it.copy(cliLogin = null, cliLoginError = null, cliLoginProvider = providerId) }
        cliLoginJob = viewModelScope.launch {
            settingsRepository.startCliLogin(providerId)
                .onSuccess { session ->
                    _uiState.update { it.copy(cliLogin = session) }
                    pollCliLogin(session.id)
                }
                .onFailure { error ->
                    _uiState.update { it.copy(cliLoginError = error.message ?: "Login could not be started") }
                }
        }
    }

    private suspend fun pollCliLogin(id: String) {
        while (currentCoroutineContext().isActive) {
            delay(1500)
            val result = settingsRepository.pollCliLogin(id).getOrNull() ?: continue
            _uiState.update { it.copy(cliLogin = result) }
            if (result.isFinished) {
                // A completed login changes provider availability.
                if (result.status == "completed") loadSettings()
                return
            }
        }
    }

    fun submitCliLoginCode(code: String) {
        val id = _uiState.value.cliLogin?.id ?: return
        viewModelScope.launch {
            settingsRepository.submitCliLoginCode(id, code)
                .onSuccess { session -> _uiState.update { it.copy(cliLogin = session) } }
                .onFailure { error -> _uiState.update { it.copy(cliLoginError = error.message) } }
        }
    }

    fun cancelCliLogin() {
        val id = _uiState.value.cliLogin?.id
        cliLoginJob?.cancel()
        cliLoginJob = null
        viewModelScope.launch { id?.let { settingsRepository.cancelCliLogin(it) } }
        _uiState.update { it.copy(cliLogin = null, cliLoginProvider = null, cliLoginError = null) }
    }

    // ── Account ───────────────────────────────────────────────────────────────

    fun logout(onLoggedOut: () -> Unit) {
        viewModelScope.launch {
            authRepository.logout()
            onLoggedOut()
        }
    }

    fun clearCache(onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                context.cacheDir.deleteRecursively()
                _uiState.update { it.copy(cacheSize = "0 MB", toastMessage = "Cache cleared") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Failed to clear cache: ${e.message}") }
            }
            onDone()
        }
    }

    // ── Error / toast handling ────────────────────────────────────────────────

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearToast() {
        _uiState.update { it.copy(toastMessage = null) }
    }
}
