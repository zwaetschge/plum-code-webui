package com.claudewebui.app.ui.screens.dashboard

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.NoiseSuppressor
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantApiTurn
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Voice mode: a spoken conversation in the open model chat.
 *
 * Same loop as the WebUI voice mode (VoiceComposer), built for the phone:
 * the microphone listens until you pause, Whisper (Vocarium) writes it down,
 * the text goes into the chat as the next turn, and OmniVoice reads the answer
 * sentence by sentence while it is still streaming, then the microphone
 * listens again. Everything stays an ordinary turn of the chat.
 */
internal enum class VoicePhase { Listening, Transcribing, Thinking, Speaking, Paused }

private const val RATE = 16_000
private const val FRAME = 320                 // 20 ms
private const val PRE_ROLL_FRAMES = 15        // 300 ms before the first loud frame
private const val END_SILENCE_MS = 1_100
private const val MAX_UTTERANCE_MS = 60_000
private const val IDLE_END_MS = 120_000

// ---------------------------------------------------------------- text

/** Whisper's inventions for silence or noise; heard on their own they are dropped. */
private val INVENTED = listOf(
    Regex("(vielen )?dank(e)?( (schön|sehr|fürs zuschauen|für ihre aufmerksamkeit))?"),
    Regex("untertitel(ung)?\\b.*"),
    Regex(".*\\b(amara\\.org|zdf|ard|wdr|swr|funk)\\b.*(untertitel|im auftrag).*"),
    Regex("(tschüss|ciao|bis (zum nächsten mal|bald|dann))"),
    Regex("copyright\\b.*"),
    Regex("(musik|\\[musik\\]|\\*musik\\*)"),
)

internal fun inventedTranscript(text: String): Boolean {
    val plain = text.lowercase().replace(Regex("[.!?,;:\"'„“»«()…]+"), " ").replace(Regex("\\s+"), " ").trim()
    return plain.isEmpty() || INVENTED.any { it.matches(plain) }
}

/** Markdown turned into something worth hearing: no code, links read by their label. */
internal fun speakable(text: String): String = text
    .replace(Regex("```[\\s\\S]*?```"), " ")
    .replace(Regex("`([^`]*)`"), "\$1")
    .replace(Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)"), "\$1")
    .replace(Regex("(?m)^\\s{0,3}(#{1,6}|[-*+]|\\d+\\.)\\s+"), "")
    .replace(Regex("https?://\\S+"), "")
    .replace(Regex("[*_~>|#]+"), "")
    .replace(Regex("\\s+"), " ")
    .trim()

/**
 * Cuts a growing answer into pieces for the voice: whole sentences only and
 * never inside a code block. The first piece is short so the voice starts
 * early; later ones are longer so the speech flows.
 */
internal class SpokenPieces {
    private var taken = 0
    private var count = 0

    fun next(response: String, done: Boolean): List<String> {
        val pieces = mutableListOf<String>()
        while (taken < response.length) {
            val rest = response.substring(taken)
            val cut = cutPoint(rest, if (count == 0) 50 else 220, done) ?: break
            taken += cut
            val piece = speakable(rest.substring(0, cut))
            if (piece.isNotEmpty()) { pieces += piece; count++ }
        }
        return pieces
    }

    private fun cutPoint(rest: String, target: Int, done: Boolean): Int? {
        var fence = false
        var lastSpace = -1
        var i = 0
        while (i < rest.length) {
            if (rest.startsWith("```", i)) { fence = !fence; i += 3; continue }
            val c = rest[i]
            if (!fence) {
                if (c == ' ') lastSpace = i
                // A full stop after a digit is a list number or a date, not a sentence end.
                val sentenceEnd = c in ".!?…:;" && i + 1 < rest.length && rest[i + 1].isWhitespace() &&
                    !(c == '.' && i > 0 && rest[i - 1].isDigit())
                if ((sentenceEnd || c == '\n') && i + 1 >= target) return i + 1
                // One endless sentence: cut at a space so the voice keeps going.
                if (i >= target * 3 && lastSpace > target) return lastSpace + 1
            }
            i++
        }
        return if (done) rest.length else null
    }
}

// ---------------------------------------------------------------- audio

