package com.claudewebui.app.ui.screens.dashboard

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.*
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.*
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.view.doOnLayout
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.claudewebui.app.R
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.core.network.disposeWorkspaceHttpClient
import com.claudewebui.app.ui.theme.AppBackgroundStore
import com.claudewebui.app.ui.theme.AppThemeStore
import com.claudewebui.app.ui.theme.AppThemeOption
import com.claudewebui.app.ui.components.common.PlumBackdrop
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

/** The APK includes the same audited Plum frontend, without exposing the native token to external pages. */
@Composable
fun AssistantWebWorkspace(path: String, area: String, onAreaSelect: (String) -> Unit, onClose: () -> Unit, onPersonalize: () -> Unit, onNavigateToChat: (String) -> Unit, onNativeChat: () -> Unit, standaloneTitle: String? = null) {
    val owner = TokenStore.assistantOwnerKey() ?: return
    key(owner) { WebWorkspaceAccount(owner, path, area, onAreaSelect, onClose, onPersonalize, onNavigateToChat, onNativeChat, standaloneTitle) }
}

@Composable
private fun WebWorkspaceAccount(owner: String, path: String, area: String, onAreaSelect: (String) -> Unit, onClose: () -> Unit, onPersonalize: () -> Unit, onNavigateToChat: (String) -> Unit, onNativeChat: () -> Unit, standaloneTitle: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val alive = remember { AtomicBoolean(true) }
    val handler = remember { Handler(Looper.getMainLooper()) }
    val base = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
    val uri = remember(base) { URI(base) }
    val origin = "${uri.scheme}://${uri.rawAuthority}"
    val prefix = uri.rawPath.orEmpty().trimEnd('/')
    var webView by remember { mutableStateOf<WebView?>(null) }
    var nativePort by remember { mutableStateOf<WebMessagePort?>(null) }
    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<String?>(null) }
    var selectedFiles by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var permission by remember { mutableStateOf<PermissionRequest?>(null) }
    var download by remember { mutableStateOf<ByteArray?>(null) }
    val background by AppBackgroundStore.style.collectAsState()
    val themeOption by AppThemeStore.theme.collectAsState()
    val dark = isSystemInDarkTheme()
    val theme = when (themeOption) { AppThemeOption.EINK -> "eink"; AppThemeOption.LIGHT -> "light"; AppThemeOption.DARK -> "dark"; else -> if (dark) "dark" else "light" }
    fun current(): Boolean = alive.get() && TokenStore.assistantOwnerKey() == owner
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        selectedFiles?.onReceiveValue(if (current() && uris.isNotEmpty()) uris.toTypedArray() else null); selectedFiles = null
    }
    val permissionPicker = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val request = permission; permission = null
        if (!current() || request == null) request?.deny()
        else {
            val approved = request.resources.filter { resource -> when(resource) { PermissionRequest.RESOURCE_AUDIO_CAPTURE -> grants[Manifest.permission.RECORD_AUDIO] == true; PermissionRequest.RESOURCE_VIDEO_CAPTURE -> grants[Manifest.permission.CAMERA] == true; else -> false } }
            if (approved.isEmpty()) request.deny() else request.grant(approved.toTypedArray())
        }
    }
    val savePicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { target ->
        val bytes = download; download = null
        if (target != null && bytes != null && current()) scope.launch {
            try { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(target)?.use { it.write(bytes) } ?: kotlin.error("File unavailable") } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { if (current()) failure = error.message }
        }
    }
    val downloads = remember(owner) { object {
        fun logout() { handler.post { if (current()) { TokenStore.clearAll(); com.claudewebui.app.core.security.AuthEvents.notifySessionExpired() } } }
        fun offer(encoded: String, filename: String) {
            if (!current() || encoded.length > 44 * 1024 * 1024) return
            val bytes = runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull() ?: return
            if (bytes.size > 32 * 1024 * 1024) return
            handler.post { if (current() && download == null) { download = bytes; savePicker.launch(filename.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(180).ifBlank { "plum-export" }) } }
        }
    } }
    val client = remember { OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build() }
    fun bundledHtml(route: String): String {
        // TODO(security): the raw JWT is exposed to the page as
        // window.__PLUM_ANDROID__.token because the bundled frontend's Socket.IO
        // handshake (services/socket.ts) and auth store need it, and the native
        // shouldInterceptRequest proxy below can only authenticate HTTP(S)
        // resource requests — it cannot inject headers into the WebSocket
        // upgrade. All plain fetch/XHR traffic is already authenticated natively,
        // so the only remaining consumer is the socket handshake. The page is
        // origin-bound and loaded from bundled assets (no file/content access),
        // which keeps the exposure scoped to this audited first-party workspace.
        val token = requireNotNull(TokenStore.getToken())
        val config = JSONObject().put("apiBase", base).put("token", token).toString().replace("<", "\\u003c")
        val prelude = """
            <script>
            window.__PLUM_ANDROID__=$config;
            window.addEventListener('message',function(event){
                if(event.source!==null||event.data!=='plum-native'||!event.ports[0])return;
                const port=event.ports[0];
                const host={logout:()=>port.postMessage(JSON.stringify({action:'logout'})),offer:(encoded,filename)=>port.postMessage(JSON.stringify({action:'download',encoded:String(encoded),filename:String(filename)}))};
                window.PlumDownloads=host;window.PlumHost=host;
            });
            const plumFitViewport=()=>{const h=window.innerHeight;if(h>0)document.documentElement.style.setProperty('--plum-native-height',h+'px');};
            plumFitViewport();window.addEventListener('resize',plumFitViewport);window.addEventListener('load',plumFitViewport);
            const plumStreams=new Set();if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async function(c){const s=await gum(c);plumStreams.add(s);s.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(s.getTracks().every(t=>t.readyState==='ended'))plumStreams.delete(s);}));return s;};}
            window.__plumStopMedia=function(){plumStreams.forEach(s=>s.getTracks().forEach(t=>t.stop()));plumStreams.clear();document.querySelectorAll('video,audio').forEach(e=>e.pause());};
            localStorage.setItem('theme',${JSONObject.quote(theme)});
            localStorage.setItem('background-animation',${JSONObject.quote(background.id)});
            history.replaceState(null,'',${JSONObject.quote(route)});
            document.addEventListener('click',async function(e){const a=e.target.closest&&e.target.closest('a[download]');if(!a)return;const u=new URL(a.href,location.href);if(!(u.origin===location.origin||a.href.startsWith('blob:'+location.origin+'/')))return;e.preventDefault();try{const r=await fetch(a.href,{headers:{Authorization:'Bearer '+window.__PLUM_ANDROID__.token}});if(!r.ok)throw new Error('Download failed');const b=await r.blob();if(b.size>32*1024*1024)throw new Error('Export exceeds 32 MB');const f=new FileReader();f.onload=()=>PlumDownloads.offer(String(f.result).split(',')[1],a.download||'plum-export');f.readAsDataURL(b);}catch(err){alert(err.message);}},true);
            const plumPush=history.pushState.bind(history);
            history.pushState=function(state,title,url){const target=new URL(url,location.href);if(target.origin===location.origin&&['/code','/swarm','/hermes'].includes(target.pathname)){location.assign('/__plum_native_area/'+target.pathname.slice(1));return;}const m=target.pathname.match(/^\/(?:chat\/session|session)\/([A-Za-z0-9_-]+)$/);if(m&&target.origin===location.origin){location.assign('/__plum_native_session/'+m[1]);return;}plumPush(state,title,url);};
            </script>
        """.trimIndent()
        // The embedded viewport is resized by Compose (including IME insets).
        // Use measured CSS pixels: viewport units resolve to zero in this host on WebView 113.
        val chrome = "<style>html,body,#root{height:var(--plum-native-height,100%);min-height:var(--plum-native-height,100%)}.plum-assistant-shell.h-screen,.mobile-navigation-sheet.plum-assistant-shell{height:var(--plum-native-height,100vh)!important}[role=dialog]{max-height:calc(var(--plum-native-height,100vh) - 32px)!important}.mobile-app-header,.plum-new-chat-header{display:none!important}</style>"
        return context.assets.open("plum-web/index.html").bufferedReader().use { it.readText() }.replace("<head>", "<head>$chrome$prelude")
    }
    fun localAsset(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.scheme !in listOf("https", "http") || "${url.scheme}://${url.encodedAuthority}" != origin) return null
        val raw = url.encodedPath ?: return null
        val clean = if (prefix.isNotEmpty() && raw.startsWith("$prefix/")) raw.removePrefix(prefix) else raw
        if (".." in clean || '%' in clean || '\\' in clean) return null
        val asset = clean.removePrefix("/")
        if (asset.startsWith("python-runtime/") || asset.startsWith("backgrounds/") || asset.startsWith("assets/") || asset.startsWith("logos/") || asset.startsWith("fonts/") || asset.startsWith("icons/") || asset in setOf("favicon.svg", "favicon.ico", "claude-logo.png", "manifest.json", "chat-sandbox.html")) {
            return runCatching {
                val mime = when (asset.substringAfterLast('.')) { "js", "mjs" -> "application/javascript"; "wasm" -> "application/wasm"; "css" -> "text/css"; "svg" -> "image/svg+xml"; "json" -> "application/json"; "html" -> "text/html"; else -> java.net.URLConnection.guessContentTypeFromName(asset) ?: "application/octet-stream" }
                WebResourceResponse(mime, "UTF-8", 200, "OK", if (asset.startsWith("python-runtime/")) mapOf("Access-Control-Allow-Origin" to "*", "Cross-Origin-Resource-Policy" to "cross-origin") else emptyMap(), context.assets.open("plum-web/$asset"))
            }.getOrElse { WebResourceResponse("text/plain", "UTF-8", 404, "Asset unavailable", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
        }
        if (request.method != "GET" || !current()) return null
        if (clean.startsWith("/api/") || clean.startsWith("/auth/") || clean.startsWith("/generated/") || clean.startsWith("/office/")) {
            return runCatching {
                val token = requireNotNull(TokenStore.getToken())
                val response = client.newCall(Request.Builder().url("$base$clean" + (url.encodedQuery?.let { "?$it" } ?: "")).header("Authorization", "Bearer $token").build()).execute()
                if (!current()) { response.close(); return@runCatching WebResourceResponse("text/plain", "UTF-8", 409, "Account changed", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
                if (response.code in 300..399) { response.close(); return@runCatching WebResourceResponse("text/plain", "UTF-8", 401, "Authentication required", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
                if (response.code == 401 && clean == "/auth/me") handler.post { if (current()) { TokenStore.clearToken(); com.claudewebui.app.core.security.AuthEvents.notifySessionExpired() } }
                val type = response.header("Content-Type").orEmpty().substringBefore(';').ifBlank { "application/octet-stream" }
                WebResourceResponse(type, "UTF-8", response.code, response.message.ifBlank { "Response" }, response.headers.toMultimap().mapValues { it.value.joinToString(",") }, response.body?.byteStream())
            }.getOrElse { WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
        }
        return WebResourceResponse("text/plain", "UTF-8", 404, "Local workspace resource unavailable", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }
    BackHandler { if (webView?.canGoBack() == true) webView?.goBack() else onClose() }
    DisposableEffect(owner, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> { webView?.evaluateJavascript("window.__plumStopMedia?.();", null); webView?.onPause(); permission?.deny(); permission = null }
                Lifecycle.Event.ON_START -> webView?.onResume()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
        lifecycle.removeObserver(observer)
        alive.set(false); selectedFiles?.onReceiveValue(null); selectedFiles = null; permission?.deny(); permission = null; download = null
        webView?.apply { stopLoading(); nativePort?.close(); nativePort = null; loadUrl("about:blank"); clearCache(true); destroy() }; webView = null
        disposeWorkspaceHttpClient(client)
    } }
    PlumBackdrop {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            // Opened from the settings (memory management) it is a sub-page of
            // the settings: a back button and its title, no area selector.
            if (standaloneTitle != null) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                com.claudewebui.app.ui.components.common.PlumIconButton(androidx.compose.material.icons.Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.settings_hub_back), { if (webView?.canGoBack() == true) webView?.goBack() else onClose() })
                Spacer(Modifier.size(12.dp))
                Text(standaloneTitle, Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = com.claudewebui.app.ui.components.common.PlumText, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            } else Column(Modifier.padding(horizontal = 12.dp)) {
                PlumAreaSelector(area, onAreaSelect, onPersonalize = onPersonalize,
                    onNavigation = { webView?.evaluateJavascript("document.querySelector('.mobile-app-header button[aria-label=\"Navigation öffnen\"]')?.click();", null) })
            }
            failure?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            AndroidView(modifier = Modifier.weight(1f).fillMaxWidth(), factory = { ctx ->
                WebView(ctx).apply {
                    webView = this
                    settings.javaScriptEnabled = true; settings.domStorageEnabled = true
                    // The workspace is served entirely from bundled assets and the
                    // native shouldInterceptRequest proxy; it never needs file:// or
                    // content:// access, so both stay off to shrink the attack surface.
                    settings.allowFileAccess = false; settings.allowContentAccess = false
                    settings.javaScriptCanOpenWindowsAutomatically = false; settings.setSupportMultipleWindows(false)
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                    webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? = localAsset(request)
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean {
                            val target = request.url
                            if (!current()) return true
                            if (!request.isForMainFrame) return target.scheme !in listOf("https", "http", "about", "blob", "data")
                            val same = "${target.scheme}://${target.encodedAuthority}" == origin
                            if (same && target.path in listOf("/__plum_native_area/code", "/__plum_native_area/swarm", "/__plum_native_area/hermes")) { onAreaSelect(nativeArea(target.lastPathSegment!!)); return true }
                            val id = target.path?.removePrefix("/__plum_native_session/")
                            if (same && target.path?.startsWith("/__plum_native_session/") == true && id?.matches(Regex("[A-Za-z0-9_-]+")) == true) { onNavigateToChat(id); return true }
                            val route = target.encodedPath.orEmpty().removePrefix(prefix)
                            if (same && (route.startsWith("/api/") || route.startsWith("/generated/") || route.startsWith("/office/"))) return false
                            if (same && route in listOf("/code", "/swarm", "/hermes")) { onAreaSelect(nativeArea(route.drop(1))); return true }
                            if (same && target.path?.startsWith("/api/") != true && target.path?.startsWith("/generated/") != true) {
                                loading = true; loadDataWithBaseURL("$base/", bundledHtml(target.encodedPath + (target.encodedQuery?.let { "?$it" } ?: "")), "text/html", "UTF-8", null); return true
                            }
                            if (request.hasGesture() && target.scheme in listOf("https", "http")) context.startActivity(Intent(Intent.ACTION_VIEW, target))
                            return true
                        }
                        override fun onPageFinished(view: WebView?, url: String?) {
                            if (!current() || view == null) return
                            loading = false; nativePort?.close()
                            val ports = view.createWebMessageChannel(); nativePort = ports[0]
                            ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                                override fun onMessage(port: WebMessagePort?, message: WebMessage?) {
                                    if (!current()) return
                                    runCatching {
                                        val data = JSONObject(message?.data.orEmpty())
                                        when (data.optString("action")) {
                                            "logout" -> downloads.logout()
                                            "download" -> downloads.offer(data.optString("encoded"), data.optString("filename"))
                                        }
                                    }
                                }
                            })
                            view.postWebMessage(WebMessage("plum-native", arrayOf(ports[1])), Uri.parse(origin))
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                            if (!current()) { callback?.onReceiveValue(null); return true }
                            selectedFiles?.onReceiveValue(null); selectedFiles = callback
                            filePicker.launch(params?.acceptTypes?.filter { it.isNotBlank() }?.toTypedArray()?.takeIf { it.isNotEmpty() } ?: arrayOf("*/*")); return true
                        }
                        override fun onPermissionRequest(request: PermissionRequest) {
                            handler.post {
                                if (!current() || request.origin.toString().trimEnd('/') != origin) { request.deny(); return@post }
                                val requested = request.resources.mapNotNull { when(it) { PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO; PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA; else -> null } }.distinct()
                                if (requested.isEmpty()) request.deny() else { permission?.deny(); permission = request; permissionPicker.launch(requested.toTypedArray()) }
                            }
                        }
                    }
                    setDownloadListener { url, _, disposition, _, _ ->
                        if (current() && (url.startsWith("blob:$origin/") || url.startsWith("$origin/"))) {
                            val name = Regex("filename=\\\"?([^\\\";]+)").find(disposition.orEmpty())?.groupValues?.get(1) ?: "plum-export"
                            evaluateJavascript("fetch(${JSONObject.quote(url)},{headers:{Authorization:'Bearer '+window.__PLUM_ANDROID__.token}}).then(r=>r.blob()).then(b=>{const f=new FileReader();f.onload=()=>PlumDownloads.offer(String(f.result).split(',')[1],${JSONObject.quote(name)});f.readAsDataURL(b);}).catch(()=>{});", null)
                        }
                    }
                    // Initialise the document after the host has a real viewport.
                    doOnLayout { if (current()) loadDataWithBaseURL("$base/", bundledHtml(path), "text/html", "UTF-8", null) }
                }
            })
        }
    }
}

/** The web Schwarm page lives inside the native Hermes area now. */
private fun nativeArea(segment: String): String = if (segment == "swarm") "hermes" else segment
