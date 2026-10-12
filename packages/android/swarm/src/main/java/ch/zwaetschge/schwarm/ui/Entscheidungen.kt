@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Difference
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Entscheidung
import com.claudewebui.swarm.data.EntscheidungsArt
import com.claudewebui.swarm.data.Lebenslauf
import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Zustand

/**
 * Was unter einer Nachricht im Verlauf steht: ✅/❌ für Pläne und Tore, der Weg zum Patch. So
 * sieht eine Entscheidung in der Lobby, im Thread und in der Übersicht gleich aus.
 */
@Composable
fun NachrichtZusatz(n: Nachricht, z: SchwarmZustand, a: Aktionen) {
    val e = z.entscheidungen.firstOrNull { it.nachricht.eventId == n.eventId }
    if (e != null) {
        Column(Modifier.widthIn(max = 620.dp).padding(top = 6.dp)) { EntscheidungsKnoepfe(e, a) }
    }
    val datei = n.datei
    if (datei != null && datei.istPatch && datei.mxc != null) {
        val info = datei.patch
        Surface(
            onClick = { a.oeffnen(Detail.PatchD(n.raumId, n.eventId)) },
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            modifier = Modifier.widthIn(max = 620.dp).padding(top = 6.dp),
        ) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Difference, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f, fill = false)) {
                    Text("Patch ansehen", style = MaterialTheme.typography.titleSmall)
                    Text(
                        patchZusammenfassung(info?.repo, info?.dateien, info?.plus, info?.minus) ?: datei.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** „matrix · 3 Dateien · +40 −12“ aus den Angaben des Hubs, oder `null` ohne Angaben. */
fun patchZusammenfassung(repo: String?, dateien: Int?, plus: Int?, minus: Int?): String? = listOfNotNull(
    repo,
    dateien?.let { if (it == 1) "1 Datei" else "$it Dateien" },
    if (plus != null || minus != null) "+${plus ?: 0} −${minus ?: 0}" else null,
).takeIf { it.isNotEmpty() }?.joinToString(" · ")

/**
 * ✅ und ❌ für einen Plan oder ein Tor. Die Knöpfe setzen nur deine Reaktion auf genau diese Notice;
 * der Hub macht daraus „ja“ oder „nein“. Gäste sehen nur den Stand, denn es zählt nur Vales Reaktion.
 */
@Composable
fun EntscheidungsKnoepfe(e: Entscheidung, a: Aktionen) {
    val unterwegs by a.vm.unterwegs.collectAsStateWithLifecycle()
    val gesendet = e.meine ?: listOf("✅", "❌").firstOrNull { "${e.nachricht.eventId}|$it" in unterwegs }
    when {
        gesendet != null -> Text(
            when {
                gesendet == "✅" && e.art == EntscheidungsArt.PLAN -> "✅ Plan angenommen – der Hub sagt dem Worker „ja“."
                gesendet == "❌" && e.art == EntscheidungsArt.PLAN -> "❌ Plan abgelehnt – der Hub sagt dem Worker „nein“."
                gesendet == "✅" -> "✅ gesendet – der Ablauf geht weiter."
                else -> "❌ gesendet – der Ablauf hält an."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        !e.offen -> Text(
            if (e.art == EntscheidungsArt.PLAN) "Nicht mehr offen: Der Auftrag ist weiter." else "Nicht mehr offen.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        !a.rolle.entscheidet -> Text(
            "Wartet auf Vales Entscheid.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        else -> FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = { a.vm.entscheiden(e, ja = false) }) {
                Icon(Icons.Outlined.Block, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(e.art.nein)
            }
            if (e.art == EntscheidungsArt.PLAN) {
                Button(onClick = { a.vm.entscheiden(e, ja = true) }) {
                    Icon(Icons.Outlined.Check, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(e.art.ja)
                }
            } else {
                FilledTonalButton(onClick = { a.vm.entscheiden(e, ja = true) }) {
                    Icon(Icons.Outlined.Check, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(e.art.ja)
                }
            }
        }
    }
}

/**
 * Ein Plan oder ein Tor in „Aktuell“: wer fragt, der Text und die Knöpfe. Ein Tipp auf den Text
 * öffnet den Auftrag mit dem ganzen Thread.
 */
@Composable
fun EntscheidungKarte(e: Entscheidung, z: SchwarmZustand, a: Aktionen, zeilen: Int = 8) {
    val f = MaterialTheme.colorScheme
    val auftrag = z.auftrag(e.auftragId)
    val akzent = if (e.art == EntscheidungsArt.PLAN) zustandFarbe(Zustand.RUECKFRAGE, f) else StatusWarnung
    val wer = auftrag?.let { z.agent(it.zustaendig)?.name ?: it.zustaendig } ?: e.nachricht.absenderName
    KartenFlaeche(akzent, onClick = e.auftragId?.let { id -> { a.auftragOeffnen(id) } }) {
        KopfZeile(
            e.auftragId ?: "Ablauf",
            if (e.art == EntscheidungsArt.PLAN) "📋 Plan" else "🚦 " + (e.ablauf ?: "Ablauf"),
            akzent,
            vorText(e.nachricht.zeit),
        )
        Text(
            if (e.art == EntscheidungsArt.PLAN) "$wer schickt zuerst einen Plan" else "Ein Ablauf wartet auf dich",
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            reicherText(planText(e), f, a.auftragOeffnen),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = zeilen,
            overflow = TextOverflow.Ellipsis,
        )
        EntscheidungsKnoepfe(e, a)
    }
}

/**
 * Der Text ohne die Kopfzeile („❓ T-0042 · Agent“), die in der Karte schon steht, und ohne den
 * Bedienhinweis des Hubs am Schluss („Antwort hier im Thread …“, „Weiter? ✅ / ❌ …“).
 */
private fun planText(e: Entscheidung): String {
    var zeilen = e.nachricht.text.trim().lines()
    if (e.art == EntscheidungsArt.PLAN && zeilen.size > 1 && !zeilen.first().contains("📋")) zeilen = zeilen.drop(1)
    zeilen = zeilen.dropLastWhile { z ->
        val t = z.trim()
        t.isEmpty() || t.startsWith("Antwort hier im Thread") || t.startsWith("Antwort im Thread") || t.startsWith("Weiter? ✅")
    }
    return zeilen.joinToString("\n").trim().ifEmpty { e.nachricht.text.trim() }
}

/** Deine Reaktion auf eine Nachricht, ohne Variantenwähler, falls es ✅ oder ❌ ist. */
fun meineEntscheidung(n: Nachricht): String? =
    n.eigeneReaktionen.map(Lebenslauf::zeichen).let { r -> listOf("✅", "❌").firstOrNull { it in r } }
