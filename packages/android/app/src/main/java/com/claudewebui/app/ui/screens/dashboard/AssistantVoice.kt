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
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Check
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
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

/** Speaks [text] through [voice] in bounded Unicode-safe chunks; returns when playback ends or is cancelled. */
internal suspend fun speakThrough(context: android.content.Context, owner: String, api: ApiClient, text: String, voice: String, language: String) {
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
}

/**
 * Read-aloud as a slim player: starts as soon as [text] arrives, with the voice
 * chosen in the personalization (no form), and closes itself when finished.
 */
@Composable
internal fun AssistantReadAloud(owner: String, api: ApiClient, text: String?, voice: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var failure by remember { mutableStateOf<String?>(null) }
    val latestClose by rememberUpdatedState(onClose)
    DisposableEffect(owner, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) latestClose() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(owner, text, voice) {
        if (text.isNullOrBlank()) return@LaunchedEffect
        failure = null
        try { speakThrough(context, owner, api, text, voice.ifBlank { "Rufus Beck" }, "German"); latestClose() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { if (TokenStore.assistantOwnerKey() == owner) failure = error.message }
    }
    if (text != null) Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            if (failure == null) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            Text(failure ?: stringResource(R.string.assistant_reading), Modifier.weight(1f).padding(horizontal = 12.dp), style = MaterialTheme.typography.bodyMedium, color = if (failure != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface, maxLines = 2)
            TextButton(onClick = { onClose() }) { Text(stringResource(R.string.assistant_close_audio)) }
        }
    }
}

/** Fixed voice choice with a sample per voice, grouped by engine. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VoicePickerSheet(owner: String, api: ApiClient, selected: String, onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var voices by remember { mutableStateOf<List<com.claudewebui.app.data.model.AssistantVoiceOption>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var sampling by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    LaunchedEffect(owner) {
        try { val r = api.getAssistantVoices(); if (r.success) voices = r.data.orEmpty() else failed = true }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { failed = true }
    }
    DisposableEffect(Unit) { onDispose { job?.cancel() } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 20.dp), contentPadding = PaddingValues(bottom = 28.dp)) {
            item { Text(stringResource(R.string.assistant_voice_pick), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp)) }
            if (failed) item { Text(stringResource(R.string.assistant_voice_failed), color = MaterialTheme.colorScheme.error) }
            if (voices == null && !failed) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            voices.orEmpty().groupBy { it.engine == "mistral" }.toSortedMap(compareBy { it }).forEach { (mistral, group) ->
                item { Text(if (mistral) "MISTRAL (API)" else "OMNIVOICE (LOKAL)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp)) }
                items(group.size) { i ->
                    val voice = group[i]
                    val active = voice.key == selected
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                            .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = .14f) else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable { onSelect(voice.key) }.padding(start = 12.dp),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Text(voice.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        if (active) Icon(androidx.compose.material.icons.Icons.Outlined.Check, null, tint = MaterialTheme.colorScheme.primary)
                        IconButton(onClick = {
                            job?.cancel()
                            if (sampling == voice.key) { sampling = null } else {
                                sampling = voice.key
                                job = scope.launch {
                                    try { speakThrough(context, owner, api, context.getString(R.string.assistant_voice_sample), voice.key, "German") }
                                    catch (cancelled: CancellationException) { throw cancelled }
                                    catch (_: Exception) { failed = true }
                                    finally { if (sampling == voice.key) sampling = null }
                                }
                            }
                        }) { Icon(if (sampling == voice.key) androidx.compose.material.icons.Icons.Outlined.Stop else androidx.compose.material.icons.Icons.Outlined.PlayArrow, stringResource(R.string.assistant_voice_try)) }
                    }
                }
            }
        }
    }
}
