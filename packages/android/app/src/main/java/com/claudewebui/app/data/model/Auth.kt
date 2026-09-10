package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class OAuthProvider {
    @SerialName("github") GITHUB,
    @SerialName("google") GOOGLE,
    @SerialName("claude") CLAUDE,
    @SerialName("codex") CODEX,
    @SerialName("zai") ZAI,
    @SerialName("dev") DEV,
    @SerialName("cli") CLI,
    @SerialName("proxy") PROXY
}

@Serializable
data class AuthUser(
    val id: String,
    val email: String,
    val name: String? = null,
    val avatarUrl: String? = null,
    val provider: OAuthProvider,
    val providerId: String,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class LoginRequest(
    val email: String = "dev@localhost",
    val name: String = "Dev User"
)

@Serializable
data class LoginResponse(
    val token: String,
    val user: AuthUser
)

/** `POST /auth/refresh` — a fresh JWT for the same identity. */
@Serializable
data class TokenRefreshResponse(
    val token: String,
    /** Epoch millis, or null when the server did not decode its own token. */
    val expiresAt: Long? = null,
)

@Serializable
data class AuthProviders(
    val github: Boolean = false,
    val google: Boolean = false,
    val claude: Boolean = false,
    val codex: Boolean = false,
    val opencode: Boolean = false,
    val pi: Boolean = false,
    val kimi: Boolean = false,
    val zai: Boolean = false,
    val proxy: Boolean = false,
)

@Serializable
data class BasicAuthLoginRequest(
    val username: String,
    val password: String
)

@Serializable
data class MobileAuthExchangeRequest(
    val code: String,
    val codeVerifier: String,
)
