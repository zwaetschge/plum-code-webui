package com.claudewebui.swarm.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Markdown für Brians Antworten (Allgemein, App 2.1): Überschriften, Absätze mit Zeilenumbrüchen,
 * Listen (auch verschachtelt und mit Häkchen), Zitate, Codeblöcke mit Sprache und Kopierknopf,
 * Tabellen, Trennlinien; im Text Fett, Kursiv, Durchgestrichen, Code und Links. Kein HTML, keine
 * Bilder aus dem Netz: Ein Bild-Link bleibt ein Link. Nur http, https und mailto werden antippbar.
 */
sealed interface MdBlock {
    data class Absatz(val text: String) : MdBlock
    data class Titel(val stufe: Int, val text: String) : MdBlock
    data class Code(val sprache: String?, val text: String) : MdBlock
    data class Zitat(val bloecke: List<MdBlock>) : MdBlock
    data class Liste(val geordnet: Boolean, val start: Int, val punkte: List<Punkt>) : MdBlock
    data class Tabelle(val kopf: List<String>, val ausrichtung: List<TextAlign>, val zeilen: List<List<String>>) : MdBlock
    data object Linie : MdBlock
}

/** Ein Listenpunkt; `erledigt` bei `- [x]` und `- [ ]`. */
data class Punkt(val bloecke: List<MdBlock>, val erledigt: Boolean? = null)

object MarkdownLeser {
    private val titel = Regex("""^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$""")
    private val linie = Regex("""^([-*_])(?:\s*\1){2,}\s*$""")
    private val marke = Regex("""^([-*+]|\d{1,9}[.)])(?:\s+(.*))?$""")
    private val trennzeile = Regex("""^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$""")
    private val haekchen = Regex("""^\[([ xX])]\s+(.*)$""")

    fun lesen(text: String): List<MdBlock> = bloecke(text.replace("\r\n", "\n").replace('\t', ' ').split('\n'))

    private fun einzug(z: String) = z.length - z.trimStart().length

    private fun istZaun(t: String) = t.startsWith("```") || t.startsWith("~~~")

    /** Beginnt hier ein neuer Block, der einen Absatz unterbricht? */
    private fun unterbricht(z: String, naechste: String?): Boolean {
        val t = z.trimStart()
        if (einzug(z) > 3) return false
        return istZaun(t) || titel.matches(t) || t.startsWith(">") || linie.matches(t) ||
            marke.matchEntire(t)?.groupValues?.get(2)?.isNotBlank() == true ||
            (t.contains('|') && naechste != null && trennzeile.matches(naechste.trim()) && naechste.contains('-'))
    }

