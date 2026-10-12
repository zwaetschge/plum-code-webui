package com.claudewebui.swarm.data

import kotlinx.serialization.Serializable

/**
 * Das Modell des Schwarms, wie ihn die App sieht (PLAN-swarm §8). Alles davon steht in
 * Matrix: Agent Cards als State-Events in der Lobby, Aufträge als Karten in den
 * Arbeitsräumen und als Board-Notices, Signale als Reaktionen. Freigaben und Alarme sind
 * Notices des Hubs mit Antworten in ihrem Thread (ADR-003 R1 und R4).
 */

const val SCHWARM_AGENT = "ch.zwaetschge.swarm.agent"
const val SCHWARM_RAUM = "ch.zwaetschge.swarm.room"
const val SCHWARM_AUFTRAG = "ch.zwaetschge.swarm.task"

/** Frist einer Freigabe, wenn die Notice keine nennt (wie `FREIGABE_MIN` im Hub). */
const val FREIGABE_FRIST_MIN = 30

/** So lange zeigt die App „wartet auf Quittung“; danach macht sie ohne Quittung weiter. */
const val QUITTUNG_FRIST_MS = 2 * 60_000L

enum class Zustand(val wire: String, val zeichen: String, val titel: String) {
    EINGEREICHT("submitted", "📥", "Eingereicht"),
    IN_ARBEIT("working", "⚙️", "In Arbeit"),
    RUECKFRAGE("input-required", "❓", "Rückfrage"),
    FREIGABE("auth-required", "🔐", "Freigabe nötig"),
    FERTIG("completed", "✅", "Fertig"),
    FEHLGESCHLAGEN("failed", "❌", "Fehlgeschlagen"),
    ABGEBROCHEN("canceled", "🛑", "Abgebrochen"),
    ABGELEHNT("rejected", "🚫", "Abgelehnt");

    val offen: Boolean get() = this == EINGEREICHT || this == IN_ARBEIT || this == RUECKFRAGE || this == FREIGABE
    val wartetAufDich: Boolean get() = this == RUECKFRAGE || this == FREIGABE

    companion object {
        fun von(wire: String?): Zustand? = entries.firstOrNull { it.wire == wire }
    }
}

enum class AgentStatus(val wire: String, val titel: String) {
    ONLINE("online", "online"),
    TRAEGE("unresponsive", "reagiert nicht"),
    PAUSIERT("paused", "pausiert"),
    OFFLINE("offline", "offline");

    companion object {
        fun von(wire: String?): AgentStatus = entries.firstOrNull { it.wire == wire } ?: OFFLINE
    }
}

@Serializable
data class Agent(
    val id: String,
    val name: String,
    val level: String,
    val trust: String,
    val modus: String,
    val status: AgentStatus,
    val raumId: String?,
    val laufzeit: String?,
    val modell: String?,
    val faehigkeiten: List<String>,
    val parallel: Int,
    val budgetTag: String?,
    val mxid: String,
) {
    /** Nur native Bots lesen ihren Raum selbst; Worker und Melder hören nur auf den Hub. */
    val direktAnsprechbar: Boolean get() = modus == "native"
    val nimmtAuftraege: Boolean get() = modus != "notify"
}

@Serializable
data class Auftrag(
    val id: String,
    val zustand: Zustand,
    val zustaendig: String,
    val ziel: String,
    val hop: Int?,
    val frist: String?,
    val hinweis: String?,
    val aktualisiert: Long,
    val raumId: String?,
    val threadWurzel: String?,
    val ergebnis: String?,
    val grenzen: List<String>,
    val budget: String?,
    val eltern: String?,
    val von: String?,
) {
    /** `T-0142` → 142, damit neue Aufträge oben stehen. */
    val nummer: Int get() = id.removePrefix("T-").toIntOrNull() ?: 0
}

data class Nachricht(
    val eventId: String,
    val raumId: String,
    val absender: String,
    val absenderName: String,
    val zeit: Long,
    val text: String,
    val notice: Boolean,
    val threadWurzel: String?,
    val bearbeitet: Boolean,
    val reaktionen: Map<String, Int>,
    val eigeneReaktionen: Set<String>,
    val auftragId: String?,
    val vonMir: Boolean,
    val vomHub: Boolean,
    /** Deine Reaktionen mit der Zeit der jeweils letzten – für Umschalter wie 🔕 und 🔔. */
    val eigeneZeiten: Map<String, Long> = emptyMap(),
    /** Ein Anhang (`m.file`), etwa der Patch eines Code-Auftrags. */
    val datei: Datei? = null,
)

