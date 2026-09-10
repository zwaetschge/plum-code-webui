package com.claudewebui.app.ui.screens.auth

import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.core.security.MobileAuthPkce
import com.claudewebui.app.data.model.BasicAuthLoginRequest
import com.claudewebui.app.data.model.LoginRequest
import com.claudewebui.app.data.model.MobileAuthExchangeRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val PREFS_NAME = "claude_webui_prefs"
private const val KEY_RECENT_SERVERS = "recent_servers"
private const val KEY_BIOMETRIC_ENABLED = "biometric_enabled"
private const val MAX_RECENT_SERVERS = 5

class LoginViewModel(
    private val apiClient: ApiClient,
    private val context: Context,
) : ViewModel() {

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ── UI State ──────────────────────────────────────────────────────────────

    private val _authState = MutableStateFlow<AuthState>(AuthState.Idle)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _recentServers = MutableStateFlow<List<String>>(emptyList())
    val recentServers: StateFlow<List<String>> = _recentServers.asStateFlow()

    private val _biometricEnabled = MutableStateFlow(false)
    val biometricEnabled: StateFlow<Boolean> = _biometricEnabled.asStateFlow()

    init {
        loadRecentServers()
        _biometricEnabled.value = prefs.getBoolean(KEY_BIOMETRIC_ENABLED, false)
    }

    // ── Connection ────────────────────────────────────────────────────────────

    /**
     * Test connectivity to the given server URL and fetch its auth config.
     * Normalizes the URL (adds https:// if no scheme present).
     */
    fun testConnection(rawUrl: String) {
        val url = normalizeUrl(rawUrl)
        if (url.isBlank()) {
            _authState.value = AuthState.Error(
                message = "Please enter a server URL",
                isConnectionError = true,
            )
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Connecting

            try {
                var selectedUrl: String? = null
                var lastStatus: Int? = null
                val candidates = listOfNotNull(url, mobileGatewayCandidate(url)).distinct()
                for (candidate in candidates) {
                    TokenStore.setServerUrl(candidate)
                    val healthResponse = apiCall { apiClient.health() }.getOrNull() ?: continue
                    lastStatus = healthResponse.status.value
                    if (healthResponse.status.value in 200..299) {
                        selectedUrl = candidate
                        break
                    }
                }

                val connectedUrl = selectedUrl
                if (connectedUrl == null) {
                    _authState.value = AuthState.Error(
                        message = lastStatus?.let { "Server returned $it. Is this the right URL?" }
                            ?: "Cannot reach server at $url. Check the URL and your network connection.",
                        isConnectionError = true,
                    )
                    return@launch
                }
                TokenStore.setServerUrl(connectedUrl)

                // Fetch which auth methods are available
                val providersResult = apiCall { apiClient.authProviders() }
                val providers = providersResult.getOrNull()?.data

                val authConfig = AuthConfig(
                    basicAuthEnabled = true, // Always try basic auth as fallback
                    googleOAuthEnabled = providers?.google ?: false,
                    githubOAuthEnabled = providers?.github ?: false,
                    claudeOAuthEnabled = providers?.claude ?: false,
                    proxyAuthEnabled = providers?.proxy ?: false,
                    devLoginEnabled = providers?.let { false } ?: true,
                )

                val serverInfo = ServerInfo(
                    url = connectedUrl,
                    name = "Plum Code WebUI",
                    reachable = true,
                )

                saveRecentServer(connectedUrl)

                _authState.value = AuthState.Connected(
                    serverInfo = serverInfo,
                    authConfig = authConfig,
                )
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    message = "Cannot reach server at $url. Check the URL and your network connection.",
                    isConnectionError = true,
                )
            }
        }
    }

    // ── Basic Auth ────────────────────────────────────────────────────────────

    fun loginBasicAuth(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            _authState.value = AuthState.Error("Username and password are required")
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            try {
                val response = apiClient.basicAuthLogin(
                    BasicAuthLoginRequest(username = username, password = password)
                )
                if (response.success && response.data != null) {
                    TokenStore.setToken(response.data.token)
                    TokenStore.setUserId(response.data.user.id)
                    _authState.value = AuthState.Authenticated(response.data.user)
                } else {
                    _authState.value = AuthState.Error(
                        message = response.error?.message
                            ?: "Invalid username or password"
                    )
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    message = e.screenErrorMessage("auth", "loginBasicAuth", context)
                )
            }
        }
    }

    // ── Dev Login ─────────────────────────────────────────────────────────────

    fun loginDev() {
        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            try {
                val response = apiClient.devLogin(LoginRequest())
                if (response.success && response.data != null) {
                    TokenStore.setToken(response.data.token)
                    TokenStore.setUserId(response.data.user.id)
                    _authState.value = AuthState.Authenticated(response.data.user)
                } else {
                    _authState.value = AuthState.Error(
                        message = response.error?.message ?: "Dev login failed"
                    )
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    message = e.screenErrorMessage("auth", "loginDev", context)
                )
            }
        }
    }

    // ── OAuth ─────────────────────────────────────────────────────────────────

    /**
     * Returns the OAuth redirect URL that the WebView / Custom Tab should open.
     * The actual token extraction happens in [handleOAuthCallback].
     */
    fun getOAuthUrl(provider: String): String {
        val serverUrl = TokenStore.getServerUrl() ?: return ""
        return "$serverUrl/auth/$provider"
    }

    fun beginProxyLogin(): String {
        val serverUrl = TokenStore.getServerUrl() ?: return ""
        val pending = MobileAuthPkce.create()
        TokenStore.setPendingMobileAuth(pending.state, pending.verifier)
        return Uri.parse("$serverUrl/auth/proxy/mobile")
            .buildUpon()
            .appendQueryParameter("state", pending.state)
            .appendQueryParameter("code_challenge", pending.challenge)
            .build()
            .toString()
    }

    fun handleMobileAuthCallback(callbackUri: String) {
        val uri = runCatching { Uri.parse(callbackUri) }.getOrNull() ?: return
        if (uri.scheme != "claudewebui" || uri.host != "auth" || uri.path != "/callback") return

        uri.getQueryParameter("error")?.let { error ->
            _authState.value = AuthState.Error("Authelia login failed: $error")
            return
        }

        val code = uri.getQueryParameter("code")
        val state = uri.getQueryParameter("state")
        val expectedState = TokenStore.getPendingMobileAuthState()
        val verifier = TokenStore.getPendingMobileAuthVerifier()
        if (code.isNullOrBlank() || state.isNullOrBlank() || verifier.isNullOrBlank() || state != expectedState) {
            _authState.value = AuthState.Error("Authelia login response is invalid or expired")
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            try {
                val response = apiClient.mobileAuthExchange(
                    MobileAuthExchangeRequest(code = code, codeVerifier = verifier)
                )
                if (response.success && response.data != null) {
                    TokenStore.setToken(response.data.token)
                    TokenStore.setUserId(response.data.user.id)
                    _authState.value = AuthState.Authenticated(response.data.user)
                } else {
                    _authState.value = AuthState.Error(
                        response.error?.message ?: "Authelia login response expired"
                    )
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    e.screenErrorMessage("auth", "handleMobileAuthCallback", context)
                )
            } finally {
                TokenStore.clearPendingMobileAuth()
            }
        }
    }

    /**
     * Called after OAuth WebView completes and a token is extracted from the redirect URL.
     */
    fun handleOAuthCallback(token: String) {
        if (token.isBlank()) {
            _authState.value = AuthState.Error("OAuth login failed — no token received")
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            TokenStore.setToken(token)
            try {
                val response = apiClient.me()
                if (response.success && response.data != null) {
                    TokenStore.setUserId(response.data.id)
                    _authState.value = AuthState.Authenticated(response.data)
                } else {
                    TokenStore.clearToken()
                    _authState.value = AuthState.Error(
                        message = response.error?.message ?: "Could not fetch user profile"
                    )
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                TokenStore.clearToken()
                _authState.value = AuthState.Error(e.screenErrorMessage("auth", "handleOAuthCallback", context))
            }
        }
    }

    // ── Session Check ─────────────────────────────────────────────────────────

    /**
     * Check whether a valid session already exists (app resume / cold start).
     * If yes → jump straight to Authenticated state.
     */
    fun checkExistingSession() {
        if (!TokenStore.isLoggedIn) return

        viewModelScope.launch {
            try {
                val response = apiClient.me()
                if (response.success && response.data != null) {
                    _authState.value = AuthState.Authenticated(response.data)
                } else {
                    TokenStore.clearAll()
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Network unavailable or token expired — stay on login screen
                TokenStore.clearAll()
            }
        }
    }

    // ── Biometric ─────────────────────────────────────────────────────────────

    fun setBiometricEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC_ENABLED, enabled).apply()
        _biometricEnabled.value = enabled
    }

    /** Called when biometric succeeds — restore session without re-entering credentials */
    fun onBiometricSuccess() {
        checkExistingSession()
    }

    // ── Recent Servers ────────────────────────────────────────────────────────

    private fun loadRecentServers() {
        val stored = prefs.getString(KEY_RECENT_SERVERS, "") ?: ""
        _recentServers.value = stored
            .split(",")
            .filter { it.isNotBlank() }
    }

    private fun saveRecentServer(url: String) {
        val current = _recentServers.value.toMutableList()
        current.remove(url)
        current.add(0, url)
        val trimmed = current.take(MAX_RECENT_SERVERS)
        _recentServers.value = trimmed
        prefs.edit().putString(KEY_RECENT_SERVERS, trimmed.joinToString(",")).apply()
    }

    fun removeRecentServer(url: String) {
        val updated = _recentServers.value.filter { it != url }
        _recentServers.value = updated
        prefs.edit().putString(KEY_RECENT_SERVERS, updated.joinToString(",")).apply()
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    fun resetToIdle() {
        _authState.value = AuthState.Idle
    }

    fun resetToConnected() {
        val current = _authState.value
        if (current is AuthState.Error) {
            // If we were connected before the error, go back to Connected
            val url = TokenStore.getServerUrl()
            if (url != null) {
                _authState.value = AuthState.Connecting
                testConnection(url)
            } else {
                _authState.value = AuthState.Idle
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun normalizeUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        val withScheme = when {
            trimmed.startsWith("http://", ignoreCase = true) ||
                trimmed.startsWith("https://", ignoreCase = true) -> trimmed
            trimmed.isNotBlank() -> "https://$trimmed"
            else -> return trimmed
        }
        // Several IMEs capitalise the first letter even with
        // KeyboardCapitalization.None, producing "https://Code.example.ch".
        // Scheme and host are case-insensitive, the path is not — so only the
        // authority is lowercased.
        val separator = withScheme.indexOf("://")
        if (separator < 0) return withScheme
        val afterScheme = separator + 3
        val pathStart = withScheme.indexOf('/', afterScheme)
        val authorityEnd = if (pathStart < 0) withScheme.length else pathStart
        return withScheme.substring(0, authorityEnd).lowercase() +
            withScheme.substring(authorityEnd)
    }

    private fun mobileGatewayCandidate(url: String): String? {
        val path = runCatching { Uri.parse(url).path.orEmpty().trimEnd('/') }.getOrDefault("")
        if (path.endsWith("/mobile")) return null
        return "$url/mobile"
    }
}
