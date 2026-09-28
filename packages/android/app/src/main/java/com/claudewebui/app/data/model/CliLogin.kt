package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * A CLI harness login run on the server.
 *
 * The server spawns the harness's own auth command and relays what it prints.
 * Depending on the provider this is either a device-code flow — open
 * [loginUrl], type [verificationCode] — or a prompt that wants a pasted code,
 * which is what `awaiting_code` signals.
 */
@Serializable
data class CliLoginSession(
    val id: String,
    val provider: String,
    val status: String,
    val loginUrl: String? = null,
    val verificationCode: String? = null,
    val output: String = "",
    val error: String? = null,
) {
    val isFinished: Boolean get() = status == "completed" || status == "error"
    val needsCode: Boolean get() = status == "awaiting_code"
}

@Serializable
data class CliLoginCodeInput(val code: String)

/**
 * `GET /api/cli-login/vibe/status` — where the Mistral Vibe credential lives.
 *
 * Deliberately carries no key material: the server answers with flags and the
 * *source* of the key (Vibe's own `.env`, the container environment, or
 * nowhere), so a stored secret can never reach a client or a log.
 */
@Serializable
data class VibeAuthStatus(
    val installed: Boolean = false,
    val authenticated: Boolean = false,
    /** One of `dot-env`, `process-env`, `none`. */
    val source: String = "none",
    /** Free-form label the ACP agent reports about its sign-in; may be absent. */
    val authState: String? = null,
) {
    /** Only a key in Vibe's own `.env` is ours to remove; the container's is not. */
    val canSignOut: Boolean get() = authenticated && source == "dot-env"
}

/** `POST /api/cli-login/vibe/key` — write-only, like every other secret input. */
@Serializable
data class VibeApiKeyInput(val apiKey: String)
