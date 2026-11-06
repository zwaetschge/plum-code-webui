package com.claudewebui.wear

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.random.Random

/**
 * The watch's own line to Plum over the bridge socket. While the app is
 * visible ([start]/[stop]) it holds one connection, reconnects with the
 * extension's backoff (1 s doubling to 30 s, ±20 % jitter, reset on network
 * return) and keeps the StateFlows below current from RPCs and pushed
 * `usage`/`notification` frames. [refreshOnce] is the short-lived variant for
 * tile and complications.
 */
class PlumBridge private constructor(private val app: Context) {

    sealed interface Connection {
        data object Unpaired : Connection
        data object Connecting : Connection
        data object Connected : Connection
        data class Offline(val detail: String) : Connection
        /** Plum refused the token (revoked or expired): re-pair on the phone. */
        data object Unauthorized : Connection
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http by lazy { BridgeLink.newClient() }
    private val cached = BridgeCache.load(app)

    private val _connection = MutableStateFlow<Connection>(
        if (PairingStore.isPaired(app)) Connection.Offline("") else Connection.Unpaired
    )
    val connection: StateFlow<Connection> = _connection.asStateFlow()

    private val _usage = MutableStateFlow(cached.usage)
    val usage: StateFlow<List<UsageRow>> = _usage.asStateFlow()

    private val _usageAt = MutableStateFlow(cached.usageAt)
    val usageAt: StateFlow<Long> = _usageAt.asStateFlow()

    private val _approvals = MutableStateFlow(cached.approvals)
    val approvals: StateFlow<List<Approval>> = _approvals.asStateFlow()

    private val _sessions = MutableStateFlow(cached.sessions)
    val sessions: StateFlow<List<SessionRow>> = _sessions.asStateFlow()

    /** Last successful contact with Plum (local clock). */
    private val _syncedAt = MutableStateFlow(cached.syncedAt)
    val syncedAt: StateFlow<Long> = _syncedAt.asStateFlow()

    private val link = MutableStateFlow<BridgeLink?>(null)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var loopJob: Job? = null
    private var stopJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var usageReceivedAt = 0L

    // ── lifecycle (main thread) ─────────────────────────────────────────────

    /** Connect (or keep the connection) while the app UI is visible. */
    fun start() {
        stopJob?.cancel()
        stopJob = null
        if (loopJob?.isActive == true) {
            wake.trySend(Unit)
            return
        }
        loopJob = scope.launch { runLoop() }
        watchNetwork()
    }

    /**
     * Disconnect once the UI has been gone for a moment — long enough to
     * survive the voice-input activity in front of the app.
     */
    fun stop(graceMs: Long = 30_000) {
        stopJob?.cancel()
        stopJob = scope.launch(Dispatchers.Main) {
            delay(graceMs)
            shutdown()
        }
    }

    private fun shutdown() {
        loopJob?.cancel()
        loopJob = null
        link.value?.close()
        link.value = null
        unwatchNetwork()
        if (_connection.value is Connection.Connected || _connection.value is Connection.Connecting) {
            _connection.value = Connection.Offline("")
        }
    }

    private fun watchNetwork() {
        if (networkCallback != null) return
        val manager = app.getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Back online (Wi-Fi, LTE or the phone's Bluetooth proxy): retry now.
                if (_connection.value !is Connection.Connected) wake.trySend(Unit)
            }
        }
        if (runCatching { manager.registerDefaultNetworkCallback(callback) }.isSuccess) {
            networkCallback = callback
        }
    }

    private fun unwatchNetwork() {
        val callback = networkCallback ?: return
        networkCallback = null
        runCatching {
            app.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(callback)
        }
    }

    // ── connection loop ─────────────────────────────────────────────────────

    private suspend fun runLoop() {
        var retryMs = 1_000L
        while (currentCoroutineContext().isActive) {
            val pairing = PairingStore.load(app)
            if (pairing == null) {
                _connection.value = Connection.Unpaired
                PairingStore.flow(app).first { it != null }
                retryMs = 1_000L
                continue
            }
            _connection.value = Connection.Connecting
            // A wake-up that arrived before this attempt must not cut the next backoff short.
            wake.tryReceive()
            val result = BridgeLink.connect(
                http,
                pairing,
                BridgeLink.hello(app, pairing.token),
                PairingStore.wsPath(app),
            )
            when (result) {
                is BridgeLink.Result.Ok -> {
                    retryMs = 1_000L
                    val code = holdConnection(pairing, result.link)
                    if (code == 4401) {
                        awaitNewPairing(pairing)
                        continue
                    }
                    // Re-paired while connected: connect with the new token at once.
                    if (PairingStore.load(app) != pairing) continue
                    _connection.value = Connection.Offline("Verbindung getrennt")
                }
                BridgeLink.Result.Unauthorized -> {
                    awaitNewPairing(pairing)
                    continue
                }
                is BridgeLink.Result.Failed -> _connection.value = Connection.Offline(result.detail)
            }
            val delayMs = (retryMs * (0.8 + Random.nextDouble() * 0.4)).toLong()
            retryMs = (retryMs * 2).coerceAtMost(30_000L)
            val woken = withTimeoutOrNull(delayMs) { wake.receive() } != null
            if (woken) retryMs = 1_000L
        }
    }

