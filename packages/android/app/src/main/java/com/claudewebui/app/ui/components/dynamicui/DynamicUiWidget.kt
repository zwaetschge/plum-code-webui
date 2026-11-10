package com.claudewebui.app.ui.components.dynamicui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewRenderProcess
import android.webkit.WebViewRenderProcessClient
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.R
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.ui.components.chat.CodeBlock
import com.claudewebui.app.ui.motion.PlumMotionTokens
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.PlumPalette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Custom tiles (Dynamic UI v2.1, type `widget`): self-contained HTML/CSS/JS a
 * model wrote, run in `assets/dynamic-ui/ui-widget.html` (generated from
 * `packages/frontend/public/ui-widget.html`) inside a locked-down WebView.
 * Protocol and limits: `docs/plans/dynamic-ui-widgets-2026-11-07.md` §2/§4.
 *
 * Security model: the frame has no network (every request answers 403 and
 * network loads are blocked), no navigation, windows, dialogs, file/content
 * access or permissions. Its only way out is `PlumAndroid.postMessage(String)`;
 * every message is validated here and runs through the guards of the catalog
 * actions (busy/streaming, latest answer, https only). Actions that surface
 * UI or send something on the user's behalf also need a touch on the tile
 * within the last few seconds, so a tile cannot act on its own.
 */

private const val TAG = "DuiWidget"
/** Opaque https origin of every frame; the host answers its one document itself. */
private const val WIDGET_ORIGIN = "https://plum-widget.invalid"
private const val WIDGET_URL = "$WIDGET_ORIGIN/ui-widget.html"
private const val WIDGET_RUNTIME_ASSET = "dynamic-ui/ui-widget.html"
private const val WIDGET_BRIDGE = "PlumAndroid"
private val WIDGET_LANG = Regex("^[a-z]{2,3}$")
private val WIDGET_IMAGE_TYPES = setOf("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp")

internal object WidgetLimits {
    /** A bridge message longer than this is dropped before parsing. */
    const val MESSAGE_CHARS = 80_000
    /** plum.state as JSON (the runtime stops at 32 000; a little slack for formatting). */
    const val STATE_CHARS = 32_768
    const val TEXT = 2_000
    const val COPY = 20_000
    const val TITLE = 200
    const val ERROR = 300
    const val ERRORS = 3
    const val IMAGES = 24
    const val IMAGE_BYTES = 2 * 1024 * 1024
    const val SEND_INTERVAL_MS = 3_000L
    const val REFRESH_INTERVAL_MS = 5_000L
    /** How long after a touch on the tile it may still act for the user. */
    const val GESTURE_MS = 5_000L
    /**
     * No `ready` by then shows the fallback. Longer than the WebUI's 6 s: a cold
     * WebView starts its renderer first (measured 5–7 s on the build emulator).
     */
    const val READY_TIMEOUT_MS = 15_000L
    const val MIN_HEIGHT = 60
    const val MAX_HEIGHT = 900
    const val SKELETON_HEIGHT = 180
    /** Bridge calls per second before the rest are dropped (a tile looping on postMessage). */
    const val MESSAGES_PER_SECOND = 120
    /** Saved state is written at most this often; the latest value is flushed on dispose and on stop. */
    const val SAVE_DEBOUNCE_MS = 600L
}

// ── Protocol (pure, unit-tested) ────────────────────────────────────────────

/** A validated frame → host message. */
internal sealed interface WidgetMessage {
    data object Ready : WidgetMessage
    data object Rendered : WidgetMessage
    data class Height(val value: Int) : WidgetMessage
    data class State(val value: JsonObject) : WidgetMessage
    data class SendMessage(val text: String) : WidgetMessage
    data class Prefill(val text: String) : WidgetMessage
    data class Copy(val text: String) : WidgetMessage
    data class OpenUrl(val url: String) : WidgetMessage
    data class OpenEntity(val title: String, val lang: String?) : WidgetMessage
    data class Refresh(val name: String) : WidgetMessage
    data class Display(val fullscreen: Boolean) : WidgetMessage
    data class Image(val id: Long, val url: String) : WidgetMessage
    data class Error(val message: String) : WidgetMessage
}

/**
 * Parses and validates one bridge message; null for anything malformed,
 * oversized or unknown (ignored, like the WebUI host does).
 */