    private fun bloecke(zeilen: List<String>): List<MdBlock> {
        val aus = ArrayList<MdBlock>()
        val absatz = ArrayList<String>()
        fun absatzSchliessen() {
            if (absatz.isNotEmpty()) aus += MdBlock.Absatz(absatz.joinToString("\n"))
            absatz.clear()
        }
        var i = 0
        while (i < zeilen.size) {
            val z = zeilen[i]
            val t = z.trimStart()
            val e = einzug(z)
            val naechste = zeilen.getOrNull(i + 1)
            when {
                t.isEmpty() -> {
                    absatzSchliessen()
                    i++
                }
                e <= 3 && istZaun(t) -> {
                    absatzSchliessen()
                    val zeichen = t[0]
                    val zaun = t.takeWhile { it == zeichen }
                    val sprache = t.drop(zaun.length).trim().substringBefore(' ').trim('{', '}', '.').ifBlank { null }
                    val code = ArrayList<String>()
                    i++
                    while (i < zeilen.size) {
                        val c = zeilen[i].trim()
                        if (c.startsWith(zaun) && c.all { it == zeichen }) break
                        // Den Einzug des Zauns abziehen, wie CommonMark.
                        code += zeilen[i].let { l -> l.drop(minOf(e, einzug(l))) }
                        i++
                    }
                    i++
                    aus += MdBlock.Code(sprache, code.joinToString("\n").trimEnd('\n'))
                }
                e <= 3 && titel.matches(t) -> {
                    absatzSchliessen()
                    val m = titel.matchEntire(t)!!
                    aus += MdBlock.Titel(m.groupValues[1].length, m.groupValues[2])
                    i++
                }
                e <= 3 && linie.matches(t) -> {
                    absatzSchliessen()
                    aus += MdBlock.Linie
                    i++
                }
                e <= 3 && t.startsWith(">") -> {
                    absatzSchliessen()
                    val innen = ArrayList<String>()
                    while (i < zeilen.size && zeilen[i].trimStart().startsWith(">")) {
                        innen += zeilen[i].trimStart().removePrefix(">").removePrefix(" ")
                        i++
                    }
                    aus += MdBlock.Zitat(bloecke(innen))
                }
                t.contains('|') && naechste != null && naechste.contains('-') && trennzeile.matches(naechste.trim()) -> {
                    absatzSchliessen()
                    val kopf = zellen(t)
                    val ausrichtung = zellen(naechste.trim()).map { s ->
                        val l = s.startsWith(":")
                        val r = s.endsWith(":")
                        when {
                            l && r -> TextAlign.Center
                            r -> TextAlign.End
                            else -> TextAlign.Start
                        }
                    }
                    i += 2
                    val reihen = ArrayList<List<String>>()
                    while (i < zeilen.size && zeilen[i].isNotBlank() && zeilen[i].contains('|')) {
                        reihen += zellen(zeilen[i].trim())
                        i++
                    }
                    aus += MdBlock.Tabelle(kopf, ausrichtung, reihen)
                }
                e <= 3 && marke.matches(t) && (absatz.isEmpty() || marke.matchEntire(t)!!.groupValues[2].isNotBlank()) -> {
                    absatzSchliessen()
                    i = liste(zeilen, i, aus)
                }
                else -> {
                    // Ein Absatz; Zeilenumbrüche bleiben, wie in einem Chat erwartet.
                    if (absatz.isNotEmpty() && unterbricht(z, naechste)) absatzSchliessen()
                    absatz += z.trim()
                    i++
                }
            }
        }
        absatzSchliessen()
        return aus
    }

    /** Eine Liste ab Zeile `start`; liefert die erste Zeile danach. */
    private fun liste(zeilen: List<String>, start: Int, aus: MutableList<MdBlock>): Int {
        val basis = einzug(zeilen[start])
        val erste = marke.matchEntire(zeilen[start].trimStart())!!
        val geordnet = erste.groupValues[1].first().isDigit()
        val nummer = if (geordnet) erste.groupValues[1].dropLast(1).toIntOrNull() ?: 1 else 1
        val punkte = ArrayList<Punkt>()
        var i = start
        while (i < zeilen.size) {
            val z = zeilen[i]
            val t = z.trimStart()
            val m = marke.matchEntire(t)
            if (m == null || einzug(z) > basis + 1 || m.groupValues[1].first().isDigit() != geordnet) break
            val markeLaenge = m.groupValues[1].length
            val nachMarke = t.drop(markeLaenge)
            val inhaltEinzug = basis + markeLaenge + (nachMarke.length - nachMarke.trimStart().length).coerceIn(1, 4)
            val schwelle = minOf(inhaltEinzug, basis + 2)
            val inhalt = ArrayList<String>()
            inhalt += m.groupValues[2]
            i++
            var leer = false
            while (i < zeilen.size) {
                val l = zeilen[i]
                if (l.isBlank()) {
                    leer = true
                    inhalt += ""
                    i++
                    continue
                }
                val le = einzug(l)
                if (le >= schwelle) {
                    inhalt += l.drop(minOf(le, inhaltEinzug))
                    leer = false
                    i++
                    continue
                }
                // Ohne Leerzeile davor läuft ein Absatz im Punkt weiter (lazy continuation).
                val lt = l.trimStart()
                if (!leer && !marke.matches(lt) && !unterbricht(l, zeilen.getOrNull(i + 1))) {
                    inhalt += lt
                    i++
                    continue
                }
                break
            }
            // Leerzeilen am Ende gehören nicht mehr zum Punkt.
            while (inhalt.size > 1 && inhalt.last().isBlank()) inhalt.removeAt(inhalt.size - 1)
            var erledigt: Boolean? = null
            val kopf = inhalt.firstOrNull().orEmpty()
            haekchen.matchEntire(kopf)?.let { h ->
                erledigt = h.groupValues[1] != " "
                inhalt[0] = h.groupValues[2]
            }
            punkte += Punkt(bloecke(inhalt), erledigt)
            // Nach einer Leerzeile geht die Liste nur weiter, wenn gleich der nächste Punkt kommt.
            if (i < zeilen.size && zeilen[i - 1].isBlank() && marke.matchEntire(zeilen[i].trimStart()) == null) break
        }
        aus += MdBlock.Liste(geordnet, nummer, punkte)
        return i
    }

