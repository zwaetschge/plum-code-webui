package com.claudewebui.swarm.data

import com.claudewebui.swarm.data.matrix.Ereignis
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime

/**
 * Die State-Events des Hubs in der Lobby (SCHNITTSTELLEN-app.md): Plum-Sitzungen, Türsteher,
 * Abo-Stand, Routinen, Not-Aus, Kennzahlen und Rollen. Sie zählen nur, wenn der Hub sie gesetzt
 * hat, und jedes trägt `v: 1`. Felder, die die App nicht kennt, übergeht sie; ein unbekanntes `v`
 * heisst „bitte App aktualisieren“. Nur Text, kein Netz: Die Vorschau liest ihre Beispiel-Events
 * mit denselben Funktionen wie der echte Sync. Werfen darf hier nichts.
 */

const val SCHWARM_EINHEITEN = "ch.zwaetschge.swarm.einheiten"
const val SCHWARM_TUERSTEHER = "ch.zwaetschge.swarm.tuersteher"
const val SCHWARM_KONTINGENTE = "ch.zwaetschge.swarm.kontingente"
const val SCHWARM_ROUTINEN = "ch.zwaetschge.swarm.routinen"
const val SCHWARM_NOTAUS = "ch.zwaetschge.swarm.notaus"
const val SCHWARM_KENNZAHLEN = "ch.zwaetschge.swarm.kennzahlen"
const val SCHWARM_ROLLEN = "ch.zwaetschge.swarm.rollen"
/** Der Release-Stand des Hubs (Verbesserung 2, App 2.5). */
const val SCHWARM_RELEASE = "ch.zwaetschge.swarm.release"
/** Der Tagesbericht um 21:00 (Verbesserung 10, App 2.5). */
const val SCHWARM_TAGESBERICHT = "ch.zwaetschge.swarm.tagesbericht"
/** Feld an einem `m.file` mit dem Patch eines Code-Auftrags. */
const val SCHWARM_PATCH = "ch.zwaetschge.swarm.patch"
/** Die veröffentlichte APK der App (Punkt 20, App 2.8), geschrieben von `ops/app-veroeffentlichen.mjs`. */
const val SCHWARM_APP = "ch.zwaetschge.swarm.app"
/** Die Ruhezeit der Weckmeldungen (App 2.9), gesetzt mit `!ruhe`. */
const val SCHWARM_RUHE = "ch.zwaetschge.swarm.ruhe"
/** Brians LiteLLM-Schlüssel: Modelle, Ausgaben, Budget (App 2.10). */
const val SCHWARM_LITELLM = "ch.zwaetschge.swarm.litellm"

/** Die Version der State-Events, die diese App versteht. */
const val HUB_VERSION = 1

/** Vales Konto ist `@zwaetschge:<domain>`; jedes andere Konto braucht ein Rollen-Event (Gastrolle). */
const val VALE_LOKAL = "zwaetschge"

/**
 * Ist `at` älter, gilt der Stand der Plum-Brücke als veraltet (wie `verbunden: false`). Der Hub frischt ihn
 * ohne Änderung alle 10 min auf (SCHNITTSTELLEN-app.md, Plum-Bildschirm); 25 min lassen zwei Runden Luft.
 */
const val EINHEITEN_VERALTET_MS = 25 * 60_000L

// ── Plum-Sitzungen (Punkt 17) ───────────────────────────────────────────────

enum class EinheitZustand(val wire: String, val titel: String) {
    WARTET("wartet auf dich", "wartet auf dich"),
    ARBEITET("arbeitet", "arbeitet"),
    FEHLER("Fehler", "Fehler"),
    BEREIT("bereit", "bereit"),
    ANDERS("", "unbekannt");

    companion object {
        fun von(wire: String?): EinheitZustand =
            entries.firstOrNull { it != ANDERS && it.wire.equals(wire?.trim(), ignoreCase = true) } ?: ANDERS
    }
}