/** Die Angaben aus `ch.zwaetschge.swarm.patch` an einem Patch-Anhang. */
data class PatchInfo(val auftrag: String?, val repo: String?, val dateien: Int?, val plus: Int?, val minus: Int?)

/** Ein Anhang: Name, `mxc://`-Adresse und, bei einem Patch des Schwarms, dessen Angaben; oder ein Bild. */
data class Datei(
    val name: String,
    val mxc: String?,
    val mime: String?,
    val groesse: Long?,
    val patch: PatchInfo?,
    /** Ein `m.image` statt eines `m.file`. */
    val bild: Boolean = false,
    val breite: Int? = null,
    val hoehe: Int? = null,
    /** Der msgtype: `m.image`, `m.video`, `m.audio` oder `m.file` (App 2.2). */
    val art: String = if (bild) "m.image" else "m.file",
    val dauerMs: Long? = null,
    /** Eine Sprachnachricht (`org.matrix.msc3245.voice`). */
    val sprache: Boolean = false,
    /** Pegel 0–1024 aus `org.matrix.msc1767.audio.waveform`. */
    val welle: List<Int>? = null,
) {
    val video: Boolean get() = art == "m.video"
    val audio: Boolean get() = art == "m.audio"

    /** Code-Aufträge liefern ihren Patch als Datei auf `.patch` (SCHNITTSTELLEN-app.md, Patches). */
    val istPatch: Boolean get() = patch != null || name.endsWith(".patch", ignoreCase = true)
}

// ── Entscheidungen: Pläne und Tore ──────────────────────────────────────────

enum class EntscheidungsArt(val zeichen: String, val titel: String, val ja: String, val nein: String) {
    /** „❓ 📋 Plan“ eines grossen Auftrags (Punkt 8): ✅ nimmt ihn an, ❌ lehnt ab. */
    PLAN("📋", "Plan", "Plan annehmen", "Ablehnen"),
    /** „🚦“ eines Ablaufs (Punkt 11): ✅ geht zum nächsten Schritt, ❌ hält an. */
    TOR("🚦", "Tor", "Weiter", "Anhalten"),
}

/** Eine Notice, auf die der Hub dein ✅ oder ❌ als Reaktion erwartet. */
data class Entscheidung(
    val art: EntscheidungsArt,
    val nachricht: Nachricht,
    val auftragId: String?,
    /** Der Ablauf eines Tors, etwa `code-änderung`. */
    val ablauf: String?,
    /** Deine Reaktion ✅ oder ❌, falls schon gesendet. */
    val meine: String?,
    /** Wartet noch auf dich: ohne deine Reaktion und nicht überholt. */
    val offen: Boolean,
    /**
     * Die Kopie in der Lobby („❓ <Agent> fragt zu T-…“ mit demselben Plan). Deine Reaktion wirkt auch
     * dort; die Übersicht zeigt aber nur die Notice im Thread der Karte.
     */
    val kopie: Boolean = false,
)

data class Einladung(val raumId: String, val name: String, val einlader: String?)

// ── Freigaben (ADR-003 R1) ──────────────────────────────────────────────────

enum class FreigabeZustand(val zeichen: String, val titel: String) {
    OFFEN("🔐", "Freigabe nötig"),
    FREIGEGEBEN("✅", "Freigegeben"),
    ABGELEHNT("❌", "Abgelehnt"),
    ABGELAUFEN("⌛", "Abgelaufen"),
}

/**
 * Eine Freigabe-Notice des Hubs in #schwarm-freigaben: eine Übergabe an einen Agenten mit
 * Host-Zugriff oder eine gelbe Betriebsaktion. Es zählt nur deine Reaktion auf die Notice
 * (✅ gibt frei, ❌ lehnt ab); entschieden ist sie, sobald der Hub im Thread quittiert.
 */
