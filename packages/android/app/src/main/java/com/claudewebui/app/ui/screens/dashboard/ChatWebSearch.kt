package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.InfiniteTransition
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.AssistantChatToolEvent
import com.claudewebui.app.data.model.AssistantWebSource
import com.claudewebui.app.ui.components.chat.orderedWebSources
import com.claudewebui.app.ui.components.chat.webSourceDate
import com.claudewebui.app.ui.components.chat.webSourceDomain
import com.claudewebui.app.ui.components.chat.webSourceKey
import com.claudewebui.app.ui.motion.PlumMotionTokens
import com.claudewebui.app.ui.motion.orSnap
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

internal fun isWebTool(name: String) = name == "web_search" || name == "web_fetch"

private val toolJson = Json { ignoreUnknownKeys = true; isLenient = true }

private fun toolObject(raw: String?): JsonObject? =
    raw?.takeIf { it.isNotBlank() }?.let { runCatching { toolJson.parseToJsonElement(it) as? JsonObject }.getOrNull() }

private fun toolString(raw: String?, key: String): String? =
    toolObject(raw)?.get(key)?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }?.takeIf { it.isNotBlank() }

/** Distinct pages the web tools reported, for turns saved before `webSources` existed. */
private fun toolSourceCount(events: List<AssistantChatToolEvent>): Int {
    val urls = HashSet<String>()
    events.forEach { event ->
        if (event.status != "completed") return@forEach
        val result = toolObject(event.result)
        if (event.name == "web_search") (result?.get("results") as? JsonArray)?.forEach { item ->
            ((item as? JsonObject)?.get("url"))?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }?.let { url -> webSourceKey(url)?.let(urls::add) }
        } else (result?.get("url")?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() } ?: toolString(event.arguments, "url"))
            ?.let { url -> webSourceKey(url)?.let(urls::add) }
    }
    return urls.size
}

private fun openWebSource(uriHandler: androidx.compose.ui.platform.UriHandler, url: String) {
    if (url.startsWith("https://") || url.startsWith("http://")) runCatching { uriHandler.openUri(url) }
}

/**
 * The turn's web_search/web_fetch calls as one line ("Web durchsucht · 2 Suchen
 * · 9 Quellen"); a tap lists the queries and read pages. Other tools are not
 * shown here.
 */
@Composable
internal fun ChatWebSearchActivity(events: List<AssistantChatToolEvent>, sources: List<AssistantWebSource>) {
    val web = events.filter { isWebTool(it.name) }
    val reduce = reducedMotion()
    AnimatedVisibility(
        visible = web.isNotEmpty(),
        enter = if (reduce) EnterTransition.None else fadeIn(PlumMotionTokens.enterTween()) + expandVertically(PlumMotionTokens.enterTween()),
        exit = if (reduce) ExitTransition.None else fadeOut(PlumMotionTokens.exitTween()) + shrinkVertically(PlumMotionTokens.exitTween()),
    ) {
        if (web.isNotEmpty()) WebSearchActivityLine(web, sources, reduce)
    }
}

