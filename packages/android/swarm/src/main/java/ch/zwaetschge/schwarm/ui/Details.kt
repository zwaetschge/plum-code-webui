@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package com.claudewebui.swarm.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.BuildConfig
import com.claudewebui.swarm.data.Agent
import com.claudewebui.swarm.data.Auftrag
import com.claudewebui.swarm.data.Entscheidung
import com.claudewebui.swarm.data.Freigabe
import com.claudewebui.swarm.data.Lebenslauf
import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Zustand
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton

// ── Auftrag ─────────────────────────────────────────────────────────────────

@Composable
fun AuftragAnsicht(id: String, z: SchwarmZustand, a: Aktionen, zurueck: (() -> Unit)?) {
    val auftrag = z.auftrag(id)
    val agent = z.agent(auftrag?.zustaendig)
    val raum = auftrag?.raumId
    val wurzel = auftrag?.threadWurzel
    var abbrechenFrage by remember { mutableStateOf(false) }

    LaunchedEffect(raum, wurzel) {
        if (raum != null && wurzel != null) a.vm.threadLaden(raum, wurzel)
    }

    Scaffold(
        topBar = {
            SchwarmLeiste(
                titel = id,
                untertitel = auftrag?.let { "${it.zustand.zeichen} ${it.zustand.titel} · ${agent?.name ?: it.zustaendig}" },
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (a.rolle.darf("stand")) {
                    IconButton(onClick = { a.befehlUndLobby("!stand $id") }) { Icon(Icons.Outlined.Info, "Stand im Hub abfragen") }
                }
                if (a.breit && zurueck != null) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        if (auftrag == null) {
            Box(Modifier.padding(top = pad.calculateTopPadding())) {
                LeerHinweis(Icons.Outlined.TaskAlt, "$id ist nicht im Board", "Vielleicht ist er älter als der geladene Verlauf. `!stand $id` fragt den Hub.")
            }
            return@Scaffold
        }
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            val verlauf = z.verlauf(raum)
            val thread = verlauf.nachrichten.filter { it.eventId == wurzel || it.threadWurzel == wurzel }
            // Wer den Thread offen hat, hat ihn gelesen (App 2.1).
            LaunchedEffect(raum, wurzel, thread.lastOrNull()?.eventId) {
                if (raum != null && wurzel != null) a.vm.gelesen(raum, wurzel)
            }
            NachrichtenListe(
                verlauf,
                Modifier.weight(1f),
                nachrichten = if (wurzel == null) emptyList() else thread,
                onReaktion = if (raum != null && a.rolle.entscheidet) ({ n, zeichen -> a.vm.reagieren(raum, n.eventId, zeichen, null) }) else null,
                onAuftrag = a.auftragOeffnen,
                aktuellerAuftrag = id,
                kopf = {
                    AuftragKopf(
                        auftrag, agent, a, z.freigabeFuer(id), z.karte(auftrag), z.offenerPlan(id),
                        onAbbrechen = { abbrechenFrage = true },
                        onSignal = { zeichen, text -> if (raum != null && wurzel != null) a.vm.reagieren(raum, wurzel, zeichen, text) },
                    )
                },
                zusatz = { n -> NachrichtZusatz(n, z, a) },
                a = a,
            )
            when {
                // Native Bots lesen den Thread selbst; einem Worker reicht der Hub die Antwort weiter („ja, aber
                // ohne Neustart“ auf einen Plan). Ein Gast antwortet nur auf eigene Aufträge.
                raum != null && wurzel != null && auftrag.zustand.offen &&
                    (agent?.direktAnsprechbar == true || agent?.modus == "worker") &&
                    (a.rolle.istVale || auftrag.von == z.ich) -> Eingabe(
                    hinweis = if (agent?.direktAnsprechbar == true) "Antwort an ${agent.name} im Thread"
                    else "Antwort an ${agent?.name ?: auftrag.zustaendig} (über den Hub)",
                    onSenden = { a.vm.schreiben(raum, it, wurzel, emptyList()) },
                    // Dateien nur, wo der Bot den Thread selbst liest; ein Worker bekäme sie über den Hub nicht.
                    anhang = if (agent?.direktAnsprechbar == true) {
                        { an, text, zurueckholen -> a.vm.anhangSenden(raum, an, text, wurzel, emptyList(), onFehler = zurueckholen) }
                    } else {
                        null
                    },
                    vm = a.vm,
                    sendet = a.vm.sendet.collectAsStateWithLifecycle().value,
                )
                raum != null && wurzel != null -> Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
                else -> Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            }
        }
    }

    if (abbrechenFrage && raum != null && wurzel != null) {
        AlertDialog(
            onDismissRequest = { abbrechenFrage = false },
            icon = { Icon(Icons.Outlined.StopCircle, null) },
            title = { Text("$id abbrechen?") },
            text = { Text(reicherText("🛑 auf der Karte: Der Hub setzt den Auftrag auf „abgebrochen“ und schickt dem Bot `/stop`.", MaterialTheme.colorScheme)) },
            confirmButton = {
                Button(onClick = {
                    a.vm.reagieren(raum, wurzel, "🛑", "🛑 gesendet – der Hub bricht $id ab.")
                    abbrechenFrage = false
                }) { Text("Abbrechen") }
            },
            dismissButton = { TextButton(onClick = { abbrechenFrage = false }) { Text("Weiterlaufen lassen") } },
        )
    }
}

@Composable
private fun AuftragKopf(
    t: Auftrag,
    agent: Agent?,
    a: Aktionen,
    freigabe: Freigabe?,
    karte: Nachricht?,
    plan: Entscheidung?,
    onAbbrechen: () -> Unit,
    onSignal: (String, String) -> Unit,
) {
    val f = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = f.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ZustandChip(t.zustand)
                Spacer(Modifier.weight(1f))
                Text(vorText(t.aktualisiert), style = MaterialTheme.typography.labelSmall, color = f.outline, maxLines = 1)
            }
            Text(t.ziel.ifBlank { "(ohne Ziel)" }, style = MaterialTheme.typography.titleMedium)
            Feld("Zuständig", listOfNotNull(agent?.name ?: t.zustaendig, agent?.let { "${it.level} · ${it.trust}" }).joinToString(" · "))
            t.ergebnis?.let { Feld("Ergebnis", it) }
            if (t.grenzen.isNotEmpty()) Feld("Grenzen", t.grenzen.joinToString(", "))
            t.budget?.let { Feld("Budget", it) }
            t.frist?.let { Feld("Frist", it) }
            t.hop?.let { Feld("Kette", "Hop $it von 4" + (t.eltern?.let { e -> " · Eltern-Auftrag $e" } ?: "")) }
            t.hinweis?.let { Feld("Hinweis", it) }
            if (t.zustand == Zustand.FREIGABE && a.rolle.entscheidet) FreigabeImAuftrag(freigabe, a)
            // Ein Plan wartet: Er steht unten im Thread, mit ✅ und ❌ (Punkt 8).
            if (plan != null && a.rolle.entscheidet) {
                Text(
                    "📋 ${agent?.name ?: t.zustaendig} schickt zuerst einen Plan. Er steht unten im Thread: ✅ nimmt ihn an, ❌ lehnt ab, oder antworte im Thread.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = f.onSurfaceVariant,
                )
            }
            // Bewertung abgeschlossener Aufträge: 👍/👎 auf die Karte, zählt ins Agentenprofil (Punkt 14).
            if (a.rolle.entscheidet && karte != null && (t.zustand == Zustand.FERTIG || t.zustand == Zustand.FEHLGESCHLAGEN)) {
                Bewertung(t, karte, a)
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            val signaleMoeglich = t.raumId != null && t.threadWurzel != null
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (t.zustand.offen && a.rolle.entscheidet) {
                    AssistChip(
                        onClick = onAbbrechen,
                        enabled = signaleMoeglich,
                        label = { Text("Abbrechen") },
                        leadingIcon = { Icon(Icons.Outlined.StopCircle, null, Modifier.size(18.dp)) },
                    )
                    AssistChip(
                        onClick = { onSignal("⬆️", "⬆️ gesendet – ${t.id} rückt vor.") },
                        enabled = signaleMoeglich,
                        label = { Text("Vorziehen") },
                        leadingIcon = { Icon(Icons.Outlined.ArrowUpward, null, Modifier.size(18.dp)) },
                    )
                }
                if ((t.zustand == Zustand.FEHLGESCHLAGEN || t.zustand == Zustand.ABGEBROCHEN) && a.rolle.entscheidet) {
                    AssistChip(
                        onClick = { onSignal("🔁", "🔁 gesendet – ${t.id} bekommt einen neuen Versuch.") },
                        enabled = signaleMoeglich,
                        label = { Text("Neuer Versuch") },
                        leadingIcon = { Icon(Icons.Outlined.Replay, null, Modifier.size(18.dp)) },
                    )
                }
                freigabe?.takeIf { a.rolle.entscheidet }?.let { fr ->
                    AssistChip(
                        onClick = { a.meldungOeffnen(fr.raumId, fr.eventId) },
                        label = { Text("Freigabe") },
                        leadingIcon = { Icon(Icons.Outlined.VerifiedUser, null, Modifier.size(18.dp)) },
                    )
                }
                t.raumId?.let { r ->
                    AssistChip(
                        onClick = { a.raumOeffnen(r, "ag-${t.zustaendig}", t.zustaendig) },
                        label = { Text("Raum") },
                        leadingIcon = { Icon(Icons.Outlined.Forum, null, Modifier.size(18.dp)) },
                    )
                }
                // Vom Auftrag zum Chat (App 2.5): Ziel, Stand und Ergebnis stehen schon im neuen Chat mit Brian.
                if (a.rolle.istVale) {
                    AssistChip(
                        onClick = { a.vm.teilen(mitBrianBesprechen(t, agent), null) },
                        label = { Text("Mit Brian besprechen") },
                        leadingIcon = { Icon(Icons.Outlined.QuestionAnswer, null, Modifier.size(18.dp)) },
                    )
                }
                if (!signaleMoeglich) {
                    val raum = agent?.raumId
                    if (raum != null) {
                        AssistChip(
                            onClick = { a.vm.karteSuchen(t.id, raum) },
                            label = { Text("Karte suchen") },
                            leadingIcon = { Icon(Icons.Outlined.Search, null, Modifier.size(18.dp)) },
                        )
                    }
                }
            }
            if (!signaleMoeglich) {
                Text(
                    "Die Karte dieses Auftrags ist noch nicht geladen. „Karte suchen“ blättert im Arbeitsraum zurück.",
                    style = MaterialTheme.typography.bodySmall,
                    color = f.onSurfaceVariant,
                )
            }
        }
    }
}