/** Eine Sitzung eines Workers mit Einheiten, heute nur Plum. */
data class Einheit(
    val name: String,
    val zustand: EinheitZustand,
    /** So, wie der Hub ihn schreibt, falls die App den Zustand nicht kennt. */
    val zustandText: String,
    val text: String,
    val link: String?,
    val id: String?,
    val auftrag: String?,
)

data class Einheiten(val agent: String, val at: Long, val verbunden: Boolean, val eintraege: List<Einheit>) {
    /** Die Brücke ist weg, oder ihr letzter Stand ist älter als 25 min (Hub oder Brücke stehen). */
    fun veraltetUm(jetzt: Long): Boolean = !verbunden || jetzt - at > EINHEITEN_VERALTET_MS
}

// ── Türsteher (Punkt 4) ─────────────────────────────────────────────────────

data class Sperre(val ip: String, val seit: Long?, val bis: Long?, val grund: String, val rueckfall: Boolean)

data class Tuersteher(
    val aktualisiert: Long?,
    val veraltet: Boolean,
    val gesperrt: Int,
    val neu7Tage: Int,
    val vertraut: Int,
    val sperren: List<Sperre>,
)

// ── Abo-Stand (Punkt 7) ─────────────────────────────────────────────────────

data class Kontingent(
    val agent: String,
    val anbieter: String,
    val fenster: String,
    /** 0 bis 1, `null` heisst unbekannt. */
    val auslastung: Double?,
    val zurueck: Long?,
    val stand: Long?,
)

data class Kontingente(val at: Long?, val eintraege: List<Kontingent>, val umleitung: Map<String, String>)

// ── Routinen (Punkt 10) ─────────────────────────────────────────────────────

data class RoutineLauf(val auftrag: String?, val zustand: Zustand?, val zeit: Long?)

data class Routine(
    val name: String,
    val zeitplan: String,
    val agent: String,
    val ziel: String,
    val pausiert: Boolean,
    val naechster: Long?,
    val letzter: RoutineLauf?,
    /** Warum der letzte Lauf nicht zustande kam, falls der Hub das meldet. */
    val fehler: String? = null,
)

// ── Not-Aus ohne Matrix (Punkt 18) ──────────────────────────────────────────

data class NotausGeraet(val id: String, val name: String, val erstellt: Long?, val push: GeraetPush? = null)

/** Was der Hub von der Push-Adresse eines Geräts weiss: nur der Host, der letzte Erfolg, der letzte Fehler (App 2.5). */
data class GeraetPush(val host: String, val ok: Long?, val fehler: String?)

data class NotausInfo(val url: String?, val geraete: List<NotausGeraet>)

/** Wie der laufende Hub gebaut wurde (Verbesserung 2): `strasse = false` heisst am Release-Weg vorbei. */
data class ReleaseStand(
    val strasse: Boolean,
    val tag: String?,
    val basis: String?,
    val zusatz: Int?,
    val suiten: Int?,
    val gruen: Int?,
    val pruefungen: Int?,
    val seit: Long?,
)

/** Der Tag in Zahlen (Verbesserung 10), vom Hub um 21:00. Beträge in Cent, Abo in Prozent. */
/** Ruhezeit (App 2.9): In der Zeit wecken nur `dringend`; die App meldet dann auch selbst nur still. */
data class Ruhe(val an: Boolean, val von: String, val bis: String, val zone: String = "Europe/Zurich") {
    /** Liegt `jetzt` in der Ruhezeit? Zeiten als „HH:MM“ in `zone`, über Mitternacht erlaubt. */
    fun jetzt(jetzt: java.time.Instant = java.time.Instant.now()): Boolean {
        if (!an) return false
        val z = runCatching { java.time.ZoneId.of(zone) }.getOrDefault(java.time.ZoneId.of("Europe/Zurich"))
        val t = jetzt.atZone(z).toLocalTime()
        val m = t.hour * 60 + t.minute
        val v = minuten(von) ?: return false
        val b = minuten(bis) ?: return false
        if (v == b) return false
        return if (v < b) m in v until b else m >= v || m < b
    }

