@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.swarm.data.KennAgent
import com.claudewebui.swarm.data.KennTag
import com.claudewebui.swarm.data.Kennzahlen
import com.claudewebui.swarm.data.SCHWARM_KENNZAHLEN
import com.claudewebui.swarm.data.SchwarmZustand
import java.time.format.TextStyle as DatumStil
import java.util.Locale
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Verlauf und Kennzahlen (Punkt 20) aus `ch.zwaetschge.swarm.kennzahlen`, Woche oder Monat: Kacheln
 * für Aufträge, Kosten, Freigaben und Alarme; Aufträge je Tag gestapelt nach ok, Abbruch und Fehler;
 * die Kosten als eigenes Diagramm auf derselben Zeitachse (eine Achse je Grösse, keine Doppelachse);
 * dazu die Tabelle je Agent. Gezeichnet mit Compose Canvas, ohne Bibliothek.
 */
@Composable
fun KennzahlenAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    var zeitraum by rememberSaveable { mutableStateOf("woche") }
    val k = z.hub.kennzahlen[zeitraum]
    var auswahl by remember(zeitraum) { mutableStateOf<Int?>(null) }
    var tabelle by rememberSaveable { mutableStateOf(false) }
    Scaffold(
        topBar = {
            SchwarmLeiste(
                "Verlauf",
                k?.let { listOfNotNull(zeitspanne(it), it.erstellt?.let { e -> "Stand ${zeitText(e)}" }).joinToString(" · ") },
                zurueck = if (a.zurueckPfeil) zurueck else null,
            ) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = pad.calculateTopPadding() + 8.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "umschalter") {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("woche" to "Woche", "monat" to "Monat").forEachIndexed { i, (schluessel, titel) ->
                        SegmentedButton(
                            selected = zeitraum == schluessel,
                            onClick = { zeitraum = schluessel },
                            shape = SegmentedButtonDefaults.itemShape(i, 2),
                        ) { Text(titel) }
                    }
                }
            }
            if (z.hub.zuNeu(SCHWARM_KENNZAHLEN)) item(key = "update") { UpdateHinweis("die Kennzahlen") }
            if (k == null) {
                item(key = "leer") {
                    RuhigKarte(
                        Icons.Outlined.Insights,
                        "Noch keine Kennzahlen",
                        "Der Hub legt sie als Wochen- und Monatsstand in die Lobby. Sobald sie da sind, stehen hier Aufträge, Kosten, Freigaben und Alarme.",
                    )
                }
            } else {
                item(key = "kacheln") { KennKacheln(k) }
                item(key = "balken") {
                    DiagrammKarte("Aufträge je Tag") {
                        Legende(
                            // Nur Farbfeld und Wort: Ein rotes 🛑 neben dem grauen Abbruch-Feld würde mit „Fehler“ verwechselt.
                            listOfNotNull(
                                "ok" to StatusGut,
                                "Abbruch" to neutralFarbe(MaterialTheme.colorScheme),
                                "Fehler" to StatusKritisch,
                                ("offen" to offenFarbe(MaterialTheme.colorScheme)).takeIf { k.tage.any { it.sonstige > 0 } },
                            ),
                        )
                        AuftragsBalken(k.tage, auswahl) { i -> auswahl = if (auswahl == i) null else i }
                        TagAuswahl(k.tage, auswahl)
                    }
                }
                item(key = "kosten") {
                    DiagrammKarte("Kosten je Tag (USD)") {
                        KostenLinie(k.tage, auswahl) { i -> auswahl = if (auswahl == i) null else i }
                    }
                }
                item(key = "tabelle-knopf") {
                    TextButton(onClick = { tabelle = !tabelle }) {
                        Icon(Icons.Outlined.TableChart, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(if (tabelle) "Tabelle ausblenden" else "Als Tabelle")
                    }
                }
                if (tabelle) item(key = "tabelle") { TagesTabelle(k.tage) }
                item(key = "agenten-titel") { Abschnitt("Je Agent") }
                if (k.agenten.isEmpty()) {
                    item(key = "agenten-leer") {
                        Text("Keine Agentenzahlen in diesem Zeitraum.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(k.agenten, key = { "a-" + it.agent }) { ag -> AgentZahlen(ag, z, tageImZeitraum(k)) }
            }
            item(key = "unten") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
}

private fun datumKurz(tag: KennTag): String =
    tag.tag?.let { "%02d.%02d.".format(it.dayOfMonth, it.monthValue) } ?: tag.tagText

private fun zeitspanne(k: Kennzahlen): String? {
    val von = k.tage.firstOrNull()?.let(::datumKurz) ?: k.von
    val bis = k.tage.lastOrNull()?.let(::datumKurz) ?: k.bis
    return if (von != null && bis != null) "$von–$bis" else null
}

private fun tageImZeitraum(k: Kennzahlen): Int = k.tage.size.takeIf { it > 0 } ?: if (k.zeitraum == "monat") 30 else 7

/** Kacheln: Aufträge mit Quote, Kosten, Freigaben mit Antwortzeit, Alarme mit Quittungen. */
@Composable
private fun KennKacheln(k: Kennzahlen) {
    val summe = k.tage.sumOf { it.auftraege }
    val ok = k.tage.sumOf { it.ok }
    val kosten = k.tage.sumOf { it.kosten }
    val kacheln = listOf(
        Triple("Aufträge", "$summe", if (summe > 0) "Quote ${Math.round(ok * 100.0 / summe)} %" else null),
        Triple("Kosten", "${usdText(kosten)} USD", "Ø ${usdText(kosten / tageImZeitraum(k))} pro Tag"),
        Triple("Freigaben", k.freigabenAnzahl?.toString() ?: "–", k.freigabenMedianS?.let { "Antwort im Median ${dauerText(it)}" }),
        Triple(
            "Alarme",
            k.alarmeAnzahl?.toString() ?: "–",
            listOfNotNull(k.alarmeQuittiert?.let { "$it quittiert" }, k.alarmeMedianQuittungS?.let { "Median ${dauerText(it)}" })
                .joinToString(" · ").ifBlank { null },
        ),
    )
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val proReihe = if (maxWidth < 520.dp) 2 else 4
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            kacheln.chunked(proReihe).forEach { reihe ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    reihe.forEach { (titel, wert, zusatz) -> ZahlKachel(titel, wert, zusatz, Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun DiagrammKarte(titel: String, inhalt: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(titel, style = MaterialTheme.typography.titleSmall)
            inhalt()
        }
    }
}

/** Die Legende: Farbfeld neben Zeichen und Wort, nie Farbe allein; der Text in Textfarbe. */
@Composable
private fun Legende(eintraege: List<Pair<String, Color>>) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        eintraege.forEach { (text, farbe) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.size(10.dp).background(farbe, RoundedCornerShape(2.dp)))
                Spacer(Modifier.width(4.dp))
                Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
    }
}

/** Die Zahlen des angetippten Tags; ohne Auswahl ein Hinweis. */
@Composable
private fun TagAuswahl(tage: List<KennTag>, auswahl: Int?) {
    val t = auswahl?.let { tage.getOrNull(it) }
    Text(
        if (t == null) {
            "Tippe auf einen Tag für seine Zahlen."
        } else {
            "${wochentag(t)} ${datumKurz(t)}: ${t.auftraege} Aufträge · ${t.ok} ok · ${t.fehler} Fehler · ${t.abbruch} Abbruch" +
                (if (t.sonstige > 0) " · ${t.sonstige} offen" else "") + " · ${usdText(t.kosten)} USD · ${t.alarme} Alarme"
        },
        style = MaterialTheme.typography.bodySmall,
        color = if (t == null) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface,
    )
}

private fun wochentag(t: KennTag): String =
    t.tag?.dayOfWeek?.getDisplayName(DatumStil.SHORT, Locale.GERMAN)?.removeSuffix(".") ?: ""

/** Noch Offenes im Stapel: blass blau wie „eingereicht“, klar getrennt vom Grau des Abbruchs. */
private fun offenFarbe(f: androidx.compose.material3.ColorScheme): Color = f.secondary.copy(alpha = 0.55f)

/** Eine runde Obergrenze für die Achse: 1, 2, 2.5, 5 mal einer Zehnerpotenz. */
private fun rundeGrenze(wert: Double): Double {
    if (wert <= 0) return 1.0
    val zehner = 10.0.pow(floor(log10(wert)))
    return listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * zehner }.first { it >= wert }
}

private fun achsenText(wert: Double): String =
    if (wert == floor(wert)) "%.0f".format(Locale.US, wert) else if (wert < 1) "%.2f".format(Locale.US, wert) else "%.1f".format(Locale.US, wert)

/** Links Platz für die Achsenbeschriftung, unten für die Tage. */
private val ACHSE_LINKS = 34.dp
private val ACHSE_UNTEN = 20.dp
private val RAND_OBEN = 10.dp

/** Welche Tage beschriftet werden: in der Woche alle, im Monat jeder fünfte und der letzte. */
private fun beschriften(i: Int, anzahl: Int): Boolean = anzahl <= 10 || i % 5 == 0 || i == anzahl - 1

private fun tagText(t: KennTag, anzahl: Int): String =
    if (anzahl <= 10) wochentag(t).ifBlank { datumKurz(t) } else t.tag?.dayOfMonth?.toString() ?: t.tagText.takeLast(2)

/** Ein Rechteck mit runden Ecken nur oben: Die Daten enden rund, die Grundlinie bleibt gerade. */
private fun DrawScope.obenRund(farbe: Color, x: Float, y: Float, breite: Float, hoehe: Float, radius: Float) {
    val r = min(radius, min(breite / 2, hoehe))
    val weg = Path().apply {
        addRoundRect(
            RoundRect(
                Rect(x, y, x + breite, y + hoehe),
                topLeft = CornerRadius(r, r),
                topRight = CornerRadius(r, r),
                bottomRight = CornerRadius.Zero,
                bottomLeft = CornerRadius.Zero,
            ),
        )
    }
    drawPath(weg, farbe)
}

/**
 * Aufträge je Tag, gestapelt: unten ok (gut), darüber Abbruch (neutral), oben Fehler (kritisch),
 * zuoberst noch Offenes. Zwischen den Teilen 2 dp Luft statt Rahmen; höchstens 16 dp breit.
 */
@Composable
private fun AuftragsBalken(tage: List<KennTag>, auswahl: Int?, onTag: (Int) -> Unit) {
    val f = MaterialTheme.colorScheme
    val messer = rememberTextMeasurer()
    val achse = TextStyle(fontSize = 10.sp, color = f.onSurfaceVariant)
    val neutral = neutralFarbe(f)
    val offen = offenFarbe(f)
    val raster = f.outlineVariant
    val hervor = f.onSurface.copy(alpha = 0.07f)
    val grenze = rundeGrenze(tage.maxOfOrNull { it.auftraege }?.toDouble() ?: 0.0)
    val anzahl = tage.size
    val beschreibung = "Aufträge je Tag: ${tage.sumOf { it.auftraege }} insgesamt, ${tage.sumOf { it.ok }} ok, " +
        "${tage.sumOf { it.fehler }} Fehler, ${tage.sumOf { it.abbruch }} Abbruch. Die Tabelle zeigt jeden Tag."
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(190.dp)
            .semantics { contentDescription = beschreibung }
            .pointerInput(tage) {
                detectTapGestures { p ->
                    val links = ACHSE_LINKS.toPx()
                    if (anzahl == 0 || p.x < links) return@detectTapGestures
                    val i = ((p.x - links) / ((size.width - links) / anzahl)).toInt()
                    if (i in 0 until anzahl) onTag(i)
                }
            },
    ) {
        if (anzahl == 0) return@Canvas
        val links = ACHSE_LINKS.toPx()
        val oben = RAND_OBEN.toPx()
        val hoehe = size.height - ACHSE_UNTEN.toPx() - oben
        val slot = (size.width - links) / anzahl
        val balken = min(slot * 0.62f, 16.dp.toPx())
        val luecke = 2.dp.toPx()
        // Raster: 0, Hälfte, Obergrenze; Haarlinien, beschriftet links.
        listOf(0.0, grenze / 2, grenze).forEach { w ->
            val y = oben + hoehe - (w / grenze * hoehe).toFloat()
            drawLine(raster, Offset(links, y), Offset(size.width, y), strokeWidth = 1f)
            val m = messer.measure(achsenText(w), achse)
            drawText(m, topLeft = Offset(links - m.size.width - 6.dp.toPx(), y - m.size.height / 2))
        }
        tage.forEachIndexed { i, t ->
            val x0 = links + slot * i
            if (i == auswahl) drawRect(hervor, topLeft = Offset(x0, oben), size = Size(slot, hoehe))
            val x = x0 + (slot - balken) / 2
            val teile = listOf(t.ok to StatusGut, t.abbruch to neutral, t.fehler to StatusKritisch, t.sonstige to offen)
                .filter { it.first > 0 }
            var basis = oben + hoehe
            teile.forEachIndexed { s, (wert, farbe) ->
                val h = (wert / grenze * hoehe).toFloat()
                val oberkante = basis - h
                val unterkante = basis - if (s > 0) luecke else 0f
                if (unterkante - oberkante > 0.5f) {
                    if (s == teile.lastIndex) {
                        obenRund(farbe, x, oberkante, balken, unterkante - oberkante, 4.dp.toPx())
                    } else {
                        drawRect(farbe, topLeft = Offset(x, oberkante), size = Size(balken, unterkante - oberkante))
                    }
                }
                basis = oberkante
            }
            if (beschriften(i, anzahl)) {
                val m = messer.measure(tagText(t, anzahl), achse)
                drawText(m, topLeft = Offset(x0 + slot / 2 - m.size.width / 2, oben + hoehe + 4.dp.toPx()))
            }
        }
    }
}

/**
 * Kosten je Tag als Linie, auf derselben Zeitachse wie die Balken darüber. Punkte mit Ring in der
 * Kartenfarbe; beschriftet sind nur der höchste und der letzte Tag.
 */
@Composable
private fun KostenLinie(tage: List<KennTag>, auswahl: Int?, onTag: (Int) -> Unit) {
    val f = MaterialTheme.colorScheme
    val messer = rememberTextMeasurer()
    val achse = TextStyle(fontSize = 10.sp, color = f.onSurfaceVariant)
    val wert = TextStyle(fontSize = 11.sp, color = f.onSurface)
    val linie = f.secondary
    val ring = f.surfaceContainerLow
    val raster = f.outlineVariant
    val hervor = f.onSurface.copy(alpha = 0.07f)
    val grenze = rundeGrenze(tage.maxOfOrNull { it.kosten } ?: 0.0)
    val anzahl = tage.size
    val hoechster = tage.indices.maxByOrNull { tage[it].kosten }
    val beschreibung = "Kosten je Tag: zusammen ${usdText(tage.sumOf { it.kosten })} USD, " +
        "am meisten ${hoechster?.let { "${usdText(tage[it].kosten)} USD am ${datumKurz(tage[it])}" } ?: "–"}."
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(140.dp)
            .semantics { contentDescription = beschreibung }
            .pointerInput(tage) {
                detectTapGestures { p ->
                    val links = ACHSE_LINKS.toPx()
                    if (anzahl == 0 || p.x < links) return@detectTapGestures
                    val i = ((p.x - links) / ((size.width - links) / anzahl)).toInt()
                    if (i in 0 until anzahl) onTag(i)
                }
            },
    ) {
        if (anzahl == 0) return@Canvas
        val links = ACHSE_LINKS.toPx()
        val oben = RAND_OBEN.toPx() + 8.dp.toPx()
        val hoehe = size.height - ACHSE_UNTEN.toPx() - oben
        val slot = (size.width - links) / anzahl
        listOf(0.0, grenze / 2, grenze).forEach { w ->
            val y = oben + hoehe - (w / grenze * hoehe).toFloat()
            drawLine(raster, Offset(links, y), Offset(size.width, y), strokeWidth = 1f)
            val m = messer.measure(achsenText(w), achse)
            drawText(m, topLeft = Offset(links - m.size.width - 6.dp.toPx(), y - m.size.height / 2))
        }
        auswahl?.let { i -> drawRect(hervor, topLeft = Offset(links + slot * i, oben), size = Size(slot, hoehe)) }
        val punkte = tage.mapIndexed { i, t ->
            Offset(links + slot * i + slot / 2, oben + hoehe - (t.kosten / grenze * hoehe).toFloat())
        }
        val weg = Path().apply {
            punkte.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) }
        }
        drawPath(weg, linie, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        // Punkte: in der Woche alle, im Monat nur die wichtigen, sonst wird es unruhig.
        val r = 4.dp.toPx()
        punkte.forEachIndexed { i, p ->
            val wichtig = anzahl <= 10 || i == hoechster || i == anzahl - 1 || i == auswahl
            if (!wichtig) return@forEachIndexed
            drawCircle(ring, radius = r + 2.dp.toPx(), center = p)
            drawCircle(linie, radius = r, center = p)
        }
        // Nur der höchste und der letzte Wert stehen dran, in Textfarbe.
        listOfNotNull(hoechster, anzahl - 1).distinct().forEach { i ->
            val m = messer.measure(usdText(tage[i].kosten), wert)
            val p = punkte[i]
            val x = (p.x - m.size.width / 2).coerceIn(links, size.width - m.size.width)
            drawText(m, topLeft = Offset(x, max(0f, p.y - m.size.height - 6.dp.toPx())))
        }
        tage.forEachIndexed { i, t ->
            if (beschriften(i, anzahl)) {
                val m = messer.measure(tagText(t, anzahl), achse)
                drawText(m, topLeft = Offset(links + slot * i + slot / 2 - m.size.width / 2, oben + hoehe + 4.dp.toPx()))
            }
        }
    }
}

