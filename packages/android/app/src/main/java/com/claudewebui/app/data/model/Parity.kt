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

/** Pairing token for the Plum Browser Firefox extension; opens only the browser bridge. */
@Serializable
data class BrowserToken(
    val id: String,
    val name: String = "",
    val tokenPrefix: String = "",
    /** "browser", or "watch" for a token this phone handed to its Wear OS watch. */
    val scope: String = "browser",
    val revoked: Boolean = false,
    val lastUsedAt: String? = null,
    val createdAt: String = "",
    /** Returned once, on creation only. */
    val token: String? = null,
)

@Serializable
data class CreateBrowserTokenInput(val name: String)

/**
 * POST /api/browser-bridge/watch-token — a watch-scope bridge token the phone
 * hands to its Wear OS watch over the Data Layer. [token] is returned only here.
 */
@Serializable
data class WatchToken(
    val id: String,
    val name: String = "",
    val token: String = "",
)

@Serializable
data class CreateWatchTokenInput(val name: String)

@Serializable
data class BrowserClientInfo(
    val kind: String = "browser",
    val platform: String = "",
    val name: String = "",
    val version: String = "",
    val extensionVersion: String = "",
    val label: String = "",
)

@Serializable
data class BrowserConnection(
    val id: String,
    val tokenName: String = "",
    val client: BrowserClientInfo = BrowserClientInfo(),
    val paused: Boolean = false,
    /** Plum Desktop: control, guide or paused. */
    val mode: String? = null,
    val recording: Boolean = false,
    val tabGroups: Boolean = false,
    val connectedAt: String = "",
    val lastSeenAt: String = "",
    val desktopActivity: DesktopActivity? = null,
)

@Serializable
data class DesktopScreen(val name: String = "", val width: Int = 0, val height: Int = 0, val primary: Boolean = false)

@Serializable
// All layout fields must be sent, including primary/floating/true: ApiHttp
// omits constructor defaults, but these are explicit updates to desktop state.
data class DesktopLayout(val chatScreen: String, val chatPlacement: String, val chatVisible: Boolean, val chatZoom: Int, val chatInsetTop: Int)

@Serializable
data class DesktopActivity(
    val sessionId: String = "", val sessionName: String = "Plum", val status: String = "Bereit",
    val action: String = "", val progress: String = "", val history: List<String> = emptyList(),
    val result: String = "", val resultTarget: String = "", val chat: String = "",
    val screens: List<DesktopScreen> = emptyList(), val layout: DesktopLayout? = null,
)

@Serializable
data class DesktopActionInput(val connectionId: String, val action: String, val message: String? = null, val layout: DesktopLayout? = null)

/** Plum Desktop per-app rule: block (no input, blacked out) or ask (confirm at the computer). */
@Serializable
data class DesktopRule(val match: String, val mode: String, val note: String? = null)

@Serializable
data class DesktopRulesInput(val rules: List<DesktopRule>)

@Serializable
data class DesktopModeInput(val mode: String, val connectionId: String? = null)

@Serializable
data class DesktopRecordInput(val action: String, val connectionId: String? = null)

@Serializable
data class DesktopInstallInput(val name: String)

@Serializable
data class DesktopInstall(val command: String = "", val expiresAt: String = "")

/** GET /api/browser-bridge/live/:sessionId — a picture of the session's browser tab. */
@Serializable
data class BrowserLiveImage(
    val data: String = "",
    val mimeType: String = "image/jpeg",
)

@Serializable
data class BrowserLiveFrame(
    val image: BrowserLiveImage? = null,
    val info: String? = null,
    val code: String? = null,
    val paused: Boolean = false,
    val at: String = "",
)

@Serializable
data class BrowserPauseInput(val paused: Boolean)

@Serializable
data class BrowserBridgeStatus(
    val connections: List<BrowserConnection> = emptyList(),
    val extensionAvailable: Boolean = false,
)

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