    /** Runs one established connection until it closes; returns the close code. */
    private suspend fun holdConnection(pairing: Pairing, established: BridgeLink): Int {
        PairingStore.rememberWsPath(app, established.path)
        established.onFrame = { frame -> handlePush(established, frame) }
        link.value = established
        _connection.value = Connection.Connected
        try {
            return coroutineScope {
                val work = launch {
                    refreshAll(established)
                    pollUsage(established)
                }
                val repaired = launch {
                    PairingStore.flow(app).first { it != pairing }
                    established.close()
                }
                val code = established.closed.await()
                work.cancel()
                repaired.cancel()
                code
            }
        } finally {
            established.close()
            if (link.value === established) link.value = null
        }
    }

    private suspend fun awaitNewPairing(rejected: Pairing) {
        _connection.value = Connection.Unauthorized
        PairingStore.flow(app).first { it != rejected }
    }

    private fun handlePush(from: BridgeLink, frame: JSONObject) {
        when (frame.optString("type")) {
            "usage" -> {
                val rows = frame.optJSONArray("rows") ?: return
                usageReceivedAt = System.currentTimeMillis()
                applyUsage(rows, BridgeJson.time(frame.opt("at")) ?: usageReceivedAt)
                GlanceUpdates.request(app)
            }
            "notification" -> scope.launch {
                attempt { refreshApprovals(from) }
                GlanceUpdates.request(app)
            }
            // A watch never runs browser tools; answer instead of letting the call time out.
            "call" -> from.send(
                JSONObject()
                    .put("type", "result")
                    .put("id", frame.optString("id"))
                    .put("ok", false)
                    .put("error", "Die Uhr führt keine Browser-Aktionen aus.")
            )
            // usage-alert, event, control, rules, update …: phone and desktop handle those.
            else -> Unit
        }
    }

    // ── data ────────────────────────────────────────────────────────────────

    private suspend fun refreshAll(on: BridgeLink) {
        coroutineScope {
            launch { attempt { refreshUsage(on) } }
            launch { attempt { refreshApprovals(on) } }
            launch { attempt { refreshSessions(on) } }
        }
        GlanceUpdates.request(app)
    }

    /** Pushed frames replace polling; this only covers a server that stopped pushing. */
    private suspend fun pollUsage(on: BridgeLink) {
        while (true) {
            delay(60_000)
            if (System.currentTimeMillis() - usageReceivedAt >= USAGE_POLL_MS) {
                if (attempt { refreshUsage(on) }) GlanceUpdates.request(app)
            }
        }
    }

    private suspend fun refreshUsage(on: BridgeLink) {
        val rows = on.rpc("usage.limits") as? JSONArray ?: throw BridgeException("Unerwartete Antwort")
        usageReceivedAt = System.currentTimeMillis()
        applyUsage(rows, usageReceivedAt)
    }

    private suspend fun refreshApprovals(on: BridgeLink) {
        val items = on.rpc("approvals.list") as? JSONArray ?: throw BridgeException("Unerwartete Antwort")
        val now = System.currentTimeMillis()
        _approvals.value = BridgeJson.approvals(items)
        _syncedAt.value = now
        BridgeCache.saveApprovals(app, items, now)
    }

    private suspend fun refreshSessions(on: BridgeLink) {
        val rows = on.rpc("sessions.list") as? JSONArray ?: throw BridgeException("Unerwartete Antwort")
        val now = System.currentTimeMillis()
        _sessions.value = BridgeJson.sessions(rows)
        _syncedAt.value = now
        BridgeCache.saveSessions(app, rows, now)
    }

    private fun applyUsage(rows: JSONArray, at: Long) {
        val now = System.currentTimeMillis()
        _usage.value = BridgeJson.usageRows(rows)
        _usageAt.value = at
        _syncedAt.value = now
        BridgeCache.saveUsage(app, rows, at, now)
    }

    /** Drops what an unpaired watch must no longer show; the loop goes to Unpaired by itself. */
    fun forget() {
        _usage.value = emptyList()
        _usageAt.value = 0
        _approvals.value = emptyList()
        _sessions.value = emptyList()
        _syncedAt.value = 0
    }

    /** Reloads the session list in the background, e.g. when its page is shown. */
    fun refreshSessionsAsync() {
        val current = link.value ?: return
        scope.launch { attempt { refreshSessions(current) } }
    }

    fun refreshApprovalsAsync() {
        val current = link.value ?: return
        scope.launch {
            if (attempt { refreshApprovals(current) }) GlanceUpdates.request(app)
        }
    }