private fun wav(pcm: ByteArray): ByteArray {
    val out = ByteArrayOutputStream(44 + pcm.size)
    fun int(v: Int) { out.write(v and 255); out.write(v shr 8 and 255); out.write(v shr 16 and 255); out.write(v shr 24 and 255) }
    fun short(v: Int) { out.write(v and 255); out.write(v shr 8 and 255) }
    out.write("RIFF".toByteArray()); int(36 + pcm.size); out.write("WAVE".toByteArray())
    out.write("fmt ".toByteArray()); int(16); short(1); short(1); int(RATE); int(RATE * 2); short(2); short(16)
    out.write("data".toByteArray()); int(pcm.size); out.write(pcm)
    return out.toByteArray()
}

/**
 * Listens for one utterance. The room sets the bar: a noise floor that falls
 * at once and rises slowly, so a fan does not count as speech. Returns the
 * utterance as 16 kHz WAV, or null after [IDLE_END_MS] without speech.
 */
private class VoiceCapture {
    @SuppressLint("MissingPermission")   // the voice mode opens only with the permission
    suspend fun listen(level: (Float) -> Unit, onSpeech: () -> Unit, finishNow: () -> Boolean): ByteArray? = withContext(Dispatchers.IO) {
        val minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minimum, FRAME * 2 * 16))
        if (record.state != AudioRecord.STATE_INITIALIZED) { record.release(); error("microphone") }
        val suppressor = if (NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(record.audioSessionId)?.apply { enabled = true } }.getOrNull() else null
        try {
            record.startRecording()
            val out = ByteArrayOutputStream()
            val preRoll = ArrayDeque<ByteArray>()
            val frame = ShortArray(FRAME)
            var noise = -1f
            var loud = 0
            var heard = false
            var quietMs = 0
            var elapsedMs = 0
            while (true) {
                ensureActive()
                var got = 0
                while (got < FRAME) {
                    val n = record.read(frame, got, FRAME - got)
                    if (n <= 0) error("microphone")
                    got += n
                }
                elapsedMs += 20
                var sum = 0.0
                for (s in frame) sum += s.toDouble() * s
                val rms = sqrt(sum / FRAME).toFloat()
                noise = when {
                    noise < 0 -> rms
                    rms < noise -> noise * .7f + rms * .3f
                    heard -> noise * 1.0005f
                    else -> noise * 1.004f
                }
                level(min(1f, rms / 5000f))
                val bytes = ByteArray(FRAME * 2)
                for (k in 0 until FRAME) { bytes[2 * k] = (frame[k].toInt() and 255).toByte(); bytes[2 * k + 1] = (frame[k].toInt() shr 8).toByte() }
                if (!heard) {
                    preRoll.addLast(bytes)
                    if (preRoll.size > PRE_ROLL_FRAMES) preRoll.removeFirst()
                    loud = if (rms > max(noise * 3f, 350f)) loud + 1 else 0
                    if (loud >= 5) {   // 100 ms clearly above the room
                        heard = true
                        preRoll.forEach(out::write); preRoll.clear()
                        withContext(Dispatchers.Main) { onSpeech() }
                    } else if (elapsedMs > IDLE_END_MS) return@withContext null
                } else {
                    out.write(bytes)
                    quietMs = if (rms < max(noise * 1.8f, 250f)) quietMs + 20 else 0
                    if (quietMs >= END_SILENCE_MS || out.size() >= RATE * 2 * MAX_UTTERANCE_MS / 1000 || finishNow()) break
                }
            }
            wav(out.toByteArray())
        } finally {
            level(0f)
            runCatching { record.stop() }
            record.release()
            suppressor?.release()
        }
    }
}

/** Plays OmniVoice's WAV through an AudioTrack and reports its loudness for the orb. */
private class VoicePlayer(private val context: Context, private val level: (Float) -> Unit) {
    private class Pcm(val rate: Int, val channels: Int, val offset: Int, val end: Int)