@Serializable
data class Freigabe(
    val eventId: String,
    val raumId: String,
    val auftragId: String,
    /** Vertrauensstufe des Ziels aus der Notice, etwa `T2`. */
    val stufe: String?,
    val kette: String,
    val was: String,
    val ergebnis: String?,
    val grenzen: String?,
    val gesendet: Long,
    val ablauf: Long,
    /** Was der Hub quittiert hat; ohne Quittung OFFEN. */
    val zustand: FreigabeZustand,
    val quittiert: Long?,
    /** Deine Reaktion auf die Notice (✅, ❌ oder 🛑), falls schon gesendet. */
    val meineReaktion: String?,
) {
    /** Das letzte Glied der Kette: wer mit der Freigabe loslegt. */
    val ziel: String get() = kette.substringAfterLast('→').trim().ifBlank { "?" }

    /** Ohne Quittung zählt die Uhr: Nach der Frist ist die Anfrage abgelaufen. */
    fun zustandUm(jetzt: Long): FreigabeZustand =
        if (zustand == FreigabeZustand.OFFEN && jetzt >= ablauf) FreigabeZustand.ABGELAUFEN else zustand

    fun offenUm(jetzt: Long): Boolean = zustandUm(jetzt) == FreigabeZustand.OFFEN

    /** Offen und noch ohne deine Reaktion: Das zählt das Abzeichen. */
    fun brauchtDichUm(jetzt: Long): Boolean = offenUm(jetzt) && meineReaktion == null
}

// ── Alarme (ADR-003 R4) ─────────────────────────────────────────────────────

enum class AlarmStufe(val wire: String, val zeichen: String, val titel: String) {
    INFO("info", "ℹ️", "Info"),
    WARN("warn", "⚠️", "Warnung"),
    CRIT("crit", "🚨", "Kritisch");

    companion object {
        fun von(wire: String?): AlarmStufe? = entries.firstOrNull { it.wire == wire }
    }
}

enum class AlarmZustand(val titel: String) {
    OFFEN("offen"),
    BEHOBEN("behoben"),
    /** Von dir mit ✅ quittiert: still, bis die Quelle ihn behebt oder er schlimmer wird. */
    QUITTIERT("quittiert"),
}

/**
 * Ein Alarm mit Lebenslauf aus #schwarm-alarme: pro Quelle und Fingerabdruck eine Notice.
 * Anstieg, Behebung, Quittieren und Stumm stehen als Antworten in ihrem Thread.
 */
@Serializable
data class Alarm(
    val eventId: String,
    val raumId: String,
    val quelle: String,
    val absender: String,
    /** Die Stufe jetzt, nach allen Anstiegen. */
    val stufe: AlarmStufe,
    val ersteStufe: AlarmStufe,
    val titel: String,
    val text: String,
    val link: String?,
    val fingerabdruck: String,
    val zeit: Long,
    val zustand: AlarmZustand,
    val beendet: Long?,
    val beendetText: String?,
    /** Titel des letzten Anstiegs, etwa „paperless: unhealthy seit 15 min“. */
    val anstieg: String?,
    val stummBis: Long?,
    /** Zeit der letzten Stumm- oder Laut-Quittung; deine Reaktionen danach warten noch. */
    val stummGeaendert: Long,
    val zuletzt: Long,
    /** Deine Reaktionen auf die Notice (✅ 🔕 🔔) mit der Zeit der jeweils letzten. */
    val meineReaktionen: Map<String, Long>,
) {
    fun stummUm(jetzt: Long): Boolean = stummBis != null && stummBis > jetzt

    /**
     * Dein ✅ ohne Antwort des Hubs: erst „wartet“, nach [QUITTUNG_FRIST_MS] gilt der Alarm als von
     * dir quittiert. Der Hub antwortet nur auf offene Alarme; war er schon still behoben (etwa
     * stumm), kommt keine Antwort mehr.
     */
    fun zustandUm(jetzt: Long): AlarmZustand {
        val zu = meineReaktionen["✅"]
        return if (zustand == AlarmZustand.OFFEN && zu != null && jetzt - zu >= QUITTUNG_FRIST_MS) AlarmZustand.QUITTIERT else zustand
    }

    fun offenUm(jetzt: Long): Boolean = zustandUm(jetzt) == AlarmZustand.OFFEN

    /** Deine Reaktion `zeichen` ist raus, die Quittung des Hubs fehlt noch. */
    fun wartetAuf(zeichen: String, jetzt: Long): Boolean {
        val gesendet = meineReaktionen[zeichen] ?: return false
        if (jetzt - gesendet >= QUITTUNG_FRIST_MS) return false
        return if (zeichen == "✅") zustand == AlarmZustand.OFFEN else gesendet > stummGeaendert
    }

    /** Wann sich die Anzeige von selbst ändert: Ende von Stumm oder einer Quittungsfrist. */
    val fristen: List<Long> get() = listOfNotNull(stummBis) + meineReaktionen.values.map { it + QUITTUNG_FRIST_MS }
}

