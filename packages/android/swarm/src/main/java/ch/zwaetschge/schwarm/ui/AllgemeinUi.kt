@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)

package com.claudewebui.swarm.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.VolumeOff
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.AddTask
import androidx.compose.material3.Badge
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Switch
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledIconButton
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
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Allgemein
import com.claudewebui.swarm.data.AllgemeinLeser
import com.claudewebui.swarm.data.AllgemeinStand
import com.claudewebui.swarm.data.Anhang
import com.claudewebui.swarm.data.AnhangLeser
import com.claudewebui.swarm.data.Bilder
import com.claudewebui.swarm.data.BrianHilfe
import com.claudewebui.swarm.data.Bildwahl
import com.claudewebui.swarm.data.Chat
import com.claudewebui.swarm.data.ChatArt
import com.claudewebui.swarm.data.ChatZustand
import com.claudewebui.swarm.data.Datei
import com.claudewebui.swarm.data.Lebenslauf
import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.SchwarmZustand
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import kotlinx.coroutines.delay
import com.claudewebui.swarm.data.ChatEinstellung
import com.claudewebui.swarm.data.ChatTreffer
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.material.icons.outlined.HeadsetMic
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material3.LocalContentColor
import com.claudewebui.swarm.data.Aufnahme
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.rememberUpdatedState

/*
 * Allgemein (App 2.1), seit App 2.4 der Bereich „Chat“: Vales Chat mit Brian, als Ersatz für ChatGPT im
 * Web. Links die Chats (jeder ein Thread) mit der Eingabe für einen neuen, rechts oder darüber der Chat:
 * deine Fragen als Blasen, Brians Antworten über die ganze Breite als Markdown, Werkzeugzeilen klein.
 */

// ── Chatliste ───────────────────────────────────────────────────────────────

