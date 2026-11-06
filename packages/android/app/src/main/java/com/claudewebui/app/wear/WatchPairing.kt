package com.claudewebui.app.wear

import android.content.Context
import android.net.Uri
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttpException
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** A watch connected to this phone; [hasPlum] means the Plum Wear app answers the `plum_wear` capability. */
data class WatchNode(
    val id: String,
    val displayName: String,
    val nearby: Boolean,
    val hasPlum: Boolean,
)

/**
 * What this phone handed to its watch. The secret itself is not kept here: it
 * lives only in the Data Layer item and on the watch. [tokenId] lets
 * „Entkoppeln“ revoke it on the server.
 */
data class WatchPairingState(
    val tokenId: String,
    val nodeId: String,
    val nodeName: String,
    val issuedAt: Long,
)

/**
 * Hand-off of a watch-scope bridge token to the Wear OS app.
 *
 * The phone mints the token (POST /api/browser-bridge/watch-token) and puts one
 * urgent DataItem at [PATH_PAIRING] with the server URL the phone itself uses,
 * the token, its id and the issue time. The watch then talks to Plum over the
 * bridge WebSocket on its own. Deleting the item means unpaired. The phone has
 * one pairing at a time: the item is phone-wide, so pairing another watch
 * revokes the previous token first. [WearSync]'s snapshot keeps running as the
 * fallback while a watch is not paired.
 */
object WatchPairing {

    const val PATH_PAIRING = "/plum/watch-pairing"
    const val CAPABILITY = "plum_wear"

    const val KEY_SERVER_URL = "serverUrl"
    const val KEY_TOKEN = "token"
    const val KEY_TOKEN_ID = "tokenId"
    const val KEY_ISSUED_AT = "issuedAt"

    private const val PREFS = "plum_watch_pairing"
    private const val PREF_TOKEN_ID = "token_id"
    private const val PREF_NODE_ID = "node_id"
    private const val PREF_NODE_NAME = "node_name"
    private const val PREF_ISSUED_AT = "issued_at"
    private const val PREF_HINT_DISMISSED = "hint_dismissed"
    private const val TIMEOUT_S = 15L

    private val pairing = MutableStateFlow<WatchPairingState?>(null)
    private val hintDismissedFlow = MutableStateFlow(false)
    @Volatile private var loaded = false

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    private fun ensureLoaded(context: Context) {
        if (loaded) return
        val prefs = prefs(context)
        val tokenId = prefs.getString(PREF_TOKEN_ID, null)
        pairing.value = tokenId?.takeIf { it.isNotBlank() }?.let {
            WatchPairingState(
                tokenId = it,
                nodeId = prefs.getString(PREF_NODE_ID, null).orEmpty(),
                nodeName = prefs.getString(PREF_NODE_NAME, null).orEmpty(),
                issuedAt = prefs.getLong(PREF_ISSUED_AT, 0L),
            )
        }
        hintDismissedFlow.value = prefs.getBoolean(PREF_HINT_DISMISSED, false)
        loaded = true
    }

    /** The current pairing, live: Settings and the dashboard hint both follow it. */
    fun state(context: Context): StateFlow<WatchPairingState?> {
        ensureLoaded(context)
        return pairing.asStateFlow()
    }

    fun current(context: Context): WatchPairingState? {
        ensureLoaded(context)
        return pairing.value
    }

    /** Whether the user waved the dashboard hint away; it never comes back on its own. */
    fun hintDismissed(context: Context): StateFlow<Boolean> {
        ensureLoaded(context)
        return hintDismissedFlow.asStateFlow()
    }

    fun dismissHint(context: Context) {
        ensureLoaded(context)
        prefs(context).edit().putBoolean(PREF_HINT_DISMISSED, true).apply()
        hintDismissedFlow.value = true
    }