    companion object {
        fun minuten(hhmm: String): Int? {
            val t = hhmm.split(':')
            val h = t.getOrNull(0)?.toIntOrNull() ?: return null
            val m = t.getOrNull(1)?.toIntOrNull() ?: 0
            return if (h in 0..23 && m in 0..59) h * 60 + m else null
        }
    }
}

/** LiteLLM (App 2.10): was Brians Schlüssel darf und wie viel davon verbraucht ist. Beträge in Cent. */
data class LiteLlm(
    val erreichbar: Boolean,
    val modelle: List<Pair<String, String>>,
    val ausgabenCent: Int?,
    val budgetCent: Int?,
    val zeitraum: String?,
    val zurueck: Long?,
    val stand: Long?,
    val fehler: String?,
) {
    /** Anteil des Budgets (0–1), oder null ohne Budget. */
    val anteil: Float? get() = if (ausgabenCent != null && budgetCent != null && budgetCent > 0) (ausgabenCent.toFloat() / budgetCent).coerceIn(0f, 1f) else null
    fun hat(id: String): Boolean = modelle.any { it.first == id }
}

data class Tagesbericht(
    val tag: String,
    val erstellt: Long?,
    val auftraege: Int,
    val ok: Int,
    val fehler: Int,
    val abbruch: Int,
    val offen: Int,
    val warten: Int,
    val kostenCent: Int,
    val budgetCent: Int?,
    val alarmeOffen: Int,
    val abo: List<Pair<String, Int>>,
)

// ── Verlauf und Kennzahlen (Punkt 20) ───────────────────────────────────────

data class KennTag(
    val tag: LocalDate?,
    val tagText: String,
    val auftraege: Int,
    val ok: Int,
    val fehler: Int,
    val abbruch: Int,
    val kosten: Double,
    val alarme: Int,
) {
    /** Aufträge, die weder ok noch Fehler noch Abbruch sind, etwa noch offene. */
    val sonstige: Int get() = (auftraege - ok - fehler - abbruch).coerceAtLeast(0)
}

data class KennAgent(
    val agent: String,
    val auftraege: Int,
    val ok: Int,
    val quote: Double?,
    val dauerMedianS: Double?,
    val kosten: Double,
    val budgetTag: Double?,
    val plus: Int,
    val minus: Int,
    val pauseBis: Long?,
)

data class Kennzahlen(
    val zeitraum: String,
    val von: String?,
    val bis: String?,
    val erstellt: Long?,
    val tage: List<KennTag>,
    val agenten: List<KennAgent>,
    val freigabenAnzahl: Int?,
    val freigabenMedianS: Double?,
    val alarmeAnzahl: Int?,
    val alarmeQuittiert: Int?,
    val alarmeMedianQuittungS: Double?,
)

// ── Gastrolle (Punkt 16) ────────────────────────────────────────────────────

data class GastRolle(
    val mxid: String,
    val rolle: String,
    val name: String?,
    val agenten: List<String>,
    val befehle: List<String>,
    val budgetUsdTag: Double?,
)

enum class Zugang { VALE, GAST, KEIN_ZUGANG, PRUEFT }

/**
 * Was die angemeldete Person darf. Vale darf alles; ein Gast nur die Befehle und Agenten aus seinem
 * Rollen-Event. Reaktionen als Entscheidung (Freigaben, Alarme, Pläne, Tore, Signale, Bewertungen)
 * zählen im Hub nur von Vale, darum bietet die App sie Gästen gar nicht erst an.
 */
data class Rolle(val zugang: Zugang, val gast: GastRolle? = null) {
    val istVale: Boolean get() = zugang == Zugang.VALE
    val istGast: Boolean get() = zugang == Zugang.GAST
    val entscheidet: Boolean get() = istVale

    /** Darf die Oberfläche diesen Befehl anbieten? `befehl` ohne „!“, etwa `routine`. */
    fun darf(befehl: String): Boolean = when (zugang) {
        Zugang.VALE -> true
        Zugang.GAST -> befehl !in NUR_VALE && gast?.befehle?.contains(befehl) == true
        else -> false
    }

