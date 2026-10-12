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
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Alarm
import com.claudewebui.swarm.data.AlarmStufe
import com.claudewebui.swarm.data.AlarmZustand
import com.claudewebui.swarm.data.FREIGABE_FRIST_MIN
import com.claudewebui.swarm.data.Freigabe
import com.claudewebui.swarm.data.FreigabeZustand
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Verlauf
import java.util.Locale

/** Freigaben, Alarme und Log: die Räume des Hubs mit eigener Liste (bis App 2.3 der Bereich „Meldungen“). */
enum class Kanal(val titel: String) { FREIGABEN("Freigaben"), ALARME("Alarme"), LOG("Log") }

// ── Freigaben, Alarme und Log als eigene Seite (App 2.4) ────────────────────

/**
 * Freigaben, Alarme oder das Protokoll des Hubs, geöffnet aus „Räume“. Was davon auf dich wartet, steht
 * zusätzlich in „Aktuell“; hier ist die ganze Liste mit Entschiedenem und Behobenem. Die Knöpfe setzen
 * nur Reaktionen aus deinem Konto, wie in Element (ADR-003 R5).
 */
@Composable
fun KanalAnsicht(kanal: Kanal, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    // Der offene Teil gilt als gelesen (App 2.1).
    val raum = when (kanal) {
        Kanal.FREIGABEN -> z.raeume.freigaben
        Kanal.ALARME -> z.raeume.alarme
        Kanal.LOG -> z.raeume.log
    }
    LaunchedEffect(raum, raum?.let { z.verlauf(it).nachrichten.lastOrNull()?.eventId }) { raum?.let { a.vm.gelesen(it) } }
    val jetzt = jetztBisFrist(z.freigaben.map { it.ablauf } + z.alarme.flatMap { it.fristen })
    Scaffold(
        topBar = {
            SchwarmLeiste(
                kanal.titel,
                when (kanal) {
                    Kanal.FREIGABEN -> z.freigaben.count { it.brauchtDichUm(jetzt) }.let {
                        when (it) { 0 -> "nichts offen"; 1 -> "1 wartet auf dich"; else -> "$it warten auf dich" }
                    }
                    Kanal.ALARME -> z.alarme.count { it.offenUm(jetzt) }.let { if (it > 0) "$it offen" else "nichts offen" }
                    Kanal.LOG -> "Protokoll des Hubs"
                },
                zurueck = if (a.zurueckPfeil) zurueck else null,
                onTitel = a.schnellwahl,
            ) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            if (z.alterStand) StandHinweis(z, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), knapp = true)
            Box(Modifier.weight(1f)) {
                when (kanal) {
                    Kanal.FREIGABEN -> FreigabenListe(z, a)
                    Kanal.ALARME -> AlarmListe(z, a)
                    Kanal.LOG -> LogListe(z, a)
                }
            }
        }
    }
}

// ── Freigaben ───────────────────────────────────────────────────────────────

@Composable
private fun FreigabenListe(z: SchwarmZustand, a: Aktionen) {
    val raum = z.raeume.freigaben
    if (raum == null || raum !in z.beigetreten) {
        LeerHinweis(
            Icons.Outlined.NotificationsNone,
            "Raum nicht beigetreten",
            "Freigaben stehen in #schwarm-freigaben. Tritt den Schwarm-Räumen bei (Räume → Allen beitreten).",
        )
        return
    }
    val jetzt = jetztBisFrist(z.freigaben.map { it.ablauf })
    // Die dringendste zuerst; Entschiedenes und Abgelaufenes wandert in den Verlauf.
    val offen = z.freigaben.filter { it.offenUm(jetzt) }.sortedBy { it.ablauf }
    val erledigt = z.freigaben.filterNot { it.offenUm(jetzt) }
    val nurLesen = z.nurLesen[raum].orEmpty()
    var zeigeErledigt by rememberSaveable { mutableStateOf(false) }
    var zeigeAlt by rememberSaveable { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (offen.isEmpty()) {
            item(key = "leer") {
                RuhigKarte(
                    Icons.Outlined.VerifiedUser,
                    "Keine Freigabe offen",
                    "Übergaben an Agenten mit Host-Zugriff und gelbe Betriebsaktionen erscheinen hier. Du entscheidest " +
                        "mit Freigeben oder Ablehnen; ohne Entscheid läuft eine Anfrage nach $FREIGABE_FRIST_MIN min ab.",
                )
            }
        }
        items(offen, key = { it.eventId }) { f ->
            FreigabeKarte(f, a, jetzt, onOeffnen = { a.meldungOeffnen(raum, f.eventId) })
        }
        if (erledigt.isNotEmpty()) {
            item(key = "erledigt") {
                Aufklappen("Entschieden und abgelaufen", erledigt.size, zeigeErledigt) { zeigeErledigt = !zeigeErledigt }
            }
            if (zeigeErledigt) {
                items(erledigt, key = { "e-" + it.eventId }) { f -> FreigabeZeile(f, jetzt) { a.meldungOeffnen(raum, f.eventId) } }
            }
        }
        if (nurLesen.isNotEmpty()) {
            item(key = "alt") { Aufklappen("Ältere Notices ohne Knöpfe", nurLesen.size, zeigeAlt) { zeigeAlt = !zeigeAlt } }
            if (zeigeAlt) items(nurLesen.asReversed(), key = { "a-" + it.eventId }) { NachrichtBlase(it) }
        }
        aeltereLaden(z.verlauf(raum)) { a.vm.aeltereLaden(raum) }
        item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
    }
}