    /** Zellen einer Tabellenzeile; `\|` bleibt ein Strich, in `Code` trennt er nicht. */
    fun zellen(zeile: String): List<String> {
        var s = zeile.trim()
        if (s.startsWith("|")) s = s.drop(1)
        if (s.endsWith("|") && !s.endsWith("\\|")) s = s.dropLast(1)
        val aus = ArrayList<String>()
        val feld = StringBuilder()
        var imCode = false
        var j = 0
        while (j < s.length) {
            val c = s[j]
            when {
                c == '\\' && j + 1 < s.length && s[j + 1] == '|' -> {
                    feld.append('|')
                    j += 2
                    continue
                }
                c == '`' -> imCode = !imCode
                c == '|' && !imCode -> {
                    aus += feld.toString().trim()
                    feld.clear()
                    j++
                    continue
                }
            }
            feld.append(c)
            j++
        }
        aus += feld.toString().trim()
        return aus
    }
}

// ── Inline ──────────────────────────────────────────────────────────────────

private const val ESCAPBAR = "\\`*_{}[]()#+-.!|~<>\""

private fun erlaubterLink(url: String): Boolean {
    val u = url.trim().lowercase()
    return u.startsWith("https://") || u.startsWith("http://") || u.startsWith("mailto:")
}

/** Text mit Fett, Kursiv, Durchgestrichen, Code und Links. */
fun inlineText(text: String, f: ColorScheme): AnnotatedString = buildAnnotatedString { inlineAnhaengen(text, f) }

