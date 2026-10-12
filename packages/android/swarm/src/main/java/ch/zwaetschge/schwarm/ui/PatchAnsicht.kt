@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallMerge
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Difference
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.automirrored.outlined.FactCheck
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.PatchArt
import com.claudewebui.swarm.data.PatchDatei
import com.claudewebui.swarm.data.PatchLeser
import com.claudewebui.swarm.data.PatchZeile
import com.claudewebui.swarm.data.SchwarmZustand
import kotlinx.coroutines.launch

/** So viele Zeilen zeigt die Ansicht höchstens; dahinter ein Hinweis. Das Telefon bleibt flüssig. */
private const val ZEILEN_MAX = 6_000

/**
 * Der Patch eines Code-Auftrags (Punkt 13): die Datei aus dem Thread, geladen über authentifizierte
 * Medien, als farbiger Unified Diff, je Datei einklappbar. Dazu Prüfen (grün), Anwenden (gelb, mit
 * Rückfrage) und Zusammenführen (gelb, mit Rückfrage und Biometrie).
 */
@Composable
fun PatchAnsicht(raumId: String, eventId: String, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val n = z.nachricht(raumId, eventId)
    val datei = n?.datei
    val mxc = datei?.mxc
    val dateien by a.vm.dateien.collectAsStateWithLifecycle()
    val ladung = mxc?.let { dateien[it] }
    LaunchedEffect(mxc) { if (mxc != null) a.vm.dateiLaden(mxc) }
    // Die Nummer aus den Angaben des Hubs, sonst die des Auftrags, in dessen Thread der Patch liegt.
    val auftrag = datei?.patch?.auftrag ?: z.auftraege.firstOrNull { it.raumId == raumId && it.threadWurzel == n?.threadWurzel }?.id
    val patch = remember(ladung) { (ladung as? Ladung.Fertig)?.let { PatchLeser.lesen(it.text) } }
    val zu = remember(eventId) { mutableStateMapOf<Int, Boolean>() }
    var frage by remember { mutableStateOf<String?>(null) }
    val info = datei?.patch
    Scaffold(
        topBar = {
            SchwarmLeiste(
                titel = "Patch" + (auftrag?.let { " $it" } ?: ""),
                untertitel = patchZusammenfassung(
                    info?.repo,
                    info?.dateien ?: patch?.dateien?.size,
                    info?.plus ?: patch?.plus,
                    info?.minus ?: patch?.minus,
                ) ?: datei?.name,
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = pad.calculateTopPadding() + 8.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            if (datei == null || mxc == null) {
                item(key = "fehlt") {
                    LeerHinweis(Icons.Outlined.Difference, "Patch nicht gefunden", "Die Datei steht nicht mehr im geladenen Verlauf.")
                }
                return@LazyColumn
            }
            item(key = "kopf") {
                PatchKopf(auftrag, info?.repo, a, onFrage = { frage = it })
                Spacer(Modifier.size(10.dp))
            }
            when (ladung) {
                null, Ladung.Laeuft -> item(key = "laedt") {
                    Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Patch wird geladen …", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                is Ladung.Fehler -> item(key = "fehler") {
                    HinweisKarte(Icons.Outlined.Difference, "Der Patch liess sich nicht laden", ladung.grund, StatusKritisch) {
                        TextButton(onClick = { a.vm.dateiLaden(mxc, neu = true) }) {
                            Icon(Icons.Outlined.Refresh, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Noch einmal")
                        }
                    }
                }
                is Ladung.Fertig -> {
                    val p = patch ?: return@LazyColumn
                    if (p.vorspann.any { it.isNotBlank() }) {
                        item(key = "vorspann") {
                            Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                                Text(
                                    p.vorspann.joinToString("\n").trim(),
                                    style = Mono.copy(fontSize = 12.sp),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(10.dp),
                                )
                            }
                            Spacer(Modifier.size(10.dp))
                        }
                    }
                    if (p.dateien.isEmpty()) {
                        item(key = "leer") { Text("Der Anhang enthält keinen Diff.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    var gezeigt = 0
                    p.dateien.forEachIndexed { i, d ->
                        // Grosse Patches beginnen zugeklappt, damit die Übersicht über die Dateien bleibt.
                        val offen = zu[i]?.not() ?: (p.dateien.size <= 4 || d.zeilen.size < 120)
                        item(key = "d-$i") {
                            DateiKopf(d, offen) { zu[i] = offen }
                        }
                        if (offen && gezeigt < ZEILEN_MAX) {
                            val zeilen = d.zeilen.filter { it.art != PatchArt.KOPF || it.text.startsWith("new file") || it.text.startsWith("deleted file") || it.text.startsWith("rename") }
                                .take(ZEILEN_MAX - gezeigt)
                            gezeigt += zeilen.size
                            items(zeilen.size, key = { j -> "z-$i-$j" }) { j -> DiffZeile(zeilen[j]) }
                        }
                        item(key = "abstand-$i") { Spacer(Modifier.size(10.dp)) }
                    }
                    if (gezeigt >= ZEILEN_MAX) {
                        item(key = "gekuerzt") {
                            Text(
                                "Gekürzt: Mehr als $ZEILEN_MAX Zeilen zeigt die App nicht an.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
    val nummer = auftrag
    frage?.let { was ->
        if (nummer != null) PatchFrage(was, nummer, info?.repo, a, onSchliessen = { frage = null })
    }
}

/** Die drei Knöpfe; ohne Auftragsnummer oder für Gäste nur der Hinweis. */
@Composable
private fun PatchKopf(auftrag: String?, repo: String?, a: Aktionen, onFrage: (String) -> Unit) {
    val f = MaterialTheme.colorScheme
    Surface(color = f.surfaceContainerLow, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                if (auftrag != null) "Code-Ergebnis von $auftrag" + (repo?.let { " für das Repo $it" } ?: "") else "Patch ohne Auftragsnummer",
                style = MaterialTheme.typography.titleSmall,
            )
            if (auftrag == null || !a.rolle.darf("patch")) {
                Text(
                    if (auftrag == null) "Ohne Nummer kann die App keinen `!patch`-Befehl bilden." else "Prüfen und Anwenden bleiben bei Vale.",
                    style = MaterialTheme.typography.bodySmall,
                    color = f.onSurfaceVariant,
                )
                return@Column
            }
            Text(
                "Prüfen testet auf einer Kopie. Anwenden legt den Zweig schwarm/$auftrag an. Zusammenführen bringt ihn ins Repo.",
                style = MaterialTheme.typography.bodySmall,
                color = f.onSurfaceVariant,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Grün: ohne Rückfrage.
                FilledTonalButton(
                    onClick = { a.vm.patch(auftrag, "pruefen") },
                    colors = ButtonDefaults.filledTonalButtonColors(containerColor = StatusGut.copy(alpha = 0.18f), contentColor = f.onSurface),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.FactCheck, null, Modifier.size(18.dp), tint = StatusGut)
                    Spacer(Modifier.width(8.dp))
                    Text("Prüfen")
                }
                // Gelb: mit Rückfrage.
                OutlinedButton(
                    onClick = { onFrage("anwenden") },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = f.onSurface),
                ) {
                    Icon(Icons.Outlined.AccountTree, null, Modifier.size(18.dp), tint = StatusWarnung)
                    Spacer(Modifier.width(8.dp))
                    Text("Anwenden")
                }
                // Gelb: mit Rückfrage und Biometrie.
                Button(
                    onClick = { onFrage("zusammenfuehren") },
                    colors = ButtonDefaults.buttonColors(containerColor = StatusWarnung, contentColor = Color(0xFF2B1D00)),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.CallMerge, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Zusammenführen")
                }
            }
        }
    }
}

/** Rückfrage für die gelben Knöpfe; „Zusammenführen“ verlangt danach Biometrie. */
@Composable
private fun PatchFrage(was: String, auftrag: String, repo: String?, a: Aktionen, onSchliessen: () -> Unit) {
    val kontext = LocalContext.current
    val scope = rememberCoroutineScope()
    val zusammen = was == "zusammenfuehren"
    var laeuft by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!laeuft) onSchliessen() },
        icon = { Icon(if (zusammen) Icons.AutoMirrored.Outlined.CallMerge else Icons.Outlined.AccountTree, null, tint = StatusWarnung) },
        title = { Text(if (zusammen) "$auftrag zusammenführen?" else "$auftrag anwenden?") },
        text = {
            Text(
                reicherText(
                if (zusammen) {
                    "`!patch $auftrag zusammenfuehren`: Der Zweig schwarm/$auftrag kommt in den Hauptzweig" +
                        (repo?.let { " von $it" } ?: "") + ". Das lässt sich nur über einen neuen Commit rückgängig machen. " +
                        "Danach bestätigst du mit Biometrie."
                } else {
                    "`!patch $auftrag anwenden`: Der Betrieb legt den Zweig schwarm/$auftrag" + (repo?.let { " im Repo $it" } ?: "") +
                        " an und lässt die Tests laufen. Der Hauptzweig bleibt unberührt."
                },
                    MaterialTheme.colorScheme,
                ),
            )
        },
        confirmButton = {
            Button(
                onClick = {
                    if (!zusammen) {
                        a.vm.patch(auftrag, was)
                        onSchliessen()
                        return@Button
                    }
                    laeuft = true
                    scope.launch {
                        val (e, grund) = Biometrie.bestaetigen(kontext, "Patch zusammenführen", "$auftrag in den Hauptzweig")
                        laeuft = false
                        when (e) {
                            Biometrie.Ergebnis.OK -> {
                                a.vm.patch(auftrag, was)
                                onSchliessen()
                            }
                            Biometrie.Ergebnis.NICHT_EINGERICHTET -> {
                                a.vm.melden("Zusammenführen braucht eine Displaysperre mit Biometrie oder PIN. ${grund.orEmpty()}".trim())
                                onSchliessen()
                            }
                            Biometrie.Ergebnis.ABGEBROCHEN -> Unit
                            Biometrie.Ergebnis.FEHLER -> a.vm.melden("Biometrie fehlgeschlagen: ${grund ?: "unbekannt"}")
                        }
                    }
                },
                enabled = !laeuft,
                colors = ButtonDefaults.buttonColors(containerColor = StatusWarnung, contentColor = Color(0xFF2B1D00)),
            ) {
                if (zusammen) {
                    Icon(Icons.Outlined.Fingerprint, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (zusammen) "Zusammenführen" else "Anwenden")
            }
        },
        dismissButton = { TextButton(onClick = onSchliessen, enabled = !laeuft) { Text("Abbrechen") } },
    )
}

@Composable
private fun DateiKopf(d: PatchDatei, offen: Boolean, onUmschalten: () -> Unit) {
    val f = MaterialTheme.colorScheme
    Surface(
        onClick = onUmschalten,
        color = f.surfaceContainerHigh,
        shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp, bottomStart = if (offen) 0.dp else 12.dp, bottomEnd = if (offen) 0.dp else 12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (offen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, if (offen) "Zuklappen" else "Aufklappen", Modifier.size(20.dp))
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (d.geloescht) d.altPfad ?: d.pfad else d.pfad,
                    style = Mono.copy(fontSize = 12.sp),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val art = when {
                    d.neu -> "neu"
                    d.geloescht -> "gelöscht"
                    d.altPfad != null -> "umbenannt von ${d.altPfad}"
                    d.binaer -> "binär"
                    else -> null
                }
                if (art != null) Text(art, style = MaterialTheme.typography.labelSmall, color = f.onSurfaceVariant)
            }
            Spacer(Modifier.width(8.dp))
            Text("+${d.plus}", style = MaterialTheme.typography.labelLarge, color = diffPlus(f))
            Spacer(Modifier.width(6.dp))
            Text("−${d.minus}", style = MaterialTheme.typography.labelLarge, color = diffMinus(f))
        }
    }
}

private fun diffPlus(f: androidx.compose.material3.ColorScheme): Color = f.tertiary
private fun diffMinus(f: androidx.compose.material3.ColorScheme): Color = f.error

/** Eine Zeile des Diffs: + grün, − rot, @@ grau, Kontext neutral, in Monospace mit Zeilennummer. */
@Composable
private fun DiffZeile(z: PatchZeile) {
    val f = MaterialTheme.colorScheme
    val (hinten, vorne) = when (z.art) {
        PatchArt.PLUS -> diffPlus(f).copy(alpha = 0.13f) to diffPlus(f)
        PatchArt.MINUS -> diffMinus(f).copy(alpha = 0.13f) to diffMinus(f)
        PatchArt.HUNK -> f.surfaceContainerHighest to f.onSurfaceVariant
        PatchArt.HINWEIS, PatchArt.KOPF -> f.surfaceContainerLow to f.outline
        PatchArt.KONTEXT -> f.surfaceContainerLow to f.onSurface
    }
    Row(Modifier.fillMaxWidth().background(hinten)) {
        Box(Modifier.width(34.dp).padding(end = 4.dp), contentAlignment = Alignment.TopEnd) {
            Text(
                (z.neu ?: z.alt)?.toString().orEmpty(),
                style = Mono.copy(fontSize = 10.sp),
                color = f.outline,
                maxLines = 1,
            )
        }
        Text(
            z.text.ifEmpty { " " },
            style = Mono.copy(fontSize = 12.sp),
            color = vorne,
            modifier = Modifier.weight(1f).padding(end = 6.dp),
        )
    }
}
