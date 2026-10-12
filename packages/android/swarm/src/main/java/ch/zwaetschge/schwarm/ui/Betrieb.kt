package com.claudewebui.swarm.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Auftrag
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Zustand

/**
 * Betrieb (App 2.9, Verbesserung 8): Container, Logs und Neustart über den Worker `betrieb`, ohne `!aktion` zu
 * tippen. Die App schickt dieselben Befehle in die Lobby und liest die Rückmeldung des Workers im Thread der Karte.
 * Grün (Liste, Zustand, Logs) läuft sofort; ein Neustart ist gelb und wartet auf dein ✅ in den Freigaben.
 */
data class BetriebLauf(val faehigkeit: String, val ziel: String, val ab: Long)

data class ContainerZeile(val name: String, val zustand: String, val status: String)

/** Die Ausgabe von `docker.list`: Kopfzeile, dann `name\tstate\tstatus\timage` je Zeile. */
fun containerLesen(ausgabe: String): List<ContainerZeile> = ausgabe.lineSequence()
    .map { it.split('\t') }
    .filter { it.size >= 3 && it[0].isNotBlank() }
    .map { ContainerZeile(it[0].trim(), it[1].trim(), it[2].trim()) }
    .toList()

/** Der Auftrag, den der letzte Lauf angelegt hat, und die Ausgabe des Workers, sobald sie da ist. */
private fun laufAuftrag(z: SchwarmZustand, l: BetriebLauf): Auftrag? = z.auftraege
    .filter { it.zustaendig == "betrieb" && it.ziel.startsWith(l.faehigkeit) && (l.ziel.isEmpty() || it.ziel.contains(l.ziel)) && it.aktualisiert >= l.ab - 5_000 }
    .maxByOrNull { it.nummer }

private fun ausgabe(z: SchwarmZustand, t: Auftrag): String? {
    val antwort = z.verlauf(t.raumId).nachrichten
        .filter { it.threadWurzel == t.threadWurzel && (it.text.startsWith("✅ ${t.id}") || it.text.startsWith("❌ ${t.id}")) }
        .maxByOrNull { it.zeit }
    return antwort?.text?.substringAfter("\n\n", "")?.ifBlank { antwort.text } ?: t.hinweis
}