/** Der Anfang eines Chats mit Brian über einen Auftrag: Ziel, Stand, Ergebnis; die Frage schreibst du dazu. */
private fun mitBrianBesprechen(t: Auftrag, agent: Agent?): String = buildString {
    append("Zu Auftrag ${t.id} an ${agent?.name ?: t.zustaendig} (${t.zustand.titel}):\n")
    append("Ziel: ${t.ziel.trim().take(800)}\n")
    t.hinweis?.let { append("Stand: ${it.trim().take(400)}\n") }
    t.ergebnis?.let { append("Ergebnis: ${it.trim().take(800)}\n") }
    append("\nMeine Frage: ")
}

/**
 * Wartet der Auftrag auf deine Freigabe, entscheidest du gleich hier, mit derselben Rückfrage
 * wie in den Meldungen. Ohne geladene Notice geht es zu den Freigaben.
 */
@Composable
private fun FreigabeImAuftrag(f: Freigabe?, a: Aktionen) {
    val jetzt = jetztBisFrist(listOfNotNull(f?.ablauf))
    when {
        f != null && f.offenUm(jetzt) -> Surface(
            color = Warnorange.copy(alpha = 0.10f),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Wartet auf deine Freigabe", style = MaterialTheme.typography.titleSmall, color = Warnorange)
                Countdown(f.ablauf)
                FreigabeKnoepfe(f, a)
            }
        }
        f != null -> {
            val zustand = f.zustandUm(jetzt)
            Text(
                freigabeQuittung(f, zustand),
                style = MaterialTheme.typography.bodyMedium,
                color = freigabeFarbe(zustand, MaterialTheme.colorScheme),
            )
        }
        else -> Column {
            Text(
                "Diese Übergabe wartet auf deine Freigabe. Die Anfrage steht in #schwarm-freigaben.",
                color = Warnorange,
                style = MaterialTheme.typography.bodyMedium,
            )
            TextButton(onClick = { a.meldungenOeffnen(Kanal.FREIGABEN) }) { Text("Zu den Freigaben") }
        }
    }
}