private fun AnnotatedString.Builder.inlineAnhaengen(text: String, f: ColorScheme) {
    val puffer = StringBuilder()
    fun leeren() {
        if (puffer.isNotEmpty()) append(puffer.toString())
        puffer.clear()
    }
    val codeStil = SpanStyle(
        fontFamily = FontFamily.Monospace,
        background = f.onSurface.copy(alpha = 0.08f),
        fontSize = 0.92.em,
    )
    val linkStil = TextLinkStyles(SpanStyle(color = f.primary, textDecoration = TextDecoration.Underline))
    var i = 0
    while (i < text.length) {
        val c = text[i]
        // \* und Co.
        if (c == '\\' && i + 1 < text.length && text[i + 1] in ESCAPBAR) {
            puffer.append(text[i + 1])
            i += 2
            continue
        }
        // `Code`
        if (c == '`') {
            var n = 0
            while (i + n < text.length && text[i + n] == '`') n++
            val zaun = "`".repeat(n)
            var ende = text.indexOf(zaun, i + n)
            while (ende >= 0 && ende + n < text.length && text[ende + n] == '`') ende = text.indexOf(zaun, ende + n + 1)
            if (ende < 0) {
                puffer.append(zaun)
                i += n
                continue
            }
            leeren()
            var code = text.substring(i + n, ende).replace('\n', ' ')
            if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.isNotBlank()) code = code.substring(1, code.length - 1)
            withStyle(codeStil) { append(code) }
            i = ende + n
            continue
        }
        // **fett**, __fett__, ~~durchgestrichen~~
        if (i + 1 < text.length && (text.startsWith("**", i) || text.startsWith("__", i) || text.startsWith("~~", i))) {
            val m = text.substring(i, i + 2)
            val ende = schluss(text, m, i + 2)
            if (ende > i + 2 && (m != "__" || wortgrenze(text, i - 1)) && (m != "__" || wortgrenze(text, ende + 2))) {
                leeren()
                val stil = when (m) {
                    "~~" -> SpanStyle(textDecoration = TextDecoration.LineThrough)
                    else -> SpanStyle(fontWeight = FontWeight.Bold)
                }
                withStyle(stil) { inlineAnhaengen(text.substring(i + 2, ende), f) }
                i = ende + 2
                continue
            }
            puffer.append(m)
            i += 2
            continue
        }
        // *kursiv*, _kursiv_
        if ((c == '*' || c == '_') && i + 1 < text.length && !text[i + 1].isWhitespace() && (c == '*' || wortgrenze(text, i - 1))) {
            val ende = schlussEinfach(text, c, i + 1)
            if (ende > i + 1 && (c == '*' || wortgrenze(text, ende + 1))) {
                leeren()
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { inlineAnhaengen(text.substring(i + 1, ende), f) }
                i = ende + 1
                continue
            }
        }
        // [Text](url) und ![Bild](url)
        if (c == '[' || (c == '!' && text.startsWith("![", i))) {
            val bild = c == '!'
            val auf = if (bild) i + 1 else i
            val zu = klammerZu(text, auf, '[', ']')
            if (zu > 0 && zu + 1 < text.length && text[zu + 1] == '(') {
                val rund = klammerZu(text, zu + 1, '(', ')')
                if (rund > 0) {
                    val ziel = text.substring(zu + 2, rund).trim().substringBefore(' ').removePrefix("<").removeSuffix(">")
                    val label = text.substring(auf + 1, zu)
                    leeren()
                    if (erlaubterLink(ziel)) {
                        withLink(LinkAnnotation.Url(ziel, linkStil)) {
                            if (bild) append("🖼 ${label.ifBlank { "Bild" }}") else inlineAnhaengen(label, f)
                        }
                    } else {
                        inlineAnhaengen(label, f)
                    }
                    i = rund + 1
                    continue
                }
            }
        }
        // <https://…>
        if (c == '<') {
            val zu = text.indexOf('>', i + 1)
            if (zu > i) {
                val ziel = text.substring(i + 1, zu)
                if (erlaubterLink(ziel) && ziel.none { it.isWhitespace() }) {
                    leeren()
                    withLink(LinkAnnotation.Url(ziel, linkStil)) { append(ziel) }
                    i = zu + 1
                    continue
                }
            }
        }
        // Nackte Adressen
        if ((c == 'h' || c == 'H') && (text.startsWith("https://", i, true) || text.startsWith("http://", i, true)) &&
            (i == 0 || !text[i - 1].isLetterOrDigit())
        ) {
            var ende = i
            while (ende < text.length && !text[ende].isWhitespace() && text[ende] !in "<>\"") ende++
            var url = text.substring(i, ende)
            // Satzzeichen am Ende gehören nicht zur Adresse, eine schliessende Klammer nur, wenn eine offen ist.
            while (url.isNotEmpty() && (url.last() in ".,;:!?'" || (url.last() == ')' && url.count { it == '(' } < url.count { it == ')' }))) {
                url = url.dropLast(1)
            }
            if (url.length > 8) {
                leeren()
                withLink(LinkAnnotation.Url(url, linkStil)) { append(url) }
                i += url.length
                continue
            }
        }
        puffer.append(c)
        i++
    }
    leeren()
}

private fun wortgrenze(text: String, j: Int): Boolean = j < 0 || j >= text.length || !text[j].isLetterOrDigit()

/** Schliessendes `**`, `__` oder `~~`: davor kein Leerzeichen, und nicht gleich am Anfang. */
private fun schluss(text: String, m: String, von: Int): Int {
    if (von >= text.length || text[von].isWhitespace()) return -1
    var j = text.indexOf(m, von + 1)
    while (j > 0) {
        if (!text[j - 1].isWhitespace()) return j
        j = text.indexOf(m, j + 1)
    }
    return -1
}