@Composable
private fun WebSearchActivityLine(web: List<AssistantChatToolEvent>, sources: List<AssistantWebSource>, reduce: Boolean) {
    val palette = PlumTheme.palette
    var expanded by rememberSaveable { mutableStateOf(false) }
    val searches = web.count { it.name == "web_search" }
    val pages = web.count { it.name == "web_fetch" }
    val running = web.any { it.status == "running" }
    val failed = web.all { it.status == "failed" }
    val sourceCount = if (sources.isNotEmpty()) sources.size else remember(web) { toolSourceCount(web) }
    val resources = LocalContext.current.resources
    val headline = stringResource(when { running -> R.string.web_search_running; failed -> R.string.web_search_failed; else -> R.string.web_search_done })
    val parts = buildList {
        add(headline)
        if (searches > 0) add(resources.getQuantityString(R.plurals.web_search_searches, searches, searches))
        if (sourceCount > 0) add(resources.getQuantityString(R.plurals.web_search_sources, sourceCount, sourceCount))
        else if (searches == 0 && pages > 0) add(resources.getQuantityString(R.plurals.web_search_pages, pages, pages))
    }
    val pulse: Float = if (running && !reduce) {
        val transition: InfiniteTransition = rememberInfiniteTransition(label = "web_search_pulse")
        val value by transition.animateFloat(0.4f, 1f, infiniteRepeatable(tween(900, easing = PlumMotionTokens.EnterEasing), RepeatMode.Reverse), label = "web_search_alpha")
        value
    } else 1f
    val turn by animateFloatAsState(if (expanded) 180f else 0f, PlumMotionTokens.menuSpring<Float>().orSnap(reduce), label = "web_search_chevron")
    val interaction = remember { MutableInteractionSource() }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .clip(RoundedCornerShape(PlumTheme.tokens.radius.sm))
                .clickable(interactionSource = interaction, indication = androidx.compose.foundation.LocalIndication.current, role = Role.Button, onClickLabel = stringResource(R.string.web_search_queries)) { expanded = !expanded }
                .padding(vertical = 4.dp, horizontal = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Outlined.Language, null, tint = if (failed) palette.red else palette.muted, modifier = Modifier.size(15.dp).alpha(pulse))
            Text(parts.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Icon(Icons.Outlined.ExpandMore, null, tint = palette.muted, modifier = Modifier.size(16.dp).rotate(turn))
        }
        AnimatedVisibility(
            visible = expanded,
            enter = if (reduce) EnterTransition.None else fadeIn(PlumMotionTokens.enterTween()) + expandVertically(PlumMotionTokens.enterTween()),
            exit = if (reduce) ExitTransition.None else fadeOut(PlumMotionTokens.exitTween()) + shrinkVertically(PlumMotionTokens.exitTween()),
        ) {
            Column(Modifier.padding(start = 23.dp, top = 2.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                web.forEach { event ->
                    val search = event.name == "web_search"
                    val label = if (search) toolString(event.arguments, "query")
                    else (toolString(event.result, "title") ?: toolString(event.arguments, "url")?.let { url -> webSourceKey(url) ?: url })
                    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(
                            if (search) Icons.Outlined.Search else Icons.AutoMirrored.Outlined.Article, null,
                            tint = if (event.status == "failed") palette.red else palette.muted,
                            modifier = Modifier.padding(top = 2.dp).size(14.dp),
                        )
                        Text(label ?: event.name, style = MaterialTheme.typography.bodySmall, color = if (event.status == "failed") palette.muted else palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

/**
 * „Quellen“ under an answer: compact cards, the cited ones first. A tap opens
 * the page, a long press shows its details.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ChatWebSourcesRow(sources: List<AssistantWebSource>, response: String, onDetails: (List<AssistantWebSource>) -> Unit) {
    val reduce = reducedMotion()
    val palette = PlumTheme.palette
    val uriHandler = LocalUriHandler.current
    val ordered = remember(sources, response) { orderedWebSources(response, sources) }
    AnimatedVisibility(
        visible = ordered.isNotEmpty(),
        enter = if (reduce) EnterTransition.None else fadeIn(PlumMotionTokens.enterTween()) + expandVertically(PlumMotionTokens.enterTween()),
        exit = if (reduce) ExitTransition.None else fadeOut(PlumMotionTokens.exitTween()) + shrinkVertically(PlumMotionTokens.exitTween()),
    ) {
        Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(stringResource(R.string.web_sources_title), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = palette.muted)
                Text(ordered.size.toString(), style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ordered.forEach { source ->
                    key(source.ref) {
                        val interaction = remember { MutableInteractionSource() }
                        val shape = RoundedCornerShape(PlumTheme.tokens.radius.md)
                        Surface(
                            shape = shape,
                            color = palette.subtleFill,
                            border = BorderStroke(1.dp, palette.borderSoft),
                            modifier = Modifier
                                .width(196.dp)
                                .pressScale(interaction)
                                .clip(shape)
                                .combinedClickable(
                                    interactionSource = interaction,
                                    indication = androidx.compose.foundation.LocalIndication.current,
                                    role = Role.Button,
                                    onLongClick = { onDetails(listOf(source)) },
                                    onClick = { openWebSource(uriHandler, source.url) },
                                ),
                        ) {
                            Column(Modifier.padding(horizontal = 11.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                WebSourceMeta(source, compact = true)
                                Text(
                                    source.title.ifBlank { source.url },
                                    style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, color = palette.text,
                                    minLines = 2, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Globe, domain and date. No favicon is fetched: pages are never contacted from the app. */
@Composable
private fun WebSourceMeta(source: AssistantWebSource, compact: Boolean) {
    val palette = PlumTheme.palette
    val style = if (compact) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelMedium
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(Icons.Outlined.Language, null, tint = palette.muted, modifier = Modifier.size(if (compact) 12.dp else 14.dp))
        Text(webSourceDomain(source), style = style, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        webSourceDate(source.publishedAt)?.let { date -> Text("· $date", style = style, color = palette.muted, maxLines = 1, softWrap = false) }
    }
}

/** Details of the sources behind a citation chip, each with „Öffnen“. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatWebSourceSheet(sources: List<AssistantWebSource>, onDismiss: () -> Unit) {
    val palette = PlumTheme.palette
    val uriHandler = LocalUriHandler.current
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            sources.forEachIndexed { index, source ->
                if (index > 0) HorizontalDivider(color = palette.borderSoft)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    WebSourceMeta(source, compact = false)
                    Text(source.title.ifBlank { source.url }, style = MaterialTheme.typography.titleMedium, color = palette.text)
                    if (source.excerpt.isNotBlank()) Text(source.excerpt, style = MaterialTheme.typography.bodyMedium, color = palette.muted, maxLines = 6, overflow = TextOverflow.Ellipsis)
                    FilledTonalButton(onClick = { openWebSource(uriHandler, source.url); onDismiss() }, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
                        Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.web_source_open))
                    }
                }
            }
        }
    }
}
