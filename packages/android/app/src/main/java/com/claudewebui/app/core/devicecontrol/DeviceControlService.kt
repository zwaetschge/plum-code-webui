package com.claudewebui.app.core.devicecontrol

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.R
import com.claudewebui.app.core.security.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Foreground service that pairs the phone with the Plum backend for device
 * control: holds a WebSocket to /ws/device-bridge, receives tool calls and
 * executes them through [DeviceControlAccessibilityService]. Started when the
 * accessibility service connects (the user's consent), stopped when it goes
 * away or when the user switches control off.
 */
class DeviceControlService : Service() {

    companion object {
        private const val CHANNEL_ID = "device_control"
        private const val NOTIFICATION_ID = 4101

        private val _connectionState = MutableStateFlow(false)
        /** Whether the bridge socket is connected right now. */
        val connected: StateFlow<Boolean> = _connectionState

        fun intent(context: Context): Intent = Intent(context, DeviceControlService::class.java)

        fun stop(context: Context) {
            context.stopService(Intent(context, DeviceControlService::class.java))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client by lazy {
        OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MINUTES)
            .build()
    }
    private var socket: WebSocket? = null
    private var stopped = false
    private var attempts = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!DeviceControlPrefs.isEnabled(this) || !DeviceControlAccessibilityService.isRunning) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (socket == null) connect()
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        socket?.close(1001, "service stopped")
        socket = null
        _connectionState.value = false
        scope.cancel()
        client.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    private fun startAsForeground() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.device_control_notification_title))
            .setContentText(getString(R.string.device_control_notification_text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        runCatching {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                } else {
                    0
                }
            )
        }
    }

    private fun wsUrl(): String? {
        val base = TokenStore.getServerUrl()?.trimEnd('/') ?: return null
        return when {
            base.startsWith("https://") -> "wss" + base.removePrefix("https")
            base.startsWith("http://") -> "ws" + base.removePrefix("http")
            else -> null
        }?.plus("/ws/device-bridge")
    }

    private fun connect() {
        val url = wsUrl()
        val token = TokenStore.getToken()
        if (url == null || token == null) {
            scheduleReconnect()
            return
        }
        val hello = JSONObject().apply {
            put("type", "hello")
            put("token", token)
            put("client", JSONObject().apply {
                put("kind", "android")
                put("label", Build.MODEL)
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("version", BuildConfig.VERSION_NAME)
                put("platform", "android ${Build.VERSION.RELEASE}")
            })
        }.toString()

        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempts = 0
                webSocket.send(hello)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleFrame(webSocket, text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (socket === webSocket) socket = null
                _connectionState.value = false
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (socket === webSocket) socket = null
                _connectionState.value = false
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (stopped) return
        attempts += 1
        val backoffMs = (5000L * attempts).coerceAtMost(60_000L)
        scope.launch {
            delay(backoffMs)
            if (!stopped && !DeviceControlAccessibilityService.isRunning) {
                stopSelf(); return@launch
            }
            if (!stopped && DeviceControlPrefs.isEnabled(this@DeviceControlService) && socket == null) {
                connect()
            }
        }
    }

    private fun handleFrame(webSocket: WebSocket, raw: String) {
        val frame = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (frame.optString("type")) {
            "welcome" -> _connectionState.value = true
            "call" -> {
                val id = frame.optString("id")
                scope.launch {
                    val reply = runTool(frame).let { toolResult ->
                        if (toolResult.startsWith("error:")) {
                            JSONObject().put("type", "result").put("id", id)
                                .put("ok", false).put("error", toolResult.removePrefix("error: "))
                        } else {
                            JSONObject().put("type", "result").put("id", id)
                                .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", toolResult)))
                        }
                    }
                    webSocket.send(reply.toString())
                }
            }
        }
    }

    /** Text result, an image content object, or an "error: …" string. */
    private fun runTool(frame: JSONObject): Any {
        val svc = DeviceControlAccessibilityService.instance
            ?: return "error: accessibility service is not running"
        val args = frame.optJSONObject("args") ?: JSONObject()
        return runCatching {
            runBlocking {
                when (frame.optString("tool")) {
                    "device_status" -> svc.status()
                    "read_screen" -> svc.readScreen(args.optInt("max", 220))
                    "tap" -> svc.tap(
                        args.optDouble("x").toFloat(),
                        args.optDouble("y").toFloat(),
                    )
                    "long_press" -> svc.tap(
                        args.optDouble("x").toFloat(),
                        args.optDouble("y").toFloat(),
                        holdMs = 700,
                    )
                    "swipe" -> svc.swipe(
                        args.optDouble("x1").toFloat(), args.optDouble("y1").toFloat(),
                        args.optDouble("x2").toFloat(), args.optDouble("y2").toFloat(),
                        args.optLong("duration", 300),
                    )
                    "scroll" -> {
                        val metrics = svc.resources.displayMetrics
                        val down = args.optString("direction", "down") == "down"
                        val amount = (metrics.heightPixels * args.optDouble("amount", 0.5)).toFloat()
                        val cx = metrics.widthPixels / 2f
                        if (down) svc.swipe(cx, metrics.heightPixels * 0.7f, cx, metrics.heightPixels * 0.7f - amount, 320)
                        else svc.swipe(cx, metrics.heightPixels * 0.3f, cx, metrics.heightPixels * 0.3f + amount, 320)
                    }
                    "type_text" -> svc.typeText(args.optString("text"))
                    "press" -> svc.press(args.optString("key"))
                    "open_app" -> svc.openApp(args.optString("package"))
                    "list_apps" -> svc.listApps()
                    "screenshot" -> {
                        val base64 = svc.screenshot(args.optDouble("scale", 0.6))
                        if (base64.startsWith("error:")) base64
                        else JSONObject().put("type", "image").put("data", base64).put("mimeType", "image/png")
                    }
                    else -> "error: unknown tool ${frame.optString("tool")}"
                }
            }
        }.getOrElse { "error: ${it.message ?: it.javaClass.simpleName}" }
    }

    private fun ensureChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.device_control_notification_title),
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = getString(R.string.device_control_notification_text) }
        )
    }
}