/** Schliessendes `*` oder `_`, das nicht Teil von `**` ist. */
private fun schlussEinfach(text: String, zeichen: Char, von: Int): Int {
    var j = von
    while (j < text.length) {
        val c = text[j]
        if (c == '`') {
            val zu = text.indexOf('`', j + 1)
            if (zu > j) {
                j = zu + 1
                continue
            }
        }
        if (c == zeichen) {
            if (j + 1 < text.length && text[j + 1] == zeichen) {
                // ** innen überspringen (fett im Kursiv)
                val zu = text.indexOf("$zeichen$zeichen", j + 2)
                if (zu > 0) {
                    j = zu + 2
                    continue
                }
                return -1
            }
            if (j > von && !text[j - 1].isWhitespace()) return j
        }
        j++
    }
    return -1
}

private fun klammerZu(text: String, auf: Int, a: Char, z: Char): Int {
    var tiefe = 0
    var j = auf
    while (j < text.length) {
        when (text[j]) {
            '\\' -> j++
            a -> tiefe++
            z -> {
                tiefe--
                if (tiefe == 0) return j
            }
            '\n' -> if (a == '(') return -1
        }
        j++
    }
    return -1
}

// ── Darstellung ─────────────────────────────────────────────────────────────

/** Markdown als Blöcke untereinander. */
@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier) {
    val bloecke = remember(text) { MarkdownLeser.lesen(text) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        bloecke.forEach { MdBlockAnsicht(it, 0) }
    }
}

@Composable
private fun MdBlockAnsicht(b: MdBlock, tiefe: Int) {
    val f = MaterialTheme.colorScheme
    val typo = MaterialTheme.typography
    when (b) {
        is MdBlock.Absatz -> Text(inlineText(b.text, f), style = typo.bodyLarge)
        is MdBlock.Titel -> Text(
            inlineText(b.text, f),
            style = when (b.stufe) {
                1 -> typo.titleLarge
                2 -> typo.titleMedium.copy(fontSize = 18.sp)
                else -> typo.titleSmall.copy(fontSize = 16.sp)
            },
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = if (tiefe == 0) 6.dp else 0.dp),
        )
        is MdBlock.Code -> CodeBlock(b.sprache, b.text)
        is MdBlock.Zitat -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(f.outlineVariant, RoundedCornerShape(2.dp)))
            Spacer(Modifier.width(10.dp))
            androidx.compose.runtime.CompositionLocalProvider(LocalContentColor provides f.onSurfaceVariant) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { b.bloecke.forEach { MdBlockAnsicht(it, tiefe + 1) } }
            }
        }
        is MdBlock.Liste -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            b.punkte.forEachIndexed { i, p ->
                Row {
                    val zeichen = when {
                        p.erledigt == true -> "☑"
                        p.erledigt == false -> "☐"
                        b.geordnet -> "${b.start + i}."
                        tiefe == 0 -> "•"
                        tiefe == 1 -> "◦"
                        else -> "▪"
                    }
                    Text(
                        zeichen,
                        style = typo.bodyLarge,
                        color = if (b.geordnet) f.onSurfaceVariant else f.primary,
                        textAlign = TextAlign.End,
                        modifier = Modifier.widthIn(min = if (b.geordnet) 22.dp else 14.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        p.bloecke.forEach { MdBlockAnsicht(it, tiefe + 1) }
                    }
                }
            }
        }
        is MdBlock.Tabelle -> TabelleAnsicht(b)
        MdBlock.Linie -> HorizontalDivider(Modifier.padding(vertical = 4.dp))
    }
}

