package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * The two halves of the subagent layer, both previously WebUI-only.
 *
 * [SubagentUpstream] swaps the API endpoint underneath a Claude-transport
 * agent: an agent whose frontmatter names one of the listed models runs on
 * that upstream while the session's main agent stays on the subscription.
 *
 * [CliSubagentEntry] is cross-harness delegation: a whole other provider CLI
 * spawned as a one-shot worker through the `subagents` MCP tool. No secrets
 * live here — the spawned CLIs use their own shared logins. The exception is
 * `zai`, which runs the *Claude* CLI against the user's Z.AI endpoint, which
 * the backend injects at spawn time.
 */

@Serializable
data class CliSubagentEntry(
    val id: String = "",
    val label: String = "",
    /** One of codex, claude, zai, pi, vibe. */
    val provider: String = "codex",
    /** Optional override; Pi wants `provider/model`, zai a bare GLM id. */
    val model: String = "",
    val enabled: Boolean = true,
)

/**
 * A Pi model with the API it bills, from
 * GET /api/settings/cli-subagents/pi-models. One model family can sit on two
 * APIs (DeepSeek on its own key, or hosted by Mistral on the Mistral budget),
 * so the picker names the route.
 */
@Serializable
data class PiModelRoute(
    /** `provider/model`, the value stored as the entry's model. */
    val id: String = "",
    val provider: String = "",
    val model: String = "",
    /** `direct` or `hosted`. */
    val route: String = "direct",
)

@Serializable
data class SubagentUpstream(
    val id: String = "",
    val label: String = "",
    val baseUrl: String = "",
    val hasAuthToken: Boolean = false,
    val authTokenPreview: String = "",
    /** Exact model ids, or prefixes ending in `*` (e.g. `kimi-*`). */
    val models: List<String> = emptyList(),
)

/**
 * Saving never echoes a token back, so an entry sent without one means "keep
 * the stored token", matched by id — the same contract as the Z.AI settings.
 */
@Serializable
data class SaveSubagentUpstreamInput(
    val id: String? = null,
    val label: String,
    val baseUrl: String,
    val authToken: String? = null,
    val models: List<String>,
)

/** A picker group from /api/settings/subagent-models. */
@Serializable
data class SubagentModelGroup(
    val group: String = "",
    val models: List<String> = emptyList(),
)
