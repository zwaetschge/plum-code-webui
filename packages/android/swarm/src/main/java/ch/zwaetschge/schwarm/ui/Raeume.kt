@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.AlarmStufe
import com.claudewebui.swarm.data.ChatArt
import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.SchwarmZustand

/*
 * Räume (App 2.4): Die Lobby oben, dann die Agenten nach Namen, dann die System-Räume. Die Reihenfolge
 * bleibt fest, damit jeder Raum immer am selben Platz steht; was neu ist, zeigen fette Schrift und Zahl.
 * Allgemein steht hier nicht mehr, es hat den eigenen Bereich „Chat“. Der Schnellwechsler (Tipp auf den
 * Titel eines Raums) zeigt dieselbe Liste und dazu Allgemein.
 */

enum class RaumArt { ALLGEMEIN, LOBBY, AGENT, SYSTEM }

/** Eine Zeile der Räume. */
data class RaumEintrag(
    val raumId: String,
    val titel: String,
    val art: RaumArt,
    val icon: ImageVector,
    val ungelesen: Int,
    /** „Absender: erste Zeile“ der letzten Nachricht. */
    val zeile: String?,
    val zeit: Long,
    val agentId: String? = null,
    /** Freigaben, Alarme oder Log: der Teil der Meldungen. */
    val kanal: Kanal? = null,
    val board: Boolean = false,
    /** Rot statt blau: eine Freigabe wartet oder ein kritischer Alarm ist offen. */
    val laut: Boolean = false,
    val beigetreten: Boolean = true,
    val angeheftet: Boolean = false,
    /** Der Stand des Agenten, als Punkt am Kreis. */
    val status: AgentStatus? = null,
)

/** Die erste Zeile eines Texts, ohne Markdown-Zeichen am Anfang, höchstens 140 Zeichen. */
fun ersteZeile(text: String): String {
    val z = text.lineSequence().map { it.trim().trimStart('#', '>', ' ') }.firstOrNull { it.isNotEmpty() } ?: ""
    return if (z.length <= 140) z else z.take(139) + "…"
}

private fun zeileAus(n: Nachricht?): String? = n?.let {
    val wer = if (it.vonMir) "Du" else it.absenderName
    val was = if (it.datei != null) com.claudewebui.swarm.data.AllgemeinLeser.anhangKurz(it.datei) else ersteZeile(it.text)
    "$wer: $was"
}

/** Ungelesenes, das in Abzeichen zählt: Lobby und Arbeitsräume (für „Räume“). */
fun raeumeUngelesen(z: SchwarmZustand): Int =
    (listOfNotNull(z.raeume.lobby) + z.raeume.agenten.values).distinct().sumOf { z.ungelesen[it]?.anzahl ?: 0 }