/** Die Zahlen als Tabelle: dieselben Werte wie in den Diagrammen, ohne Farbe. */
@Composable
private fun TagesTabelle(tage: List<KennTag>) {
    val kopf = MaterialTheme.typography.labelSmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)
    val zelle = Mono.copy(fontSize = 12.sp)
    val gewichte = listOf(1.5f, 1f, 1f, 1f, 1f, 1.2f, 1f)
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row {
                listOf("Tag", "Auftr.", "ok", "Fehl.", "Abbr.", "USD", "Alarme").forEachIndexed { i, t ->
                    Text(t, style = kopf, modifier = Modifier.weight(gewichte[i]), maxLines = 1)
                }
            }
            tage.forEach { t ->
                Row {
                    listOf(datumKurz(t), "${t.auftraege}", "${t.ok}", "${t.fehler}", "${t.abbruch}", usdText(t.kosten), "${t.alarme}")
                        .forEachIndexed { i, s -> Text(s, style = zelle, modifier = Modifier.weight(gewichte[i]), maxLines = 1, overflow = TextOverflow.Clip) }
                }
            }
        }
    }
}

/** Ein Agent: Quote, Median-Dauer, Aufträge, 👍/👎 und die Kosten gegen das Budget des Zeitraums. */
@Composable
private fun AgentZahlen(ag: KennAgent, z: SchwarmZustand, tage: Int) {
    val f = MaterialTheme.colorScheme
    val budget = ag.budgetTag?.takeIf { it > 0 }?.let { it * tage }
    val anteil = budget?.let { ag.kosten / it }
    val jetzt = System.currentTimeMillis()
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = f.surfaceContainerLow)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(z.agent(ag.agent)?.name ?: ag.agent, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                ag.pauseBis?.takeIf { it > jetzt }?.let { Pille("⏸ Pause bis ${zeitText(it)}", StatusWarnung) }
            }
            Text(
                listOfNotNull(
                    ag.quote?.let { "Quote ${Math.round(it * 100)} %" },
                    ag.dauerMedianS?.let { "Median ${dauerText(it)}" },
                    "${ag.auftraege} Aufträge",
                    "👍 ${ag.plus} · 👎 ${ag.minus}",
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = f.onSurfaceVariant,
            )
            if (budget != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Fuellbalken(anteil, Modifier.weight(1f))
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "${usdText(ag.kosten)} von ${usdText(budget)} USD",
                        style = MaterialTheme.typography.labelMedium,
                        color = f.onSurface,
                    )
                }
                Text(
                    "Budget ${usdText(ag.budgetTag ?: 0.0)} USD pro Tag" + (anteil?.takeIf { it >= 0.8 }?.let { " · ⚠️ ${Math.round(it * 100)} % verbraucht" } ?: ""),
                    style = MaterialTheme.typography.labelSmall,
                    color = f.onSurfaceVariant,
                )
            } else {
                Text("Kosten ${usdText(ag.kosten)} USD · kein Tagesbudget", style = MaterialTheme.typography.labelMedium, color = f.onSurfaceVariant)
            }
        }
    }
}
