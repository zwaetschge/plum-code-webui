package com.claudewebui.app.ui.screens.dashboard

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/*
 * Voice mode recognition on the phone itself (personalisation
 * `speechRecognition = "device"`): Android's SpeechRecognizer, on-device when
 * the phone has it, otherwise the system recognizer (usually Google). It shows
 * what it hears while you speak and ends the utterance on its own, so there is
 * no upload and no Whisper round trip. When the phone cannot do it, the voice
 * mode falls back to the server (Whisper on Vocarium) for the session.
 */

// SpeechRecognizer error codes; the API 31+ ones as literals because minSdk is 26.
internal const val SR_ERROR_NETWORK_TIMEOUT = 1
internal const val SR_ERROR_NETWORK = 2
internal const val SR_ERROR_AUDIO = 3
internal const val SR_ERROR_SERVER = 4
internal const val SR_ERROR_CLIENT = 5
internal const val SR_ERROR_SPEECH_TIMEOUT = 6
internal const val SR_ERROR_NO_MATCH = 7
internal const val SR_ERROR_RECOGNIZER_BUSY = 8
internal const val SR_ERROR_INSUFFICIENT_PERMISSIONS = 9
internal const val SR_ERROR_TOO_MANY_REQUESTS = 10
internal const val SR_ERROR_SERVER_DISCONNECTED = 11
internal const val SR_ERROR_LANGUAGE_NOT_SUPPORTED = 12
internal const val SR_ERROR_LANGUAGE_UNAVAILABLE = 13
/** Not a SpeechRecognizer code: the phone offers no recognizer at all. */
internal const val SR_NO_RECOGNIZER = -1
/** Not a SpeechRecognizer code: the recognizer showed no sign of life within [DEVICE_READY_TIMEOUT_MS]. */
internal const val SR_NOT_READY = -2

/**
 * How long a recognizer may take to get ready. A missing on-device language
 * pack can take a minute to be reported (seen on the emulator), and all that
 * time the screen would invite you to speak while nothing listens.
 */
internal const val DEVICE_READY_TIMEOUT_MS = 6_000L

/** Silence the recognizer waits for before it ends the utterance (the server path waits 1.1 s). */
internal const val DEVICE_END_SILENCE_MS = 1_000L

/**
 * Recognizer locales for a voice or profile language, best first. German
 * prefers Swiss Standard German and falls back to de-DE when the recognizer
 * rejects it; anything unknown ("Auto", blank) is German, the voice mode's
 * language.
 */
internal fun recognitionLocales(language: String?): List<String> {
    val raw = language?.trim().orEmpty()
    val parts = raw.split('-', '_')
    val code = when (val base = parts.first().lowercase()) {
        "", "auto", "german", "deutsch" -> "de"
        "french", "français", "francais", "französisch" -> "fr"
        "italian", "italiano", "italienisch" -> "it"
        "english", "englisch" -> "en"
        "spanish", "español", "espanol", "spanisch" -> "es"
        "portuguese", "português", "portugiesisch" -> "pt"
        "dutch", "nederlands", "niederländisch" -> "nl"
        else -> base
    }
    if (!code.matches(Regex("[a-z]{2,3}"))) return listOf("de-CH", "de-DE")
    val usual = when (code) {
        "de" -> listOf("de-CH", "de-DE")
        "fr" -> listOf("fr-FR")
        "it" -> listOf("it-IT")
        "en" -> listOf("en-US")
        "es" -> listOf("es-ES")
        "pt" -> listOf("pt-BR")
        "nl" -> listOf("nl-NL")
        else -> listOf(code)
    }
    val region = parts.getOrNull(1)?.uppercase()?.takeIf { it.matches(Regex("[A-Z]{2}")) }
    return (listOfNotNull(region?.let { "$code-$it" }) + usual).distinct()
}

