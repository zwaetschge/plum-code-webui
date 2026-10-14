package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * A saved SSH host from `/api/connections`. The private key never leaves the
 * server: [keyConfigured] only reports whether one is stored.
 */
@Serializable
data class SshConnection(
    val id: String,
    val kind: String = "ssh",
    val name: String = "",
    val alias: String = "",
    val host: String = "",
    val port: Int = 22,
    val user: String = "",
    val jumpHost: String? = null,
    val tags: List<String> = emptyList(),
    val keySource: String = "file",
    val keyFile: String? = null,
    val keyConfigured: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = "",
)

/** Names of the private key files in the server's read-only `~/.ssh`. */
@Serializable
data class SshKeyFiles(
    val available: Boolean = false,
    val files: List<String> = emptyList(),
)

/**
 * Body for POST (create, `kind = "ssh"`) and PATCH (update) on
 * `/api/connections`. Null fields are omitted on the wire, so a PATCH only
 * touches what is set: an empty [privateKey] keeps the stored key, [clearKey]
 * removes it, and an empty [jumpHost] string clears the jump host.
 */
@Serializable
data class SshConnectionInput(
    val kind: String? = null,
    val name: String? = null,
    val alias: String? = null,
    val host: String? = null,
    val port: Int? = null,
    val user: String? = null,
    val jumpHost: String? = null,
    val tags: List<String>? = null,
    val keySource: String? = null,
    val keyFile: String? = null,
    val privateKey: String? = null,
    val clearKey: Boolean? = null,
)

/** Result of `POST /api/connections/:id/test`. */
@Serializable
data class SshConnectionTestResult(
    val ok: Boolean = false,
    val message: String = "",
    val durationMs: Double = 0.0,
)

/** SSH hosts attached to one session; [agentAccess] = false means the agent never sees them. */
@Serializable
data class SessionConnections(
    val connections: List<SshConnection> = emptyList(),
    val agentAccess: Boolean = true,
)

@Serializable
data class SetSessionConnectionsInput(val connectionIds: List<String>)
