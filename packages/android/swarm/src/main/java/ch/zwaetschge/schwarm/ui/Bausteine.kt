package com.claudewebui.swarm.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.AlarmStufe
import com.claudewebui.swarm.data.FreigabeZustand
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Verbindung
import com.claudewebui.swarm.data.Zustand
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay

private val nurZeit = SimpleDateFormat("HH:mm", Locale.GERMAN)
private val mitDatum = SimpleDateFormat("dd.MM. HH:mm", Locale.GERMAN)

fun zeitText(ms: Long): String {
    if (ms <= 0) return ""
    val heute = Calendar.getInstance()
    val dann = Calendar.getInstance().apply { timeInMillis = ms }
    val gleicherTag = heute.get(Calendar.YEAR) == dann.get(Calendar.YEAR) &&
        heute.get(Calendar.DAY_OF_YEAR) == dann.get(Calendar.DAY_OF_YEAR)
    return (if (gleicherTag) nurZeit else mitDatum).format(Date(ms))
}

fun vorText(ms: Long, jetzt: Long = System.currentTimeMillis()): String {
    if (ms <= 0) return ""
    val s = (jetzt - ms) / 1000
    return when {
        s < 60 -> "gerade eben"
        s < 3600 -> "vor ${s / 60} min"
        s < 86_400 -> "vor ${s / 3600} h"
        else -> zeitText(ms)
    }
}

/** Die Uhr für Countdowns: die aktuelle Zeit, neu alle `takt` ms. */
@Composable
fun rememberJetzt(takt: Long = 1_000L): Long {
    var jetzt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(takt) {
        while (true) {
            delay(takt - System.currentTimeMillis() % takt)
            jetzt = System.currentTimeMillis()
        }
    }
    return jetzt
}

/**
 * Die Uhr für Fristen: liest die Zeit neu, sobald die nächste der `fristen` erreicht ist. So
 * rutscht eine abgelaufene Freigabe pünktlich in den Verlauf, ohne dass jede Sekunde neu gezeichnet wird.
 */
@Composable
fun jetztBisFrist(fristen: List<Long>): Long {
    var jetzt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val naechste = fristen.filter { it > jetzt }.minOrNull()
    LaunchedEffect(naechste) {
        jetzt = System.currentTimeMillis()
        if (naechste != null) {
            delay((naechste - jetzt).coerceAtLeast(0) + 200)
            jetzt = System.currentTimeMillis()
        }
    }
    return jetzt
}

/** Warnfarbe für Freigaben, Warnungen und träge Agenten. */
val Warnorange = Color(0xFFFF9F43)

/**
 * Statusfarben für Diagramme und Füllstände (dataviz-Statuspalette): gut, Warnung, kritisch. Sie
 * stehen nie allein, immer mit Beschriftung oder Zeichen daneben. Gegen die Kartenflächen der App
 * geprüft, hell wie dunkel mindestens 3:1.
 */
val StatusGut = Color(0xFF0CA30C)
val StatusWarnung = Color(0xFFFAB219)
val StatusKritisch = Color(0xFFD03B3B)

/** Neutral für „abgebrochen“ in Diagrammen; bewusst grau, weil ein Abbruch kein Fehler ist. */
fun neutralFarbe(f: ColorScheme): Color = if (f.background.luminance() < 0.5f) Color(0xFF8A94A6) else Color(0xFF7A8394)

/** Füllstand (Abo, Budget): bis 80 % die Akzentfarbe, ab 80 % gelb, ab 95 % rot (Punkt 7). */
fun fuellFarbe(anteil: Double?, f: ColorScheme): Color = when {
    anteil == null -> f.outline
    anteil >= 0.95 -> StatusKritisch
    anteil >= 0.8 -> StatusWarnung
    else -> f.secondary
}

/** „2 min“, „1 h 05 min“, „45 s“: Dauern ohne Nachkommastellen. */
fun dauerText(sekunden: Double?): String {
    val s = sekunden?.toLong() ?: return "–"
    return when {
        s < 60 -> "$s s"
        s < 3600 -> "${s / 60} min"
        else -> "${s / 3600} h ${(s % 3600 / 60).toString().padStart(2, '0')} min"
    }
}

/** „Brian“, „Brian und Plum“, „Brian, Plum und Betrieb“. */
fun aufzaehlung(teile: List<String>): String =
    if (teile.size <= 1) teile.joinToString() else teile.dropLast(1).joinToString(", ") + " und " + teile.last()