/** What the voice loop does with a recognizer error. */
internal enum class RecognizerOutcome {
    /** Nothing (understood) was said: listen again. */
    Silence,
    /** This locale is not available: try the next locale. */
    NextLocale,
    /** This recognizer cannot serve us: try the other kind (on-device → system). */
    NextRecognizer,
    /** Transient (busy, client): recreate and try again. */
    Retry,
    /** No device recognition this session: fall back to the server. */
    Unavailable,
}

internal fun recognizerOutcome(error: Int, onDevice: Boolean): RecognizerOutcome = when (error) {
    SR_ERROR_NO_MATCH, SR_ERROR_SPEECH_TIMEOUT -> RecognizerOutcome.Silence
    SR_ERROR_LANGUAGE_NOT_SUPPORTED, SR_ERROR_LANGUAGE_UNAVAILABLE -> RecognizerOutcome.NextLocale
    SR_ERROR_RECOGNIZER_BUSY, SR_ERROR_CLIENT -> RecognizerOutcome.Retry
    SR_ERROR_INSUFFICIENT_PERMISSIONS -> RecognizerOutcome.Unavailable
    // A failing on-device engine may still have the system recognizer behind it;
    // a failing system recognizer (network, server, audio) means the server.
    else -> if (onDevice) RecognizerOutcome.NextRecognizer else RecognizerOutcome.Unavailable
}

/** How one round of device recognition ended. */
internal sealed interface DeviceHeard {
    data class Text(val text: String) : DeviceHeard
    data object Silence : DeviceHeard
    /** Device recognition is not possible; [code] is the last SpeechRecognizer error. */
    data class Unavailable(val code: Int) : DeviceHeard
}

/**
 * One voice session's device recognizer. The recognizer is created once and
 * reused between utterances (binding the service again costs time) and is
 * only listening inside [listen], so it never hears Plum's own voice: the
 * voice loop speaks only after a round has ended. Main thread only.
 */
internal class DeviceSpeech(private val context: Context, val language: String) {
    private class Option(val onDevice: Boolean, val locale: String) {
        val key = (if (onDevice) "on-device " else "system ") + locale
    }

    companion object {
        /**
         * Recognizer + locale pairs that refused the language in this process
         * (de-CH on-device is often unsupported, a missing language pack takes
         * seconds to report), so the next voice session skips them at once.
         */
        private val refused: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    }

    private val options: List<Option>
    private var index = 0
    private var recognizer: SpeechRecognizer? = null
    private var active: SpeechRecognizer? = null
    private var lastError = SR_NO_RECOGNIZER
    private val main = Handler(Looper.getMainLooper())