@Composable
fun AllgemeinAnsicht(z: SchwarmZustand, a: Aktionen) {
    val g = z.allgemein
    val fehler by a.vm.allgemeinFehler.collectAsStateWithLifecycle()
    LaunchedEffect(g.stand) { if (g.stand == AllgemeinStand.FEHLT) a.vm.allgemeinEinrichten() }
    var suche by rememberSaveable { mutableStateOf("") }
    val offen = (a.offen as? Detail.ChatD)?.wurzel
    // Titel, Angeheftet und Archiv (App 2.7): angeheftete zuerst, archivierte unten eingeklappt.
    val einst = g.einstellungen
    val passend = if (suche.isBlank()) {
        g.chats
    } else {
        g.chats.filter { c -> g.titel(c).contains(suche, true) || c.nachrichten.any { it.n.text.contains(suche, true) } }
    }
    val archiv = passend.filter { einst[it.wurzel]?.archiviert == true }
    val treffer = passend.filter { einst[it.wurzel]?.archiviert != true }
        .sortedWith(compareByDescending<Chat> { einst[it.wurzel]?.angeheftet == true }.thenByDescending { it.zuletzt })
    var zeigeArchiv by rememberSaveable { mutableStateOf(false) }
    var umbenennen by remember { mutableStateOf<Chat?>(null) }
    // Ab drei Buchstaben sucht Synapse mit, auch in Chats, die noch nicht geladen sind.
    val serverTreffer by a.vm.chatTreffer.collectAsStateWithLifecycle()
    LaunchedEffect(suche) {
        if (suche.trim().length >= 3) {
            delay(600)
            a.vm.chatsSuchen(suche)
        } else {
            a.vm.chatsSuchen("")
        }
    }
    val sichtbar = passend.map { it.wurzel }.toSet()
    val weitere = serverTreffer?.takeIf { it.first == suche.trim() }?.second.orEmpty()
        .filter { it.wurzel !in sichtbar }.distinctBy { it.wurzel }
    val einstellen = { c: Chat, neu: ChatEinstellung -> a.vm.chatEinstellen(c.wurzel, neu) }
    val vorlesenAn by a.vm.antwortenVorlesen.collectAsStateWithLifecycle()
    val sendet by a.vm.sendet.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            SchwarmLeiste("Chat", allgemeinUntertitel(g)) {
                // Brians Antworten vorlesen, solange die App vorne ist (App 2.2); früher eine eigene Zeile in der Liste.
                IconButton(onClick = {
                    a.vm.antwortenVorlesenSetzen(!vorlesenAn)
                    a.vm.melden(if (!vorlesenAn) "Brians Antworten werden vorgelesen, solange die App vorne ist." else "Vorlesen aus.")
                }) {
                    Icon(
                        if (vorlesenAn) Icons.AutoMirrored.Outlined.VolumeUp else Icons.AutoMirrored.Outlined.VolumeOff,
                        if (vorlesenAn) "Antworten vorlesen: an" else "Antworten vorlesen: aus",
                        tint = if (vorlesenAn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (a.breit) {
                    IconButton(onClick = { a.oeffnen(Detail.ChatD(null)) }) { Icon(Icons.Outlined.AddComment, "Neuer Chat") }
                }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            LazyColumn(
                Modifier.weight(1f),
                contentPadding = PaddingValues(top = 4.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (g.stand != AllgemeinStand.BEREIT) {
                    item(key = "hinweis") { AllgemeinHinweis(g, fehler, a, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                }
                if (g.chats.size >= 3 || suche.isNotEmpty()) {
                    item(key = "suche") {
                        TextField(
                            value = suche,
                            onValueChange = { suche = it },
                            placeholder = { Text("Chats durchsuchen") },
                            leadingIcon = { Icon(Icons.Outlined.Search, null) },
                            trailingIcon = {
                                if (suche.isNotEmpty()) IconButton(onClick = { suche = "" }) { Icon(Icons.Outlined.Close, "Suche leeren") }
                            },
                            singleLine = true,
                            shape = RoundedCornerShape(28.dp),
                            colors = TextFieldDefaults.colors(
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent,
                                disabledIndicatorColor = Color.Transparent,
                            ),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                        )
                    }
                }
                items(treffer, key = { it.wurzel }) { c ->
                    ChatZeile(c, g, ausgewaehlt = c.wurzel == offen, onEinstellen = { einstellen(c, it) }, onUmbenennen = { umbenennen = c }) {
                        a.oeffnen(Detail.ChatD(c.wurzel))
                    }
                }
                if (weitere.isNotEmpty()) {
                    item(key = "weitere") { Abschnitt("In älteren Chats", Modifier.padding(horizontal = 16.dp)) }
                    items(weitere, key = { "t-" + it.eventId }) { t -> TrefferZeile(t, suche.trim()) { a.oeffnen(Detail.ChatD(t.wurzel)) } }
                }
                if (archiv.isNotEmpty()) {
                    // Beim Suchen stehen Treffer im Archiv offen da; sonst bleibt das Archiv eingeklappt.
                    val suchtGerade = suche.isNotBlank()
                    item(key = "archiv") {
                        if (suchtGerade) {
                            Abschnitt("Im Archiv", Modifier.padding(horizontal = 16.dp))
                        } else {
                            Box(Modifier.padding(horizontal = 12.dp)) {
                                Aufklappen("Archiv", archiv.size, zeigeArchiv) { zeigeArchiv = !zeigeArchiv }
                            }
                        }
                    }
                    if (zeigeArchiv || suchtGerade) {
                        items(archiv, key = { "a-" + it.wurzel }) { c ->
                            ChatZeile(c, g, ausgewaehlt = c.wurzel == offen, onEinstellen = { einstellen(c, it) }, onUmbenennen = { umbenennen = c }) {
                                a.oeffnen(Detail.ChatD(c.wurzel))
                            }
                        }
                    }
                }
                if (treffer.isEmpty() && archiv.isEmpty() && weitere.isEmpty() && g.bereit) {
                    item(key = "leer") {
                        if (suche.isNotBlank()) {
                            Text(
                                "Kein Chat enthält „$suche“.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(24.dp),
                            )
                        } else {
                            LeerHinweis(
                                Icons.Outlined.QuestionAnswer,
                                "Noch kein Chat",
                                "Frag Brian, was du sonst ChatGPT fragst. Jeder Chat ist ein eigener Thread, Brian sieht nur ihn.",
                            )
                        }
                    }
                }
                val raum = g.raumId
                if (raum != null && g.bereit && !g.anfangErreicht && suche.isBlank()) {
                    val v = z.verlauf(raum)
                    item(key = "aeltere") {
                        Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                            if (v.laedtAeltere) {
                                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                            } else {
                                TextButton(onClick = { a.vm.aeltereLaden(raum) }) { Text("Ältere Chats laden") }
                            }
                        }
                    }
                }
            }
            // Schmal wie bei ChatGPT: unten gleich die Eingabe für einen neuen Chat, ohne Umweg über einen Knopf.
            // Breit steht der neue Chat rechts mit seiner eigenen Eingabe.
            if (!a.breit && g.bereit) {
                ChatEingabe(
                    schluessel = "neu-aus-liste",
                    aktiv = true,
                    sendet = sendet,
                    hinweis = "Neuer Chat: frag Brian …",
                    vorbelegt = null,
                    onVorbelegt = {},
                    a = a,
                ) { text, anhang, zurueckholen ->
                    val weiter: (String) -> Unit = { w -> a.oeffnen(Detail.ChatD(w)) }
                    if (anhang != null) a.vm.chatAnhangSenden(anhang, text, null, weiter, zurueckholen)
                    else a.vm.chatSenden(text, null, weiter, zurueckholen)
                }
            }
        }
    }
    umbenennen?.let { c ->
        UmbenennenDialog(
            g.titel(c),
            onSpeichern = { t -> a.vm.chatEinstellen(c.wurzel, (einst[c.wurzel] ?: ChatEinstellung()).copy(titel = t)) },
            onSchliessen = { umbenennen = null },
        )
    }
}

/** Eigener Titel für einen Chat (App 2.7); leer heisst: wieder der Anfang der ersten Nachricht. */
@Composable
private fun UmbenennenDialog(bisher: String, onSpeichern: (String?) -> Unit, onSchliessen: () -> Unit) {
    var titel by remember { mutableStateOf(bisher) }
    AlertDialog(
        onDismissRequest = onSchliessen,
        title = { Text("Chat umbenennen") },
        text = {
            OutlinedTextField(
                value = titel,
                onValueChange = { titel = it.take(80) },
                singleLine = true,
                label = { Text("Titel") },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = { Button(onClick = { onSpeichern(titel.trim().ifBlank { null }); onSchliessen() }) { Text("Speichern") } },
        dismissButton = {
            TextButton(onClick = { onSpeichern(null); onSchliessen() }) { Text("Ursprünglicher Titel") }
        },
    )
}

/** Ein Treffer der Suche in einem älteren Chat: der Satz mit dem Begriff, wann und von wem. */
@Composable
private fun TrefferZeile(t: ChatTreffer, begriff: String, onClick: () -> Unit) {
    val f = MaterialTheme.colorScheme
    val i = t.text.indexOf(begriff, ignoreCase = true)
    val ausschnitt = if (i > 40) "…" + t.text.substring(i - 30) else t.text
    Surface(onClick = onClick, color = Color.Transparent, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(f.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Search, null, tint = f.onSurfaceVariant, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row {
                    Text(if (t.vonMir) "Du" else "Brian", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text(listenZeit(t.zeit), style = MaterialTheme.typography.labelSmall, color = f.onSurfaceVariant)
                }
                Text(ausschnitt, style = MaterialTheme.typography.bodyMedium, color = f.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

fun allgemeinUntertitel(g: Allgemein): String = when (g.stand) {
    AllgemeinStand.BEREIT -> {
        val arbeitet = g.chats.count { it.zustand == ChatZustand.ARBEITET }
        "mit Brian" + when {
            g.brianTippt -> " · schreibt …"
            arbeitet > 0 -> " · arbeitet"
            else -> ""
        }
    }
    AllgemeinStand.WARTET_AUF_BRIAN -> "Brian tritt bei …"
    AllgemeinStand.FEHLT, AllgemeinStand.WIRD_ANGELEGT -> "wird eingerichtet …"
    AllgemeinStand.ZU_VIELE -> "mehr als zwei Mitglieder"
    AllgemeinStand.NICHT_ERREICHBAR -> "Raum nicht erreichbar"
    AllgemeinStand.UNBEKANNT -> "verbindet …"
}

/** Was mit Allgemein los ist, solange es nicht bereit ist. */
@Composable
private fun AllgemeinHinweis(g: Allgemein, fehler: String?, a: Aktionen, modifier: Modifier = Modifier) {
    val f = MaterialTheme.colorScheme
    val (titel, text) = when {
        fehler != null && g.stand == AllgemeinStand.FEHLT -> "Allgemein fehlt" to fehler
        g.stand == AllgemeinStand.FEHLT || g.stand == AllgemeinStand.WIRD_ANGELEGT ->
            "Allgemein wird eingerichtet" to "Ein Raum nur für dich und Brian. Brian tritt von selbst bei; danach kannst du schreiben."
        g.stand == AllgemeinStand.WARTET_AUF_BRIAN ->
            "Brian tritt bei …" to "Die Einladung ist raus. Sobald Brian im Raum ist, geht die Eingabe auf. " +
                "Dauert das mehr als ein paar Minuten, nimmt Brian Einladungen wohl nicht an; Element zeigt, ob er eingeladen ist."
        g.stand == AllgemeinStand.ZU_VIELE ->
            "Mehr als zwei Mitglieder" to "Brian antwortet nur in einem Raum zu zweit. Entferne die übrigen Mitglieder in Element; die App lädt niemanden sonst ein."
        g.stand == AllgemeinStand.NICHT_ERREICHBAR ->
            "Raum nicht erreichbar" to "Die Account-Daten nennen einen Raum, in dem du nicht mehr bist. Tritt ihm in Element wieder bei."
        else -> "Verbinde …" to "Allgemein erscheint nach dem ersten Abgleich."
    }
    Surface(color = f.surfaceContainerHigh, shape = RoundedCornerShape(16.dp), modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (fehler != null && g.stand == AllgemeinStand.FEHLT) {
                Icon(Icons.Outlined.ErrorOutline, null, tint = f.error)
            } else if (g.stand == AllgemeinStand.ZU_VIELE || g.stand == AllgemeinStand.NICHT_ERREICHBAR) {
                Icon(Icons.Outlined.ErrorOutline, null, tint = f.error)
            } else {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(titel, style = MaterialTheme.typography.titleSmall)
                Text(text, style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant)
            }
            if (fehler != null && g.stand == AllgemeinStand.FEHLT) {
                TextButton(onClick = { a.vm.allgemeinEinrichten(erneut = true) }) { Text("Nochmal") }
            }
        }
    }
}

@Composable
private fun ChatZeile(
    c: Chat,
    g: Allgemein,
    ausgewaehlt: Boolean,
    onEinstellen: (ChatEinstellung) -> Unit,
    onUmbenennen: () -> Unit,
    onClick: () -> Unit,
) {
    val f = MaterialTheme.colorScheme
    val neu = c.ungelesen > 0
    val tippt = g.brianTippt && c.zustand == ChatZustand.ARBEITET
    val e = g.einstellungen[c.wurzel] ?: ChatEinstellung()
    val haptik = LocalHapticFeedback.current
    var menue by remember { mutableStateOf(false) }
    val form = RoundedCornerShape(18.dp)
    Box {
    // Langes Drücken (App 2.7): umbenennen, anheften, archivieren.
    DropdownMenu(expanded = menue, onDismissRequest = { menue = false }) {
        DropdownMenuItem(
            text = { Text("Umbenennen") },
            leadingIcon = { Icon(Icons.Outlined.DriveFileRenameOutline, null) },
            onClick = { menue = false; onUmbenennen() },
        )
        DropdownMenuItem(
            text = { Text(if (e.angeheftet) "Nicht mehr anheften" else "Anheften") },
            leadingIcon = { Icon(Icons.Outlined.PushPin, null) },
            onClick = { menue = false; onEinstellen(e.copy(angeheftet = !e.angeheftet, archiviert = false)) },
        )
        DropdownMenuItem(
            text = { Text(if (e.archiviert) "Aus dem Archiv holen" else "Archivieren") },
            leadingIcon = { Icon(if (e.archiviert) Icons.Outlined.Unarchive else Icons.Outlined.Archive, null) },
            onClick = { menue = false; onEinstellen(e.copy(archiviert = !e.archiviert, angeheftet = false)) },
        )
    }
    Surface(
        color = if (ausgewaehlt) f.secondaryContainer else Color.Transparent,
        shape = form,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .clip(form)
            .combinedClickable(onClick = onClick, onLongClick = {
                haptik.performHapticFeedback(HapticFeedbackType.LongPress)
                menue = true
            }),
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
            ChatSymbol(c)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (e.angeheftet) {
                        Icon(Icons.Outlined.PushPin, "angeheftet", Modifier.size(14.dp), tint = f.primary)
                        Spacer(Modifier.width(4.dp))
                    }
                    Text(
                        g.titel(c),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = if (neu) FontWeight.Bold else FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        listenZeit(c.zuletzt),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (neu) f.primary else f.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val (zustand, farbe) = when (c.zustand) {
                        ChatZustand.ARBEITET -> (if (tippt) "schreibt …" else "arbeitet …") to f.primary
                        ChatZustand.GESENDET -> "gesendet" to f.onSurfaceVariant
                        ChatZustand.FEHLER -> "Fehler" to f.error
                        ChatZustand.GESTOPPT -> "gestoppt" to f.onSurfaceVariant
                        ChatZustand.OFFEN -> "keine Antwort" to f.onSurfaceVariant
                        ChatZustand.FERTIG -> null to f.onSurfaceVariant
                    }
                    val vorschau = when (c.zustand) {
                        ChatZustand.ARBEITET, ChatZustand.GESENDET -> null
                        else -> c.vorschau
                    }
                    Text(
                        buildString {
                            if (zustand != null) append(zustand)
                            if (zustand != null && vorschau != null) append(" · ")
                            if (vorschau != null) append(vorschau)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (zustand != null && vorschau == null) farbe else f.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (neu) {
                        Spacer(Modifier.width(8.dp))
                        Badge(containerColor = f.primary, contentColor = f.onPrimary) { Text(c.ungelesen.toString()) }
                    }
                }
            }
        }
    }
    }
}

/** Links in der Zeile: ein Kreis mit dem Zustand des Chats. */
@Composable
private fun ChatSymbol(c: Chat) {
    val f = MaterialTheme.colorScheme
    val bild = c.nachrichten.firstOrNull()?.n?.datei?.bild == true
    val (grund, farbe) = when (c.zustand) {
        ChatZustand.FEHLER -> f.errorContainer to f.onErrorContainer
        ChatZustand.ARBEITET, ChatZustand.GESENDET -> f.primaryContainer to f.onPrimaryContainer
        else -> f.surfaceContainerHighest to f.onSurfaceVariant
    }
    Box(Modifier.size(40.dp).clip(CircleShape).background(grund), contentAlignment = Alignment.Center) {
        when (c.zustand) {
            ChatZustand.ARBEITET -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = farbe)
            ChatZustand.GESENDET -> Icon(Icons.Outlined.Schedule, null, tint = farbe, modifier = Modifier.size(20.dp))
            ChatZustand.FEHLER -> Icon(Icons.Outlined.ErrorOutline, null, tint = farbe, modifier = Modifier.size(20.dp))
            ChatZustand.GESTOPPT -> Icon(Icons.Outlined.StopCircle, null, tint = farbe, modifier = Modifier.size(20.dp))
            else -> Icon(if (bild) Icons.Outlined.Image else Icons.Outlined.ChatBubbleOutline, null, tint = farbe, modifier = Modifier.size(20.dp))
        }
    }
}

private val nurUhr = SimpleDateFormat("HH:mm", Locale.GERMAN)
private val wochentag = SimpleDateFormat("EE", Locale.GERMAN)
private val kurzesDatum = SimpleDateFormat("dd.MM.", Locale.GERMAN)

/** In Listen: heute die Uhrzeit, gestern „gestern“, diese Woche der Tag, sonst das Datum. */
fun listenZeit(ms: Long): String {
    if (ms <= 0) return ""
    val heute = Calendar.getInstance()
    val dann = Calendar.getInstance().apply { timeInMillis = ms }
    fun tag(c: Calendar) = c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR)
    val gestern = (Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) })
    return when {
        tag(heute) == tag(dann) -> nurUhr.format(Date(ms))
        tag(gestern) == tag(dann) -> "gestern"
        System.currentTimeMillis() - ms < 6 * 86_400_000L -> wochentag.format(Date(ms)).removeSuffix(".")
        else -> kurzesDatum.format(Date(ms))
    }
}

// ── Ein Chat ────────────────────────────────────────────────────────────────

/** Was im Chat untereinander steht: deine Frage, Brians Antwort, eine Gruppe Statuszeilen. */
private sealed interface ChatEintrag {
    val schluessel: String
    val zeit: Long
}

private data class FrageE(val n: Nachricht) : ChatEintrag {
    override val schluessel get() = n.eventId
    override val zeit get() = n.zeit
}

private data class AntwortE(val n: Nachricht, val kopf: Boolean) : ChatEintrag {
    override val schluessel get() = n.eventId
    override val zeit get() = n.zeit
}

/** Ein Befehl von dir an Brian, etwa `/model … --session` (App 2.2). */
private data class BefehlE(val n: Nachricht) : ChatEintrag {
    override val schluessel get() = n.eventId
    override val zeit get() = n.zeit
}

private data class StatusE(val liste: List<Nachricht>, val kopf: Boolean) : ChatEintrag {
    override val schluessel get() = "s-" + liste.first().eventId
    override val zeit get() = liste.last().zeit
}

private fun chatEintraege(chat: Chat): List<ChatEintrag> {
    val aus = ArrayList<ChatEintrag>()
    for (cn in chat.nachrichten) {
        val vorher = aus.lastOrNull()
        val kopf = vorher == null || vorher is FrageE || vorher is BefehlE
        when (cn.art) {
            ChatArt.BEFEHL -> aus += BefehlE(cn.n)
            ChatArt.FRAGE -> aus += FrageE(cn.n)
            ChatArt.ANTWORT -> aus += AntwortE(cn.n, kopf)
            ChatArt.STATUS -> if (vorher is StatusE) {
                aus[aus.size - 1] = vorher.copy(liste = vorher.liste + cn.n)
            } else {
                aus += StatusE(listOf(cn.n), kopf)
            }
        }
    }
    return aus
}

@Composable
fun ChatAnsicht(wurzel: String?, z: SchwarmZustand, a: Aktionen, zurueck: (() -> Unit)?, schliessbar: Boolean) {
    val g = z.allgemein
    val chat = g.chat(wurzel)
    val sprachmodus by a.vm.sprachmodus.collectAsStateWithLifecycle()
    // Wer den Chat verlässt, beendet den Sprachmodus; beim Wechsel vom neuen zum angelegten Chat bleibt er.
    DisposableEffect(wurzel) {
        onDispose { if (a.vm.sprachmodus.value == (wurzel ?: "neu")) a.vm.sprachmodusSetzen(null) }
    }
    val sendet by a.vm.sendet.collectAsStateWithLifecycle()
    val geteilt by a.vm.geteilt.collectAsStateWithLifecycle()
    val raum = g.raumId
    LaunchedEffect(g.stand) { if (g.stand == AllgemeinStand.FEHLT) a.vm.allgemeinEinrichten() }
    // Aus einer Benachrichtigung oder weit zurück: den Thread nachladen.
    LaunchedEffect(wurzel, raum, chat == null) {
        if (wurzel != null && raum != null && chat == null && g.bereit) a.vm.threadLaden(raum, wurzel)
    }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                titel = chat?.let { g.titel(it) } ?: if (wurzel == null) "Neuer Chat" else "Chat",
                untertitel = chatUntertitel(chat, g),
                zurueck = zurueck,
            ) {
                // Sprachmodus (App 2.7): sprechen, Brian antwortet, die Antwort wird vorgelesen, dann hört die App wieder zu.
                val schluessel = wurzel ?: "neu"
                val sprechen = sprachmodus == schluessel
                IconButton(onClick = { a.vm.sprachmodusSetzen(if (sprechen) null else schluessel) }, enabled = g.bereit) {
                    Icon(
                        Icons.Outlined.HeadsetMic,
                        if (sprechen) "Sprachmodus beenden" else "Sprachmodus",
                        tint = if (sprechen) MaterialTheme.colorScheme.primary else LocalContentColor.current,
                    )
                }
                if (chat != null) {
                    IconButton(onClick = { a.ersetzen(Detail.ChatD(null)) }) { Icon(Icons.Outlined.AddComment, "Neuer Chat") }
                }
                if (schliessbar) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            // Das Modell dieses Chats (App 2.2); ohne Stand vom Hub bleibt die Zeile weg.
            ModellChip(chat, z, a)
            Box(Modifier.weight(1f)) {
                when {
                    chat != null -> ChatVerlauf(chat, g, a)
                    wurzel != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                    else -> NeuerChatLeer(g, a)
                }
            }
            if (g.stand != AllgemeinStand.BEREIT) {
                AllgemeinHinweis(g, a.vm.allgemeinFehler.collectAsStateWithLifecycle().value, a, Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            }
            if (chat != null && chat.zustand == ChatZustand.ARBEITET) StoppLeiste(chat, g, a)
            if (sprachmodus == (wurzel ?: "neu") && g.bereit) {
                SprachmodusLeiste(chat, wurzel ?: "neu", a)
            } else ChatEingabe(
                schluessel = wurzel ?: "neu",
                aktiv = g.bereit,
                sendet = sendet,
                hinweis = if (chat == null) "Frag Brian …" else "Antworten …",
                vorbelegt = if (wurzel == null) geteilt else null,
                onVorbelegt = { a.vm.geteiltUebernommen() },
                a = a,
            ) { text, anhang, zurueckholen ->
                val weiter: (String) -> Unit = { w -> if (chat == null) a.ersetzen(Detail.ChatD(w)) }
                if (anhang != null) a.vm.chatAnhangSenden(anhang, text, chat, weiter, zurueckholen)
                else a.vm.chatSenden(text, chat, weiter, zurueckholen)
            }
        }
    }
}

private fun chatUntertitel(chat: Chat?, g: Allgemein): String? {
    if (g.stand != AllgemeinStand.BEREIT) return allgemeinUntertitel(g)
    chat ?: return "mit Brian"
    return when (chat.zustand) {
        ChatZustand.ARBEITET -> if (g.brianTippt) "Brian schreibt …" else "Brian arbeitet …"
        ChatZustand.GESENDET -> "gesendet, wartet auf Brian"
        ChatZustand.FERTIG -> "fertig · ${zeitText(chat.zuletzt)}"
        ChatZustand.FEHLER -> "Fehler · ${zeitText(chat.zuletzt)}"
        ChatZustand.GESTOPPT -> "gestoppt"
        ChatZustand.OFFEN -> "keine Antwort"
    }
}

@Composable
private fun NeuerChatLeer(g: Allgemein, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(f.primaryContainer), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.QuestionAnswer, null, tint = f.onPrimaryContainer, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("Worum geht es?", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(
            "Ein neuer Chat mit Brian. Er sieht nur diesen Chat, nicht die anderen. " +
                "Ein Bild hängst du mit dem Symbol links an.",
            style = MaterialTheme.typography.bodyMedium,
            color = f.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.widthIn(max = 420.dp),
        )
        if (g.chats.isNotEmpty() && !a.breit) {
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = a.schliessen) { Text("Zu den Chats (${g.chats.size})") }
        }
    }
}

@Composable
private fun ChatVerlauf(chat: Chat, g: Allgemein, a: Aktionen) {
    val liste = rememberLazyListState()
    val eintraege = remember(chat.nachrichten) { chatEintraege(chat) }
    val umgekehrt = remember(eintraege) { eintraege.asReversed() }
    // Der Trenner „Neu“ bleibt, wo er beim Öffnen war, auch wenn die Antwort inzwischen gelesen ist.
    val neuAb = remember(chat.wurzel) { chat.gelesenBis.takeIf { chat.ungelesen > 0 } }
    val ersteNeue = neuAb?.let { ab -> eintraege.firstOrNull { it is AntwortE && it.zeit > ab }?.schluessel }
    val tippt = g.brianTippt && chat.zustand == ChatZustand.ARBEITET
    val fussSichtbar = chat.zustand != ChatZustand.FERTIG
    // Mitscrollen, solange man unten ist.
    LaunchedEffect(umgekehrt.firstOrNull()?.schluessel, umgekehrt.firstOrNull()?.let { (it as? StatusE)?.liste?.size }, tippt) {
        if (liste.firstVisibleItemIndex <= 1) liste.animateScrollToItem(0)
    }
    val unten by remember { derivedStateOf { liste.firstVisibleItemIndex == 0 } }
    LaunchedEffect(unten, chat.letztesEvent, chat.ungelesen) {
        if (unten) a.vm.chatGelesen(chat)
    }
    LazyColumn(
        state = liste,
        reverseLayout = true,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.Bottom),
    ) {
        if (fussSichtbar) item(key = "fuss") { ChatFuss(chat, tippt) }
        umgekehrt.forEach { e ->
            item(key = e.schluessel) {
                when (e) {
                    is FrageE -> ValeBlase(e.n, a)
                    is BefehlE -> BefehlZeile(e.n)
                    is AntwortE -> BrianAntwort(e.n, e.kopf, g.titel(chat), a)
                    is StatusE -> StatusZeilen(e, aktiv = chat.zustand == ChatZustand.ARBEITET && e === eintraege.lastOrNull())
                }
            }
            if (e.schluessel == ersteNeue) item(key = "neu") { NeuTrenner() }
        }
        if (!g.anfangErreicht && chat.nachrichten.firstOrNull()?.n?.eventId != chat.wurzel) {
            item(key = "aelter") {
                Text(
                    "Der Anfang dieses Chats liegt weiter zurück.",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Ein Befehl an Brian: klein und rechts, mit dem Modell im Klartext, wenn es `/model` ist. */
@Composable
private fun BefehlZeile(n: Nachricht) {
    val f = MaterialTheme.colorScheme
    val teile = n.text.trim().split(Regex("""\s+"""))
    val text = if (teile.firstOrNull() == "/model" && teile.size >= 2) {
        "Modell für diesen Chat: ${teile[1]}" + (teile.indexOf("--provider").takeIf { it >= 0 }?.let { i -> teile.getOrNull(i + 1)?.let { " ($it)" } } ?: "")
    } else {
        n.text.trim()
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        Surface(color = f.surfaceContainerHigh, shape = RoundedCornerShape(12.dp)) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Terminal, null, Modifier.size(14.dp), tint = f.onSurfaceVariant)
                Spacer(Modifier.width(6.dp))
                Text(text, style = MaterialTheme.typography.labelMedium, color = f.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(6.dp))
                Text(zeitText(n.zeit), style = MaterialTheme.typography.labelSmall, color = f.outline)
            }
        }
    }
}

/** „Neu“: ab hier hast du noch nicht gelesen. */
@Composable
fun NeuTrenner() {
    val f = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f), color = f.primary.copy(alpha = 0.5f))
        Text(
            "Neu",
            style = MaterialTheme.typography.labelMedium,
            color = f.primary,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp),
        )
        HorizontalDivider(Modifier.weight(1f), color = f.primary.copy(alpha = 0.5f))
    }
}

/** Kopieren: in die Zwischenablage, mit Meldung. */
@Composable
private fun kopierAktion(text: String, a: Aktionen): () -> Unit {
    val zwischenablage = LocalClipboardManager.current
    return {
        zwischenablage.setText(AnnotatedString(text))
        a.vm.melden("Nachricht kopiert.")
    }
}

/** Code setzt Claude Code um; ohne ihn der erste Agent, der Aufträge nimmt. */
private fun auftragsAgent(a: Aktionen): String? {
    val agenten = a.vm.schwarm.value.agenten.filter { it.nimmtAuftraege && a.rolle.darfAuftragAn(it.id) }
    return (agenten.firstOrNull { it.id == "claude-code" } ?: agenten.firstOrNull())?.id
}

/** Das Ziel eines Auftrags aus einer Antwort von Brian: der Chat als Kontext, gekürzt auf 1500 Zeichen. */
private fun auftragAusChat(titel: String, antwort: String): String {
    val kurz = antwort.trim().let { if (it.length <= 1500) it else it.take(1500).substringBeforeLast(' ') + " …" }
    return "Setze um, was Brian im Chat „${titel.take(60)}“ vorschlägt:\n\n$kurz"
}

/** Das Menü bei langem Druck: Kopieren und, bei Text, Vorlesen (App 2.2) und „Als Auftrag …“ (App 2.5). */
@Composable
private fun NachrichtMenue(offen: Boolean, onZu: () -> Unit, n: Nachricht, text: String?, titel: String, a: Aktionen) {
    val kopieren = kopierAktion(text ?: n.text, a)
    DropdownMenu(expanded = offen, onDismissRequest = onZu) {
        DropdownMenuItem(
            text = { Text("Kopieren") },
            leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) },
            onClick = { onZu(); kopieren() },
        )
        if (!text.isNullOrBlank()) {
            DropdownMenuItem(
                text = { Text("Vorlesen") },
                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.VolumeUp, null) },
                onClick = { onZu(); a.vm.vorlesen(text, n.raumId to n.eventId, titel, n.absender) },
            )
            // Vom Chat zum Auftrag (App 2.5): Was Brian vorschlägt, setzt ein Worker um.
            if (!n.vonMir && a.rolle.darf("auftrag")) {
                DropdownMenuItem(
                    text = { Text("Als Auftrag …") },
                    leadingIcon = { Icon(Icons.Outlined.AddTask, null) },
                    onClick = { onZu(); a.auftragMitZiel(auftragsAgent(a), auftragAusChat(titel, text)) },
                )
            }
        }
    }
}