/** Eine Freigabe mit allem, was du zum Entscheiden brauchst. In der Liste öffnet ein Tippen den Thread. */
@Composable
fun FreigabeKarte(f: Freigabe, a: Aktionen, jetzt: Long, onOeffnen: (() -> Unit)? = null, kompakt: Boolean = false) {
    val farben = MaterialTheme.colorScheme
    val zustand = f.zustandUm(jetzt)
    val akzent = freigabeFarbe(zustand, farben)
    KartenFlaeche(akzent, onOeffnen) {
        KopfZeile(f.auftragId, "${zustand.zeichen} ${zustand.titel}", akzent, vorText(f.gesendet))
        Text(listOfNotNull("An ${f.ziel}", f.stufe).joinToString(" · "), style = MaterialTheme.typography.titleMedium)
        Text(
            reicherText(f.was.ifBlank { "(ohne Angabe)" }, farben),
            style = MaterialTheme.typography.bodyLarge,
            maxLines = if (kompakt) 3 else Int.MAX_VALUE,
            overflow = TextOverflow.Ellipsis,
        )
        // Kompakt (in „Aktuell“) stehen Kette und Grenzen in der Rückfrage vor dem Freigeben.
        if (!kompakt) {
            if (f.kette.isNotBlank()) Feld("Kette", f.kette)
            f.ergebnis?.let { Feld("Ergebnis", it) }
            Feld("Grenzen", f.grenzen ?: "keine")
        }
        if (zustand == FreigabeZustand.OFFEN) {
            Countdown(f.ablauf)
            FreigabeKnoepfe(f, a)
        } else {
            Text(freigabeQuittung(f, zustand), style = MaterialTheme.typography.bodyMedium, color = akzent)
        }
    }
}

/** Was der Hub quittiert hat, mit Uhrzeit; ohne Quittung zählt die Frist. */
fun freigabeQuittung(f: Freigabe, zustand: FreigabeZustand): String {
    val um = " um ${zeitText(f.quittiert ?: f.ablauf)}"
    return when (zustand) {
        FreigabeZustand.FREIGEGEBEN -> "✅ freigegeben$um"
        FreigabeZustand.ABGELEHNT -> "❌ abgelehnt$um"
        FreigabeZustand.ABGELAUFEN -> "⌛ abgelaufen$um" + if (f.quittiert == null) " · ohne Quittung des Hubs" else ""
        FreigabeZustand.OFFEN -> "🔐 wartet auf deinen Entscheid"
    }
}

/** „läuft ab in 12:34 · um 14:32“, jede Sekunde neu; in den letzten 5 min rot. */
@Composable
fun Countdown(bis: Long) {
    val jetzt = rememberJetzt()
    val rest = ((bis - jetzt) / 1000).coerceAtLeast(0)
    val farbe = if (rest < 5 * 60) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Timer, null, Modifier.size(18.dp), tint = farbe)
        Spacer(Modifier.width(6.dp))
        Text(
            "läuft ab in ${rest / 60}:${(rest % 60).toString().padStart(2, '0')} · um ${zeitText(bis)}",
            style = MaterialTheme.typography.labelLarge,
            color = farbe,
        )
    }
}

/**
 * Freigeben (✅) mit Rückfrage, Ablehnen (❌) ohne. Ist deine Reaktion unterwegs oder schon im Raum,
 * wartet die Karte auf die Quittung des Hubs im Thread.
 */
