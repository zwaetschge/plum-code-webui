package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Models for the `/api/claude-config` routes — the on-disk skill, agent,
 * plugin and style catalogue that Plum actually ships to the CLI harnesses.
 *
 * These are distinct from [CustomAgent] (`/api/agents`), which only holds
 * user-authored agents stored in the WebUI database. The WebUI's
 * Settings → Extensions pane reads from these endpoints, so the mobile client
 * has to as well or every counter reads zero.
 */

@Serializable
data class ConfigSkill(
    val id: String,
    val name: String,
    val baseName: String? = null,
    val description: String = "",
    val dirPath: String? = null,
    val source: String = "user",
    val enabled: Boolean = false,
    val libraryKind: String = "skill",
    val entryType: String? = null,
    val aliases: List<String> = emptyList(),
    /** Writing presets: persona, author or prose. */
    val writingStyleType: String? = null,
    /** Design presets: DESIGN.md tokens used for the card preview. */
    val designMd: ConfigDesignMd? = null,
) {
    /** Name the session/chat APIs expect (directory name of the preset). */
    val presetKey: String get() = baseName ?: name
}

@Serializable
data class ConfigDesignMd(
    val name: String? = null,
    val tokens: ConfigDesignTokens = ConfigDesignTokens(),
)

@Serializable
data class ConfigDesignTokens(
    val colors: Map<String, String> = emptyMap(),
)

@Serializable
data class ConfigAgent(
    val id: String,
    val name: String,
    val description: String = "",
    val tools: List<String> = emptyList(),
    val model: String? = null,
    val filePath: String? = null,
    val source: String = "user",
    val enabled: Boolean = true,
)

@Serializable
data class ConfigPlugin(
    val id: String,
    val name: String,
    val description: String = "",
    val version: String? = null,
    val dirPath: String? = null,
    val source: String = "user",
    val enabled: Boolean = true,
    val marketplace: String? = null,
    val installedAt: String? = null,
)

@Serializable
data class StyleLibrary(
    val designStyles: List<ConfigSkill> = emptyList(),
    val writingStyles: List<ConfigSkill> = emptyList(),
)

@Serializable
data class SlashCommand(
    val name: String,
    val scope: String = "builtin",
    val description: String = "",
)

/**
 * What the `/toggle` routes answer.
 *
 * They flip the current state server-side and ignore any request body, so the
 * response is just the resulting flag — not the updated entity.
 */
@Serializable
data class ToggleResult(val enabled: Boolean)

/** Editable config-library entries share one mobile editor even though the
 * backend stores them in three different markdown shapes. */
enum class ConfigItemKind { AGENT, SKILL, PLUGIN }

data class ConfigDocument(
    val kind: ConfigItemKind,
    /** Existing on-disk key. Null means this is a new entry. */
    val key: String? = null,
    val name: String = "",
    val description: String = "",
    val content: String = "",
    val tools: List<String> = emptyList(),
    val model: String = "",
    val version: String = "1.0.0",
    val author: String = "",
    val category: String = "",
    val enabled: Boolean = true,
)

@Serializable
data class ConfigAgentContent(
    val name: String,
    val description: String = "",
    val tools: List<String> = emptyList(),
    val model: String? = null,
    val prompt: String = "",
    val enabled: Boolean = true,
)

@Serializable
data class ConfigSkillContent(
    val name: String,
    val description: String = "",
    val allowedTools: List<String> = emptyList(),
    val model: String? = null,
    val content: String = "",
    val enabled: Boolean = true,
)

@Serializable
data class ConfigPluginContent(
    val name: String,
    val description: String = "",
    val version: String = "1.0.0",
    val author: String? = null,
    val category: String? = null,
    val content: String = "",
    val enabled: Boolean = true,
)

@Serializable
data class SaveConfigAgentInput(
    val name: String,
    val description: String,
    val tools: List<String> = emptyList(),
    val model: String? = null,
    val prompt: String,
)

@Serializable
data class SaveConfigSkillInput(
    val name: String,
    val description: String,
    val allowedTools: List<String> = emptyList(),
    val model: String? = null,
    val content: String,
)

@Serializable
data class SaveConfigPluginInput(
    val name: String,
    val description: String,
    val version: String = "1.0.0",
    val author: String? = null,
    val category: String? = null,
    val content: String,
)

@Serializable
data class MarketplacePlugin(
    val name: String,
    val description: String = "",
    val version: String = "1.0.0",
    val category: String? = null,
)

@Serializable
data class MarketplaceSource(
    val source: String,
    val repo: String? = null,
    val url: String? = null,
)

@Serializable
data class ConfigMarketplace(
    val id: String,
    val name: String,
    val source: MarketplaceSource,
    val lastUpdated: String = "",
    val plugins: List<MarketplacePlugin> = emptyList(),
)

@Serializable
data class InstallPluginInput(
    val pluginName: String,
    val marketplaceId: String,
)

/** Which presentation preset slot a session-level style change targets. */
enum class StyleKind { DESIGN, WRITING }