    fun darfAuftragAn(agent: String): Boolean =
        istVale || (istGast && darf("auftrag") && gast?.agenten?.contains(agent) == true)

    companion object {
        val VALE = Rolle(Zugang.VALE)

        /** Bleibt Gästen immer verborgen, auch wenn das Rollen-Event sie nennen sollte. */
        val NUR_VALE = setOf("aktion", "stop", "weiter", "geraet")

        /**
         * Vale an der MXID; jedes andere Konto ist Gast, wenn der Hub ein Rollen-Event dafür gesetzt
         * hat. Ohne Event heisst es „kein Zugang“, sobald die Lobby gelesen ist; bis dahin „prüft“.
         */
        fun bestimmen(ich: String, hub: Hubstand, lobbyBeigetreten: Boolean, lobbyEingeladen: Boolean): Rolle {
            val gast = hub.rollen[ich]
            return when {
                ich == "@$VALE_LOKAL:${ich.substringAfter(':')}" -> VALE
                gast != null -> Rolle(Zugang.GAST, gast)
                lobbyBeigetreten -> Rolle(Zugang.KEIN_ZUGANG)
                lobbyEingeladen -> Rolle(Zugang.PRUEFT)
                else -> Rolle(Zugang.KEIN_ZUGANG)
            }
        }
    }
}

// ── Stand aller Hub-Events ──────────────────────────────────────────────────

data class Hubstand(
    val einheiten: Map<String, Einheiten> = emptyMap(),
    val tuersteher: Tuersteher? = null,
    val kontingente: Kontingente? = null,
    val routinen: List<Routine>? = null,
    val notaus: NotausInfo? = null,
    val kennzahlen: Map<String, Kennzahlen> = emptyMap(),
    val rollen: Map<String, GastRolle> = emptyMap(),
    /** Event-Typen mit einem `v`, das diese App nicht kennt: „bitte App aktualisieren“. */
    val neuereVersion: Set<String> = emptySet(),
    /** Modelle je Agent (App 2.2), Schlüssel = Agent. */
    val modelle: Map<String, ModellStand> = emptyMap(),
    /** Stimmen beim Vorlesen (App 2.3). */
    val stimmen: StimmenStand? = null,
    /** Wie der Hub gebaut wurde; ohne Release-Strasse fehlen womöglich Befehle (App 2.5). */
    val release: ReleaseStand? = null,
    /** Der letzte Tagesbericht (App 2.5). */
    val tagesbericht: Tagesbericht? = null,
    /** Die veröffentlichte APK (Punkt 20, App 2.8); ohne Event weiss die App nichts über Updates. */
    val app: AppRelease? = null,
    /** Die Ruhezeit (App 2.9); ohne Event gilt keine. */
    val ruhe: Ruhe? = null,
    /** LiteLLM (App 2.10). */
    val litellm: LiteLlm? = null,
) {
    fun zuNeu(typ: String): Boolean = typ in neuereVersion
}

/** Liest die State-Events des Hubs. */
object HubLeser {
    private val bekannt = setOf(
        SCHWARM_EINHEITEN, SCHWARM_TUERSTEHER, SCHWARM_KONTINGENTE, SCHWARM_ROUTINEN,
        SCHWARM_NOTAUS, SCHWARM_KENNZAHLEN, SCHWARM_ROLLEN, SCHWARM_MODELLE, SCHWARM_STIMMEN,
        SCHWARM_RELEASE, SCHWARM_TAGESBERICHT, SCHWARM_APP, SCHWARM_RUHE, SCHWARM_LITELLM,
    )
    private val ipForm = Regex("""^[0-9A-Fa-f:.]{2,45}$""")
    private val auftragForm = Regex("""^T-\d{1,8}$""")
    private val geraetForm = Regex("""^[0-9a-f]{8,64}$""")

