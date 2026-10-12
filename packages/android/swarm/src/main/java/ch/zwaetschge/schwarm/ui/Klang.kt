package com.claudewebui.swarm.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import androidx.core.content.ContextCompat
import com.claudewebui.swarm.data.str
import com.claudewebui.swarm.data.zahl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.util.UUID

/**
 * Ton in der App (App 2.2): Audionachrichten abspielen und Antworten vorlesen. Beide achten auf den
 * Audiofokus: Bei einem Anruf pausieren sie, zieht man den Kopfhörer ab, hören sie auf. Es spielt immer
 * nur eines von beiden.
 */
class Tonfokus(private val context: Context) {
    private val am = context.getSystemService(AudioManager::class.java)
    private var anfrage: AudioFocusRequest? = null
    private var rauschen: BroadcastReceiver? = null

    fun holen(attrs: AudioAttributes, onPause: () -> Unit, onWeiter: () -> Unit, onStopp: () -> Unit) {
        abgeben()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener { art ->
                when (art) {
                    AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> onPause()
                    AudioManager.AUDIOFOCUS_GAIN -> onWeiter()
                }
            }
            .build()
        anfrage = req
        am?.requestAudioFocus(req)
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) onStopp()
            }
        }
        runCatching {
            ContextCompat.registerReceiver(
                context, r, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            rauschen = r
        }
    }

    fun abgeben() {
        anfrage?.let { am?.abandonAudioFocusRequest(it) }
        anfrage = null
        rauschen?.let { runCatching { context.unregisterReceiver(it) } }
        rauschen = null
    }

    companion object {
        val SPRACHE: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    }
}

/** Eine Audionachricht, die gerade spielt oder lädt. */
data class Wiedergabe(
    val mxc: String,
    val laeuft: Boolean,
    val positionMs: Long,
    val dauerMs: Long,
    val laedt: Boolean = false,
)

/** Spielt Audionachrichten in der Nachricht ab, eine zur Zeit. */
class Abspieler(private val scope: CoroutineScope, private val fokus: Tonfokus) {
    private val _zustand = MutableStateFlow<Wiedergabe?>(null)
    val zustand: StateFlow<Wiedergabe?> = _zustand.asStateFlow()
    private var mp: MediaPlayer? = null
    private var ticker: Job? = null
    private var fokusPause = false

    /** Wird vor dem Abspielen aufgerufen, damit das Vorlesen aufhört. */
    var vorStart: (() -> Unit)? = null

    fun laedt(mxc: String) {
        _zustand.value = Wiedergabe(mxc, laeuft = false, positionMs = 0, dauerMs = 0, laedt = true)
    }

    fun fehlgeschlagen(mxc: String) {
        if (_zustand.value?.mxc == mxc) _zustand.value = null
    }

    fun spielen(mxc: String, datei: File, abMs: Long = 0) {
        stopp()
        vorStart?.invoke()
        val p = MediaPlayer()
        try {
            p.setAudioAttributes(Tonfokus.SPRACHE)
            p.setDataSource(datei.absolutePath)
            p.prepare()
        } catch (e: Exception) {
            p.release()
            throw e
        }
        if (abMs > 0) p.seekTo(abMs.toInt())
        p.setOnCompletionListener {
            _zustand.update { it?.copy(laeuft = false, positionMs = 0) }
            ende()
        }
        fokus.holen(Tonfokus.SPRACHE, onPause = { fokusPause = true; pause() }, onWeiter = { if (fokusPause) weiter() }, onStopp = { stopp() })
        p.start()
        mp = p
        fokusPause = false
        _zustand.value = Wiedergabe(mxc, laeuft = true, positionMs = abMs, dauerMs = p.duration.toLong().coerceAtLeast(0))
        ticken()
    }

