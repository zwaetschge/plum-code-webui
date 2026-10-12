@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.FAVORITEN_MAX
import com.claudewebui.swarm.data.Rolle
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Vorlage
import com.claudewebui.swarm.data.VorlagenText

/**
 * Vorlagen und Favoriten (Punkt 19), nur auf diesem Gerät: Agent, Ziel mit Platzhaltern wie
 * `{container}`, Budget und Frist. Bis 6 Favoriten stehen in der Übersicht und im Widget.
 */
@Composable
fun VorlagenAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val vorlagen by a.vm.vorlagen.collectAsStateWithLifecycle()
    var bearbeiten by remember { mutableStateOf<Vorlage?>(null) }
    var neu by remember { mutableStateOf(false) }
    var loeschen by remember { mutableStateOf<Vorlage?>(null) }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                "Vorlagen",
                "${vorlagen.size} Vorlagen · ${vorlagen.count { it.favorit }} von $FAVORITEN_MAX Favoriten",
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                IconButton(onClick = { neu = true }) { Icon(Icons.Filled.Add, "Neue Vorlage") }
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
            item(key = "hinweis") {
                Text(
                    "Vorlagen bleiben auf diesem Gerät. Platzhalter in geschweiften Klammern wie {container} fragt die App beim Senden ab. " +
                        "Favoriten (★) stehen beim neuen Auftrag zuerst, bis $FAVORITEN_MAX davon auch im Widget „Schwarm-Favoriten“.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (vorlagen.isEmpty()) {
                item(key = "leer") {
                    RuhigKarte(
                        Icons.Outlined.Bookmarks,
                        "Noch keine Vorlagen",
                        "Leg eine mit „+“ an, oder speichere einen Auftrag im Formular „Neuer Auftrag“ mit „Als Vorlage“.",
                    )
                }
            }
            items(vorlagen, key = { it.id }) { v ->
                VorlageKarte(
                    v,
                    z,
                    darfSenden = a.rolle.darfAuftragAn(v.agent.substringBefore('/')),
                    onSenden = { a.vorlageEinsetzen(v) },
                    onStern = { a.vm.favoritUmschalten(v.id) },
                    onBearbeiten = { bearbeiten = v },
                    onLoeschen = { loeschen = v },
                )
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
    if (neu || bearbeiten != null) {
        VorlageFormular(
            bearbeiten,
            z,
            a.rolle,
            onSpeichern = { a.vm.vorlageSpeichern(it); neu = false; bearbeiten = null },
            onSchliessen = { neu = false; bearbeiten = null },
        )
    }
    loeschen?.let { v ->
        AlertDialog(
            onDismissRequest = { loeschen = null },
            icon = { Icon(Icons.Outlined.DeleteOutline, null) },
            title = { Text("„${v.titel}“ löschen?") },
            text = { Text("Die Vorlage verschwindet von diesem Gerät, auch aus dem Widget.") },
            confirmButton = { Button(onClick = { a.vm.vorlageLoeschen(v.id); loeschen = null }) { Text("Löschen") } },
            dismissButton = { TextButton(onClick = { loeschen = null }) { Text("Behalten") } },
        )
    }
}

/** Das Ziel mit hervorgehobenen Platzhaltern. */
@Composable
private fun zielMitPlatzhaltern(ziel: String) = buildAnnotatedString {
    val f = MaterialTheme.colorScheme
    var pos = 0
    Regex("""\{[^{}\n]{1,40}\}""").findAll(ziel).forEach { m ->
        append(ziel.substring(pos, m.range.first))
        withStyle(SpanStyle(color = f.primary, fontWeight = FontWeight.SemiBold, background = f.primaryContainer)) { append(m.value) }
        pos = m.range.last + 1
    }
    append(ziel.substring(pos))
}

@Composable
private fun VorlageKarte(
    v: Vorlage,
    z: SchwarmZustand,
    darfSenden: Boolean,
    onSenden: () -> Unit,
    onStern: () -> Unit,
    onBearbeiten: () -> Unit,
    onLoeschen: () -> Unit,
) {
    val f = MaterialTheme.colorScheme
    KartenFlaeche(if (v.favorit) f.primary else f.outlineVariant, onClick = null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(v.titel, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "@${v.agent}" + (z.agent(v.agent.substringBefore('/'))?.let { " · ${it.name}" } ?: ""),
                    style = MaterialTheme.typography.labelMedium,
                    color = f.onSurfaceVariant,
                )
            }
            IconButton(onClick = onStern) {
                Icon(
                    if (v.favorit) Icons.Filled.Star else Icons.Outlined.StarBorder,
                    if (v.favorit) "Kein Favorit mehr" else "Als Favorit",
                    tint = if (v.favorit) f.primary else f.onSurfaceVariant,
                )
            }
        }
        Text(zielMitPlatzhaltern(v.ziel), style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
        VorlagenText.zusatz(v)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant) }
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            IconButton(onClick = onLoeschen) { Icon(Icons.Outlined.DeleteOutline, "Löschen") }
            IconButton(onClick = onBearbeiten) { Icon(Icons.Outlined.Edit, "Bearbeiten") }
            FilledTonalButton(onClick = onSenden, enabled = darfSenden) {
                Icon(Icons.AutoMirrored.Filled.Send, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Senden")
            }
        }
    }
}

