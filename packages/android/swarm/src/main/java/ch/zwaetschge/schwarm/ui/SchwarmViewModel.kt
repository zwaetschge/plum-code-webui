package com.claudewebui.swarm.ui

import android.app.Application
import android.content.Context
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.swarm.data.Absturz
import com.claudewebui.swarm.data.Alarm
import com.claudewebui.swarm.data.AllgemeinStand
import com.claudewebui.swarm.data.Anhang
import com.claudewebui.swarm.data.AppRelease
import com.claudewebui.swarm.data.AppUpdate
import com.claudewebui.swarm.data.UpdateStand
import com.claudewebui.swarm.data.ChatArt
import com.claudewebui.swarm.data.Datei
import com.claudewebui.swarm.data.ModellBefehl
import com.claudewebui.swarm.data.ModellWahl
import com.claudewebui.swarm.data.VorschauMedien
import com.claudewebui.swarm.data.Auftrag
import com.claudewebui.swarm.data.Beleg
import com.claudewebui.swarm.data.BrianHilfe
import com.claudewebui.swarm.data.Bilder
import com.claudewebui.swarm.data.Bildwahl
import com.claudewebui.swarm.data.Chat
import com.claudewebui.swarm.data.ChatZustand
import com.claudewebui.swarm.data.Lesestand
import com.claudewebui.swarm.data.Entscheidung
import com.claudewebui.swarm.data.EntscheidungsArt
import com.claudewebui.swarm.data.FAVORITEN_MAX
import com.claudewebui.swarm.data.Freigabe
import com.claudewebui.swarm.data.Lebenslauf
import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.NotAusAntwort
import com.claudewebui.swarm.data.NotAusDraht
import com.claudewebui.swarm.data.NotAusSchluessel
import com.claudewebui.swarm.data.NotAusSpeicher
import com.claudewebui.swarm.data.NotausInfo
import com.claudewebui.swarm.data.SchwarmDienst
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Ruhe
import com.claudewebui.swarm.data.KontoEinstellungen
import com.claudewebui.swarm.data.Schnappschuss
import com.claudewebui.swarm.data.Sitzung
import com.claudewebui.swarm.data.Sitzungsspeicher
import com.claudewebui.swarm.data.StandSpeicher
import com.claudewebui.swarm.data.Verbindung
import com.claudewebui.swarm.data.Vorlage
import com.claudewebui.swarm.widget.AktuellWidget
import com.claudewebui.swarm.data.VorlagenSpeicher
import com.claudewebui.swarm.data.VorlagenText
import com.claudewebui.swarm.data.Vorschau
import com.claudewebui.swarm.data.VorschauArt
import com.claudewebui.swarm.data.base64url
import com.claudewebui.swarm.data.matrix.MatrixClient
import com.claudewebui.swarm.data.matrix.MatrixFehler
import com.claudewebui.swarm.data.matrix.SchwarmJson
import com.claudewebui.swarm.data.ChatEinstellung
import com.claudewebui.swarm.data.ChatTreffer
import com.claudewebui.swarm.hintergrund.Hintergrund
import com.claudewebui.swarm.hintergrund.RuheSpeicher
import com.claudewebui.swarm.widget.FavoritenWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.security.MessageDigest
import com.claudewebui.swarm.hintergrund.PushStand
import com.claudewebui.swarm.hintergrund.PushVerbindung
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

data class AnmeldeZustand(val laeuft: Boolean = false, val fehler: String? = null)

/** Wohin die Oberfläche springen soll, etwa nach dem Tippen auf eine Benachrichtigung. */
sealed interface Sprung {
    data object FREIGABEN : Sprung
    /** Ein Chat in Allgemein, etwa aus „Brian hat geantwortet“. */
    data class ChatS(val wurzel: String) : Sprung
    /** „Teilen → Schwarm“: ein neuer Chat in Allgemein, vorbelegt mit [SchwarmViewModel.geteilt]. */
    data object GETEILT : Sprung
    /** App-Kürzel (App 2.5): gleich ein neuer Chat, ein neuer Auftrag oder „Aktuell“. */
    data object NEUER_CHAT : Sprung
    data object NEUER_AUFTRAG : Sprung
    data object AKTUELL : Sprung
    /** Schnellkachel „Not-Aus“: die App mit der Rückfrage zum Not-Aus. */
    data object NOTAUS : Sprung
}

/** Ein Auftrag, der noch [BEDENKZEIT_MS] auf „Rückgängig“ wartet (App 2.5). */
data class Ausstehend(val id: Long, val text: String)

/** So lange lässt sich ein eben gegebener Auftrag zurückholen, bevor er in die Lobby geht. */
const val BEDENKZEIT_MS = 5_000L

/** Nach so langer Zeit im Hintergrund fragt die App-Sperre wieder (App 2.7). */
const val SPERRE_NACH_MS = 5 * 60_000L

/** Was eine andere App mit „Teilen“ geschickt hat: Text, ein Bild oder beides. */
data class Geteilt(val text: String, val bild: Uri?)

/** Ein Bild aus Allgemein, das gerade lädt, da ist oder nicht zu holen war. */
sealed interface BildLadung {
    data object Laeuft : BildLadung
    data class Fertig(val bild: ImageBitmap) : BildLadung
    data class Fehler(val grund: String) : BildLadung
}

/** Ein Anhang, der gerade lädt, geladen ist oder nicht zu holen war. */
sealed interface Ladung {
    data object Laeuft : Ladung
    data class Fertig(val text: String) : Ladung
    data class Fehler(val grund: String) : Ladung
}

/** Was die App vom Not-Aus ohne Matrix weiss (Punkt 18). */
data class NotAusZustand(
    val schluessel: Boolean = false,
    /** Der Schlüssel verlangt Biometrie oder PIN (nur mit Displaysperre möglich). */
    val mitBiometrie: Boolean = false,
    val geraetId: String? = null,
    val name: String? = null,
    /** Die Adresse aus dem Event des Hubs, lokal gespeichert, damit sie ohne Matrix bekannt ist. */
    val url: String? = null,
    /** Die Geräte-ID stand im Event des Hubs. */
    val angemeldet: Boolean = false,
    val laeuft: Boolean = false,
    val antwort: NotAusAntwort? = null,
    val vorschau: Boolean = false,
) {
    /** Der direkte Weg ist möglich: Schlüssel auf dem Gerät und eine Adresse vom Hub. */
    val bereit: Boolean get() = schluessel && url != null && geraetId != null
}

class SchwarmViewModel(app: Application) : AndroidViewModel(app) {
    private val speicher = Sitzungsspeicher(app)
    private val standSpeicher = runCatching { StandSpeicher(app) }.getOrNull()
    private val vorlagenSpeicher = VorlagenSpeicher(app)
    private val notAusSpeicher = NotAusSpeicher(app)

    private val _sitzung = MutableStateFlow(speicher.laden())
    val sitzung: StateFlow<Sitzung?> = _sitzung.asStateFlow()

    private val _schwarm = MutableStateFlow(SchwarmZustand())
    val schwarm: StateFlow<SchwarmZustand> = _schwarm.asStateFlow()

    private val _meldungen = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val meldungen: SharedFlow<String> = _meldungen.asSharedFlow()

    private val _anmeldung = MutableStateFlow(AnmeldeZustand())
    val anmeldung: StateFlow<AnmeldeZustand> = _anmeldung.asStateFlow()

    private val _vorschau = MutableStateFlow(false)
    val vorschau: StateFlow<Boolean> = _vorschau.asStateFlow()

    private val _vorschauArt = MutableStateFlow(VorschauArt())
    val vorschauArt: StateFlow<VorschauArt> = _vorschauArt.asStateFlow()

    private val _sprung = MutableStateFlow<Sprung?>(null)
    val sprung: StateFlow<Sprung?> = _sprung.asStateFlow()

    private val _unterwegs = MutableStateFlow<Set<String>>(emptySet())
    /** Reaktionen auf Freigaben, Alarme, Pläne und Tore, die gerade rausgehen (`eventId|zeichen`). */
    val unterwegs: StateFlow<Set<String>> = _unterwegs.asStateFlow()

    private val _vorlagen = MutableStateFlow(vorlagenSpeicher.alle())
    /** Vorlagen und Favoriten, nur auf diesem Gerät (Punkt 19). */
    val vorlagen: StateFlow<List<Vorlage>> = _vorlagen.asStateFlow()

    private val _vorlageStart = MutableStateFlow<String?>(null)
    /** Ein Favorit aus dem Widget: Die Oberfläche fragt die Platzhalter ab und schickt ihn. */
    val vorlageStart: StateFlow<String?> = _vorlageStart.asStateFlow()

    private val _notAus = MutableStateFlow(notAusLesen())
    val notAus: StateFlow<NotAusZustand> = _notAus.asStateFlow()

    private val _dateien = MutableStateFlow<Map<String, Ladung>>(emptyMap())
    /** Geladene Anhänge je `mxc://`-Adresse, etwa Patches. */
    val dateien: StateFlow<Map<String, Ladung>> = _dateien.asStateFlow()

    private val _entsperrt = MutableStateFlow<Set<String>>(emptySet())
    /** Adressen, deren `!entsperren` in dieser Sitzung rausging. */
    val entsperrt: StateFlow<Set<String>> = _entsperrt.asStateFlow()

    private val _bilder = MutableStateFlow<Map<String, BildLadung>>(emptyMap())
    /** Bilder aus Allgemein je `mxc://`-Adresse. */
    val bilder: StateFlow<Map<String, BildLadung>> = _bilder.asStateFlow()

    private val _allgemeinFehler = MutableStateFlow<String?>(null)
    /** Warum Allgemein nicht eingerichtet werden konnte. */
    val allgemeinFehler: StateFlow<String?> = _allgemeinFehler.asStateFlow()

    private val _geteilt = MutableStateFlow<Geteilt?>(null)
    /** „Teilen → Schwarm“: wartet, bis der neue Chat ihn übernimmt. */
    val geteilt: StateFlow<Geteilt?> = _geteilt.asStateFlow()

    private val _sendet = MutableStateFlow(false)
    /** Ein Bild oder eine Nachricht in Allgemein ist unterwegs. */
    val sendet: StateFlow<Boolean> = _sendet.asStateFlow()

    // ── App 2.2: Dateien, Ton, Vorlesen, Modelle ─────────────────────────────

    private val prefs = app.getSharedPreferences("einstellungen", Context.MODE_PRIVATE)
    private val tonfokus = Tonfokus(app)
    private val abspieler = Abspieler(viewModelScope, tonfokus)
    /** Die Audionachricht, die gerade spielt oder lädt. */
    val wiedergabe: StateFlow<Wiedergabe?> = abspieler.zustand
    private val vorleser = Vorleser(
        viewModelScope, File(app.cacheDir, "vorlesen"), tonfokus,
        senden = { anfrage, text, quelle, sprecher, stimme -> vorleseAnfrage(anfrage, text, quelle, sprecher, stimme) },
        abbrechen = { anfrage -> if (!_vorschau.value) dienst?.vorlesenAbbrechen(anfrage) },
        laden = { mxc -> vorleseStueck(mxc) },
    )
    /** Das Vorlesen mit Vocarium: Stück x von y, Pause, Fehler. */
    val vorlesen: StateFlow<VorleseStand?> = vorleser.zustand