internal fun parseWidgetMessage(raw: String, liveNames: Set<String>): WidgetMessage? {
    if (raw.length > WidgetLimits.MESSAGE_CHARS) return null
    val json = runCatching { Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
    fun text(key: String, max: Int): String? = json[key].str()?.takeIf { it.length <= max && it.isNotBlank() }
    return when (json.string("plum")) {
        "ready" -> WidgetMessage.Ready
        "rendered" -> WidgetMessage.Rendered
        "height" -> json.number("value")?.takeIf { it.isFinite() && it >= 0 && it <= 100_000 }?.let { WidgetMessage.Height(ceil(it).toInt()) }
        "state" -> (json["value"] as? JsonObject)?.takeIf { it.toString().length <= WidgetLimits.STATE_CHARS }?.let { WidgetMessage.State(it) }
        "sendMessage" -> text("text", WidgetLimits.TEXT)?.trim()?.let { WidgetMessage.SendMessage(it) }
        "prefill" -> text("text", WidgetLimits.TEXT)?.let { WidgetMessage.Prefill(it) }
        "copy" -> text("text", WidgetLimits.COPY)?.let { WidgetMessage.Copy(it) }
        "openUrl" -> json.string("url")?.takeIf { isUiHttpsUrl(it) }?.let { WidgetMessage.OpenUrl(it) }
        "openEntity" -> {
            val title = text("title", WidgetLimits.TITLE)?.trim() ?: return null
            val lang = json["lang"]
            if (lang != null && lang !is JsonNull && !(lang.isStr() && WIDGET_LANG.matches(lang.str()!!))) return null
            WidgetMessage.OpenEntity(title, lang.str())
        }
        "refresh" -> json.string("name")?.takeIf { it in liveNames }?.let { WidgetMessage.Refresh(it) }
        "display" -> when (json.string("value")) {
            "fullscreen" -> WidgetMessage.Display(true)
            "inline" -> WidgetMessage.Display(false)
            else -> null
        }
        "image" -> {
            val id = json.number("id")?.takeIf { it.isFinite() && it >= 0 && it <= 1e9 && it == floor(it) }?.toLong() ?: return null
            val url = json.string("url")?.takeIf { isUiHttpsUrl(it) } ?: return null
            WidgetMessage.Image(id, url)
        }
        "error" -> json.string("message")?.trim()?.takeIf { it.isNotEmpty() }?.let { WidgetMessage.Error(it.take(WidgetLimits.ERROR)) }
        else -> null
    }
}

/** Inline height in dp: the tile's own `height`, else the reported one clamped to 60..900; null while unknown. */
internal fun widgetInlineHeight(fixed: Int?, reported: Int?): Int? = fixed ?: reported?.coerceIn(WidgetLimits.MIN_HEIGHT, WidgetLimits.MAX_HEIGHT)

/** Whether a tile may send now; at most one message every 3 s across all tiles. */
internal fun widgetSendAllowed(now: Long, last: Long): Boolean = last == 0L || now - last >= WidgetLimits.SEND_INTERVAL_MS

/**
 * `plum.live` of a tile: per input name the envelope of `turn.uiResults["<id>__<name>"]`
 * (`{status, data?, error?, retryable?}`); missing or stale results are pending.
 */
internal fun widgetLive(node: JsonObject, results: Map<String, JsonObject>): JsonObject = buildJsonObject {
    for ((name, input) in uiWidgetLiveNodes(node)) {
        val type = input.string("type")
        val result = input.string("id")?.let { results[it] }?.let { UiLiveResult(it) }
            ?.takeIf { (it.type == null || it.type == type) && uiLiveKeysMatch(it.key, uiLiveKey(input)) }
        val status = result?.status?.takeIf { it == "resolved" || it == "failed" } ?: "pending"
        put(name, buildJsonObject {
            put("status", status)
            if (status == "resolved") result?.data?.let { put("data", it) }
            if (status == "failed") {
                result?.error?.let { put("error", it) }
                put("retryable", result?.retryable == true)
            }
        })
    }
}

/** CSS colour of a Compose colour; always with a dot as decimal separator. */
internal fun widgetCssColor(color: Color): String {
    val r = (color.red * 255).roundToInt()
    val g = (color.green * 255).roundToInt()
    val b = (color.blue * 255).roundToInt()
    return if (color.alpha >= 0.999f) String.format(Locale.ROOT, "#%02x%02x%02x", r, g, b)
    else String.format(Locale.ROOT, "rgba(%d, %d, %d, %.3f)", r, g, b, color.alpha)
}

/** `theme` of the render message: light/dark and the `--plum-*` variables from the Compose palette. */
internal fun widgetTheme(palette: PlumPalette): JsonObject {
    val light = palette.isLight
    val charts = chartColors(palette)
    val vars = linkedMapOf(
        "--plum-text" to palette.text,
        "--plum-muted" to palette.muted,
        "--plum-surface" to if (light) Color.White.copy(alpha = .78f) else palette.text.copy(alpha = .05f),
        "--plum-surface-2" to palette.text.copy(alpha = if (light) .06f else .08f),
        "--plum-border" to palette.duiEdge,
        "--plum-accent" to palette.accent,
        "--plum-accent-text" to if (light) Color.White else Color(0xFF1A0B2E),
        "--plum-good" to palette.duiPositive,
        "--plum-bad" to palette.duiNegative,
        "--plum-warn" to if (light) Color(0xFFB26A00) else palette.amber,
    )
    charts.forEachIndexed { index, color -> vars["--plum-chart-${index + 1}"] = color }
    return buildJsonObject {
        put("mode", if (light) "light" else "dark")
        put("vars", buildJsonObject {
            vars.forEach { (name, color) -> put(name, widgetCssColor(color)) }
            put("--plum-radius", "14px")
            put("--plum-font", "system-ui, Roboto, 'Noto Sans', sans-serif")
        })
    }
}

/** The one-time `render` message. */
internal fun widgetRenderMessage(node: JsonObject, state: JsonObject, live: JsonObject, theme: JsonObject, fullscreen: Boolean): JsonObject = buildJsonObject {
    put("plum", "render")
    put("html", node.string("html").orEmpty())
    put("props", node["props"] as? JsonObject ?: JsonObject(emptyMap()))
    put("live", live)
    put("state", state)
    put("theme", theme)
    put("display", if (fullscreen) "fullscreen" else "inline")
}

/** `window.__plumHost("<json>")`: the message travels as one JSON-encoded string literal. */
internal fun widgetHostScript(message: JsonObject): String {
    val literal = JsonPrimitive(message.toString()).toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return "window.__plumHost&&window.__plumHost($literal)"
}

// ── Shared guards and storage ───────────────────────────────────────────────

private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

/** Rate limits that span every tile of the app. */
private object WidgetGuards {
    private var lastSend = 0L

    fun trySend(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (!widgetSendAllowed(now, lastSend)) return false
        lastSend = now
        return true
    }
}

/**
 * A tile's `plum.state`, persisted with the Dynamic UI store under
 * `turnId:nodeId` (in memory only without a message key). Writes are
 * debounced: timers save often, the store keeps every tile of the history.
 */
internal class WidgetMemory(private val key: String?, private val initial: JsonObject?) {
    private var cached: JsonObject? = null
    private var pending: JsonObject? = null
    private val flushTask = Runnable { flush() }

    fun load(): JsonObject = cached ?: key?.let { DynamicUiMemory.read(it) } ?: initial ?: JsonObject(emptyMap())

    fun save(value: JsonObject) {
        cached = value
        if (key == null) return
        val idle = pending == null
        pending = value
        if (idle) mainHandler.postDelayed(flushTask, WidgetLimits.SAVE_DEBOUNCE_MS)
    }

    fun flush() {
        mainHandler.removeCallbacks(flushTask)
        val value = pending ?: return
        pending = null
        key?.let { DynamicUiMemory.write(it, value) }
    }
}

@Volatile private var runtimeHtml: String? = null

private fun widgetRuntime(context: Context): String =
    runtimeHtml ?: context.assets.open(WIDGET_RUNTIME_ASSET).bufferedReader(Charsets.UTF_8).use { it.readText() }.also { runtimeHtml = it }

// ── Images (through the authenticated proxy, answered as data: URLs) ────────

private val widgetHttp by lazy {
    okhttp3.OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
}

/** Loads an https image through `/api/assistant/ui/image` (≤ 2 MB, an image type) as a data URL. */
private suspend fun loadWidgetImage(src: String): String = withContext(Dispatchers.IO) {
    val url = uiImageProxyUrl(src) ?: error("Bild nicht verfügbar")
    val request = okhttp3.Request.Builder().url(url).apply { TokenStore.getToken()?.let { header("Authorization", "Bearer $it") } }.build()
    widgetHttp.newCall(request).execute().use { response ->
        if (!response.isSuccessful) error("Bild nicht verfügbar (${response.code})")
        val body = response.body ?: error("Bild nicht verfügbar")
        val type = body.contentType()?.let { "${it.type}/${it.subtype}".lowercase() }?.let { if (it == "image/jpg") "image/jpeg" else it }
        if (type !in WIDGET_IMAGE_TYPES) error("Kein unterstütztes Bildformat")
        if (body.contentLength() > WidgetLimits.IMAGE_BYTES) error("Bild grösser als 2 MB")
        val out = ByteArrayOutputStream()
        body.byteStream().use { input ->
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                if (out.size() > WidgetLimits.IMAGE_BYTES) error("Bild grösser als 2 MB")
            }
        }
        "data:$type;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}

/** Debug fixtures: a generated gradient instead of a network image. */
private fun demoWidgetImage(src: String): String {
    val hash = src.hashCode()
    val hue = (Math.floorMod(hash, 360)).toFloat()
    val bitmap = Bitmap.createBitmap(320, 200, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.shader = LinearGradient(0f, 0f, 320f, 200f, android.graphics.Color.HSVToColor(floatArrayOf(hue, .45f, .85f)), android.graphics.Color.HSVToColor(floatArrayOf((hue + 50f) % 360f, .55f, .55f)), Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, 320f, 200f, paint)
    paint.shader = null
    paint.color = android.graphics.Color.argb(150, 255, 255, 255)
    canvas.drawCircle(80f + Math.floorMod(hash, 160), 64f, 26f, paint)
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    bitmap.recycle()
    return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

// ── WebView ─────────────────────────────────────────────────────────────────

/** The only object a tile can reach: one method, everything else stays on the host side. */
private class WidgetBridge(private val deliver: (String) -> Unit) {
    @Volatile var closed = false
    private var windowStart = 0L
    private var windowCount = 0

    @JavascriptInterface
    fun postMessage(json: String?) {
        if (closed || json == null || json.length > WidgetLimits.MESSAGE_CHARS) return
        synchronized(this) {
            val now = SystemClock.elapsedRealtime()
            if (now - windowStart >= 1000) {
                windowStart = now
                windowCount = 0
            }
            if (++windowCount > WidgetLimits.MESSAGES_PER_SECOND) return
        }
        // JavaBridge thread → main thread; validation and actions run there.
        mainHandler.post { if (!closed) deliver(json) }
    }
}

/** One mounted frame: its WebView, bridge and per-frame counters. */
private class WidgetSession {
    var view: WebView? = null
    var bridge: WidgetBridge? = null
    var gone = false
    var renderSent = false
    var lastLive: String? = null
    var lastTheme: String? = null
    var lastInput = 0L
    var images = 0
    val refreshedAt = HashMap<String, Long>()

    /** True while a touch (or key press) on this tile is recent, or with touch exploration on. */
    fun userActive(context: Context): Boolean {
        val accessibility = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
        if (accessibility?.isTouchExplorationEnabled == true) return true
        return lastInput != 0L && SystemClock.elapsedRealtime() - lastInput <= WidgetLimits.GESTURE_MS
    }

    fun post(message: JsonObject) {
        val target = view ?: return
        if (gone) return
        if (BuildConfig.DEBUG) Log.d(TAG, "host → frame ${message.string("plum")}")
        target.evaluateJavascript(widgetHostScript(message), null)
    }

    fun release() {
        bridge?.closed = true
        val target = view ?: return
        view = null
        if (!gone) {
            target.removeJavascriptInterface(WIDGET_BRIDGE)
            target.stopLoading()
        }
        target.destroy()
    }
}

private fun blockedResponse() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
private fun createWidgetWebView(context: Context, session: WidgetSession, onMessage: (String) -> Unit, onGone: () -> Unit): WebView = WebView(context).apply {
    session.view = this
    setBackgroundColor(android.graphics.Color.TRANSPARENT)
    overScrollMode = View.OVER_SCROLL_NEVER
    isHorizontalScrollBarEnabled = false
    isHapticFeedbackEnabled = false
    // No text-selection action mode over a tile's controls.
    isLongClickable = false
    setOnLongClickListener { true }
    setOnTouchListener { _, event ->
        if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_UP) session.lastInput = SystemClock.elapsedRealtime()
        false
    }
    setOnKeyListener { _, keyCode, event ->
        if (event.action == KeyEvent.ACTION_UP && keyCode in setOf(KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_NUMPAD_ENTER)) session.lastInput = SystemClock.elapsedRealtime()
        false
    }
    settings.apply {
        javaScriptEnabled = true
        javaScriptCanOpenWindowsAutomatically = false
        setSupportMultipleWindows(false)
        domStorageEnabled = false
        @Suppress("DEPRECATION")
        databaseEnabled = false
        allowFileAccess = false
        allowContentAccess = false
        @Suppress("DEPRECATION")
        allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        allowUniversalAccessFromFileURLs = false
        setGeolocationEnabled(false)
        mediaPlaybackRequiresUserGesture = true
        cacheMode = WebSettings.LOAD_NO_CACHE
        // Nothing leaves the device, so there is nothing to check either.
        safeBrowsingEnabled = false
        setSupportZoom(false)
        builtInZoomControls = false
        displayZoomControls = false
        @Suppress("DEPRECATION")
        saveFormData = false
        if (Build.VERSION.SDK_INT in 29..32) {
            @Suppress("DEPRECATION")
            forceDark = WebSettings.FORCE_DARK_OFF
        }
    }
    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView, url: String?): Boolean = true

        // No network at all, fonts included: the runtime document comes from the
        // app's assets, every other request is answered with an empty 403.
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
            val url = request.url
            if (request.isForMainFrame && request.method == "GET" && url.scheme == "https" && url.host == "plum-widget.invalid" && url.path == "/ui-widget.html") {
                return WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(widgetRuntime(context).toByteArray(Charsets.UTF_8)))
            }
            if (BuildConfig.DEBUG) Log.d(TAG, "blocked ${request.method} ${url.scheme}://${url.host}${url.path}")
            return blockedResponse()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!BuildConfig.DEBUG || session.gone) return
            // Debug only: shows at once whether the runtime and the bridge came up.
            view.evaluateJavascript("[typeof window.PlumAndroid, typeof window.__plumHost, document.readyState].join()") { result ->
                Log.d(TAG, "page finished $url: $result, ready=${session.renderSent}")
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
            if (BuildConfig.DEBUG && request.isForMainFrame) Log.w(TAG, "main frame error ${error.errorCode} ${error.description}")
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Without this the crashed renderer would take the app with it.
            session.gone = true
            onGone()
            return true
        }
    }
    webChromeClient = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()
        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) { callback?.invoke(origin, false, false) }
        override fun onShowFileChooser(webView: WebView?, filePathCallback: ValueCallback<Array<android.net.Uri>>?, fileChooserParams: FileChooserParams?): Boolean {
            filePathCallback?.onReceiveValue(null)
            return true
        }
        // Like a sandboxed iframe without allow-modals: alert/confirm/prompt return at once.
        override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult): Boolean { result.cancel(); return true }
        override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult): Boolean { result.cancel(); return true }
        override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean { result.cancel(); return true }
        override fun onJsBeforeUnload(view: WebView?, url: String?, message: String?, result: JsResult): Boolean { result.confirm(); return true }
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) Log.d(TAG, "${message.messageLevel()} ${message.message()} (${message.lineNumber()})")
            return true
        }
        override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }
    if (Build.VERSION.SDK_INT >= 29) {
        // A tile stuck in a loop would freeze every WebView of the app; ending the
        // renderer turns that into onRenderProcessGone and the fallback.
        setWebViewRenderProcessClient(object : WebViewRenderProcessClient() {
            override fun onRenderProcessUnresponsive(view: WebView, renderer: WebViewRenderProcess?) { renderer?.terminate() }
            override fun onRenderProcessResponsive(view: WebView, renderer: WebViewRenderProcess?) = Unit
        })
    }
    val bridge = WidgetBridge(onMessage)
    session.bridge = bridge
    addJavascriptInterface(bridge, WIDGET_BRIDGE)
    loadUrl(WIDGET_URL)
}