    private fun ticken() {
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive) {
                val p = mp ?: break
                runCatching { p.currentPosition.toLong() }.getOrNull()?.let { pos -> _zustand.update { it?.copy(positionMs = pos) } }
                delay(200)
            }
        }
    }

    fun pause() {
        val p = mp ?: return
        runCatching { if (p.isPlaying) p.pause() }
        _zustand.update { it?.copy(laeuft = false) }
    }

    fun weiter() {
        val p = mp ?: return
        vorStart?.invoke()
        fokusPause = false
        runCatching { p.start() }
        _zustand.update { it?.copy(laeuft = true) }
        ticken()
    }

    fun suchen(ms: Long) {
        val p = mp ?: return
        runCatching { p.seekTo(ms.toInt()) }
        _zustand.update { it?.copy(positionMs = ms) }
    }

    /** Gehört die Wiedergabe zu dieser Adresse und steht der Spieler bereit? */
    fun hat(mxc: String) = mp != null && _zustand.value?.mxc == mxc

    private fun ende() {
        ticker?.cancel()
        runCatching { mp?.release() }
        mp = null
        fokus.abgeben()
    }

    fun stopp() {
        ende()
        _zustand.value = null
    }
}

/** Was das Vorlesen gerade tut; `nr` ist das Stück, das spielt oder erwartet wird. */
data class VorleseStand(
    val anfrage: String,
    val titel: String,
    /** Wer spricht, mit Stimme: „Brian (Jonas)“ (App 2.3). */
    val stimme: String? = null,
    val nr: Int,
    val von: Int?,
    val spielt: Boolean,
    val pausiert: Boolean,
    /** Wartet auf Stück `nr` (vor Stück 1: „bereitet vor …“). */
    val wartet: Boolean,
    val fehler: String? = null,
    val abgebrochen: Boolean = false,
    val fertig: Boolean = false,
) {
    val vorbei: Boolean get() = fehler != null || abgebrochen || fertig
}

/**
 * Vorlesen mit Vocarium über den Hub (SCHNITTSTELLEN-app.md, App 2.2): Die App schickt die Anfrage in die
 * Lobby und spielt die Stücke der Reihe nach, sobald sie da sind. Fehlt das nächste Stück, wartet sie.
 */