/**
 * 👍 und 👎 auf die Auftragskarte. Es gilt eine Bewertung; die andere nimmt die App zurück, und ein
 * zweiter Tipp auf dieselbe nimmt sie ganz zurück. Der Hub zählt sie auch nachträglich.
 */
@Composable
private fun Bewertung(t: Auftrag, karte: Nachricht, a: Aktionen) {
    val unterwegs by a.vm.unterwegs.collectAsStateWithLifecycle()
    val meine = karte.eigeneReaktionen.map(Lebenslauf::zeichen).toSet()
    val laeuft = "${karte.eventId}|bewertung" in unterwegs
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Wie war das Ergebnis?",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        listOf("👍" to "Gut", "👎" to "Schlecht").forEach { (zeichen, titel) ->
            val gewaehlt = zeichen in meine
            FilterChip(
                selected = gewaehlt,
                onClick = { a.vm.bewerten(t, karte, zeichen) },
                enabled = !laeuft,
                label = { Text(titel) },
                leadingIcon = {
                    Icon(
                        when {
                            zeichen == "👍" && gewaehlt -> Icons.Filled.ThumbUp
                            zeichen == "👍" -> Icons.Outlined.ThumbUp
                            gewaehlt -> Icons.Filled.ThumbDown
                            else -> Icons.Outlined.ThumbDown
                        },
                        null,
                        Modifier.size(18.dp),
                    )
                },
                modifier = Modifier.padding(start = 6.dp),
            )
        }
    }
}