/** Alle Räume in fester Reihenfolge: Allgemein, Lobby, die Agenten nach Namen, dann Alarme, Freigaben, Board, Log. */
fun raumEintraege(z: SchwarmZustand): List<RaumEintrag> {
    val r = z.raeume
    val jetzt = System.currentTimeMillis()
    fun letzte(raum: String) = z.verlauf(raum).nachrichten.maxByOrNull { it.zeit }
    fun u(raum: String) = z.ungelesen[raum]?.anzahl ?: 0
    val oben = ArrayList<RaumEintrag>()
    val agenten = ArrayList<RaumEintrag>()
    val system = ArrayList<RaumEintrag>()
    val allgemein = r.allgemein
    if (allgemein != null && z.rolle.istVale) {
        val chat = z.allgemein.chats.firstOrNull()
        val n = chat?.nachrichten?.lastOrNull { it.art != ChatArt.STATUS }?.n
        oben += RaumEintrag(
            allgemein, "Allgemein", RaumArt.ALLGEMEIN, Icons.Outlined.QuestionAnswer, z.allgemein.ungelesen,
            n?.let { (if (it.vonMir) "Du" else "Brian") + ": " + chatZeile(it) } ?: allgemeinUntertitel(z.allgemein),
            chat?.zuletzt ?: 0, angeheftet = true,
        )
    }
    r.lobby?.let { l ->
        val n = letzte(l)
        oben += RaumEintrag(l, "Lobby", RaumArt.LOBBY, Icons.Outlined.Forum, u(l), zeileAus(n), n?.zeit ?: 0,
            beigetreten = l in z.beigetreten, angeheftet = true)
    }
    // Melder (trader, autoupdater, unraid, release, sicherheit) schreiben in #schwarm-alarme: Ihr Raum ist ein
    // System-Raum und steht schon unten. Teilen sich mehrere Agenten einen Arbeitsraum, gibt es eine Zeile für alle.
    // Doppelte Raum-IDs liessen die LazyColumn abstürzen („Key … was already used“, App 2.3.0 mit echten Daten).
    val systemRaeume = setOfNotNull(allgemein, r.lobby, r.board, r.freigaben, r.alarme, r.log)
    r.agenten.entries.filter { it.value !in systemRaeume }.groupBy({ it.value }, { it.key }).forEach { (raum, ids) ->
        val n = letzte(raum)
        val titel = ids.joinToString(" · ") { id -> z.agent(id)?.name ?: "ag-$id" }
        agenten += RaumEintrag(raum, titel, RaumArt.AGENT, Icons.Outlined.SmartToy, u(raum), zeileAus(n),
            n?.zeit ?: 0, agentId = ids.first(), beigetreten = raum in z.beigetreten,
            status = z.agent(ids.first())?.status)
    }
    r.alarme?.let { a ->
        val n = letzte(a)
        system += RaumEintrag(a, "Alarme", RaumArt.SYSTEM, Icons.Outlined.NotificationsActive, u(a), zeileAus(n), n?.zeit ?: 0,
            kanal = Kanal.ALARME,
            laut = z.alarme.any { it.stufe == AlarmStufe.CRIT && it.offenUm(jetzt) && !it.stummUm(jetzt) },
            beigetreten = a in z.beigetreten)
    }
    if (z.rolle.entscheidet) {
        r.freigaben?.let { f ->
            val n = letzte(f)
            system += RaumEintrag(f, "Freigaben", RaumArt.SYSTEM, Icons.Outlined.VerifiedUser, u(f), zeileAus(n), n?.zeit ?: 0,
                kanal = Kanal.FREIGABEN, laut = z.freigaben.any { it.brauchtDichUm(jetzt) }, beigetreten = f in z.beigetreten)
        }
    }
    r.board?.let { b ->
        val n = letzte(b)
        system += RaumEintrag(b, "Board", RaumArt.SYSTEM, Icons.Outlined.ViewKanban, u(b), zeileAus(n), n?.zeit ?: 0,
            board = true, beigetreten = b in z.beigetreten)
    }
    r.log?.let { l ->
        val n = letzte(l)
        system += RaumEintrag(l, "Log", RaumArt.SYSTEM, Icons.AutoMirrored.Outlined.Article, u(l), zeileAus(n), n?.zeit ?: 0,
            kanal = Kanal.LOG, beigetreten = l in z.beigetreten)
    }
    return (oben + agenten.sortedBy { it.titel.lowercase() } + system).distinctBy { it.raumId }
}