    private fun parse(wav: ByteArray): Pcm? {
        fun int(at: Int) = (wav[at].toInt() and 255) or (wav[at + 1].toInt() and 255 shl 8) or (wav[at + 2].toInt() and 255 shl 16) or (wav[at + 3].toInt() and 255 shl 24)
        fun short(at: Int) = (wav[at].toInt() and 255) or (wav[at + 1].toInt() and 255 shl 8)
        if (wav.size < 44 || String(wav, 0, 4) != "RIFF" || String(wav, 8, 4) != "WAVE") return null
        var at = 12
        var rate = 0; var channels = 0; var bits = 0; var format = 0
        while (at + 8 <= wav.size) {
            val id = String(wav, at, 4)
            val size = int(at + 4)
            if (id == "fmt ") { format = short(at + 8); channels = short(at + 10); rate = int(at + 12); bits = short(at + 22) }
            if (id == "data") {
                val end = if (size <= 0 || at + 8 + size > wav.size) wav.size else at + 8 + size
                return if ((format == 1 || format == 0xFFFE) && bits == 16 && channels in 1..2 && rate > 0) Pcm(rate, channels, at + 8, end) else null
            }
            at += 8 + size + (size and 1)
        }
        return null
    }

    suspend fun play(wav: ByteArray) {
        val pcm = parse(wav) ?: return playFile(wav)
        withContext(Dispatchers.IO) {
            val mask = if (pcm.channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
            val minimum = AudioTrack.getMinBufferSize(pcm.rate, mask, AudioFormat.ENCODING_PCM_16BIT)
            val track = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(pcm.rate).setChannelMask(mask).build())
                .setBufferSizeInBytes(max(minimum, pcm.rate / 10 * 2 * pcm.channels))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            try {
                track.play()
                val step = pcm.rate / 50 * 2 * pcm.channels   // 20 ms
                var at = pcm.offset
                while (at < pcm.end) {
                    ensureActive()
                    val n = min(step, pcm.end - at) and 1.inv()
                    if (n <= 0) break
                    var sum = 0.0
                    var k = at
                    while (k + 1 < at + n) { val s = (wav[k].toInt() and 255 or (wav[k + 1].toInt() shl 8)).toShort().toDouble(); sum += s * s; k += 2 }
                    level(min(1f, sqrt(sum / (n / 2)).toFloat() / 6000f))
                    track.write(wav, at, n)
                    at += n
                }
                val frames = (pcm.end - pcm.offset) / (2 * pcm.channels)
                while (track.playbackHeadPosition < frames) { ensureActive(); delay(20) }
            } finally {
                level(0f)
                runCatching { track.pause(); track.flush(); track.stop() }
                track.release()
            }
        }
    }

    /** Anything that is not 16-bit PCM goes through MediaPlayer. */
    private suspend fun playFile(audio: ByteArray) {
        val file = File.createTempFile("plum-voice-", ".wav", context.cacheDir)
        val player = android.media.MediaPlayer()
        try {
            withContext(Dispatchers.IO) { file.writeBytes(audio) }
            player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            player.setDataSource(file.absolutePath)
            level(.4f)
            suspendCancellableCoroutine<Unit> { wait ->
                player.setOnPreparedListener { if (wait.isActive) it.start() }
                player.setOnCompletionListener { if (wait.isActive) wait.resume(Unit) }
                player.setOnErrorListener { _, _, _ -> if (wait.isActive) wait.resumeWithException(IllegalStateException(context.getString(R.string.assistant_voice_failed))); true }
                wait.invokeOnCancellation { runCatching { player.stop() } }
                player.prepareAsync()
            }
        } finally { level(0f); player.release(); file.delete() }
    }
}

// ---------------------------------------------------------------- screen

/**
 * Full-screen voice conversation over the open chat.
 *
 * [send] puts a spoken turn into the chat (creating one if none is open) and
 * returns false when the chat cannot take it right now; [turns], [running]
 * and [lastError] read the chat's live state. Tapping the orb ends your turn
 * early, or interrupts Plum while it thinks or speaks.
 */