/** Beschriftung über dem Wert, wie in der Auftragskarte. */
@Composable
fun Feld(titel: String, wert: String) {
    Column {
        Text(titel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(reicherText(wert, MaterialTheme.colorScheme), style = MaterialTheme.typography.bodyMedium)
    }
}

// ── Raum ────────────────────────────────────────────────────────────────────

@Composable
fun RaumAnsicht(raumId: String, titel: String, agentId: String?, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val agent = z.agent(agentId)
    val beigetreten = raumId in z.beigetreten
    // Der Trenner „Neu“ bleibt, wo er beim Öffnen war.
    val neuAb = remember(raumId) { z.ungelesen[raumId]?.takeIf { it.anzahl > 0 }?.gelesenBis }
    val sendet by a.vm.sendet.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            SchwarmLeiste(
                titel = agent?.name ?: "#$titel",
                untertitel = if (agent != null) "#$titel · ${agent.status.titel}" else null,
                zurueck = if (a.zurueckPfeil) zurueck else null,
                onTitel = a.schnellwahl,
            ) {
                // Die Seite des Agenten: Modell, Stimme, Aufträge, Pause (App 2.4).
                if (agentId != null) {
                    IconButton(onClick = { a.oeffnen(Detail.AgentD(agentId)) }) { Icon(Icons.Outlined.Info, "Über ${agent?.name ?: agentId}") }
                }
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            if (!beigetreten) {
                Box(Modifier.weight(1f)) {
                    LeerHinweis(Icons.Outlined.Forum, "Nicht beigetreten", "Tritt dem Raum bei (Räume → Allen beitreten).")
                }
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
                return@Scaffold
            }
            NachrichtenListe(
                z.verlauf(raumId),
                Modifier.weight(1f),
                onAeltere = { a.vm.aeltereLaden(raumId) },
                onReaktion = if (a.rolle.entscheidet) ({ n, zeichen -> a.vm.reagieren(raumId, n.eventId, zeichen, null) }) else null,
                onAuftrag = a.auftragOeffnen,
                zusatz = { n -> NachrichtZusatz(n, z, a) },
                neuAb = neuAb,
                onUnten = { a.vm.gelesen(raumId) },
                a = a,
            )
            when {
                agent?.direktAnsprechbar == true -> Eingabe(
                    hinweis = "Direkt an ${agent.name} (mit Erwähnung)",
                    onSenden = { a.vm.schreiben(raumId, it, null, listOf(agent.mxid)) },
                    // Dateien aller Art, mit Erwähnung, damit der Bot sie liest (App 2.2).
                    anhang = { an, text, zurueckholen ->
                        a.vm.anhangSenden(raumId, an, text, null, listOf(agent.mxid), onFehler = zurueckholen)
                    },
                    vm = a.vm,
                    sendet = sendet,
                )
                // Ein Worker liest seinen Raum nicht selbst: Was du hier schreibst, wird ein Auftrag an ihn (App 2.4).
                // Antworten auf Rückfragen gehen im Thread der Karte, also über „Auftrag öffnen“.
                agent != null && agent.nimmtAuftraege && a.rolle.darfAuftragAn(agent.id) -> Eingabe(
                    hinweis = "Neuer Auftrag an ${agent.name} …",
                    onSenden = { a.vm.auftrag(agent.id, it) },
                    sendet = sendet,
                )
                agent != null -> Surface(color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (agent.nimmtAuftraege) "Aufträge an ${agent.name} gibt nur Vale."
                        else "${agent.name} ist ein Melder: Er schreibt nur Meldungen und nimmt keine Aufträge.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(14.dp),
                    )
                }
                else -> Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            }
        }
    }
}