    /** `stand`: alle State-Events der Lobby. Nur die des Hubs zählen. */
    fun lesen(stand: Collection<Ereignis>, hub: String): Hubstand {
        val neu = HashSet<String>()
        val einheiten = HashMap<String, Einheiten>()
        val kennzahlen = HashMap<String, Kennzahlen>()
        val rollen = HashMap<String, GastRolle>()
        val modelle = HashMap<String, ModellStand>()
        var stimmen: StimmenStand? = null
        var release: ReleaseStand? = null
        var bericht: Tagesbericht? = null
        var app: AppRelease? = null
        var ruhe: Ruhe? = null
        var lite: LiteLlm? = null
        var tuer: Tuersteher? = null
        var abo: Kontingente? = null
        var liste: List<Routine>? = null
        var weg: NotausInfo? = null
        for (e in stand) {
            if (e.type !in bekannt || e.sender != hub || e.stateKey == null || e.content.isEmpty()) continue
            val c = e.content
            val v = c.zahl("v")?.toInt() ?: HUB_VERSION
            if (v != HUB_VERSION) {
                neu += e.type
                continue
            }
            runCatching {
                when (e.type) {
                    SCHWARM_EINHEITEN -> einheiten(e.stateKey, c)?.let { einheiten[it.agent] = it }
                    SCHWARM_TUERSTEHER -> if (e.stateKey.isEmpty()) tuer = tuersteher(c)
                    SCHWARM_KONTINGENTE -> if (e.stateKey.isEmpty()) abo = kontingente(c)
                    SCHWARM_ROUTINEN -> if (e.stateKey.isEmpty()) liste = routinen(c)
                    SCHWARM_NOTAUS -> if (e.stateKey.isEmpty()) weg = notaus(c)
                    SCHWARM_KENNZAHLEN -> kennzahlen(e.stateKey, c)?.let { kennzahlen[e.stateKey] = it }
                    SCHWARM_ROLLEN -> rolle(e.stateKey, c)?.let { rollen[e.stateKey] = it }
                    SCHWARM_MODELLE -> ModellLeser.lesen(e.stateKey, c)?.let { modelle[it.agent] = it }
                    SCHWARM_STIMMEN -> if (e.stateKey.isEmpty()) stimmen = ModellLeser.stimmen(c)
                    SCHWARM_RELEASE -> if (e.stateKey.isEmpty()) release = release(c)
                    SCHWARM_TAGESBERICHT -> if (e.stateKey.isEmpty()) bericht = tagesbericht(c)
                    SCHWARM_APP -> if (e.stateKey.isEmpty()) app = appRelease(c)
                    SCHWARM_RUHE -> if (e.stateKey.isEmpty()) ruhe = ruhe(c)
                    SCHWARM_LITELLM -> if (e.stateKey.isEmpty()) lite = litellm(c)
                }
            }
        }
        return Hubstand(
            einheiten, tuer, abo, liste, weg, kennzahlen, rollen, neu, modelle, stimmen, release, bericht, app, ruhe, lite,
        )
    }

    /**
     * Die veröffentlichte APK (Punkt 20). Ohne `mxc` und `version_code` gibt es kein Update: Die App
     * lädt nur, was der Hub ausdrücklich veröffentlicht hat.
     */
    fun appRelease(c: JsonObject): AppRelease? {
        val mxc = c.str("mxc")?.takeIf { it.startsWith("mxc://") && it.length <= 256 } ?: return null
        val code = c.zahl("version_code")?.toInt()?.takeIf { it in 1..100_000 } ?: return null
        val summe = c.str("sha256")?.trim()?.lowercase()?.takeIf { Regex("""^[0-9a-f]{64}$""").matches(it) }.orEmpty()
        return AppRelease(
            versionCode = code,
            versionName = c.str("version_name")?.take(32)?.ifBlank { null } ?: "$code",
            mxc = mxc,
            groesse = c.zahl("groesse")?.toLong()?.coerceIn(0, AppUpdate.MAX_BYTES) ?: 0,
            sha256 = summe,
            notizen = c.str("notizen")?.take(600).orEmpty(),
            zeit = c.zeit("zeit"),
        )
    }