@Composable
private fun ValeBlase(n: Nachricht, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    val datei = n.datei
    // Bei einem Anhang ist der body nur dann Text, wenn er nicht der Dateiname ist (Bildunterschrift).
    val text = if (datei != null) n.text.takeIf { it != datei.name && it.any(Char::isWhitespace) } else n.text
    val haptik = LocalHapticFeedback.current
    var menue by remember { mutableStateOf(false) }
    val form = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp)
    Column(Modifier.fillMaxWidth().padding(start = 48.dp), horizontalAlignment = Alignment.End) {
        Box {
        Surface(
            color = f.primaryContainer,
            contentColor = f.onPrimaryContainer,
            shape = form,
            modifier = Modifier
                .clip(form)
                .combinedClickable(onClick = {}, onLongClick = {
                    haptik.performHapticFeedback(HapticFeedbackType.LongPress)
                    menue = true
                }),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (datei != null) AnhangAnzeige(datei, a)
                if (text != null) Text(reicherText(text, f), style = MaterialTheme.typography.bodyLarge)
            }
        }
        NachrichtMenue(menue, { menue = false }, n, text, AllgemeinLeser.titel(n), a)
        }
        Spacer(Modifier.height(3.dp))
        val zeichen = n.reaktionen.keys.map(Lebenslauf::zeichen).filter { it in setOf("👀", "✅", "❌") }
        Text(
            zeitText(n.zeit) + if (zeichen.isNotEmpty()) "  " + zeichen.joinToString(" ") else "",
            style = MaterialTheme.typography.labelSmall,
            color = f.outline,
        )
    }
}