// ── Sofort-Benachrichtigungen (App 2.5) ────────────────────────────────────

/**
 * Push über einen Verteiler wie ntfy: Der Hub weckt die App, sobald etwas auf dich wartet, statt dass sie alle
 * 15 min nachschaut. Die Adresse geht signiert mit dem Not-Aus-Schlüssel an den Hub.
 */
@Composable
private fun SofortEinstellungen(vm: SchwarmViewModel, z: SchwarmZustand) {
    val f = MaterialTheme.colorScheme
    val kontext = LocalContext.current
    val push by vm.push.collectAsStateWithLifecycle()
    val laeuft by vm.pushLaeuft.collectAsStateWithLifecycle()
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    val verteiler = remember { vm.pushVerteiler() }
    val amHub = z.hub.notaus?.geraete?.firstOrNull { it.id == notAus.geraetId }?.push
    Abschnitt("Sofort-Benachrichtigungen", Modifier.padding(horizontal = 12.dp))
    val (text, farbe) = when {
        verteiler.isEmpty() -> "Keine Push-App installiert. Mit ntfy (F-Droid oder Play Store) meldet sich die App in Sekunden, " +
            "sonst alle 15 min." to f.onSurfaceVariant
        push.endpoint == null -> ("Aus: Die App prüft alle 15 min." + (push.fehler?.let { " $it" } ?: "")) to f.onSurfaceVariant
        amHub == null -> "Beim Verteiler angemeldet, beim Hub noch nicht. „Einrichten“ holt das nach." to StatusWarnung
        amHub.fehler != null -> "Der Hub meldet: ${amHub.fehler}" to f.error
        else -> buildString {
            append("An über ${amHub.host}.")
            amHub.ok?.let { append(" Zuletzt zugestellt ${zeitText(it)}.") }
            push.geweckt?.let { append(" Zuletzt geweckt ${zeitText(it)}.") }
        } to f.onSurface
    }
    ListItem(
        headlineContent = { Text(if (push.endpoint != null && amHub != null && amHub.fehler == null) "Aktiv" else "Status") },
        supportingContent = { Text(text, color = farbe) },
        trailingContent = { if (laeuft) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) },
    )
    if (verteiler.isNotEmpty() && (z.rolle.istVale)) {
        FlowRow(
            Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { vm.pushEinrichten(kontext) }, enabled = !laeuft) {
                Text(if (push.endpoint == null) "Einrichten" else "Neu einrichten")
            }
            if (push.endpoint != null) {
                OutlinedButton(onClick = { vm.pushTesten(kontext) }, enabled = !laeuft) { Text("Testen") }
                TextButton(onClick = { vm.pushAus(kontext) }, enabled = !laeuft) { Text("Ausschalten") }
            }
        }
        Text(
            "Braucht das angemeldete Not-Aus-Gerät unten. Über ${verteiler.first().second} kommt nur ein Weckruf ohne Inhalt; " +
                "was neu ist, holt die App selbst über Matrix.",
            style = MaterialTheme.typography.bodySmall,
            color = f.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        )
    }
}