@Composable
fun RaeumeAnsicht(z: SchwarmZustand, a: Aktionen) {
    val alle = raumEintraege(z).filter { it.art != RaumArt.ALLGEMEIN }
    val oben = alle.filter { it.art == RaumArt.LOBBY }
    val agenten = alle.filter { it.art == RaumArt.AGENT }
    val system = alle.filter { it.art == RaumArt.SYSTEM }
    // Breit steht rechts ohne Auswahl die Lobby: Dann ist sie markiert.
    val offen = offenerRaum(a.offen, z) ?: if (a.breit && a.offen == null) z.raeume.lobby else null
    val gesamt = alle.filter { it.art != RaumArt.SYSTEM || it.kanal == Kanal.ALARME }.sumOf { it.ungelesen }
    Scaffold(
        topBar = {
            SchwarmLeiste("Räume", if (gesamt > 0) "$gesamt ungelesen" else "alles gelesen") {
                if (gesamt > 0) {
                    IconButton(onClick = { a.vm.allesGelesen() }) { Icon(Icons.Outlined.DoneAll, "Alles als gelesen markieren") }
                }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = pad.calculateTopPadding() + 4.dp, bottom = 24.dp),
        ) {
            if (z.einladungen.isNotEmpty()) {
                item(key = "einladungen") {
                    Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                        EinladungsKarte(z.einladungen) { a.vm.einladungenAnnehmen() }
                    }
                }
            }
            items(oben, key = { it.raumId }) { e -> RaumZeile(e, ausgewaehlt = e.raumId == offen) { a.raumWaehlen(e) } }
            if (agenten.isNotEmpty()) {
                item(key = "agenten") { Abschnitt("Agenten", Modifier.padding(horizontal = 16.dp)) }
                items(agenten, key = { it.raumId }) { e -> RaumZeile(e, ausgewaehlt = e.raumId == offen) { a.raumWaehlen(e) } }
            }
            if (system.isNotEmpty()) {
                item(key = "system") { Abschnitt("Hub", Modifier.padding(horizontal = 16.dp)) }
                items(system, key = { it.raumId }) { e -> RaumZeile(e, ausgewaehlt = e.raumId == offen) { a.raumWaehlen(e) } }
            }
            if (alle.isEmpty()) {
                item(key = "leer") {
                    Text(
                        "Noch keine Schwarm-Räume. Nimm die Einladungen an, dann erscheinen sie hier.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
}

/** Welcher Raum rechts (breit) oder gerade offen ist, für die Markierung in der Liste. */
fun offenerRaum(d: Detail?, z: SchwarmZustand): String? = when (d) {
    is Detail.RaumD -> d.raumId
    Detail.LobbyD -> z.raeume.lobby
    is Detail.ChatD -> z.raeume.allgemein
    is Detail.KanalD -> when (d.kanal) {
        Kanal.FREIGABEN -> z.raeume.freigaben
        Kanal.ALARME -> z.raeume.alarme
        Kanal.LOG -> z.raeume.log
    }
    Detail.BoardD -> z.raeume.board
    else -> null
}

@Composable
fun RaumZeile(e: RaumEintrag, ausgewaehlt: Boolean, kompakt: Boolean = false, onClick: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val neu = e.ungelesen > 0
    Surface(
        onClick = onClick,
        color = if (ausgewaehlt) f.secondaryContainer else Color.Transparent,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = if (kompakt) 8.dp else 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val groesse = if (kompakt) 34.dp else 40.dp
            if (e.art == RaumArt.AGENT && e.agentId != null) {
                AgentAvatar(e.agentId, e.titel, e.status, groesse)
            } else {
                val (grund, farbe) = when {
                    e.laut -> f.errorContainer to f.onErrorContainer
                    e.art == RaumArt.ALLGEMEIN -> f.primaryContainer to f.onPrimaryContainer
                    e.art == RaumArt.LOBBY -> f.secondaryContainer to f.onSecondaryContainer
                    else -> f.surfaceContainerHighest to f.onSurfaceVariant
                }
                SymbolKreis(e.icon, grund, farbe, groesse)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        e.titel,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = if (neu) FontWeight.Bold else FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.weight(1f))
                    if (e.zeit > 0) {
                        Text(
                            listenZeit(e.zeit),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (neu) f.primary else f.onSurfaceVariant,
                        )
                    }
                }
                if (!kompakt || e.zeile != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (!e.beigetreten) "nicht beigetreten" else e.zeile ?: "noch nichts",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (neu) f.onSurface else f.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (neu || e.laut) {
                            Spacer(Modifier.width(8.dp))
                            Badge(
                                containerColor = if (e.laut) f.error else f.primary,
                                contentColor = if (e.laut) f.onError else f.onPrimary,
                            ) { Text(if (neu) (if (e.ungelesen > 99) "99+" else e.ungelesen.toString()) else "!") }
                        }
                    }
                }
            }
        }
    }
}

