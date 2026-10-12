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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.claudewebui.swarm.data.Einheit
import com.claudewebui.swarm.data.EinheitZustand
import com.claudewebui.swarm.data.SCHWARM_EINHEITEN
import com.claudewebui.swarm.data.SchwarmZustand

/**
 * Die Sitzungen eines Workers mit Einheiten, heute Plum (Punkt 17): Zustand, Auftrag, Link und
 * laufender Auftrag, dazu Kommen und Gehen aus #ag-plum. Alles aus dem State-Event
 * `ch.zwaetschge.swarm.einheiten` des Hubs, ohne `!plum` zu tippen.
 */
@Composable
fun EinheitenAnsicht(agentId: String, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val stand = z.hub.einheiten[agentId]
    val name = z.agent(agentId)?.name ?: agentId.replaceFirstChar { it.uppercase() }
    val jetzt = rememberJetzt(30_000L)
    var auftragFuer by remember { mutableStateOf<Einheit?>(null) }
    var stoppen by remember { mutableStateOf<Einheit?>(null) }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                titel = if (agentId == "plum") "Plum-Sitzungen" else "Einheiten · $name",
                untertitel = stand?.let { s ->
                    "${s.eintraege.size} Sitzungen · Stand ${if (s.at > 0) vorText(s.at, jetzt) else "unbekannt"}"
                },
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = pad.calculateTopPadding() + 8.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (z.hub.zuNeu(SCHWARM_EINHEITEN)) item(key = "update") { UpdateHinweis("die Plum-Sitzungen") }
            if (z.alterStand) item(key = "stand") { StandHinweis(z, knapp = true) }
            if (stand == null) {
                item(key = "leer") {
                    RuhigKarte(
                        Icons.Outlined.Laptop,
                        "Noch kein Stand von der Brücke",
                        "Sobald die Plum-Brücke verbunden ist, meldet der Hub hier die Sitzungen mit Zustand und Link. " +
                            "`!plum` in der Lobby fragt den letzten Stand ab.",
                    )
                }
            } else {
                if (stand.veraltetUm(jetzt)) {
                    item(key = "veraltet") {
                        HinweisKarte(
                            Icons.Outlined.LinkOff,
                            if (!stand.verbunden) "Die Plum-Brücke ist nicht verbunden" else "Seit 25 min kein Stand vom Hub",
                            "Stand von ${zeitText(stand.at)}. Zustände und Links können sich inzwischen geändert haben.",
                            StatusWarnung,
                        )
                    }
                }
                if (stand.eintraege.isEmpty()) {
                    item(key = "keine") {
                        RuhigKarte(Icons.Outlined.Laptop, "Keine offenen Sitzungen", "Neue Sitzungen erscheinen hier mit 🆕.")
                    }
                }
                items(stand.eintraege, key = { "s-" + (it.id ?: it.name) }) { e ->
                    EinheitKarte(
                        e, z, a,
                        onAuftrag = if (a.rolle.darfAuftragAn(agentId)) ({ auftragFuer = e }) else null,
                        onStoppen = if (e.auftrag != null && a.rolle.darf("stop")) ({ stoppen = e }) else null,
                    )
                }
            }
            if (z.plumHinweise.isNotEmpty() && agentId == "plum") {
                item(key = "kommen-titel") { Abschnitt("Kommen und Gehen") }
                items(z.plumHinweise, key = { "h-" + it.eventId }) { n ->
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
                            Text(n.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                            Spacer(Modifier.width(8.dp))
                            Text(vorText(n.zeit, jetzt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }

    auftragFuer?.let { e ->
        EinheitAuftrag(
            e, agentId,
            onSenden = { text ->
                a.vm.befehl(text, "Auftrag an ${e.name} geschickt. Die Quittung kommt in die Lobby.")
                auftragFuer = null
            },
            onSchliessen = { auftragFuer = null },
        )
    }
    stoppen?.let { e ->
        val nummer = e.auftrag ?: return@let
        AlertDialog(
            onDismissRequest = { stoppen = null },
            icon = { Icon(Icons.Outlined.StopCircle, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("$nummer stoppen?") },
            text = {
                Text(
                    reicherText(
                        "`!stop $nummer` bricht den Auftrag der Sitzung ${e.name} ab. Die Sitzung selbst bleibt in Plum offen.",
                        MaterialTheme.colorScheme,
                    ),
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        a.vm.befehl("!stop $nummer", "!stop $nummer gesendet. Der Hub bricht den Auftrag ab.")
                        stoppen = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) { Text("Stoppen") }
            },
            dismissButton = { TextButton(onClick = { stoppen = null }) { Text("Weiterlaufen lassen") } },
        )
    }
}

fun einheitFarbe(z: EinheitZustand, f: androidx.compose.material3.ColorScheme): Color = when (z) {
    EinheitZustand.WARTET -> Warnorange
    EinheitZustand.ARBEITET -> f.primary
    EinheitZustand.FEHLER -> f.error
    EinheitZustand.BEREIT -> f.tertiary
    EinheitZustand.ANDERS -> f.outline
}

private fun einheitZeichen(z: EinheitZustand): String = when (z) {
    EinheitZustand.WARTET -> "✋"
    EinheitZustand.ARBEITET -> "⚙️"
    EinheitZustand.FEHLER -> "⚠️"
    EinheitZustand.BEREIT -> "✅"
    EinheitZustand.ANDERS -> "•"
}

@Composable
private fun EinheitKarte(e: Einheit, z: SchwarmZustand, a: Aktionen, onAuftrag: (() -> Unit)?, onStoppen: (() -> Unit)?) {
    val f = MaterialTheme.colorScheme
    val farbe = einheitFarbe(e.zustand, f)
    val uri = LocalUriHandler.current
    KartenFlaeche(farbe, onClick = null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(e.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Pille("${einheitZeichen(e.zustand)} ${e.zustandText.ifBlank { e.zustand.titel }}", farbe)
        }
        if (e.text.isNotBlank()) Text(e.text, style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
        e.auftrag?.let { nummer ->
            val t = z.auftrag(nummer)
            AssistChip(
                onClick = { a.auftragOeffnen(nummer) },
                label = { Text(t?.let { "$nummer · ${it.zustand.zeichen} ${it.zustand.titel}" } ?: "Auftrag $nummer") },
                leadingIcon = { Icon(Icons.Outlined.TaskAlt, null, Modifier.size(18.dp)) },
            )
        }
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            onAuftrag?.let {
                FilledTonalButton(onClick = it) {
                    Icon(Icons.AutoMirrored.Filled.Send, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Auftrag")
                }
            }
            e.link?.let { link ->
                OutlinedButton(onClick = { runCatching { uri.openUri(link) } }) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Öffnen")
                }
            }
            onStoppen?.let {
                TextButton(onClick = it, colors = ButtonDefaults.textButtonColors(contentColor = f.error)) {
                    Icon(Icons.Outlined.StopCircle, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Stoppen")
                }
            }
        }
    }
}

/**
 * Auftrag an eine Sitzung: eine Eingabe, vorbelegt mit `!auftrag @plum/<name> `. Die Antwort im
 * Thread der Karte geht direkt in die Sitzung (ADR-002 §4.36).
 */
@Composable
private fun EinheitAuftrag(e: Einheit, agentId: String, onSenden: (String) -> Unit, onSchliessen: () -> Unit) {
    val praefix = "!auftrag @$agentId/${e.name} "
    var feld by remember { mutableStateOf(TextFieldValue(praefix, TextRange(praefix.length))) }
    val fokus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { fokus.requestFocus() } }
    val ziel = feld.text.removePrefix(praefix.trimEnd()).trim()
    val gueltig = feld.text.startsWith(praefix.trimEnd()) && ziel.isNotEmpty()
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Auftrag an ${e.name}", style = MaterialTheme.typography.titleLarge)
            Text(
                "Geht als Befehl in die Lobby. Der Hub gibt ihn an die Sitzung weiter; gibt es sie nicht mehr, scheitert der Auftrag, statt woanders zu landen.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = feld,
                onValueChange = { feld = it },
                textStyle = Mono,
                minLines = 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth().focusRequester(fokus),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onSchliessen) { Text("Abbrechen") }
                Spacer(Modifier.width(8.dp))
                Button(onClick = { onSenden(feld.text.trim()) }, enabled = gueltig) { Text("Senden") }
            }
            if (!feld.text.startsWith(praefix.trimEnd())) {
                Box { Text("Der Befehl muss mit „${praefix.trim()}“ beginnen.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}