/** Neue Vorlage oder eine bestehende ändern. */
@Composable
private fun VorlageFormular(
    alt: Vorlage?,
    z: SchwarmZustand,
    rolle: Rolle,
    onSpeichern: (Vorlage) -> Unit,
    onSchliessen: () -> Unit,
) {
    var titel by remember { mutableStateOf(alt?.titel.orEmpty()) }
    var agent by remember { mutableStateOf(alt?.agent ?: z.agenten.firstOrNull { it.nimmtAuftraege && rolle.darfAuftragAn(it.id) }?.id.orEmpty()) }
    var ziel by remember { mutableStateOf(alt?.ziel.orEmpty()) }
    var usd by remember { mutableStateOf(alt?.budgetUsd?.let(VorlagenText::zahl).orEmpty()) }
    var minuten by remember { mutableStateOf(alt?.budgetMin?.toString().orEmpty()) }
    var frist by remember { mutableStateOf(alt?.frist.orEmpty()) }
    var favorit by remember { mutableStateOf(alt?.favorit ?: false) }
    val usdWert = usd.replace(',', '.').toDoubleOrNull()
    val minWert = minuten.toIntOrNull()
    val usdOk = usd.isBlank() || (usdWert != null && usdWert > 0 && usdWert <= 1000)
    val minOk = minuten.isBlank() || (minWert != null && minWert in 1..1440)
    val agentOk = Regex("""^[a-z0-9][a-z0-9-]{0,39}(/[A-Za-z0-9_.-]{1,60})?$""").matches(agent)
    val gueltig = titel.isNotBlank() && agentOk && ziel.isNotBlank() && usdOk && minOk
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp)
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (alt == null) "Neue Vorlage" else "Vorlage ändern", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = titel, onValueChange = { titel = it.take(40) }, label = { Text("Titel") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                z.agenten.filter { it.nimmtAuftraege && rolle.darfAuftragAn(it.id) }.forEach { x ->
                    FilterChip(selected = agent == x.id, onClick = { agent = x.id }, label = { Text(x.name) })
                }
            }
            OutlinedTextField(
                value = agent,
                onValueChange = { agent = it.trim().removePrefix("@").take(100) },
                label = { Text("Agent") },
                supportingText = { Text("Etwa brian, oder plum/voxtral für eine Plum-Sitzung") },
                isError = agent.isNotEmpty() && !agentOk,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = ziel,
                onValueChange = { ziel = it },
                label = { Text("Ziel") },
                placeholder = { Text("z. B. Starte {container} neu und prüfe den Healthcheck.") },
                supportingText = {
                    val p = VorlagenText.platzhalter(ziel)
                    Text(if (p.isEmpty()) "Platzhalter in geschweiften Klammern: {container}" else "Platzhalter: ${p.joinToString(", ")}")
                },
                minLines = 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = usd, onValueChange = { usd = it.take(8) }, label = { Text("Budget USD") },
                    isError = !usdOk, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = minuten, onValueChange = { minuten = it.filter(Char::isDigit).take(4) }, label = { Text("Minuten") },
                    isError = !minOk, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
            }
            OutlinedTextField(
                value = frist, onValueChange = { frist = it.take(30) }, label = { Text("Frist") },
                placeholder = { Text("z. B. 2h oder heute 18:00") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Favorit (neuer Auftrag und Widget)", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Switch(checked = favorit, onCheckedChange = { favorit = it })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onSchliessen) { Text("Abbrechen") }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        val basis = alt ?: Vorlage(titel = "", agent = "", ziel = "")
                        onSpeichern(
                            basis.copy(
                                titel = titel.trim(),
                                agent = agent.trim(),
                                ziel = ziel.trim(),
                                budgetUsd = usdWert?.takeIf { usd.isNotBlank() },
                                budgetMin = minWert?.takeIf { minuten.isNotBlank() },
                                frist = frist.trim().ifBlank { null },
                                favorit = favorit,
                            ),
                        )
                    },
                    enabled = gueltig,
                ) { Text("Speichern") }
            }
        }
    }
}

