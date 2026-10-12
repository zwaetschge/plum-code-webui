@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RemoveCircleOutline
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Agent
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.ModellBefehl
import com.claudewebui.swarm.data.ModellStand
import com.claudewebui.swarm.data.SCHWARM_MODELLE
import com.claudewebui.swarm.data.SCHWARM_STIMMEN
import com.claudewebui.swarm.data.SchwarmZustand

/*
 * Modelle und Stimmen je Agent (SCHNITTSTELLEN-app.md, App 2.2 und 2.3): Modell, Ersatzkette und Aufwand
 * aus `ch.zwaetschge.swarm.modelle`; gesetzt wird mit `!modell` in der Lobby. Der Hub prüft gegen seinen
 * Katalog und antwortet im Thread. Seit App 2.4 stehen sie auf der Seite jedes Agenten im Bereich „Schwarm“.
 */

/** Ist der Agent gerade pausiert (Agent Card oder Kennzahlen mit „Pause bis“)? */
fun pausiert(z: SchwarmZustand, id: String): Boolean {
    if (z.agent(id)?.status == AgentStatus.PAUSIERT) return true
    val jetzt = System.currentTimeMillis()
    return z.hub.kennzahlen.values.any { k -> k.agenten.any { it.agent == id && (it.pauseBis ?: 0) > jetzt } }
}

/** Die Stimme eines Agenten oder des Hubs als Anzeigename, mit „· Standard“, wenn sie es ist. */
internal fun stimmeText(z: SchwarmZustand, id: String?, standard: String?): String {
    val name = id?.let { z.hub.stimmen?.name(it) ?: it } ?: return "Standard"
    return if (id == standard) "$name · Standard" else name
}

private fun hubMxid(z: SchwarmZustand) = "@schwarm:" + z.ich.substringAfter(':')