@Composable
private fun BrianKopf(zeit: Long) {
    val f = MaterialTheme.colorScheme
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(24.dp).clip(CircleShape).background(f.tertiaryContainer), contentAlignment = Alignment.Center) {
            Text("B", style = MaterialTheme.typography.labelMedium, color = f.onTertiaryContainer, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(8.dp))
        Text("Brian", style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.width(6.dp))
        Text(zeitText(zeit), style = MaterialTheme.typography.labelSmall, color = f.outline)
    }
}

@Composable
private fun BrianAntwort(n: Nachricht, kopf: Boolean, titel: String, a: Aktionen) {
    val kopieren = kopierAktion(n.text, a)
    val haptik = LocalHapticFeedback.current
    var menue by remember { mutableStateOf(false) }
    val datei = n.datei
    val text = if (datei != null) n.text.takeIf { it != datei.name && it.any(Char::isWhitespace) } else n.text
    Box {
    Column(
        Modifier
            .fillMaxWidth()
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
                onLongClick = {
                    haptik.performHapticFeedback(HapticFeedbackType.LongPress)
                    menue = true
                },
            ),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (kopf) BrianKopf(n.zeit)
        if (datei != null) AnhangAnzeige(datei, a)
        if (text != null) MarkdownText(text)
        if (text != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = kopieren, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Outlined.ContentCopy, "Antwort kopieren", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.outline)
                }
                // Vorlesen mit Vocarium (App 2.2).
                IconButton(onClick = { a.vm.vorlesen(text, n.raumId to n.eventId, titel, n.absender) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.VolumeUp, "Antwort vorlesen", Modifier.size(17.dp), tint = MaterialTheme.colorScheme.outline)
                }
                // Vom Chat zum Auftrag (App 2.5).
                if (a.rolle.darf("auftrag")) {
                    IconButton(onClick = { a.auftragMitZiel(auftragsAgent(a), auftragAusChat(titel, text)) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Outlined.AddTask, "Als Auftrag geben", Modifier.size(17.dp), tint = MaterialTheme.colorScheme.outline)
                    }
                }
                if (!kopf) {
                    Text(zeitText(n.zeit), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }
    NachrichtMenue(menue, { menue = false }, n, text, titel, a)
    }
}