    private val _medien = MutableStateFlow<Map<String, Ladung>>(emptyMap())
    /** Heruntergeladene Dateien je `mxc://`: läuft, fertig (Pfad) oder Fehler. */
    val medien: StateFlow<Map<String, Ladung>> = _medien.asStateFlow()
    private val medienSperre = Mutex()

    private val _antwortenVorlesen = MutableStateFlow(prefs.getBoolean("antworten_vorlesen", false))
    /** In Allgemein: Brians Schlussantworten vorlesen, solange die App vorne ist. */
    val antwortenVorlesen: StateFlow<Boolean> = _antwortenVorlesen.asStateFlow()
    private val schonVorgelesen = HashSet<String>()
    private var vorlesenBereit = false

    private val _pdfSeiten = MutableStateFlow(prefs.getBoolean("pdf_seiten", true))
    /** In Allgemein: zu einer PDF die ersten Seiten als Bilder für Brian mitschicken (Standard an). */
    val pdfSeiten: StateFlow<Boolean> = _pdfSeiten.asStateFlow()

    /** Der zuletzt offene Bereich unten (App 2.4): Die App geht dort wieder auf, wo du warst. */
    var letzterBereich: String?
        get() = prefs.getString("bereich", null)
        set(wert) = prefs.edit().putString("bereich", wert).apply()

    private val _ausstehend = MutableSharedFlow<Ausstehend>(extraBufferCapacity = 4)
    /** Für die Snackbar mit „Rückgängig“ (App 2.5). */
    val ausstehend: SharedFlow<Ausstehend> = _ausstehend.asSharedFlow()
    private val wartend = HashMap<Long, Pair<Job, suspend SchwarmDienst.() -> Unit>>()
    private var naechsteAusstehend = 0L

    private val _tagesberichtGelesen = MutableStateFlow(prefs.getString("tagesbericht_gelesen", null))
    /** Welchen Tagesbericht du in „Aktuell“ weggelegt hast (sein Datum). */
    val tagesberichtGelesen: StateFlow<String?> = _tagesberichtGelesen.asStateFlow()

    // ── Sofort-Benachrichtigungen (App 2.5) ──────────────────────────────────

    /** Stand beim Verteiler (etwa ntfy); was der Hub von der Adresse weiss, steht im Not-Aus-Event. */
    val push: StateFlow<PushStand> = PushVerbindung.stand
    private val _pushLaeuft = MutableStateFlow(false)
    val pushLaeuft: StateFlow<Boolean> = _pushLaeuft.asStateFlow()

    fun pushVerteiler(): List<Pair<String, String>> = PushVerbindung.verteiler(getApplication())