    /**
     * Watches connected right now, with whether each runs the Plum app. Empty
     * when Play Services or a watch is missing. Blocking calls run on IO.
     */
    suspend fun connectedWatches(context: Context): List<WatchNode> = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        runCatching {
            val nodes = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS)
            val withPlum = runCatching {
                Tasks.await(
                    Wearable.getCapabilityClient(app).getCapability(CAPABILITY, CapabilityClient.FILTER_REACHABLE),
                    5, TimeUnit.SECONDS,
                ).nodes.map { it.id }.toSet()
            }.getOrDefault(emptySet())
            nodes.map { node ->
                WatchNode(
                    id = node.id,
                    displayName = node.displayName.orEmpty().ifBlank { "Wear OS" },
                    nearby = node.isNearby,
                    hasPlum = node.id in withPlum,
                )
            }.sortedByDescending { it.hasPlum }
        }.getOrDefault(emptyList())
    }

    /**
     * Mint a watch token named „Uhr <watch>“ and hand it over. The server
     * already replaces an earlier token of the same name; a previous pairing of
     * another watch is revoked once the new item is in place, since it replaces
     * that one. If the Data Layer put fails, the fresh token is revoked again so
     * no unused credential stays valid (a pairing of another watch keeps working).
     */
    suspend fun pair(context: Context, api: ApiClient, node: WatchNode): WatchPairingState {
        val app = context.applicationContext
        val previous = current(app)
        val issued = api.createWatchToken("Uhr ${node.displayName}".take(80)).data
        if (issued == null || issued.token.isBlank()) error("The server returned no watch token")
        val issuedAt = System.currentTimeMillis()
        val serverUrl = api.baseUrl.trimEnd('/')
        try {
            withContext(Dispatchers.IO) {
                val request = PutDataMapRequest.create(PATH_PAIRING).apply {
                    dataMap.putString(KEY_SERVER_URL, serverUrl)
                    dataMap.putString(KEY_TOKEN, issued.token)
                    dataMap.putString(KEY_TOKEN_ID, issued.id)
                    dataMap.putLong(KEY_ISSUED_AT, issuedAt)
                }.asPutDataRequest().setUrgent()
                Tasks.await(Wearable.getDataClient(app).putDataItem(request), TIMEOUT_S, TimeUnit.SECONDS)
            }
        } catch (failure: Exception) {
            withContext(NonCancellable) { revokeQuietly(api, issued.id) }
            throw failure
        }
        val state = WatchPairingState(issued.id, node.id, node.displayName, issuedAt)
        save(app, state)
        if (previous != null && previous.tokenId != issued.id) revokeQuietly(api, previous.tokenId)
        return state
    }

    /**
     * Revoke the watch token on the server, then remove the item so the watch
     * forgets it. A token the server no longer knows (revoked in the WebUI)
     * counts as revoked; any other failure keeps the pairing so the user can
     * retry instead of leaving a live token behind.
     */
    suspend fun unpair(context: Context, api: ApiClient) {
        val app = context.applicationContext
        current(app)?.let { state ->
            try {
                api.revokeWatchToken(state.tokenId)
            } catch (failure: ApiHttpException) {
                if (failure.status != 404) throw failure
            }
        }
        withContext(Dispatchers.IO) {
            runCatching {
                Tasks.await(Wearable.getDataClient(app).deleteDataItems(pairingUri()), TIMEOUT_S, TimeUnit.SECONDS)
            }
        }
        save(app, null)
    }

    /** `wear:/plum/watch-pairing` — matches this path on every node. */
    private fun pairingUri(): Uri =
        Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(PATH_PAIRING).build()

    private suspend fun revokeQuietly(api: ApiClient, tokenId: String) {
        runCatching { api.revokeWatchToken(tokenId) }
    }

    private fun save(context: Context, state: WatchPairingState?) {
        ensureLoaded(context)
        val editor = prefs(context).edit()
        if (state == null) {
            editor.remove(PREF_TOKEN_ID).remove(PREF_NODE_ID).remove(PREF_NODE_NAME).remove(PREF_ISSUED_AT)
        } else {
            editor.putString(PREF_TOKEN_ID, state.tokenId)
                .putString(PREF_NODE_ID, state.nodeId)
                .putString(PREF_NODE_NAME, state.nodeName)
                .putLong(PREF_ISSUED_AT, state.issuedAt)
        }
        editor.apply()
        pairing.value = state
    }
}