@Composable
fun FreigabeKnoepfe(f: Freigabe, a: Aktionen) {
    val unterwegs by a.vm.unterwegs.collectAsStateWithLifecycle()
    var frage by remember { mutableStateOf(false) }
    val gesendet = f.meineReaktion ?: listOf("✅", "❌").firstOrNull { "${f.eventId}|$it" in unterwegs }
    if (gesendet != null) {
        Wartet("$gesendet gesendet, wartet auf Quittung")
    } else {
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = { a.vm.freigabeEntscheiden(f, freigeben = false) }) {
                Icon(Icons.Outlined.Block, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Ablehnen")
            }
            Button(onClick = { frage = true }) {
                Icon(Icons.Outlined.Check, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Freigeben")
            }
        }
    }
    if (frage) {
        FreigebenDialog(
            f,
            onFreigeben = {
                frage = false
                a.vm.freigabeEntscheiden(f, freigeben = true)
            },
            onAbbrechen = { frage = false },
        )
    }
}

/** Freigeben lässt einen Agenten mit Zugriff auf den Host loslegen: darum die Rückfrage mit Ziel und Auftrag. */
@Composable
private fun FreigebenDialog(f: Freigabe, onFreigeben: () -> Unit, onAbbrechen: () -> Unit) {
    val farben = MaterialTheme.colorScheme
    AlertDialog(
        onDismissRequest = onAbbrechen,
        icon = { Icon(Icons.Outlined.LockOpen, null, tint = Warnorange) },
        title = { Text("${f.auftragId} an ${f.ziel} freigeben?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Mit deinem ✅ führt ${f.ziel}${f.stufe?.let { " ($it)" }.orEmpty()} mit Zugriff auf den Host aus:",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Surface(color = farben.surfaceContainerHighest, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(
                        reicherText(f.was.ifBlank { "(ohne Angabe)" }, farben),
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.padding(12.dp),
                    )
                }
                if (f.kette.isNotBlank()) Feld("Kette", f.kette)
                Feld("Grenzen", f.grenzen ?: "keine")
                Text(
                    "Die Freigabe selbst lässt sich nicht zurücknehmen; abbrechen kannst du den Auftrag danach mit 🛑.",
                    style = MaterialTheme.typography.bodySmall,
                    color = farben.onSurfaceVariant,
                )
            }
        },
        confirmButton = { Button(onClick = onFreigeben) { Text("Freigeben") } },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text("Abbrechen") } },
    )
}