    // ── actions ─────────────────────────────────────────────────────────────

    /** [action]: allow_once, allow_project or deny. */
    suspend fun respondPermission(item: Approval.Permission, action: String): Result<Unit> =
        answer(
            item,
            "permission.respond",
            JSONObject()
                .put("sessionId", item.sessionId)
                .put("requestId", item.requestId)
                .put("action", action),
        )

    /** [option] null rejects the question. */
    suspend fun respondQuestion(item: Approval.Question, option: String?): Result<Unit> {
        val params = JSONObject().put("requestId", item.requestId)
        item.providerSessionId?.let { params.put("providerSessionId", it) }
        if (option != null) params.put("answers", JSONArray().put(JSONArray().put(option)))
        return answer(item, "question.respond", params)
    }

    private suspend fun answer(item: Approval, method: String, params: JSONObject): Result<Unit> {
        val current = awaitLink() ?: return Result.failure(BridgeException(NOT_CONNECTED))
        val outcome = try {
            current.rpc(method, params)
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
        if (outcome.isSuccess) {
            _approvals.update { list -> list.filterNot { it.requestId == item.requestId } }
        }
        // Either way the server's list is the truth (someone may have answered elsewhere).
        scope.launch {
            attempt { refreshApprovals(current) }
            GlanceUpdates.request(app)
        }
        return outcome
    }

    /**
     * Sends a chat message; the result is the server's send status
     * („queued“ while the agent is busy). The session's live events are not
     * needed on the watch, so its feed is closed right after.
     */
    suspend fun send(sessionId: String, message: String): Result<String> {
        val current = awaitLink() ?: return Result.failure(BridgeException(NOT_CONNECTED))
        return try {
            val ack = current.rpc(
                "chat.send",
                JSONObject()
                    .put("sessionId", sessionId)
                    .put("message", message)
                    .put("clientMessageId", "watch-${UUID.randomUUID()}"),
            ) as? JSONObject
            val status = ack?.text("status").orEmpty()
            if (status == "rejected") {
                Result.failure(BridgeException(ack?.text("error")?.takeIf { it.isNotBlank() } ?: "Abgelehnt"))
            } else {
                Result.success(status)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            scope.launch {
                attempt { current.rpc("chat.close", JSONObject().put("sessionId", sessionId)) }
                delay(1_500)
                attempt { refreshSessions(current) }
            }
        }
    }

    suspend fun interrupt(sessionId: String): Result<Unit> {
        val current = awaitLink() ?: return Result.failure(BridgeException(NOT_CONNECTED))
        return try {
            current.rpc("chat.interrupt", JSONObject().put("sessionId", sessionId))
            scope.launch {
                delay(1_500)
                attempt { refreshSessions(current) }
            }
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** The live connection, waiting briefly while it is (re)established. */
    private suspend fun awaitLink(): BridgeLink? =
        link.value?.takeIf { it.isOpen }
            ?: withTimeoutOrNull(15_000) { link.filterNotNull().first { it.isOpen } }

    // ── one-shot refresh for tile and complications ─────────────────────────

    private suspend fun refreshOnceInternal(): Boolean {
        BridgeCache.markAttempt(app)
        val pairing = PairingStore.load(app) ?: return false
        link.value?.takeIf { it.isOpen }?.let { live ->
            val ok = attempt { refreshUsage(live) } and attempt { refreshApprovals(live) }
            return ok
        }
        val result = BridgeLink.connect(
            http,
            pairing,
            BridgeLink.hello(app, pairing.token),
            PairingStore.wsPath(app),
        )
        return when (result) {
            is BridgeLink.Result.Ok -> {
                val once = result.link
                try {
                    PairingStore.rememberWsPath(app, once.path)
                    attempt { refreshUsage(once) } and attempt { refreshApprovals(once) }
                } finally {
                    once.close()
                }
            }
            BridgeLink.Result.Unauthorized -> {
                if (loopJob?.isActive != true) _connection.value = Connection.Unauthorized
                false
            }
            is BridgeLink.Result.Failed -> false
        }
    }

    companion object {
        private const val USAGE_POLL_MS = 5 * 60_000L
        private const val NOT_CONNECTED = "Nicht mit Plum verbunden"

        @Volatile private var instance: PlumBridge? = null

        fun get(context: Context): PlumBridge =
            instance ?: synchronized(this) {
                instance ?: PlumBridge(context.applicationContext).also { instance = it }
            }

        /**
         * Connect, fetch `usage.limits` and `approvals.list`, close — or reuse
         * the live connection when the app is open. Updates caches and flows.
         */
        suspend fun refreshOnce(context: Context): Boolean = get(context).refreshOnceInternal()
    }
}

/** Runs [block], turning failures (not cancellation) into false. */
private inline fun attempt(block: () -> Unit): Boolean = try {
    block()
    true
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    false
}