/** Beträge in USD mit zwei Stellen, wie der Hub sie in `!budget` zeigt. */
fun usdText(usd: Double): String = "%.2f".format(Locale.US, usd)

fun zustandFarbe(z: Zustand, f: ColorScheme): Color = when (z) {
    Zustand.EINGEREICHT -> f.secondary
    Zustand.IN_ARBEIT -> f.primary
    Zustand.RUECKFRAGE -> Color(0xFFC792EA)
    Zustand.FREIGABE -> Warnorange
    Zustand.FERTIG -> f.tertiary
    Zustand.FEHLGESCHLAGEN -> f.error
    Zustand.ABGEBROCHEN, Zustand.ABGELEHNT -> f.outline
}

fun freigabeFarbe(z: FreigabeZustand, f: ColorScheme): Color = when (z) {
    FreigabeZustand.OFFEN -> Warnorange
    FreigabeZustand.FREIGEGEBEN -> f.tertiary
    FreigabeZustand.ABGELEHNT -> f.error
    FreigabeZustand.ABGELAUFEN -> f.onSurfaceVariant
}

fun stufenFarbe(s: AlarmStufe, f: ColorScheme): Color = when (s) {
    AlarmStufe.CRIT -> f.error
    AlarmStufe.WARN -> Warnorange
    AlarmStufe.INFO -> f.secondary
}

@Composable
fun ZustandChip(z: Zustand, modifier: Modifier = Modifier) {
    Pille("${z.zeichen} ${z.titel}", zustandFarbe(z, MaterialTheme.colorScheme), modifier)
}

/** Eine farbige Pille für Zustände und Stufen. */
@Composable
fun Pille(text: String, farbe: Color, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = farbe.copy(alpha = 0.16f),
        contentColor = farbe,
    ) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
        )
    }
}

@Composable
fun StatusPunkt(status: AgentStatus, modifier: Modifier = Modifier) {
    val f = MaterialTheme.colorScheme
    val farbe = when (status) {
        AgentStatus.ONLINE -> f.tertiary
        AgentStatus.TRAEGE -> Warnorange
        AgentStatus.PAUSIERT -> Warnorange.copy(alpha = 0.6f)
        AgentStatus.OFFLINE -> f.outline
    }
    Box(modifier.size(10.dp).background(farbe, CircleShape))
}

@Composable
fun Abschnitt(titel: String, modifier: Modifier = Modifier, rechts: (@Composable () -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 12.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            titel.uppercase(Locale.GERMAN),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        rechts?.invoke()
    }
}

@Composable
fun LeerHinweis(icon: ImageVector, titel: String, text: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(12.dp))
        Text(titel, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(
            reicherText(text, MaterialTheme.colorScheme),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

private val link = Regex("""https?://[^\s<>()]+[^\s<>().,;:!?'"]""")
private val code = Regex("""`([^`\n]+)`""")
private val fett = Regex("""\*\*([^*\n]+)\*\*""")
private val nummer = Regex("""\bT-\d{1,8}\b""")

/**
 * Hub und Bots schreiben Klartext mit ein wenig Markdown. Die App zeigt Links anklickbar,
 * `Code` in Monospace und **Fettes** fett — mehr nicht, damit nichts aus dem Material
 * plötzlich wie Oberfläche aussieht. Mit `onAuftrag` werden Auftragsnummern wie T-0123
 * antippbar, etwa in den „🔎 Ähnlich“-Hinweisen des Hubs (Punkt 9).
 */
fun reicherText(text: String, f: ColorScheme, onAuftrag: ((String) -> Unit)? = null): AnnotatedString = buildAnnotatedString {
    data class Treffer(val start: Int, val ende: Int, val art: Int, val inhalt: String)
    val treffer = buildList {
        link.findAll(text).forEach { add(Treffer(it.range.first, it.range.last + 1, 0, it.value)) }
        code.findAll(text).forEach { add(Treffer(it.range.first, it.range.last + 1, 1, it.groupValues[1])) }
        fett.findAll(text).forEach { add(Treffer(it.range.first, it.range.last + 1, 2, it.groupValues[1])) }
        if (onAuftrag != null) nummer.findAll(text).forEach { add(Treffer(it.range.first, it.range.last + 1, 3, it.value)) }
    }.sortedWith(compareBy<Treffer> { it.start }.thenBy { it.art })
    var pos = 0
    for (t in treffer) {
        if (t.start < pos) continue
        append(text.substring(pos, t.start))
        when (t.art) {
            0 -> withLink(
                LinkAnnotation.Url(
                    t.inhalt,
                    TextLinkStyles(SpanStyle(color = f.secondary, textDecoration = TextDecoration.Underline)),
                ),
            ) { append(t.inhalt) }
            1 -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = f.surfaceContainerHighest)) {
                append(t.inhalt)
            }
            3 -> withLink(
                LinkAnnotation.Clickable(
                    t.inhalt,
                    TextLinkStyles(SpanStyle(color = f.secondary, fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline)),
                ) { onAuftrag?.invoke(t.inhalt) },
            ) { append(t.inhalt) }
            else -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(t.inhalt) }
        }
        pos = t.ende
    }
    if (pos < text.length) append(text.substring(pos))
}

