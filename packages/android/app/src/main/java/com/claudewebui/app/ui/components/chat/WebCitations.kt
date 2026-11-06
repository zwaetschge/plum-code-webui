package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.AssistantWebSource
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.theme.PlumTheme
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Comparable form of a cited URL: host without "www.", path without trailing
 * slash, query kept, fragment and scheme dropped. Models echo the tool URL but
 * not always byte for byte.
 */
internal fun webSourceKey(url: String): String? {
    val trimmed = url.trim().substringBefore('#')
    val scheme = trimmed.indexOf("://")
    if (scheme <= 0) return null
    val rest = trimmed.substring(scheme + 3)
    val hostEnd = rest.indexOfAny(charArrayOf('/', '?')).let { if (it < 0) rest.length else it }
    val host = rest.substring(0, hostEnd).lowercase().removePrefix("www.")
    if (host.isEmpty()) return null
    val tail = rest.substring(hostEnd)
    val path = tail.substringBefore('?').trimEnd('/')
    val query = tail.substringAfter('?', "")
    return host + path + if (query.isNotEmpty()) "?$query" else ""
}

/** Hostname shown for a source; the backend sends it, older data may not. */
internal fun webSourceDomain(source: AssistantWebSource): String =
    source.domain.ifBlank { webSourceKey(source.url)?.substringBefore('/')?.substringBefore('?').orEmpty() }.ifBlank { source.url }

/** Resolves a markdown link to one of the turn's sources, or null for an ordinary link. */
internal class WebSourceIndex(sources: List<AssistantWebSource>) {
    private val byKey = sources.mapNotNull { source -> webSourceKey(source.url)?.let { it to source } }.toMap()
    private val byRef = sources.associateBy { it.ref }

    fun match(label: String, url: String): AssistantWebSource? {
        val key = webSourceKey(url) ?: return null
        byKey[key]?.let { return it }
        // `[3](…)` whose URL drifted (tracking parameters, another path on the
        // same site) still belongs to source 3 as long as the host agrees.
        val ref = label.trim().removePrefix("[").removeSuffix("]").toIntOrNull() ?: return null
        val source = byRef[ref] ?: return null
        return source.takeIf { webSourceKey(it.url)?.substringBefore('/')?.substringBefore('?') == key.substringBefore('/').substringBefore('?') }
    }
}

/** Adjacent citations collapse into one chip: `srf.ch +2`. */
internal data class CitationGroup(val start: Int, val end: Int, val sources: List<AssistantWebSource>) {
    val label: String get() = webSourceDomain(sources.first()) + if (sources.size > 1) " +${sources.size - 1}" else ""
}

/** Citation links in one rendered block, in text order; separators of only spaces and commas join neighbours. */
internal fun citationGroups(text: AnnotatedString, sources: List<AssistantWebSource>): List<CitationGroup> {
    if (sources.isEmpty()) return emptyList()
    val index = WebSourceIndex(sources)
    val groups = mutableListOf<CitationGroup>()
    for (link in text.getStringAnnotations(LINK_TAG, 0, text.length).sortedBy { it.start }) {
        val source = index.match(text.text.substring(link.start, link.end), link.item) ?: continue
        val last = groups.lastOrNull()
        if (last != null && link.start >= last.end && text.text.substring(last.end, link.start).all { it.isWhitespace() || it == ',' }) {
            groups[groups.lastIndex] = last.copy(end = link.end, sources = (last.sources + source).distinctBy { it.ref })
        } else if (last == null || link.start >= last.end) {
            groups += CitationGroup(link.start, link.end, listOf(source))
        }
    }
    return groups
}

/** `[label](url)` pairs of raw markdown, allowing balanced parentheses inside the URL. */
internal fun markdownLinks(markdown: String): List<Pair<String, String>> {
    val links = mutableListOf<Pair<String, String>>()
    var cursor = 0
    while (true) {
        val open = markdown.indexOf('[', cursor)
        if (open < 0) break
        val close = markdown.indexOf(']', open + 1)
        if (close < 0) break
        if (close + 1 < markdown.length && markdown[close + 1] == '(') {
            val end = linkUrlEnd(markdown, close + 2)
            if (end > close + 2) {
                links += markdown.substring(open + 1, close) to markdown.substring(close + 2, end)
                cursor = end + 1
                continue
            }
        }
        cursor = open + 1
    }
    return links
}