@Composable
private fun FreigabeZeile(f: Freigabe, jetzt: Long, onClick: () -> Unit) {
    val farben = MaterialTheme.colorScheme
    val zustand = f.zustandUm(jetzt)
    Surface(onClick = onClick, shape = RoundedCornerShape(14.dp), color = farben.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            KopfZeile(f.auftragId, "${zustand.zeichen} ${zustand.titel}", freigabeFarbe(zustand, farben), zeitText(f.quittiert ?: f.ablauf))
            Text(
                "An ${f.ziel}: ${f.was}",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ── Alarme ──────────────────────────────────────────────────────────────────

@Composable
private fun AlarmListe(z: SchwarmZustand, a: Aktionen) {
    val raum = z.raeume.alarme
    if (raum == null || raum !in z.beigetreten) {
        LeerHinweis(
            Icons.Outlined.NotificationsNone,
            "Raum nicht beigetreten",
            "Alarme stehen in #schwarm-alarme. Tritt den Schwarm-Räumen bei (Räume → Allen beitreten).",
        )
        return
    }
    val jetzt = jetztBisFrist(z.alarme.flatMap { it.fristen })
    // Offen: kritisch vor Warnung vor Info, stumme ans Ende ihrer Stufe, neue zuerst.
    val offen = z.alarme.filter { it.offenUm(jetzt) }.sortedWith(
        compareByDescending<Alarm> { it.stufe.ordinal }.thenBy { it.stummUm(jetzt) }.thenByDescending { it.zeit },
    )
    val erledigt = z.alarme.filterNot { it.offenUm(jetzt) }.sortedByDescending { it.beendet ?: it.zuletzt }
    val einfach = z.nurLesen[raum].orEmpty()
    var zeigeErledigt by rememberSaveable { mutableStateOf(false) }
    var zeigeEinfach by rememberSaveable { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (offen.isEmpty()) {
            item(key = "leer") {
                RuhigKarte(
                    Icons.Outlined.TaskAlt,
                    "Kein Alarm offen",
                    "Alarme mit Fingerabdruck erscheinen hier, die schlimmsten zuerst. Quittieren mit ✅: Der Alarm " +
                        "bleibt still, bis er behoben ist oder schlimmer wird. 24 h stumm mit 🔕. Kritisches kommt " +
                        "zusätzlich über ntfy.",
                )
            }
        }
        items(offen, key = { it.eventId }) { al -> AlarmKarte(al, a, jetzt, onOeffnen = { a.meldungOeffnen(raum, al.eventId) }) }
        if (erledigt.isNotEmpty()) {
            item(key = "erledigt") {
                Aufklappen("Behoben und quittiert", erledigt.size, zeigeErledigt) { zeigeErledigt = !zeigeErledigt }
            }
            if (zeigeErledigt) {
                items(erledigt, key = { "e-" + it.eventId }) { al -> AlarmZeile(al, jetzt) { a.meldungOeffnen(raum, al.eventId) } }
            }
        }
        if (einfach.isNotEmpty()) {
            item(key = "einfach") {
                Aufklappen("Meldungen ohne Lebenslauf", einfach.size, zeigeEinfach) { zeigeEinfach = !zeigeEinfach }
            }
            if (zeigeEinfach) items(einfach.asReversed(), key = { "m-" + it.eventId }) { NachrichtBlase(it) }
        }
        aeltereLaden(z.verlauf(raum)) { a.vm.aeltereLaden(raum) }
        item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
    }
}

@Composable
fun AlarmKarte(al: Alarm, a: Aktionen, jetzt: Long, onOeffnen: (() -> Unit)? = null, kompakt: Boolean = false) {
    val farben = MaterialTheme.colorScheme
    val zustand = al.zustandUm(jetzt)
    val stumm = al.stummUm(jetzt)
    val akzent = if (zustand == AlarmZustand.OFFEN) stufenFarbe(al.stufe, farben) else farben.onSurfaceVariant
    KartenFlaeche(if (stumm) akzent.copy(alpha = 0.4f) else akzent, onOeffnen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pille("${al.stufe.zeichen} ${al.stufe.titel}", akzent)
            Spacer(Modifier.width(8.dp))
            Text(
                al.quelle,
                style = MaterialTheme.typography.labelLarge,
                color = farben.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(vorText(al.zeit), style = MaterialTheme.typography.labelSmall, color = farben.outline, maxLines = 1)
        }
        Text(al.titel, style = MaterialTheme.typography.titleMedium)
        al.anstieg?.let {
            Text("⬆️ jetzt ${al.stufe.wire}: $it", style = MaterialTheme.typography.bodyMedium, color = stufenFarbe(al.stufe, farben))
        }
        if (al.text.isNotBlank()) {
            Text(
                reicherText(al.text, farben),
                style = MaterialTheme.typography.bodyMedium,
                color = farben.onSurfaceVariant,
                maxLines = if (kompakt) 2 else if (onOeffnen != null) 4 else Int.MAX_VALUE,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (!kompakt) {
            al.link?.let { Text(reicherText(it, farben), style = MaterialTheme.typography.bodySmall) }
            Text(al.fingerabdruck, style = Mono, color = farben.outline)
        }
        if (zustand == AlarmZustand.OFFEN) {
            if (stumm) {
                Text(
                    "🔕 stumm bis ${zeitText(al.stummBis ?: 0)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = farben.onSurfaceVariant,
                )
            }
            // Quittieren und Stummschalten zählen nur von Vale (Gastrolle).
            if (a.rolle.entscheidet) AlarmKnoepfe(al, a, jetzt)
        } else {
            Text(alarmEnde(al, zustand), style = MaterialTheme.typography.bodyMedium, color = farben.onSurfaceVariant)
        }
    }
}

/**
 * Wie ein Alarm endete: behoben von der Quelle, von dir quittiert, oder dein ✅ ohne Antwort des
 * Hubs. Die Uhrzeit steht hinter dem ersten Teil: „✅ quittiert von Vale um 14:05 · meldet sich …“
 */
private fun alarmEnde(al: Alarm, zustand: AlarmZustand): String {
    val um = (al.beendet ?: al.meineReaktionen["✅"])?.let { " um ${zeitText(it)}" }.orEmpty()
    val text = al.beendetText
    return when {
        text != null -> text.split(" · ", limit = 2).let { t -> "✅ ${t[0]}$um" + (t.getOrNull(1)?.let { " · $it" }.orEmpty()) }
        zustand == AlarmZustand.QUITTIERT -> "✅ von dir quittiert$um · ohne Antwort des Hubs"
        else -> "✅ ${zustand.titel}$um"
    }
}

/** Quittieren (✅), 24 h stumm (🔕) oder, wenn stumm, wieder laut (🔔). */
@Composable
private fun AlarmKnoepfe(al: Alarm, a: Aktionen, jetzt: Long) {
    val unterwegs by a.vm.unterwegs.collectAsStateWithLifecycle()
    val laeuft = { zeichen: String -> "${al.eventId}|$zeichen" in unterwegs || al.wartetAuf(zeichen, jetzt) }
    val wartend = listOf("✅", "🔕", "🔔").filter(laeuft)
    if (wartend.isNotEmpty()) Wartet("${wartend.joinToString(" ")} gesendet, wartet auf Quittung")
    val zu = laeuft("✅")
    FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (al.stummUm(jetzt)) {
            OutlinedButton(onClick = { a.vm.alarmSignal(al, "🔔") }, enabled = !zu && !laeuft("🔔")) {
                Icon(Icons.Outlined.NotificationsActive, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Wieder laut")
            }
        } else {
            OutlinedButton(onClick = { a.vm.alarmSignal(al, "🔕") }, enabled = !zu && !laeuft("🔕")) {
                Icon(Icons.Outlined.NotificationsOff, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("24 h stumm")
            }
        }
        FilledTonalButton(onClick = { a.vm.alarmSignal(al, "✅") }, enabled = !zu) {
            Icon(Icons.Outlined.Check, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Quittieren")
        }
    }
}

@Composable
private fun AlarmZeile(al: Alarm, jetzt: Long, onClick: () -> Unit) {
    val farben = MaterialTheme.colorScheme
    Surface(onClick = onClick, shape = RoundedCornerShape(14.dp), color = farben.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${al.stufe.zeichen} ${al.quelle}",
                    style = MaterialTheme.typography.labelLarge,
                    color = farben.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(zeitText(al.beendet ?: al.zuletzt), style = MaterialTheme.typography.labelSmall, color = farben.outline, maxLines = 1)
            }
            Text(al.titel, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                alarmEnde(al, al.zustandUm(jetzt)),
                style = MaterialTheme.typography.bodySmall,
                color = farben.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ── Log ─────────────────────────────────────────────────────────────────────

@Composable
private fun LogListe(z: SchwarmZustand, a: Aktionen) {
    val raum = z.raeume.log
    if (raum == null || raum !in z.beigetreten) {
        LeerHinweis(
            Icons.Outlined.NotificationsNone,
            "Raum nicht beigetreten",
            "Tritt den Schwarm-Räumen bei (Räume → Allen beitreten), dann erscheint das Protokoll des Hubs hier.",
        )
        return
    }
    val verlauf = z.verlauf(raum)
    Column(Modifier.fillMaxSize()) {
        if (verlauf.nachrichten.isEmpty() && verlauf.anfangErreicht) {
            LeerHinweis(Icons.Outlined.Groups, "Noch nichts", "In diesem Raum ist es bisher ruhig.", Modifier.weight(1f))
        } else {
            NachrichtenListe(
                verlauf,
                Modifier.weight(1f),
                onAeltere = { a.vm.aeltereLaden(raum) },
                onAuftrag = a.auftragOeffnen,
            )
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

// ── Thread einer Freigabe oder eines Alarms ────────────────────────────────

/** Notice, Antworten des Hubs und der Quelle; oben die Karte mit den Knöpfen. */
@Composable
fun MeldungAnsicht(raumId: String, eventId: String, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val freigabe = z.freigabe(eventId)
    val alarm = z.alarm(eventId)
    LaunchedEffect(raumId, eventId) { a.vm.threadLaden(raumId, eventId) }
    // Offen heisst gelesen: die Meldung und ihr Thread (App 2.1).
    LaunchedEffect(raumId, eventId, z.verlauf(raumId).nachrichten.lastOrNull { it.threadWurzel == eventId }?.eventId) {
        a.vm.gelesen(raumId, eventId)
    }
    val jetzt = jetztBisFrist(listOfNotNull(freigabe?.ablauf) + alarm?.fristen.orEmpty())
    Scaffold(
        topBar = {
            SchwarmLeiste(
                titel = when {
                    freigabe != null -> "Freigabe ${freigabe.auftragId}"
                    alarm != null -> alarm.quelle
                    else -> "Meldung"
                },
                untertitel = when {
                    freigabe != null -> freigabe.zustandUm(jetzt).let { "${it.zeichen} ${it.titel} · an ${freigabe.ziel}" }
                    alarm != null -> "${alarm.stufe.zeichen} ${alarm.stufe.titel} · ${alarm.zustandUm(jetzt).titel}"
                    else -> null
                },
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (freigabe != null) TextButton(onClick = { a.auftragOeffnen(freigabe.auftragId) }) { Text("Auftrag") }
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            val verlauf = z.verlauf(raumId)
            NachrichtenListe(
                verlauf,
                Modifier.weight(1f),
                nachrichten = verlauf.nachrichten.filter { it.eventId == eventId || it.threadWurzel == eventId },
                a = a,
                kopf = {
                    Box(Modifier.padding(bottom = 6.dp)) {
                        when {
                            freigabe != null && a.rolle.entscheidet -> FreigabeKarte(freigabe, a, jetzt)
                            alarm != null -> AlarmKarte(alarm, a, jetzt)
                        }
                    }
                },
            )
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

// ── Bausteine der Meldungen ─────────────────────────────────────────────────

/** Karte mit farbigem Rand links; mit `onClick` antippbar. */
@Composable
internal fun KartenFlaeche(akzent: Color, onClick: (() -> Unit)?, inhalt: @Composable () -> Unit) {
    val form = RoundedCornerShape(16.dp)
    val farbe = MaterialTheme.colorScheme.surfaceContainerLow
    val innen: @Composable () -> Unit = {
        Column(
            Modifier
                .drawBehind { drawRect(akzent, size = Size(4.dp.toPx(), size.height)) }
                .padding(start = 18.dp, end = 14.dp, top = 14.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) { inhalt() }
    }
    if (onClick != null) {
        Surface(onClick = onClick, shape = form, color = farbe, modifier = Modifier.fillMaxWidth(), content = innen)
    } else {
        Surface(shape = form, color = farbe, modifier = Modifier.fillMaxWidth(), content = innen)
    }
}

/**
 * Nummer und Zustand links, die Zeit rechts. Die Zeit wird zuerst gemessen und bricht nie um;
 * wird es eng, kürzt sich die Pille.
 */
@Composable
internal fun KopfZeile(nummer: String, zustand: String, farbe: Color, zeit: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(nummer, style = Mono, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Spacer(Modifier.width(8.dp))
            Pille(zustand, farbe)
        }
        Spacer(Modifier.width(8.dp))
        Text(zeit, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline, maxLines = 1)
    }
}

@Composable
internal fun Wartet(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun RuhigKarte(icon: ImageVector, titel: String, text: String) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.padding(16.dp)) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(titel, style = MaterialTheme.typography.titleSmall)
                Text(
                    reicherText(text, MaterialTheme.colorScheme),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Kopf eines Abschnitts, der sich auf- und zuklappen lässt – wie `Abschnitt`, mit Zahl. */
@Composable
internal fun Aufklappen(titel: String, anzahl: Int, offen: Boolean, onUmschalten: () -> Unit) {
    val farbe = MaterialTheme.colorScheme.onSurfaceVariant
    Surface(onClick = onUmschalten, shape = RoundedCornerShape(12.dp), color = Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(start = 4.dp, end = 4.dp, top = 12.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                titel.uppercase(Locale.GERMAN),
                style = MaterialTheme.typography.labelMedium,
                color = farbe,
                modifier = Modifier.weight(1f),
            )
            Text("$anzahl", style = MaterialTheme.typography.labelMedium, color = farbe)
            Spacer(Modifier.width(4.dp))
            Icon(
                if (offen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                if (offen) "Zuklappen" else "Aufklappen",
                tint = farbe,
            )
        }
    }
}

/** Ältere Meldungen des Raums nachladen: Notices, die vor dem ersten Sync liegen. */
private fun LazyListScope.aeltereLaden(verlauf: Verlauf, onLaden: () -> Unit) {
    if (verlauf.anfangErreicht || verlauf.aeltereVon == null) return
    item(key = "aeltere") {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (verlauf.laedtAeltere) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            } else {
                TextButton(onClick = onLaden) { Text("Ältere Meldungen laden") }
            }
        }
    }
}
