@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Difference
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.swarm.data.Anhang
import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.Verlauf
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchwarmLeiste(
    titel: String,
    untertitel: String? = null,
    zurueck: (() -> Unit)? = null,
    /** Tippen auf den Titel öffnet den Schnellwechsler der Räume (App 2.1). */
    onTitel: (() -> Unit)? = null,
    aktionen: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Column(
                if (onTitel != null) {
                    Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClickLabel = "Raum wechseln", onClick = onTitel)
                        .padding(end = 6.dp)
                } else {
                    Modifier
                },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(titel, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (onTitel != null) {
                        Icon(
                            Icons.Outlined.ArrowDropDown,
                            null,
                            Modifier.size(22.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (untertitel != null) {
                    Text(
                        untertitel,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        navigationIcon = {
            if (zurueck != null) {
                IconButton(onClick = zurueck) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
            }
        },
        actions = aktionen,
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

@Composable
fun NachrichtenListe(
    verlauf: Verlauf,
    modifier: Modifier = Modifier,
    nachrichten: List<Nachricht> = verlauf.nachrichten,
    onAeltere: (() -> Unit)? = null,
    onReaktion: ((Nachricht, String) -> Unit)? = null,
    onAuftrag: ((String) -> Unit)? = null,
    aktuellerAuftrag: String? = null,
    kopf: (@Composable () -> Unit)? = null,
    /** Was unter einer Nachricht steht: Knöpfe für Pläne und Tore, der Weg zum Patch. */
    zusatz: (@Composable (Nachricht) -> Unit)? = null,
    /** Ab wann Nachrichten anderer neu sind: Dort steht der Trenner „Neu“ (App 2.1). */
    neuAb: Long? = null,
    /** Ganz unten angekommen: Die Oberfläche meldet dann „gelesen“. */
    onUnten: (() -> Unit)? = null,
    /** Mit Aktionen zeigt die Blase Anhänge zum Abspielen und Öffnen und das Menü mit „Vorlesen“ (App 2.2). */
    a: Aktionen? = null,
) {
    val liste = rememberLazyListState()
    val umgekehrt = remember(nachrichten) { nachrichten.asReversed() }
    val ersteNeue = remember(nachrichten, neuAb) {
        neuAb?.let { ab -> nachrichten.firstOrNull { !it.vonMir && it.zeit > ab }?.eventId }
    }
    val neuIndex = remember(umgekehrt, ersteNeue) { ersteNeue?.let { id -> umgekehrt.indexOfFirst { it.eventId == id } + 1 } ?: -1 }
    val scope = rememberCoroutineScope()
    // Neue Nachrichten unten: mitscrollen, solange man ganz unten ist.
    LaunchedEffect(umgekehrt.firstOrNull()?.eventId) {
        if (liste.firstVisibleItemIndex <= 1) liste.animateScrollToItem(0)
    }
    val unten by remember { derivedStateOf { liste.firstVisibleItemIndex == 0 } }
    if (onUnten != null) {
        LaunchedEffect(unten, umgekehrt.firstOrNull()?.eventId) { if (unten && umgekehrt.isNotEmpty()) onUnten() }
    }
    // Der Trenner liegt über dem sichtbaren Teil: „Zum Ungelesenen“ zeigen.
    val trennerOben by remember(neuIndex) {
        derivedStateOf {
            neuIndex > 0 && (liste.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) < neuIndex
        }
    }
    val weitOben by remember { derivedStateOf { liste.firstVisibleItemIndex > 3 } }
    Box(modifier.fillMaxSize()) {
    LazyColumn(
        state = liste,
        reverseLayout = true,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom),
    ) {
        umgekehrt.forEach { n ->
            item(key = n.eventId) {
                NachrichtBlase(
                    n, onReaktion, onAuftrag.takeIf { n.auftragId != aktuellerAuftrag },
                    onNummer = onAuftrag,
                    unten = zusatz?.let { z -> { z(n) } },
                    a = a,
                )
            }
            if (n.eventId == ersteNeue) item(key = "neu") { NeuTrenner() }
        }
        if (onAeltere != null && !verlauf.anfangErreicht && verlauf.aeltereVon != null) {
            item(key = "aeltere") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    if (verlauf.laedtAeltere) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    } else {
                        TextButton(onClick = onAeltere) { Text("Ältere Nachrichten laden") }
                    }
                }
            }
        }
        if (kopf != null) item(key = "kopf") { kopf() }
    }
    if (trennerOben) {
        Surface(
            onClick = {
                scope.launch {
                    // Umgekehrt liegt der Anfang unten: Ein negativer Versatz hebt den Trenner ins obere
                    // Drittel, darunter steht das Neue.
                    val hoehe = liste.layoutInfo.viewportSize.height
                    liste.scrollToItem(neuIndex, -(hoehe * 0.7f).toInt())
                }
            },
            shape = RoundedCornerShape(50),
            color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
            shadowElevation = 3.dp,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
        ) {
            Row(Modifier.padding(start = 10.dp, end = 14.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.KeyboardArrowUp, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Zum Ungelesenen", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
    if (weitOben) {
        SmallFloatingActionButton(
            onClick = { scope.launch { liste.animateScrollToItem(0) } },
            modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
        ) { Icon(Icons.Outlined.KeyboardArrowDown, "Zu den neuesten") }
    }
    }
}

@Composable
fun NachrichtBlase(
    n: Nachricht,
    onReaktion: ((Nachricht, String) -> Unit)? = null,
    onAuftrag: ((String) -> Unit)? = null,
    /** Auftragsnummern im Text antippbar machen (Punkt 9). */
    onNummer: ((String) -> Unit)? = null,
    unten: (@Composable () -> Unit)? = null,
    a: Aktionen? = null,
) {
    val f = MaterialTheme.colorScheme
    var menue by remember { mutableStateOf(false) }
    val zwischenablage = LocalClipboardManager.current
    val haptik = LocalHapticFeedback.current
    val form = RoundedCornerShape(
        topStart = if (n.vonMir) 18.dp else 4.dp,
        topEnd = if (n.vonMir) 4.dp else 18.dp,
        bottomStart = 18.dp,
        bottomEnd = 18.dp,
    )
    val hintergrund = when {
        n.vonMir -> f.primaryContainer
        n.vomHub -> f.surfaceContainerHigh
        else -> f.secondaryContainer
    }
    val vordergrund = when {
        n.vonMir -> f.onPrimaryContainer
        n.vomHub -> f.onSurface
        else -> f.onSecondaryContainer
    }
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (n.vonMir) Alignment.End else Alignment.Start,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (n.vonMir) "Du" else n.absenderName,
                style = MaterialTheme.typography.labelMedium,
                color = if (n.vomHub) f.primary else f.onSurfaceVariant,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                zeitText(n.zeit) + if (n.bearbeitet) " · bearbeitet" else "",
                style = MaterialTheme.typography.labelSmall,
                color = f.outline,
            )
        }
        Spacer(Modifier.height(3.dp))
        Box {
        Surface(
            color = hintergrund,
            contentColor = vordergrund,
            shape = form,
            // Langes Drücken: Kopieren und Vorlesen (App 2.2).
            modifier = Modifier.widthIn(max = 620.dp).clip(form).combinedClickable(
                onClick = {},
                onLongClick = {
                    haptik.performHapticFeedback(HapticFeedbackType.LongPress)
                    menue = true
                },
            ),
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                val datei = n.datei
                if (datei != null && a != null && !datei.istPatch) {
                    AnhangAnzeige(datei, a)
                    // Ein Text neben dem Dateinamen ist die Bildunterschrift.
                    if (n.text != datei.name && n.text.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(reicherText(n.text, f, onNummer), style = MaterialTheme.typography.bodyLarge)
                    }
                } else if (datei != null) {
                    // Ein Anhang: Name und Grösse statt des Dateinamens als Text.
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (datei.istPatch) Icons.Outlined.Difference else Icons.Outlined.AttachFile,
                            null,
                            Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            datei.name + (datei.groesse?.let { " · ${groesseText(it)}" } ?: ""),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                } else {
                    Text(
                        reicherText(n.text, f, onNummer),
                        style = if (n.vomHub && n.notice) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
                    )
                }
                if (n.auftragId != null && onAuftrag != null) {
                    AssistChip(
                        onClick = { onAuftrag(n.auftragId) },
                        label = { Text("Auftrag ${n.auftragId} öffnen") },
                        leadingIcon = { Icon(Icons.Outlined.TaskAlt, null, Modifier.size(18.dp)) },
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
        DropdownMenu(expanded = menue, onDismissRequest = { menue = false }) {
            DropdownMenuItem(
                text = { Text("Kopieren") },
                leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) },
                onClick = {
                    menue = false
                    zwischenablage.setText(AnnotatedString(n.text))
                    a?.vm?.melden("Nachricht kopiert.")
                },
            )
            if (a != null && n.text.isNotBlank() && n.datei == null) {
                DropdownMenuItem(
                    text = { Text("Vorlesen") },
                    leadingIcon = { Icon(Icons.AutoMirrored.Outlined.VolumeUp, null) },
                    onClick = {
                        menue = false
                        a.vm.vorlesen(n.text, n.raumId to n.eventId, ersteZeile(n.text).take(60), n.absender)
                    },
                )
            }
        }
        }
        if (n.reaktionen.isNotEmpty()) {
            Row(
                Modifier.padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                n.reaktionen.forEach { (zeichen, anzahl) ->
                    val eigen = zeichen in n.eigeneReaktionen
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = if (eigen) f.primary.copy(alpha = 0.18f) else f.surfaceContainerHighest,
                        onClick = { onReaktion?.invoke(n, zeichen) },
                        enabled = onReaktion != null && !eigen,
                    ) {
                        Text(
                            if (anzahl > 1) "$zeichen $anzahl" else zeichen,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
        unten?.invoke()
    }
}

/** „12 KB“, „1.4 MB“: die Grösse eines Anhangs. */
fun groesseText(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> "%.1f MB".format(java.util.Locale.US, bytes / 1024.0 / 1024.0)
}

/**
 * Eingabezeile unten. Rückt über Tastatur und Navigationsleiste — was die äussere
 * Scaffold schon belegt (Bottom-Navigation), zieht `windowInsetsPadding` selbst ab.
 */
@Composable
fun Eingabe(
    hinweis: String,
    onSenden: (String) -> Unit,
    modifier: Modifier = Modifier,
    vorschlaege: List<String> = emptyList(),
    aktiv: Boolean = true,
    vorbelegt: String = "",
    /** Zählt hoch, wenn derselbe Text noch einmal vorbelegt werden soll (Befehlspalette). */
    vorbelegtNr: Int = 0,
    /**
     * Anhänge und Sprachnachricht (App 2.2): bekommt Anhang, Text und ein „zurückholen“, falls das Senden
     * scheitert. Ohne diesen Weg gibt es nur Text, etwa in der Lobby.
     */
    anhang: ((Anhang, String, () -> Unit) -> Unit)? = null,
    vm: SchwarmViewModel? = null,
    sendet: Boolean = false,
) {
    // Mit TextFieldValue, damit der Cursor bei einem vorbelegten Befehl am Ende steht.
    var feld by rememberSaveable(vorbelegt, vorbelegtNr, stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(vorbelegt, TextRange(vorbelegt.length)))
    }
    val fokus = remember { FocusRequester() }
    LaunchedEffect(vorbelegtNr) {
        if (vorbelegtNr > 0 && aktiv) runCatching { fokus.requestFocus() }
    }
    val f = MaterialTheme.colorScheme
    val stand = remember { AnhangStand() }
    val wege = if (anhang != null && vm != null) rememberAnhangWege(stand, vm) else null
    if (wege != null) AnhangMenue(stand, wege)
    val senden = {
        val t = feld.text.trim()
        val an = stand.anhang
        if (an != null && anhang != null) {
            feld = TextFieldValue("")
            stand.anhang = null
            anhang(an, t) {
                feld = TextFieldValue(t, TextRange(t.length))
                stand.anhang = an
            }
        } else if (t.isNotEmpty()) {
            onSenden(t)
            feld = TextFieldValue("")
        }
    }
    Surface(color = f.surfaceContainer, modifier = modifier.fillMaxWidth()) {
        Column(Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))) {
            if (anhang != null) Box(Modifier.padding(top = 8.dp)) { AnhangVorschau(stand) }
            if (vorschlaege.isNotEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(start = 12.dp, end = 12.dp, top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    vorschlaege.forEach { v ->
                        SuggestionChip(
                            onClick = { if (v.endsWith(" ")) feld = TextFieldValue(v, TextRange(v.length)) else onSenden(v) },
                            label = { Text(v.trim()) },
                            enabled = aktiv,
                        )
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (anhang != null) AnhangKnopf(stand, aktiv)
                if (stand.aufnahme != null) {
                    AufnahmeZeile(stand, Modifier.weight(1f))
                } else {
                    OutlinedTextField(
                        value = feld,
                        onValueChange = { feld = it },
                        placeholder = { Text(hinweis, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.weight(1f).focusRequester(fokus),
                        enabled = aktiv,
                        maxLines = 6,
                        shape = RoundedCornerShape(22.dp),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                            imeAction = ImeAction.Default,
                        ),
                    )
                }
                Spacer(Modifier.width(8.dp))
                // Ohne Text und Anhang: das Mikrofon für die Sprachnachricht (gedrückt halten).
                if (anhang != null && vm != null && (stand.aufnahme != null || (feld.text.isBlank() && stand.anhang == null && !stand.laedt))) {
                    SprachKnopf(stand, aktiv && !sendet, vm) { an -> anhang(an, "") {} }
                } else {
                    SendenKnopf(aktiv && (feld.text.isNotBlank() || stand.anhang != null) && !stand.laedt, sendet) { senden() }
                }
            }
        }
    }
}