/** Ein Codeblock: Sprache und Kopieren oben, darunter der Code, waagrecht scrollbar. */
@Composable
fun CodeBlock(sprache: String?, code: String) {
    val f = MaterialTheme.colorScheme
    val zwischenablage = LocalClipboardManager.current
    var kopiert by remember { mutableStateOf(false) }
    LaunchedEffect(kopiert) {
        if (kopiert) {
            delay(2_000)
            kopiert = false
        }
    }
    val dunkel = f.surface.luminance() < 0.5f
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = f.surfaceContainerHighest,
        border = BorderStroke(1.dp, f.outlineVariant.copy(alpha = 0.6f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().background(f.surfaceContainerHigh).padding(start = 12.dp, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    sprache ?: "Code",
                    style = MaterialTheme.typography.labelMedium,
                    color = f.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = {
                    zwischenablage.setText(AnnotatedString(code))
                    kopiert = true
                }) {
                    Icon(if (kopiert) Icons.Outlined.Check else Icons.Outlined.ContentCopy, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (kopiert) "Kopiert" else "Kopieren", style = MaterialTheme.typography.labelMedium)
                }
            }
            Text(
                remember(code, sprache, dunkel) { hervorheben(code, sprache, dunkel) },
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                softWrap = false,
                color = f.onSurface,
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
    }
}

private val schluesselwoerter = setOf(
    // Kotlin, Java, JS/TS, Python, Rust, Go, Shell, SQL: die häufigsten, gross und klein
    "fun", "val", "var", "class", "object", "interface", "data", "sealed", "enum", "when", "if", "else", "for", "while",
    "do", "return", "break", "continue", "in", "is", "as", "null", "true", "false", "this", "super", "import", "package",
    "private", "public", "protected", "internal", "override", "suspend", "const", "let", "function", "async", "await",
    "new", "try", "catch", "finally", "throw", "throws", "static", "void", "int", "string", "def", "lambda", "from",
    "None", "True", "False", "and", "or", "not", "pass", "with", "yield", "elif", "self", "fn", "mut", "impl", "struct",
    "pub", "use", "mod", "match", "func", "go", "defer", "type", "export", "default", "extends", "implements",
    "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE", "ALTER", "INDEX", "JOIN", "ON", "AND",
    "OR", "NOT", "NULL", "AS", "ORDER", "BY", "GROUP", "LIMIT", "SET", "INTO", "VALUES", "echo", "then", "fi", "esac",
    "done", "export", "local", "case", "select",
)

/** Leichte Hervorhebung: Kommentare, Zeichenketten, Zahlen, Schlüsselwörter. Kein Parser, nur Zeichen. */
private fun hervorheben(code: String, sprache: String?, dunkel: Boolean): AnnotatedString {
    val kommentarFarbe = if (dunkel) Color(0xFF8B949E) else Color(0xFF6A737D)
    val textFarbe = if (dunkel) Color(0xFFA5D6A7) else Color(0xFF22863A)
    val zahlFarbe = if (dunkel) Color(0xFFFFB86C) else Color(0xFFB35900)
    val wortFarbe = if (dunkel) Color(0xFF82AAFF) else Color(0xFF0550AE)
    val s = sprache?.lowercase()
    val rautenKommentar = s in setOf("python", "py", "bash", "sh", "shell", "zsh", "yaml", "yml", "toml", "ruby", "rb", "perl", "r", "dockerfile", "conf", "ini")
    val ohneFarben = s in setOf("text", "txt", "plain", "diff", "patch", "log", "output", "console")
    return buildAnnotatedString {
        if (ohneFarben) {
            append(code)
            return@buildAnnotatedString
        }
        var i = 0
        while (i < code.length) {
            val c = code[i]
            val kommentar = (c == '/' && code.startsWith("//", i)) || (c == '#' && rautenKommentar) ||
                (c == '-' && code.startsWith("--", i) && s == "sql")
            when {
                kommentar -> {
                    val ende = code.indexOf('\n', i).let { if (it < 0) code.length else it }
                    withStyle(SpanStyle(color = kommentarFarbe, fontStyle = FontStyle.Italic)) { append(code.substring(i, ende)) }
                    i = ende
                }
                c == '/' && code.startsWith("/*", i) -> {
                    val ende = code.indexOf("*/", i + 2).let { if (it < 0) code.length else it + 2 }
                    withStyle(SpanStyle(color = kommentarFarbe, fontStyle = FontStyle.Italic)) { append(code.substring(i, ende)) }
                    i = ende
                }
                c == '"' || c == '\'' || c == '`' -> {
                    var j = i + 1
                    while (j < code.length && code[j] != c && code[j] != '\n') {
                        if (code[j] == '\\') j++
                        j++
                    }
                    val ende = (j + 1).coerceAtMost(code.length)
                    withStyle(SpanStyle(color = textFarbe)) { append(code.substring(i, ende)) }
                    i = ende
                }
                c.isDigit() && (i == 0 || !code[i - 1].isLetterOrDigit() && code[i - 1] != '_') -> {
                    var j = i
                    while (j < code.length && (code[j].isLetterOrDigit() || code[j] == '.' || code[j] == '_')) j++
                    withStyle(SpanStyle(color = zahlFarbe)) { append(code.substring(i, j)) }
                    i = j
                }
                c.isLetter() || c == '_' -> {
                    var j = i
                    while (j < code.length && (code[j].isLetterOrDigit() || code[j] == '_')) j++
                    val wort = code.substring(i, j)
                    if (wort in schluesselwoerter) withStyle(SpanStyle(color = wortFarbe, fontWeight = FontWeight.Medium)) { append(wort) }
                    else append(wort)
                    i = j
                }
                else -> {
                    append(c)
                    i++
                }
            }
        }
    }
}

/** Eine Tabelle: Spalten so breit wie nötig (höchstens 260 dp), bei Bedarf waagrecht scrollbar. */
@Composable
private fun TabelleAnsicht(t: MdBlock.Tabelle) {
    val f = MaterialTheme.colorScheme
    val spalten = maxOf(t.kopf.size, t.zeilen.maxOfOrNull { it.size } ?: 0)
    if (spalten == 0) return
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        Box(Modifier.border(1.dp, f.outlineVariant, RoundedCornerShape(8.dp)).padding(1.dp)) {
            TabellenLayout(spalten) {
                for (c in 0 until spalten) {
                    Zelle(t.kopf.getOrElse(c) { "" }, t.ausrichtung.getOrElse(c) { TextAlign.Start }, f.surfaceContainerHigh, fett = true)
                }
                t.zeilen.forEachIndexed { r, zeile ->
                    val grund = if (r % 2 == 1) f.surfaceContainerLow else Color.Transparent
                    for (c in 0 until spalten) {
                        Zelle(zeile.getOrElse(c) { "" }, t.ausrichtung.getOrElse(c) { TextAlign.Start }, grund, fett = false)
                    }
                }
            }
        }
    }
}

