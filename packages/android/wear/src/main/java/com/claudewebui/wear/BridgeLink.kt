package com.claudewebui.wear

import android.content.Context
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class BridgeException(message: String) : Exception(message)

/**
 * One authenticated socket to Plum's browser bridge — the protocol the browser
 * extension and the desktop companion speak (services/browserBridge/bridge.ts):
 * the token travels in the first `hello` frame, never in the URL; Plum answers
 * `welcome`, or `error`/UNAUTHORIZED and close 4401. Requests are `rpc` frames
 * answered by `rpcResult`; everything else the server pushes goes to
 * [onFrame]. Protocol pings from the server are answered by OkHttp, and the
 * client pings on its own so a dead Bluetooth proxy is noticed.
 */
class BridgeLink private constructor(
    private val socket: WebSocket,
    /** The endpoint path that accepted the token, remembered for the next connect. */
    val path: String,
) {
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Any?>>()
    private val counter = AtomicLong()

    /** Completes with the close code once the socket is gone (-1 on network failure). */
    val closed = CompletableDeferred<Int>()

    /** Pushed frames (`usage`, `notification`, …); runs on OkHttp's reader thread. */
    @Volatile var onFrame: (JSONObject) -> Unit = {}

    val isOpen: Boolean get() = !closed.isCompleted

    /** Sends one RPC and waits for its `rpcResult`; the result is the JSON `data` value. */
    suspend fun rpc(
        method: String,
        params: JSONObject = JSONObject(),
        timeoutMs: Long = RPC_TIMEOUT_MS,
    ): Any? {
        if (!isOpen) throw BridgeException(NOT_CONNECTED)
        val id = "w-${System.currentTimeMillis()}-${counter.incrementAndGet()}"
        val result = CompletableDeferred<Any?>()
        pending[id] = result
        val frame = JSONObject()
            .put("type", "rpc")
            .put("id", id)
            .put("method", method)
            .put("params", params)
        try {
            if (!socket.send(frame.toString())) throw BridgeException(NOT_CONNECTED)
            return withTimeout(timeoutMs) { result.await() }
        } catch (timeout: TimeoutCancellationException) {
            throw BridgeException("Plum antwortet nicht")
        } finally {
            pending.remove(id)
        }
    }

    fun send(frame: JSONObject): Boolean = isOpen && socket.send(frame.toString())

    fun close() {
        if (isOpen) socket.close(1000, "client disconnect")
        markClosed(1000)
    }

    private fun handle(frame: JSONObject) {
        if (frame.optString("type") == "rpcResult") {
            val waiting = pending.remove(frame.optString("id")) ?: return
            if (frame.optBoolean("ok", false)) {
                waiting.complete(frame.opt("data"))
            } else {
                waiting.completeExceptionally(
                    BridgeException(frame.text("error")?.takeIf { it.isNotBlank() } ?: "Fehler")
                )
            }
            return
        }
        runCatching { onFrame(frame) }
    }

    private fun markClosed(code: Int) {
        if (!closed.complete(code)) return
        val error = BridgeException(DISCONNECTED)
        pending.values.forEach { it.completeExceptionally(error) }
        pending.clear()
    }

    sealed interface Result {
        class Ok(val link: BridgeLink) : Result
        data object Unauthorized : Result
        class Failed(val detail: String) : Result
    }

    data class Endpoint(val path: String, val url: String)

    companion object {
        private const val HANDSHAKE_MS = 12_000L
        private const val RPC_TIMEOUT_MS = 35_000L
        private const val BRIDGE_PATH = "/api/browser-bridge/ws"
        private const val MOBILE_BRIDGE_PATH = "/mobile/api/browser-bridge/ws"
        private const val NOT_CONNECTED = "Nicht mit Plum verbunden"
        private const val DISCONNECTED = "Verbindung getrennt"

        fun newClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            // Frames may be minutes apart; liveness comes from the pings below.
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()

        /**
         * Endpoints to try, like the extension (shared.js plumSocketCandidates):
         * the address the phone uses first — usually the /mobile gateway, which
         * has no SSO wall — then the other one; the path that worked last
         * goes first.
         */
        fun endpoints(serverUrl: String, rememberedPath: String?): List<Endpoint> {
            val raw = serverUrl.trim().let { if ("://" in it) it else "https://$it" }
            val uri = runCatching { URI(raw) }.getOrNull() ?: return emptyList()
            val scheme = when (uri.scheme?.lowercase()) {
                "http", "ws" -> "ws"
                "https", "wss", null -> "wss"
                else -> return emptyList()
            }
            val host = uri.host ?: return emptyList()
            val authority = if (uri.port > 0) "$host:${uri.port}" else host
            var base = (uri.rawPath ?: "").trimEnd('/')
            val viaGateway = base == "/mobile" || base.endsWith("/mobile")
            if (viaGateway) base = base.removeSuffix("/mobile")
            val direct = "$base$BRIDGE_PATH"
            val gateway = "$base$MOBILE_BRIDGE_PATH"
            val paths = (if (viaGateway) listOf(gateway, direct) else listOf(direct, gateway))
                .toMutableList()
            if (rememberedPath != null && paths.remove(rememberedPath)) paths.add(0, rememberedPath)
            return paths.map { Endpoint(it, "$scheme://$authority$it") }
        }

        /** Tries every endpoint until one accepts the token; a refused token stops the search. */
        suspend fun connect(
            client: OkHttpClient,
            pairing: Pairing,
            hello: JSONObject,
            rememberedPath: String?,
        ): Result {
            var detail = "Server nicht erreichbar"
            for (endpoint in endpoints(pairing.serverUrl, rememberedPath)) {
                when (val outcome = attempt(client, endpoint, hello)) {
                    is Result.Ok, Result.Unauthorized -> return outcome
                    is Result.Failed -> detail = outcome.detail
                }
            }
            return Result.Failed(detail)
        }

        private suspend fun attempt(
            client: OkHttpClient,
            endpoint: Endpoint,
            hello: JSONObject,
        ): Result {
            val outcome = CompletableDeferred<Result>()
            val link = AtomicReference<BridgeLink?>()
            val listener = object : WebSocketListener() {
                @Volatile private var welcomed = false
                @Volatile private var closeCode = -1

                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(hello.toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val frame = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (welcomed) {
                        link.get()?.handle(frame)
                        return
                    }
                    when (frame.optString("type")) {
                        "welcome" -> {
                            welcomed = true
                            val established = BridgeLink(webSocket, endpoint.path)
                            link.set(established)
                            if (!outcome.complete(Result.Ok(established))) {
                                // The caller gave up (timeout, cancel) meanwhile.
                                established.close()
                            }
                        }
                        "error" -> outcome.complete(
                            if (frame.optString("code") == "UNAUTHORIZED") Result.Unauthorized
                            else Result.Failed(frame.text("message") ?: "Verbindung abgelehnt")
                        )
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    closeCode = code
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    finish(if (closeCode != -1) closeCode else code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    finish(if (closeCode != -1) closeCode else -1, t)
                }

                private fun finish(code: Int, error: Throwable? = null) {
                    if (welcomed) {
                        link.get()?.markClosed(code)
                        return
                    }
                    outcome.complete(
                        when {
                            code == 4401 -> Result.Unauthorized
                            error != null -> Result.Failed(describe(error))
                            else -> Result.Failed("Verbindung abgelehnt ($code)")
                        }
                    )
                }
            }
            val request = Request.Builder()
                .url(endpoint.url)
                .header("User-Agent", "PlumWear")
                .build()
            val socket = client.newWebSocket(request, listener)
            try {
                val result = withTimeoutOrNull(HANDSHAKE_MS) { outcome.await() }
                if (result == null) {
                    socket.cancel()
                    // A welcome racing the timeout still owns a link; release it.
                    link.get()?.close()
                    return Result.Failed("Zeitüberschreitung")
                }
                if (result !is Result.Ok) socket.cancel()
                return result
            } catch (cancelled: CancellationException) {
                socket.cancel()
                link.get()?.close()
                throw cancelled
            }
        }

        private fun describe(error: Throwable): String = when (error) {
            is java.net.UnknownHostException -> "Server nicht gefunden"
            is java.net.SocketTimeoutException -> "Zeitüberschreitung"
            is java.net.ConnectException -> "Server nicht erreichbar"
            is javax.net.ssl.SSLException -> "TLS-Fehler"
            else -> if (error.message?.contains("Expected HTTP 101") == true) {
                "Verbindung abgelehnt"
            } else {
                "Server nicht erreichbar"
            }
        }

        /** The first frame: the watch-scoped token plus who is connecting. */
        fun hello(context: Context, token: String): JSONObject {
            val app = context.applicationContext
            val version = runCatching {
                app.packageManager.getPackageInfo(app.packageName, 0).versionName
            }.getOrNull().orEmpty()
            val label = runCatching {
                Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME)
            }.getOrNull()?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
            return JSONObject()
                .put("type", "hello")
                .put("token", token)
                .put(
                    "client",
                    JSONObject()
                        .put("kind", "watch")
                        .put("name", "Uhr")
                        .put("version", version)
                        .put("platform", "Wear OS")
                        .put("label", label.take(80)),
                )
        }
    }
}