/** Tippen auf den Titel eines Raums: dieselbe Liste als Blatt, zum schnellen Wechseln. */
@Composable
fun RaumSchnellwahl(z: SchwarmZustand, offen: String?, onWahl: (RaumEintrag) -> Unit, onSchliessen: () -> Unit) {
    val eintraege = raumEintraege(z)
    ModalBottomSheet(
        onDismissRequest = onSchliessen,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Raum wechseln", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            val gesamt = eintraege.sumOf { it.ungelesen }
            if (gesamt > 0) Text("$gesamt ungelesen", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        HorizontalDivider(Modifier.padding(top = 6.dp))
        LazyColumn(contentPadding = PaddingValues(vertical = 6.dp)) {
            items(eintraege, key = { it.raumId }) { e ->
                RaumZeile(e, ausgewaehlt = e.raumId == offen, kompakt = true) { onWahl(e) }
            }
            item { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
}

// ── Neu in den Räumen ───────────────────────────────────────────────────────

/** Ein Eintrag in „Neu in den Räumen“: eine ungelesene Nachricht oder ein Chat mit neuer Antwort. */
data class AktuellEintrag(
    val raumId: String,
    val raumTitel: String,
    val icon: ImageVector,
    val n: Nachricht,
    /** In Allgemein: die Wurzel des Chats und sein Titel. */
    val chatWurzel: String? = null,
    val chatTitel: String? = null,
    /** In einem Arbeitsraum: der Agent, für den Kreis mit Kürzel. */
    val agentId: String? = null,
)

/**
 * Die neuesten ungelesenen Nachrichten über alle Räume, höchstens `max`. Board, Log und Freigaben
 * fehlen: Die Aufträge und Freigaben stehen in „Aktuell“ schon mit Knöpfen. `ausser` blendet aus, was
 * dort unter „Braucht dich“ steht.
 */
fun aktuell(z: SchwarmZustand, max: Int = 8, ausser: (Nachricht) -> Boolean = { false }): List<AktuellEintrag> {
    val r = z.raeume
    val aus = ArrayList<AktuellEintrag>()
    if (r.allgemein != null && z.rolle.istVale) {
        z.allgemein.chats.filter { it.ungelesen > 0 }.forEach { c ->
            val n = c.nachrichten.lastOrNull { it.art == ChatArt.ANTWORT }?.n ?: return@forEach
            aus += AktuellEintrag(c.raumId, "Chat", Icons.Outlined.QuestionAnswer, n, c.wurzel, z.allgemein.titel(c))
        }
    }
    data class Quelle(val raum: String, val titel: String, val icon: ImageVector, val agent: String?)
    val raeume = buildList {
        r.lobby?.let { add(Quelle(it, "Lobby", Icons.Outlined.Forum, null)) }
        // Alarme vor den Agenten: Die Melder teilen sich diesen Raum, er soll „Alarme“ heissen.
        r.alarme?.let { add(Quelle(it, "Alarme", Icons.Outlined.NotificationsActive, null)) }
        r.agenten.forEach { (id, raum) -> add(Quelle(raum, z.agent(id)?.name ?: "ag-$id", Icons.Outlined.SmartToy, id)) }
    }
    raeume.distinctBy { it.raum }.forEach { q ->
        z.ungelesen[q.raum]?.neueste.orEmpty().filterNot(ausser).forEach { n ->
            aus += AktuellEintrag(q.raum, q.titel, q.icon, n, agentId = q.agent)
        }
    }
    return aus.sortedByDescending { it.n.zeit }.take(max)
}

/**
 * „Neu in den Räumen“ in Aktuell: Zähler je Raum als Sprungmarken, darunter die neuesten Einträge und
 * „Alles gelesen“. Ist nichts neu, bleibt der Block weg.
 */
@Composable
fun AktuellBlock(z: SchwarmZustand, a: Aktionen, ausser: (Nachricht) -> Boolean = { false }) {
    val f = MaterialTheme.colorScheme
    val eintraege = aktuell(z, ausser = ausser)
    val zaehler = raumEintraege(z).filter {
        it.ungelesen > 0 && it.art != RaumArt.ALLGEMEIN && (it.art != RaumArt.SYSTEM || it.kanal == Kanal.ALARME)
    }
    if (eintraege.isEmpty() && zaehler.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Abschnitt("Neu in den Räumen") {
            TextButton(onClick = { a.vm.allesGelesen() }) {
                Icon(Icons.Outlined.DoneAll, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Alles gelesen")
            }
        }
        if (zaehler.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                zaehler.forEach { e ->
                    Surface(
                        onClick = { a.raumWaehlen(e) },
                        shape = RoundedCornerShape(50),
                        color = if (e.laut) f.errorContainer else f.secondaryContainer,
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(e.icon, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("${e.titel} ${e.ungelesen}", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
        }
        if (eintraege.isEmpty()) return@Column
        var alle by rememberSaveable { mutableStateOf(false) }
        val sichtbar = if (alle) eintraege else eintraege.take(3)
        Surface(color = f.surfaceContainerLow, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(vertical = 4.dp)) {
                sichtbar.forEachIndexed { i, e ->
                    if (i > 0) HorizontalDivider(Modifier.padding(start = 52.dp), color = f.outlineVariant.copy(alpha = 0.5f))
                    AktuellZeile(e) { a.aktuellOeffnen(e) }
                }
                if (eintraege.size > 3) {
                    TextButton(onClick = { alle = !alle }, modifier = Modifier.padding(start = 40.dp)) {
                        Text(if (alle) "Weniger zeigen" else "${eintraege.size - sichtbar.size} weitere")
                    }
                }
            }
        }
    }
}

@Composable
private fun AktuellZeile(e: AktuellEintrag, onClick: () -> Unit) {
    val f = MaterialTheme.colorScheme
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.Top) {
            if (e.agentId != null) {
                AgentAvatar(e.agentId, e.raumTitel, groesse = 28.dp)
            } else {
                Box(Modifier.size(28.dp).clip(CircleShape).background(f.secondaryContainer), contentAlignment = Alignment.Center) {
                    Icon(e.icon, null, Modifier.size(16.dp), tint = f.onSecondaryContainer)
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        when {
                            e.chatTitel != null -> "${e.raumTitel} · ${e.chatTitel}"
                            e.n.absenderName == e.raumTitel -> e.raumTitel
                            else -> "${e.raumTitel} · ${e.n.absenderName}"
                        },
                        style = MaterialTheme.typography.labelLarge,
                        color = f.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(listenZeit(e.n.zeit), style = MaterialTheme.typography.labelSmall, color = f.onSurfaceVariant)
                }
                Spacer(Modifier.height(1.dp))
                Text(
                    if (e.chatTitel != null) "Brian: " + chatZeile(e.n)
                    else if (e.n.datei != null) com.claudewebui.swarm.data.AllgemeinLeser.anhangKurz(e.n.datei)
                    else ersteZeile(e.n.text),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