    init {
        val locales = recognitionLocales(language)
        val onDevice = Build.VERSION.SDK_INT >= 31 && runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }.getOrDefault(false)
        val system = runCatching { SpeechRecognizer.isRecognitionAvailable(context) }.getOrDefault(false)
        options = buildList {
            if (onDevice) locales.forEach { add(Option(true, it)) }
            if (system) locales.forEach { add(Option(false, it)) }
        }.filter { it.key !in refused }
    }

    /** False once every recognizer and locale failed (or there was none). */
    val available: Boolean get() = index < options.size

    /** Which recognizer and locale the next round uses, for logs and tests. */
    val current: String? get() = options.getOrNull(index)?.key

    /** Ends the utterance now (tap on the orb); the final result follows. */
    fun finish() { runCatching { active?.stopListening() } }

    fun release() {
        recognizer?.let { if (active === it) runCatching { it.cancel() }; runCatching { it.destroy() } }
        active = null
        recognizer = null
    }

    private fun moveTo(next: Int) {
        val from = options.getOrNull(index)
        val to = options.getOrNull(next)
        if (to == null || from == null || to.onDevice != from.onDevice) release()
        index = next
    }

    private fun create(onDevice: Boolean): SpeechRecognizer? = runCatching {
        if (onDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        else SpeechRecognizer.createSpeechRecognizer(context)
    }.getOrNull()

    private fun intent(locale: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, DEVICE_END_SILENCE_MS)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, DEVICE_END_SILENCE_MS)
    }

    /**
     * Listens for one utterance. Partial text goes to [partial] while you
     * speak, [onSpeech] fires when speech starts. Locale and recognizer
     * failures move on to the next option inside this call; only when none
     * is left does it return [DeviceHeard.Unavailable].
     */
    suspend fun listen(level: (Float) -> Unit, partial: (String) -> Unit, onSpeech: () -> Unit): DeviceHeard {
        var retries = 0
        while (true) {
            val option = options.getOrNull(index) ?: return DeviceHeard.Unavailable(lastError)
            val speech = recognizer ?: create(option.onDevice)?.also { recognizer = it }
            if (speech == null) { moveTo(nextKind(option)); continue }
            val (error, text) = round(speech, option.locale, level, partial, onSpeech)
            if (error == null) return if (text.isNullOrBlank()) DeviceHeard.Silence else DeviceHeard.Text(text.trim())
            lastError = error
            // A recognizer that hangs on this locale will hang again: skip it for this process.
            if (error == SR_NOT_READY) refused += option.key
            when (recognizerOutcome(error, option.onDevice)) {
                // The final pass sometimes drops what the partials already had.
                RecognizerOutcome.Silence -> return if (error == SR_ERROR_NO_MATCH && !text.isNullOrBlank()) DeviceHeard.Text(text.trim()) else DeviceHeard.Silence
                RecognizerOutcome.NextLocale -> { refused += option.key; moveTo(index + 1) }
                RecognizerOutcome.NextRecognizer -> moveTo(nextKind(option))
                RecognizerOutcome.Retry -> if (++retries > 3) moveTo(nextKind(option)) else { release(); delay(250L * retries) }
                RecognizerOutcome.Unavailable -> { moveTo(options.size); return DeviceHeard.Unavailable(error) }
            }
        }
    }

    private fun nextKind(option: Option): Int =
        options.indexOfFirst { it.onDevice != option.onDevice }.takeIf { it > index } ?: options.size

    /** One startListening … result/error cycle. Returns (error or null, final or last partial text). */
    private suspend fun round(speech: SpeechRecognizer, locale: String, level: (Float) -> Unit, partial: (String) -> Unit, onSpeech: () -> Unit): Pair<Int?, String?> =
        suspendCancellableCoroutine { wait ->
            var heard: String? = null
            var done = false
            var watchdog: Runnable? = null
            fun alive() { watchdog?.let { main.removeCallbacks(it) }; watchdog = null }
            fun end(error: Int?, text: String?) {
                alive()
                if (done) return
                done = true
                active = null
                level(0f)
                if (wait.isActive) wait.resume(error to text)
            }
            fun first(bundle: Bundle?) = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { alive() }
                override fun onBeginningOfSpeech() { alive(); if (!done) onSpeech() }
                // rmsdB runs from about -2 (silence) to 10 (loud speech).
                override fun onRmsChanged(rmsdB: Float) { alive(); if (!done) level(((rmsdB + 2f) / 12f).coerceIn(0f, 1f)) }
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { if (!done) level(0f) }
                override fun onError(error: Int) { end(error, heard) }
                override fun onResults(results: Bundle?) { end(null, first(results) ?: heard) }
                override fun onPartialResults(partialResults: Bundle?) {
                    alive()
                    if (done) return
                    first(partialResults)?.let { heard = it; partial(it) }
                }
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            // Interrupt, pause or leaving the screen: stop listening at once.
            wait.invokeOnCancellation {
                val stop = Runnable { alive(); done = true; if (active === speech) active = null; runCatching { speech.cancel() } }
                if (Looper.myLooper() == Looper.getMainLooper()) stop.run() else main.post(stop)
            }
            active = speech
            watchdog = Runnable { if (!done) { runCatching { speech.cancel() }; end(SR_NOT_READY, null) } }.also { main.postDelayed(it, DEVICE_READY_TIMEOUT_MS) }
            try { speech.startListening(intent(locale)) } catch (failure: Exception) { end(SR_ERROR_CLIENT, null) }
        }
}
