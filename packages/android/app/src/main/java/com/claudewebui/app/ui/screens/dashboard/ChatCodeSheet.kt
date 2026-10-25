package com.claudewebui.app.ui.screens.dashboard

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AssistantChatSource
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Code has a separate WebView, a fixed asset allowlist and no token/native bridge. */
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun ChatCodeSheet(code: String, language: String, sources: List<AssistantChatSource>, api: ApiClient, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var edited by rememberSaveable(code) { mutableStateOf(code) }
    var payload by remember { mutableStateOf<String?>(null) }
    var generation by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var view by remember { mutableStateOf<WebView?>(null) }
    val python = language.lowercase() in listOf("py", "python")
    fun execute() {
        if (busy) return
        scope.launch {
            busy = true; error = null
            try {
                val files = JSONArray(); var total = 0
                if (python) for (source in sources.distinctBy { it.id }.take(10)) {
                    val bytes = api.getAssistantSourceFile(source.id, source.revision)
                    total += bytes.size; require(total <= 25 * 1024 * 1024) { "Python-Dateien überschreiten 25 MB" }
                    files.put(JSONObject().put("name", source.title.replace(Regex("[\\\\/\\u0000-\\u001f]"), "_")).put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
                }
                payload = JSONObject().put("kind", if (python) "python" else "html").put("code", edited).put("files", files).toString()
                generation++
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { busy = false }
        }
    }
    LaunchedEffect(Unit) { execute() }
    DisposableEffect(Unit) { onDispose { view?.apply { stopLoading(); loadUrl("about:blank"); destroy() }; view = null } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        BoxWithConstraints(Modifier.fillMaxWidth().fillMaxHeight(.9f)) {
        val editorHeight = if (maxHeight < 400.dp) 80.dp else 160.dp
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (python) "Python" else "Vorschau", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(edited, { edited = it }, label = { Text("Code") }, modifier = Modifier.fillMaxWidth().heightIn(max = editorHeight), minLines = 2, maxLines = 5)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy, onClick = { execute() }) { Text(if (python) "Ausführen" else "Aktualisieren") }
                OutlinedButton(onClick = { view?.loadUrl("about:blank"); payload = null }) { Text("Stoppen") }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (payload != null) key(generation) {
                AndroidView(modifier = Modifier.fillMaxWidth().weight(1f), factory = { ctx ->
                    WebView(ctx).apply {
                        view?.destroy(); view = this
                        settings.javaScriptEnabled = true
                        settings.allowFileAccess = false; settings.allowContentAccess = false; settings.domStorageEnabled = false
                        settings.javaScriptCanOpenWindowsAutomatically = false; settings.setSupportMultipleWindows(false)
                        var delivered = false
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(v: WebView?, r: WebResourceRequest) = true
                            override fun shouldInterceptRequest(v: WebView?, r: WebResourceRequest): WebResourceResponse {
                                val asset = r.url.path.orEmpty().removePrefix("/")
                                if (r.isForMainFrame && r.url.host == "plum-sandbox.invalid" && asset == "chat-sandbox.html") {
                                    return WebResourceResponse("text/html", "UTF-8", context.assets.open("plum-web/chat-sandbox.html"))
                                }
                                if (r.url.host == "plum-sandbox.invalid" && asset in setOf("python-runtime/pyodide.js", "python-runtime/pyodide.asm.mjs", "python-runtime/pyodide.asm.wasm", "python-runtime/python_stdlib.zip", "python-runtime/pyodide-lock.json")) {
                                    val mime = when { asset.endsWith(".wasm") -> "application/wasm"; asset.endsWith(".zip") -> "application/zip"; asset.endsWith(".json") -> "application/json"; else -> "application/javascript" }
                                    return WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf("Access-Control-Allow-Origin" to "*", "Cross-Origin-Resource-Policy" to "cross-origin"), context.assets.open("plum-web/$asset"))
                                }
                                return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                            }
                            override fun onPageFinished(v: WebView, url: String?) {
                                if (delivered || url == "about:blank") return
                                delivered = true
                                val encoded = JSONObject.quote(payload)
                                v.evaluateJavascript("(()=>{const p=JSON.parse($encoded);p.files=p.files.map(f=>({name:f.name,data:Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))}));window.postMessage(p,'*');})()", null)
                            }
                        }
                        loadUrl("https://plum-sandbox.invalid/chat-sandbox.html")
                    }
                })
            }
        }
        }
    }
}
