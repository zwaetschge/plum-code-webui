package com.claudewebui.app.core.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure storage for authentication tokens and server configuration.
 * Uses [EncryptedSharedPreferences] backed by Android Keystore for at-rest encryption.
 *
 * Call [init] once during Application.onCreate() before accessing any properties.
 */
object TokenStore {

    private const val TAG = "TokenStore"

    private const val PREFS_NAME = "claude_webui_secure_prefs"
    private const val KEY_JWT_TOKEN = "jwt_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_MOBILE_AUTH_STATE = "mobile_auth_state"
    private const val KEY_MOBILE_AUTH_VERIFIER = "mobile_auth_verifier"

    /** Plain prefs for values that are not secrets. See [PLAIN_PREFS_NAME]. */
    private const val PLAIN_PREFS_NAME = "claude_webui_prefs"

    private lateinit var prefs: SharedPreferences
    private lateinit var plainPrefs: SharedPreferences

    /**
     * True when the encrypted store had to be reset because its keyset could no
     * longer be read. The UI uses this to say "an app update signed you out"
     * instead of silently showing first-run setup.
     */
    var wasResetOnStartup: Boolean = false
        private set

    /**
     * Initialize the stores. Must be called once at app startup.
     *
     * `EncryptedSharedPreferences` is bound to a key in the Android Keystore. If
     * that key becomes unreadable — which is what a debug reinstall does — every
     * read throws and the app looked, to itself, like a fresh install: the server
     * address was gone and the user landed on the setup screen with no
     * explanation. Two things guard against that now:
     *
     * 1. A failure resets the encrypted store instead of propagating, so the app
     *    starts rather than crashing or half-working.
     * 2. The server URL lives in plain prefs. It is not a secret — it is already
     *    stored unencrypted in `recent_servers` — so losing the keyset now costs
     *    a sign-in, not the connection setup.
     */
    fun init(context: Context) {
        plainPrefs = context.getSharedPreferences(PLAIN_PREFS_NAME, Context.MODE_PRIVATE)
        prefs = openEncrypted(context) ?: resetAndOpenEncrypted(context)
    }

    private fun openEncrypted(context: Context): SharedPreferences? = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val opened = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        // create() can succeed while the first read is what actually fails, so
        // touch it here rather than crashing later on an arbitrary screen.
        opened.getString(KEY_JWT_TOKEN, null)
        opened
    } catch (error: Throwable) {
        Log.w(TAG, "Encrypted preferences unreadable; resetting them", error)
        null
    }

    private fun resetAndOpenEncrypted(context: Context): SharedPreferences {
        wasResetOnStartup = true
        // Drop the unreadable payload so a fresh keyset can be generated.
        context.deleteSharedPreferences(PREFS_NAME)
        return openEncrypted(context)
            ?: throw IllegalStateException("Encrypted preferences unavailable after reset")
    }

    // --- JWT Token ---

    fun getToken(): String? = prefs.getString(KEY_JWT_TOKEN, null)

    fun setToken(token: String) {
        prefs.edit().putString(KEY_JWT_TOKEN, token).apply()
    }

    fun clearToken() {
        prefs.edit().remove(KEY_JWT_TOKEN).apply()
    }

    // --- Refresh Token ---

    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)

    fun setRefreshToken(token: String) {
        prefs.edit().putString(KEY_REFRESH_TOKEN, token).apply()
    }

    fun clearRefreshToken() {
        prefs.edit().remove(KEY_REFRESH_TOKEN).apply()
    }

    // --- Server URL (deliberately not encrypted; see init) ---

    fun getServerUrl(): String? {
        plainPrefs.getString(KEY_SERVER_URL, null)?.let { return it }
        // Carry over installations that stored it in the encrypted file.
        val legacy = runCatching { prefs.getString(KEY_SERVER_URL, null) }.getOrNull()
        if (legacy != null) plainPrefs.edit().putString(KEY_SERVER_URL, legacy).apply()
        return legacy
    }

    fun setServerUrl(url: String) {
        plainPrefs.edit().putString(KEY_SERVER_URL, url).apply()
    }

    // --- User ID ---

    fun getUserId(): String? = prefs.getString(KEY_USER_ID, null)

    fun setUserId(userId: String) {
        prefs.edit().putString(KEY_USER_ID, userId).apply()
    }

    // --- Pending mobile SSO handoff ---

    fun setPendingMobileAuth(state: String, verifier: String) {
        prefs.edit()
            .putString(KEY_MOBILE_AUTH_STATE, state)
            .putString(KEY_MOBILE_AUTH_VERIFIER, verifier)
            .apply()
    }

    fun getPendingMobileAuthState(): String? = prefs.getString(KEY_MOBILE_AUTH_STATE, null)

    fun getPendingMobileAuthVerifier(): String? = prefs.getString(KEY_MOBILE_AUTH_VERIFIER, null)

    fun clearPendingMobileAuth() {
        prefs.edit()
            .remove(KEY_MOBILE_AUTH_STATE)
            .remove(KEY_MOBILE_AUTH_VERIFIER)
            .apply()
    }

    // --- Convenience ---

    val isLoggedIn: Boolean
        get() = getToken() != null

    /**
     * Clear all stored credentials (logout).
     */
    fun clearAll() {
        prefs.edit()
            .remove(KEY_JWT_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_MOBILE_AUTH_STATE)
            .remove(KEY_MOBILE_AUTH_VERIFIER)
            .apply()
    }
}