/** Beispiel-Ausgaben für die Vorschau: Dort geht nichts an den Worker. */
private fun vorschauAusgabe(l: BetriebLauf): String = when (l.faehigkeit) {
    "docker.list" -> listOf(
        "council-matrix\trunning\tUp 2 hours (healthy)", "matrix-synapse\trunning\tUp 3 days (healthy)",
        "paperless\trunning\tUp 14 minutes (unhealthy)", "radio-stream\texited\tExited (1) 2 hours ago",
        "schwarm-betrieb\trunning\tUp 3 days", "vocarium\trunning\tUp 20 hours (healthy)",
    ).filter { l.ziel == "alle" || (l.ziel == "unhealthy" && "unhealthy" in it) || (l.ziel == "gestoppt" && "exited" in it) || it.startsWith(l.ziel) }
        .joinToString("\n", prefix = "Vorschau\n") { "$it\tbild" }
    "docker.logs" -> "[21:02:11] GET /api/ 502 upstream timed out\n[21:02:41] healthcheck failed (3/3)\n[21:03:12] worker restarted"
    "docker.inspect" -> "${l.ziel}: running, Abbild ghcr.io/beispiel:latest, 2 Neustarts, seit 2026-09-28T19:10Z"
    else -> "Vorschau: Ein Neustart wartet auf dein ✅ in den Freigaben."
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BetriebAnsicht(vm: SchwarmViewModel, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val lauf by vm.betriebLauf.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf("alle") }
    var suche by rememberSaveable { mutableStateOf("") }
    var liste by remember { mutableStateOf<List<ContainerZeile>?>(null) }
    var gewaehlt by rememberSaveable { mutableStateOf<String?>(null) }
    var neustartFrage by remember { mutableStateOf<String?>(null) }
    val vorschau by vm.vorschau.collectAsStateWithLifecycle()
    val auftrag = if (vorschau) null else lauf?.let { laufAuftrag(z, it) }
    val text = if (vorschau) lauf?.let(::vorschauAusgabe) else auftrag?.takeIf { !it.zustand.offen }?.let { ausgabe(z, it) }
    // Die Rückmeldung steht im Thread der Karte; fehlt sie im Sync, einmal nachladen.
    LaunchedEffect(auftrag?.id, auftrag?.zustand) {
        val t = auftrag ?: return@LaunchedEffect
        if (!t.zustand.offen && t.raumId != null && t.threadWurzel != null && ausgabe(z, t) == t.hinweis) vm.threadLaden(t.raumId, t.threadWurzel)
    }
    LaunchedEffect(text, lauf) {
        if (lauf?.faehigkeit == "docker.list" && text != null) liste = containerLesen(text)
    }
    LaunchedEffect(Unit) { if (lauf == null) vm.betriebAusfuehren("docker.list", "alle") }
    var jetzt by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(lauf, auftrag == null) { while (lauf != null && auftrag == null) { kotlinx.coroutines.delay(1_000); jetzt = System.currentTimeMillis() } }
    // Lehnt der Hub den Befehl gleich ab, entsteht kein Auftrag; die Antwort steht dann in der Lobby.
    val ohneAntwort = !vorschau && lauf != null && auftrag == null && jetzt - lauf!!.ab > 20_000
    val laeuft = !vorschau && lauf != null && !ohneAntwort && (auftrag == null || auftrag.zustand.offen)
    Scaffold(
        topBar = {
            SchwarmLeiste("Betrieb", "über den Worker betrieb", zurueck = if (a.zurueckPfeil) zurueck else null) {
                IconButton(onClick = { vm.betriebAusfuehren("docker.list", suche.trim().ifBlank { filter }) }, enabled = !laeuft) {
                    Icon(Icons.Outlined.Refresh, "Neu laden")
                }
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(top = pad.calculateTopPadding()).verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("alle" to "Alle", "unhealthy" to "Ungesund", "gestoppt" to "Gestoppt").forEach { (w, t) ->
                    FilterChip(selected = filter == w && suche.isBlank(), enabled = !laeuft, onClick = {
                        filter = w; suche = ""; vm.betriebAusfuehren("docker.list", w)
                    }, label = { Text(t) })
                }
            }
            OutlinedTextField(
                suche, { suche = it.filter { c -> c.isLetterOrDigit() || c in "-_." }.take(40) },
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                label = { Text("Name enthält …") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { if (suche.isNotBlank()) vm.betriebAusfuehren("docker.list", suche.trim()) }),
            )
            if (laeuft) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        lauf?.let { "${it.faehigkeit} ${it.ziel}".trim() + (auftrag?.let { t -> " · ${t.id} ${t.zustand.titel}" } ?: " · gesendet") }.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            if (ohneAntwort) {
                HinweisKarte(Icons.Outlined.Close, "Kein Auftrag entstanden", "Der Hub hat den Befehl wohl abgelehnt; die Antwort steht in der Lobby.", StatusWarnung, Modifier.padding(16.dp))
            }
            if (auftrag?.zustand == Zustand.FEHLGESCHLAGEN || (auftrag != null && text != null && text.startsWith("🚫"))) {
                HinweisKarte(Icons.Outlined.Close, "Nicht ausgeführt", text, StatusKritisch, Modifier.padding(16.dp))
            }
            Abschnitt("Container" + (liste?.let { " (${it.size})" } ?: ""), Modifier.padding(horizontal = 12.dp))
            val l = liste
            when {
                l == null -> Text("Wird geladen …", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                l.isEmpty() -> Text(text ?: "Kein Container passt.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> l.forEach { c ->
                    val offen = gewaehlt == c.name
                    Column(Modifier.fillMaxWidth().clickable { gewaehlt = if (offen) null else c.name }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val farbe = when {
                                c.status.contains("unhealthy") -> StatusKritisch
                                c.zustand == "running" -> StatusGut
                                c.zustand == "restarting" -> StatusWarnung
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }
                            Box(Modifier.size(10.dp).background(farbe, CircleShape))
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.bodyLarge)
                                Text(c.status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (offen) {
                            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { vm.betriebAusfuehren("docker.logs", c.name, "100") }, enabled = !laeuft) { Text("Logs") }
                                OutlinedButton(onClick = { vm.betriebAusfuehren("docker.inspect", c.name) }, enabled = !laeuft) { Text("Zustand") }
                                TextButton(onClick = { neustartFrage = c.name }, enabled = !laeuft) { Text("Neu starten …") }
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
            val zeigen = lauf?.takeIf { it.faehigkeit != "docker.list" }
            if (zeigen != null && text != null) {
                Abschnitt("${zeigen.faehigkeit} ${zeigen.ziel}", Modifier.padding(horizontal = 12.dp))
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                ) {
                    Text(
                        text,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),
                    )
                }
                if (zeigen.faehigkeit == "docker.restart" && auftrag?.zustand?.offen == true) {
                    Text("Wartet auf dein ✅ in den Freigaben.", Modifier.padding(16.dp), color = StatusWarnung)
                }
            }
        }
    }
    neustartFrage?.let { name ->
        AlertDialog(
            onDismissRequest = { neustartFrage = null },
            title = { Text("$name neu starten?") },
            text = {
                Text(
                    "Ein Neustart ist gelb: Der Hub legt eine Freigabe an, und erst dein ✅ (mit Fingerabdruck) startet ihn. " +
                        "Kernteile wie Traefik, Synapse oder der Hub sind gesperrt.",
                )
            },
            confirmButton = { Button(onClick = { neustartFrage = null; vm.betriebAusfuehren("docker.restart", name, "aus der App") }) { Text("Anfragen") } },
            dismissButton = { TextButton(onClick = { neustartFrage = null }) { Text("Abbrechen") } },
        )
    }
}