@Composable
private fun DateiZeile(d: Datei) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.AttachFile, null, Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            d.name + (d.groesse?.let { " · ${groesseText(it)}" } ?: ""),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

/** Werkzeugzeilen und „⏳ Working“: eingeklappt nur die letzte Zeile, aufgeklappt alle. */
@Composable
private fun StatusZeilen(e: StatusE, aktiv: Boolean) {
    val f = MaterialTheme.colorScheme
    var offen by rememberSaveable(e.schluessel) { mutableStateOf(false) }
    val zeilen = remember(e.liste) {
        e.liste.flatMap { n -> n.text.lines().map(String::trim).filter(String::isNotEmpty) }
    }
    Column(Modifier.fillMaxWidth()) {
        if (e.kopf) {
            BrianKopf(e.liste.first().zeit)
            Spacer(Modifier.height(6.dp))
        }
        Surface(
            onClick = { offen = !offen },
            color = f.surfaceContainerLow,
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (aktiv) {
                        CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = f.outline)
                    } else {
                        Icon(if (offen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, Modifier.size(16.dp), tint = f.outline)
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (offen) "Schritte" else zeilen.lastOrNull().orEmpty(),
                        style = MaterialTheme.typography.labelMedium,
                        color = f.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (!offen && zeilen.size > 1) {
                        Text(" · ${zeilen.size} Schritte", style = MaterialTheme.typography.labelMedium, color = f.outline)
                    }
                    if (aktiv) {
                        Spacer(Modifier.width(4.dp))
                        Icon(if (offen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, Modifier.size(16.dp), tint = f.outline)
                    }
                }
                if (offen) {
                    zeilen.forEach { z ->
                        Text(
                            z,
                            style = MaterialTheme.typography.labelMedium,
                            color = f.onSurfaceVariant,
                            modifier = Modifier.padding(start = 24.dp, top = 3.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Der Sprachmodus unten im Chat (App 2.7): ein grosser Knopf zum Sprechen (Tippen startet, Tippen schickt), dann
 * arbeitet Brian, dann liest die App seine Antwort mit seiner Stimme vor und hört danach von selbst wieder zu.
 * Eine Runde dauert 20–40 s, weil Vocarium für den ersten Satz schon rund 15 s braucht.
 */
@Composable
private fun SprachmodusLeiste(chat: Chat?, schluessel: String, a: Aktionen) {
    val kontext = LocalContext.current
    val f = MaterialTheme.colorScheme
    val vorlesen by a.vm.vorlesen.collectAsStateWithLifecycle()
    val sendet by a.vm.sendet.collectAsStateWithLifecycle()
    var aufnahme by remember { mutableStateOf<Aufnahme?>(null) }
    var dauer by remember { mutableLongStateOf(0L) }
    var pegel by remember { mutableFloatStateOf(0f) }
    var erlaubt by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(kontext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }
    // Wer das Mikrofon eben erlaubt hat, will sprechen: Dann startet die Aufnahme gleich.
    var nachErlaubnis by remember { mutableStateOf(false) }
    val anfrage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        erlaubt = ok
        if (ok) nachErlaubnis = true else a.vm.melden("Ohne Mikrofon kein Sprachmodus.")
    }
    // Gleich nach dem ersten Senden kennt die App den neuen Chat noch nicht: Bis dahin nichts aufnehmen,
    // sonst ginge die zweite Nachricht in einen weiteren neuen Chat.
    val wartetAufChat = schluessel != "neu" && chat == null
    val arbeitet = sendet || wartetAufChat || chat?.zustand == ChatZustand.ARBEITET || chat?.zustand == ChatZustand.GESENDET
    val liest = vorlesen?.let { !it.vorbei } == true
    val starten = {
        if (!erlaubt) {
            anfrage.launch(Manifest.permission.RECORD_AUDIO)
        } else if (aufnahme == null) {
            if (liest) a.vm.vorlesenStopp()
            aufnahme = runCatching { Aufnahme(kontext).also { it.starten() } }.getOrElse {
                a.vm.melden("Aufnahme nicht möglich: ${it.message ?: it.javaClass.simpleName}")
                null
            }
        }
    }
    val schicken = {
        val auf = aufnahme
        if (auf != null) {
            val ms = auf.dauerMs
            val welle = auf.beenden(behalten = ms >= 700)
            aufnahme = null
            if (ms < 700) {
                a.vm.melden("Zu kurz. Tippe, sprich, und tippe dann noch einmal.")
            } else {
                runCatching { AnhangLeser.sprache(auf.datei, auf.mime, ms, welle) }
                    .onSuccess { an ->
                        a.vm.chatAnhangSenden(an, "", chat, { w ->
                            if (chat == null) {
                                // Aus dem neuen Chat wird ein echter: Der Sprachmodus zieht mit.
                                a.vm.sprachmodusSetzen(w)
                                a.ersetzen(Detail.ChatD(w))
                            }
                        }, {})
                    }
                    .onFailure { a.vm.melden("Die Aufnahme liess sich nicht lesen.") }
            }
        }
    }
    // Wer den Sprachmodus einschaltet, will gleich sprechen; läuft der Chat noch, wartet die App auf die Antwort.
    LaunchedEffect(Unit) {
        if (!arbeitet && !liest && (schluessel == "neu" || chat != null)) starten()
    }
    LaunchedEffect(nachErlaubnis) {
        if (nachErlaubnis) {
            nachErlaubnis = false
            starten()
        }
    }
    // Nach dem Vorlesen hört die App von selbst wieder zu.
    var lasVor by remember { mutableStateOf(false) }
    LaunchedEffect(liest) {
        if (lasVor && !liest && aufnahme == null) {
            delay(600)
            starten()
        }
        lasVor = liest
    }
    // Freihändig: Hat Vale gesprochen und ist dann 2 s still, geht die Aufnahme von selbst ab. Wo es dafür
    // zu laut ist, bleibt das Tippen; nach zwei Minuten ist in jedem Fall Schluss.
    val schickenAktuell by rememberUpdatedState(schicken)
    LaunchedEffect(aufnahme) {
        val auf = aufnahme ?: return@LaunchedEffect
        var gesprochen = false
        var stillSeit = -1L
        while (true) {
            pegel = auf.pegel()
            dauer = auf.dauerMs
            when {
                pegel >= SPRACHE_AB -> { gesprochen = true; stillSeit = -1L }
                gesprochen && pegel < STILLE_BIS -> if (stillSeit < 0) stillSeit = dauer
                else -> stillSeit = -1L
            }
            if (stillSeit >= 0 && dauer - stillSeit >= 2_000) {
                schickenAktuell()
                break
            }
            if (dauer >= 120_000) {
                if (gesprochen) {
                    schickenAktuell()
                } else {
                    auf.beenden(behalten = false)
                    aufnahme = null
                    a.vm.melden("Zwei Minuten nichts gehört: Die Aufnahme ist verworfen.")
                }
                break
            }
            delay(100)
        }
    }
    DisposableEffect(Unit) { onDispose { aufnahme?.beenden(behalten = false) } }
    val status = when {
        aufnahme != null -> "Hört zu … ${dauer / 1000} s"
        liest && vorlesen?.spielt != true && (vorlesen?.nr ?: 1) <= 1 -> "Brians Stimme wird vorbereitet …"
        liest -> "Liest Brians Antwort vor …"
        arbeitet -> "Brian denkt nach …"
        else -> "Tippe und sprich"
    }
    Surface(color = f.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(
            Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).padding(vertical = 12.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(status, style = MaterialTheme.typography.titleSmall, color = if (aufnahme != null) f.error else f.onSurface)
            if (aufnahme != null) {
                Text("Eine Pause schickt ab – oder tippe.", style = MaterialTheme.typography.bodySmall, color = f.onSurfaceVariant)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(104.dp), contentAlignment = Alignment.Center) {
                    if (aufnahme != null) {
                        Box(Modifier.size(72.dp + 32.dp * pegel).clip(CircleShape).background(f.error.copy(alpha = 0.25f)))
                    }
                    Box(
                        Modifier
                            .size(72.dp)
                            .clip(CircleShape)
                            .background(if (aufnahme != null) f.error else if (arbeitet) f.onSurface.copy(alpha = 0.12f) else f.primary)
                            .clickable(enabled = !arbeitet || aufnahme != null) { if (aufnahme != null) schicken() else starten() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (aufnahme != null) Icons.AutoMirrored.Outlined.Send else Icons.Outlined.Mic,
                            if (aufnahme != null) "Senden" else "Sprechen",
                            tint = if (aufnahme != null) f.onError else if (arbeitet) f.onSurface.copy(alpha = 0.38f) else f.onPrimary,
                            modifier = Modifier.size(34.dp),
                        )
                    }
                }
                if (liest) {
                    Spacer(Modifier.width(8.dp))
                    OutlinedButton(onClick = { a.vm.vorlesenStopp() }) { Text("Nicht vorlesen") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (aufnahme != null) {
                    TextButton(onClick = { aufnahme?.beenden(behalten = false); aufnahme = null }) { Text("Verwerfen") }
                }
                TextButton(onClick = { aufnahme?.beenden(behalten = false); aufnahme = null; a.vm.sprachmodusSetzen(null) }) {
                    Text("Sprachmodus beenden")
                }
            }
        }
    }
}

/** Pegel (0–1, aus [Aufnahme.pegel]): ab hier spricht jemand, darunter ist es still. */
private const val SPRACHE_AB = 0.45f
private const val STILLE_BIS = 0.3f

/** Unten im Chat: Brian schreibt, arbeitet, wartet – oder was schiefging. */
@Composable
private fun ChatFuss(chat: Chat, tippt: Boolean) {
    val f = MaterialTheme.colorScheme
    val (text, farbe, dreht) = when (chat.zustand) {
        ChatZustand.ARBEITET -> Triple(if (tippt) "Brian schreibt …" else "Brian arbeitet …", f.primary, true)
        ChatZustand.GESENDET -> Triple("Gesendet, wartet auf Brian …", f.onSurfaceVariant, true)
        ChatZustand.FEHLER -> Triple("Brian meldet einen Fehler (❌). Schreib, was er anders machen soll, oder frag neu.", f.error, false)
        ChatZustand.GESTOPPT -> Triple("Gestoppt.", f.onSurfaceVariant, false)
        ChatZustand.OFFEN -> Triple("Noch keine Antwort. Ist Brian erreichbar? Unter „Schwarm“ steht sein Stand.", f.onSurfaceVariant, false)
        ChatZustand.FERTIG -> Triple("", f.onSurfaceVariant, false)
    }
    if (text.isEmpty()) return
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
        if (dreht) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = farbe)
            Spacer(Modifier.width(10.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = farbe)
    }
}

/** Solange Brian arbeitet: wie lange schon, und ein Knopf für `/stop`. */
@Composable
private fun StoppLeiste(chat: Chat, g: Allgemein, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    val jetzt = rememberJetzt()
    val seit = chat.nachrichten.lastOrNull { it.art == ChatArt.FRAGE }?.n?.zeit ?: chat.start
    val minuten = ((jetzt - seit) / 60_000).coerceAtLeast(0)
    Surface(color = f.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 10.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                (if (g.brianTippt) "Brian schreibt" else "Brian arbeitet") + if (minuten > 0) " seit $minuten min" else " …",
                style = MaterialTheme.typography.labelLarge,
                color = f.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(onClick = { a.vm.chatStoppen(chat) }, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp)) {
                Icon(Icons.Outlined.Stop, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Stopp")
            }
        }
    }
}

/** Ein Bild aus Allgemein; Tippen zeigt es gross. */
@Composable
fun BildAnsicht(datei: Datei, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    val bilder by a.vm.bilder.collectAsStateWithLifecycle()
    val mxc = datei.mxc
    LaunchedEffect(mxc) { mxc?.let { a.vm.bildLaden(it) } }
    var gross by remember { mutableStateOf(false) }
    val b = datei.breite
    val h = datei.hoehe
    val verhaeltnis = if (b != null && h != null && b > 0 && h > 0) (b.toFloat() / h).coerceIn(0.5f, 2.2f) else 4f / 3f
    val ladung = mxc?.let { bilder[it] }
    Box(
        Modifier
            .widthIn(max = 300.dp)
            .fillMaxWidth()
            .aspectRatio(verhaeltnis)
            .clip(RoundedCornerShape(14.dp))
            .background(f.surfaceContainerHighest)
            .clickable(enabled = ladung is BildLadung.Fertig) { gross = true },
        contentAlignment = Alignment.Center,
    ) {
        when (ladung) {
            is BildLadung.Fertig -> Image(ladung.bild, "Bild", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            is BildLadung.Fehler -> Text(
                ladung.grund,
                style = MaterialTheme.typography.bodySmall,
                color = f.onSurfaceVariant,
                modifier = Modifier.padding(12.dp),
            )
            else -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        }
    }
    if (gross && ladung is BildLadung.Fertig) {
        Dialog(onDismissRequest = { gross = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(
                Modifier.fillMaxSize().background(Color.Black).clickable { gross = false },
                contentAlignment = Alignment.Center,
            ) {
                Image(ladung.bild, "Bild", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

/**
 * Die Eingabe von Allgemein: mehrzeilig (Enter macht eine neue Zeile), Senden per Knopf, Anhänge aller
 * Art über die Büroklammer und eine Sprachnachricht mit dem Mikrofon (gedrückt halten). Geht etwas
 * schief, kommen Text und Anhang zurück in die Eingabe.
 */
@Composable
private fun ChatEingabe(
    /** Je Chat ein eigener Entwurf. */
    schluessel: String,
    aktiv: Boolean,
    sendet: Boolean,
    hinweis: String,
    vorbelegt: Geteilt?,
    onVorbelegt: () -> Unit,
    a: Aktionen,
    onSenden: (text: String, anhang: Anhang?, zurueckholen: () -> Unit) -> Unit,
) {
    val f = MaterialTheme.colorScheme
    var feld by rememberSaveable(schluessel, stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("")) }
    val stand = remember(schluessel) { AnhangStand() }
    val wege = rememberAnhangWege(stand, a.vm)
    val pdfSeiten by a.vm.pdfSeiten.collectAsStateWithLifecycle()
    AnhangMenue(stand, wege) {
        // Nur in Allgemein: Brian liest PDFs in Matrix nicht, Bilder schon.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Seiten für Brian als Bilder mitschicken", style = MaterialTheme.typography.bodyLarge)
                Text(
                    "Bei einer PDF die ersten 8 Seiten, gleich nach der Datei",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = pdfSeiten, onCheckedChange = { a.vm.pdfSeitenSetzen(it) })
        }
    }
    val kontext = LocalContext.current
    // „Teilen → Schwarm“: Text und Bild übernehmen, einmal.
    LaunchedEffect(vorbelegt) {
        val v = vorbelegt ?: return@LaunchedEffect
        if (v.text.isNotEmpty()) feld = TextFieldValue(v.text, TextRange(v.text.length))
        v.bild?.let { uri ->
            stand.laedt = true
            try {
                stand.anhang = withContext(Dispatchers.IO) { AnhangLeser.vorbereiten(kontext, uri, true) }
            } catch (e: Exception) {
                a.vm.melden("Das Bild liess sich nicht lesen: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                stand.laedt = false
            }
        }
        onVorbelegt()
    }
    val senden = {
        val text = feld.text.trim()
        val an = stand.anhang
        if ((text.isNotEmpty() || an != null) && !sendet && !stand.laedt) {
            feld = TextFieldValue("")
            stand.anhang = null
            onSenden(text, an) {
                feld = TextFieldValue(text, TextRange(text.length))
                stand.anhang = an
            }
        }
    }
    Surface(color = f.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(
            Modifier
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
                .padding(horizontal = 8.dp, vertical = 8.dp),
        ) {
            AnhangVorschau(stand, stand.anhang?.let { BrianHilfe.hinweis(it, pdfSeiten) })
            Row(verticalAlignment = Alignment.Bottom) {
                AnhangKnopf(stand, aktiv)
                if (stand.aufnahme != null) {
                    AufnahmeZeile(stand, Modifier.weight(1f))
                } else {
                    OutlinedTextField(
                        value = feld,
                        onValueChange = { feld = it },
                        placeholder = { Text(hinweis, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.weight(1f),
                        enabled = aktiv,
                        minLines = 1,
                        maxLines = 8,
                        shape = RoundedCornerShape(24.dp),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                            imeAction = ImeAction.Default,
                        ),
                    )
                }
                Spacer(Modifier.width(6.dp))
                // Ohne Text und Anhang: das Mikrofon; loslassen sendet die Sprachnachricht gleich.
                if (stand.aufnahme != null || (feld.text.isBlank() && stand.anhang == null && !stand.laedt)) {
                    SprachKnopf(stand, aktiv && !sendet, a.vm) { an -> onSenden("", an) {} }
                } else {
                    SendenKnopf(aktiv && !stand.laedt && (feld.text.isNotBlank() || stand.anhang != null), sendet) { senden() }
                }
            }
        }
    }
}

/** Die erste Zeile eines Chats für „Aktuell“ und die Räume: Titel ohne Markdown. */
fun chatZeile(n: Nachricht): String = AllgemeinLeser.ersteZeile(n)
