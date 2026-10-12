@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallSplit
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DataUsage
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Kontingente
import com.claudewebui.swarm.data.Routine
import com.claudewebui.swarm.data.SCHWARM_ROUTINEN
import com.claudewebui.swarm.data.SCHWARM_TUERSTEHER
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Sperre
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ── Türsteher (Punkt 4) ─────────────────────────────────────────────────────

/**
 * Was der Türsteher gesperrt hat, die neuesten zuerst. „freigeben“ schickt nach Rückfrage
 * `!entsperren <ip> <grund>`; der Betrieb trägt die Adresse in erlaubt.txt ein. Das Event
 * aktualisiert sich höchstens alle 10 min, darum merkt sich die App gesendete Freigaben.
 */
@Composable
fun TuersteherAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val t = z.hub.tuersteher
    val entsperrt by a.vm.entsperrt.collectAsStateWithLifecycle()
    var freigeben by remember { mutableStateOf<Sperre?>(null) }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                "Türsteher",
                t?.let { "${it.gesperrt} gesperrt · ${it.neu7Tage} neu in 7 Tagen" },
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (a.rolle.darf("sperren")) {
                    TextButton(onClick = { a.befehlUndLobby("!sperren") }) { Text("!sperren") }
                }
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
            if (z.hub.zuNeu(SCHWARM_TUERSTEHER)) item(key = "update") { UpdateHinweis("den Türsteher") }
            if (z.alterStand) item(key = "stand") { StandHinweis(z, knapp = true) }
            if (t == null) {
                item(key = "leer") {
                    RuhigKarte(
                        Icons.Outlined.Shield,
                        "Noch kein Stand vom Türsteher",
                        "Der Hub legt den Stand alle 10 min in die Lobby, sobald er den Türsteher lesen kann. `!sperren` fragt ihn direkt.",
                    )
                }
            } else {
                if (t.veraltet) {
                    item(key = "veraltet") {
                        HinweisKarte(
                            Icons.Outlined.Warning,
                            "Der Türsteher steht still",
                            "Sein letzter Stand ist von ${t.aktualisiert?.let { zeitText(it) } ?: "unbekannt"}. Läuft traefik-tuersteher noch?",
                            StatusWarnung,
                        )
                    }
                }
                item(key = "zahlen") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ZahlKachel("gesperrt", "${t.gesperrt}", null, Modifier.weight(1f))
                        ZahlKachel("neu in 7 Tagen", "${t.neu7Tage}", null, Modifier.weight(1f))
                        ZahlKachel("vertraut", "${t.vertraut}", null, Modifier.weight(1f))
                    }
                }
                item(key = "hinweis") {
                    Text(
                        "Stand ${t.aktualisiert?.let { "von ${zeitText(it)}" } ?: "unbekannt"} · aktualisiert sich höchstens alle 10 min. " +
                            "Freigeben trägt die Adresse in erlaubt.txt ein: Der Türsteher hebt die Sperre in Sekunden auf und sperrt sie nie wieder.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (t.sperren.isEmpty()) {
                    item(key = "keine") { RuhigKarte(Icons.Outlined.Shield, "Keine aktive Sperre", "Gerade ist keine Adresse gesperrt.") }
                } else {
                    item(key = "liste-titel") { Abschnitt("Sperren") { Text("${t.sperren.size}", style = MaterialTheme.typography.labelMedium) } }
                    items(t.sperren, key = { "p-" + it.ip }) { sp ->
                        SperreKarte(sp, gesendet = sp.ip in entsperrt, darf = a.rolle.darf("entsperren")) { freigeben = sp }
                    }
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
    freigeben?.let { sp ->
        var grund by remember(sp.ip) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { freigeben = null },
            icon = { Icon(Icons.Outlined.LockOpen, null, tint = StatusWarnung) },
            title = { Text("${sp.ip} freigeben?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Die Adresse kommt in erlaubt.txt und wird danach nie wieder gesperrt. Gesperrt wegen: ${sp.grund.ifBlank { "ohne Grund" }}.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = grund,
                        onValueChange = { grund = it.take(200) },
                        label = { Text("Grund") },
                        placeholder = { Text("z. B. eigenes Handy unterwegs") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        a.vm.entsperren(sp.ip, grund)
                        freigeben = null
                    },
                    enabled = grund.isNotBlank(),
                ) { Text("Freigeben") }
            },
            dismissButton = { TextButton(onClick = { freigeben = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun SperreKarte(sp: Sperre, gesendet: Boolean, darf: Boolean, onFreigeben: () -> Unit) {
    val f = MaterialTheme.colorScheme
    KartenFlaeche(if (sp.rueckfall) f.error else StatusWarnung, onClick = null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(sp.ip, style = Mono, color = f.onSurface, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sp.rueckfall) Pille("Rückfall", f.error)
        }
        Text(sp.grund.ifBlank { "ohne Grund" }, style = MaterialTheme.typography.bodyMedium)
        Text(
            listOfNotNull(sp.seit?.let { "seit ${zeitText(it)}" }, sp.bis?.let { "bis ${zeitText(it)}" }).joinToString(" · "),
            style = MaterialTheme.typography.labelMedium,
            color = f.onSurfaceVariant,
        )
        when {
            gesendet -> Wartet("Freigabe gesendet – der Hub antwortet mit 🔓, das Event folgt in bis zu 10 min")
            darf -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = onFreigeben) {
                    Icon(Icons.Outlined.LockOpen, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("freigeben")
                }
            }
        }
    }
}

// ── Abo-Stand (Punkt 7) ─────────────────────────────────────────────────────

/**
 * Wie voll die Abos von Claude, Codex und Z.AI sind: ein Balken je Eintrag, ab 80 % gelb, ab 95 %
 * rot, darunter „zurück um HH:MM“. Aktive Umleitungen stehen als Satz darunter.
 */
@Composable
fun AboKarte(k: Kontingente, z: SchwarmZustand) {
    val f = MaterialTheme.colorScheme
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = f.surfaceContainerLow)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.DataUsage, null, tint = f.primary, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Abo-Stand", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                k.at?.let { Text("Stand ${zeitText(it)}", style = MaterialTheme.typography.labelSmall, color = f.outline) }
            }
            if (k.eintraege.isEmpty()) {
                Text("Noch keine Kontingente gemeldet.", style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant)
            }
            k.eintraege.forEach { e ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            z.agent(e.agent)?.name ?: e.agent,
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            listOf(e.anbieter, e.fenster).filter { it.isNotBlank() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall,
                            color = f.onSurfaceVariant,
                        )
                        Spacer(Modifier.width(8.dp))
                        // Die Stufe nie nur als Farbe: ab 80 % mit Warnzeichen.
                        val anteil = e.auslastung
                        if (anteil != null && anteil >= 0.8) {
                            Icon(Icons.Outlined.Warning, if (anteil >= 0.95) "fast leer" else "knapp", tint = fuellFarbe(anteil, f), modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                        }
                        Text(
                            anteil?.let { "${Math.round(it * 100)} %" } ?: "unbekannt",
                            style = MaterialTheme.typography.labelLarge,
                            color = f.onSurface,
                        )
                    }
                    Fuellbalken(e.auslastung)
                    e.zurueck?.let {
                        Text("zurück um ${uhrzeit(it)}", style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant)
                    }
                }
            }
            k.umleitung.forEach { (von, nach) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Outlined.CallSplit, null, tint = StatusWarnung, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Code-Aufträge an $von gehen gerade an $nach.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

/** „HH:MM“, bei einem anderen Tag mit Datum davor. */
fun uhrzeit(ms: Long): String = zeitText(ms)

// ── Routinen (Punkt 10) ─────────────────────────────────────────────────────

/**
 * Wiederkehrende Aufträge mit Zeitplan: Schalter für Pause und Weiter, „Jetzt“, „Löschen“ und ein
 * Formular für `!routine neu`. Bis das Event des Hubs nachzieht, zeigt der Schalter deinen Wunsch.
 */
@Composable
fun RoutinenAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val routinen = z.hub.routinen
    val darf = a.rolle.darf("routine")
    var neu by remember { mutableStateOf(false) }
    var loeschen by remember { mutableStateOf<Routine?>(null) }
    // Gesendete Umschaltungen, bis das Event sie bestätigt: Name → pausiert.
    val gewuenscht = remember { mutableStateMapOf<String, Boolean>() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(routinen) {
        routinen?.forEach { r -> if (gewuenscht[r.name] == r.pausiert) gewuenscht.remove(r.name) }
    }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                "Routinen",
                routinen?.let { l -> "${l.size} Routinen" + (l.count { it.pausiert }.takeIf { it > 0 }?.let { " · $it pausiert" } ?: "") },
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (darf) IconButton(onClick = { neu = true }) { Icon(Icons.Filled.Add, "Neue Routine") }
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
            if (z.hub.zuNeu(SCHWARM_ROUTINEN)) item(key = "update") { UpdateHinweis("die Routinen") }
            if (z.alterStand) item(key = "stand") { StandHinweis(z, knapp = true) }
            if (routinen == null) {
                if (!z.hub.zuNeu(SCHWARM_ROUTINEN)) {
                    item(key = "leer") {
                        RuhigKarte(
                            Icons.Outlined.Schedule,
                            "Noch keine Routinen",
                            "Routinen sind Aufträge mit Zeitplan, etwa täglich das Backup prüfen. Leg die erste mit „+“ an; `!routine` zeigt die Liste des Hubs.",
                        )
                    }
                }
            } else {
                if (routinen.isEmpty()) {
                    item(key = "keine") { RuhigKarte(Icons.Outlined.Schedule, "Keine Routinen", "Leg die erste mit „+“ an.") }
                }
                items(routinen, key = { "r-" + it.name }) { r ->
                    RoutineKarte(
                        r, z, a, darf,
                        pausiert = gewuenscht[r.name] ?: r.pausiert,
                        wartet = gewuenscht.containsKey(r.name),
                        onSchalter = { aktiv ->
                            gewuenscht[r.name] = !aktiv
                            // Zieht das Event nicht nach (Befehl abgelehnt, Hub weg), gilt nach 60 s wieder der Stand des Hubs.
                            scope.launch {
                                delay(60_000)
                                if (gewuenscht[r.name] == !aktiv) gewuenscht.remove(r.name)
                            }
                            a.vm.befehl(
                                "!routine ${if (aktiv) "weiter" else "pause"} ${r.name}",
                                if (aktiv) "${r.name} läuft wieder nach Plan." else "${r.name} ist pausiert.",
                            )
                        },
                        onLoeschen = { loeschen = r },
                    )
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
    if (neu) {
        RoutineFormular(
            z,
            onSenden = { befehl, name -> a.vm.befehl(befehl, "Routine $name angelegt. Die Antwort des Hubs kommt in die Lobby."); neu = false },
            onSchliessen = { neu = false },
        )
    }
    loeschen?.let { r ->
        AlertDialog(
            onDismissRequest = { loeschen = null },
            icon = { Icon(Icons.Outlined.DeleteOutline, null) },
            title = { Text("Routine ${r.name} löschen?") },
            text = {
                Text(
                    reicherText(
                        "`!routine weg ${r.name}`: Die Routine läuft danach nicht mehr. Ihre bisherigen Aufträge bleiben im Board.",
                        MaterialTheme.colorScheme,
                    ),
                )
            },
            confirmButton = {
                Button(onClick = { a.vm.befehl("!routine weg ${r.name}", "!routine weg ${r.name} gesendet."); loeschen = null }) { Text("Löschen") }
            },
            dismissButton = { TextButton(onClick = { loeschen = null }) { Text("Behalten") } },
        )
    }
}

@Composable
private fun RoutineKarte(
    r: Routine,
    z: SchwarmZustand,
    a: Aktionen,
    darf: Boolean,
    pausiert: Boolean,
    wartet: Boolean,
    onSchalter: (Boolean) -> Unit,
    onLoeschen: () -> Unit,
) {
    val f = MaterialTheme.colorScheme
    KartenFlaeche(if (pausiert) f.outline else f.primary, onClick = null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(r.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    "${r.zeitplan} · @${r.agent}",
                    style = MaterialTheme.typography.labelMedium,
                    color = f.onSurfaceVariant,
                )
            }
            if (darf) {
                Switch(checked = !pausiert, onCheckedChange = onSchalter, enabled = !wartet)
            }
        }
        if (r.ziel.isNotBlank()) Text(r.ziel, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        r.fehler?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Warning, "Fehler", tint = StatusWarnung, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(it, style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant)
            }
        }
        Text(
            when {
                wartet -> if (pausiert) "Pause gesendet – wartet auf den Hub" else "Weiter gesendet – wartet auf den Hub"
                pausiert -> "⏸ pausiert"
                r.naechster != null -> "Nächster Lauf: ${zeitText(r.naechster)}"
                else -> "Nächster Lauf: unbekannt"
            },
            style = MaterialTheme.typography.bodySmall,
            color = if (pausiert && !wartet) f.onSurfaceVariant else f.onSurface,
        )
        r.letzter?.let { l ->
            val nummer = l.auftrag
            if (nummer != null) {
                AssistChip(
                    onClick = { a.auftragOeffnen(nummer) },
                    label = {
                        Text(
                            listOfNotNull("Zuletzt $nummer", l.zustand?.let { "${it.zeichen} ${it.titel}" }, l.zeit?.let { vorText(it) })
                                .joinToString(" · "),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    leadingIcon = { Icon(Icons.Outlined.TaskAlt, null, Modifier.size(18.dp)) },
                )
            }
        }
        if (darf) {
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(onClick = onLoeschen) {
                    Icon(Icons.Outlined.DeleteOutline, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Löschen")
                }
                OutlinedButton(
                    onClick = { a.vm.befehl("!routine jetzt ${r.name}", "${r.name} läuft jetzt einmal ausser der Reihe.") },
                ) {
                    Icon(Icons.Outlined.PlayArrow, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Jetzt")
                }
            }
        }
    }
}

/** Beispiele für den Zeitplan, wie der Hub sie liest. */
private val ZEITPLAENE = listOf("täglich 07:00", "werktags 06:30", "mo,do 06:30", "stündlich", "alle 30 min", "monatlich 1 05:00")

/** Wie im Hub: 2 bis 40 Zeichen, Kleinbuchstaben, Ziffern, Bindestrich. */
private val routinenName = Regex("""^[a-z0-9][a-z0-9-]{1,39}$""")

/**
 * `!routine neu <name> <zeitplan> @agent <ziel>`. Ein Zeitplan mit Leerzeichen kommt in
 * Anführungszeichen: `!routine neu backup "täglich 06:30" @betrieb …`.
 */
fun routineBefehl(name: String, zeitplan: String, agent: String, ziel: String): String {
    val plan = zeitplan.trim().replace(Regex("""\s+"""), " ")
    val teil = if (plan.contains(' ')) "\"$plan\"" else plan
    return "!routine neu ${name.trim()} $teil @$agent ${ziel.trim().replace(Regex("""\s+"""), " ")}"
}

@Composable
private fun RoutineFormular(z: SchwarmZustand, onSenden: (String, String) -> Unit, onSchliessen: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var zeitplan by remember { mutableStateOf("") }
    var ziel by remember { mutableStateOf("") }
    val agenten = (z.agenten.filter { it.nimmtAuftraege }.map { it.id } + "betrieb").distinct()
    var agent by remember { mutableStateOf(agenten.firstOrNull { it == "betrieb" } ?: agenten.firstOrNull()) }
    val nameOk = routinenName.matches(name)
    val planOk = zeitplan.isNotBlank() && '"' !in zeitplan
    val gueltig = nameOk && planOk && agent != null && ziel.isNotBlank()
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Neue Routine", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.lowercase().replace(' ', '-').take(40) },
                label = { Text("Name") },
                placeholder = { Text("z. B. backup") },
                supportingText = { Text("2 bis 40 Zeichen: Kleinbuchstaben, Ziffern, Bindestriche") },
                isError = name.isNotEmpty() && !nameOk,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = zeitplan,
                onValueChange = { zeitplan = it.take(60) },
                label = { Text("Zeitplan") },
                isError = zeitplan.isNotEmpty() && !planOk,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ZEITPLAENE.forEach { p -> SuggestionChip(onClick = { zeitplan = p }, label = { Text(p) }) }
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                agenten.forEach { id ->
                    FilterChip(selected = id == agent, onClick = { agent = id }, label = { Text(z.agent(id)?.name ?: id) })
                }
            }
            OutlinedTextField(
                value = ziel,
                onValueChange = { ziel = it },
                label = { Text("Ziel") },
                placeholder = { Text("Was soll jedes Mal passieren?") },
                minLines = 2,
                maxLines = 6,
                modifier = Modifier.fillMaxWidth(),
            )
            if (gueltig) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainerHighest, shape = RoundedCornerShape(10.dp)) {
                    Text(
                        routineBefehl(name, zeitplan, agent ?: "", ziel),
                        style = Mono,
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onSchliessen) { Text("Abbrechen") }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = { agent?.let { onSenden(routineBefehl(name, zeitplan, it, ziel), name) } },
                    enabled = gueltig,
                ) { Text("Anlegen") }
            }
        }
    }
}

