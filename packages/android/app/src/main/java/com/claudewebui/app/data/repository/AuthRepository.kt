package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AuthUser
import com.claudewebui.app.data.model.BasicAuthLoginRequest
import com.claudewebui.app.data.model.LoginRequest

/**
 * Handles all authentication flows: basic auth, dev login, and OAuth.
 *
 * On successful login the JWT token and user ID are persisted to [TokenStore]
 * so that subsequent [ApiClient] calls are automatically authenticated.
 */
class AuthRepository(
    private val api: ApiClient,
    private val tokenStore: TokenStore
) {

    /**
     * Authenticate with username + password via the basic-auth endpoint.
     * Persists the returned JWT to [TokenStore].
     */
    suspend fun login(
        serverUrl: String,
        username: String,
        password: String
    ): Result<AuthUser> {
        return apiCall {
            // Store the server URL so ApiClient can build the correct base URL
            tokenStore.setServerUrl(serverUrl)

            val response = api.basicAuthLogin(BasicAuthLoginRequest(username, password))
            if (!response.success || response.data == null) {
                // Remove the URL we just stored on failure
                error(response.error?.message ?: "Login failed")
            }
            val loginResponse = response.data
            tokenStore.setToken(loginResponse.token)
            tokenStore.setUserId(loginResponse.user.id)
            loginResponse.user
        }
    }

    /**
     * Dev / anonymous login — only available on servers with dev mode enabled.
     */
    suspend fun devLogin(serverUrl: String): Result<AuthUser> {
        return apiCall {
            tokenStore.setServerUrl(serverUrl)

            val response = api.devLogin(LoginRequest())
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Dev login failed")
            }
            val loginResponse = response.data
            tokenStore.setToken(loginResponse.token)
            tokenStore.setUserId(loginResponse.user.id)
            loginResponse.user
        }
    }

    /**
     * OAuth provider login — the token is obtained outside of this app
     * (e.g. via a browser WebView or Custom Tab) and passed in here.
     */
    suspend fun loginOAuth(
        serverUrl: String,
        oauthToken: String
    ): Result<AuthUser> {
        return apiCall {
            tokenStore.setServerUrl(serverUrl)
            // Store the OAuth token as the session token
            tokenStore.setToken(oauthToken)

            // Verify the token is valid by fetching the current user
            val response = api.me()
            if (!response.success || response.data == null) {
                tokenStore.clearAll()
                error(response.error?.message ?: "OAuth login failed")
            }
            val user = response.data
            tokenStore.setUserId(user.id)
            user
        }
    }

    /**
     * Sign out — clears all credentials from [TokenStore] and notifies
     * the server to invalidate the session.
     */
    suspend fun logout(): Result<Unit> {
        return apiCall {
            // Best-effort server logout — don't fail if server is unreachable
            apiCall { api.logout() }
            tokenStore.clearAll()
        }
    }

    /** Returns true when a JWT token is currently stored. */
    fun isLoggedIn(): Boolean = tokenStore.isLoggedIn

    /**
     * Fetch the currently authenticated user from the server.
     * Returns a failure if the token is expired or the server is unreachable.
     */
    suspend fun getAuthUser(): Result<AuthUser> {
        return apiCall {
            val response = api.me()
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to fetch user")
            }
            response.data
        }
    }

    /**
     * Query which OAuth providers the target server has enabled.
     */
    suspend fun getAuthProviders(serverUrl: String) = apiCall {
        tokenStore.setServerUrl(serverUrl)
        val response = api.authProviders()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch providers")
        }
        response.data
    }
}
