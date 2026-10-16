package com.claudewebui.swarm.data

import com.claudewebui.swarm.data.matrix.Ereignis
import com.claudewebui.swarm.data.matrix.EingeladenerRaum
import com.claudewebui.swarm.data.matrix.MatrixClient
import com.claudewebui.swarm.data.matrix.MatrixFehler
import com.claudewebui.swarm.data.matrix.SyncAntwort
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

internal fun JsonObject.str(k: String): String? =
    (this[k] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

internal fun JsonObject.obj(k: String): JsonObject? = this[k] as? JsonObject

internal fun JsonObject.arr(k: String): JsonArray? = this[k] as? JsonArray

/** Zahlen kommen vom Hub teils als Text (kanonisches JSON kennt keine Kommazahlen). */
internal fun JsonObject.zahl(k: String): Double? = str(k)?.toDoubleOrNull()

/** Grösser lädt die App keinen Anhang: Ein Patch mit 2 MB hat schon zehntausende Zeilen. */
const val DATEI_MAX_BYTES = 2_000_000L

/** Vorlesen mit Vocarium (App 2.2): die Anfrage der App und die Stücke des Hubs, beide in der Lobby. */
const val SCHWARM_VORLESEN = "ch.zwaetschge.swarm.vorlesen"
const val SCHWARM_VORLESEN_TEIL = "ch.zwaetschge.swarm.vorlesen.teil"

/**
 * Der Draht zum Schwarm: löst die Räume über ihre Aliase auf, synchronisiert nur diese
 * Räume (Long-Poll) und baut daraus Agenten, Aufträge und Verläufe. Schreibt nur, was du
 * auch in Element schreiben würdest: Befehle in der Lobby, Antworten, Reaktionen.
 */
class SchwarmDienst(
    private val sitzung: Sitzung,
    private val scope: CoroutineScope,
    /** Der letzte bekannte Stand aus dem Speicher: sofort sichtbar, bis der erste Sync da ist. */
    anfang: Schnappschuss? = null,
) {
    private val client = MatrixClient(sitzung.homeserver, sitzung.accessToken)
    private val hub = "@schwarm:${sitzung.domain}"
    private val vale = "@$VALE_LOKAL:${sitzung.domain}"

    private val _zustand = MutableStateFlow(
        SchwarmZustand(
            ich = sitzung.userId,
            rolle = if (sitzung.userId == vale) Rolle.VALE else Rolle(Zugang.PRUEFT),
            agenten = anfang?.agenten.orEmpty(),
            auftraege = anfang?.auftraege.orEmpty(),
            freigaben = anfang?.freigaben.orEmpty(),
            alarme = anfang?.alarme.orEmpty(),
            zuletztSync = anfang?.zeit ?: 0,
            ausSpeicher = anfang?.zeit,
        ),
    )
    val zustand: StateFlow<SchwarmZustand> = _zustand.asStateFlow()

    /** Die letzten Events von Allgemein für den Schnappschuss (App 2.9); höchstens `n`. */
    fun allgemeinFuerSpeicher(n: Int = 120): Pair<String, List<Ereignis>>? = runCatching {
        val raum = raeume.allgemein ?: return null
        val alle = ereignisse[raum]?.values?.toList().orEmpty()
        if (alle.isEmpty()) null else raum to alle.sortedBy { it.ts }.takeLast(n)
    }.getOrNull()

    /** Erst nach dem ersten Sync ersetzt Abgeleitetes den Stand aus dem Speicher. */
    private var synchronisiert = false

    /** Wird aufgerufen, wenn der Server das Token nicht mehr kennt. */
    var beiAbmeldung: (() -> Unit)? = null

    private val _kontoEinstellungen = MutableStateFlow<JsonObject?>(null)
    /** Die Einstellungen im Konto (App 2.9), so wie der Sync sie zuletzt brachte. */
    val kontoEinstellungen: StateFlow<JsonObject?> = _kontoEinstellungen.asStateFlow()

    suspend fun kontoEinstellungenSetzen(inhalt: JsonObject) {
        client.kontoDatenSetzen(sitzung.userId, KONTO_EINSTELLUNGEN, inhalt)
    }

    private val _vorleseTeile = MutableSharedFlow<JsonObject>(extraBufferCapacity = 64)
    /** Die Stücke von `ch.zwaetschge.swarm.vorlesen.teil`, nur vom Hub; die App speichert sie nicht. */
    val vorleseTeile: SharedFlow<JsonObject> = _vorleseTeile.asSharedFlow()

    /** Die Upload-Grenze des Servers, einmal je Sitzung gelesen. */
    private var uploadGrenzeWert: Long? = null
    private var uploadGrenzeGelesen = false

    private val sperre = Mutex()
    private val ereignisse = HashMap<String, LinkedHashMap<String, Ereignis>>()
    private val staende = HashMap<String, HashMap<String, Ereignis>>()
    private val vorher = HashMap<String, String?>()
    private val anfang = HashSet<String>()
    private val laedt = HashSet<String>()
    private val beigetreten = HashSet<String>()
    private val einladungen = LinkedHashMap<String, Einladung>()
    /** Offene Freigaben und Alarme, deren Thread in dieser Sitzung schon nachgeladen ist (`raum|event`). */
    private val nachgeladen = HashSet<String>()
    /** Vales Lesestand je Raum: Lesebestätigungen und `m.fully_read`. */
    private val lesestaende = HashMap<String, Lesestand>()
    /** Wer gerade tippt, je Raum (`m.typing`). */
    private val tippen = HashMap<String, Set<String>>()
    /** Mitglieder je Raum aus der Zusammenfassung: beigetreten, eingeladen. */
    private val mitglieder = HashMap<String, Pair<Int?, Int?>>()
    /** Nach dem ersten Sync steht fest, ob die Account-Daten Allgemein kennen. */
    private var allgemeinGeprueft = false
    /** Titel, Angeheftet und Archiv je Chat (App 2.7), aus den Account-Daten. */
    private var chatEinstellungen: Map<String, ChatEinstellung> = emptyMap()
    private var allgemeinWirdAngelegt = false
    /** Die Räume des Filters, mit dem der letzte Sync lief. */
    private var letzterFilter: Set<String> = emptySet()
    private val allgemeinSperre = Mutex()
    private var raeume = Raeume()
    private var since: String? = null
    private var filterRaeume: Set<String> = emptySet()
    private var schleife: Job? = null

    fun starten() {
        if (schleife?.isActive == true) return
        schleife = scope.launch(Dispatchers.IO) { syncSchleife() }
    }

    fun anhalten() {
        schleife?.cancel()
        schleife = null
    }

    /** Bis wohin der Sync gelesen hat: Ab hier liest der Warte-Worker im Hintergrund weiter. */
    val syncStand: String? get() = since

    fun schliessen() {
        anhalten()
        client.schliessen()
    }

    // ── Sync ──────────────────────────────────────────────────────────────────

    private suspend fun raeumeAufloesen(): Raeume = coroutineScope {
        val d = sitzung.domain
        suspend fun alias(name: String): String? =
            runCatching { client.aliasAufloesen("#$name:$d") }.getOrNull()

        val feste = listOf("schwarm-lobby", "schwarm-auftraege", "schwarm-freigaben", "schwarm-log", "schwarm-alarme", "schwarm")
            .map { n -> async { n to alias(n) } }
        val agenten = listOf("brian", "claude-code", "codex-host", "hermes-phone", "plum", "betrieb", "git", "trader", "rat")
            .map { a -> async { a to alias("ag-$a") } }
        val f = feste.awaitAll().toMap()
        val a = agenten.awaitAll().mapNotNull { (id, raum) -> raum?.let { id to it } }.toMap()
        Raeume(
            lobby = f["schwarm-lobby"], board = f["schwarm-auftraege"], freigaben = f["schwarm-freigaben"],
            log = f["schwarm-log"], alarme = f["schwarm-alarme"], space = f["schwarm"],
            agenten = a + raeume.agenten,
            allgemein = raeume.allgemein,
        )
    }

    /**
     * Nur die Schwarm-Räume und Allgemein. Dazu Lesebestätigungen und Tippen (ephemeral), `m.fully_read`
     * je Raum und die Account-Daten `m.direct` und `ch.zwaetschge.schwarm.allgemein` (App 2.1).
     */
    private fun filter(raeume: Set<String>): String = buildJsonObject {
        fun typen(vararg t: String) = buildJsonObject { put("types", JsonArray(t.map { JsonPrimitive(it) })) }
        put("room", buildJsonObject {
            put("rooms", JsonArray(raeume.map { JsonPrimitive(it) }))
            put("timeline", buildJsonObject {
                put("limit", JsonPrimitive(60))
                // Die eigenen Vorlese-Anfragen braucht die App nicht zurück; die Stücke des Hubs schon.
                put("not_types", JsonArray(listOf(JsonPrimitive(SCHWARM_VORLESEN))))
            })
            put("state", buildJsonObject { put("lazy_load_members", JsonPrimitive(true)) })
            put("ephemeral", typen("m.receipt", "m.typing"))
            put("account_data", typen("m.fully_read"))
        })
        put("presence", typen())
        put("account_data", typen("m.direct", KONTO_ALLGEMEIN, KONTO_CHATS, KONTO_EINSTELLUNGEN))
    }.toString()

    private suspend fun syncSchleife() {
        var pause = 1_000L
        while (currentCoroutineContext().isActive) {
            try {
                if (raeume.lobby == null) {
                    raeume = raeumeAufloesen()
                    _zustand.update { it.copy(raeume = raeume) }
                    if (raeume.lobby == null) throw IllegalStateException("#schwarm-lobby nicht gefunden")
                }
                val gewuenscht = raeume.alle
                if (gewuenscht != filterRaeume) {
                    filterRaeume = gewuenscht
                    since = null
                }
                val initial = since == null
                val antwort = client.sync(filter(filterRaeume), since, if (initial) 0 else 30_000)
                verarbeiten(antwort, initial)
                since = antwort.nextBatch
                pause = 1_000
            } catch (e: CancellationException) {
                throw e
            } catch (e: MatrixFehler) {
                if (e.status == 401 || e.errcode == "M_UNKNOWN_TOKEN") {
                    _zustand.update { it.copy(verbindung = Verbindung.ABGEMELDET, fehler = "Sitzung abgelaufen") }
                    beiAbmeldung?.invoke()
                    return
                }
                _zustand.update { it.copy(verbindung = Verbindung.FEHLER, fehler = e.message) }
                delay(e.retryAfterMs ?: pause)
                pause = (pause * 2).coerceAtMost(30_000)
            } catch (e: Exception) {
                _zustand.update { it.copy(verbindung = Verbindung.FEHLER, fehler = e.message ?: e.javaClass.simpleName) }
                delay(pause)
                pause = (pause * 2).coerceAtMost(30_000)
            }
        }
    }

    private fun schluessel(e: Ereignis) = "${e.type}|${e.stateKey}"

    private suspend fun verarbeiten(antwort: SyncAntwort, initial: Boolean) = sperre.withLock {
        synchronisiert = true
        letzterFilter = filterRaeume
        // Account-Daten: Wo Allgemein liegt (App 2.1).
        antwort.kontoDaten?.events?.forEach { e ->
            if (e.type == KONTO_ALLGEMEIN) {
                val raum = e.content.str("room_id")?.takeIf { it.startsWith("!") }
                if (raum != null && raum != raeume.allgemein) raeume = raeume.copy(allgemein = raum)
            }
            if (e.type == KONTO_CHATS) chatEinstellungen = chatEinstellungenLesen(e.content)
            if (e.type == KONTO_EINSTELLUNGEN) _kontoEinstellungen.value = e.content
        }
        if (initial) allgemeinGeprueft = true
        val r = antwort.rooms
        r?.join?.forEach { (raumId, raum) ->
            beigetreten.add(raumId)
            einladungen.remove(raumId)
            val stand = staende.getOrPut(raumId) { HashMap() }
            raum.state?.events?.forEach { stand[schluessel(it)] = it }
            raum.timeline?.let { tl ->
                val speicher = ereignisse.getOrPut(raumId) { LinkedHashMap() }
                if (initial || tl.limited) {
                    speicher.clear()
                    vorher[raumId] = tl.prevBatch
                    anfang.remove(raumId)
                    nachgeladen.removeAll { it.startsWith("$raumId|") }
                }
                tl.events.forEach { e ->
                    // Vorlese-Stücke gehen an den Spieler und nicht in den Verlauf.
                    if (e.type == SCHWARM_VORLESEN_TEIL) {
                        if (raumId == raeume.lobby && e.sender == hub && !initial) _vorleseTeile.tryEmit(e.content)
                        return@forEach
                    }
                    if (e.type == SCHWARM_VORLESEN) return@forEach
                    if (e.stateKey != null) stand[schluessel(e)] = e
                    e.eventId?.let { speicher[it] = e }
                }
            }
            raum.summary?.let { z ->
                val bisher = mitglieder[raumId]
                mitglieder[raumId] = (z.beigetreten ?: bisher?.first) to (z.eingeladen ?: bisher?.second)
            }
            raum.ephemeral?.events?.forEach { e -> ephemeralVerarbeiten(raumId, e) }
            raum.kontoDaten?.events?.forEach { e ->
                if (e.type == "m.fully_read") {
                    val id = e.content.str("event_id") ?: return@forEach
                    val ts = ereignisse[raumId]?.get(id)?.ts ?: 0L
                    lesestaende[raumId] = (lesestaende[raumId] ?: Lesestand()).copy(vollGelesen = Beleg(id, ts))
                }
            }
        }
        r?.invite?.forEach { (raumId, raum) -> einladungen[raumId] = einladungAus(raumId, raum) }
        r?.leave?.keys?.forEach {
            einladungen.remove(it)
            beigetreten.remove(it)
        }
        neuBerechnen(Verbindung.BEREIT)
        offeneNachladen()
    }

    /** Lesebestätigungen (nur Vales) und wer tippt. */
    private fun ephemeralVerarbeiten(raumId: String, e: Ereignis) {
        when (e.type) {
            "m.typing" -> tippen[raumId] = e.content.arr("user_ids")?.mapNotNull { (it as? JsonPrimitive)?.content }?.toSet().orEmpty()
            "m.receipt" -> e.content.forEach { (eventId, arten) ->
                val o = arten as? JsonObject ?: return@forEach
                for (art in listOf("m.read", "m.read.private")) {
                    val beleg = o.obj(art)?.obj(sitzung.userId) ?: continue
                    val ts = ereignisse[raumId]?.get(eventId)?.ts ?: beleg.zahl("ts")?.toLong() ?: continue
                    lesestaende[raumId] = (lesestaende[raumId] ?: Lesestand()).mit(beleg.str("thread_id"), Beleg(eventId, ts))
                }
            }
        }
    }

    /**
     * Antworten im Thread offener Freigaben und Alarme nachholen, falls sie nicht im geladenen
     * Verlauf stehen: einmal pro Notice und Sitzung. Die Sperre hält der Aufrufer; geladen wird danach.
     */
    private fun offeneNachladen() {
        val z = _zustand.value
        val jetzt = System.currentTimeMillis()
        val offen = z.freigaben.filter { it.offenUm(jetzt) }.map { it.raumId to it.eventId } +
            z.alarme.filter { it.zustand == AlarmZustand.OFFEN }.map { it.raumId to it.eventId }
        for ((raum, id) in offen) {
            if (nachgeladen.add("$raum|$id")) scope.launch(Dispatchers.IO) { runCatching { threadLaden(raum, id) } }
        }
    }

    private fun einladungAus(raumId: String, raum: EingeladenerRaum): Einladung {
        val stand = raum.inviteState?.events.orEmpty()
        val name = stand.firstOrNull { it.type == "m.room.name" }?.content?.str("name")
            ?: stand.firstOrNull { it.type == "m.room.canonical_alias" }?.content?.str("alias")
            ?: raeumeName(raumId)
            ?: raumId
        val einlader = stand.firstOrNull { it.type == "m.room.member" && it.stateKey == sitzung.userId }?.sender
        return Einladung(raumId, name, einlader)
    }

    private fun raeumeName(raumId: String): String? = when (raumId) {
        raeume.lobby -> "schwarm-lobby"
        raeume.board -> "schwarm-auftraege"
        raeume.freigaben -> "schwarm-freigaben"
        raeume.log -> "schwarm-log"
        raeume.alarme -> "schwarm-alarme"
        raeume.space -> "Schwarm (Space)"
        raeume.allgemein -> "Allgemein"
        else -> raeume.agenten.entries.firstOrNull { it.value == raumId }?.let { "ag-${it.key}" }
    }

    // ── Ableiten ──────────────────────────────────────────────────────────────

    private fun neuBerechnen(verbindung: Verbindung) {
        if (!synchronisiert) return
        val agenten = agentenAbleiten()
        // Neue Arbeitsräume aus den Agent Cards kommen beim nächsten Durchlauf in den Filter.
        val neueRaeume = agenten.mapNotNull { a -> a.raumId?.let { a.id to it } }.toMap()
        if (neueRaeume.any { (id, raum) -> raeume.agenten[id] != raum }) {
            raeume = raeume.copy(agenten = raeume.agenten + neueRaeume)
        }
        val verlaeufe = raeume.alle.associateWith { verlaufAbleiten(it) }
        // Freigaben und Alarme mit Lebenslauf (ADR-003 R1, R4); der Rest dieser Räume bleibt zum Lesen.
        val freigaben = raeume.freigaben?.let { r -> r to Lebenslauf.freigabenLesen(verlaeufe[r]?.nachrichten.orEmpty()) }
        val alarme = raeume.alarme?.let { r -> r to Lebenslauf.alarmeLesen(verlaeufe[r]?.nachrichten.orEmpty()) }
        // State-Events des Hubs (SCHNITTSTELLEN-app.md): nur die, die der Hub selbst gesetzt hat.
        val lobby = raeume.lobby
        val hubstand = lobby?.let { HubLeser.lesen(staende[it].orEmpty().values, hub) } ?: Hubstand()
        val rolle = Rolle.bestimmen(
            sitzung.userId, hubstand,
            lobbyBeigetreten = lobby != null && lobby in beigetreten,
            lobbyEingeladen = lobby != null && einladungen.containsKey(lobby),
        )
        val auftraege = auftraegeAbleiten()
        val jetzt = System.currentTimeMillis()
        val allgemein = allgemeinAbleiten(verlaeufe, jetzt)
        val ungelesen = ungelesenAlle(raeume, verlaeufe, lesestaende, sitzung.userId)
        _zustand.update {
            it.copy(
                verbindung = verbindung,
                fehler = if (verbindung == Verbindung.BEREIT) null else it.fehler,
                raeume = raeume,
                beigetreten = beigetreten.toSet(),
                agenten = agenten,
                auftraege = auftraege,
                verlaeufe = verlaeufe,
                einladungen = einladungen.values.filter { e -> e.raumId in raeume.alle }.toList(),
                freigaben = freigaben?.second?.eintraege.orEmpty(),
                alarme = alarme?.second?.eintraege.orEmpty(),
                nurLesen = buildMap {
                    freigaben?.let { (raum, gelesen) -> put(raum, gelesen.nurLesen) }
                    alarme?.let { (raum, gelesen) -> put(raum, gelesen.nurLesen) }
                },
                zuletztSync = jetzt,
                hub = hubstand,
                rolle = rolle,
                entscheidungen = Lebenslauf.entscheidungenLesen(verlaeufe, auftraege, jetzt),
                plumHinweise = raeume.agenten["plum"]?.let { r ->
                    Lebenslauf.plumHinweise(verlaeufe[r]?.nachrichten.orEmpty(), "@_sw_plum:${sitzung.domain}")
                }.orEmpty(),
                ausSpeicher = null,
                allgemein = allgemein,
                ungelesen = ungelesen,
            )
        }
    }

    /** Allgemein: Stand des Raums (fehlt, Brian tritt bei, bereit …) und die Chats. */
    private fun allgemeinAbleiten(verlaeufe: Map<String, Verlauf>, jetzt: Long): Allgemein {
        val raum = raeume.allgemein
        val brian = "@$BRIAN_LOKAL:${sitzung.domain}"
        val stand = staende[raum].orEmpty()
        val (beigetretenZahl, eingeladenZahl) = raum?.let { mitglieder[it] } ?: (null to null)
        val brianDrin = stand["m.room.member|$brian"]?.content?.str("membership") == "join" ||
            (beigetretenZahl ?: 0) >= 2
        val zahl = beigetretenZahl ?: stand.values.count { it.type == "m.room.member" && it.content.str("membership") == "join" }
        val zustand = when {
            allgemeinWirdAngelegt -> AllgemeinStand.WIRD_ANGELEGT
            !allgemeinGeprueft -> AllgemeinStand.UNBEKANNT
            raum == null -> AllgemeinStand.FEHLT
            raum !in beigetreten -> if (raum in letzterFilter) AllgemeinStand.NICHT_ERREICHBAR else AllgemeinStand.UNBEKANNT
            zahl > 2 -> AllgemeinStand.ZU_VIELE
            !brianDrin -> AllgemeinStand.WARTET_AUF_BRIAN
            else -> AllgemeinStand.BEREIT
        }
        if (raum == null || raum !in beigetreten) return Allgemein(raum, zustand, mitglieder = beigetretenZahl, einstellungen = chatEinstellungen)
        val v = verlaeufe[raum] ?: Verlauf()
        val (chats, tippt) = AllgemeinLeser.lesen(
            raum, v.nachrichten, sitzung.userId, brian, tippen[raum].orEmpty(), lesestaende[raum], jetzt,
        )
        return Allgemein(
            raumId = raum,
            stand = zustand,
            chats = chats,
            brianTippt = tippt,
            mitglieder = zahl.takeIf { it > 0 } ?: eingeladenZahl,
            ungelesen = chats.sumOf { it.ungelesen },
            anfangErreicht = v.anfangErreicht || v.aeltereVon == null,
            einstellungen = chatEinstellungen,
        )
    }

    private fun chatEinstellungenLesen(c: JsonObject): Map<String, ChatEinstellung> =
        c.obj("chats").orEmpty().mapNotNull { (wurzel, wert) ->
            val o = wert as? JsonObject ?: return@mapNotNull null
            if (!wurzel.startsWith("$")) return@mapNotNull null
            wurzel to ChatEinstellung(
                titel = o.str("titel")?.trim()?.take(80)?.ifBlank { null },
                angeheftet = o.wahr("angeheftet") ?: false,
                archiviert = o.wahr("archiviert") ?: false,
            )
        }.toMap()

    /**
     * Einen Chat umbenennen, anheften oder archivieren (App 2.7). Schreibt die ganze Liste in die Account-Daten;
     * die App zeigt die Änderung sofort, der Sync bestätigt sie.
     */
    suspend fun chatEinstellen(wurzel: String, neu: ChatEinstellung) {
        val alle = sperre.withLock {
            chatEinstellungen = if (neu.leer) chatEinstellungen - wurzel else chatEinstellungen + (wurzel to neu)
            neuBerechnen(_zustand.value.verbindung)
            chatEinstellungen
        }
        client.kontoDatenSetzen(sitzung.userId, KONTO_CHATS, buildJsonObject {
            put("chats", buildJsonObject {
                alle.forEach { (w, e) ->
                    put(w, buildJsonObject {
                        e.titel?.let { put("titel", JsonPrimitive(it)) }
                        if (e.angeheftet) put("angeheftet", JsonPrimitive(true))
                        if (e.archiviert) put("archiviert", JsonPrimitive(true))
                    })
                }
            })
        })
    }

    /** In allen Chats suchen, auch in den nicht geladenen: die Suche von Synapse, nur im Raum Allgemein. */
    suspend fun chatsSuchen(begriff: String): List<ChatTreffer> {
        val raum = raeume.allgemein ?: return emptyList()
        return client.suchen(raum, begriff).mapNotNull { e ->
            val id = e.eventId ?: return@mapNotNull null
            val rel = e.content.obj("m.relates_to")
            val wurzel = if (rel?.str("rel_type") == "m.thread") rel.str("event_id") ?: return@mapNotNull null else id
            ChatTreffer(wurzel, id, e.content.str("body").orEmpty().take(300), e.ts, e.sender == sitzung.userId)
        }
    }

    private fun agentenAbleiten(): List<Agent> {
        val lobby = raeume.lobby ?: return emptyList()
        return staende[lobby].orEmpty().values
            .filter { it.type == SCHWARM_AGENT && !it.stateKey.isNullOrBlank() && it.content.isNotEmpty() }
            .mapNotNull { e ->
                val c = e.content
                val id = c.str("id") ?: e.stateKey ?: return@mapNotNull null
                val modus = c.str("mode") ?: "native"
                val limits = c.obj("limits")
                Agent(
                    id = id,
                    name = c.str("name") ?: id,
                    level = c.str("level") ?: "?",
                    trust = c.str("trust") ?: "?",
                    modus = modus,
                    status = AgentStatus.von(c.str("status")),
                    raumId = c.str("room"),
                    laufzeit = c.str("runtime"),
                    modell = c.str("model"),
                    faehigkeiten = c.arr("skills")?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty(),
                    parallel = limits?.zahl("parallel")?.toInt() ?: 1,
                    budgetTag = limits?.str("budget_usd_day"),
                    mxid = if (modus == "native") "@$id:${sitzung.domain}" else "@_sw_$id:${sitzung.domain}",
                )
            }
            .sortedWith(compareBy<Agent> { it.modus == "notify" }.thenBy { it.name.lowercase() })
    }

    private val boardZeile = Regex("""^(\S+)\s+(T-\d+)\s+·\s+([a-z-]+)\s+·\s+(\S+)""")
    private val hopZeile = Regex("""Hop (\d+)""")
    private val fristZeile = Regex("""Frist ([^·]+)""")

    private fun inhaltVon(e: Ereignis): JsonObject? {
        val rel = e.content.obj("m.relates_to")
        return if (rel?.str("rel_type") == "m.replace") e.content.obj("m.new_content") else e.content
    }

    private fun auftraegeAbleiten(): List<Auftrag> {
        data class Board(val zustand: Zustand, val zustaendig: String, val ziel: String, val hop: Int?, val frist: String?, val hinweis: String?, val ts: Long)
        data class Karte(val raum: String, val wurzel: String, val c: JsonObject, val ts: Long)

        val board = HashMap<String, Board>()
        raeume.board?.let { raum ->
            ereignisse[raum].orEmpty().values.filter { it.type == "m.room.message" }.forEach { e ->
                val body = inhaltVon(e)?.str("body") ?: return@forEach
                val zeilen = body.lines()
                val m = boardZeile.find(zeilen.firstOrNull() ?: "") ?: return@forEach
                val id = m.groupValues[2]
                val zustand = Zustand.von(m.groupValues[3]) ?: return@forEach
                val bisher = board[id]
                if (bisher != null && bisher.ts > e.ts) return@forEach
                val info = zeilen.getOrNull(2).orEmpty()
                board[id] = Board(
                    zustand, m.groupValues[4], zeilen.getOrNull(1).orEmpty(),
                    hopZeile.find(info)?.groupValues?.get(1)?.toIntOrNull(),
                    fristZeile.find(info)?.groupValues?.get(1)?.trim(),
                    zeilen.firstOrNull { it.startsWith("Hinweis: ") }?.removePrefix("Hinweis: "),
                    e.ts,
                )
            }
        }

        val karten = HashMap<String, Karte>()
        raeume.agenten.values.forEach { raum ->
            ereignisse[raum].orEmpty().values.forEach { e ->
                val karte = e.content.obj(SCHWARM_AUFTRAG) ?: return@forEach
                if (e.sender != hub) return@forEach // nur der Hub stellt Karten aus (§7.2)
                val id = karte.str("id") ?: return@forEach
                if (karten[id] == null) karten[id] = Karte(raum, e.eventId ?: return@forEach, karte, e.ts)
            }
        }

        return (board.keys + karten.keys).map { id ->
            val b = board[id]
            val k = karten[id]
            val budget = k?.c?.obj("budget")?.let { bu ->
                listOfNotNull(bu.zahl("usd")?.let { "%.2f USD".format(it) }, bu.zahl("minutes")?.let { "${it.toInt()} min" })
                    .joinToString(" · ").ifBlank { null }
            }
            Auftrag(
                id = id,
                zustand = b?.zustand ?: Zustand.von(k?.c?.str("state")) ?: Zustand.EINGEREICHT,
                zustaendig = b?.zustaendig ?: k?.c?.str("assignee") ?: "?",
                ziel = k?.c?.str("goal") ?: b?.ziel.orEmpty(),
                hop = b?.hop ?: k?.c?.zahl("hop")?.toInt(),
                frist = b?.frist,
                hinweis = b?.hinweis,
                aktualisiert = maxOf(b?.ts ?: 0, k?.ts ?: 0),
                raumId = k?.raum,
                threadWurzel = k?.wurzel,
                ergebnis = k?.c?.str("deliverable"),
                grenzen = k?.c?.arr("constraints")?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty(),
                budget = budget,
                eltern = k?.c?.str("parent"),
                von = k?.c?.str("from"),
            )
        }.sortedByDescending { it.nummer }
    }

    private fun anzeigename(raum: String, mxid: String): String {
        if (mxid == hub) return "Hub"
        staende[raum]?.get("m.room.member|$mxid")?.content?.str("displayname")?.let { return it }
        val lokal = mxid.removePrefix("@").substringBefore(':')
        if (lokal.startsWith("_sw_")) {
            val id = lokal.removePrefix("_sw_")
            return _zustand.value.agent(id)?.name ?: id
        }
        return _zustand.value.agent(lokal)?.name ?: lokal.replaceFirstChar { it.uppercase() }
    }

    private fun verlaufAbleiten(raum: String): Verlauf {
        val alle = ereignisse[raum].orEmpty().values.sortedBy { it.ts }
        val geloescht = HashSet<String>()
        alle.filter { it.type == "m.room.redaction" }.forEach { e ->
            (e.redacts ?: e.content.str("redacts"))?.let(geloescht::add)
        }
        val bearbeitungen = HashMap<String, Ereignis>()
        val reaktionen = HashMap<String, HashMap<String, Int>>()
        val eigene = HashMap<String, HashSet<String>>()
        val eigeneZeit = HashMap<String, HashMap<String, Long>>()
        alle.forEach { e ->
            if (e.eventId in geloescht) return@forEach
            val rel = e.content.obj("m.relates_to") ?: return@forEach
            val ziel = rel.str("event_id") ?: return@forEach
            when {
                e.type == "m.room.message" && rel.str("rel_type") == "m.replace" -> bearbeitungen[ziel] = e
                e.type == "m.reaction" && rel.str("rel_type") == "m.annotation" -> {
                    val key = rel.str("key") ?: return@forEach
                    reaktionen.getOrPut(ziel) { HashMap() }.merge(key, 1, Int::plus)
                    if (e.sender == sitzung.userId) {
                        eigene.getOrPut(ziel) { HashSet() }.add(key)
                        eigeneZeit.getOrPut(ziel) { HashMap() }.merge(key, e.ts) { a, b -> maxOf(a, b) }
                    }
                }
            }
        }
        val nachrichten = alle.mapNotNull { e ->
            val id = e.eventId ?: return@mapNotNull null
            if (e.type != "m.room.message" || id in geloescht) return@mapNotNull null
            val rel = e.content.obj("m.relates_to")
            if (rel?.str("rel_type") == "m.replace") return@mapNotNull null
            val neu = bearbeitungen[id]?.takeIf { it.sender == e.sender }?.content?.obj("m.new_content")
            val inhalt = neu ?: e.content
            val text = inhalt.str("body") ?: return@mapNotNull null
            val art = inhalt.str("msgtype") ?: e.content.str("msgtype")
            val datei = if (art == "m.file" || art == "m.image" || art == "m.video" || art == "m.audio") {
                val info = inhalt.obj("info")
                val ton = inhalt.obj("org.matrix.msc1767.audio")
                Datei(
                    name = inhalt.str("filename") ?: text,
                    mxc = inhalt.str("url"),
                    mime = info?.str("mimetype"),
                    groesse = info?.zahl("size")?.toLong(),
                    // Die Patch-Angaben zählen nur vom Hub oder seinen Puppets (Punkt 13).
                    patch = if (art == "m.file" && (e.sender == hub || e.sender.startsWith("@_sw_"))) {
                        e.content.obj(SCHWARM_PATCH)?.let(HubLeser::patchInfo)
                    } else {
                        null
                    },
                    bild = art == "m.image",
                    breite = info?.zahl("w")?.toInt(),
                    hoehe = info?.zahl("h")?.toInt(),
                    art = art,
                    dauerMs = (info?.zahl("duration") ?: ton?.zahl("duration"))?.toLong(),
                    sprache = inhalt.containsKey("org.matrix.msc3245.voice"),
                    welle = ton?.arr("waveform")?.mapNotNull { (it as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() }
                        ?.takeIf { it.isNotEmpty() },
                )
            } else {
                null
            }
            Nachricht(
                eventId = id,
                raumId = raum,
                absender = e.sender,
                absenderName = anzeigename(raum, e.sender),
                zeit = e.ts,
                text = text,
                notice = art == "m.notice",
                threadWurzel = rel?.takeIf { it.str("rel_type") == "m.thread" }?.str("event_id"),
                bearbeitet = neu != null,
                reaktionen = reaktionen[id].orEmpty(),
                eigeneReaktionen = eigene[id].orEmpty(),
                auftragId = e.content.obj(SCHWARM_AUFTRAG)?.str("id"),
                vonMir = e.sender == sitzung.userId,
                vomHub = e.sender == hub,
                eigeneZeiten = eigeneZeit[id].orEmpty(),
                datei = datei,
            )
        }
        return Verlauf(
            nachrichten = nachrichten,
            aeltereVon = vorher[raum],
            laedtAeltere = raum in laedt,
            anfangErreicht = raum in anfang,
        )
    }

    // ── Aktionen ──────────────────────────────────────────────────────────────

    suspend fun schreiben(
        raum: String,
        text: String,
        thread: String? = null,
        erwaehnen: List<String> = emptyList(),
        /** Das letzte Event im Thread für `m.in_reply_to` (Allgemein); sonst die Wurzel. */
        antwortAuf: String? = null,
    ): String {
        val inhalt = buildJsonObject {
            put("msgtype", JsonPrimitive("m.text"))
            put("body", JsonPrimitive(text))
            put("m.mentions", buildJsonObject {
                if (erwaehnen.isNotEmpty()) put("user_ids", JsonArray(erwaehnen.map { JsonPrimitive(it) }))
            })
            if (thread != null) put("m.relates_to", threadBezug(thread, antwortAuf))
        }
        return senden(raum, inhalt)
    }

    private fun threadBezug(thread: String, antwortAuf: String?) = buildJsonObject {
        put("rel_type", JsonPrimitive("m.thread"))
        put("event_id", JsonPrimitive(thread))
        put("is_falling_back", JsonPrimitive(true))
        put("m.in_reply_to", buildJsonObject { put("event_id", JsonPrimitive(antwortAuf ?: thread)) })
    }

    /** Senden und gleich lokal zeigen, bis das Echo aus dem Sync kommt. */
    private suspend fun senden(raum: String, inhalt: JsonObject): String {
        val id = client.senden(raum, "m.room.message", inhalt)
        sperre.withLock {
            ereignisse.getOrPut(raum) { LinkedHashMap() }
                .putIfAbsent(id, Ereignis("m.room.message", id, sitzung.userId, System.currentTimeMillis(), inhalt))
            neuBerechnen(_zustand.value.verbindung)
        }
        return id
    }

    // ── Allgemein ─────────────────────────────────────────────────────────────

    /**
     * Allgemein anlegen, wenn die Account-Daten keinen Raum nennen: ein DM mit Brian, nie mit einem
     * dritten Mitglied. Danach die Account-Daten setzen und `m.direct` ergänzen, ohne Einträge zu verlieren.
     */
    suspend fun allgemeinAnlegen(): String {
        return allgemeinSperre.withLock { allgemeinAnlegenGesperrt() }
    }

    private suspend fun allgemeinAnlegenGesperrt(): String {
        raeume.allgemein?.let { return it }
        // Nie doppelt: Kennen die Account-Daten den Raum doch (etwa aus einer anderen Sitzung), gilt er.
        client.kontoDaten(sitzung.userId, KONTO_ALLGEMEIN)?.str("room_id")?.takeIf { it.startsWith("!") }?.let { raum ->
            sperre.withLock {
                raeume = raeume.copy(allgemein = raum)
                neuBerechnen(_zustand.value.verbindung)
            }
            return raum
        }
        val brian = "@$BRIAN_LOKAL:${sitzung.domain}"
        sperre.withLock { allgemeinWirdAngelegt = true; neuBerechnen(_zustand.value.verbindung) }
        try {
            val raum = client.raumAnlegen(buildJsonObject {
                put("preset", JsonPrimitive("trusted_private_chat"))
                put("is_direct", JsonPrimitive(true))
                put("invite", JsonArray(listOf(JsonPrimitive(brian))))
                put("name", JsonPrimitive("Allgemein"))
            })
            client.kontoDatenSetzen(sitzung.userId, KONTO_ALLGEMEIN, buildJsonObject { put("room_id", JsonPrimitive(raum)) })
            val direkt = client.kontoDaten(sitzung.userId, "m.direct") ?: JsonObject(emptyMap())
            val bisher = direkt.arr(brian)?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty()
            if (raum !in bisher) {
                val neu = JsonObject(direkt + (brian to JsonArray((bisher + raum).map { JsonPrimitive(it) })))
                client.kontoDatenSetzen(sitzung.userId, "m.direct", neu)
            }
            sperre.withLock {
                raeume = raeume.copy(allgemein = raum)
                beigetreten.add(raum)
            }
            return raum
        } finally {
            sperre.withLock { allgemeinWirdAngelegt = false; neuBerechnen(_zustand.value.verbindung) }
        }
    }

    /** Neuer Chat (ohne `wurzel`) oder weiter im Chat: `m.thread` mit `m.in_reply_to` auf das letzte Event. */
    suspend fun chatSenden(text: String, wurzel: String?, letztes: String?): String {
        val raum = raeume.allgemein ?: throw IllegalStateException("Allgemein ist noch nicht eingerichtet.")
        return schreiben(raum, text, thread = wurzel, antwortAuf = letztes)
    }

    /**
     * Ein Bild hochladen und als `m.image` senden. Ein Text wird zur Bildunterschrift im `body` (Hermes
     * liest einen body mit Leerzeichen als Unterschrift), der Dateiname steht in `filename`.
     */
    suspend fun bildSenden(
        daten: ByteArray, mime: String, breite: Int, hoehe: Int, dateiname: String,
        text: String?, wurzel: String?, letztes: String?,
    ): String {
        val raum = raeume.allgemein ?: throw IllegalStateException("Allgemein ist noch nicht eingerichtet.")
        val mxc = client.hochladen(daten, mime, dateiname)
        val inhalt = buildJsonObject {
            put("msgtype", JsonPrimitive("m.image"))
            put("body", JsonPrimitive(text?.trim()?.ifBlank { null } ?: dateiname))
            put("filename", JsonPrimitive(dateiname))
            put("url", JsonPrimitive(mxc))
            put("info", buildJsonObject {
                put("mimetype", JsonPrimitive(mime))
                put("size", JsonPrimitive(daten.size))
                put("w", JsonPrimitive(breite))
                put("h", JsonPrimitive(hoehe))
            })
            put("m.mentions", JsonObject(emptyMap()))
            if (wurzel != null) put("m.relates_to", threadBezug(wurzel, letztes))
        }
        return senden(raum, inhalt)
    }

    /**
     * Ein Bild zum Zeigen: das Vorschaubild über authentifizierte Medien; gibt es keines (etwa ohne
     * Vorschaubilder auf dem Server), das Original bis 10 MB.
     */
    suspend fun bildLaden(mxc: String, kante: Int): ByteArray = try {
        client.vorschaubild(mxc, kante, kante, DATEI_MAX_BYTES * 4)
    } catch (e: MatrixFehler) {
        if (e.status == 401 || e.status == 403) throw e
        client.medienLaden(mxc, 10_000_000L)
    }

    // ── Dateien aller Art (App 2.2) ───────────────────────────────────────────

    /** Die Upload-Grenze des Servers (`m.upload.size`); `null`, wenn er keine nennt. */
    suspend fun uploadGrenze(): Long? {
        if (!uploadGrenzeGelesen) {
            uploadGrenzeWert = runCatching { client.medienKonfig() }.getOrNull()
            uploadGrenzeGelesen = true
        }
        return uploadGrenzeWert
    }

    /**
     * Einen Anhang hochladen und senden: `m.image`, `m.video`, `m.audio` oder `m.file` nach MIME, mit
     * `info`, dem Dateinamen in `filename` und dem Text als Bildunterschrift in `body` (ohne Text der
     * Dateiname). Die Sprachnachricht trägt `org.matrix.msc3245.voice` und `org.matrix.msc1767.audio`.
     */
    suspend fun anhangSenden(
        raum: String,
        anhang: Anhang,
        text: String?,
        thread: String? = null,
        antwortAuf: String? = null,
        erwaehnen: List<String> = emptyList(),
    ): String {
        val mxc = client.hochladen(anhang.daten, anhang.mime, anhang.name)
        val inhalt = buildJsonObject {
            put("msgtype", JsonPrimitive(anhang.art.msgtype))
            put("body", JsonPrimitive(text?.trim()?.ifBlank { null } ?: anhang.name))
            put("filename", JsonPrimitive(anhang.name))
            put("url", JsonPrimitive(mxc))
            put("info", buildJsonObject {
                put("mimetype", JsonPrimitive(anhang.mime))
                put("size", JsonPrimitive(anhang.groesse))
                anhang.breite?.let { put("w", JsonPrimitive(it)) }
                anhang.hoehe?.let { put("h", JsonPrimitive(it)) }
                anhang.dauerMs?.let { put("duration", JsonPrimitive(it)) }
            })
            if (anhang.art == AnhangArt.SPRACHE) {
                put("org.matrix.msc3245.voice", JsonObject(emptyMap()))
                put("org.matrix.msc1767.audio", buildJsonObject {
                    put("duration", JsonPrimitive(anhang.dauerMs ?: 0L))
                    anhang.welle?.let { w -> put("waveform", JsonArray(w.map { JsonPrimitive(it) })) }
                })
            }
            put("m.mentions", buildJsonObject {
                if (erwaehnen.isNotEmpty()) put("user_ids", JsonArray(erwaehnen.map { JsonPrimitive(it) }))
            })
            if (thread != null) put("m.relates_to", threadBezug(thread, antwortAuf))
        }
        return senden(raum, inhalt)
    }

    /** Einen Anhang in Allgemein: neuer Chat oder im Chat. */
    suspend fun chatAnhangSenden(anhang: Anhang, text: String?, wurzel: String?, letztes: String?): String {
        val raum = raeume.allgemein ?: throw IllegalStateException("Allgemein ist noch nicht eingerichtet.")
        return anhangSenden(raum, anhang, text, wurzel, letztes)
    }

    /** Eine Datei über die authentifizierten Medien, als Bytes. */
    suspend fun medienBytes(mxc: String, maxBytes: Long): ByteArray = client.medienLaden(mxc, maxBytes)

    // ── Vorlesen (App 2.2) ────────────────────────────────────────────────────

    /** `ch.zwaetschge.swarm.vorlesen` in die Lobby: ein Event-Typ, keine Nachricht. */
    suspend fun vorlesen(anfrage: String, text: String, quelle: Pair<String, String>?, sprecher: String?, stimme: String?) {
        val lobby = raeume.lobby ?: throw IllegalStateException("Lobby noch nicht bekannt")
        client.senden(lobby, SCHWARM_VORLESEN, buildJsonObject {
            put("v", JsonPrimitive(1))
            put("anfrage", JsonPrimitive(anfrage))
            put("text", JsonPrimitive(text.take(20_000)))
            // Der Hub wählt die Stimme nach dem Absender; eine genannte Stimme geht vor („Probe hören“).
            sprecher?.let { put("sprecher", JsonPrimitive(it)) }
            stimme?.let { put("stimme", JsonPrimitive(it)) }
            if (quelle != null) {
                put("quelle", buildJsonObject {
                    put("raum", JsonPrimitive(quelle.first))
                    put("event", JsonPrimitive(quelle.second))
                })
            }
        })
    }

    suspend fun vorlesenAbbrechen(anfrage: String) {
        val lobby = raeume.lobby ?: return
        client.senden(lobby, SCHWARM_VORLESEN, buildJsonObject {
            put("v", JsonPrimitive(1))
            put("anfrage", JsonPrimitive(anfrage))
            put("abbrechen", JsonPrimitive(true))
        })
    }

    /** Reaktionen auf ein Event nachladen, etwa auf Vales letzte Frage in einem älteren Chat. */
    suspend fun reaktionenLaden(raum: String, eventId: String) {
        val signale = runCatching { client.reaktionen(raum, eventId).chunk }.getOrDefault(emptyList())
        sperre.withLock {
            val speicher = ereignisse.getOrPut(raum) { LinkedHashMap() }
            signale.forEach { e -> e.eventId?.let { id -> if (id !in speicher) speicher[id] = e } }
            neuBerechnen(_zustand.value.verbindung)
        }
    }

    /**
     * Gelesen bis `eventId`: erst lokal (die Zahlen fallen sofort), dann `receipt/m.read` und, für den
     * ganzen Raum, `read_markers` mit `m.fully_read`. Mit `thread` eine Thread-Bestätigung.
     */
    suspend fun gelesen(raum: String, eventId: String, thread: String?, markeSetzen: Boolean) {
        sperre.withLock {
            val ts = ereignisse[raum]?.get(eventId)?.ts ?: System.currentTimeMillis()
            var stand = (lesestaende[raum] ?: Lesestand()).mit(thread, Beleg(eventId, ts))
            if (markeSetzen) stand = stand.copy(vollGelesen = Beleg(eventId, ts))
            lesestaende[raum] = stand
            neuBerechnen(_zustand.value.verbindung)
        }
        client.lesebestaetigung(raum, eventId, thread)
        if (markeSetzen) client.lesemarke(raum, eventId)
    }

    /** Befehle nimmt der Hub nur in der Lobby und nur von dir an (§8.6). */
    /** Matrix-Pusher für die Sofort-Benachrichtigungen setzen oder entfernen (App 2.5). */
    suspend fun pusherSetzen(pushkey: String, gateway: String, geraet: String, loeschen: Boolean = false) =
        client.pusherSetzen(pushkey, gateway, geraet, loeschen)

    suspend fun befehl(text: String): String {
        val lobby = raeume.lobby ?: throw IllegalStateException("Lobby noch nicht bekannt")
        return schreiben(lobby, text)
    }

    suspend fun auftragGeben(agent: String, ziel: String) =
        befehl("!auftrag @$agent ${ziel.trim().replace(Regex("\\s+"), " ")}")

    /**
     * Reaktion senden. Dieselbe Reaktion zweimal lehnt Synapse ab (M_DUPLICATE_ANNOTATION). Für
     * Umschalter wie 🔕 und 🔔 braucht der Hub aber jedes Mal eine neue: `erneuern` nimmt dann deine
     * alte zurück und sendet noch einmal. Rücknahmen beachtet der Hub nicht.
     */
    suspend fun reagieren(raum: String, eventId: String, zeichen: String, erneuern: Boolean = false) {
        try {
            client.reagieren(raum, eventId, zeichen)
        } catch (e: MatrixFehler) {
            if (!erneuern || e.errcode != "M_DUPLICATE_ANNOTATION") throw e
            client.reaktionen(raum, eventId).chunk
                .filter { it.sender == sitzung.userId && it.content.obj("m.relates_to")?.str("key") == zeichen }
                .forEach { alt -> alt.eventId?.let { client.zuruecknehmen(raum, it) } }
            client.reagieren(raum, eventId, zeichen)
        }
    }

    /** Deine Reaktion `zeichen` auf ein Event zurücknehmen (Redaction). */
    suspend fun reaktionZuruecknehmen(raum: String, eventId: String, zeichen: String) {
        val ziel = Lebenslauf.zeichen(zeichen)
        client.reaktionen(raum, eventId).chunk
            .filter { it.sender == sitzung.userId && Lebenslauf.zeichen(it.content.obj("m.relates_to")?.str("key").orEmpty()) == ziel }
            .forEach { alt -> alt.eventId?.let { client.zuruecknehmen(raum, it) } }
    }

    /**
     * 👍 oder 👎 auf die Auftragskarte (Punkt 14). Es gilt eine Bewertung: Die andere nimmt die App
     * zurück, dieselbe noch einmal nimmt die Bewertung ganz zurück.
     */
    suspend fun bewerten(raum: String, karte: String, zeichen: String, bisher: Set<String>) {
        val andere = if (zeichen == "👍") "👎" else "👍"
        if (zeichen in bisher) {
            reaktionZuruecknehmen(raum, karte, zeichen)
            return
        }
        if (andere in bisher) reaktionZuruecknehmen(raum, karte, andere)
        client.reagieren(raum, karte, zeichen)
    }

    /** Eine Datei aus dem Thread holen, etwa einen Patch: als Text, höchstens [DATEI_MAX_BYTES]. */
    suspend fun dateiLaden(mxc: String): String = client.medienLaden(mxc, DATEI_MAX_BYTES).toString(Charsets.UTF_8)

    /**
     * Die veröffentlichte APK laden (Punkt 20, App 2.8). Grösse und Prüfsumme prüft [AppUpdate] danach selbst;
     * passt etwas nicht, installiert die App nichts.
     */
    suspend fun appApk(mxc: String): ByteArray = client.medienLaden(mxc, AppUpdate.MAX_BYTES)

    /** Eine Notice ins Log des Hubs, etwa ein Absturzbericht der App (Punkt 20). Ohne Log-Raum: nichts. */
    suspend fun logNotice(text: String) {
        val raum = raeume.log ?: return
        client.senden(raum, "m.room.message", buildJsonObject {
            put("msgtype", JsonPrimitive("m.notice"))
            put("body", JsonPrimitive(text.take(500)))
        })
    }

    suspend fun einladungenAnnehmen(): Int {
        var angenommen = 0
        for (e in einladungen.values.toList()) {
            if (e.raumId !in raeume.alle) continue
            runCatching { client.beitreten(e.raumId) }.onSuccess { angenommen++ }
        }
        // Ein neuer Sync holt die Räume mit vollem Stand.
        sperre.withLock { since = null }
        return angenommen
    }

    suspend fun aeltereLaden(raum: String) {
        val von = sperre.withLock {
            if (raum in laedt || raum in anfang) return
            laedt.add(raum)
            neuBerechnen(_zustand.value.verbindung)
            vorher[raum]
        }
        try {
            val seite = client.nachrichten(raum, von, "b", 50)
            sperre.withLock {
                val speicher = ereignisse.getOrPut(raum) { LinkedHashMap() }
                seite.chunk.forEach { e -> e.eventId?.let { id -> if (id !in speicher) speicher[id] = e } }
                seite.state.forEach { e -> staende.getOrPut(raum) { HashMap() }.putIfAbsent(schluessel(e), e) }
                vorher[raum] = seite.end
                if (seite.end == null || seite.chunk.isEmpty()) anfang.add(raum)
            }
        } finally {
            sperre.withLock {
                laedt.remove(raum)
                neuBerechnen(_zustand.value.verbindung)
            }
        }
    }

    /** Thread eines Auftrags vollständig holen: Karte, Antworten und die Signale auf der Karte. */
    suspend fun threadLaden(raum: String, wurzel: String) {
        val karte = runCatching { client.ereignis(raum, wurzel) }.getOrNull()
        val antworten = runCatching { client.threadAntworten(raum, wurzel).chunk }.getOrDefault(emptyList())
        val signale = runCatching { client.reaktionen(raum, wurzel).chunk }.getOrDefault(emptyList())
        sperre.withLock {
            val speicher = ereignisse.getOrPut(raum) { LinkedHashMap() }
            (listOfNotNull(karte) + antworten + signale).forEach { e ->
                e.eventId?.let { id -> if (id !in speicher) speicher[id] = e }
            }
            neuBerechnen(_zustand.value.verbindung)
        }
    }

    /** Ältere Aufträge: die Karte im Arbeitsraum suchen, höchstens sechs Seiten weit. */
    suspend fun karteSuchen(auftrag: String, raum: String): Boolean {
        repeat(6) {
            if (_zustand.value.auftrag(auftrag)?.threadWurzel != null) return true
            if (raum in anfang) return false
            aeltereLaden(raum)
        }
        return _zustand.value.auftrag(auftrag)?.threadWurzel != null
    }

    suspend fun abmelden() {
        anhalten()
        runCatching { client.abmelden() }
        client.schliessen()
    }

    // Am Ende der Klasse: Alle Felder oben sind dann schon angelegt.
    init {
        // Allgemein aus dem Speicher (App 2.9): Die Chats stehen gleich da; der erste Sync ersetzt sie.
        val raum = anfang?.allgemeinRaum
        if (raum != null && anfang.allgemeinEreignisse.isNotEmpty()) {
            raeume = raeume.copy(allgemein = raum)
            beigetreten.add(raum)
            mitglieder[raum] = 2 to null
            ereignisse[raum] = LinkedHashMap(anfang.allgemeinEreignisse.mapNotNull { e -> e.eventId?.let { it to e } }.toMap())
            allgemeinGeprueft = true
            runCatching {
                val jetzt = System.currentTimeMillis()
                val a = allgemeinAbleiten(mapOf(raum to verlaufAbleiten(raum)), jetzt)
                _zustand.update { it.copy(allgemein = a) }
            }
            allgemeinGeprueft = false
        }
    }
}
