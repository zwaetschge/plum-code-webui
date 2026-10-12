package com.claudewebui.app.ui.screens.dashboard

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import kotlinx.coroutines.*
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Local recording first: Whisper fills the draft only after explicit confirmation. */
@Composable
internal fun AssistantDictation(owner: String, api: ApiClient, enabled: Boolean, onText: (String) -> Unit, onBusy: (Boolean) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val latestText by rememberUpdatedState(onText)
    val latestBusy by rememberUpdatedState(onBusy)
    val latestEnabled by rememberUpdatedState(enabled)
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var original by remember { mutableStateOf<File?>(null) }
    var working by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var mounted by remember { mutableStateOf(true) }
    fun release(discard: Boolean) {
        recorder?.let { runCatching { it.stop() }; it.release() }; recorder = null
        if (discard) { original?.delete(); original = null }
        if (!working) latestBusy(original != null)
    }
    fun cancel() {
        job?.cancel(); job = null; working = false; release(true); latestBusy(false)
    }
    fun start() {
        if (!latestEnabled || TokenStore.assistantOwnerKey() != owner || !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        failure = null
        val file = File.createTempFile("plum-dictation-", ".m4a", context.cacheDir)
        original = file
        @Suppress("DEPRECATION")
        val next = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        recorder = next
        try {
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioSamplingRate(16000); next.setAudioEncodingBitRate(64000)
            next.setMaxDuration(300_000); next.setMaxFileSize(20L * 1024 * 1024)
            next.setOutputFile(file.absolutePath)
            next.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) release(false)
            }
            next.prepare(); next.start(); latestBusy(true)
        } catch (error: Exception) { failure = error.message; cancel() }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) start() else failure = context.getString(R.string.assistant_microphone_denied)
    }
    LaunchedEffect(enabled) { if (!enabled) cancel() }
    DisposableEffect(owner, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) cancel() }
        lifecycle.addObserver(observer)
        onDispose { mounted = false; lifecycle.removeObserver(observer); cancel() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (original == null) OutlinedButton(enabled = enabled && !working, onClick = {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
            else permission.launch(Manifest.permission.RECORD_AUDIO)
        }) { Text(stringResource(R.string.assistant_dictate)) }
        else {
            Text(stringResource(if (recorder != null) R.string.assistant_recording else R.string.assistant_recording_ready))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (recorder != null) OutlinedButton(onClick = { release(false) }) { Text(stringResource(R.string.assistant_recording_stop)) }
                else if (!working) Button(enabled = enabled, onClick = {
                    val file = original ?: return@Button
                    working = true; failure = null
                    job = scope.launch {
                        try {
                            val bytes = withContext(Dispatchers.IO) { file.readBytes() }
                            val result = api.transcribeAssistantAudio(owner, bytes)
                            if (!latestEnabled || TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account or voice permission changed")
                            if (!result.success) error(result.error?.message ?: context.getString(R.string.assistant_voice_failed))
                            val text = result.data?.get("text")?.jsonPrimitive?.content.orEmpty()
                            latestText(text)
                            working = false; release(true); latestBusy(false)
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (error: Exception) { if (TokenStore.assistantOwnerKey() == owner) failure = error.message }
                        finally { working = false; if (mounted) latestBusy(original != null) }
                    }
                }) { Text(stringResource(R.string.assistant_transcribe)) }
                TextButton(onClick = { cancel() }) { Text(stringResource(R.string.assistant_discard_recording)) }
            }
            if (working) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }
}

/** Complete answer, bounded Unicode-safe chunks, one player per chat. */
@Composable
internal fun AssistantReadAloud(owner: String, api: ApiClient, text: String?, onClose: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var voice by remember { mutableStateOf("Rufus Beck") }
    var language by remember { mutableStateOf("German") }
    var playing by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var request by remember { mutableIntStateOf(0) }
    val latestClose by rememberUpdatedState(onClose)
    DisposableEffect(owner, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) { playing = false; latestClose() } }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(owner, text, playing, request) {
        if (!playing || text.isNullOrBlank()) return@LaunchedEffect
        try {
            var start = 0
            while (start < text.length) {
                var end = minOf(start + 4500, text.length)
                if (end < text.length && Character.isHighSurrogate(text[end - 1])) end--
                val audio = api.speakAssistantText(owner, text.substring(start, end), voice.trim(), language.trim())
                if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                val file = File.createTempFile("plum-speech-", ".wav", context.cacheDir)
                val player = MediaPlayer()
                try {
                    withContext(Dispatchers.IO) { file.writeBytes(audio) }
                    player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    player.setDataSource(file.absolutePath)
                    suspendCancellableCoroutine<Unit> { wait ->
                        player.setOnPreparedListener { if (wait.isActive) it.start() }
                        player.setOnCompletionListener { if (wait.isActive) wait.resume(Unit) }
                        player.setOnErrorListener { _, _, _ -> if (wait.isActive) wait.resumeWithException(IllegalStateException(context.getString(R.string.assistant_voice_failed))); true }
                        wait.invokeOnCancellation { runCatching { player.stop() } }
                        player.prepareAsync()
                    }
                } finally { player.release(); file.delete() }
                start = end
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { if (TokenStore.assistantOwnerKey() == owner) failure = error.message }
        finally { playing = false }
    }
    if (text != null) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.assistant_voice_engine))
        // Mistral voices are addressed as `mistral:<voice_id>`, everything else is OmniVoice.
        val mistral = voice.startsWith("mistral:")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !mistral, enabled = !playing, onClick = { if (mistral) voice = "Rufus Beck" }, label = { Text("OmniVoice") })
            FilterChip(selected = mistral, enabled = !playing, onClick = { if (!mistral) voice = "mistral:gb_jane_neutral" }, label = { Text("Mistral") })
        }
        OutlinedTextField(voice, { voice = it.take(100) }, enabled = !playing, label = { Text(stringResource(R.string.assistant_voice_name)) }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(language, { language = it.take(80) }, enabled = !playing, label = { Text(stringResource(R.string.assistant_voice_language)) }, modifier = Modifier.fillMaxWidth())
        failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = voice.isNotBlank() && language.isNotBlank(), onClick = { if (playing) playing = false else { failure = null; request++; playing = true } }) { Text(stringResource(if (playing) R.string.assistant_stop_audio else R.string.assistant_read_aloud)) }
            TextButton(onClick = { playing = false; onClose() }) { Text(stringResource(R.string.assistant_close_audio)) }
        }
    }
}
