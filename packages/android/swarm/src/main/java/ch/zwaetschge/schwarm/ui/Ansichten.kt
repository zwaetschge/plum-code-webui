@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.background
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Person4
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Alarm
import com.claudewebui.swarm.data.AlarmStufe
import com.claudewebui.swarm.data.Auftrag
import com.claudewebui.swarm.data.Einladung
import com.claudewebui.swarm.data.Entscheidung
import com.claudewebui.swarm.data.EntscheidungsArt
import com.claudewebui.swarm.data.Freigabe
import com.claudewebui.swarm.data.SCHWARM_EINHEITEN
import com.claudewebui.swarm.data.SCHWARM_KENNZAHLEN
import com.claudewebui.swarm.data.SCHWARM_KONTINGENTE
import com.claudewebui.swarm.data.SCHWARM_MODELLE
import com.claudewebui.swarm.data.SCHWARM_NOTAUS
import com.claudewebui.swarm.data.SCHWARM_ROLLEN
import com.claudewebui.swarm.data.SCHWARM_ROUTINEN
import com.claudewebui.swarm.data.SCHWARM_STIMMEN
import com.claudewebui.swarm.data.SCHWARM_TUERSTEHER
import com.claudewebui.swarm.data.ModellBefehl
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Tagesbericht
import com.claudewebui.swarm.data.Zustand

// ── Aktuell ─────────────────────────────────────────────────────────────────

/**
 * Was auf dich wartet (App 2.4). Früher stand das an fünf Orten (Übersicht, Board, Meldungen, Lobby,
 * Arbeitsraum); jetzt steht es hier einmal, mit Knöpfen, und die Länge ist das Abzeichen von „Aktuell“.
 */
sealed interface Dringend {
    val schluessel: String
    val auftragId: String?

    data class FreigabeW(val f: Freigabe) : Dringend {
        override val schluessel: String get() = "f-" + f.eventId
        override val auftragId: String get() = f.auftragId
    }

    data class AlarmW(val al: Alarm) : Dringend {
        override val schluessel: String get() = "a-" + al.eventId
        override val auftragId: String? get() = null
    }

    data class EntscheidungW(val e: Entscheidung) : Dringend {
        override val schluessel: String get() = "e-" + e.nachricht.eventId
        override val auftragId: String? get() = e.auftragId
    }

    data class RueckfrageW(val t: Auftrag) : Dringend {
        override val schluessel: String get() = "r-" + t.id
        override val auftragId: String get() = t.id
    }
}

/**
 * Das Dringendste zuerst: Freigaben (sie laufen ab), kritische Alarme, Pläne und Tore, Rückfragen, dann
 * Warnungen. Stumme Alarme und Infos fehlen, sie stehen unter Räume → Alarme. Ein Auftrag mit offenem Plan
 * oder offener Freigabe steht nur einmal da, als Plan oder Freigabe.
 */
fun brauchtDich(z: SchwarmZustand, jetzt: Long): List<Dringend> {
    val aus = ArrayList<Pair<Int, Dringend>>()
    val gedeckt = HashSet<String>()
    if (z.rolle.entscheidet) {
        z.freigaben.filter { it.brauchtDichUm(jetzt) }.sortedBy { it.ablauf }.forEach { aus += 0 to Dringend.FreigabeW(it) }
        // Eine laufende Freigabe deckt ihren Auftrag, auch wenn dein ✅ schon unterwegs ist.
        z.freigaben.filter { it.offenUm(jetzt) }.forEach { gedeckt += it.auftragId }
        z.alarme.filter { it.offenUm(jetzt) && !it.stummUm(jetzt) && it.stufe != AlarmStufe.INFO }
            .sortedByDescending { it.zeit }
            .forEach { aus += (if (it.stufe == AlarmStufe.CRIT) 1 else 4) to Dringend.AlarmW(it) }
        z.entscheidungen.filter { it.offen && !it.kopie }.forEach { e ->
            aus += 2 to Dringend.EntscheidungW(e)
            if (e.art == EntscheidungsArt.PLAN) e.auftragId?.let { gedeckt += it }
        }
    }
    // Ein Gast beantwortet nur Rückfragen zu seinen eigenen Aufträgen; freigeben kann nur Vale.
    z.auftraege
        .filter { t ->
            t.zustand.wartetAufDich && t.id !in gedeckt &&
                (z.rolle.entscheidet || (t.zustand == Zustand.RUECKFRAGE && t.von == z.ich))
        }
        .sortedByDescending { it.aktualisiert }
        .forEach { aus += 3 to Dringend.RueckfrageW(it) }
    return aus.sortedBy { it.first }.map { it.second }
}