@Composable
private fun Zelle(text: String, ausrichtung: TextAlign, grund: Color, fett: Boolean) {
    val f = MaterialTheme.colorScheme
    Box(
        Modifier
            .background(grund)
            .border(0.5.dp, f.outlineVariant.copy(alpha = 0.7f))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        contentAlignment = when (ausrichtung) {
            TextAlign.Center -> Alignment.Center
            TextAlign.End -> Alignment.CenterEnd
            else -> Alignment.CenterStart
        },
    ) {
        Text(
            inlineText(text, f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (fett) FontWeight.SemiBold else null,
            textAlign = ausrichtung,
        )
    }
}

/** Zellen Zeile für Zeile; jede Spalte so breit wie ihre breiteste Zelle, jede Zeile so hoch wie ihre höchste. */
@Composable
private fun TabellenLayout(spalten: Int, inhalt: @Composable () -> Unit) {
    val maxZelle = with(LocalDensity.current) { 260.dp.roundToPx() }
    Layout(inhalt) { teile, _ ->
        val zeilen = (teile.size + spalten - 1) / spalten
        val breiten = IntArray(spalten)
        teile.forEachIndexed { i, m ->
            val c = i % spalten
            breiten[c] = maxOf(breiten[c], minOf(m.maxIntrinsicWidth(Constraints.Infinity), maxZelle))
        }
        val hoehen = IntArray(zeilen)
        teile.forEachIndexed { i, m -> hoehen[i / spalten] = maxOf(hoehen[i / spalten], m.minIntrinsicHeight(breiten[i % spalten])) }
        val platziert = teile.mapIndexed { i, m -> m.measure(Constraints.fixed(breiten[i % spalten], hoehen[i / spalten])) }
        layout(breiten.sum(), hoehen.sum()) {
            var y = 0
            for (r in 0 until zeilen) {
                var x = 0
                for (c in 0 until spalten) {
                    platziert.getOrNull(r * spalten + c)?.place(x, y)
                    x += breiten[c]
                }
                y += hoehen[r]
            }
        }
    }
}