/**
 * Ein Hinweis mit Farbe am Rand, etwa gelb für „veraltet“ oder rot für „keine Verbindung“. Farbe
 * nie allein: immer mit Zeichen und Text.
 */
@Composable
fun HinweisKarte(
    icon: ImageVector,
    titel: String,
    text: String?,
    farbe: Color,
    modifier: Modifier = Modifier,
    aktion: (@Composable () -> Unit)? = null,
) {
    Surface(
        color = farbe.copy(alpha = 0.12f),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, null, tint = farbe, modifier = Modifier.size(20.dp))
            Spacer(Modifier.size(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(titel, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                if (text != null) {
                    Text(
                        reicherText(text, MaterialTheme.colorScheme),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                aktion?.invoke()
            }
        }
    }
}

/** „bitte App aktualisieren“: Der Hub schickt ein Event mit einer Version, die diese App nicht kennt. */
@Composable
fun UpdateHinweis(teil: String, modifier: Modifier = Modifier) {
    HinweisKarte(
        Icons.Outlined.SystemUpdate,
        "Bitte App aktualisieren",
        "Der Hub schickt $teil in einer neueren Fassung, als diese App kennt. Die neue APK liegt im Zwischenspeicher.",
        StatusWarnung,
        modifier,
    )
}

/**
 * Der Stand ist nicht frisch: aus dem Speicher, weil der Sync noch fehlt oder gestört ist. Die Zeit
 * sagt, wie alt das Gezeigte ist (Punkt 18).
 */
@Composable
fun StandHinweis(z: SchwarmZustand, modifier: Modifier = Modifier, knapp: Boolean = false) {
    if (!z.alterStand) return
    val zeit = z.standZeit.takeIf { it > 0 }?.let { zeitText(it) }
    val titel = when {
        z.verbindung == Verbindung.FEHLER -> "Keine Verbindung – letzter bekannter Stand" + (zeit?.let { " von $it" } ?: "")
        else -> "Verbindet … bis dahin der Stand" + (zeit?.let { " von $it" } ?: " aus dem Speicher")
    }
    HinweisKarte(
        if (z.verbindung == Verbindung.FEHLER) Icons.Outlined.CloudOff else Icons.Outlined.History,
        titel,
        if (knapp) null else listOfNotNull(
            "Board, offene Freigaben und Alarme sind so, wie die App sie zuletzt gesehen hat.",
            z.fehler?.takeIf { z.verbindung == Verbindung.FEHLER }?.trim()?.let { if (it.endsWith('.')) it else "$it." },
            "Der Not-Aus ohne Matrix geht trotzdem.".takeIf { z.rolle.istVale },
        ).joinToString(" "),
        if (z.verbindung == Verbindung.FEHLER) StatusKritisch else StatusWarnung,
        modifier,
    )
}

/** Eine Kachel mit Zahl: Beschriftung, Wert gross, Zusatz klein (Kennzahlen, Türsteher). */
@Composable
fun ZahlKachel(titel: String, wert: String, zusatz: String?, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(14.dp), modifier = modifier) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(titel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Text(wert, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
            if (zusatz != null) {
                Text(zusatz, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            }
        }
    }
}

/**
 * Ein Füllstand als Balken: die Füllung trägt die Stufe (Akzent, gelb, rot), die Spur ist dieselbe
 * Farbe, nur blass. `null` heisst unbekannt: nur die Spur.
 */
@Composable
fun Fuellbalken(anteil: Double?, modifier: Modifier = Modifier) {
    val farbe = fuellFarbe(anteil, MaterialTheme.colorScheme)
    Box(
        modifier
            .fillMaxWidth()
            .height(8.dp)
            .background(farbe.copy(alpha = 0.22f), RoundedCornerShape(4.dp)),
    ) {
        if (anteil != null && anteil > 0) {
            Box(
                Modifier
                    .fillMaxWidth(anteil.coerceIn(0.0, 1.0).toFloat())
                    .height(8.dp)
                    .background(farbe, RoundedCornerShape(4.dp)),
            )
        }
    }
}

// ── Agenten auf einen Blick (App 2.4) ───────────────────────────────────────

/**
 * Jeder Agent hat überall dieselbe Farbe: in den Räumen, im Schwarm, bei den Aufträgen. Pastelltöne mit
 * dunkler Schrift, damit das Kürzel hell wie dunkel lesbar bleibt. Unbekannte Agenten bekommen eine Farbe
 * aus ihrer ID, die Melder ein ruhiges Grau.
 */
private val AgentFarben = listOf(
    Color(0xFFF2B84B), // Bernstein
    Color(0xFF8AB4F8), // Blau
    Color(0xFF81C995), // Grün
    Color(0xFFC792EA), // Violett
    Color(0xFFFF8A65), // Koralle
    Color(0xFF4DD0E1), // Türkis
    Color(0xFFF48FB1), // Rosa
    Color(0xFFD4E157), // Limette
)
private val MelderGrau = Color(0xFFB0BEC5)
private val MELDER = setOf("trader", "autoupdater", "unraid", "release", "sicherheit")

fun agentFarbe(id: String): Color = when (id) {
    "brian" -> AgentFarben[0]
    "betrieb" -> AgentFarben[1]
    "hermes-phone" -> AgentFarben[2]
    "plum" -> AgentFarben[3]
    "claude-code" -> AgentFarben[4]
    "codex-host" -> AgentFarben[5]
    in MELDER -> MelderGrau
    else -> AgentFarben[Math.floorMod(id.hashCode(), AgentFarben.size)]
}

/** „Claude Code“ → „CC“, „Codex (Host)“ → „C“, „Brian“ → „B“. */
fun initialen(name: String): String {
    val woerter = name.replace(Regex("""\([^)]*\)"""), " ")
        .split(Regex("""[\s_·-]+""")).filter { w -> w.any { it.isLetterOrDigit() } }
    return when {
        woerter.isEmpty() -> "?"
        woerter.size == 1 -> woerter[0].first { it.isLetterOrDigit() }.uppercase()
        else -> woerter.take(2).joinToString("") { w -> w.first { it.isLetterOrDigit() }.uppercase() }
    }
}

/** Der Kreis eines Agenten mit Kürzel; mit `status` ein Punkt unten rechts (online, träge, pausiert, offline). */
@Composable
fun AgentAvatar(id: String, name: String, status: AgentStatus? = null, groesse: Dp = 40.dp, modifier: Modifier = Modifier) {
    val f = MaterialTheme.colorScheme
    Box(modifier.size(groesse)) {
        Box(Modifier.fillMaxSize().clip(CircleShape).background(agentFarbe(id)), contentAlignment = Alignment.Center) {
            Text(
                initialen(name),
                color = Color(0xFF1B1B1F),
                style = if (groesse >= 48.dp) MaterialTheme.typography.titleMedium else MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
        if (status != null) {
            val punkt = when (status) {
                AgentStatus.ONLINE -> StatusGut
                AgentStatus.TRAEGE -> Warnorange
                AgentStatus.PAUSIERT -> StatusWarnung
                AgentStatus.OFFLINE -> f.outline
            }
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(groesse * 0.3f)
                    .clip(CircleShape)
                    .background(punkt)
                    .border(2.dp, f.surface, CircleShape),
            )
        }
    }
}

/** Ein runder Platz mit Symbol, gleich gross wie [AgentAvatar]: für Lobby, Alarme, Log und Co. */
@Composable
fun SymbolKreis(icon: ImageVector, grund: Color, farbe: Color, groesse: Dp = 40.dp) {
    Box(Modifier.size(groesse).clip(CircleShape).background(grund), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = farbe, modifier = Modifier.size(groesse * 0.5f))
    }
}