/** App-Sperre (App 2.7) und Screenshots blockieren (Punkt 5, App 2.8): nur mit Displaysperre möglich. */
@Composable
private fun SperreEinstellung(vm: SchwarmViewModel) {
    val kontext = LocalContext.current
    val moeglich = remember { Biometrie.eingerichtet(kontext) }
    var an by remember { mutableStateOf(vm.appSperre) }
    val ganz by vm.screenshotsSperren.collectAsStateWithLifecycle()
    Abschnitt("App-Sperre", Modifier.padding(horizontal = 12.dp))
    ListItem(
        headlineContent = { Text("Mit Fingerabdruck sperren") },
        supportingContent = {
            Text(
                if (moeglich) "Beim Öffnen und nach 5 min im Hintergrund fragt die App nach Fingerabdruck oder Gerätesperre."
                else "Geht erst mit einer Displaysperre auf dem Gerät.",
            )
        },
        trailingContent = { Switch(checked = an && moeglich, enabled = moeglich, onCheckedChange = { an = it; vm.appSperre = it }) },
    )
    ListItem(
        headlineContent = { Text("Screenshots in der ganzen App blockieren") },
        supportingContent = {
            Text(
                "Freigaben, Aufträge und der Not-Aus sind immer geschützt. Mit diesem Schalter zusätzlich " +
                    "jeder andere Bildschirm: kein Screenshot und keine Vorschau in den letzten Apps.",
            )
        },
        trailingContent = { Switch(checked = ganz, onCheckedChange = vm::screenshotsSperrenSetzen) },
    )
    ListItem(
        headlineContent = { Text("Abstürze melden") },
        supportingContent = {
            Text(
                "Nach einem Absturz schickt die App beim nächsten Start eine Zeile nach #schwarm-log: " +
                    "Version, Art der Ausnahme und wo. Keine Nachrichten, keine IDs, keine Tokens.",
            )
        },
    )
}

// ── Einstellungen ───────────────────────────────────────────────────────────