@Composable
internal fun AssistantVoiceMode(
    owner: String,
    api: ApiClient,
    voice: String,
    title: String?,
    turns: () -> List<AssistantApiTurn>,
    running: () -> Boolean,
    lastError: () -> String?,
    send: (String) -> Boolean,
    stopTurn: () -> Unit,
    onClose: (String?) -> Unit,
) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val close by rememberUpdatedState(onClose)
    var phase by remember { mutableStateOf(VoicePhase.Listening) }
    var hearing by remember { mutableStateOf(false) }
    var paused by remember { mutableStateOf(false) }
    var heardText by remember { mutableStateOf("") }
    var caption by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    val micLevel = remember { mutableFloatStateOf(0f) }
    val speakLevel = remember { mutableFloatStateOf(0f) }
    val finish = remember { booleanArrayOf(false) }
    val current = remember { arrayOfNulls<Job>(1) }

    fun interrupt() { current[0]?.cancel() }

    // Ends with the screen: the microphone never runs in the background.
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) close(null) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    // Other audio steps back while Plum talks with you.
    DisposableEffect(Unit) {
        val audio = context.getSystemService(AudioManager::class.java)
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .build()
        audio?.requestAudioFocus(focus)
        onDispose { audio?.abandonAudioFocusRequest(focus) }
    }
    LaunchedEffect(phase) {
        if (phase == VoicePhase.Listening) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    LaunchedEffect(owner) {
        val capture = VoiceCapture()
        val player = VoicePlayer(context) { speakLevel.floatValue = it }
        val notUnderstood = context.getString(R.string.voice_mode_not_understood)

        /** Runs one step as its own job: an interrupt cancels the step, not the conversation. Null = interrupted. */
        suspend fun <T> step(block: suspend CoroutineScope.() -> T): Result<T>? = coroutineScope {
            val job = async { try { Result.success(block()) } catch (c: CancellationException) { throw c } catch (e: Exception) { Result.failure(e) } }
            current[0] = job
            try { job.await() } catch (c: CancellationException) { if (!isActive) throw c; null } finally { current[0] = null }
        }

        suspend fun answer(text: String, before: Set<String>) = coroutineScope {
            val pieces = SpokenPieces()
            val texts = Channel<String>(Channel.UNLIMITED)
            val clips = Channel<Pair<String, ByteArray>>(1)
            launch {
                try {
                    for (piece in texts) {
                        val audio = api.speakAssistantText(owner, piece, voice, "German")
                        if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                        clips.send(piece to audio)
                    }
                } finally { clips.close() }
            }
            launch {
                for ((piece, audio) in clips) { caption = piece; phase = VoicePhase.Speaking; player.play(audio) }
            }
            val started = System.currentTimeMillis()
            while (true) {
                val turn = turns().lastOrNull { it.id !in before && it.prompt.trim() == text }
                val waited = System.currentTimeMillis() - started
                if (turn != null) {
                    val done = turn.status != "running"
                    pieces.next(turn.response, done).forEach { texts.send(it) }
                    if (done) {
                        if (turn.response.isBlank() && turn.status != "completed") message = turn.error ?: context.getString(R.string.voice_mode_no_answer)
                        break
                    }
                } else if (waited > 60_000) { message = lastError() ?: context.getString(R.string.voice_mode_no_answer); break }
                if (waited > 300_000) break
                delay(150)
            }
            texts.close()
        }

        var failures = 0
        while (isActive) {
            if (paused) { phase = VoicePhase.Paused; snapshotFlow { paused }.first { !it } }
            phase = VoicePhase.Listening; hearing = false; finish[0] = false
            val heard = step {
                capture.listen(level = { micLevel.floatValue = it }, onSpeech = { hearing = true }, finishNow = { finish[0] })
            } ?: continue
            val wav = heard.getOrElse { close(context.getString(R.string.voice_mode_mic_failed)); return@LaunchedEffect }
                ?: run { close(context.getString(R.string.voice_mode_idle_end)); return@LaunchedEffect }
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            phase = VoicePhase.Transcribing
            val transcript = step {
                val result = api.transcribeAssistantAudio(owner, wav, "voice.wav", "audio/wav")
                if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                if (!result.success) error(result.error?.message ?: context.getString(R.string.assistant_voice_failed))
                result.data?.get("text")?.jsonPrimitive?.content.orEmpty().trim()
            } ?: continue
            val text = transcript.getOrElse { failure ->
                if (++failures >= 3) { close(failure.message); return@LaunchedEffect }
                message = failure.message; delay(1500); null
            } ?: continue
            if (inventedTranscript(text)) { message = notUnderstood; continue }
            failures = 0; message = null; heardText = text; caption = ""
            phase = VoicePhase.Thinking
            // A new question replaces an answer that is still being written.
            if (running()) { stopTurn(); withTimeoutOrNull(8_000) { snapshotFlow { running() }.first { !it } } }
            val before = turns().map { it.id }.toSet()
            var accepted = false
            for (attempt in 0 until 20) { if (send(text)) { accepted = true; break }; delay(250) }
            if (!accepted) { message = lastError() ?: context.getString(R.string.voice_mode_send_failed); delay(1500); continue }
            step { answer(text, before) }?.onFailure { message = it.message }
        }
    }

    val reduce = reducedMotion()
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    Dialog(onDismissRequest = { close(null) }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false)) {
        val view = LocalView.current
        DisposableEffect(view) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
        Box(
            Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(palette.background, lerp(palette.background, palette.accentDeep, .35f)))),
        ) {
            Column(
                Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    title?.takeIf { it.isNotBlank() } ?: stringResource(R.string.voice_mode_new_chat),
                    style = MaterialTheme.typography.titleMedium, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Spacer(Modifier.weight(1f))
                val level = when (phase) { VoicePhase.Listening -> micLevel.floatValue; VoicePhase.Speaking -> speakLevel.floatValue; else -> 0f }
                val orbSource = remember { MutableInteractionSource() }
                val orbLabel = stringResource(R.string.voice_mode_orb)
                VoiceOrb(
                    phase, level, reduce,
                    Modifier.size(260.dp).semantics { contentDescription = orbLabel }.clickable(orbSource, indication = null) {
                        when (phase) {
                            VoicePhase.Listening -> if (hearing) finish[0] = true
                            VoicePhase.Thinking, VoicePhase.Speaking -> { interrupt(); haptics.performHapticFeedback(HapticFeedbackType.LongPress) }
                            else -> Unit
                        }
                    },
                )
                Spacer(Modifier.height(36.dp))
                val status = when (phase) {
                    VoicePhase.Listening -> stringResource(if (hearing) R.string.voice_mode_listening else R.string.voice_mode_ready)
                    VoicePhase.Transcribing -> stringResource(R.string.voice_mode_transcribing)
                    VoicePhase.Thinking -> stringResource(R.string.voice_mode_thinking)
                    VoicePhase.Speaking -> stringResource(R.string.voice_mode_speaking)
                    VoicePhase.Paused -> stringResource(R.string.voice_mode_paused)
                }
                AnimatedContent(status, transitionSpec = { fadeIn(tween(if (reduce) 0 else 220)) togetherWith fadeOut(tween(if (reduce) 0 else 160)) }, label = "voice_status") { shown ->
                    Text(shown, style = MaterialTheme.typography.titleLarge, color = palette.text, textAlign = TextAlign.Center)
                }
                Spacer(Modifier.height(10.dp))
                val hint = when (phase) {
                    VoicePhase.Listening -> if (hearing) stringResource(R.string.voice_mode_hint_finish) else ""
                    VoicePhase.Thinking, VoicePhase.Speaking -> stringResource(R.string.voice_mode_hint_interrupt)
                    else -> ""
                }
                Text(message ?: hint, style = MaterialTheme.typography.bodyMedium, color = if (message != null) MaterialTheme.colorScheme.error else palette.muted, textAlign = TextAlign.Center, minLines = 1, maxLines = 2)
                Spacer(Modifier.height(20.dp))
                // What you said, then the sentence Plum is speaking: subtitles for the conversation.
                Column(Modifier.fillMaxWidth().heightIn(min = 120.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (heardText.isNotBlank()) Text("„$heardText“", style = MaterialTheme.typography.bodyLarge, color = palette.muted, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    if (caption.isNotBlank() && phase == VoicePhase.Speaking) Text(caption, style = MaterialTheme.typography.bodyLarge, color = palette.text, textAlign = TextAlign.Center, maxLines = 5, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.weight(1f))
                Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                    val pauseSource = remember { MutableInteractionSource() }
                    FilledTonalIconButton(
                        onClick = { paused = !paused; if (paused) interrupt() },
                        modifier = Modifier.size(64.dp).pressScale(pauseSource), interactionSource = pauseSource,
                    ) {
                        Icon(if (paused) Icons.Outlined.MicOff else Icons.Outlined.Mic, stringResource(if (paused) R.string.voice_mode_resume else R.string.voice_mode_pause), Modifier.size(28.dp))
                    }
                    val closeSource = remember { MutableInteractionSource() }
                    FilledIconButton(
                        onClick = { close(null) },
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer),
                        modifier = Modifier.size(64.dp).pressScale(closeSource), interactionSource = closeSource,
                    ) { Icon(Icons.Outlined.Close, stringResource(R.string.voice_mode_end), Modifier.size(28.dp)) }
                }
            }
        }
    }
}