data class Raeume(
    val lobby: String? = null,
    val board: String? = null,
    val freigaben: String? = null,
    val log: String? = null,
    val alarme: String? = null,
    val space: String? = null,
    val agenten: Map<String, String> = emptyMap(),
    /** „Allgemein“: das DM mit Brian (App 2.1), aus den Account-Daten. */
    val allgemein: String? = null,
) {
    val alle: Set<String>
        get() = (listOfNotNull(lobby, board, freigaben, log, alarme, space, allgemein) + agenten.values).toSet()
}

data class Verlauf(
    val nachrichten: List<Nachricht> = emptyList(),
    val aeltereVon: String? = null,
    val laedtAeltere: Boolean = false,
    val anfangErreicht: Boolean = false,
)

enum class Verbindung { VERBINDET, BEREIT, FEHLER, ABGEMELDET }

data class SchwarmZustand(
    val verbindung: Verbindung = Verbindung.VERBINDET,
    val fehler: String? = null,
    val ich: String = "",
    val raeume: Raeume = Raeume(),
    val beigetreten: Set<String> = emptySet(),
    val agenten: List<Agent> = emptyList(),
    val auftraege: List<Auftrag> = emptyList(),
    val verlaeufe: Map<String, Verlauf> = emptyMap(),
    val einladungen: List<Einladung> = emptyList(),
    val freigaben: List<Freigabe> = emptyList(),
    val alarme: List<Alarm> = emptyList(),
    /** Je Raum die Notices ohne Lebenslauf (ältere Formate) in #schwarm-freigaben und #schwarm-alarme: nur zum Lesen. */
    val nurLesen: Map<String, List<Nachricht>> = emptyMap(),
    val zuletztSync: Long = 0,
    /** Die State-Events des Hubs in der Lobby: Plum, Türsteher, Abo-Stand, Routinen, Not-Aus, Kennzahlen, Rollen. */
    val hub: Hubstand = Hubstand(),
    /** Vale oder Gast; vor dem ersten Sync für andere Konten `PRUEFT`. */
    val rolle: Rolle = Rolle.VALE,
    /** Pläne und Tore, neueste zuerst. */
    val entscheidungen: List<Entscheidung> = emptyList(),
    /** „🆕“ und „🗑“ der Plum-Brücke aus #ag-plum, neueste zuerst, höchstens 10. */
    val plumHinweise: List<Nachricht> = emptyList(),
    /** Zeigt die App den gespeicherten letzten Stand statt eines frischen Syncs, steht hier seine Zeit. */
    val ausSpeicher: Long? = null,
    /** „Allgemein“, der Chat mit Brian. */
    val allgemein: Allgemein = Allgemein(),
    /** Ungelesenes je Raum, von der App selbst gerechnet. */
    val ungelesen: Map<String, Ungelesen> = emptyMap(),
) {
    fun agent(id: String?): Agent? = agenten.firstOrNull { it.id == id }
    fun auftrag(id: String?): Auftrag? = auftraege.firstOrNull { it.id == id }
    fun verlauf(raum: String?): Verlauf = raum?.let { verlaeufe[it] } ?: Verlauf()
    fun freigabe(eventId: String?): Freigabe? = freigaben.firstOrNull { it.eventId == eventId }
    fun alarm(eventId: String?): Alarm? = alarme.firstOrNull { it.eventId == eventId }

    /** Die jüngste Freigabe-Notice zu einem Auftrag. */
    fun freigabeFuer(auftrag: String?): Freigabe? =
        freigaben.filter { it.auftragId == auftrag }.maxByOrNull { it.gesendet }

    fun nachricht(raum: String?, eventId: String?): Nachricht? =
        verlauf(raum).nachrichten.firstOrNull { it.eventId == eventId }

    /** Die Karte eines Auftrags (das Event mit `ch.zwaetschge.swarm.task`), falls geladen. */
    fun karte(t: Auftrag?): Nachricht? = t?.let { nachricht(it.raumId, it.threadWurzel) }

    /** Der offene Plan eines Auftrags, falls einer auf dich wartet. */
    fun offenerPlan(auftrag: String): Entscheidung? =
        entscheidungen.firstOrNull { it.art == EntscheidungsArt.PLAN && it.offen && it.auftragId == auftrag }

    /** Der Stand ist nicht frisch: aus dem Speicher oder die Verbindung ist gestört. */
    val alterStand: Boolean get() = ausSpeicher != null || verbindung == Verbindung.FEHLER

    /** Seit wann der gezeigte Stand gilt. */
    val standZeit: Long get() = ausSpeicher ?: zuletztSync

    fun ungelesenIn(raum: String?): Int = raum?.let { ungelesen[it]?.anzahl } ?: 0
}