/** Oben in der Liste: der Hub mit der Stimme seiner Notices (App 2.3). */
@Composable
internal fun HubStimmeKarte(z: SchwarmZustand, a: Aktionen, onStimme: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val st = z.hub.stimmen
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Campaign, null, tint = f.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Hub (Notices)", style = MaterialTheme.typography.titleMedium)
                    Text("@schwarm · Quittungen, Freigaben, Alarme", style = MaterialTheme.typography.labelMedium, color = f.onSurfaceVariant)
                }
                if (a.rolle.istVale && st != null) FilledTonalButton(onClick = onStimme) { Text("Stimme wählen") }
            }
            if (st == null) {
                Text("Noch keine Stimmenliste vom Hub.", style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
            } else {
                ModellZeile("Stimme", stimmeText(z, st.hub, st.hubStandard))
                Text(
                    "Alle anderen, auch deine eigenen Nachrichten: ${stimmeText(z, st.standard, null)} · ${st.stimmen.size} Stimmen in Vocarium",
                    style = MaterialTheme.typography.bodySmall,
                    color = f.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * Stimme wählen (App 2.3): Suche, „Deutsch (schnell)“ (kikiri), „Charakterstimmen“ (omnivoice) und
 * „Weitere“. Die aktuelle ist markiert, die Standardstimme gekennzeichnet; „Probe hören“ liest einen Satz
 * mit genau dieser Stimme vor. Übernehmen schickt `!stimme @<agent> <id>`, die Antwort des Hubs steht darunter.
 */
@Composable
fun StimmenBlatt(ziel: String, z: SchwarmZustand, a: Aktionen, onSchliessen: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val liste = z.hub.stimmen
    val istHub = ziel == "hub"
    val stand = if (istHub) null else z.hub.modelle[ziel]
    val aktuell = if (istHub) liste?.hub else stand?.let { it.stimme ?: it.stimmeStandard }
    val standard = if (istHub) liste?.hubStandard else stand?.stimmeStandard
    val name = if (istHub) "Hub" else z.agent(ziel)?.name ?: ziel
    val sprecher = if (istHub) hubMxid(z) else z.agent(ziel)?.mxid
    var suche by remember(ziel) { mutableStateOf("") }
    var wahl by remember(ziel) { mutableStateOf(aktuell) }
    var gesendet by remember(ziel) { mutableStateOf<String?>(null) }
    var gesendetBefehl by remember(ziel) { mutableStateOf<String?>(null) }
    val gefiltert = liste?.stimmen.orEmpty().filter { suche.isBlank() || it.name.contains(suche, true) || it.id.contains(suche, true) }
    val gruppen = listOf(
        "Deutsch (schnell)" to gefiltert.filter { it.engine == "kikiri" },
        "Charakterstimmen" to gefiltert.filter { it.engine == "omnivoice" },
        "Weitere" to gefiltert.filter { it.engine != "kikiri" && it.engine != "omnivoice" },
    ).filter { it.second.isNotEmpty() }
    fun senden(text: String) {
        gesendetBefehl = text
        a.vm.befehlMitAntwort(text) { id -> gesendet = id }
    }
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).padding(horizontal = 20.dp)) {
            Text("Stimme für $name", style = MaterialTheme.typography.titleLarge)
            Text(
                "Aktuell: ${stimmeText(z, aktuell, standard)}" + if (istHub) " · für die Notices des Hubs" else "",
                style = MaterialTheme.typography.bodyMedium,
                color = f.onSurfaceVariant,
            )
            TextField(
                value = suche,
                onValueChange = { suche = it },
                placeholder = { Text("Stimme suchen") },
                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                trailingIcon = { if (suche.isNotEmpty()) IconButton(onClick = { suche = "" }) { Icon(Icons.Outlined.Close, "Suche leeren") } },
                singleLine = true,
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                ),
                modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
            )
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                gruppen.forEach { (titel, stimmen) ->
                    item(key = "k-$titel") {
                        Abschnitt(
                            when (titel) {
                                "Deutsch (schnell)" -> "Deutsch (schnell) · ${stimmen.size}"
                                "Charakterstimmen" -> "Charakterstimmen · ${stimmen.size}"
                                else -> "Weitere · ${stimmen.size}"
                            },
                        )
                    }
                    items(stimmen, key = { "s-" + it.id }) { s ->
                        StimmeEintrag(
                            s,
                            gewaehlt = wahl == s.id,
                            aktuell = s.id == aktuell,
                            standard = s.id == standard,
                            onWahl = { wahl = s.id },
                            onProbe = { a.vm.stimmeProbe(name, sprecher, s.id) },
                        )
                    }
                }
                if (gruppen.isEmpty()) {
                    item(key = "leer") {
                        Text(
                            if (liste == null) "Noch keine Stimmenliste vom Hub." else "Keine Stimme passt zu „$suche“.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = f.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    }
                }
            }
            // Die Probe läuft über den Mini-Spieler; im Blatt steht er gleich hier.
            VorleseLeiste(a.vm, unten = false)
            gesendet?.let { id -> ThreadAntwort(id, z) }
            HorizontalDivider(Modifier.padding(top = 4.dp))
            Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(
                    onClick = { senden(ModellBefehl.stimme(ziel, null)) },
                    enabled = standard != null && aktuell != standard,
                ) {
                    Icon(Icons.Outlined.RestartAlt, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Auf Standard zurück")
                }
                Spacer(Modifier.weight(1f))
                if (hubBestaetigt(gesendet, z) && (wahl == null || gesendetBefehl == ModellBefehl.stimme(ziel, wahl))) {
                    Button(onClick = onSchliessen) { Text("Fertig") }
                } else {
                    Button(
                        onClick = { wahl?.let { senden(ModellBefehl.stimme(ziel, it)) } },
                        enabled = wahl != null && wahl != aktuell,
                    ) { Text("Übernehmen") }
                }
            }
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

@Composable
private fun StimmeEintrag(
    s: com.claudewebui.swarm.data.Stimme,
    gewaehlt: Boolean,
    aktuell: Boolean,
    standard: Boolean,
    onWahl: () -> Unit,
    onProbe: () -> Unit,
) {
    val f = MaterialTheme.colorScheme
    Surface(
        onClick = onWahl,
        color = if (gewaehlt) f.secondaryContainer else Color.Transparent,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = gewaehlt, onClick = onWahl)
            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(s.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (aktuell) {
                        Spacer(Modifier.width(8.dp))
                        Marke("aktuell", f.primary, f.onPrimary)
                    }
                    if (standard) {
                        Spacer(Modifier.width(6.dp))
                        Marke("Standard", f.surfaceContainerHighest, f.onSurfaceVariant)
                    }
                }
                if (s.name != s.id) {
                    Text(s.id, style = MaterialTheme.typography.labelSmall, color = f.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            IconButton(onClick = onProbe) { Icon(Icons.Outlined.PlayCircle, "Probe hören", tint = f.primary) }
        }
    }
}

@Composable
private fun Marke(text: String, grund: Color, farbe: Color) {
    Surface(color = grund, contentColor = farbe, shape = RoundedCornerShape(50)) {
        Text(text, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

/** Die Antwort des Hubs im Thread eines Befehls, oder dass sie noch aussteht. */
@Composable
private fun ThreadAntwort(befehl: String, z: SchwarmZustand) {
    Box(Modifier.padding(top = 6.dp)) { HubAntwortZeile(befehl, "stimme", z) }
}

/**
 * Modell, Ersatz, Aufwand und Stimme eines Agenten. Mit `knoepfe` darunter Stimme, Profil, Pause und
 * Raum; auf der Seite des Agenten (App 2.4) stehen diese Knöpfe schon oben.
 */
@Composable
internal fun AgentModellKarte(
    id: String,
    agent: Agent?,
    stand: ModellStand?,
    z: SchwarmZustand,
    a: Aktionen,
    onStimme: () -> Unit,
    knoepfe: Boolean = true,
    onBearbeiten: () -> Unit,
) {
    val f = MaterialTheme.colorScheme
    val grau = stand?.ohneModell == true
    val pause = pausiert(z, id)
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (knoepfe) {
                    StatusPunkt(if (pause) AgentStatus.PAUSIERT else agent?.status ?: AgentStatus.OFFLINE)
                    Spacer(Modifier.width(10.dp))
                }
                Column(Modifier.weight(1f)) {
                    // Auf der Seite des Agenten stehen Name und Stand schon oben: hier nur, wer das Modell stellt.
                    Text(
                        if (knoepfe) agent?.name ?: id else stand?.art?.takeIf { it != "keins" }?.let { artText(it) } ?: "Modell",
                        style = MaterialTheme.typography.titleMedium,
                        color = if (grau) f.onSurfaceVariant else f.onSurface,
                    )
                    if (knoepfe) {
                        Text(
                            listOfNotNull(
                                if (pause) "pausiert" else agent?.status?.titel ?: "keine Agent Card",
                                stand?.art?.takeIf { it != "keins" }?.let { artText(it) },
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.labelMedium,
                            color = f.onSurfaceVariant,
                        )
                    }
                }
                if (stand?.einstellbar == true && a.rolle.istVale) {
                    FilledTonalButton(onClick = onBearbeiten) { Text("Bearbeiten") }
                }
            }
            when {
                stand == null -> Text("Noch kein Stand vom Hub.", style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
                stand.ohneModell -> {
                    Text("ohne Sprachmodell", style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
                    stand.hinweis?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant) }
                }
                stand.extern && stand.modell == null -> {
                    Text(stand.hinweis ?: "Gehört einer eigenen Sitzung; die App zeigt es nur an.", style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
                }
                else -> {
                    ModellZeile("Modell", stand.name(stand.modell) ?: "unbekannt")
                    ModellZeile("Ersatz", if (stand.fallback.isEmpty()) "keiner" else stand.fallback.joinToString(" → ") { stand.name(it) ?: it })
                    if (stand.aufwaende.isNotEmpty() || stand.aufwand != null) ModellZeile("Aufwand", stand.aufwand ?: "Standard")
                    if (stand.wirktText.isNotEmpty()) {
                        Text(stand.wirktText, style = MaterialTheme.typography.bodySmall, color = f.primary)
                    }
                    if (stand.extern) {
                        Text(stand.hinweis ?: "Gehört einer eigenen Sitzung; die App zeigt es nur an.", style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant)
                    }
                    if (stand.geaendertVon != null || stand.geaendertAm != null) {
                        Text(
                            "geändert" + (stand.geaendertVon?.let { " von ${if (it == z.ich) "dir" else it.removePrefix("@").substringBefore(':')}" } ?: "") +
                                (stand.geaendertAm?.let { " am ${zeitText(it)}" } ?: "") +
                                (stand.standard?.takeIf { !stand.aufStandard }?.let { s -> " · Standard: ${stand.name(s.modell) ?: "?"}" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = f.onSurfaceVariant,
                        )
                    }
                    stand.bestaetigung?.let { Text("Brian: $it", style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant) }
                }
            }
            // Die Stimme beim Vorlesen, auch für Agenten ohne Sprachmodell (App 2.3).
            if (stand != null && (stand.stimme != null || stand.stimmeStandard != null)) {
                ModellZeile("Stimme", stimmeText(z, stand.stimme ?: stand.stimmeStandard, stand.stimmeStandard))
            }
            if (a.rolle.istVale && (knoepfe || (stand != null && z.hub.stimmen != null))) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                    if (stand != null && z.hub.stimmen != null) {
                        OutlinedButton(onClick = onStimme) { Text("Stimme wählen") }
                    }
                    if (knoepfe) {
                        OutlinedButton(onClick = { a.befehlUndLobby("!profil @$id") }) { Text("Profil") }
                        if (stand?.ohneModell != true || agent != null) {
                            OutlinedButton(onClick = { a.befehlUndLobby(if (pause) "!weiter @$id" else "!pause @$id") }) {
                                Text(if (pause) "Weiter" else "Pause")
                            }
                        }
                        agent?.raumId?.let { r -> OutlinedButton(onClick = { a.raumOeffnen(r, "ag-$id", id) }) { Text("Raum") } }
                    }
                }
            }
        }
    }
}

internal fun artText(art: String): String = when (art) {
    "claude" -> "Claude Code"
    "codex" -> "Codex"
    "plum" -> "Plum-Sitzungen"
    "hermes" -> "Hermes"
    "extern" -> "extern"
    "keins" -> "ohne Sprachmodell"
    else -> art
}

@Composable
internal fun ModellZeile(titel: String, wert: String) {
    Row {
        Text(titel, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(76.dp))
        Text(wert, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Modell, Ersatzkette (bis 3, sortierbar, ohne das Hauptmodell) und Aufwand wählen; Speichern baut den
 * Befehl `!modell …`. Die Antwort des Hubs im Thread zeigt das Blatt an; bei Brian dazu seine Bestätigung.
 */
@Composable
fun ModellBearbeiten(stand: ModellStand, z: SchwarmZustand, a: Aktionen, onSchliessen: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val name = z.agent(stand.agent)?.name ?: stand.agent
    var modell by remember(stand.agent) { mutableStateOf(stand.modell ?: stand.standard?.modell ?: stand.modelle.firstOrNull()?.id) }
    var kette by remember(stand.agent) { mutableStateOf(stand.fallback.take(stand.fallbackMax)) }
    var aufwand by remember(stand.agent) { mutableStateOf(stand.aufwand) }
    var gesendet by remember(stand.agent) { mutableStateOf<String?>(null) }
    var gesendetBefehl by remember(stand.agent) { mutableStateOf<String?>(null) }
    var bestaetigungVorher by remember(stand.agent) { mutableStateOf(stand.bestaetigung) }
    var brianFrage by remember { mutableStateOf<String?>(null) }
    val brian = stand.art == "hermes" || stand.agent == "brian"
    val befehl = modell?.let { ModellBefehl.setzen(stand, it, kette.filter { k -> k != it }, aufwand) }
    fun senden(text: String) {
        bestaetigungVorher = stand.bestaetigung
        gesendetBefehl = text
        a.vm.befehlMitAntwort(text) { id -> gesendet = id }
    }
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Modell für $name", style = MaterialTheme.typography.titleLarge)
            if (stand.wirktText.isNotEmpty()) Text(stand.wirktText, style = MaterialTheme.typography.bodyMedium, color = f.primary)
            if (brian) {
                HinweisKarte(
                    Icons.Outlined.Bolt,
                    "Brian wechselt sofort; gilt global",
                    "Der Hub schickt `/model <id> --global` in #ag-brian. Global gehen nur Modelle von Z.AI. Für einen einzelnen Chat " +
                        "stellst du das Modell in Allgemein oben im Chat um.",
                    MaterialTheme.colorScheme.tertiary,
                )
            }
            Abschnitt("Modell")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                stand.modelle.forEach { m ->
                    FilterChip(
                        selected = modell == m.id,
                        onClick = {
                            modell = m.id
                            kette = kette.filter { it != m.id }
                        },
                        label = { Text(m.name) },
                    )
                }
            }
            Abschnitt("Ersatzkette")
            if (stand.fallbackAenderbar) {
                if (kette.isEmpty()) Text("keiner – scheitert das Modell, bleibt der Auftrag stehen", style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
                kette.forEachIndexed { i, id ->
                    Surface(color = f.surfaceContainerHigh, shape = RoundedCornerShape(12.dp)) {
                        Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${i + 1}.", style = MaterialTheme.typography.labelLarge, color = f.primary)
                            Spacer(Modifier.width(10.dp))
                            Text(stand.name(id) ?: id, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            IconButton(onClick = { kette = kette.toMutableList().apply { add(i - 1, removeAt(i)) } }, enabled = i > 0) {
                                Icon(Icons.Outlined.ArrowUpward, "nach oben")
                            }
                            IconButton(onClick = { kette = kette.toMutableList().apply { add(i + 1, removeAt(i)) } }, enabled = i < kette.size - 1) {
                                Icon(Icons.Outlined.ArrowDownward, "nach unten")
                            }
                            IconButton(onClick = { kette = kette.filter { it != id } }) { Icon(Icons.Outlined.RemoveCircleOutline, "entfernen") }
                        }
                    }
                }
                val frei = stand.modelle.filter { it.id != modell && it.id !in kette }
                if (kette.size < stand.fallbackMax && frei.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        frei.forEach { m ->
                            AssistChip(
                                onClick = { kette = kette + m.id },
                                label = { Text(m.name) },
                                leadingIcon = { Icon(Icons.Outlined.AddCircleOutline, null, Modifier.size(18.dp)) },
                            )
                        }
                    }
                }
                Text(
                    when (stand.fallbackMax) {
                        0 -> "Dieser Agent nimmt kein Ersatzmodell."
                        1 -> "Höchstens eines; das Hauptmodell ist nicht dabei."
                        else -> "Höchstens ${stand.fallbackMax}, der Reihe nach; das Hauptmodell ist nicht dabei."
                    } + (stand.hinweis?.let { " $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = f.onSurfaceVariant,
                )
            } else {
                Text(
                    if (stand.fallback.isEmpty()) "keiner" else stand.fallback.joinToString(" → ") { stand.name(it) ?: it },
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    stand.hinweis ?: "Die Ersatzkette lässt sich hier nicht ändern.",
                    style = MaterialTheme.typography.bodySmall,
                    color = f.onSurfaceVariant,
                )
            }
            if (stand.aufwaende.isNotEmpty()) {
                Abschnitt("Aufwand")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    FilterChip(selected = aufwand == null, onClick = { aufwand = null }, label = { Text("Standard") })
                    stand.aufwaende.forEach { s -> FilterChip(selected = aufwand == s, onClick = { aufwand = s }, label = { Text(s) }) }
                }
            }
            if (befehl != null) {
                Surface(color = f.surfaceContainerHighest, shape = RoundedCornerShape(10.dp)) {
                    Text(
                        befehl,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.fillMaxWidth().padding(10.dp),
                    )
                }
            }
            gesendet?.let { id -> HubAntwort(id, z, stand, bestaetigungVorher, brian) }
            HorizontalDivider()
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(
                    onClick = { senden(ModellBefehl.standard(stand.agent)) },
                    enabled = stand.standard != null && !stand.aufStandard,
                ) {
                    Icon(Icons.Outlined.RestartAlt, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Auf Standard zurück")
                }
                Spacer(Modifier.weight(1f))
                if (hubBestaetigt(gesendet, z) && gesendetBefehl == befehl) {
                    Button(onClick = onSchliessen) { Text("Fertig") }
                } else {
                    Button(
                        onClick = { befehl?.let { if (brian) brianFrage = it else senden(it) } },
                        enabled = befehl != null,
                    ) { Text("Speichern") }
                }
            }
        }
    }
    brianFrage?.let { text ->
        AlertDialog(
            onDismissRequest = { brianFrage = null },
            icon = { Icon(Icons.Outlined.Bolt, null) },
            title = { Text("Brian wechselt sofort") },
            text = { Text("Das gilt global, für alle Chats und Aufträge. Brian bestätigt den Wechsel; die Bestätigung erscheint hier.") },
            confirmButton = {
                Button(onClick = {
                    brianFrage = null
                    senden(text)
                }) { Text("Wechseln") }
            },
            dismissButton = { TextButton(onClick = { brianFrage = null }) { Text("Abbrechen") } },
        )
    }
}

/** Die Antwort des Hubs im Thread des Befehls: ✅ oder 🚫 mit Text; bei Brian dazu seine Bestätigung. */
@Composable
private fun HubAntwort(befehl: String, z: SchwarmZustand, stand: ModellStand, vorher: String?, brian: Boolean) {
    val f = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        HubAntwortZeile(befehl, "modell", z)
        if (brian) {
            val neu = stand.bestaetigung?.takeIf { it != vorher }
            Text(
                if (neu != null) "Brian: $neu" else "Brians Bestätigung steht noch aus.",
                style = MaterialTheme.typography.bodySmall,
                color = f.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }
}

/** Hat der Hub den gesendeten Befehl mit ✅ im Thread bestätigt? */
private fun hubBestaetigt(befehl: String?, z: SchwarmZustand): Boolean = befehl != null &&
    z.verlauf(z.raeume.lobby).nachrichten.any { it.threadWurzel == befehl && it.vomHub && it.text.trimStart().startsWith("✅") }

/**
 * Die Antwort des Hubs auf einen Befehl aus der App (`!modell`, `!stimme`). Sie steht im Thread des Befehls.
 * Kennt der laufende Hub den Befehl nicht, antwortet er mit einer losen Notice „Unbekannter Befehl …“; auch die
 * erkennt die App. Kommt nach [frist] ms gar nichts, sagt sie das, statt weiter zu drehen (Vale, 27.09.: „da
 * bleibts stuck“).
 */
@Composable
internal fun HubAntwortZeile(befehl: String, wort: String, z: SchwarmZustand, frist: Long = 45_000) {
    val f = MaterialTheme.colorScheme
    val lobby = z.raeume.lobby
    val verlauf = z.verlauf(lobby).nachrichten
    val start = remember(befehl) { System.currentTimeMillis() }
    // Server-Zeiten vergleichen: die des Befehls, sobald er im Verlauf steht.
    val ab = z.nachricht(lobby, befehl)?.zeit
    val antwort = verlauf.lastOrNull { it.threadWurzel == befehl && it.vomHub }
    val unbekannt = if (antwort != null) null else verlauf.firstOrNull {
        it.vomHub && it.threadWurzel == null && (ab == null || it.zeit >= ab) &&
            it.text.trimStart().startsWith("Unbekannter Befehl") && it.text.contains("!$wort")
    }
    val jetzt = if (antwort == null && unbekannt == null) rememberJetzt() else start
    val (text, farbe, wartet) = when {
        antwort != null -> Triple(antwort.text, if (antwort.text.trimStart().startsWith("✅")) f.onSurface else f.error, false)
        unbekannt != null -> Triple(
            "Der laufende Hub kennt „!$wort“ nicht, es wurde nichts geändert. Er läuft wohl mit einem älteren Stand.",
            f.error,
            false,
        )
        jetzt - start > frist -> Triple(
            "Keine Antwort vom Hub nach ${frist / 1000} s. Ob der Befehl ankam, zeigt die Lobby; Speichern schickt ihn noch einmal.",
            f.error,
            false,
        )
        else -> Triple("Gesendet, wartet auf den Hub …", f.onSurface, true)
    }
    Surface(color = f.surfaceContainerHigh, shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (wartet) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
            }
            Text(text, style = MaterialTheme.typography.bodyMedium, color = farbe)
        }
    }
}

/** Oben im Chat: das Modell dieses Chats; Auswahl aus Brians Z.AI-Modellen und „nur für diesen Chat“. */
@Composable
fun ModellChip(chat: com.claudewebui.swarm.data.Chat?, z: SchwarmZustand, a: Aktionen) {
    val brian = z.hub.modelle["brian"] ?: return
    val lokal by a.vm.chatModelle.collectAsStateWithLifecycle()
    val gewaehlt = chat?.let { c -> lokal[c.wurzel] ?: letzterModellBefehl(c) }
    val name = brian.name(gewaehlt ?: brian.modell) ?: "Standard"
    var offen by remember { mutableStateOf(false) }
    Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box {
            AssistChip(
                onClick = { offen = true },
                enabled = chat != null && z.allgemein.bereit,
                label = { Text(if (gewaehlt == null) "$name · Standard" else name, maxLines = 1) },
                leadingIcon = { Icon(Icons.Outlined.Psychology, null, Modifier.size(18.dp)) },
                trailingIcon = { Icon(Icons.Outlined.ArrowDropDown, null, Modifier.size(18.dp)) },
            )
            androidx.compose.material3.DropdownMenu(expanded = offen, onDismissRequest = { offen = false }) {
                Text("Brians Modelle", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                brian.modelle.forEach { m ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text(m.name + if ((gewaehlt ?: brian.modell) == m.id) "  ✓" else "") },
                        onClick = { offen = false; chat?.let { a.vm.chatModellSetzen(it, m) } },
                    )
                }
                // Nur dieser Chat, nach Weg getrennt: LiteLLM (App 2.10) und andere Abos.
                brian.nurChat.groupBy { it.anbieter == "litellm" }.toSortedMap(compareBy { !it }).forEach { (lite, liste) ->
                    HorizontalDivider()
                    Text(
                        if (lite) "Nur dieser Chat · LiteLLM" else "Nur dieser Chat · andere Abos",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    )
                    liste.forEach { m ->
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text(m.name + if (gewaehlt == m.id) "  ✓" else "") },
                            onClick = { offen = false; chat?.let { a.vm.chatModellSetzen(it, m) } },
                        )
                    }
                }
            }
        }
        if (chat == null) {
            Spacer(Modifier.width(8.dp))
            Text(
                "Umstellen geht, sobald der Chat läuft.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Das Modell aus dem letzten `/model …` im Chat, falls die App es nicht schon kennt. */
fun letzterModellBefehl(c: com.claudewebui.swarm.data.Chat): String? =
    c.nachrichten.lastOrNull { it.art == com.claudewebui.swarm.data.ChatArt.BEFEHL && it.n.text.trimStart().startsWith("/model ") }
        ?.n?.text?.trim()?.split(Regex("""\s+"""))?.getOrNull(1)