// ── Compose ─────────────────────────────────────────────────────────────────

/** What a frame may ask of the tile around it; every call is already validated. */
private class WidgetActions(
    val sendMessage: (String) -> Unit,
    val prefill: (String) -> Unit,
    val copy: (String) -> Unit,
    val openUrl: (String) -> Unit,
    val openEntity: (String, String?) -> Unit,
    val refresh: (String) -> Unit,
    val display: (Boolean) -> Unit,
    val error: (String) -> Unit,
)

/** A custom tile: native card chrome around the sandboxed frame. */
@Composable
internal fun DuiWidget(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val id = node.string("id") ?: return
    val palette = ctx.palette
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val memory = remember(ctx.memoryKey, id, node["state"]) { WidgetMemory(ctx.memoryKey?.let { "$it:$id" }, node["state"] as? JsonObject) }
    DisposableEffect(memory) { onDispose { memory.flush() } }
    val live = remember(node, ctx.results) { widgetLive(node, ctx.results) }
    val theme = remember(palette) { widgetTheme(palette) }
    val title = node.string("title")
    val label = title ?: stringResource(R.string.dynamic_ui_widget_title)
    val fixed = node.number("height")?.toInt()
    var generation by remember { mutableIntStateOf(0) }
    var fullGeneration by remember { mutableIntStateOf(0) }
    var fullscreen by remember { mutableStateOf(false) }
    var closedAt by remember { mutableLongStateOf(0L) }
    var showCode by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var inlineHeight by remember { mutableIntStateOf(fixed ?: WidgetLimits.SKELETON_HEIGHT) }
    var overflowing by remember { mutableStateOf(false) }
    val errors = remember { mutableStateListOf<String>() }
    LaunchedEffect(copied) { if (copied) { delay(PlumMotionTokens.COPY_CONFIRM_MS); copied = false } }

    val actions = WidgetActions(
        sendMessage = { text -> if (!ctx.busy && ctx.host.latest && ctx.send != null && WidgetGuards.trySend()) ctx.send?.invoke(text) },
        prefill = { text -> ctx.host.onPrefill?.invoke(text) },
        copy = { text -> clipboard.setText(AnnotatedString(text)); copied = true },
        openUrl = { url -> openUiUrl(context, url) },
        openEntity = { entity, lang -> ctx.host.onOpenEntity?.invoke(entity, lang) },
        refresh = { name -> ctx.host.onRefresh?.invoke(uiWidgetLiveId(id, name)) },
        display = { full ->
            if (!full) fullscreen = false
            else if (!fullscreen && SystemClock.elapsedRealtime() - closedAt > 1_000) fullscreen = true
        },
        error = { message -> if (errors.size < WidgetLimits.ERRORS) errors += message },
    )
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (palette.isLight) Color.White.copy(alpha = .82f) else palette.text.copy(alpha = .045f))
            .border(1.dp, palette.duiEdge, shape),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                Modifier.weight(1f).semantics { heading() },
                style = if (title != null) MaterialTheme.typography.titleSmall else MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp, letterSpacing = .3.sp),
                fontWeight = FontWeight.SemiBold,
                color = if (title != null) palette.text else palette.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (copied) Row(Modifier.padding(end = 4.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Check, null, tint = palette.accent, modifier = Modifier.size(15.dp))
                Text(stringResource(R.string.dynamic_ui_copied), Modifier.padding(start = 4.dp), style = MaterialTheme.typography.labelMedium, color = palette.accent)
            }
            DuiToolButton(Icons.Outlined.OpenInFull, stringResource(R.string.dynamic_ui_widget_fullscreen), { fullscreen = true }, tint = if (overflowing) palette.accent else palette.muted)
            DuiToolButton(Icons.Outlined.RestartAlt, stringResource(R.string.dynamic_ui_widget_restart), { errors.clear(); generation++ })
            DuiToolButton(Icons.Outlined.Code, stringResource(R.string.dynamic_ui_widget_code), { showCode = true })
        }
        if (fullscreen) {
            // One live frame at a time: the inline one comes back from the saved state.
            Box(Modifier.fillMaxWidth().height(inlineHeight.dp), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.dynamic_ui_widget_in_fullscreen), style = MaterialTheme.typography.bodySmall, color = palette.muted)
            }
        } else androidx.compose.runtime.key(generation, node.string("html")) {
            WidgetFrame(
                node = node, memory = memory, live = live, theme = theme, fullscreen = false, actions = actions,
                onHeight = { shown, reported ->
                    inlineHeight = shown
                    overflowing = reported > shown
                },
                onRestart = { errors.clear(); generation++ },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (errors.isNotEmpty()) Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            errors.forEach { message ->
                Text(stringResource(R.string.dynamic_ui_widget_error, message), style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    if (fullscreen) DuiFullscreen(label, onDismiss = { fullscreen = false; closedAt = SystemClock.elapsedRealtime() }, scrollable = false) {
        androidx.compose.runtime.key(fullGeneration) {
            WidgetFrame(
                node = node, memory = memory, live = live, theme = theme, fullscreen = true, actions = actions,
                onHeight = { _, _ -> }, onRestart = { fullGeneration++ }, modifier = Modifier.fillMaxWidth().weight(1f),
            )
        }
    }
    if (showCode) DuiFullscreen(stringResource(R.string.dynamic_ui_widget_code_title), onDismiss = { showCode = false }) {
        CodeBlock(node.string("html").orEmpty(), "html", Modifier.fillMaxWidth())
    }
}

/** One sandboxed frame (inline or full screen), with its skeleton and fallback. */
@Composable
private fun WidgetFrame(
    node: JsonObject,
    memory: WidgetMemory,
    live: JsonObject,
    theme: JsonObject,
    fullscreen: Boolean,
    actions: WidgetActions,
    onHeight: (shown: Int, reported: Int) -> Unit,
    onRestart: () -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val reduce = reducedMotion()
    val scope = rememberCoroutineScope()
    val demoImages = LocalDuiDemoImages.current
    val currentActions by rememberUpdatedState(actions)
    val currentOnHeight by rememberUpdatedState(onHeight)
    val liveNames = remember(node) { (node["live"] as? JsonObject)?.keys.orEmpty() }
    val fixed = node.number("height")?.toInt()
    val session = remember { WidgetSession() }
    // 0 loading, 1 rendered, 2 failed (no ready in time or the renderer ended)
    var phase by remember { mutableIntStateOf(0) }
    var reported by remember { mutableStateOf<Int?>(null) }
    val currentLive by rememberUpdatedState(live)
    val currentTheme by rememberUpdatedState(theme)
    val currentNode by rememberUpdatedState(node)
    val currentMemory by rememberUpdatedState(memory)

    fun handle(raw: String) {
        val message = parseWidgetMessage(raw, liveNames)
        if (BuildConfig.DEBUG) Log.d(TAG, "frame → host ${message?.let { it::class.simpleName } ?: "ignored"}")
        if (message == null) return
        when (message) {
            WidgetMessage.Ready -> if (!session.renderSent) {
                session.renderSent = true
                session.lastLive = currentLive.toString()
                session.lastTheme = currentTheme.toString()
                session.post(widgetRenderMessage(currentNode, currentMemory.load(), currentLive, currentTheme, fullscreen))
            }
            WidgetMessage.Rendered -> if (session.renderSent) phase = 1
            is WidgetMessage.Height -> {
                reported = message.value
                widgetInlineHeight(fixed, message.value)?.let { currentOnHeight(it, message.value) }
            }
            is WidgetMessage.State -> currentMemory.save(message.value)
            is WidgetMessage.SendMessage -> if (session.userActive(context)) currentActions.sendMessage(message.text)
            is WidgetMessage.Prefill -> if (session.userActive(context)) currentActions.prefill(message.text)
            is WidgetMessage.Copy -> if (session.userActive(context)) currentActions.copy(message.text)
            is WidgetMessage.OpenUrl -> if (session.userActive(context)) currentActions.openUrl(message.url)
            is WidgetMessage.OpenEntity -> if (session.userActive(context)) currentActions.openEntity(message.title, message.lang)
            is WidgetMessage.Display -> if (!message.fullscreen || session.userActive(context)) currentActions.display(message.fullscreen)
            is WidgetMessage.Refresh -> {
                val now = SystemClock.elapsedRealtime()
                val last = session.refreshedAt[message.name] ?: 0L
                if (last == 0L || now - last >= WidgetLimits.REFRESH_INTERVAL_MS) {
                    session.refreshedAt[message.name] = now
                    currentActions.refresh(message.name)
                }
            }
            is WidgetMessage.Image -> {
                if (session.images++ >= WidgetLimits.IMAGES) {
                    session.post(buildJsonObject { put("plum", "image"); put("id", message.id); put("error", "Höchstens ${WidgetLimits.IMAGES} Bilder") })
                    return
                }
                scope.launch {
                    val reply = runCatching { if (demoImages) withContext(Dispatchers.Default) { demoWidgetImage(message.url) } else loadWidgetImage(message.url) }
                    session.post(buildJsonObject {
                        put("plum", "image")
                        put("id", message.id)
                        reply.onSuccess { put("dataUrl", it) }.onFailure { put("error", (it.message ?: "Bild nicht verfügbar").take(200)) }
                    })
                }
            }
            is WidgetMessage.Error -> currentActions.error(message.message)
        }
    }

    LaunchedEffect(live) {
        if (!session.renderSent) return@LaunchedEffect
        val text = live.toString()
        if (text != session.lastLive) {
            session.lastLive = text
            session.post(buildJsonObject { put("plum", "live"); put("live", live) })
        }
    }
    LaunchedEffect(theme) {
        if (!session.renderSent) return@LaunchedEffect
        val text = theme.toString()
        if (text != session.lastTheme) {
            session.lastTheme = text
            session.post(buildJsonObject { put("plum", "theme"); put("theme", theme) })
        }
    }
    LaunchedEffect(Unit) {
        delay(WidgetLimits.READY_TIMEOUT_MS)
        // No ready: the frame never started. Ready but no rendered: show what is there.
        if (phase == 0) phase = if (session.renderSent) 1 else 2
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, session) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> if (!session.gone) session.view?.onResume()
                Lifecycle.Event.ON_STOP -> {
                    memory.flush()
                    if (!session.gone) session.view?.onPause()
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            memory.flush()
        }
    }

    if (phase == 2) {
        WidgetFallback(onRestart, Modifier.fillMaxWidth().then(if (fullscreen) Modifier.fillMaxSize() else Modifier.height((fixed ?: WidgetLimits.SKELETON_HEIGHT).dp)))
        return
    }
    // Starts at the 60 dp minimum: the runtime reports max(viewport, content), so a
    // taller start would hide shorter content and smaller is clamped to 60 anyway.
    val shown = widgetInlineHeight(fixed, reported)
    Box(modifier.then(if (fullscreen || reduce) Modifier else Modifier.animateContentSize(tween(DUI_ROW_MS, easing = DuiEase)))) {
        AndroidView(
            factory = { viewContext -> createWidgetWebView(viewContext, session, onMessage = { handle(it) }, onGone = { phase = 2 }) },
            onRelease = { session.release() },
            modifier = Modifier
                .fillMaxWidth()
                .then(if (fullscreen) Modifier.fillMaxSize() else Modifier.height((shown ?: WidgetLimits.MIN_HEIGHT).dp)),
        )
        if (phase == 0) WidgetSkeleton(
            Modifier.fillMaxWidth().then(if (fullscreen) Modifier.fillMaxSize() else Modifier.height((fixed ?: WidgetLimits.SKELETON_HEIGHT).dp)),
            stringResource(R.string.dynamic_ui_widget_loading),
        )
    }
}

/** Placeholder in the tile's final size while the frame starts. */
@Composable
private fun WidgetSkeleton(modifier: Modifier, description: String) {
    Column(
        modifier.padding(16.dp).semantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        DuiSkeletonLine(.42f, 14.dp)
        DuiSkeletonLine(.7f)
        DuiSkeleton(Modifier.fillMaxWidth().weight(1f, fill = true), RoundedCornerShape(12.dp))
    }
}

/** „Diese Kachel konnte nicht gestartet werden.“ with „Neu starten“. */
@Composable
private fun WidgetFallback(onRestart: () -> Unit, modifier: Modifier) {
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    Column(
        modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.dynamic_ui_widget_failed), style = MaterialTheme.typography.bodyMedium, color = palette.muted, textAlign = TextAlign.Center)
        OutlinedButton(onClick = onRestart) {
            Icon(Icons.Outlined.RestartAlt, null, Modifier.size(16.dp))
            Spacer(Modifier.size(6.dp))
            Text(stringResource(R.string.dynamic_ui_widget_restart))
        }
    }
}
