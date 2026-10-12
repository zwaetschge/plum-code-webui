@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.swarm.data.Rolle

/**
 * Ein Befehl der Palette. `vorlage` ist, was in die Eingabe kommt, wenn noch etwas fehlt; ohne
 * `vorlage` geht `befehl` gleich raus.
 */
data class PalettenBefehl(val befehl: String, val text: String, val vorlage: String? = null) {
    /** Der Name ohne „!“, so steht er in den `befehle` einer Gastrolle. */
    val name: String get() = befehl.removePrefix("!").substringBefore(' ')
}

/** Alle Befehle des Hubs, die die App anbietet (Hub-`!hilfe` und SCHNITTSTELLEN-app.md). */
val PALETTE = listOf(
    PalettenBefehl("!stand", "Zustand eines Auftrags, ohne Nummer die Übersicht", "!stand T-"),
    PalettenBefehl("!board", "offene Aufträge"),
    PalettenBefehl("!agenten", "wer ist da, was darf er, was läuft"),
    PalettenBefehl("!budget", "Verbrauch heute je Agent"),
    PalettenBefehl("!plum", "die Plum-Sitzungen mit Zustand"),
    PalettenBefehl("!absprachen", "wer gerade an welchen Dateien arbeitet"),
    PalettenBefehl("!release", "welcher Hub-Stand läuft, mit Basis, Tests und Rückweg"),
    PalettenBefehl("!sperren", "was der Türsteher gesperrt hat"),
    PalettenBefehl("!entsperren", "eine Sperre aufheben: !entsperren <ip> <grund>", "!entsperren "),
    PalettenBefehl("!routine", "Routinen mit Zeitplan; neu, pause, weiter, jetzt, weg", "!routine neu "),
    PalettenBefehl("!ablauf", "Abläufe mit Toren (code-aenderung, recherche, zweitmeinung); mit Namen und Ziel starten", "!ablauf "),
    PalettenBefehl("!kennzahlen", "Wochenbericht: Aufträge, Quote, Kosten, Freigaben, Alarme"),
    PalettenBefehl("!erinnern", "im Schwarm-Gedächtnis nach früheren Aufträgen suchen", "!erinnern "),
    PalettenBefehl("!tokens", "Schwarm-Tokens mit Alter und letzter Nutzung (nie die Tokens selbst)"),
    PalettenBefehl("!abo", "Kontingente von Claude, Codex und Z.AI; ab 95 % gehen Code-Aufträge an die Rückfallebene"),
    PalettenBefehl("!profil", "Erfolgsquote, Dauer, Kosten und 👍/👎 je Agent (30 Tage)", "!profil @"),
    PalettenBefehl("!geraet", "Geräte für den Not-Aus ohne Matrix"),
    PalettenBefehl("!alarme", "offene Alarme"),
    PalettenBefehl("!selbsttest", "Testauftrag „antworte mit OK“"),
    PalettenBefehl("!pruefen", "ein anderer Agent prüft ein Ergebnis: !pruefen T-… @agent", "!pruefen T-"),
    PalettenBefehl("!aktion", "Betrieb: Docker, Unraid, Pi-hole; ohne Argument die Liste", "!aktion "),
    PalettenBefehl("!rat", "der Rat berät: !rat [debatte|vote|…] <frage>", "!rat "),
    PalettenBefehl("!audit", "Hash-Kette der Audit-Tabelle prüfen"),
    PalettenBefehl("!auftrag", "neuer Auftrag: !auftrag @agent <ziel>", "!auftrag @"),
    PalettenBefehl("!hilfe", "alle Befehle mit Kurzbeschreibung"),
)

/**
 * Die Befehlspalette mit Suche. Ein Tipp auf die Zeile schickt den Befehl ohne Argument in die
 * Lobby (bei `!ablauf` etwa die Liste der Abläufe); der Stift legt ihn zum Ergänzen in die Eingabe.
 * Ein Gast sieht nur die Befehle seiner Rolle.
 */
@Composable
fun Befehlspalette(rolle: Rolle, onSenden: (String) -> Unit, onVorbereiten: (String) -> Unit, onSchliessen: () -> Unit) {
    var suche by remember { mutableStateOf("") }
    val sichtbar = PALETTE.filter { rolle.darf(it.name) }.filter { b ->
        val q = suche.trim().removePrefix("!").lowercase()
        q.isEmpty() || b.name.contains(q) || b.text.lowercase().contains(q)
    }
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Befehle", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = suche,
                onValueChange = { suche = it },
                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                placeholder = { Text("Suchen, z. B. routine") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            LazyColumn(
                Modifier.fillMaxWidth().heightIn(max = 520.dp),
                contentPadding = PaddingValues(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (sichtbar.isEmpty()) {
                    item { Text("Kein Befehl passt.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
                }
                items(sichtbar, key = { it.befehl }) { b ->
                    Surface(
                        onClick = { if (b.befehl == "!auftrag") onVorbereiten(b.vorlage ?: b.befehl) else onSenden(b.befehl) },
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(Modifier.padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(b.befehl, style = Mono, color = MaterialTheme.colorScheme.primary)
                                Text(b.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (b.vorlage != null) {
                                IconButton(onClick = { onVorbereiten(b.vorlage) }) { Icon(Icons.Outlined.Edit, "${b.befehl} ergänzen") }
                            } else {
                                IconButton(onClick = { onSenden(b.befehl) }) { Icon(Icons.AutoMirrored.Filled.Send, "${b.befehl} senden") }
                            }
                        }
                    }
                }
            }
        }
    }
}
