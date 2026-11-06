package com.claudewebui.wear

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.TimeUnit

/**
 * The watch-scoped bridge token the phone hands over once through the Data
 * Layer. [toString] leaves the secret out so the pairing can never end up in a
 * log line by accident.
 */
data class Pairing(
    val serverUrl: String,
    val token: String,
    val tokenId: String,
    val issuedAt: Long,
) {
    override fun toString(): String =
        "Pairing(serverUrl=$serverUrl, tokenId=$tokenId, issuedAt=$issuedAt)"
}

/**
 * Stores the pairing in EncryptedSharedPreferences (plain private prefs only
 * when the keystore refuses, e.g. after a restore onto other hardware) and
 * publishes it as a process-wide flow: the listener service writes, the
 * bridge and the UI react.
 */
object PairingStore {

    const val PATH_PAIRING = "/plum/watch-pairing"

    private const val SECURE_PREFS = "plum_pairing_secure"
    private const val FALLBACK_PREFS = "plum_pairing"
    private const val KEY_SERVER = "serverUrl"
    private const val KEY_TOKEN = "token"
    private const val KEY_TOKEN_ID = "tokenId"
    private const val KEY_ISSUED = "issuedAt"
    private const val KEY_WS_PATH = "wsPath"

    private val state = MutableStateFlow<Pairing?>(null)

    @Volatile private var loaded = false
    @Volatile private var prefsInstance: SharedPreferences? = null

    fun flow(context: Context): StateFlow<Pairing?> {
        ensureLoaded(context)
        return state.asStateFlow()
    }

    fun load(context: Context): Pairing? {
        ensureLoaded(context)
        return state.value
    }

    fun isPaired(context: Context): Boolean = load(context) != null

    /** Applies the phone's DataItem; an empty token or address means unpaired. */
    fun apply(context: Context, map: DataMap) {
        val serverUrl = map.getString(KEY_SERVER).orEmpty().trim().trimEnd('/')
        val token = map.getString(KEY_TOKEN).orEmpty().trim()
        if (serverUrl.isEmpty() || token.isEmpty()) {
            clear(context)
            return
        }
        val issuedAt = when (val raw = map.get<Any?>(KEY_ISSUED)) {
            is Number -> raw.toLong()
            is String -> raw.toLongOrNull() ?: 0L
            else -> 0L
        }
        save(context, Pairing(serverUrl, token, map.getString(KEY_TOKEN_ID).orEmpty(), issuedAt))
    }

    fun save(context: Context, pairing: Pairing) {
        ensureLoaded(context)
        val previous = state.value
        prefs(context).edit().apply {
            putString(KEY_SERVER, pairing.serverUrl)
            putString(KEY_TOKEN, pairing.token)
            putString(KEY_TOKEN_ID, pairing.tokenId)
            putLong(KEY_ISSUED, pairing.issuedAt)
            // A new token or server starts the endpoint search from scratch.
            if (previous == null || previous.serverUrl != pairing.serverUrl) remove(KEY_WS_PATH)
        }.commit()
        state.value = pairing
    }

    fun clear(context: Context) {
        ensureLoaded(context)
        prefs(context).edit().clear().commit()
        state.value = null
    }

    /** The bridge path that worked last ("/api/…" or "/mobile/api/…"). */
    fun wsPath(context: Context): String? = prefs(context).getString(KEY_WS_PATH, null)

    fun rememberWsPath(context: Context, path: String) {
        if (wsPath(context) != path) prefs(context).edit().putString(KEY_WS_PATH, path).apply()
    }

    /**
     * Re-reads the pairing DataItem the phone keeps in the Data Layer — the
     * listener only hears changes, so an app installed or updated after pairing
     * would otherwise never learn about it. A successful read without the item
     * means the phone unpaired. Blocking; background threads only.
     *
     * @return whether the watch is paired afterwards.
     */
    fun syncFromDataLayer(context: Context): Boolean {
        val app = context.applicationContext
        val found = runCatching {
            val items = Tasks.await(Wearable.getDataClient(app).dataItems, 5, TimeUnit.SECONDS)
            try {
                var map: DataMap? = null
                items.forEach { item ->
                    if (item.uri.path == PATH_PAIRING) map = DataMapItem.fromDataItem(item).dataMap
                }
                Result.success(map)
            } finally {
                items.release()
            }
        }.getOrElse { Result.failure(it) }
        found.onSuccess { map ->
            if (map != null) {
                apply(app, map)
            } else if (isPaired(app)) {
                clear(app)
            }
        }
        return isPaired(app)
    }

    private fun ensureLoaded(context: Context) {
        if (loaded) return
        synchronized(this) {
            if (loaded) return
            val prefs = prefs(context)
            val serverUrl = prefs.getString(KEY_SERVER, null)
            val token = prefs.getString(KEY_TOKEN, null)
            state.value = if (serverUrl.isNullOrBlank() || token.isNullOrBlank()) {
                null
            } else {
                Pairing(
                    serverUrl = serverUrl,
                    token = token,
                    tokenId = prefs.getString(KEY_TOKEN_ID, null).orEmpty(),
                    issuedAt = prefs.getLong(KEY_ISSUED, 0L),
                )
            }
            loaded = true
        }
    }

    private fun prefs(context: Context): SharedPreferences =
        prefsInstance ?: synchronized(this) {
            prefsInstance ?: open(context.applicationContext).also { prefsInstance = it }
        }

    private fun open(app: Context): SharedPreferences = runCatching {
        val key = MasterKey.Builder(app)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            app,
            SECURE_PREFS,
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrElse {
        app.getSharedPreferences(FALLBACK_PREFS, Context.MODE_PRIVATE)
    }
}
