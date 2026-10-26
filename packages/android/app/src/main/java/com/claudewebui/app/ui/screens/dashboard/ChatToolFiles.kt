package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import coil3.compose.AsyncImage
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantToolFile
import kotlinx.coroutines.*
import java.io.File

@Composable
internal fun ChatToolFile(owner: String, api: ApiClient, chatId: String?, file: AssistantToolFile, artifactId: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bytes by remember { mutableStateOf<ByteArray?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var cached by remember { mutableStateOf<File?>(null) }
    var player by remember { mutableStateOf<android.media.MediaPlayer?>(null) }
    fun current() = TokenStore.assistantOwnerKey() == owner
    suspend fun load(): ByteArray {
        bytes?.let { return it }
        val data = if (chatId != null) api.getChatToolFile(chatId, file.id) else api.getArtifactToolFile(requireNotNull(artifactId), file.id); check(current()); bytes = data; return data
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(file.mimeType)) { uri ->
        if (uri != null && current()) scope.launch {
            busy = true; error = null
            try { val data = load(); withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(data) } ?: kotlin.error("Datei konnte nicht geöffnet werden") } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (current()) error = failure.message }
            finally { if (current()) busy = false }
        }
    }
    LaunchedEffect(owner, chatId, file.id) {
        if (file.mimeType.startsWith("image/")) {
            try { load() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (current()) error = failure.message }
        }
    }
    DisposableEffect(owner, file.id) { onDispose { player?.release(); cached?.delete() } }
    Surface(shape = MaterialTheme.shapes.large, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (file.mimeType.startsWith("image/")) bytes?.let { AsyncImage(it, file.filename, modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp)) }
            if (file.mimeType.startsWith("video/") && cached != null) AndroidView(factory = { android.widget.VideoView(it).apply { setVideoPath(cached!!.absolutePath); setMediaController(android.widget.MediaController(it).also { control -> control.setAnchorView(this) }); start() } }, modifier = Modifier.fillMaxWidth().height(240.dp))
            Text("${file.filename} · ${maxOf(1, file.byteLength / 1024)} KB", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(enabled = !busy, onClick = { save.launch(file.filename) }) { Text("Speichern") }
                if (file.mimeType.startsWith("audio/") || file.mimeType.startsWith("video/")) TextButton(enabled = !busy, onClick = {
                    if (player != null) { player?.release(); player = null; return@TextButton }
                    scope.launch {
                        busy = true; error = null
                        try {
                            val data = load()
                            val target = withContext(Dispatchers.IO) { File.createTempFile("plum-tool-", if (file.mimeType.startsWith("video/")) ".mp4" else ".audio", context.cacheDir).also { it.writeBytes(data) } }
                            check(current()); cached?.delete(); cached = target
                            if (file.mimeType.startsWith("audio/")) {
                                val audio = android.media.MediaPlayer()
                                try { withContext(Dispatchers.IO) { audio.setDataSource(target.absolutePath); audio.prepare() }; check(current()); audio.setOnCompletionListener { it.release(); player = null }; player = audio; audio.start() }
                                catch (failure: Exception) { audio.release(); throw failure }
                            }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { if (current()) error = failure.message }
                        finally { if (current()) busy = false }
                    }
                }) { Text(if (player != null) "Stoppen" else "Abspielen") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