class Vorleser(
    private val scope: CoroutineScope,
    private val ordner: File,
    private val fokus: Tonfokus,
    /** Die Anfrage an den Hub (oder, in der Vorschau, die Nachahmung), mit Sprecher und genannter Stimme. */
    private val senden: suspend (anfrage: String, text: String, quelle: Pair<String, String>?, sprecher: String?, stimme: String?) -> Unit,
    private val abbrechen: suspend (anfrage: String) -> Unit,
    /** Ein Stück laden (`mxc`), als WAV-Bytes. */
    private val laden: suspend (mxc: String) -> ByteArray,
) {
    private val _zustand = MutableStateFlow<VorleseStand?>(null)
    val zustand: StateFlow<VorleseStand?> = _zustand.asStateFlow()
    private val teile = HashMap<Int, File>()
    private var mp: MediaPlayer? = null
    private var wache: Job? = null
    private var fokusPause = false

    /** Wird vor dem Vorlesen aufgerufen, damit eine Audionachricht aufhört. */
    var vorStart: (() -> Unit)? = null

    fun starten(
        text: String,
        quelle: Pair<String, String>?,
        titel: String,
        sprecher: String? = null,
        stimme: String? = null,
        stimmeAnzeige: String? = null,
    ) {
        stopp(senden = false)
        vorStart?.invoke()
        val anfrage = UUID.randomUUID().toString()
        teile.clear()
        ordner.mkdirs()
        ordner.listFiles()?.forEach { it.delete() }
        _zustand.value = VorleseStand(anfrage, titel, stimmeAnzeige, nr = 1, von = null, spielt = false, pausiert = false, wartet = true)
        fokus.holen(
            Tonfokus.SPRACHE,
            onPause = { fokusPause = true; pause() },
            onWeiter = { if (fokusPause) weiter() },
            onStopp = { stopp() },
        )
        wachen(45_000, "Der Hub antwortet nicht. Kann er schon vorlesen?")
        scope.launch {
            try {
                senden(anfrage, text, quelle, sprecher, stimme)
            } catch (e: Exception) {
                if (_zustand.value?.anfrage == anfrage) fehler("Vorlesen liess sich nicht anfragen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    /** Ein Stück vom Hub; fremde Anfragen zählen nicht. */
    fun teil(c: JsonObject) {
        val z = _zustand.value ?: return
        if (c.str("anfrage") != z.anfrage || z.vorbei) return
        val von = c.zahl("von")?.toInt()
        c.str("fehler")?.let { f ->
            fehler(f)
            return
        }
        if (c.str("abgebrochen") == "true") {
            ende()
            _zustand.update { it?.copy(abgebrochen = true, spielt = false, wartet = false) }
            return
        }
        val nr = c.zahl("nr")?.toInt() ?: return
        val mxc = c.str("mxc") ?: return
        if (von != null) _zustand.update { it?.copy(von = von) }
        scope.launch {
            val datei = try {
                val bytes = laden(mxc)
                withContext(Dispatchers.IO) { File(ordner, "${z.anfrage}-$nr.wav").apply { writeBytes(bytes) } }
            } catch (e: Exception) {
                if (_zustand.value?.anfrage == z.anfrage) fehler("Stück $nr liess sich nicht laden: ${e.message ?: e.javaClass.simpleName}")
                return@launch
            }
            if (_zustand.value?.anfrage != z.anfrage) return@launch
            teile[nr] = datei
            val jetzt = _zustand.value ?: return@launch
            if (jetzt.wartet && jetzt.nr == nr && !jetzt.pausiert) spielen(nr)
        }
    }

    private fun wachen(ms: Long, text: String) {
        wache?.cancel()
        val anfrage = _zustand.value?.anfrage ?: return
        wache = scope.launch {
            delay(ms)
            val z = _zustand.value
            if (z != null && z.anfrage == anfrage && z.wartet && !z.vorbei) fehler(text)
        }
    }

    private fun spielen(nr: Int) {
        val datei = teile[nr] ?: return
        wache?.cancel()
        runCatching { mp?.release() }
        val p = MediaPlayer()
        try {
            p.setAudioAttributes(Tonfokus.SPRACHE)
            p.setDataSource(datei.absolutePath)
            p.prepare()
        } catch (e: Exception) {
            p.release()
            fehler("Stück $nr liess sich nicht abspielen.")
            return
        }
        p.setOnCompletionListener { naechstes() }
        p.start()
        mp = p
        _zustand.update { it?.copy(nr = nr, spielt = true, wartet = false) }
    }

    private fun naechstes() {
        val z = _zustand.value ?: return
        runCatching { mp?.release() }
        mp = null
        val nr = z.nr + 1
        if (z.von != null && nr > z.von) {
            ende()
            _zustand.update { it?.copy(spielt = false, wartet = false, fertig = true) }
            // Der Spieler verschwindet kurz danach von selbst.
            scope.launch {
                delay(2_500)
                if (_zustand.value?.anfrage == z.anfrage && _zustand.value?.fertig == true) _zustand.value = null
            }
            return
        }
        _zustand.update { it?.copy(nr = nr, spielt = false, wartet = true) }
        if (teile.containsKey(nr)) spielen(nr) else wachen(60_000, "Stück $nr kam nicht. Der Hub hat aufgehört zu antworten.")
    }

    fun pause() {
        val z = _zustand.value ?: return
        runCatching { if (mp?.isPlaying == true) mp?.pause() }
        _zustand.value = z.copy(pausiert = true, spielt = false)
    }

    fun weiter() {
        val z = _zustand.value ?: return
        if (z.vorbei) return
        vorStart?.invoke()
        fokusPause = false
        _zustand.value = z.copy(pausiert = false)
        val p = mp
        if (p != null) {
            runCatching { p.start() }
            _zustand.update { it?.copy(spielt = true) }
        } else if (teile.containsKey(z.nr)) {
            spielen(z.nr)
        }
    }

    private fun fehler(text: String) {
        ende()
        _zustand.update { it?.copy(fehler = text, spielt = false, wartet = false) }
    }

    private fun ende() {
        wache?.cancel()
        runCatching { mp?.release() }
        mp = null
        fokus.abgeben()
    }

    /** Stopp: Spieler weg; läuft die Anfrage noch, geht `abbrechen` an den Hub. */
    fun stopp(senden: Boolean = true) {
        val z = _zustand.value
        ende()
        _zustand.value = null
        teile.clear()
        if (senden && z != null && !z.vorbei) {
            scope.launch { runCatching { abbrechen(z.anfrage) } }
        }
    }
}
