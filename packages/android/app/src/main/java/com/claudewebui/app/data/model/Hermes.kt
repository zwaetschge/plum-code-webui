package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/** `GET /api/hermes`: the Hermes Agent instances on the Unraid host. */
@Serializable
data class HermesStatus(
    /** Every Schwarm agent with its containers, Hermes gateway and update. */
    val agents: List<HermesAgent> = emptyList(),
    val instances: List<HermesInstance> = emptyList(),
    val latestTag: String? = null,
    val updateAvailable: Boolean = false,
    val autoUpdate: HermesAutoUpdate = HermesAutoUpdate(),
    val update: HermesUpdateRun = HermesUpdateRun(),
    val checkedAt: String? = null,
)

@Serializable
data class HermesInstance(
    val id: String,
    val label: String,
    /** Updated by the compose project's autoupdater, so also from Plum. */
    val managed: Boolean = false,
    val running: Boolean = false,
    val health: String? = null,
    val startedAt: String? = null,
    val tag: String? = null,
    val version: String? = null,
    val platforms: List<HermesPlatform> = emptyList(),
    val activeAgents: Int? = null,
) {
    /** "Hermes Agent v0.21.5 (2026.9.24) · …" → "v0.21.5". */
    val shortVersion: String
        get() = version?.let { Regex("v\\d+(?:\\.\\d+)+").find(it)?.value } ?: tag ?: "–"
}

@Serializable
data class HermesPlatform(
    val id: String,
    val state: String,
    val needsAttention: Boolean = false,
    val error: String? = null,
)

@Serializable
data class HermesAutoUpdate(val paused: Boolean = false, val reason: String? = null)

@Serializable
data class HermesUpdateRun(val running: Boolean = false, val log: List<String> = emptyList())

@Serializable
data class HermesAutoUpdateInput(val paused: Boolean)

@Serializable
data class HermesAgent(
    val id: String,
    val name: String,
    val group: String = "swarm",
    /** online, idle, offline, stopped, unknown (Schwarm directory). */
    val health: String = "unknown",
    val description: String? = null,
    val containers: List<HermesAgentContainer> = emptyList(),
    val hermes: HermesInstance? = null,
    val update: HermesAgentUpdate? = null,
) {
    val version: String? get() = hermes?.shortVersion
}

@Serializable
data class HermesAgentContainer(
    val name: String,
    val host: String? = null,
    val running: Boolean = false,
    val state: String = "",
    val status: String = "",
    val health: String = "",
    val image: String? = null,
    val actions: List<String> = emptyList(),
)

@Serializable
data class HermesAgentUpdate(
    /** hermes: new Hermes image; rebuild: rebuild the compose service. */
    val kind: String,
    val target: String? = null,
    val available: Boolean = false,
    val running: Boolean = false,
    val log: List<String> = emptyList(),
)
