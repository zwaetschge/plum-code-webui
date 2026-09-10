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
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_MOBILE_AUTH_STATE = "mobile_auth_state"
    private const val KEY_MOBILE_AUTH_VERIFIER = "mobile_auth_verifier"

    /** Plain prefs for values that are not secrets. See [PLAIN_PREFS_NAME]. */
    private const val PLAIN_PREFS_NAME = "claude_webui_prefs"

    private var prefs: SharedPreferences? = null
    private lateinit var plainPrefs: SharedPreferences

    /**
     * Where secrets go when the encrypted store cannot be opened at all. RAM
     * only: a token written to plain prefs would survive on disk and end up in
     * a device backup, which is exactly what the encrypted store exists to
     * prevent. The cost is that the emergency session ends with the process.
     */
    private val volatileSecrets = mutableMapOf<String, String>()

    /**
     * True when the encrypted store had to be reset because its keyset could no
     * longer be read. The UI uses this to say "an app update signed you out"
     * instead of silently showing first-run setup.
     */
    var wasResetOnStartup: Boolean = false
        private set

    /**
     * True when even a reset could not produce a usable encrypted store, so
     * secrets are being held in memory for this process only. The app still
     * runs and still knows its server address; the user signs in again on the
     * next launch.
     */
    var isEmergencyMode: Boolean = false
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
     * 2. If even that fails, secrets fall back to memory ([isEmergencyMode])
     *    rather than throwing out of `Application.onCreate` — a device whose
     *    Keystore is wedged got an unrecoverable crash loop before, with no way
     *    to reach the setup screen.
     * 3. The server URL lives in plain prefs. It is not a secret — it is already
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

    private fun resetAndOpenEncrypted(context: Context): SharedPreferences? {
        wasResetOnStartup = true
        // Drop the unreadable payload so a fresh keyset can be generated.
        context.deleteSharedPreferences(PREFS_NAME)
        val reopened = openEncrypted(context)
        if (reopened == null) {
            isEmergencyMode = true
            Log.e(TAG, "Encrypted preferences unavailable after reset; secrets kept in memory only")
        }
        return reopened
    }

    // --- Secret accessors ---
    // Every secret goes through these three so the in-memory fallback is not
    // something each call site has to remember.

    private fun secret(key: String): String? =
        prefs?.let { runCatching { it.getString(key, null) }.getOrNull() } ?: volatileSecrets[key]

    private fun putSecret(vararg entries: Pair<String, String>) {
        val store = prefs
        if (store == null) {
            entries.forEach { (key, value) -> volatileSecrets[key] = value }
            return
        }
        store.edit().apply { entries.forEach { (key, value) -> putString(key, value) } }.apply()
    }

    private fun removeSecret(vararg keys: String) {
        val store = prefs
        if (store == null) {
            keys.forEach { volatileSecrets.remove(it) }
            return
        }
        store.edit().apply { keys.forEach { remove(it) } }.apply()
    }

    // --- JWT Token ---

    fun getToken(): String? = secret(KEY_JWT_TOKEN)

    fun setToken(token: String) {
        putSecret(KEY_JWT_TOKEN to token)
    }

    fun clearToken() {
        removeSecret(KEY_JWT_TOKEN)
    }

    // --- Server URL (deliberately not encrypted; see init) ---

    fun getServerUrl(): String? {
        plainPrefs.getString(KEY_SERVER_URL, null)?.let { return it }
        // Carry over installations that stored it in the encrypted file.
        val legacy = secret(KEY_SERVER_URL)
        if (legacy != null) plainPrefs.edit().putString(KEY_SERVER_URL, legacy).apply()
        return legacy
    }

    fun setServerUrl(url: String) {
        plainPrefs.edit().putString(KEY_SERVER_URL, url).apply()
    }

    // --- User ID ---

    fun getUserId(): String? = secret(KEY_USER_ID)

    fun setUserId(userId: String) {
        putSecret(KEY_USER_ID to userId)
    }

    // --- Pending mobile SSO handoff ---

    fun setPendingMobileAuth(state: String, verifier: String) {
        putSecret(
            KEY_MOBILE_AUTH_STATE to state,
            KEY_MOBILE_AUTH_VERIFIER to verifier,
        )
    }

    fun getPendingMobileAuthState(): String? = secret(KEY_MOBILE_AUTH_STATE)

    fun getPendingMobileAuthVerifier(): String? = secret(KEY_MOBILE_AUTH_VERIFIER)

    fun clearPendingMobileAuth() {
        removeSecret(KEY_MOBILE_AUTH_STATE, KEY_MOBILE_AUTH_VERIFIER)
    }

    // --- Convenience ---

    val isLoggedIn: Boolean
        get() = getToken() != null

    /**
     * Clear all stored credentials (logout).
     */
    fun clearAll() {
        removeSecret(
            KEY_JWT_TOKEN,
            KEY_USER_ID,
            KEY_MOBILE_AUTH_STATE,
            KEY_MOBILE_AUTH_VERIFIER,
        )
    }
}
