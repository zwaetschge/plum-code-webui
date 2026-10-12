@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Agent
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.AppRelease
import com.claudewebui.swarm.data.AppUpdate
import com.claudewebui.swarm.data.EinheitZustand
import com.claudewebui.swarm.data.SCHWARM_ROUTINEN
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.UpdateStand

/*
 * Der Bereich „Schwarm“ (App 2.4): alles über den Schwarm als Ganzes an einem Ort. Oben der Not-Aus, dann
 * die Agenten mit Modell und Stand – ein Tipp öffnet ihre Seite mit Modell, Stimme, Aufträgen und Pause –,
 * der Abo-Stand, die Werkzeuge, die Stimme des Hubs und die Einstellungen der App. Vorher lag das verteilt
 * über Übersicht, Einstellungen und „Agenten und Modelle“.
 */

fun schwarmUntertitel(z: SchwarmZustand): String {
    val mitAuftrag = z.agenten.filter { it.nimmtAuftraege }
    if (mitAuftrag.isEmpty()) return verbindungText(z)
    return "${mitAuftrag.size} Agenten · ${mitAuftrag.count { it.status == AgentStatus.ONLINE }} online"
}

@Composable
fun SchwarmAnsicht(z: SchwarmZustand, a: Aktionen) {
    val vorlagen by a.vm.vorlagen.collectAsStateWithLifecycle()
    var stimmeHub by rememberSaveable { mutableStateOf(false) }
    val mitAuftrag = z.agenten.filter { it.nimmtAuftraege }.sortedBy { it.name.lowercase() }
    val melder = z.agenten.filter { !it.nimmtAuftraege }.sortedBy { it.name.lowercase() }
    // Agenten, die nur der Hub kennt (ein Modell-Stand ohne Agent Card), stehen bei den Agenten dabei.
    val nurHub = z.hub.modelle.keys.filter { id -> z.agent(id) == null }.sorted()
    val gewaehlt = (a.offen as? Detail.AgentD)?.id
    val jetzt = System.currentTimeMillis()
    Scaffold(
        topBar = {
            SchwarmLeiste("Schwarm", schwarmUntertitel(z)) {
                IconButton(onClick = a.einstellungen) { Icon(Icons.Outlined.Settings, "Einstellungen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = pad.calculateTopPadding() + 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (z.hub.neuereVersion.isNotEmpty()) item(key = "update") { UpdateHinweis(teileText(z.hub.neuereVersion)) }
            if (z.alterStand) item(key = "stand") { StandHinweis(z, knapp = true) }
            if (z.rolle.istVale) item(key = "notaus") { NotAusKarte(a) }

            item(key = "agenten-titel") { Abschnitt("Agenten") }
            if (mitAuftrag.isEmpty() && nurHub.isEmpty()) {
                item(key = "agenten-leer") {
                    Text(
                        "Noch keine Agenten sichtbar. Ihre Karten stehen in der Lobby: Tritt ihr bei (Räume → Allen beitreten).",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
            } else {
                item(key = "agenten") {
                    Gruppe {
                        mitAuftrag.forEachIndexed { i, ag ->
                            if (i > 0) Trenner()
                            AgentZeile(ag.id, ag.name, if (pausiert(z, ag.id)) AgentStatus.PAUSIERT else ag.status,
                                agentZeile(z, ag.id, ag), ag.id == gewaehlt) { a.oeffnen(Detail.AgentD(ag.id)) }
                        }
                        nurHub.forEachIndexed { i, id ->
                            if (i > 0 || mitAuftrag.isNotEmpty()) Trenner()
                            AgentZeile(id, id, null, agentZeile(z, id, null), id == gewaehlt) { a.oeffnen(Detail.AgentD(id)) }
                        }
                    }
                }
            }
            if (melder.isNotEmpty()) {
                item(key = "melder-titel") { Abschnitt("Melder") }
                item(key = "melder") {
                    Gruppe {
                        melder.forEachIndexed { i, ag ->
                            if (i > 0) Trenner()
                            AgentZeile(ag.id, ag.name, ag.status, agentZeile(z, ag.id, ag), ag.id == gewaehlt, kompakt = true) {
                                a.oeffnen(Detail.AgentD(ag.id))
                            }
                        }
                    }
                }
            }
            z.hub.kontingente?.let { k -> item(key = "abo") { AboKarte(k, z) } }

            item(key = "werkzeuge-titel") { Abschnitt("Werkzeuge") }
            item(key = "werkzeuge") {
                val zeilen = werkzeuge(z, a, vorlagen.size, vorlagen.count { it.favorit }, jetzt)
                Gruppe {
                    zeilen.forEachIndexed { i, w ->
                        if (i > 0) Trenner()
                        WerkzeugZeile(w.icon, w.titel, w.text, w.warnung, w.klick)
                    }
                }
            }

            if (z.rolle.istVale) {
                item(key = "hub-titel") { Abschnitt("Hub") }
                z.hub.release?.let { r -> item(key = "release") { ReleaseZeile(r) } }
                item(key = "hub") { HubStimmeKarte(z, a) { stimmeHub = true } }
            }
            item(key = "app-titel") { Abschnitt("App") }
            a.vm.neueVersion(z)?.let { r -> item(key = "app-update") { AppUpdateKarte(r, a) } }
            item(key = "app") {
                Gruppe {
                    WerkzeugZeile(
                        Icons.Outlined.Settings, "Einstellungen",
                        "Benachrichtigungen, Vorlesen, Not-Aus-Gerät, Konto", false, a.einstellungen,
                    )
                    Trenner()
                    AppVersionZeile(a)
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
    if (stimmeHub) StimmenBlatt("hub", z, a) { stimmeHub = false }
}

private class Werkzeug(val icon: ImageVector, val titel: String, val text: String, val warnung: Boolean, val klick: () -> Unit)

/** Plum, Routinen, Türsteher, Vorlagen, Verlauf, Befehle und Lobby, je nach Rolle. */
private fun werkzeuge(z: SchwarmZustand, a: Aktionen, vorlagen: Int, favoriten: Int, jetzt: Long): List<Werkzeug> = buildList {
    val plum = z.hub.einheiten["plum"]
    if (plum != null || z.agent("plum") != null) {
        val wartet = plum?.eintraege?.count { it.zustand == EinheitZustand.WARTET } ?: 0
        add(Werkzeug(
            Icons.Outlined.Laptop, "Plum-Sitzungen",
            when {
                plum == null -> "noch kein Stand"
                wartet > 0 -> "${plum.eintraege.size} Sitzungen · $wartet wartet"
                else -> "${plum.eintraege.size} Sitzungen"
            },
            plum?.veraltetUm(jetzt) == true || wartet > 0,
        ) { a.oeffnen(Detail.EinheitenD("plum")) })
    }
    if (z.rolle.istVale || z.rolle.darf("routine")) {
        val r = z.hub.routinen
        add(Werkzeug(
            Icons.Outlined.Schedule, "Routinen",
            when {
                z.hub.zuNeu(SCHWARM_ROUTINEN) -> "App aktualisieren"
                r == null -> "noch keine"
                r.any { it.pausiert } -> "${r.size} · ${r.count { it.pausiert }} pausiert"
                else -> "${r.size} aktiv"
            },
            z.hub.zuNeu(SCHWARM_ROUTINEN),
        ) { a.oeffnen(Detail.RoutinenD) })
    }
    if (z.rolle.istVale || z.rolle.darf("sperren")) {
        val t = z.hub.tuersteher
        add(Werkzeug(
            Icons.Outlined.Shield, "Türsteher",
            when {
                t == null -> "noch kein Stand"
                t.veraltet -> "steht still"
                else -> "${t.gesperrt} gesperrt"
            },
            t?.veraltet == true,
        ) { a.oeffnen(Detail.TuersteherD) })
    }
    if (z.rolle.darf("auftrag")) {
        add(Werkzeug(
            Icons.Outlined.Bookmarks, "Vorlagen",
            if (vorlagen == 0) "noch keine" else "$vorlagen · $favoriten Favoriten",
            false,
        ) { a.oeffnen(Detail.VorlagenD) })
    }
    if (z.rolle.istVale) {
        val l = z.hub.litellm
        add(Werkzeug(
            Icons.Outlined.Psychology, "LiteLLM",
            when {
                l == null -> "noch kein Stand"
                !l.erreichbar -> "nicht erreichbar"
                else -> "${l.modelle.size} Modelle · ${"%.2f".format((l.ausgabenCent ?: 0) / 100.0)} von ${"%.2f".format((l.budgetCent ?: 0) / 100.0)} USD"
            },
            l != null && (!l.erreichbar || (l.anteil ?: 0f) >= 0.9f),
        ) { a.oeffnen(Detail.LiteLlmD) })
    }
    if (z.rolle.istVale && z.agent("betrieb") != null) {
        add(Werkzeug(Icons.Outlined.Dns, "Betrieb", "Container, Logs und Neustart über den Worker betrieb", false) { a.oeffnen(Detail.BetriebD) })
    }
    val woche = z.hub.kennzahlen["woche"]
    add(Werkzeug(
        Icons.Outlined.Insights, "Verlauf und Kennzahlen",
        woche?.let { w -> "${w.tage.sumOf { it.auftraege }} Aufträge in 7 Tagen" } ?: "noch keine Zahlen",
        false,
    ) { a.oeffnen(Detail.KennzahlenD) })
    add(Werkzeug(Icons.Outlined.Terminal, "Befehle an den Hub", "Palette mit Suche, geht in die Lobby", false, a.palette))
    add(Werkzeug(Icons.Outlined.Forum, "Lobby", "Quittungen und Antworten des Hubs", false) { a.oeffnen(Detail.LobbyD) })
}

/** „GLM-5.3 · 2 offen“, „pausiert · Claude Opus“, „offline“: was man vom Agenten wissen will, in einer Zeile. */
private fun agentZeile(z: SchwarmZustand, id: String, agent: Agent?): String {
    val st = z.hub.modelle[id]
    val modell = st?.takeIf { !it.ohneModell }?.let { it.name(it.modell) } ?: agent?.modell
    val offen = z.auftraege.count { it.zustaendig == id && it.zustand.offen }
    return listOfNotNull(
        when {
            pausiert(z, id) -> "pausiert"
            agent == null -> "ohne Agent Card"
            agent.status != AgentStatus.ONLINE -> agent.status.titel
            else -> null
        },
        modell,
        when (offen) { 0 -> null; 1 -> "1 offen"; else -> "$offen offen" },
    ).joinToString(" · ").ifEmpty { if (agent?.nimmtAuftraege == false) "Melder" else "bereit" }
}

/** Eine Gruppe von Zeilen auf einer Fläche, wie in den Android-Einstellungen. */
@Composable
private fun Gruppe(inhalt: @Composable () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 4.dp)) { inhalt() }
    }
}

@Composable
private fun Trenner() {
    HorizontalDivider(Modifier.padding(start = 68.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
}

@Composable
private fun AgentZeile(
    id: String,
    name: String,
    status: AgentStatus?,
    zeile: String,
    ausgewaehlt: Boolean,
    kompakt: Boolean = false,
    onClick: () -> Unit,
) {
    val f = MaterialTheme.colorScheme
    Surface(onClick = onClick, color = if (ausgewaehlt) f.secondaryContainer else Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = if (kompakt) 8.dp else 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AgentAvatar(id, name, status, if (kompakt) 32.dp else 40.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    zeile,
                    style = MaterialTheme.typography.bodyMedium,
                    color = f.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = f.outline)
        }
    }
}

@Composable
private fun WerkzeugZeile(icon: ImageVector, titel: String, text: String, warnung: Boolean, onClick: () -> Unit) {
    val f = MaterialTheme.colorScheme
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            SymbolKreis(icon, f.surfaceContainerHighest, if (warnung) StatusWarnung else f.primary)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(titel, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    text,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (warnung) StatusWarnung else f.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = f.outline)
        }
    }
}

/** Wie der Hub gebaut wurde (App 2.5): Release, Basis, Tests und seit wann; rot, wenn am Release-Weg vorbei. */
@Composable
private fun ReleaseZeile(r: com.claudewebui.swarm.data.ReleaseStand) {
    val f = MaterialTheme.colorScheme
    val seit = r.seit?.let { " · seit ${zeitText(it)}" }.orEmpty()
    Gruppe {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            SymbolKreis(
                if (r.strasse) Icons.Outlined.Verified else Icons.Outlined.Warning,
                f.surfaceContainerHighest,
                if (r.strasse) StatusGut else StatusKritisch,
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (r.strasse) "Release ${r.tag ?: "?"}" else "Ohne Release-Strasse gebaut",
                    style = MaterialTheme.typography.titleSmall,
                    color = if (r.strasse) f.onSurface else StatusKritisch,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (r.strasse) {
                        listOfNotNull(
                            r.basis?.let { "Basis ${it.take(7)}" },
                            r.gruen?.let { g -> r.suiten?.let { "$g/$it Suiten" } },
                            r.pruefungen?.let { "$it Prüfungen" },
                        ).joinToString(" · ") + seit
                    } else {
                        "Befehle können fehlen, bis er über hub-release.mjs neu ausgerollt ist$seit"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = f.onSurfaceVariant,
                )
            }
        }
    }
}

/** Der Not-Aus an einem festen Platz, statt als rote Hand auf jeder Seite. */
@Composable
private fun NotAusKarte(a: Aktionen) {
    val f = MaterialTheme.colorScheme
    Surface(color = f.error.copy(alpha = 0.10f), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, end = 12.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            SymbolKreis(Icons.Outlined.PanTool, f.error.copy(alpha = 0.18f), f.error)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Not-Aus", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Hält alle Agenten sofort an, auf Wunsch auch ohne Matrix.",
                    style = MaterialTheme.typography.bodySmall,
                    color = f.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = a.notAus,
                colors = ButtonDefaults.buttonColors(containerColor = f.error, contentColor = f.onError),
            ) { Text("Anhalten") }
        }
    }
}

// ── Die Seite eines Agenten ─────────────────────────────────────────────────

/** Was für ein Agent das ist, in Worten statt Kürzeln. */
private fun artBeschreibung(agent: Agent?): String {
    agent ?: return "Nur beim Hub bekannt, ohne Agent Card in der Lobby."
    val art = when (agent.modus) {
        "native" -> "Eigener Bot: liest seinen Raum selbst, du kannst ihm dort direkt schreiben."
        "worker" -> "Worker des Hubs: bekommt Aufträge über den Hub und antwortet im Thread der Karte."
        "notify" -> "Melder: schreibt nur Meldungen in #schwarm-alarme, nimmt keine Aufträge."
        else -> "Modus ${agent.modus}."
    }
    val stufe = when (agent.trust) {
        "T2" -> " Vertrauen T2: Zugriff auf den Host, Übergaben an ihn brauchen deine Freigabe."
        "T1" -> " Vertrauen T1: arbeitet ohne Host-Zugriff."
        "T0" -> " Vertrauen T0: nur lesen."
        else -> ""
    }
    return art + stufe
}

@Composable
fun AgentAnsicht(id: String, z: SchwarmZustand, a: Aktionen, zurueck: (() -> Unit)?, schliessbar: Boolean) {
    val f = MaterialTheme.colorScheme
    val agent = z.agent(id)
    val stand = z.hub.modelle[id]
    val name = agent?.name ?: id
    val pause = pausiert(z, id)
    var bearbeiten by rememberSaveable(id) { mutableStateOf(false) }
    var stimmeOffen by rememberSaveable(id) { mutableStateOf(false) }
    val offen = z.auftraege.filter { it.zustaendig == id && it.zustand.offen }.sortedByDescending { it.aktualisiert }
    val erledigt = z.auftraege.filter { it.zustaendig == id && !it.zustand.offen }.sortedByDescending { it.aktualisiert }.take(3)
    val status = if (pause) AgentStatus.PAUSIERT else agent?.status
    Scaffold(
        topBar = {
            SchwarmLeiste(name, status?.titel ?: "ohne Agent Card", zurueck = zurueck) {
                if (schliessbar) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = pad.calculateTopPadding() + 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "kopf") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AgentAvatar(id, name, status, 56.dp)
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(name, style = MaterialTheme.typography.titleLarge)
                        Text(
                            listOfNotNull(agent?.level, agent?.trust, agent?.laufzeit).joinToString(" · ").ifEmpty { id },
                            style = MaterialTheme.typography.labelLarge,
                            color = f.onSurfaceVariant,
                        )
                    }
                }
            }
            item(key = "art") {
                Text(artBeschreibung(agent), style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
            }
            item(key = "knoepfe") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (agent?.nimmtAuftraege == true && a.rolle.darfAuftragAn(id)) {
                        Button(onClick = { a.neuerAuftrag(id) }) {
                            Icon(Icons.Filled.Add, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Auftrag geben")
                        }
                    }
                    agent?.raumId?.let { r ->
                        OutlinedButton(onClick = { a.raumOeffnen(r, "ag-$id", id) }) {
                            Text(if (agent.direktAnsprechbar) "Direkt schreiben" else "Raum öffnen")
                        }
                    }
                    if (z.hub.einheiten[id] != null || id == "plum") {
                        OutlinedButton(onClick = { a.oeffnen(Detail.EinheitenD(id)) }) {
                            Text(z.hub.einheiten[id]?.let { "Sitzungen (${it.eintraege.size})" } ?: "Sitzungen")
                        }
                    }
                    if (a.rolle.istVale && agent != null) {
                        OutlinedButton(onClick = { a.befehlUndLobby(if (pause) "!weiter @$id" else "!pause @$id") }) {
                            Text(if (pause) "Fortsetzen" else "Pausieren")
                        }
                    }
                }
            }
            if (stand != null || agent?.modell != null) {
                item(key = "modell-titel") { Abschnitt("Modell und Stimme") }
                item(key = "modell") {
                    AgentModellKarte(id, agent, stand, z, a, onStimme = { stimmeOffen = true }, knoepfe = false) { bearbeiten = true }
                }
            }
            z.hub.kontingente?.let { k ->
                val meine = k.eintraege.filter { it.agent == id }
                if (meine.isNotEmpty()) {
                    item(key = "abo") {
                        AboKarte(k.copy(eintraege = meine, umleitung = k.umleitung.filter { (von, nach) -> von == id || nach == id }), z)
                    }
                }
            }
            if (agent?.nimmtAuftraege != false) {
                item(key = "auftraege-titel") {
                    Abschnitt("Aufträge") {
                        Text(if (offen.isEmpty()) "nichts offen" else "${offen.size} offen", style = MaterialTheme.typography.labelMedium, color = f.onSurfaceVariant)
                    }
                }
                items(offen, key = { "o-" + it.id }) { AuftragZeile(it, z) { a.auftragOeffnen(it.id) } }
                items(erledigt, key = { "e-" + it.id }) { AuftragZeile(it, z) { a.auftragOeffnen(it.id) } }
                if (offen.isEmpty() && erledigt.isEmpty()) {
                    item(key = "auftraege-leer") {
                        Text("Noch keine Aufträge im geladenen Verlauf.", style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant)
                    }
                }
            }
            if (agent != null) {
                item(key = "ueber-titel") { Abschnitt("Über ${agent.name}") }
                item(key = "ueber") {
                    Surface(color = f.surfaceContainerLow, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (agent.faehigkeiten.isNotEmpty()) ModellZeile("Kann", agent.faehigkeiten.joinToString(", "))
                            ModellZeile("Parallel", if (agent.parallel == 1) "1 Auftrag" else "${agent.parallel} Aufträge")
                            agent.budgetTag?.let { ModellZeile("Budget", "$it USD pro Tag") }
                            ModellZeile("Konto", agent.mxid)
                            if (a.rolle.istVale) {
                                TextButton(onClick = { a.befehlUndLobby("!profil @$id") }, contentPadding = PaddingValues(0.dp)) {
                                    Text("Profil im Hub abfragen (Bewertungen, Kosten)")
                                }
                            }
                        }
                    }
                }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
    if (bearbeiten && stand?.einstellbar == true) ModellBearbeiten(stand, z, a) { bearbeiten = false }
    if (stimmeOffen) StimmenBlatt(id, z, a) { stimmeOffen = false }
}

// ── Update der App (Punkt 20, App 2.8) ──────────────────────────────────────

/**
 * Eine neue Version der App, veröffentlicht als State-Event `ch.zwaetschge.swarm.app` in der Lobby. Ein Tipp
 * lädt die APK über deinen Server, prüft Grösse und Prüfsumme und gibt sie dem Paketinstallierer von Android.
 * Fehlt die Erlaubnis für unbekannte Quellen, zeigt die Karte den Weg dorthin.
 */
@Composable
private fun AppUpdateKarte(r: AppRelease, a: Aktionen) {
    val stand by a.vm.update.collectAsStateWithLifecycle()
    val kontext = LocalContext.current
    val quelle = AppUpdate.quelleErlaubt(kontext)
    val geladen = remember(r.versionCode) { AppUpdate.vorhanden(kontext, r) != null }
    val laedt = stand is UpdateStand.Laedt
    val fehler = (stand as? UpdateStand.Fehler)?.text
    HinweisKarte(
        Icons.Outlined.SystemUpdate,
        "Neue Version ${r.versionName}",
        buildString {
            append("Installiert ist ${a.vm.eigeneVersion.second}. Die neue APK kommt über deinen Server")
            if (r.groesse > 0) append(", ${groesseText(r.groesse)}")
            append(".")
            if (r.notizen.isNotBlank()) append("\n\n${r.notizen}")
            if (fehler != null) append("\n\n$fehler")
            if (!quelle) append("\n\nAndroid braucht noch die Erlaubnis, Apps aus unbekannten Quellen zu installieren.")
        },
        StatusWarnung,
    ) {
        Row(
            Modifier.padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (laedt) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("Lädt …", style = MaterialTheme.typography.labelLarge)
            } else {
                Button(onClick = { a.vm.appUpdateLaden() }) {
                    Text(if (geladen) "Erneut installieren" else "Laden und installieren")
                }
                if (!quelle) TextButton(onClick = { a.vm.appQuelleOeffnen() }) { Text("Erlaubnis") }
            }
        }
    }
}

/** Welche Version auf dem Gerät läuft: zum Vergleich mit dem veröffentlichten Stand und für Fehlerberichte. */
@Composable
private fun AppVersionZeile(a: Aktionen) {
    val f = MaterialTheme.colorScheme
    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        SymbolKreis(Icons.Outlined.Smartphone, f.surfaceContainerHighest, f.primary)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text("Version", style = MaterialTheme.typography.titleSmall)
            Text(
                "Schwarm ${a.vm.eigeneVersion.second} (${a.vm.eigeneVersion.first})",
                style = MaterialTheme.typography.bodyMedium,
                color = f.onSurfaceVariant,
            )
        }
    }
}