@Composable
fun EinstellungenAnsicht(vm: SchwarmViewModel, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val sitzung = vm.sitzung.value
    val kontext = LocalContext.current
    var melden by remember { mutableStateOf(vm.benachrichtigungen) }
    var abmeldenFrage by remember { mutableStateOf(false) }
    var erlaubt by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(kontext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val anfrage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { erlaubt = it }

    val vorschau by vm.vorschau.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            SchwarmLeiste("Einstellungen", sitzung?.userId, zurueck = if (a.zurueckPfeil) zurueck else null) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(top = pad.calculateTopPadding())
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Abschnitt("Konto", Modifier.padding(horizontal = 12.dp))
            ListItem(headlineContent = { Text(sitzung?.userId ?: "–") }, supportingContent = { Text("Gerät ${sitzung?.deviceId ?: "–"}") })
            ListItem(headlineContent = { Text("Server") }, supportingContent = { Text(sitzung?.homeserver ?: "–") })
            ListItem(
                headlineContent = { Text("Verbindung") },
                supportingContent = { Text(verbindungText(z) + (z.fehler?.let { " · $it" } ?: "")) },
            )
            HorizontalDivider()
            if (a.rolle.istVale) {
                // Modelle und Stimmen stehen seit App 2.4 auf der Seite jedes Agenten im Bereich „Schwarm“.
                val vorlesenAn by vm.antwortenVorlesen.collectAsStateWithLifecycle()
                Abschnitt("Vorlesen", Modifier.padding(horizontal = 12.dp))
                ListItem(
                    headlineContent = { Text("Brians Antworten vorlesen") },
                    supportingContent = {
                        Text("Im Chat liest die App Brians Schlussantworten vor, solange sie vorne ist. Die Stimme wählst du unter Schwarm → Brian.")
                    },
                    trailingContent = { Switch(checked = vorlesenAn, onCheckedChange = { vm.antwortenVorlesenSetzen(it) }) },
                )
                HorizontalDivider()
            }
            Abschnitt("Benachrichtigungen", Modifier.padding(horizontal = 12.dp))
            ListItem(
                headlineContent = { Text("Im Hintergrund prüfen") },
                supportingContent = {
                    Text(
                        "Alle 15 min, mit Sofort-Benachrichtigungen gleich: Rückfragen, Freigaben, Ergebnisse, Alarme und " +
                            "Brians Antworten in Allgemein. Eine Freigabe gibst du auch direkt aus der Benachrichtigung, " +
                            "mit Fingerabdruck; Ablehnen geht ohne. Dringendes kommt zusätzlich über ntfy.",
                    )
                },
                trailingContent = { Switch(checked = melden, onCheckedChange = { melden = it; vm.benachrichtigungen = it }) },
            )
            if (!erlaubt && Build.VERSION.SDK_INT >= 33) {
                ListItem(
                    headlineContent = { Text("Benachrichtigungen sind nicht erlaubt") },
                    supportingContent = { Text("Ohne diese Erlaubnis bleibt die Hintergrundprüfung stumm.") },
                    trailingContent = {
                        TextButton(onClick = { anfrage.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Erlauben") }
                    },
                )
            }
            if (z.rolle.istVale) {
                HorizontalDivider()
                RuheEinstellung(vm, z)
                HorizontalDivider()
                SofortEinstellungen(vm, z)
                ListItem(
                    headlineContent = { Text("Diagnose") },
                    supportingContent = { Text("Kommt nichts an? Die ganze Kette Glied für Glied, mit Test-Weckruf und Laufzeit.") },
                    modifier = Modifier.clickable { a.oeffnen(Detail.DiagnoseD) },
                )
                ListItem(
                    headlineContent = { Text("Einrichtung") },
                    supportingContent = { Text("Was noch fehlt: Räume, ntfy, Not-Aus-Gerät, Worker, Plum.") },
                    modifier = Modifier.clickable { a.oeffnen(Detail.EinrichtungD) },
                )
                HorizontalDivider()
                SperreEinstellung(vm)
                HorizontalDivider()
                NotAusEinstellungen(vm, z)
            }
            if (vorschau) {
                HorizontalDivider()
                VorschauEinstellungen(vm)
            }
            HorizontalDivider()
            Abschnitt("App", Modifier.padding(horizontal = 12.dp))
            ListItem(
                headlineContent = { Text("Schwarm ${BuildConfig.VERSION_NAME}") },
                supportingContent = {
                    Text(
                        "Spricht Matrix direkt mit deinem Konto. Räume: #schwarm-*, #ag-* und Allgemein " +
                            "(dein Chat mit Brian, gemerkt in den Account-Daten ch.zwaetschge.schwarm.allgemein).",
                    )
                },
            )
            Row(Modifier.padding(16.dp)) {
                Button(onClick = { abmeldenFrage = true }) {
                    Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Abmelden")
                }
            }
        }
    }
    if (abmeldenFrage) {
        AlertDialog(
            onDismissRequest = { abmeldenFrage = false },
            title = { Text("Abmelden?") },
            text = { Text("Die Sitzung endet auch auf dem Server; das Token auf dem Gerät wird gelöscht.") },
            confirmButton = { Button(onClick = { abmeldenFrage = false; vm.abmelden() }) { Text("Abmelden") } },
            dismissButton = { TextButton(onClick = { abmeldenFrage = false }) { Text("Bleiben") } },
        )
    }
}