    fun einheiten(stateKey: String, c: JsonObject): Einheiten? {
        val agent = stateKey.ifBlank { c.str("agent").orEmpty() }.ifBlank { return null }
        val eintraege = c.arr("eintraege").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val name = o.str("name")?.trim()?.ifBlank { null } ?: return@mapNotNull null
            val zustand = o.str("zustand").orEmpty()
            Einheit(
                name = name,
                zustand = EinheitZustand.von(zustand),
                zustandText = zustand,
                text = o.str("text").orEmpty(),
                link = o.str("link")?.takeIf { it.startsWith("https://") },
                id = o.str("id"),
                auftrag = o.str("auftrag")?.takeIf { auftragForm.matches(it) },
            )
        }
        return Einheiten(agent, c.zeit("at") ?: 0L, c.wahr("verbunden") ?: true, eintraege)
    }

    fun tuersteher(c: JsonObject): Tuersteher {
        val sperren = c.arr("sperren").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val ip = o.str("ip")?.trim()?.takeIf { ipForm.matches(it) } ?: return@mapNotNull null
            Sperre(ip, o.zeit("seit"), o.zeit("bis"), o.str("grund").orEmpty(), o.wahr("rueckfall") ?: false)
        }.take(30)
        return Tuersteher(
            aktualisiert = c.zeit("aktualisiert"),
            veraltet = c.wahr("veraltet") ?: false,
            gesperrt = c.zahl("gesperrt")?.toInt() ?: sperren.size,
            neu7Tage = c.zahl("neu_7_tage")?.toInt() ?: 0,
            vertraut = c.zahl("vertraut")?.toInt() ?: 0,
            sperren = sperren,
        )
    }

    fun kontingente(c: JsonObject): Kontingente {
        val eintraege = c.arr("eintraege").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val agent = o.str("agent")?.ifBlank { null } ?: return@mapNotNull null
            Kontingent(
                agent = agent,
                anbieter = o.str("anbieter").orEmpty(),
                fenster = o.str("fenster").orEmpty(),
                // Seit „keine Kommazahlen“ als ganze Prozent; der frühere Anteil 0…1 gilt weiter.
                auslastung = (o.zahl("prozent")?.div(100.0) ?: o.zahl("auslastung"))?.takeIf { !it.isNaN() }?.coerceIn(0.0, 1.0),
                zurueck = o.zeit("zurueck"),
                stand = o.zeit("stand"),
            )
        }
        val umleitung = c.obj("umleitung")?.mapNotNull { (von, nach) ->
            (nach as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.let { von to it }
        }?.toMap().orEmpty()
        return Kontingente(c.zeit("at"), eintraege, umleitung)
    }

    fun routinen(c: JsonObject): List<Routine> = c.arr("routinen").orEmpty().mapNotNull { el ->
        val o = el as? JsonObject ?: return@mapNotNull null
        val name = o.str("name")?.ifBlank { null } ?: return@mapNotNull null
        val letzter = o.obj("letzter")?.let { l ->
            RoutineLauf(l.str("auftrag")?.takeIf { auftragForm.matches(it) }, Zustand.von(l.str("zustand")), l.zeit("zeit"))
        }
        Routine(
            name = name,
            zeitplan = o.str("zeitplan").orEmpty(),
            agent = o.str("agent").orEmpty(),
            ziel = o.str("ziel").orEmpty(),
            pausiert = o.wahr("pausiert") ?: false,
            naechster = o.zeit("naechster"),
            letzter = letzter,
            fehler = o.str("fehler")?.trim()?.ifBlank { null },
        )
    }

    fun release(c: JsonObject): ReleaseStand = ReleaseStand(
        strasse = c.wahr("strasse") ?: false,
        tag = c.str("tag")?.take(64),
        basis = c.str("basis")?.take(12),
        zusatz = c.zahl("zusatz")?.toInt(),
        suiten = c.zahl("suiten")?.toInt(),
        gruen = c.zahl("gruen")?.toInt(),
        pruefungen = c.zahl("pruefungen")?.toInt(),
        seit = c.zeit("seit"),
    )

    private val liteModell = Regex("""^[A-Za-z0-9][A-Za-z0-9_./:-]{0,79}$""")

    fun litellm(c: JsonObject): LiteLlm = LiteLlm(
        erreichbar = c.wahr("erreichbar") ?: false,
        modelle = c.arr("modelle").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val id = o.str("id")?.takeIf { liteModell.matches(it) } ?: return@mapNotNull null
            id to (o.str("anbieter")?.take(30) ?: "LiteLLM")
        }.take(100),
        ausgabenCent = c.zahl("ausgaben_cent")?.toInt(),
        budgetCent = c.zahl("budget_cent")?.toInt(),
        zeitraum = c.str("zeitraum")?.take(10),
        zurueck = c.zeit("zurueck"),
        stand = c.zeit("stand"),
        fehler = c.str("fehler")?.take(120),
    )

    fun ruhe(c: JsonObject): Ruhe? {
        val von = c.str("von")?.takeIf { Ruhe.minuten(it) != null } ?: return null
        val bis = c.str("bis")?.takeIf { Ruhe.minuten(it) != null } ?: return null
        return Ruhe(c.wahr("an") ?: false, von, bis, c.str("zone")?.take(40) ?: "Europe/Zurich")
    }

    fun tagesbericht(c: JsonObject): Tagesbericht? {
        val tag = c.str("tag")?.takeIf { Regex("""^\d{4}-\d{2}-\d{2}$""").matches(it) } ?: return null
        fun n(k: String) = c.zahl(k)?.toInt() ?: 0
        return Tagesbericht(
            tag = tag,
            erstellt = c.zeit("erstellt"),
            auftraege = n("auftraege"), ok = n("ok"), fehler = n("fehler"), abbruch = n("abbruch"),
            offen = n("offen"), warten = n("warten"),
            kostenCent = n("kosten_cent"), budgetCent = c.zahl("budget_cent")?.toInt(),
            alarmeOffen = n("alarme_offen"),
            abo = c.arr("abo").orEmpty().mapNotNull { el ->
                val o = el as? JsonObject ?: return@mapNotNull null
                val agent = o.str("agent") ?: return@mapNotNull null
                agent to (o.zahl("pct")?.toInt() ?: return@mapNotNull null)
            },
        )
    }

    fun notaus(c: JsonObject): NotausInfo = NotausInfo(
        url = c.str("url")?.takeIf { it.startsWith("https://") },
        geraete = c.arr("geraete").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val id = o.str("id")?.lowercase()?.takeIf { geraetForm.matches(it) } ?: return@mapNotNull null
            NotausGeraet(
                id, o.str("name").orEmpty().ifBlank { id.take(8) }, o.zeit("erstellt"),
                push = o.obj("push")?.let { p -> GeraetPush(p.str("host").orEmpty(), p.zeit("ok"), p.str("fehler")?.take(200)) },
            )
        },
    )

    fun kennzahlen(stateKey: String, c: JsonObject): Kennzahlen? {
        val zeitraum = stateKey.ifBlank { c.str("zeitraum").orEmpty() }.ifBlank { return null }
        val tage = c.arr("tage").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val text = o.str("tag") ?: return@mapNotNull null
            KennTag(
                tag = runCatching { LocalDate.parse(text) }.getOrNull(),
                tagText = text,
                auftraege = o.zahl("auftraege")?.toInt() ?: 0,
                ok = o.zahl("ok")?.toInt() ?: 0,
                fehler = o.zahl("fehler")?.toInt() ?: 0,
                abbruch = o.zahl("abbruch")?.toInt() ?: 0,
                kosten = usd(o, "kosten"),
                alarme = o.zahl("alarme")?.toInt() ?: 0,
            )
        }.sortedBy { it.tagText }
        val agenten = c.arr("agenten").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val agent = o.str("agent")?.ifBlank { null } ?: return@mapNotNull null
            KennAgent(
                agent = agent,
                auftraege = o.zahl("auftraege")?.toInt() ?: 0,
                ok = o.zahl("ok")?.toInt() ?: 0,
                quote = o.zahl("quote_pct")?.div(100.0) ?: o.zahl("quote"),
                dauerMedianS = o.zahl("dauer_median_s"),
                kosten = usd(o, "kosten"),
                budgetTag = o.zahl("budget_tag_cent")?.div(100.0) ?: o.zahl("budget_tag"),
                plus = o.zahl("plus")?.toInt() ?: 0,
                minus = o.zahl("minus")?.toInt() ?: 0,
                pauseBis = o.zeit("pause_bis"),
            )
        }
        val freigaben = c.obj("freigaben")
        val alarme = c.obj("alarme")
        return Kennzahlen(
            zeitraum = zeitraum,
            von = c.str("von"),
            bis = c.str("bis"),
            erstellt = c.zeit("erstellt"),
            tage = tage,
            agenten = agenten,
            freigabenAnzahl = freigaben?.zahl("anzahl")?.toInt(),
            freigabenMedianS = freigaben?.zahl("median_s"),
            alarmeAnzahl = alarme?.zahl("anzahl")?.toInt(),
            alarmeQuittiert = alarme?.zahl("quittiert")?.toInt(),
            alarmeMedianQuittungS = alarme?.zahl("median_quittung_s"),
        )
    }

    fun rolle(mxid: String, c: JsonObject): GastRolle? {
        if (!mxid.startsWith("@")) return null
        val liste = { k: String ->
            c.arr(k).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeUnless { p -> p is JsonNull }?.content?.trim()?.ifBlank { null } }
        }
        return GastRolle(
            mxid = mxid,
            rolle = c.str("rolle").orEmpty().ifBlank { "gast" },
            name = c.str("name"),
            agenten = liste("agenten"),
            // Befehle ohne „!“ und klein, so vergleicht auch der Hub.
            befehle = liste("befehle").map { it.removePrefix("!").lowercase() },
            budgetUsdTag = (c.zahl("budget_usd_tag_cent") ?: c.zahl("budget_tag_cent"))?.div(100.0) ?: c.zahl("budget_usd_tag"),
        )
    }

    /** Beträge kommen als `<k>_cent` (ganze Zahl) oder, wie früher, als `<k>` in USD. */
    private fun usd(o: JsonObject, k: String): Double = o.zahl("${k}_cent")?.div(100.0) ?: o.zahl(k) ?: 0.0

    /** Das Feld `ch.zwaetschge.swarm.patch` an einem `m.file`. */
    fun patchInfo(c: JsonObject): PatchInfo = PatchInfo(
        auftrag = c.str("task")?.takeIf { auftragForm.matches(it) },
        repo = c.str("repo"),
        dateien = c.zahl("dateien")?.toInt(),
        plus = c.zahl("plus")?.toInt(),
        minus = c.zahl("minus")?.toInt(),
    )
}

/**
 * Zeitpunkte kommen als Millisekunden (`at`, `stand`, `erstellt`) oder als ISO-Zeit („…Z“). Für die
 * App ist beides ein Zeitpunkt in ms; was sich nicht lesen lässt, ist `null`.
 */
internal fun JsonObject.zeit(k: String): Long? {
    val p = (this[k] as? JsonPrimitive)?.takeUnless { it is JsonNull } ?: return null
    val t = p.content.trim()
    if (t.isEmpty()) return null
    t.toLongOrNull()?.let { return it }
    t.toDoubleOrNull()?.let { return it.toLong() }
    return runCatching { Instant.parse(t).toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(t).toInstant().toEpochMilli() }.getOrNull()
}

internal fun JsonObject.wahr(k: String): Boolean? =
    (this[k] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.lowercase()?.toBooleanStrictOrNull()