/**
 * Eine Vorlage einsetzen: jeden Platzhalter abfragen, den fertigen Befehl zeigen und erst nach
 * deinem Okay senden. So kommt auch ein Favorit aus dem Widget nie ungefragt in die Lobby.
 */
@Composable
fun VorlageEinsetzen(v: Vorlage, rolle: Rolle, onSenden: (Map<String, String>) -> Unit, onSchliessen: () -> Unit) {
    val werte = remember(v.id) { mutableStateMapOf<String, String>() }
    val platzhalter = v.platzhalter
    val voll = platzhalter.all { !werte[it].isNullOrBlank() }
    val darf = rolle.darfAuftragAn(v.agent.substringBefore('/'))
    AlertDialog(
        onDismissRequest = onSchliessen,
        title = { Text(v.titel) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Auftrag an @${v.agent}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                platzhalter.forEach { p ->
                    OutlinedTextField(
                        value = werte[p].orEmpty(),
                        onValueChange = { werte[p] = it },
                        label = { Text(p) },
                        singleLine = p != "text",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Text("So geht er raus:", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Surface(color = MaterialTheme.colorScheme.surfaceContainerHighest, shape = RoundedCornerShape(10.dp)) {
                    Text(VorlagenText.befehl(v, werte), style = Mono, modifier = Modifier.padding(10.dp).heightIn(min = 24.dp))
                }
                if (!darf) {
                    Text("Aufträge an ${v.agent} sind für dich nicht freigegeben.", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = { Button(onClick = { onSenden(werte.toMap()) }, enabled = voll && darf) { Text("Senden") } },
        dismissButton = { TextButton(onClick = onSchliessen) { Text("Abbrechen") } },
    )
}

/**
 * Die Favoriten in der Übersicht: auf dem Aussenbildschirm zwei, sonst drei nebeneinander. Ein Tipp
 * fragt die Platzhalter ab und schickt den Auftrag nach deinem Okay.
 */
@Composable
fun FavoritenLeiste(favoriten: List<Vorlage>, a: Aktionen) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val proReihe = if (maxWidth < 360.dp) 2 else 3
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            favoriten.chunked(proReihe).forEach { reihe ->
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    reihe.forEach { v ->
                        Surface(
                            onClick = { a.vorlageEinsetzen(v) },
                            shape = RoundedCornerShape(14.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        ) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Star, null, Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(v.titel, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    repeat(proReihe - reihe.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}