    /** Vor dem Signieren: Not-Aus-Adresse und angemeldetes Gerät, sonst ein Hinweis. */
    private fun pushVoraussetzung(): String? {
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – es wurde nichts eingerichtet.")
            return null
        }
        val stand = _notAus.value
        val url = stand.url
        if (url == null) {
            _meldungen.tryEmit("Der Hub hat noch keine Not-Aus-Adresse gemeldet.")
            return null
        }
        if (!stand.angemeldet) {
            _meldungen.tryEmit("Melde zuerst unter „Not-Aus ohne Matrix“ dieses Gerät an; mit demselben Schlüssel meldet die App die Push-Adresse.")
            return null
        }
        return url
    }

    /** Fingerabdruck, falls der Not-Aus-Schlüssel ihn verlangt. Liefert false, wenn nicht bestätigt. */
    private suspend fun pushBestaetigen(context: Context, text: String): Boolean {
        if (!NotAusSchluessel.mitBiometrie()) return true
        val (e, m) = Biometrie.bestaetigen(context, "Sofort-Benachrichtigungen", text)
        if (e != Biometrie.Ergebnis.OK) _meldungen.tryEmit(m ?: "Nicht bestätigt, nichts geändert.")
        return e == Biometrie.Ergebnis.OK
    }

    /**
     * Einrichten: beim Verteiler anmelden, auf die Adresse warten, sie mit dem Not-Aus-Schlüssel signiert beim Hub
     * anmelden und einen Matrix-Pusher setzen, damit auch Brians Antworten in Allgemein wecken (dort ist der Hub
     * nicht dabei). Ohne Pusher kommen sie wie bisher über den Hintergrund-Check.
     */
    fun pushEinrichten(context: Context) {
        if (_pushLaeuft.value) return
        val app = getApplication<Application>()
        // Die Vorschau meldet sich beim Verteiler an (das bleibt auf dem Gerät), aber nichts beim Hub.
        val url = if (_vorschau.value) null else (pushVoraussetzung() ?: return)
        val verteiler = PushVerbindung.verteiler(app).firstOrNull()?.first
        if (verteiler == null) {
            _meldungen.tryEmit("Keine Push-App gefunden. Installiere ntfy (F-Droid oder Play Store) und öffne sie einmal.")
            return
        }
        viewModelScope.launch {
            _pushLaeuft.value = true
            try {
                PushVerbindung.anmelden(app, verteiler)
                val s = withTimeoutOrNull(30_000) { PushVerbindung.stand.first { it.endpoint != null || it.fehler != null } }
                val endpoint = s?.endpoint
                if (endpoint == null) {
                    _meldungen.tryEmit(s?.fehler ?: "Der Verteiler hat keine Adresse geschickt. Ist ntfy eingerichtet?")
                    return@launch
                }
                if (url == null) {
                    _meldungen.tryEmit("Vorschau: Adresse von ${java.net.URI(endpoint).host} erhalten. Beim Hub wird nichts angemeldet.")
                    return@launch
                }
                if (!pushBestaetigen(context, "Push-Adresse beim Hub anmelden")) return@launch
                val antwort = withContext(Dispatchers.IO) { NotAusDraht.ausloesen(url, "push", endpoint) }
                if (!antwort.ok) {
                    _meldungen.tryEmit("Der Hub nimmt die Adresse nicht an: ${antwort.fehler ?: "Status ${antwort.status}"}")
                    return@launch
                }
                val adresse = java.net.URI(endpoint)
                val gateway = "${adresse.scheme}://${adresse.authority}/_matrix/push/v1/notify"
                val pusher = runCatching { dienst?.pusherSetzen(endpoint, gateway, Build.MODEL ?: "Android") }.isSuccess && dienst != null
                _meldungen.tryEmit(
                    "Sofort-Benachrichtigungen eingerichtet (${adresse.host})." +
                        if (pusher) "" else " Brians Antworten in Allgemein kommen wie bisher über den Hintergrund-Check.",
                )
            } catch (e: Exception) {
                _meldungen.tryEmit("Einrichten fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                _pushLaeuft.value = false
            }
        }
    }

    /** Der Hub schickt sofort einen Weckruf an dieses Gerät. */
    fun pushTesten(context: Context) {
        if (_pushLaeuft.value) return
        val url = pushVoraussetzung() ?: return
        viewModelScope.launch {
            _pushLaeuft.value = true
            try {
                if (!pushBestaetigen(context, "Test-Weckruf anfordern")) return@launch
                val ab = System.currentTimeMillis()
                val a = withContext(Dispatchers.IO) { NotAusDraht.ausloesen(url, "push-test") }
                if (a.ok) _pushTestAb.value = ab
                _meldungen.tryEmit(
                    if (a.ok) "Test-Weckruf ist raus. Kommt er an, steht unten „zuletzt geweckt“ mit der Uhrzeit."
                    else "Test fehlgeschlagen: ${a.fehler ?: "Status ${a.status}"}",
                )
            } catch (e: Exception) {
                _meldungen.tryEmit("Test fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                _pushLaeuft.value = false
            }
        }
    }

    /** Ausschalten: beim Hub abmelden (wenn bestätigt), beim Verteiler abmelden und den Matrix-Pusher entfernen. */
    fun pushAus(context: Context) {
        if (_pushLaeuft.value) return
        val app = getApplication<Application>()
        val endpoint = PushVerbindung.stand.value.endpoint
        viewModelScope.launch {
            _pushLaeuft.value = true
            try {
                val url = _notAus.value.url
                if (url != null && _notAus.value.angemeldet && !_vorschau.value && pushBestaetigen(context, "Push-Adresse beim Hub abmelden")) {
                    runCatching { withContext(Dispatchers.IO) { NotAusDraht.ausloesen(url, "push-weg") } }
                }
                if (endpoint != null) {
                    val adresse = runCatching { java.net.URI(endpoint) }.getOrNull()
                    if (adresse != null) {
                        runCatching { dienst?.pusherSetzen(endpoint, "${adresse.scheme}://${adresse.authority}/_matrix/push/v1/notify", "", loeschen = true) }
                    }
                }
                PushVerbindung.abmelden(app)
                _meldungen.tryEmit("Sofort-Benachrichtigungen aus. Die App prüft wieder alle 15 min.")
            } finally {
                _pushLaeuft.value = false
            }
        }
    }

    // ── Einrichtung und Diagnose (App 2.9) ────────────────────────────────────

    private val _einrichtungErledigt = MutableStateFlow(prefs.getStringSet("einrichtung_erledigt", emptySet())!!.toSet())
    /** Von Hand abgehakte Schritte der Einrichtung (was die App nicht selbst sehen kann). */
    val einrichtungErledigt: StateFlow<Set<String>> = _einrichtungErledigt.asStateFlow()

    fun einrichtungAbhaken(id: String, an: Boolean) {
        val neu = if (an) _einrichtungErledigt.value + id else _einrichtungErledigt.value - id
        _einrichtungErledigt.value = neu
        prefs.edit().putStringSet("einrichtung_erledigt", neu).apply()
        einstellungenSichern()
    }

    private val _einrichtungSpaeter = MutableStateFlow(prefs.getLong("einrichtung_spaeter", 0L))
    /** Bis wann die Karte „Einrichtung“ in „Aktuell“ ausgeblendet ist (ms). */
    val einrichtungSpaeter: StateFlow<Long> = _einrichtungSpaeter.asStateFlow()

    fun einrichtungSpaeterSetzen() {
        val bis = System.currentTimeMillis() + 24 * 3_600_000L
        _einrichtungSpaeter.value = bis
        prefs.edit().putLong("einrichtung_spaeter", bis).apply()
    }

    // ── Einstellungen im Konto (App 2.9) ──────────────────────────────────────

    private var sichernJob: Job? = null

    /** Nach einer Änderung: kurz sammeln, dann den ganzen Stand als Konto-Daten schreiben. */
    private fun einstellungenSichern() {
        if (_vorschau.value) return
        sichernJob?.cancel()
        sichernJob = viewModelScope.launch {
            delay(1_500)
            val k = KontoEinstellungen(
                zeit = System.currentTimeMillis(),
                geraet = _sitzung.value?.deviceId,
                vorlagen = _vorlagen.value,
                antwortenVorlesen = _antwortenVorlesen.value,
                pdfSeiten = _pdfSeiten.value,
                screenshotsSperren = _screenshotsSperren.value,
                einrichtungErledigt = _einrichtungErledigt.value.sorted(),
            )
            prefs.edit().putLong("konto_zeit", k.zeit).apply()
            val inhalt = SchwarmJson.encodeToJsonElement(KontoEinstellungen.serializer(), k) as JsonObject
            aktion(null) { kontoEinstellungenSetzen(inhalt) }
        }
    }

    /** Ein neuerer Stand aus dem Konto (anderes Gerät, Neuinstallation) gewinnt über den lokalen. */
    private fun kontoEinstellungenUebernehmen(inhalt: JsonObject) {
        val k = runCatching { SchwarmJson.decodeFromJsonElement(KontoEinstellungen.serializer(), inhalt) }.getOrNull() ?: return
        if (k.v != 1 || k.zeit <= prefs.getLong("konto_zeit", 0L)) return
        prefs.edit().putLong("konto_zeit", k.zeit).apply()
        k.vorlagen?.let { if (it != _vorlagen.value) { _vorlagen.value = it; vorlagenSpeicher.speichern(it); FavoritenWidget.aktualisieren(getApplication()) } }
        k.antwortenVorlesen?.let { _antwortenVorlesen.value = it; prefs.edit().putBoolean("antworten_vorlesen", it).apply() }
        k.pdfSeiten?.let { _pdfSeiten.value = it; prefs.edit().putBoolean("pdf_seiten", it).apply() }
        k.screenshotsSperren?.let { _screenshotsSperren.value = it; prefs.edit().putBoolean("screenshots_sperren", it).apply() }
        k.einrichtungErledigt?.toSet()?.let { _einrichtungErledigt.value = it; prefs.edit().putStringSet("einrichtung_erledigt", it).apply() }
    }

    private val _betriebLauf = MutableStateFlow<BetriebLauf?>(null)
    /** Der letzte Befehl an den Worker betrieb aus dem Bildschirm „Betrieb“ (App 2.9). */
    val betriebLauf: StateFlow<BetriebLauf?> = _betriebLauf.asStateFlow()

    fun betriebAusfuehren(faehigkeit: String, ziel: String, zusatz: String = "") {
        _betriebLauf.value = BetriebLauf(faehigkeit, ziel, System.currentTimeMillis())
        if (_vorschau.value) return
        befehlMitAntwort(listOf("!aktion", faehigkeit, ziel, zusatz).filter { it.isNotBlank() }.joinToString(" ")) {}
    }

    private val _pushTestAb = MutableStateFlow<Long?>(null)
    /** Wann der letzte Test-Weckruf angefordert wurde; die Diagnose misst daran die Laufzeit. */
    val pushTestAb: StateFlow<Long?> = _pushTestAb.asStateFlow()

    private var gemerkteRuhe: Ruhe? = null

    /** Die Ruhezeit des Hubs für die Hintergrundprüfung ablegen, nur aus einem frischen Sync. */
    private fun ruheMerken(z: SchwarmZustand) {
        if (z.verbindung != Verbindung.BEREIT || z.ausSpeicher != null || z.zuletztSync <= 0) return
        val r = z.hub.ruhe
        if (r == gemerkteRuhe) return
        gemerkteRuhe = r
        RuheSpeicher.speichern(getApplication(), r)
    }

    // ── Sprachmodus (App 2.7) ─────────────────────────────────────────────────

    private val _sprachmodus = MutableStateFlow<String?>(null)
    /** Der Chat im Sprachmodus (Wurzel, „neu“ für einen neuen Chat), oder null. */
    val sprachmodus: StateFlow<String?> = _sprachmodus.asStateFlow()

    fun sprachmodusSetzen(wurzel: String?) {
        _sprachmodus.value = wurzel
        if (wurzel == null) vorleser.stopp()
    }

    // ── App-Sperre (App 2.7) ──────────────────────────────────────────────────

    /** Fingerabdruck oder Gerätesperre, bevor die App etwas zeigt; sie kann freigeben und den Not-Aus auslösen. */
    var appSperre: Boolean
        get() = prefs.getBoolean("app_sperre", false)
        set(an) {
            prefs.edit().putBoolean("app_sperre", an).apply()
            if (!an) _gesperrt.value = false
        }
    private var letzterStopp = 0L
    private val _gesperrt = MutableStateFlow(false)
    val gesperrt: StateFlow<Boolean> = _gesperrt.asStateFlow()

    fun entsperren() {
        _gesperrt.value = false
    }

    // ── Screenshots blockieren (Punkt 5, App 2.8) ──────────────────────────

    private val _screenshotsSperren = MutableStateFlow(prefs.getBoolean("screenshots_sperren", false))
    /**
     * Die ganze App vor Screenshots und der Vorschau der letzten Apps schützen (`FLAG_SECURE`). Aus ist der
     * Standard, damit du weiterhin Bildschirmfotos schicken kannst; Freigaben, der Not-Aus und die Sperre
     * sind immer geschützt.
     */
    val screenshotsSperren: StateFlow<Boolean> = _screenshotsSperren.asStateFlow()

    fun screenshotsSperrenSetzen(an: Boolean) {
        prefs.edit().putBoolean("screenshots_sperren", an).apply()
        _screenshotsSperren.value = an
        einstellungenSichern()
    }

    private val _sicher = MutableStateFlow<Set<String>>(emptySet())
    /** Solange eine Quelle `true` meldet, setzt die Wurzel `FLAG_SECURE` auf das Fenster. */
    val sicher: StateFlow<Boolean> = _sicher.map { it.isNotEmpty() }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    /** Eine Quelle meldet, ob gerade etwas Folgenreiches zu sehen ist („sperre“, „ansicht“, „notaus“). */
    fun sicherSetzen(quelle: String, aktiv: Boolean) {
        _sicher.update { if (aktiv) it + quelle else it - quelle }
    }

    // ── Update der App und Abstürze (Punkt 20, App 2.8) ────────────────────

    /** Die laufende Version: `versionCode` und `versionName`, für den Vergleich mit dem veröffentlichten Stand. */
    val eigeneVersion: Pair<Int, String> = Absturz.version(app)

    private val _update = MutableStateFlow<UpdateStand>(UpdateStand.Untaetig)
    /** Wo das Laden der neuen APK steht. */
    val update: StateFlow<UpdateStand> = _update.asStateFlow()

    /** Die veröffentlichte APK, wenn sie neuer ist als die laufende; sonst null. */
    fun neueVersion(z: SchwarmZustand = _schwarm.value): AppRelease? =
        z.hub.app?.takeIf { AppUpdate.neuer(it, eigeneVersion.first) }

    /** Die neue APK über den Server laden, prüfen und dem Paketinstallierer geben. */
    fun appUpdateLaden() {
        if (_update.value is UpdateStand.Laedt) return
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – es wurde nichts geladen.")
            return
        }
        val r = neueVersion() ?: return
        val d = dienst
        if (d == null) {
            _meldungen.tryEmit("Ohne Verbindung zum Server geht das nicht.")
            return
        }
        val context = getApplication<Application>()
        AppUpdate.vorhanden(context, r)?.let { _update.value = UpdateStand.Untaetig; return }
        _update.value = UpdateStand.Laedt
        viewModelScope.launch {
            val datei = try {
                withContext(Dispatchers.IO) {
                    val geladen = AppUpdate.datei(context, r)
                    geladen.writeBytes(d.appApk(r.mxc))
                    AppUpdate.aufraeumen(context, geladen)
                    AppUpdate.pruefen(geladen, r)?.let { throw IllegalStateException(it) }
                    geladen
                }
            } catch (e: MatrixFehler) {
                _update.value = UpdateStand.Fehler(
                    if (e.status == 404) "Die Datei liegt nicht mehr auf dem Server." else "Laden fehlgeschlagen: ${e.message}",
                )
                null
            } catch (e: Exception) {
                _update.value = UpdateStand.Fehler("Laden fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
                null
            }
            if (datei != null) {
                _update.value = UpdateStand.Untaetig
                appInstallieren(datei)
            }
        }
    }

    /** Eine geladene APK installieren; ohne `datei` die aus dem Cache (dann mit voller Prüfung). */
    fun appInstallieren(datei: File? = null) {
        val context = getApplication<Application>()
        val r = neueVersion() ?: return
        val f = datei ?: AppUpdate.vorhanden(context, r) ?: return
        if (datei == null) {
            AppUpdate.pruefen(f, r)?.let {
                _update.value = UpdateStand.Fehler(it)
                _meldungen.tryEmit("Die APK im Cache ist nicht heil: $it")
                return
            }
        }
        if (!AppUpdate.quelleErlaubt(context)) {
            _meldungen.tryEmit("Android braucht zuerst die Erlaubnis, Apps aus unbekannten Quellen zu installieren.")
            AppUpdate.quelleOeffnen(context)
            return
        }
        if (!AppUpdate.installieren(context, f)) {
            _meldungen.tryEmit("Installieren ging nicht. Die geprüfte APK liegt im Cache der App.")
        }
    }

    /** Die Erlaubnis für unbekannte Quellen in den Android-Einstellungen öffnen. */
    fun appQuelleOeffnen() = AppUpdate.quelleOeffnen(getApplication())

    private var absturzGemeldet = false

    /**
     * Liegen Abstürze auf dem Gerät, gehen sie als Notice nach #schwarm-log — ohne Inhalt, nur Version,
     * Ausnahme und die obersten Frames (Punkt 20). Ein Versuch je Start; bleibt der Raum weg, bleibt die Datei.
     */
    private fun abstuerzeMelden(z: SchwarmZustand) {
        if (absturzGemeldet || _vorschau.value || z.raeume.log == null || z.verbindung != Verbindung.BEREIT) return
        val d = dienst ?: return
        val faelle = Absturz.faelle(getApplication())
        if (faelle.isEmpty()) {
            absturzGemeldet = true
            return
        }
        absturzGemeldet = true
        viewModelScope.launch {
            faelle.forEach { f ->
                val text = runCatching { f.readText() }.getOrNull()?.trim()?.take(420) ?: return@forEach
                if (text.isEmpty()) return@forEach
                if (runCatching { d.logNotice(text) }.isSuccess) Absturz.loeschen(f)
            }
        }
    }

    // ── Chats verwalten und durchsuchen (App 2.7) ────────────────────────────

    /** Umbenennen, anheften, archivieren. Gespeichert in den Account-Daten; in der Vorschau nur auf dem Gerät. */
    fun chatEinstellen(wurzel: String, neu: ChatEinstellung) {
        if (_vorschau.value) {
            _schwarm.update { z ->
                val alt = z.allgemein.einstellungen
                z.copy(allgemein = z.allgemein.copy(einstellungen = if (neu.leer) alt - wurzel else alt + (wurzel to neu)))
            }
            return
        }
        aktion(null) { chatEinstellen(wurzel, neu) }
    }

    private val _chatTreffer = MutableStateFlow<Pair<String, List<ChatTreffer>>?>(null)
    /** Die Suche von Synapse: der Begriff und seine Treffer, auch in nicht geladenen Chats. */
    val chatTreffer: StateFlow<Pair<String, List<ChatTreffer>>?> = _chatTreffer.asStateFlow()

    fun chatsSuchen(begriff: String) {
        val b = begriff.trim()
        if (b.length < 3) {
            _chatTreffer.value = null
            return
        }
        val d = dienst
        if (d == null) {
            _chatTreffer.value = b to emptyList()
            return
        }
        viewModelScope.launch {
            val treffer = runCatching { d.chatsSuchen(b) }.getOrElse {
                _meldungen.tryEmit("Suche fehlgeschlagen: ${it.message ?: it.javaClass.simpleName}")
                emptyList()
            }
            _chatTreffer.value = b to treffer
        }
    }

    // ── Abo-Stand mit Knopf (App 2.5) ────────────────────────────────────────

    private val _aboVorher = MutableStateFlow(
        prefs.all.filterKeys { it.startsWith("abo_vorher_") }
            .mapNotNull { (k, v) -> (v as? String)?.let { k.removePrefix("abo_vorher_") to it } }.toMap(),
    )
    /** Welches Modell ein Agent vor dem Umstellen über den Abo-Knopf hatte: für „zurück nach dem Reset“. */
    val aboVorher: StateFlow<Map<String, String>> = _aboVorher.asStateFlow()

    /**
     * Ein Modell über den Abo-Knopf umstellen. Mit `vorher` merkt sich die App das alte Modell, damit sie nach dem
     * Reset des Abos zurück anbieten kann; ohne (beim Zurückstellen) vergisst sie es.
     */
    fun aboUmstellen(agent: String, befehl: String, vorher: String?, onGesendet: (String) -> Unit) {
        befehlMitAntwort(befehl, onGesendet)
        val schluessel = "abo_vorher_$agent"
        if (vorher != null) prefs.edit().putString(schluessel, vorher).apply() else prefs.edit().remove(schluessel).apply()
        _aboVorher.update { if (vorher != null) it + (agent to vorher) else it - agent }
    }

    fun tagesberichtWeglegen(tag: String) {
        _tagesberichtGelesen.value = tag
        prefs.edit().putString("tagesbericht_gelesen", tag).apply()
    }

    fun pdfSeitenSetzen(an: Boolean) {
        _pdfSeiten.value = an
        prefs.edit().putBoolean("pdf_seiten", an).apply()
        einstellungenSichern()
    }

    private val _chatModelle = MutableStateFlow(chatModelleLesen())
    /** Das Modell je Chat in Allgemein (Wurzel → Modell-ID), nur auf diesem Gerät. */
    val chatModelle: StateFlow<Map<String, String>> = _chatModelle.asStateFlow()

    init {
        abspieler.vorStart = { vorleser.stopp() }
        vorleser.vorStart = { abspieler.stopp() }
        PushVerbindung.laden(app)
        // Das Widget „Braucht dich“ (App 2.5) folgt dem Stand, auch in der Vorschau.
        viewModelScope.launch {
            var letzter: String? = null
            _schwarm.collect { z ->
                if (z.ich.isEmpty() && !_vorschau.value) return@collect
                val w = AktuellWidget.inhalt(z)
                val schluessel = "${w.zahl}|${w.zeile}"
                if (schluessel != letzter) {
                    letzter = schluessel
                    AktuellWidget.speichern(getApplication(), w)
                }
            }
        }
    }

    private var allgemeinVersucht = false
    /** Zuletzt gemeldete Lesebestätigung je `raum|thread`, damit dieselbe nicht zweimal rausgeht. */
    private val gelesenGesendet = HashMap<String, String>()
    /** Die Lesestände der Vorschau, damit „Alles gelesen“ und Co. auch dort etwas tun. */
    private var vorschauLesestaende: Map<String, Lesestand> = emptyMap()

    private var dienst: SchwarmDienst? = null
    private var spiegel: Job? = null
    private var vordergrund = false
    private var letztesNotaus: NotausInfo? = null
    private var gemerkt: Schnappschuss? = null

    val letzterBenutzer: String get() = speicher.letzterBenutzer ?: "zwaetschge"
    val letzterServer: String get() = speicher.letzterServer ?: "zwaetschge-webui.ch"

    var benachrichtigungen: Boolean
        get() = speicher.benachrichtigungen
        set(an) {
            speicher.benachrichtigungen = an
            Hintergrund.planen(getApplication(), an)
        }

    init {
        _sitzung.value?.let { starten(it) }
    }

    private fun starten(s: Sitzung) {
        dienst?.schliessen()
        val d = SchwarmDienst(s, viewModelScope, standSpeicher?.laden()?.takeIf { it.zeit > 0 })
        d.beiAbmeldung = { viewModelScope.launch { lokalAbmelden("Die Sitzung ist abgelaufen. Bitte neu anmelden.") } }
        dienst = d
        spiegel?.cancel()
        spiegel = viewModelScope.launch {
            launch { d.vorleseTeile.collect { vorleser.teil(it) } }
            launch { d.kontoEinstellungen.collect { it?.let(::kontoEinstellungenUebernehmen) } }
            // Noch nichts im Konto (erstes Gerät mit App 2.9): den lokalen Stand einmal hochladen.
            launch {
                delay(20_000)
                if (d.kontoEinstellungen.value == null && d.zustand.value.verbindung == Verbindung.BEREIT) einstellungenSichern()
            }
            d.zustand.collect { z ->
                _schwarm.value = z
                notAusAbgleichen(z, s)
                standMerken(z)
                ruheMerken(z)
                antwortenAutomatischVorlesen(z)
                abstuerzeMelden(z)
            }
        }
        if (vordergrund) d.starten()
    }

    /**
     * Long-Poll nur im Vordergrund; im Hintergrund prüft WorkManager alle 15 min. Arbeitet Brian gerade
     * an einem Chat, liest ein Worker bis zu 9 min weiter und meldet seine Antwort (App 2.1).
     */
    fun vordergrund(an: Boolean) {
        vordergrund = an
        val app = getApplication<Application>()
        if (an) {
            // App-Sperre (App 2.7): beim ersten Start und nach 5 min im Hintergrund.
            if (appSperre && (letzterStopp == 0L || System.currentTimeMillis() - letzterStopp > SPERRE_NACH_MS)) _gesperrt.value = true
            dienst?.starten()
            Hintergrund.nichtMehrWarten(app)
            return
        }
        letzterStopp = System.currentTimeMillis()
        val d = dienst
        d?.anhalten()
        val wartend = _schwarm.value.allgemein.chats
            .filter { it.zustand == ChatZustand.ARBEITET || it.zustand == ChatZustand.GESENDET }
            .map { it.wurzel }
        if (d != null && !_vorschau.value && wartend.isNotEmpty() && speicher.benachrichtigungen) {
            Hintergrund.aufBrianWarten(app, d.syncStand, wartend)
        }
    }

    fun springen(ziel: Sprung) {
        _sprung.value = ziel
    }

    fun gesprungen() {
        _sprung.value = null
    }

    fun anmelden(server: String, benutzer: String, passwort: String) {
        if (_anmeldung.value.laeuft) return
        viewModelScope.launch {
            _anmeldung.value = AnmeldeZustand(laeuft = true)
            try {
                val basis = homeserverFinden(server.trim())
                val name = benutzer.trim().removePrefix("@").substringBefore(':')
                val client = MatrixClient(basis)
                val antwort = try {
                    client.login(name, passwort, "Schwarm · ${Build.MODEL}")
                } finally {
                    client.schliessen()
                }
                val s = Sitzung(basis, antwort.userId, antwort.accessToken, antwort.deviceId)
                speicher.speichern(s)
                speicher.letzterBenutzer = name
                speicher.letzterServer = server.trim()
                speicher.hintergrundSince = null
                _sitzung.value = s
                _anmeldung.value = AnmeldeZustand()
                starten(s)
                Hintergrund.planen(getApplication(), speicher.benachrichtigungen)
            } catch (e: MatrixFehler) {
                _anmeldung.value = AnmeldeZustand(
                    fehler = when (e.errcode) {
                        "M_FORBIDDEN" -> "Benutzername oder Passwort stimmt nicht."
                        "M_LIMIT_EXCEEDED" -> "Zu viele Versuche. Bitte kurz warten."
                        "M_USER_DEACTIVATED" -> "Dieses Konto ist deaktiviert."
                        else -> e.message ?: "Anmeldung fehlgeschlagen."
                    },
                )
            } catch (e: Exception) {
                _anmeldung.value = AnmeldeZustand(fehler = "Server nicht erreichbar: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    private suspend fun homeserverFinden(eingabe: String): String {
        val roh = eingabe.ifBlank { "zwaetschge-webui.ch" }.removeSuffix("/")
        if (roh.startsWith("https://")) return roh
        if (roh.startsWith("http://")) throw IllegalArgumentException("Nur HTTPS ist erlaubt.")
        val probe = MatrixClient("https://$roh")
        try {
            probe.wellKnown(roh)?.let { return it.trimEnd('/') }
            if (probe.versionen()) return "https://$roh"
        } finally {
            probe.schliessen()
        }
        throw IllegalStateException("Unter $roh antwortet kein Matrix-Server.")
    }

    // ── Vorschau ─────────────────────────────────────────────────────────────

    /** Beispieldaten ohne Anmeldung: nichts geht ans Netz, nichts wird gespeichert. */
    fun vorschauStarten(art: VorschauArt = VorschauArt()) {
        _vorschau.value = true
        _vorlagen.value = Vorschau.vorlagen()
        vorschauUmstellen(art)
    }

    /** Die Vorschau als Vale, Gast oder ohne Zugang; dazu Störung und neuere Hub-Version zum Ausprobieren. */
    fun vorschauUmstellen(art: VorschauArt) {
        if (!_vorschau.value) return
        _vorschauArt.value = art
        val z = Vorschau.zustand(art)
        vorschauLesestaende = Vorschau.lesestaende(z)
        _schwarm.value = z
        vorlesenBereit = false
        antwortenAutomatischVorlesen(z)
        _sitzung.value = Sitzung("https://vorschau.invalid", z.ich, "", "VORSCHAU")
        _notAus.value = NotAusZustand(
            schluessel = true,
            mitBiometrie = false,
            geraetId = NotAusSchluessel.geraetId() ?: Vorschau.GERAET,
            name = "Fold 8",
            url = z.hub.notaus?.url,
            angemeldet = true,
            vorschau = true,
        )
    }

    fun abmelden() {
        if (_vorschau.value) {
            _vorschau.value = false
            _vorschauArt.value = VorschauArt()
            _sitzung.value = null
            _schwarm.value = SchwarmZustand()
            _vorlagen.value = vorlagenSpeicher.alle()
            _notAus.value = notAusLesen()
            _entsperrt.value = emptySet()
            _dateien.value = emptyMap()
            _bilder.value = emptyMap()
            _medien.value = emptyMap()
            abspieler.stopp()
            vorleser.stopp(senden = false)
            return
        }
        viewModelScope.launch {
            dienst?.abmelden()
            lokalAbmelden(null)
        }
    }

    private fun lokalAbmelden(grund: String?) {
        dienst?.schliessen()
        dienst = null
        spiegel?.cancel()
        speicher.loeschen()
        standSpeicher?.loeschen()
        gemerkt = null
        _sitzung.value = null
        _schwarm.value = SchwarmZustand()
        _dateien.value = emptyMap()
        _entsperrt.value = emptySet()
        _bilder.value = emptyMap()
        _medien.value = emptyMap()
        abspieler.stopp()
        vorleser.stopp(senden = false)
        gelesenGesendet.clear()
        allgemeinVersucht = false
        Hintergrund.abbestellen(getApplication())
        _anmeldung.value = AnmeldeZustand(fehler = grund)
    }

    // ── Letzter bekannter Stand ──────────────────────────────────────────────

    /** Nach einem frischen Sync den Stand sichern: bei Änderung, sonst höchstens alle 5 min. */
    private fun standMerken(z: SchwarmZustand) {
        val speicher = standSpeicher ?: return
        if (z.verbindung != Verbindung.BEREIT || z.ausSpeicher != null || z.zuletztSync <= 0) return
        val roh = dienst?.allgemeinFuerSpeicher()
        val neu = Schnappschuss.aus(z).copy(allgemeinRaum = roh?.first, allgemeinEreignisse = roh?.second.orEmpty())
        val alt = gemerkt
        if (alt != null && alt.inhalt == neu.inhalt && neu.zeit - alt.zeit < 5 * 60_000L) return
        gemerkt = neu
        viewModelScope.launch(Dispatchers.IO) { speicher.speichern(neu) }
    }

    // ── Aktionen ─────────────────────────────────────────────────────────────

    private fun aktion(erfolg: String?, lesend: Boolean = false, block: suspend SchwarmDienst.() -> Unit) {
        val d = dienst
        if (d == null) {
            if (_vorschau.value && !lesend) _meldungen.tryEmit("Vorschau – es wurde nichts gesendet.")
            return
        }
        viewModelScope.launch {
            try {
                d.block()
                erfolg?.let { _meldungen.tryEmit(it) }
            } catch (e: MatrixFehler) {
                _meldungen.tryEmit(
                    if (e.errcode == "M_FORBIDDEN") "Keine Berechtigung: ${e.message}" else "Fehlgeschlagen: ${e.message}",
                )
            } catch (e: Exception) {
                _meldungen.tryEmit("Fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    fun melden(text: String) {
        _meldungen.tryEmit(text)
    }

    /**
     * Eine Reaktion auf eine Freigabe, einen Alarm, einen Plan oder ein Tor. Bis das Echo im Sync
     * steht, bleibt der Knopf gesperrt, damit dieselbe Reaktion nicht zweimal rausgeht.
     */
    private fun signal(raum: String, eventId: String, zeichen: String, erfolg: String, erneuern: Boolean = false) {
        val schluessel = "$eventId|$zeichen"
        if (schluessel in _unterwegs.value) return
        aktion(null) {
            _unterwegs.update { it + schluessel }
            try {
                this.reagieren(raum, eventId, zeichen, erneuern)
                _meldungen.tryEmit(erfolg)
                delay(3_000)
            } finally {
                _unterwegs.update { it - schluessel }
            }
        }
    }

    /** ✅ gibt frei, ❌ lehnt ab. Es zählt nur deine Reaktion auf die Notice des Hubs (ADR-003 §5). */
    fun freigabeEntscheiden(f: Freigabe, freigeben: Boolean) = signal(
        f.raumId, f.eventId, if (freigeben) "✅" else "❌",
        if (freigeben) "✅ gesendet – der Hub quittiert die Freigabe von ${f.auftragId}."
        else "❌ gesendet – der Hub quittiert die Ablehnung von ${f.auftragId}.",
    )

    /** ✅ quittiert (still, bis behoben oder schlimmer), 🔕 schaltet den Fingerabdruck 24 h stumm, 🔔 hebt das auf. */
    fun alarmSignal(alarm: Alarm, zeichen: String) = signal(
        alarm.raumId, alarm.eventId, zeichen,
        when (zeichen) {
            "✅" -> "✅ quittiert – bleibt still, bis behoben oder schlimmer."
            "🔕" -> "🔕 gesendet – der Hub schaltet ${alarm.fingerabdruck} stumm."
            else -> "🔔 gesendet – ${alarm.fingerabdruck} meldet wieder."
        },
        // Stumm und laut lassen sich mehrmals umschalten; dafür braucht es jedes Mal eine neue Reaktion.
        erneuern = zeichen != "✅",
    )

    /** ✅ oder ❌ auf einen Plan (Punkt 8) oder ein Tor eines Ablaufs (Punkt 11). */
    fun entscheiden(e: Entscheidung, ja: Boolean) {
        val nummer = e.auftragId?.let { " zu $it" }.orEmpty()
        signal(
            e.nachricht.raumId, e.nachricht.eventId, if (ja) "✅" else "❌",
            when (e.art) {
                EntscheidungsArt.PLAN -> if (ja) "✅ gesendet – der Hub sagt dem Worker „ja“$nummer." else "❌ gesendet – der Hub sagt dem Worker „nein“$nummer."
                EntscheidungsArt.TOR -> if (ja) "✅ gesendet – der Ablauf geht weiter$nummer." else "❌ gesendet – der Ablauf hält an$nummer."
            },
        )
    }

    /** 👍 oder 👎 auf die Karte eines abgeschlossenen Auftrags (Punkt 14). */
    fun bewerten(t: Auftrag, karte: Nachricht, zeichen: String) {
        val raum = t.raumId ?: return
        val bisher = karte.eigeneReaktionen.map(Lebenslauf::zeichen).toSet()
        val schluessel = "${karte.eventId}|bewertung"
        if (schluessel in _unterwegs.value) return
        aktion(null) {
            _unterwegs.update { it + schluessel }
            try {
                this.bewerten(raum, karte.eventId, zeichen, bisher)
                _meldungen.tryEmit(
                    if (zeichen in bisher) "Bewertung von ${t.id} zurückgenommen."
                    else "$zeichen gesendet – zählt ins Profil von ${t.zustaendig}.",
                )
                delay(3_000)
            } finally {
                _unterwegs.update { it - schluessel }
            }
        }
    }

    fun befehl(text: String, erfolg: String? = null) = aktion(erfolg) { this.befehl(text) }

    fun auftrag(agent: String, ziel: String) {
        if (!_schwarm.value.rolle.darfAuftragAn(agent.substringBefore('/'))) {
            _meldungen.tryEmit("Aufträge an $agent sind für dich nicht freigegeben.")
            return
        }
        val name = _schwarm.value.agent(agent.substringBefore('/'))?.name ?: agent
        mitBedenkzeit("Auftrag an $name: ${ziel.trim().lineSequence().first().take(40)}", "Auftrag an $name geschickt. Die Quittung kommt in die Lobby.") {
            this.auftragGeben(agent, ziel)
        }
    }

    /**
     * Einen Auftrag mit [BEDENKZEIT_MS] Bedenkzeit senden (App 2.5): So lange zeigt die App „Rückgängig“, erst
     * dann geht er raus. Ein „hallo“ im Raum von Claude Code soll kein Auftrag werden, nur weil man sich vertippt.
     * Schliesst die App in dieser Zeit, geht er trotzdem raus (siehe [onCleared]).
     */
    private fun mitBedenkzeit(text: String, erfolg: String, block: suspend SchwarmDienst.() -> Unit) {
        val d = dienst
        if (d == null && !_vorschau.value) return
        val id = ++naechsteAusstehend
        val job = viewModelScope.launch {
            _ausstehend.emit(Ausstehend(id, text))
            delay(BEDENKZEIT_MS)
            wartend.remove(id)
            if (d == null) {
                _meldungen.tryEmit("Vorschau – es wurde nichts gesendet.")
                return@launch
            }
            try {
                d.block()
                _meldungen.tryEmit(erfolg)
            } catch (e: MatrixFehler) {
                _meldungen.tryEmit(if (e.errcode == "M_FORBIDDEN") "Keine Berechtigung: ${e.message}" else "Fehlgeschlagen: ${e.message}")
            } catch (e: Exception) {
                _meldungen.tryEmit("Fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
        wartend[id] = job to block
    }

    /** „Rückgängig“: Der Auftrag geht nicht raus. */
    fun rueckgaengig(id: Long) {
        val (job, _) = wartend.remove(id) ?: return
        job.cancel()
        _meldungen.tryEmit("Zurückgeholt, es wurde nichts gesendet.")
    }

    fun schreiben(raum: String, text: String, thread: String?, erwaehnen: List<String>) =
        aktion(null) { this.schreiben(raum, text, thread, erwaehnen) }

    fun reagieren(raum: String, eventId: String, zeichen: String, erfolg: String?) =
        aktion(erfolg) { this.reagieren(raum, eventId, zeichen) }

    fun einladungenAnnehmen() = aktion(null) {
        val n = this.einladungenAnnehmen()
        _meldungen.tryEmit(if (n > 0) "$n Räumen beigetreten." else "Es gab keine Einladung anzunehmen.")
    }

    fun aeltereLaden(raum: String) = aktion(null, lesend = true) { this.aeltereLaden(raum) }

    fun threadLaden(raum: String, wurzel: String) = aktion(null, lesend = true) { this.threadLaden(raum, wurzel) }

    fun karteSuchen(auftrag: String, raum: String) = aktion(null, lesend = true) {
        if (!this.karteSuchen(auftrag, raum)) _meldungen.tryEmit("Die Karte zu $auftrag liegt weiter zurück. `!stand $auftrag` zeigt den Stand.")
    }

    fun notAus() = aktion("Not-Aus gesendet. Der Hub friert den Schwarm ein.") { this.befehl("!stop") }

    fun weiter() = aktion("!weiter gesendet. Der Hub taut den Schwarm auf.") { this.befehl("!weiter") }

    // ── Türsteher, Routinen, Patches ─────────────────────────────────────────

    /** `!entsperren <ip> <grund>`: Der Betrieb trägt die Adresse in erlaubt.txt ein (Punkt 4). */
    fun entsperren(ip: String, grund: String) {
        val g = grund.trim().replace(Regex("""\s+"""), " ").ifBlank { "Freigabe in der App" }.take(200)
        if (_vorschau.value) _entsperrt.update { it + ip }
        aktion("!entsperren $ip gesendet. Der Hub antwortet in der Lobby mit 🔓.") {
            this.befehl("!entsperren $ip $g")
            _entsperrt.update { it + ip }
        }
    }

    /** `!patch T-… pruefen|anwenden|zusammenfuehren` (Punkt 13). */
    fun patch(auftrag: String, was: String) = befehl(
        "!patch $auftrag $was",
        when (was) {
            "pruefen" -> "!patch $auftrag pruefen gesendet – der Betrieb testet auf einer Kopie."
            "anwenden" -> "!patch $auftrag anwenden gesendet – der Zweig schwarm/$auftrag entsteht."
            else -> "!patch $auftrag zusammenfuehren gesendet."
        },
    )

    /** Einen Anhang laden, etwa den Patch eines Code-Auftrags; `neu` versucht es nach einem Fehler noch einmal. */
    fun dateiLaden(mxc: String, neu: Boolean = false) {
        val bisher = _dateien.value[mxc]
        if (!neu && (bisher is Ladung.Laeuft || bisher is Ladung.Fertig)) return
        if (_vorschau.value) {
            _dateien.update {
                it + (mxc to if (mxc == Vorschau.PATCH_MXC) Ladung.Fertig(Vorschau.PATCH) else Ladung.Fehler("In der Vorschau gibt es diese Datei nicht."))
            }
            return
        }
        val d = dienst ?: return
        _dateien.update { it + (mxc to Ladung.Laeuft) }
        viewModelScope.launch {
            val ergebnis = try {
                Ladung.Fertig(withContext(Dispatchers.IO) { d.dateiLaden(mxc) })
            } catch (e: MatrixFehler) {
                Ladung.Fehler(
                    if (e.status == 404) "Die Datei gibt es auf dem Server nicht mehr, vielleicht ist sie aufgeräumt."
                    else "Laden fehlgeschlagen: ${e.message}",
                )
            } catch (e: Exception) {
                Ladung.Fehler("Laden fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
            _dateien.update { it + (mxc to ergebnis) }
        }
    }

    // ── Allgemein ────────────────────────────────────────────────────────────

    /**
     * Allgemein einrichten, wenn die Account-Daten keinen Raum nennen: einmal von selbst, danach nur
     * noch auf Wunsch (`erneut`). Der Dienst prüft vorher, ob es den Raum nicht doch schon gibt.
     */
    fun allgemeinEinrichten(erneut: Boolean = false) {
        if (_vorschau.value || !_schwarm.value.rolle.istVale) return
        if (allgemeinVersucht && !erneut) return
        val d = dienst ?: return
        allgemeinVersucht = true
        _allgemeinFehler.value = null
        viewModelScope.launch {
            try {
                d.allgemeinAnlegen()
            } catch (e: MatrixFehler) {
                _allgemeinFehler.value = "Allgemein liess sich nicht einrichten: ${e.message}"
            } catch (e: Exception) {
                _allgemeinFehler.value = "Allgemein liess sich nicht einrichten: ${e.message ?: e.javaClass.simpleName}"
            }
        }
    }

    /**
     * Neuer Chat (ohne `chat`) oder weiter im Chat. `onGesendet` bekommt die Wurzel des Chats, damit die
     * Oberfläche vom leeren Chat in den neuen wechseln kann; `onFehler` gibt den Text zurück in die Eingabe.
     */
    fun chatSenden(text: String, chat: Chat?, onGesendet: (String) -> Unit, onFehler: () -> Unit) {
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – es wurde nichts gesendet.")
            onFehler()
            return
        }
        val d = dienst ?: return onFehler()
        viewModelScope.launch {
            _sendet.value = true
            try {
                val id = d.chatSenden(text, chat?.wurzel, chat?.letztesEvent)
                onGesendet(chat?.wurzel ?: id)
            } catch (e: Exception) {
                _meldungen.tryEmit("Nicht gesendet: ${e.message ?: e.javaClass.simpleName}")
                onFehler()
            } finally {
                _sendet.value = false
            }
        }
    }

    /** Ein Bild mit Text als Bildunterschrift, als neuer Chat oder im Chat. */
    fun bildSenden(bild: Bildwahl, text: String, chat: Chat?, onGesendet: (String) -> Unit, onFehler: () -> Unit) {
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – es wurde nichts gesendet.")
            onFehler()
            return
        }
        val d = dienst ?: return onFehler()
        viewModelScope.launch {
            _sendet.value = true
            try {
                val id = d.bildSenden(
                    bild.daten, bild.mime, bild.breite, bild.hoehe, bild.name,
                    text.ifBlank { null }, chat?.wurzel, chat?.letztesEvent,
                )
                onGesendet(chat?.wurzel ?: id)
            } catch (e: Exception) {
                _meldungen.tryEmit("Bild nicht gesendet: ${e.message ?: e.javaClass.simpleName}")
                onFehler()
            } finally {
                _sendet.value = false
            }
        }
    }

    /** `/stop` in den Thread: Brian bricht ab und meldet „⚡ Stopped“. */
    fun chatStoppen(chat: Chat) {
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – es wurde nichts gesendet.")
            return
        }
        aktion("Stopp gesendet.") { this.chatSenden("/stop", chat.wurzel, chat.letztesEvent) }
    }

    /** Ein Bild aus Allgemein laden; in der Vorschau malt die App es selbst. */
    fun bildLaden(mxc: String) {
        val bisher = _bilder.value[mxc]
        if (bisher is BildLadung.Laeuft || bisher is BildLadung.Fertig) return
        val vorschau = _vorschau.value
        val d = dienst
        if (!vorschau && d == null) return
        _bilder.update { it + (mxc to BildLadung.Laeuft) }
        viewModelScope.launch {
            val ergebnis = try {
                val bmp = withContext(Dispatchers.IO) {
                    if (vorschau) {
                        if (mxc == Vorschau.BILD_MXC) Bilder.vorschauBild() else null
                    } else {
                        Bilder.dekodieren(d!!.bildLaden(mxc, 1024), 1600)
                    }
                }
                if (bmp == null) BildLadung.Fehler("Das Bild liess sich nicht lesen.") else BildLadung.Fertig(bmp.asImageBitmap())
            } catch (e: MatrixFehler) {
                BildLadung.Fehler(if (e.status == 404) "Das Bild gibt es auf dem Server nicht mehr." else "Laden fehlgeschlagen: ${e.message}")
            } catch (e: Exception) {
                BildLadung.Fehler("Laden fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
            _bilder.update { it + (mxc to ergebnis) }
        }
    }

    /** Aus „Teilen → Schwarm“: Die Oberfläche öffnet einen neuen Chat und übernimmt Text und Bild. */
    fun teilen(text: String, bild: Uri?) {
        if (text.isBlank() && bild == null) return
        _geteilt.value = Geteilt(text.trim(), bild)
        _sprung.value = Sprung.GETEILT
    }

    fun geteiltUebernommen() {
        _geteilt.value = null
    }

    // ── Dateien aller Art (App 2.2) ──────────────────────────────────────────

    /** Ist der Anhang grösser, als der Server nimmt? Dann der Satz dazu, sonst null. */
    private suspend fun zuGross(d: SchwarmDienst, anhang: Anhang): String? {
        val grenze = d.uploadGrenze() ?: return null
        if (anhang.groesse <= grenze) return null
        return "„${anhang.name}“ ist zu gross: ${groesseText(anhang.groesse)}. Der Server nimmt höchstens ${groesseText(grenze)}."
    }

    /** Ein Anhang in einen Raum oder Thread, mit Text als Bildunterschrift. */
    fun anhangSenden(
        raum: String,
        anhang: Anhang,
        text: String,
        thread: String?,
        erwaehnen: List<String>,
        onGesendet: () -> Unit = {},
        onFehler: () -> Unit = {},
    ) {
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – es wurde nichts gesendet.")
            onFehler()
            return
        }
        val d = dienst ?: return onFehler()
        viewModelScope.launch {
            _sendet.value = true
            try {
                zuGross(d, anhang)?.let { _meldungen.tryEmit(it); onFehler(); return@launch }
                d.anhangSenden(raum, anhang, text.ifBlank { null }, thread, thread, erwaehnen)
                onGesendet()
            } catch (e: Exception) {
                _meldungen.tryEmit("Nicht gesendet: ${e.message ?: e.javaClass.simpleName}")
                onFehler()
            } finally {
                _sendet.value = false
            }
        }
    }

    /** Ein Anhang in Allgemein, als neuer Chat oder im Chat. */
    fun chatAnhangSenden(anhang: Anhang, text: String, chat: Chat?, onGesendet: (String) -> Unit, onFehler: () -> Unit) {
        if (_vorschau.value) {
            // Die Vorschau bereitet die Hilfen für Brian echt auf, schickt aber nichts: So lässt sich das prüfen.
            onFehler()
            viewModelScope.launch {
                val zusaetze = withContext(Dispatchers.IO) { BrianHilfe.zusaetze(getApplication(), anhang, _pdfSeiten.value) }
                _meldungen.tryEmit(
                    "Vorschau – es wurde nichts gesendet." + if (zusaetze.isEmpty()) "" else
                        " Für Brian gingen mit: " + zusaetze.joinToString(", ") { "${it.name} (${groesseText(it.groesse)})" }.take(300),
                )
            }
            return
        }
        val d = dienst ?: return onFehler()
        viewModelScope.launch {
            _sendet.value = true
            try {
                zuGross(d, anhang)?.let { _meldungen.tryEmit(it); onFehler(); return@launch }
                // Hilfen für Brian: PDF-Seiten als Bilder, Word und Excel als Text. Vorher aufbereiten,
                // damit sie gleich nach der Datei im selben Thread folgen.
                val zusaetze = withContext(Dispatchers.IO) {
                    BrianHilfe.zusaetze(getApplication(), anhang, _pdfSeiten.value)
                }
                val id = d.chatAnhangSenden(anhang, text.ifBlank { null }, chat?.wurzel, chat?.letztesEvent)
                val wurzel = chat?.wurzel ?: id
                onGesendet(wurzel)
                var letztes = id
                var gesendet = 0
                for (x in zusaetze) {
                    if (zuGross(d, x) != null) continue
                    letztes = runCatching { d.chatAnhangSenden(x, null, wurzel, letztes) }.getOrNull() ?: break
                    gesendet++
                }
                if (gesendet > 0) {
                    _meldungen.tryEmit(
                        when {
                            BrianHilfe.istPdf(anhang) -> "Für Brian: $gesendet ${if (gesendet == 1) "Seite" else "Seiten"} als Bild mitgeschickt."
                            BrianHilfe.istXlsx(anhang) -> "Für Brian: das erste Blatt als CSV mitgeschickt."
                            else -> "Für Brian: der Text als .txt mitgeschickt."
                        },
                    )
                }
            } catch (e: Exception) {
                _meldungen.tryEmit("Nicht gesendet: ${e.message ?: e.javaClass.simpleName}")
                onFehler()
            } finally {
                _sendet.value = false
            }
        }
    }

    /** Eine Datei aus einer Nachricht als Datei im Cache; in der Vorschau erzeugt die App sie selbst. */
    suspend fun dateiHolen(d: Datei): File? {
        val mxc = d.mxc ?: return null
        (_medien.value[mxc] as? Ladung.Fertig)?.let { f -> File(f.text).takeIf { it.isFile }?.let { return it } }
        return medienSperre.withLock {
            (_medien.value[mxc] as? Ladung.Fertig)?.let { f -> File(f.text).takeIf { it.isFile }?.let { return@withLock it } }
            _medien.update { it + (mxc to Ladung.Laeuft) }
            try {
                val bytes = if (_vorschau.value) {
                    Vorschau.medien(mxc) ?: throw IllegalStateException("In der Vorschau gibt es diese Datei nicht.")
                } else {
                    val dn = dienst ?: throw IllegalStateException("Nicht verbunden.")
                    withContext(Dispatchers.IO) { dn.medienBytes(mxc, 200_000_000L) }
                }
                val ordner = File(getApplication<Application>().cacheDir, "medien").apply { mkdirs() }
                val kennung = MessageDigest.getInstance("SHA-256").digest(mxc.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
                val sicher = d.name.replace(Regex("""[\/:*?"<>|\u0000-]"""), "_").take(100).ifBlank { "datei" }
                val datei = File(File(ordner, kennung).apply { mkdirs() }, sicher)
                withContext(Dispatchers.IO) { datei.writeBytes(bytes) }
                _medien.update { it + (mxc to Ladung.Fertig(datei.absolutePath)) }
                datei
            } catch (e: MatrixFehler) {
                val grund = if (e.status == 404) "Die Datei gibt es auf dem Server nicht mehr." else "Laden fehlgeschlagen: ${e.message}"
                _medien.update { it + (mxc to Ladung.Fehler(grund)) }
                _meldungen.tryEmit(grund)
                null
            } catch (e: Exception) {
                val grund = e.message ?: e.javaClass.simpleName
                _medien.update { it + (mxc to Ladung.Fehler(grund)) }
                _meldungen.tryEmit(grund)
                null
            }
        }
    }

    /** Eine geladene Datei an einen Ort schreiben, den du mit „Speichern“ gewählt hast. */
    fun dateiSpeichern(d: Datei, ziel: Uri) {
        viewModelScope.launch {
            val f = dateiHolen(d) ?: return@launch
            try {
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openOutputStream(ziel)?.use { aus -> f.inputStream().use { it.copyTo(aus) } }
                        ?: throw IllegalStateException("Das Ziel liess sich nicht öffnen.")
                }
                _meldungen.tryEmit("„${d.name}“ gespeichert.")
            } catch (e: Exception) {
                _meldungen.tryEmit("Speichern fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    /** Eine Audionachricht abspielen, pausieren oder fortsetzen. */
    fun abspielen(d: Datei) {
        val mxc = d.mxc ?: return
        val jetzt = abspieler.zustand.value
        if (jetzt?.mxc == mxc && abspieler.hat(mxc)) {
            if (jetzt.laeuft) abspieler.pause() else abspieler.weiter()
            return
        }
        abspieler.laedt(mxc)
        viewModelScope.launch {
            val f = dateiHolen(d)
            if (f == null) {
                abspieler.fehlgeschlagen(mxc)
                return@launch
            }
            try {
                abspieler.spielen(mxc, f)
            } catch (e: Exception) {
                abspieler.fehlgeschlagen(mxc)
                _meldungen.tryEmit("Abspielen fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    /** In einer Audionachricht springen; `anteil` 0–1. */
    fun suchen(d: Datei, anteil: Float) {
        val mxc = d.mxc ?: return
        val w = abspieler.zustand.value
        if (w?.mxc == mxc && abspieler.hat(mxc) && w.dauerMs > 0) {
            abspieler.suchen((w.dauerMs * anteil.coerceIn(0f, 1f)).toLong())
        }
    }

    // ── Vorlesen (App 2.2) ───────────────────────────────────────────────────

    /**
     * Einen Text vorlesen lassen; `quelle` (Raum, Event) nur zur Information für den Hub. `sprecher` ist der
     * Absender der Nachricht: Der Hub nimmt dessen Stimme (App 2.3). `stimme` erzwingt eine, für „Probe hören“.
     */
    fun vorlesen(text: String, quelle: Pair<String, String>?, titel: String, sprecher: String? = null, stimme: String? = null) {
        if (text.isBlank()) return
        if (!_vorschau.value && !_schwarm.value.rolle.istVale) {
            _meldungen.tryEmit("Vorlesen nimmt der Hub nur von Vale an.")
            return
        }
        vorleser.starten(text, quelle, titel, sprecher, stimme, stimmeAnzeige(sprecher, stimme))
    }

    /** „Probe hören“: ein kurzer Satz mit genau dieser Stimme, über den Mini-Spieler. */
    fun stimmeProbe(name: String, sprecher: String?, stimme: String) =
        vorlesen("Hallo, ich bin $name. So klinge ich, wenn die App vorliest.", null, "Probe hören", sprecher, stimme)

    /**
     * Wer spricht und mit welcher Stimme, so wie der Hub sie wählt: Agent (seine Stimme), Hub (die der
     * Notices), sonst der Standard. Eine genannte Stimme geht vor. Etwa „Brian (Jonas)“.
     */
    fun stimmeAnzeige(sprecher: String?, stimme: String?): String? {
        val z = _schwarm.value
        val liste = z.hub.stimmen
        val istHub = sprecher?.substringBefore(':') == "@schwarm"
        val agent = sprecher?.let { m -> z.agenten.firstOrNull { it.mxid == m } }
        val wer = when {
            sprecher == null -> null
            istHub -> "Hub"
            agent != null -> agent.name
            sprecher == z.ich -> "Du"
            else -> sprecher.removePrefix("@").substringBefore(':')
        }
        val id = stimme ?: when {
            istHub -> liste?.hub
            agent != null -> z.hub.modelle[agent.id]?.let { it.stimme ?: it.stimmeStandard } ?: liste?.standard
            else -> liste?.standard
        }
        val name = id?.let { liste?.name(it) ?: it }
        return when {
            wer != null && name != null -> "$wer ($name)"
            else -> name ?: wer
        }
    }

    fun vorlesenPause() = vorleser.pause()

    fun vorlesenWeiter() = vorleser.weiter()

    fun vorlesenStopp() = vorleser.stopp()

    private suspend fun vorleseAnfrage(anfrage: String, text: String, quelle: Pair<String, String>?, sprecher: String?, stimme: String?) {
        if (_vorschau.value) {
            // Die Vorschau spielt Stücke aus Tönen, wie sie der Hub nach und nach schicken würde: ein kurzer
            // Satz (etwa „Probe hören“) passt in ein Stück, längere Texte in drei.
            val von = if (text.length <= 160) 1 else 3
            viewModelScope.launch {
                for (nr in 1..von) {
                    delay(if (nr == 1) 1_500 else 1_200)
                    vorleser.teil(buildJsonObject {
                        put("v", JsonPrimitive(1))
                        put("anfrage", JsonPrimitive(anfrage))
                        put("nr", JsonPrimitive(nr))
                        put("von", JsonPrimitive(von))
                        put("mxc", JsonPrimitive("mxc://vorschau.invalid/vorlesen-$nr"))
                        put("mimetype", JsonPrimitive("audio/wav"))
                    })
                }
            }
            return
        }
        val d = dienst ?: throw IllegalStateException("Nicht verbunden.")
        d.vorlesen(anfrage, text, quelle, sprecher, stimme)
    }

    private suspend fun vorleseStueck(mxc: String): ByteArray {
        if (_vorschau.value) {
            val nr = mxc.substringAfterLast('-').toIntOrNull() ?: 1
            return withContext(Dispatchers.Default) { VorschauMedien.sprechprobe(nr, 1.8) }
        }
        val d = dienst ?: throw IllegalStateException("Nicht verbunden.")
        return withContext(Dispatchers.IO) { d.medienBytes(mxc, 20_000_000L) }
    }

    fun antwortenVorlesenSetzen(an: Boolean) {
        _antwortenVorlesen.value = an
        prefs.edit().putBoolean("antworten_vorlesen", an).apply()
        einstellungenSichern()
        // Was schon da ist, liest die App nicht nachträglich vor.
        if (an) {
            vorlesenBereit = false
            antwortenAutomatischVorlesen(_schwarm.value)
        }
    }

    /**
     * Brians Schlussantworten in Allgemein (Chat fertig, letzte Antwort) vorlesen, sobald sie kommen und
     * die App vorne ist. Werkzeugzeilen und „⏳ Working“ sind keine Antworten und kommen nie dran.
     */
    private fun antwortenAutomatischVorlesen(z: SchwarmZustand) {
        val schluss = z.allgemein.chats.filter { it.zustand == ChatZustand.FERTIG }.mapNotNull { c ->
            c.nachrichten.lastOrNull { it.art == ChatArt.ANTWORT }?.n?.let { c to it }
        }
        if (!vorlesenBereit) {
            // Erst ab dem ersten vollständigen Stand: Was da schon steht, ist nicht neu.
            if (z.ausSpeicher == null && (z.zuletztSync > 0 || _vorschau.value)) {
                schluss.forEach { schonVorgelesen += it.second.eventId }
                vorlesenBereit = true
            }
            return
        }
        val neu = schluss.filter { it.second.eventId !in schonVorgelesen }
        if (neu.isEmpty()) return
        neu.forEach { schonVorgelesen += it.second.eventId }
        // Im Sprachmodus (App 2.7) liest die App die Antwort in diesem Chat immer vor, auch ohne „Antworten vorlesen“.
        val imModus = neu.firstOrNull { it.first.wurzel == _sprachmodus.value }
        if (imModus != null && vordergrund) {
            val (chat, n) = imModus
            vorlesen(n.text, n.raumId to n.eventId, z.allgemein.titel(chat), n.absender)
            return
        }
        if (!_antwortenVorlesen.value || !vordergrund) return
        val (chat, n) = neu.maxBy { it.second.zeit }
        vorlesen(n.text, n.raumId to n.eventId, z.allgemein.titel(chat), n.absender)
    }

    // ── Modell je Chat und Modelle je Agent (App 2.2) ────────────────────────

    private fun chatModelleLesen(): Map<String, String> = runCatching {
        val roh = prefs.getString("chat_modelle", null) ?: return@runCatching emptyMap()
        SchwarmJson.parseToJsonElement(roh).jsonObject.mapValues { (_, v) -> (v as JsonPrimitive).content }
    }.getOrDefault(emptyMap())

    private fun chatModelleSchreiben(m: Map<String, String>) {
        _chatModelle.value = m
        if (_vorschau.value) return // die Vorschau speichert nichts
        val json = JsonObject(m.entries.toList().takeLast(200).associate { it.key to JsonPrimitive(it.value) })
        prefs.edit().putString("chat_modelle", json.toString()).apply()
    }

    /** `/model <id> --provider <anbieter> --session` in den Thread: gilt nur für diesen Chat. */
    fun chatModellSetzen(chat: Chat, wahl: ModellWahl) {
        if (_vorschau.value) {
            chatModelleSchreiben(_chatModelle.value + (chat.wurzel to wahl.id))
            _meldungen.tryEmit("Vorschau – „${ModellBefehl.chat(wahl)}“ wurde nicht gesendet.")
            return
        }
        aktion("Modell für diesen Chat: ${wahl.name}. Brian bestätigt im Chat.") {
            this.chatSenden(ModellBefehl.chat(wahl), chat.wurzel, chat.letztesEvent)
            chatModelleSchreiben(_chatModelle.value + (chat.wurzel to wahl.id))
        }
    }

    /**
     * Einen Befehl in die Lobby, etwa `!modell …`; `onGesendet` bekommt das Event, damit die Oberfläche
     * die Antwort des Hubs im Thread zeigen kann.
     */
    fun befehlMitAntwort(text: String, onGesendet: (String) -> Unit) {
        if (_vorschau.value) {
            _meldungen.tryEmit("Vorschau – „$text“ wurde nicht gesendet.")
            return
        }
        aktion(null) { onGesendet(this.befehl(text)) }
    }

    // ── Gelesen ──────────────────────────────────────────────────────────────

    /**
     * Gelesen bis unten: ohne `wurzel` der ganze Raum (Lesebestätigung auf die letzte Nachricht und
     * `m.fully_read`), mit `wurzel` nur ein Thread. Ist das Ungelesene des Raums nur in diesem Thread,
     * gilt gleich der ganze Raum; so bleibt es auch in Element sauber.
     */
    fun gelesen(raum: String, wurzel: String? = null) {
        val z = _schwarm.value
        val u = z.ungelesen[raum] ?: return
        if (u.anzahl == 0) return
        val nachrichten = z.verlauf(raum).nachrichten
        val imThread = wurzel?.let { u.threads[it] ?: 0 }
        // Was rausgeht: Event, Thread (null = Raum, "main" = Hauptzeitleiste), Lesezeichen setzen.
        val schritte = ArrayList<Triple<String, String?, Boolean>>()
        if (wurzel == null || imThread!! >= u.anzahl) {
            val letzte = nachrichten.maxByOrNull { it.zeit } ?: return
            schritte += Triple(letzte.eventId, null, true)
        } else {
            if (imThread == 0) return
            nachrichten.filter { it.threadWurzel == wurzel }.maxByOrNull { it.zeit }
                ?.let { schritte += Triple(it.eventId, wurzel, false) }
            // Die Wurzel selbst liegt in der Hauptzeitleiste.
            if (u.neueste.any { it.eventId == wurzel }) schritte += Triple(wurzel, "main", false)
        }
        if (_vorschau.value) {
            var l = vorschauLesestaende
            for ((id, thread, marke) in schritte) {
                val ts = nachrichten.firstOrNull { it.eventId == id }?.zeit ?: System.currentTimeMillis()
                var neu = (l[raum] ?: Lesestand()).mit(thread, Beleg(id, ts))
                if (marke) neu = neu.copy(vollGelesen = Beleg(id, ts))
                l = l + (raum to neu)
            }
            vorschauLesestaende = l
            _schwarm.value = Vorschau.gelesenRechnen(_schwarm.value, l)
            return
        }
        val d = dienst ?: return
        viewModelScope.launch {
            for ((id, thread, marke) in schritte) {
                val k = "$raum|$thread"
                if (gelesenGesendet[k] == id) continue
                gelesenGesendet[k] = id
                try {
                    d.gelesen(raum, id, thread, marke)
                } catch (e: Exception) {
                    // Nicht schlimm: Beim nächsten Mal geht sie wieder raus.
                    gelesenGesendet.remove(k)
                }
            }
        }
    }

    /** Ein Chat in Allgemein ist bis unten gelesen; seine Meldung „Brian hat geantwortet“ verschwindet. */
    fun chatGelesen(chat: Chat) {
        if (chat.ungelesen > 0) gelesen(chat.raumId, chat.wurzel)
        Hintergrund.chatMeldungWeg(getApplication(), chat.wurzel)
    }

    /** Alles gelesen: jeder Raum mit Ungelesenem bis zur letzten Nachricht. */
    fun allesGelesen() {
        _schwarm.value.ungelesen.filterValues { it.anzahl > 0 }.keys.forEach { gelesen(it) }
    }

    // ── Vorlagen und Favoriten ───────────────────────────────────────────────

    private fun vorlagenSetzen(liste: List<Vorlage>) {
        _vorlagen.value = liste
        if (_vorschau.value) return // die Vorschau speichert nichts
        vorlagenSpeicher.speichern(liste)
        FavoritenWidget.aktualisieren(getApplication())
        einstellungenSichern()
    }

    /** Neu oder geändert. Mehr als [FAVORITEN_MAX] Favoriten gibt es nicht; dann bleibt sie ohne Stern. */
    fun vorlageSpeichern(v: Vorlage) {
        val andere = _vorlagen.value.filter { it.id != v.id }
        val zuViele = v.favorit && andere.count { it.favorit } >= FAVORITEN_MAX
        val neu = if (zuViele) v.copy(favorit = false) else v
        val liste = _vorlagen.value.toMutableList()
        val i = liste.indexOfFirst { it.id == v.id }
        if (i >= 0) liste[i] = neu else liste += neu
        vorlagenSetzen(liste)
        _meldungen.tryEmit(
            if (zuViele) "Gespeichert, aber ohne Stern: Es gibt höchstens $FAVORITEN_MAX Favoriten."
            else "Vorlage „${neu.titel}“ gespeichert.",
        )
    }

    fun vorlageLoeschen(id: String) {
        vorlagenSetzen(_vorlagen.value.filter { it.id != id })
    }

    fun favoritUmschalten(id: String) {
        val v = _vorlagen.value.firstOrNull { it.id == id } ?: return
        if (!v.favorit && _vorlagen.value.count { it.favorit } >= FAVORITEN_MAX) {
            _meldungen.tryEmit("Höchstens $FAVORITEN_MAX Favoriten. Nimm zuerst bei einem anderen den Stern weg.")
            return
        }
        vorlagenSetzen(_vorlagen.value.map { if (it.id == id) it.copy(favorit = !it.favorit) else it })
    }

    /** Platzhalter eingesetzt: `!auftrag @agent <ziel>`, mit Budget und Frist als letzte Zeile. */
    fun vorlageSenden(v: Vorlage, werte: Map<String, String>) {
        if (!_schwarm.value.rolle.darfAuftragAn(v.agent.substringBefore('/'))) {
            _meldungen.tryEmit("Aufträge an ${v.agent} sind für dich nicht freigegeben.")
            return
        }
        val text = VorlagenText.befehl(v, werte)
        mitBedenkzeit("Vorlage „${v.titel}“ an ${v.agent}", "Auftrag an ${v.agent} geschickt. Die Quittung kommt in die Lobby.") { this.befehl(text) }
    }

    fun vorlageStarten(id: String) {
        _vorlageStart.value = id
    }

    fun vorlageGestartet() {
        _vorlageStart.value = null
    }

    // ── Not-Aus ohne Matrix ──────────────────────────────────────────────────

    private fun notAusLesen(): NotAusZustand {
        val da = NotAusSchluessel.vorhanden()
        return NotAusZustand(
            schluessel = da,
            mitBiometrie = da && NotAusSchluessel.mitBiometrie(),
            geraetId = if (da) NotAusSchluessel.geraetId() else null,
            name = notAusSpeicher.name,
            url = notAusSpeicher.url,
            angemeldet = da && notAusSpeicher.angemeldet,
        )
    }

    /** Adresse und Anmeldung aus dem Event des Hubs übernehmen, damit beides ohne Matrix bleibt. */
    private fun notAusAbgleichen(z: SchwarmZustand, s: Sitzung) {
        val info = z.hub.notaus ?: return
        if (info == letztesNotaus) return
        letztesNotaus = info
        NotAusDraht.urlPruefen(info.url, s.domain)?.let { if (it != notAusSpeicher.url) notAusSpeicher.url = it }
        val id = _notAus.value.geraetId
        notAusSpeicher.angemeldet = id != null && info.geraete.any { it.id == id }
        _notAus.value = notAusLesen().copy(laeuft = _notAus.value.laeuft, antwort = _notAus.value.antwort)
    }

    /**
     * Schlüssel erzeugen (falls noch keiner da ist) und `!geraet neu <name> <spki>` in die Lobby.
     * Der Hub antwortet mit der Geräte-ID und führt das Gerät danach im Event.
     */
    fun geraetAnmelden(name: String) {
        val n = name.trim().replace(Regex("""\s+"""), " ").take(40).ifBlank { Build.MODEL }
        if (_vorschau.value) {
            // Die Vorschau erzeugt den Schlüssel echt (nur auf dem Gerät), sendet aber nichts.
            viewModelScope.launch {
                val ergebnis = runCatching { withContext(Dispatchers.IO) { NotAusSchluessel.erzeugen(getApplication()) } }
                val id = NotAusSchluessel.geraetId()
                _notAus.update { it.copy(schluessel = true, geraetId = id ?: it.geraetId, mitBiometrie = ergebnis.getOrDefault(false)) }
                _meldungen.tryEmit(
                    ergebnis.fold(
                        { mitAuth -> "Vorschau: Schlüssel erzeugt (ID $id${if (mitAuth) ", mit Biometrie" else ""}). Die Anmeldung wurde nicht gesendet." },
                        { e -> "Schlüssel liess sich nicht erzeugen: ${e.message ?: e.javaClass.simpleName}" },
                    ),
                )
            }
            return
        }
        aktion(null) {
            val mitAuth = withContext(Dispatchers.IO) { NotAusSchluessel.erzeugen(getApplication()) }
            val spki = NotAusSchluessel.spki() ?: throw IllegalStateException("Der Schlüssel liess sich nicht lesen.")
            this.befehl("!geraet neu $n ${base64url(spki)}")
            notAusSpeicher.name = n
            _notAus.value = notAusLesen()
            _meldungen.tryEmit(
                "Anmeldung gesendet" + (if (mitAuth) ", der Schlüssel verlangt Biometrie." else ". Ohne Displaysperre genügt die Rückfrage.") +
                    " Sobald der Hub das Gerät führt, steht es hier als angemeldet.",
            )
        }
    }

    /** `!geraet weg <id>`; ist es dieses Gerät, verschwindet danach auch der Schlüssel. */
    fun geraetAbmelden(id: String) {
        val eigenes = id == _notAus.value.geraetId && !_vorschau.value
        aktion("!geraet weg $id gesendet.") {
            this.befehl("!geraet weg $id")
            if (eigenes) {
                NotAusSchluessel.loeschen()
                notAusSpeicher.vergessen()
                _notAus.value = notAusLesen()
            }
        }
    }

    /**
     * Den Not-Aus signiert und direkt an den Hub schicken, ohne Matrix (Punkt 18). Die Bestätigung
     * mit Biometrie holt die Oberfläche vorher; ohne sie scheitert ein geschützter Schlüssel hier.
     */
    fun notAusDirekt(aktion: String) {
        val stand = _notAus.value
        if (stand.laeuft) return
        if (stand.vorschau) {
            // Liegt schon ein Schlüssel auf dem Gerät, signiert die Vorschau echt; gesendet wird nichts.
            val signatur = if (NotAusSchluessel.vorhanden()) {
                runCatching {
                    val id = NotAusSchluessel.geraetId() ?: Vorschau.GERAET
                    NotAusSchluessel.signieren(NotAusDraht.text(aktion, id, System.currentTimeMillis(), NotAusDraht.nonce())).size
                }
            } else {
                null
            }
            _notAus.update {
                it.copy(
                    antwort = NotAusAntwort(
                        aktion, 200, true,
                        eingefroren = aktion == "stopp",
                        // Nach „stopp“ sind alle offenen Aufträge abgebrochen.
                        offen = if (aktion == "stopp") 0 else 3,
                        laufend = if (aktion == "stopp") 0 else 2,
                        fehler = "Vorschau – es wurde nichts gesendet. So sähe die Antwort des Hubs aus." + when {
                            signatur == null -> ""
                            signatur.isSuccess -> " Signatur mit dem Geräteschlüssel erstellt (${signatur.getOrNull()} Bytes, DER)."
                            else -> " Signieren scheiterte: ${signatur.exceptionOrNull()?.javaClass?.simpleName}."
                        },
                    ),
                )
            }
            return
        }
        val url = stand.url
        if (url == null) {
            _meldungen.tryEmit("Der Hub hat noch keine Not-Aus-Adresse gemeldet.")
            return
        }
        viewModelScope.launch {
            _notAus.update { it.copy(laeuft = true) }
            val antwort = try {
                withContext(Dispatchers.IO) { NotAusDraht.ausloesen(url, aktion) }
            } catch (e: UserNotAuthenticatedException) {
                NotAusAntwort(aktion, 0, false, fehler = "Die Bestätigung ist abgelaufen. Bitte noch einmal auslösen.")
            } catch (e: KeyPermanentlyInvalidatedException) {
                NotAusAntwort(aktion, 0, false, fehler = "Der Schlüssel ist ungültig geworden (Displaysperre geändert). Melde das Gerät neu an.")
            } catch (e: Exception) {
                NotAusAntwort(aktion, 0, false, fehler = "Signieren fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
            _notAus.update { it.copy(laeuft = false, antwort = antwort) }
        }
    }

    fun notAusAntwortGelesen() {
        _notAus.update { it.copy(antwort = null) }
    }

    override fun onCleared() {
        abspieler.stopp()
        vorleser.stopp(senden = false)
        // Aufträge in der Bedenkzeit gehen noch raus: Wer die App gleich nach „Senden“ wegwischt, will sie gesendet.
        val offen = wartend.values.map { it.second }
        wartend.values.forEach { it.first.cancel() }
        wartend.clear()
        val d = dienst
        if (d != null && offen.isNotEmpty()) {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.IO).launch {
                offen.forEach { block -> runCatching { d.block() } }
                d.schliessen()
            }
        } else {
            d?.schliessen()
        }
    }
}
