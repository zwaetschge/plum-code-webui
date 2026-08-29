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
    /** One of codex, claude, zai, opencode, pi. */
    val provider: String = "codex",
    /** Optional override; OpenCode wants `provider/model`, zai a bare GLM id. */
    val model: String = "",
    val enabled: Boolean = true,
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