/** Index of the `)` closing a link URL that starts at [from], or -1. */
internal fun linkUrlEnd(text: String, from: Int): Int {
    var depth = 0
    for (index in from until text.length) {
        when (text[index]) {
            '(' -> depth++
            ')' -> if (depth == 0) return index else depth--
            '\n' -> return -1
        }
    }
    return -1
}

/** Refs the answer actually cites, in order of first appearance. */
internal fun citedWebRefs(markdown: String, sources: List<AssistantWebSource>): List<Int> {
    if (sources.isEmpty() || markdown.isEmpty()) return emptyList()
    val index = WebSourceIndex(sources)
    return markdownLinks(markdown).mapNotNull { (label, url) -> index.match(label, url)?.ref }.distinct()
}

/** Cited sources first (in citation order), the rest after them by ref. */
internal fun orderedWebSources(markdown: String, sources: List<AssistantWebSource>): List<AssistantWebSource> {
    val cited = citedWebRefs(markdown, sources)
    val byRef = sources.associateBy { it.ref }
    val first = cited.mapNotNull { byRef[it] }
    return first + sources.filter { it.ref !in cited }.sortedBy { it.ref }
}

/** Short local date of a source, or null when none is known or it does not parse. */
internal fun webSourceDate(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val zone = ZoneId.systemDefault()
    val date = runCatching { OffsetDateTime.parse(value).atZoneSameInstant(zone).toLocalDate() }.getOrNull()
        ?: runCatching { Instant.parse(value).atZone(zone).toLocalDate() }.getOrNull()
        ?: runCatching { LocalDate.parse(value.take(10)) }.getOrNull()
        ?: return null
    return date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
}

internal const val LINK_TAG = "URL"

// ── Rendering ─────────────────────────────────────────────────────────────────

private val CHIP_PADDING = 7.dp
private val CHIP_MARGIN = 2.dp
private val CHIP_HEIGHT = 18.sp

/**
 * A text block whose web citations render as compact domain chips. Other links
 * stay ordinary underlined links that open in the browser.
 */
@Composable
internal fun CitedText(
    text: AnnotatedString,
    style: TextStyle,
    sources: List<AssistantWebSource>,
    onCitation: (List<AssistantWebSource>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val uriHandler = LocalUriHandler.current
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val chipStyle = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.sp)
    val currentOnCitation by rememberUpdatedState(onCitation)
    val groups = remember(text, sources) { citationGroups(text, sources) }
    val shown = remember(text, groups) {
        if (groups.isEmpty()) text else buildAnnotatedString {
            var cursor = 0
            groups.forEachIndexed { index, group ->
                append(text.subSequence(cursor, group.start))
                appendInlineContent("cite:$index", group.label)
                cursor = group.end
            }
            append(text.subSequence(cursor, text.length))
        }
    }
    val inline = remember(groups, density, chipStyle) {
        groups.mapIndexed { index, group ->
            val label = group.label
            val textWidth = measurer.measure(AnnotatedString(label), style = chipStyle, maxLines = 1, softWrap = false).size.width
            val width = with(density) { (textWidth + ((CHIP_PADDING + CHIP_MARGIN) * 2).toPx()).toSp() }
            "cite:$index" to InlineTextContent(Placeholder(width, CHIP_HEIGHT, PlaceholderVerticalAlign.TextCenter)) {
                CitationChip(label, chipStyle) { currentOnCitation(group.sources) }
            }
        }.toMap()
    }
    val layout = remember { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text = shown,
        style = style,
        inlineContent = inline,
        onTextLayout = { layout.value = it },
        modifier = modifier.pointerInput(shown) {
            detectTapGestures { position ->
                val offset = layout.value?.getOffsetForPosition(position) ?: return@detectTapGestures
                shown.getStringAnnotations(LINK_TAG, offset, offset).firstOrNull()?.item
                    ?.let { url -> runCatching { uriHandler.openUri(url) } }
            }
        },
    )
}

@Composable
private fun CitationChip(label: String, style: TextStyle, onClick: () -> Unit) {
    val palette = PlumTheme.palette
    val shape = RoundedCornerShape(50)
    val interaction = remember { MutableInteractionSource() }
    Box(
        Modifier
            .fillMaxSize()
            .padding(horizontal = CHIP_MARGIN)
            .pressScale(interaction)
            .clip(shape)
            .background(palette.trackFill)
            .border(1.dp, palette.borderSoft, shape)
            .clickable(interactionSource = interaction, indication = androidx.compose.foundation.LocalIndication.current, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = style, color = palette.muted, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip)
    }
}