/**
 * The plum orb: layered soft blobs whose edges ripple with the voice. Each
 * phase has its own colours and motion: calm breathing while waiting,
 * following your voice while listening, circling while thinking and pulsing
 * with Plum's speech.
 */
@Composable
private fun VoiceOrb(phase: VoicePhase, level: Float, reduce: Boolean, modifier: Modifier) {
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val rose = lerp(palette.accent, palette.red, .45f)
    val (inner, outer) = when (phase) {
        VoicePhase.Listening -> palette.accent to palette.blue
        VoicePhase.Transcribing, VoicePhase.Thinking -> palette.accent to palette.amber
        VoicePhase.Speaking -> rose to palette.accent
        VoicePhase.Paused -> palette.muted to palette.border
    }
    val a by animateColorAsState(inner, tween(450), label = "orb_inner")
    val b by animateColorAsState(outer, tween(450), label = "orb_outer")
    val loud by animateFloatAsState(level, spring(dampingRatio = .55f, stiffness = 380f), label = "orb_level")
    var time by remember { mutableFloatStateOf(0f) }
    if (!reduce && phase != VoicePhase.Paused) LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) withFrameMillis { time = (it - start) / 1000f }
    }
    Canvas(modifier) {
        val center = Offset(size.width / 2, size.height / 2)
        val base = size.minDimension * .30f
        val breathe = if (reduce) 0f else sin(time * 1.6f) * .025f
        val swell = 1f + breathe + loud * .32f
        // Glow behind everything.
        drawCircle(Brush.radialGradient(listOf(b.copy(alpha = .38f + loud * .3f), Color.Transparent), center, base * 1.9f * swell), base * 1.9f * swell, center)
        // Three blobs, each rippling at its own speed.
        val thinking = phase == VoicePhase.Thinking || phase == VoicePhase.Transcribing
        for (layer in 0 until 3) {
            val radius = base * swell * (1f - layer * .14f)
            val wobble = (.035f + loud * .16f) * (1f - layer * .25f)
            val speed = if (thinking) 2.6f else 1.2f + layer * .5f
            val path = Path()
            val steps = 96
            for (k in 0..steps) {
                val angle = k * 2 * PI.toFloat() / steps
                val r = radius * (1f + wobble * sin(angle * (3 + layer) + time * speed + layer * 1.7f) + wobble * .5f * sin(angle * (5 + layer) - time * speed * .7f))
                val x = center.x + r * kotlin.math.cos(angle)
                val y = center.y + r * sin(angle)
                if (k == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            path.close()
            val colors = when (layer) { 0 -> listOf(b.copy(alpha = .55f), a.copy(alpha = .35f)); 1 -> listOf(a.copy(alpha = .75f), b.copy(alpha = .45f)); else -> listOf(Color.White.copy(alpha = .55f), a) }
            drawPath(path, Brush.radialGradient(colors, center + Offset(-radius * .25f, -radius * .3f), radius * 1.4f))
        }
        // Thinking: three dots circle the orb.
        if (thinking && !reduce) for (dot in 0 until 3) {
            val angle = time * 2.2f + dot * 2 * PI.toFloat() / 3
            val orbit = base * 1.42f
            drawCircle(b.copy(alpha = .9f), base * .07f, center + Offset(orbit * kotlin.math.cos(angle), orbit * sin(angle)))
        }
    }
}