private val AUFTRAG_NUMMER = Regex("""\bT-\d{1,8}\b""")

/** Das Abzeichen von „Aktuell“: was auf dich wartet, dazu die offenen Einladungen. */
fun aktuellZahl(z: SchwarmZustand, jetzt: Long): Int = brauchtDich(z, jetzt).size + z.einladungen.size

@Composable
fun AktuellAnsicht(z: SchwarmZustand, a: Aktionen) {
    val vorschau by a.vm.vorschau.collectAsStateWithLifecycle()
    val gelesen by a.vm.tagesberichtGelesen.collectAsStateWithLifecycle()
    val aboVorher by a.vm.aboVorher.collectAsStateWithLifecycle()
    val jetzt = jetztBisFrist(z.freigaben.map { it.ablauf } + z.alarme.flatMap { it.fristen })
    val dringend = brauchtDich(z, jetzt)
    val dringendeAuftraege = dringend.mapNotNull { it.auftragId }.toSet()
    val dringendeAlarme = dringend.mapNotNull { (it as? Dringend.AlarmW)?.al?.eventId }.toSet()
    val laufend = z.auftraege.filter { it.zustand.offen && it.id !in dringendeAuftraege }.sortedByDescending { it.aktualisiert }
    val erledigt = z.auftraege.filter { !it.zustand.offen }.sortedByDescending { it.aktualisiert }.take(3)
    Scaffold(
        topBar = { SchwarmLeiste("Aktuell", aktuellUntertitel(z)) { NotAusKnopf(a) } },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp, end = 16.dp, top = pad.calculateTopPadding() + 4.dp, bottom = 96.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (vorschau) {
                item(key = "vorschau") {
                    HinweisKarte(
                        Icons.Outlined.Info,
                        "Vorschau mit Beispieldaten",
                        "Nichts wird gesendet. Beenden mit „Abmelden“ unter Schwarm → Einstellungen; dort gibt es auch " +
                            "Gastmodus und Störungen zum Ausprobieren.",
                        MaterialTheme.colorScheme.secondary,
                    )
                }
            }
            if (z.alterStand) item(key = "stand") { StandHinweis(z) }
            // Ein Hub, der am Release-Weg vorbei gebaut wurde, hat womöglich nicht alle Befehle (Vale, 27.09.: !modell).
            if (z.hub.release?.strasse == false && z.rolle.istVale) {
                item(key = "ohne-release") {
                    HinweisKarte(
                        Icons.Outlined.Warning,
                        "Hub läuft ohne Release",
                        "Er kam nicht über die Release-Strasse. Befehle wie `!modell` können fehlen, bis er neu ausgerollt ist.",
                        StatusKritisch,
                    )
                }
            }
            if (z.hub.neuereVersion.isNotEmpty()) {
                item(key = "update") { UpdateHinweis(teileText(z.hub.neuereVersion)) }
            }
            if (z.rolle.istGast) item(key = "gast") { GastKarte(z) }
            if (z.einladungen.isNotEmpty()) {
                item(key = "einladungen") { EinladungsKarte(z.einladungen) { a.vm.einladungenAnnehmen() } }
            }
            if (z.rolle.istVale) item(key = "einrichtung") { EinrichtungKarte(z, a) }

            item(key = "dringend-titel") {
                Abschnitt("Braucht dich") {
                    if (dringend.isNotEmpty()) {
                        Text("${dringend.size}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            if (dringend.isEmpty()) {
                item(key = "dringend-leer") {
                    RuhigKarte(
                        Icons.Outlined.TaskAlt,
                        "Nichts wartet auf dich",
                        "Freigaben, Rückfragen, Pläne und Alarme erscheinen hier zuerst, mit Knöpfen zum Entscheiden.",
                    )
                }
            }
            items(dringend, key = { it.schluessel }) { d ->
                when (d) {
                    is Dringend.FreigabeW -> FreigabeKarte(
                        d.f, a, jetzt, onOeffnen = { a.meldungOeffnen(d.f.raumId, d.f.eventId) }, kompakt = true,
                    )
                    is Dringend.AlarmW -> AlarmKarte(
                        d.al, a, jetzt, onOeffnen = { a.meldungOeffnen(d.al.raumId, d.al.eventId) }, kompakt = true,
                    )
                    is Dringend.EntscheidungW -> EntscheidungKarte(d.e, z, a, zeilen = 4)
                    is Dringend.RueckfrageW -> AuftragZeile(d.t, z) { a.auftragOeffnen(d.t.id) }
                }
            }

            // Abo über 90 %: ein Tipp stellt auf das nächst sparsamere Modell um; nach dem Reset zurück (App 2.5).
            if (z.rolle.istVale) {
                items(aboVorschlaege(z, aboVorher), key = { "abo-" + it.agent }) { v -> AboVorschlagKarte(v, z, a) }
            }

            // Der Tagesbericht von 21:00 (App 2.5), bis du ihn weglegst oder er 16 h alt ist.
            val bericht = z.hub.tagesbericht
            if (bericht != null && bericht.tag != gelesen &&
                (bericht.erstellt ?: 0L) > System.currentTimeMillis() - 16 * 3_600_000L
            ) {
                item(key = "tagesbericht") { TagesberichtKarte(bericht, z) { a.vm.tagesberichtWeglegen(bericht.tag) } }
            }

            item(key = "laufend-titel") {
                Abschnitt("Läuft") {
                    if (laufend.isNotEmpty()) Text("${laufend.size}", style = MaterialTheme.typography.labelLarge)
                }
            }
            if (laufend.isEmpty()) {
                item(key = "laufend-leer") {
                    Text(
                        "Gerade läuft nichts.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
            } else {
                items(laufend.take(6), key = { "l-" + it.id }) { AuftragZeile(it, z) { a.auftragOeffnen(it.id) } }
                if (laufend.size > 6) {
                    item(key = "laufend-mehr") {
                        TextButton(onClick = { a.oeffnen(Detail.BoardD) }) { Text("Alle ${laufend.size} laufenden Aufträge") }
                    }
                }
            }

            // Ungelesenes aus Lobby, Alarmen und Arbeitsräumen, ohne das, was oben schon mit Knöpfen steht. Die
            // Kopien in der Lobby („❓ T-0012 · Brian fragt …“) tragen keine auftragId: Dort zählt die Nummer im Text.
            item(key = "neu") {
                AktuellBlock(z, a) { n ->
                    val nummer = n.auftragId ?: AUFTRAG_NUMMER.find(ersteZeile(n.text))?.value
                    nummer?.let { it in dringendeAuftraege } == true ||
                        n.threadWurzel?.let { it in dringendeAlarme } == true || n.eventId in dringendeAlarme
                }
            }

            item(key = "erledigt-titel") {
                Abschnitt("Zuletzt erledigt") {
                    TextButton(onClick = { a.oeffnen(Detail.BoardD) }) { Text("Alle Aufträge") }
                }
            }
            if (erledigt.isEmpty()) {
                item(key = "erledigt-leer") {
                    Text(
                        "Noch nichts erledigt.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
            }
            items(erledigt, key = { "e-" + it.id }) { AuftragZeile(it, z) { a.auftragOeffnen(it.id) } }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
}

/**
 * Ein Vorschlag zum Abo (App 2.5): Das Abo eines Agenten ist über 90 %, also ein sparsameres Modell; oder es ist
 * wieder frei, und die App bietet das Modell von vorher an.
 */
data class AboVorschlag(
    val agent: String,
    val name: String,
    val pct: Int,
    val zurueck: Long?,
    val jetzt: String,
    val neu: String,
    val befehl: String,
    /** Das Modell, das die App sich merkt (beim Umstellen das alte); null beim Zurückstellen. */
    val merken: String?,
    val wiederFrei: Boolean,
)

fun aboVorschlaege(z: SchwarmZustand, vorher: Map<String, String>, jetzt: Long = System.currentTimeMillis()): List<AboVorschlag> {
    val eintraege = z.hub.kontingente?.eintraege.orEmpty()
    return eintraege.groupBy { it.agent }.mapNotNull { (agent, liste) ->
        val st = z.hub.modelle[agent]?.takeIf { it.einstellbar } ?: return@mapNotNull null
        val aktuell = st.modell ?: return@mapNotNull null
        val hoechste = liste.filter { it.auslastung != null }.maxByOrNull { it.auslastung ?: 0.0 } ?: return@mapNotNull null
        val anteil = hoechste.auslastung ?: return@mapNotNull null
        val name = z.agent(agent)?.name ?: agent
        val alt = vorher[agent]
        // Wieder frei: unter 80 % oder die Zeit des Resets ist vorbei, und es läuft noch das Ersatzmodell.
        if (alt != null && alt != aktuell && (anteil < 0.8 || (hoechste.zurueck ?: Long.MAX_VALUE) <= jetzt)) {
            val zurueckWahl = st.modelle.firstOrNull { it.id == alt } ?: return@mapNotNull null
            return@mapNotNull AboVorschlag(
                agent, name, Math.round(anteil * 100).toInt(), hoechste.zurueck, st.name(aktuell) ?: aktuell, zurueckWahl.name,
                ModellBefehl.setzen(st, alt, st.fallback.filter { it != alt }, st.aufwand), merken = null, wiederFrei = true,
            )
        }
        if (anteil < 0.9) return@mapNotNull null
        val i = st.modelle.indexOfFirst { it.id == aktuell }
        val sparsamer = if (i >= 0) st.modelle.getOrNull(i + 1) else null
        sparsamer ?: return@mapNotNull null
        AboVorschlag(
            agent, name, Math.round(anteil * 100).toInt(), hoechste.zurueck, st.name(aktuell) ?: aktuell, sparsamer.name,
            ModellBefehl.setzen(st, sparsamer.id, st.fallback.filter { it != sparsamer.id }, st.aufwand),
            merken = alt ?: aktuell, wiederFrei = false,
        )
    }
}

@Composable
private fun AboVorschlagKarte(v: AboVorschlag, z: SchwarmZustand, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    var gesendet by remember(v.agent, v.befehl) { mutableStateOf<String?>(null) }
    val akzent = if (v.wiederFrei) StatusGut else StatusWarnung
    KartenFlaeche(akzent, null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AgentAvatar(v.agent, v.name, groesse = 32.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (v.wiederFrei) "${v.name}: Abo wieder frei" else "${v.name}: Abo bei ${v.pct} %",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    if (v.wiederFrei) "Läuft noch mit ${v.jetzt}, vorher ${v.neu}."
                    else "Läuft mit ${v.jetzt}" + (v.zurueck?.let { ", wieder frei um ${uhrzeit(it)}" } ?: "") + ".",
                    style = MaterialTheme.typography.bodyMedium,
                    color = f.onSurfaceVariant,
                )
            }
        }
        val id = gesendet
        if (id == null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(onClick = { a.vm.aboUmstellen(v.agent, v.befehl, v.merken) { gesendet = it } }) {
                    Text(if (v.wiederFrei) "Zurück auf ${v.neu}" else "Auf ${v.neu} umstellen")
                }
            }
        } else {
            HubAntwortZeile(id, "modell", z)
        }
    }
}

/** Der Tag in Zahlen, wie ihn der Hub um 21:00 schickt (App 2.5). */
@Composable
private fun TagesberichtKarte(b: Tagesbericht, z: SchwarmZustand, onWeglegen: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val datum = "${b.tag.substring(8, 10)}.${b.tag.substring(5, 7)}."
    val usd = { c: Int -> "%.2f".format(java.util.Locale.US, c / 100.0) }
    Surface(color = f.surfaceContainerLow, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Bedtime, null, tint = f.primary, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Tagesbericht $datum", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onWeglegen) { Text("Gelesen") }
            }
            Text(
                if (b.auftraege == 0) "Heute keine neuen Aufträge."
                else "${b.auftraege} Aufträge: ${b.ok} erledigt, ${b.fehler} fehlgeschlagen, ${b.abbruch} abgebrochen",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "Noch offen: ${b.offen}" + if (b.warten > 0) ", davon ${b.warten} bei dir" else "",
                style = MaterialTheme.typography.bodyMedium,
                color = if (b.warten > 0) f.error else f.onSurface,
            )
            Text(
                "Kosten: ${usd(b.kostenCent)} USD" + (b.budgetCent?.let { " von ${usd(it)} USD Tagesbudget" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (b.abo.isNotEmpty()) {
                Text(
                    "Abo: " + b.abo.joinToString(" · ") { (agent, pct) -> "${z.agent(agent)?.name ?: agent} $pct %" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (b.abo.any { it.second >= 90 }) StatusWarnung else f.onSurface,
                )
            }
            Text(
                if (b.alarmeOffen == 0) "Keine offenen Alarme." else "${b.alarmeOffen} Alarm${if (b.alarmeOffen == 1) "" else "e"} offen",
                style = MaterialTheme.typography.bodyMedium,
                color = if (b.alarmeOffen > 0) f.error else f.onSurfaceVariant,
            )
        }
    }
}

/** „verbunden · 4 von 6 Agenten online“, bei Störung der Stand der Verbindung. */
fun aktuellUntertitel(z: SchwarmZustand): String {
    val auftrag = z.agenten.filter { it.nimmtAuftraege }
    if (z.verbindung != com.claudewebui.swarm.data.Verbindung.BEREIT || z.ausSpeicher != null || auftrag.isEmpty()) return verbindungText(z)
    val online = auftrag.count { it.status == com.claudewebui.swarm.data.AgentStatus.ONLINE }
    return "verbunden · $online von ${auftrag.size} Agenten online"
}

/** „die Routinen und den Abo-Stand“: welche Teile eine neuere App brauchen. */
fun teileText(typen: Set<String>): String = typen.map {
    when (it) {
        SCHWARM_EINHEITEN -> "die Plum-Sitzungen"
        SCHWARM_TUERSTEHER -> "den Türsteher"
        SCHWARM_KONTINGENTE -> "den Abo-Stand"
        SCHWARM_ROUTINEN -> "die Routinen"
        SCHWARM_NOTAUS -> "den Not-Aus"
        SCHWARM_KENNZAHLEN -> "die Kennzahlen"
        SCHWARM_ROLLEN -> "die Rollen"
        SCHWARM_MODELLE -> "die Modelle"
        SCHWARM_STIMMEN -> "die Stimmen"
        else -> it
    }
}.sorted().let(::aufzaehlung)

/** Im Gastmodus oben: was du darfst und was bei Vale bleibt (Punkt 16). */
@Composable
private fun GastKarte(z: SchwarmZustand) {
    val g = z.rolle.gast ?: return
    val agenten = g.agenten.map { id -> z.agent(id)?.name ?: id }
    HinweisKarte(
        Icons.Outlined.Person4,
        "Gastmodus" + (g.name?.let { " · $it" } ?: ""),
        buildString {
            append(if (agenten.isEmpty()) "Kein Agent ist für dich freigegeben." else "Du kannst Aufträge an ${aufzaehlung(agenten)} geben")
            g.budgetUsdTag?.let { append(" (Budget ${usdText(it)} USD pro Tag)") }
            if (agenten.isNotEmpty()) append(".")
            append(" Freigaben, Alarme und der Not-Aus bleiben bei Vale.")
        },
        MaterialTheme.colorScheme.secondary,
    )
}

@Composable
fun EinladungsKarte(einladungen: List<Einladung>, onAnnehmen: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.MarkEmailUnread, null)
                Spacer(Modifier.width(10.dp))
                Text("${einladungen.size} Schwarm-Räume warten auf dich", style = MaterialTheme.typography.titleMedium)
            }
            Text(
                einladungen.joinToString(" · ") { it.name },
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                "Solange du in einem Arbeitsraum wie #ag-brian fehlst, hat er zu wenige Mitglieder: " +
                    "Der Hub friert ihn ein und nimmt keine Aufträge dafür an.",
                style = MaterialTheme.typography.bodySmall,
            )
            Button(onClick = onAnnehmen) { Text("Allen beitreten") }
        }
    }
}

/**
 * Ein Auftrag als Zeile: links der Agent als Kreis mit Kürzel, oben der Zustand, dann das Ziel, darunter
 * Agent, Nummer und Frist, zuletzt der jüngste Hinweis des Hubs.
 */
@Composable
fun AuftragZeile(t: Auftrag, z: SchwarmZustand, onClick: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val agent = z.agent(t.zustaendig)
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = f.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(start = 12.dp, end = 14.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.Top) {
            AgentAvatar(t.zustaendig, agent?.name ?: t.zustaendig, groesse = 36.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ZustandChip(t.zustand)
                    Spacer(Modifier.weight(1f))
                    Text(vorText(t.aktualisiert), style = MaterialTheme.typography.labelSmall, color = f.outline, maxLines = 1)
                }
                Text(
                    t.ziel.ifBlank { "(ohne Ziel)" },
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOfNotNull(
                        agent?.name ?: t.zustaendig,
                        t.id,
                        t.hop?.takeIf { it > 0 }?.let { "Hop $it" },
                        t.frist?.let { "Frist $it" },
                        t.eltern?.let { "aus $it" },
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = f.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                t.hinweis?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = f.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

// ── Alle Aufträge (das frühere Board) ───────────────────────────────────────

private enum class BoardFilter(val titel: String) { OFFEN("Offen"), WARTET("Wartet auf dich"), ERLEDIGT("Erledigt"), ALLE("Alle") }

@Composable
fun BoardAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: (() -> Unit)? = null, schliessbar: Boolean = false) {
    var filter by rememberSaveable { mutableStateOf(BoardFilter.OFFEN) }
    var nurAgent by rememberSaveable { mutableStateOf<String?>(null) }
    val gefiltert = z.auftraege.filter {
        when (filter) {
            BoardFilter.OFFEN -> it.zustand.offen
            BoardFilter.WARTET -> it.zustand.wartetAufDich
            BoardFilter.ERLEDIGT -> !it.zustand.offen
            BoardFilter.ALLE -> true
        } && (nurAgent == null || it.zustaendig == nurAgent)
    }
    // Wer das Board sieht, hat die Posts im Board-Raum gelesen.
    val board = z.raeume.board
    LaunchedEffect(board, board?.let { z.verlauf(it).nachrichten.lastOrNull()?.eventId }) { board?.let { a.vm.gelesen(it) } }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                "Alle Aufträge",
                "${z.auftraege.count { it.zustand.offen }} offen · ${z.auftraege.size} gesamt",
                zurueck = zurueck,
            ) {
                if (schliessbar) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.padding(top = pad.calculateTopPadding())) {
            if (z.alterStand) StandHinweis(z, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), knapp = true)
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BoardFilter.entries.forEach { b ->
                    FilterChip(selected = filter == b, onClick = { filter = b }, label = { Text(b.titel) })
                }
                z.agenten.filter { it.nimmtAuftraege }.forEach { ag ->
                    FilterChip(
                        selected = nurAgent == ag.id,
                        onClick = { nurAgent = if (nurAgent == ag.id) null else ag.id },
                        label = { Text(ag.name) },
                    )
                }
            }
            if (gefiltert.isEmpty()) {
                LeerHinweis(
                    Icons.Outlined.Inbox,
                    if (filter == BoardFilter.OFFEN) "Nichts offen" else "Keine Aufträge",
                    if (z.raeume.board == null || z.raeume.board !in z.beigetreten) {
                        "Das Board steht in #schwarm-auftraege. Tritt dem Raum bei (Räume → Allen beitreten)."
                    } else {
                        "Neue Aufträge gibst du mit „Auftrag“ in Aktuell oder direkt im Raum eines Agenten."
                    },
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(kette(gefiltert), key = { it.first.id }) { (t, tiefe) ->
                        WischZeile(t, z, a, Modifier.padding(start = (20 * tiefe.coerceAtMost(3)).dp)) { a.auftragOeffnen(t.id) }
                    }
                    item { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
                }
            }
        }
    }
}

/**
 * Die Kette als Baum (App 2.9, Verbesserung 9): Unteraufträge stehen eingerückt unter ihrem Eltern-Auftrag.
 * Wurzeln sind Aufträge, deren Eltern nicht in der Liste stehen; die Reihenfolge der Wurzeln bleibt.
 */
internal fun kette(liste: List<Auftrag>): List<Pair<Auftrag, Int>> {
    val ids = liste.map { it.id }.toSet()
    val kinder = liste.filter { it.eltern != null && it.eltern in ids }.groupBy { it.eltern!! }
    val raus = ArrayList<Pair<Auftrag, Int>>(liste.size)
    val gesehen = HashSet<String>()
    fun ablegen(t: Auftrag, tiefe: Int) {
        if (!gesehen.add(t.id)) return
        raus += t to tiefe
        kinder[t.id].orEmpty().sortedBy { it.nummer }.forEach { ablegen(it, tiefe + 1) }
    }
    liste.filter { it.eltern == null || it.eltern !in ids }.forEach { ablegen(it, 0) }
    // Ein Kreis (sollte es nie geben) darf keinen Auftrag verschlucken.
    liste.forEach { if (it.id !in gesehen) ablegen(it, 0) }
    return raus
}

/**
 * Wischen im Board (App 2.9): nach links bricht einen offenen Auftrag ab (mit Rückfrage), nach rechts gibt einem
 * erledigten 👍. Ohne geladene Karte geht keins von beiden; dann öffnet Tippen den Auftrag wie bisher.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WischZeile(t: Auftrag, z: SchwarmZustand, a: Aktionen, modifier: Modifier, onClick: () -> Unit) {
    val karte = z.karte(t)
    val entscheidet = a.rolle.entscheidet
    var abbrechenFrage by remember { mutableStateOf(false) }
    val stand = rememberSwipeToDismissBoxState(confirmValueChange = { wert ->
        when (wert) {
            SwipeToDismissBoxValue.EndToStart -> if (t.zustand.offen && karte != null && entscheidet) abbrechenFrage = true
            SwipeToDismissBoxValue.StartToEnd -> if (!t.zustand.offen && karte != null && entscheidet) a.vm.bewerten(t, karte, "👍")
            else -> {}
        }
        false // zurückschnappen: die Zeile bleibt, bis der Hub den neuen Stand meldet
    })
    SwipeToDismissBox(
        stand,
        modifier = modifier,
        enableDismissFromStartToEnd = !t.zustand.offen && karte != null && entscheidet,
        enableDismissFromEndToStart = t.zustand.offen && karte != null && entscheidet,
        backgroundContent = {
            val links = stand.dismissDirection == SwipeToDismissBoxValue.StartToEnd
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(16.dp))
                    .background(if (links) StatusGut.copy(alpha = 0.25f) else StatusKritisch.copy(alpha = 0.25f))
                    .padding(horizontal = 20.dp),
                contentAlignment = if (links) Alignment.CenterStart else Alignment.CenterEnd,
            ) { Text(if (links) "👍 Gut gemacht" else "🛑 Abbrechen", style = MaterialTheme.typography.titleSmall) }
        },
    ) {
        Column {
            AuftragZeile(t, z, onClick)
        }
    }
    if (abbrechenFrage && karte != null) {
        AlertDialog(
            onDismissRequest = { abbrechenFrage = false },
            title = { Text("${t.id} abbrechen?") },
            text = { Text("Der Hub setzt den Auftrag auf „abgebrochen“ und schickt dem Bot /stop.") },
            confirmButton = {
                Button(onClick = {
                    abbrechenFrage = false
                    t.raumId?.let { a.vm.reagieren(it, karte.eventId, "🛑", "🛑 gesendet – der Hub bricht ${t.id} ab.") }
                }) { Text("Abbrechen") }
            },
            dismissButton = { TextButton(onClick = { abbrechenFrage = false }) { Text("Weiterlaufen lassen") } },
        )
    }
}

// ── Lobby ───────────────────────────────────────────────────────────────────

@Composable
fun LobbyAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: (() -> Unit)? = null, schliessbar: Boolean = false) {
    val lobby = z.raeume.lobby
    // Der Trenner „Neu“ bleibt, wo er beim Öffnen war.
    val neuAb = remember(lobby) { lobby?.let { z.ungelesen[it] }?.takeIf { it.anzahl > 0 }?.gelesenBis }
    Scaffold(
        topBar = {
            SchwarmLeiste("Lobby", "Befehle an den Hub, Quittungen, Rückfragen", zurueck = zurueck, onTitel = a.schnellwahl) {
                IconButton(onClick = a.palette) { Icon(Icons.Outlined.Terminal, "Befehlspalette") }
                if (schliessbar) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            if (lobby == null || lobby !in z.beigetreten) {
                Box(Modifier.weight(1f)) {
                    LeerHinweis(
                        Icons.Outlined.Forum,
                        "Nicht in der Lobby",
                        "Tritt #schwarm-lobby bei (Räume → Allen beitreten). Befehle nimmt der Hub nur dort an.",
                    )
                }
            } else {
                NachrichtenListe(
                    z.verlauf(lobby),
                    Modifier.weight(1f),
                    onAeltere = { a.vm.aeltereLaden(lobby) },
                    onAuftrag = a.auftragOeffnen,
                    zusatz = { n -> NachrichtZusatz(n, z, a) },
                    neuAb = neuAb,
                    onUnten = { a.vm.gelesen(lobby) },
                    a = a,
                )
            }
            // Vorschläge nach Rolle: ein Gast sieht nur seine Befehle und Agenten (Gastrolle).
            val auftraege = listOf("brian", "claude-code", "codex-host", "hermes-phone", "plum", "betrieb")
                .filter { a.rolle.darfAuftragAn(it) }.map { "!auftrag @$it " }
            val vorschlaege = (listOf("!stand", "!board", "!agenten", "!budget") + auftraege + listOf("!hilfe"))
                .filter { a.rolle.darf(it.removePrefix("!").substringBefore(' ')) }
            Eingabe(
                hinweis = "Befehl, z. B. !stand oder !auftrag @brian …",
                onSenden = { a.vm.befehl(it) },
                vorschlaege = vorschlaege,
                aktiv = lobby != null && lobby in z.beigetreten,
                vorbelegt = a.entwurf.text,
                vorbelegtNr = a.entwurf.nr,
            )
        }
    }
}
