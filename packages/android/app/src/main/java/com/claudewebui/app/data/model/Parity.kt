package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Models for surfaces that existed only in the WebUI: control-gateway tokens,
 * discovered projects, and the Codex plugin catalogue.
 */

@Serializable
data class GatewayToken(
    val id: String,
    val name: String = "",
    val tokenPrefix: String = "",
    /** "read" or "write"; read-only tokens are refused on any writing method. */
    val scope: String = "write",
    val revoked: Boolean = false,
    val lastUsedAt: String? = null,
    val createdAt: String = "",
    /** Returned once, on creation only. */
    val token: String? = null,
)

@Serializable
data class CreateGatewayTokenInput(val name: String, val scope: String = "write")

@Serializable
data class DiscoveredProject(
    val id: String,
    val name: String = "",
    val path: String = "",
    val claudeProjectPath: String = "",
    val hasSession: Boolean = false,
    val lastModified: String = "",
    val sessionFiles: List<String> = emptyList(),
)

@Serializable
data class CodexPlugin(
    val id: String = "",
    val name: String = "",
    val marketplace: String = "",
    val displayName: String = "",
    val description: String = "",
    val version: String = "",
    val author: String? = null,
    val category: String? = null,
    val enabled: Boolean = false,
    val installed: Boolean = false,
)

@Serializable
data class CodexPluginInstallInput(val pluginName: String, val marketplaceId: String)

@Serializable
data class CodexPluginToggleInput(val enabled: Boolean)

@Serializable
data class CrashReportInput(
    val platform: String = "android",
    val appVersion: String? = null,
    val osVersion: String? = null,
    val device: String? = null,
    val stackTrace: String,
    val occurredAt: String? = null,
)
