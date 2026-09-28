package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Theme {
    @SerialName("dark") DARK,
    @SerialName("light") LIGHT,
    @SerialName("system") SYSTEM,
    @SerialName("eink") EINK
}

@Serializable
enum class BackgroundAnimation {
    @SerialName("aurora") AURORA,
    @SerialName("glass") GLASS,
    @SerialName("ribbons") RIBBONS,
    @SerialName("still") STILL
}

@Serializable
enum class UiProvider {
    @SerialName("plum") PLUM,
    @SerialName("claude") CLAUDE,
    @SerialName("zai") ZAI,
    @SerialName("codex") CODEX,
    @SerialName("opencode") OPENCODE,
    @SerialName("pi") PI,
    @SerialName("kimi") KIMI,
    @SerialName("vibe") VIBE
}

@Serializable
data class UserSettings(
    val userId: String,
    val theme: Theme = Theme.DARK,
    val backgroundAnimation: BackgroundAnimation = BackgroundAnimation.AURORA,
    val defaultWorkingDir: String? = null,
    val allowedTools: List<String> = emptyList(),
    val customSystemPrompt: String? = null,
    val uiProvider: UiProvider? = null,
    val defaultCliProvider: CLIProvider? = null,
    val cliProviderModels: Map<String, String>? = null,
    val cliProviderModelLists: Map<String, List<String>>? = null,
    val cliProviderReasoning: Map<String, String>? = null,
    val cliProviderServiceTiers: Map<String, String>? = null,
    val codexWebSearch: String? = null,
    val localUsageBudgets: Map<String, LocalUsageBudget>? = null,
    /** Account-wide alert thresholds shared with the WebUI. */
    val usageAlerts: UsageAlertSettings? = null,
    /** When true the account theme wins over this device's local choice. */
    val appearanceSync: Boolean = false
)

@Serializable
data class UpdateSettingsInput(
    val theme: Theme? = null,
    val backgroundAnimation: BackgroundAnimation? = null,
    val appearanceSync: Boolean? = null,
    val defaultWorkingDir: String? = null,
    val allowedTools: List<String>? = null,
    val customSystemPrompt: String? = null,
    val uiProvider: UiProvider? = null,
    val defaultCliProvider: CLIProvider? = null,
    val cliProviderModels: Map<String, String>? = null,
    val cliProviderModelLists: Map<String, List<String>>? = null,
    val cliProviderReasoning: Map<String, String>? = null,
    val cliProviderServiceTiers: Map<String, String>? = null,
    val codexWebSearch: String? = null,
    val localUsageBudgets: Map<String, LocalUsageBudget>? = null,
    val usageAlerts: UsageAlertSettings? = null
)

@Serializable
data class LocalUsageBudget(
    val dailyUsd: Double? = null,
    val weeklyUsd: Double? = null
)

/** `GET /api/files/home` — the backend sends homeDir + path lists, nothing else. */
@Serializable
data class HomePaths(
    val homeDir: String = "",
    val allowedPaths: List<String> = emptyList(),
    val commonPaths: List<NamedPath> = emptyList()
)

@Serializable
data class NamedPath(
    val name: String = "",
    val path: String = ""
)

@Serializable
data class ZaiApiStatus(
    val configured: Boolean = false,
    val baseUrl: String = "",
    val hasAuthToken: Boolean = false,
    val authTokenPreview: String? = null,
    val opusModel: String = "",
    val sonnetModel: String = "",
    val haikuModel: String = "",
)

@Serializable
data class UpdateZaiApiInput(
    val baseUrl: String,
    val authToken: String? = null,
    val opusModel: String? = null,
    val sonnetModel: String? = null,
    val haikuModel: String? = null,
)
