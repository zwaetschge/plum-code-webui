package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.automirrored.outlined.StarHalf
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.chat.CodeBlock
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import kotlinx.serialization.json.JsonObject
import kotlin.math.min

// ── Tabs ────────────────────────────────────────────────────────────────────

@Composable
internal fun DuiTabs(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val tabs = node.objects("tabs")
    if (tabs.isEmpty()) return
    val bind = node.string("bind")
    var local by rememberSaveable(node.string("id")) { mutableIntStateOf(0) }
    val bound = bind?.let { uiNum(ctx.rt.state[it]) }?.takeIf { it.isFinite() }?.toInt()
    val selected = (bound ?: local).coerceIn(0, tabs.lastIndex)
    val reduce = reducedMotion()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val fits = maxWidth / tabs.size >= 76.dp
            val bar = @Composable {
                DuiSegmentBar(tabs.map { it.string("label").orEmpty() }, selected, { index ->
                    if (bind != null && !ctx.busy) ctx.set(bind, index.toDouble()) else local = index
                }, fill = fits)
            }
            if (fits) bar() else Box(Modifier.horizontalScroll(rememberScrollState())) { bar() }
        }
        AnimatedContent(
            targetState = selected,
            transitionSpec = {
                if (reduce) EnterTransition.None togetherWith ExitTransition.None
                else {
                    val direction = if (targetState > initialState) 1 else -1
                    (fadeIn(tween(DUI_ROW_MS, easing = DuiEase)) + slideInHorizontally(tween(DUI_ROW_MS, easing = DuiEase)) { it / 12 * direction }) togetherWith
                        (fadeOut(tween(160)) + slideOutHorizontally(tween(160)) { -it / 16 * direction }) using SizeTransform(clip = false)
                }
            },
            label = "dui_tabs",
        ) { index ->
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Children(tabs.getOrNull(index)?.objects("children").orEmpty(), ctx)
            }
        }
    }
}

// ── Accordion ───────────────────────────────────────────────────────────────

@Composable
internal fun DuiAccordion(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val items = node.objects("items")
    val palette = ctx.palette
    val reduce = reducedMotion()
    val shape = RoundedCornerShape(18.dp)
    Column(modifier.fillMaxWidth().clip(shape).border(1.dp, palette.duiEdge, shape)) {
        items.forEachIndexed { index, item ->
            var open by rememberSaveable(node.string("id"), index) { mutableStateOf(item.bool("open") == true) }
            val turn by animateFloatAsState(if (open) 180f else 0f, if (reduce) snap() else tween(DUI_ROW_MS, easing = DuiEase), label = "dui_accordion_chevron")
            val title = item.string("title").orEmpty()
            val stateLabel = stringResource(if (open) R.string.dynamic_ui_state_expanded else R.string.dynamic_ui_state_collapsed)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClickLabel = title) { open = !open }
                    .heightIn(min = 50.dp)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .semantics { stateDescription = stateLabel },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp), fontWeight = FontWeight.Medium, color = palette.text)
                Icon(Icons.Outlined.ExpandMore, null, tint = palette.muted, modifier = Modifier.size(20.dp).rotate(turn))
            }
            AnimatedVisibility(
                open,
                enter = if (reduce) EnterTransition.None else expandVertically(tween(DUI_ROW_MS, easing = DuiEase)) + fadeIn(tween(DUI_ROW_MS)),
                exit = if (reduce) ExitTransition.None else shrinkVertically(tween(220)) + fadeOut(tween(160)),
            ) {
                Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Children(item.objects("children"), ctx)
                }
            }
            if (index < items.lastIndex) HorizontalDivider(thickness = 1.dp, color = palette.duiEdge)
        }
    }
}

// ── Carousel ────────────────────────────────────────────────────────────────

internal fun aspectOf(value: String?, default: Float = 4f / 3f): Float = when (value) {
    "16:9" -> 16f / 9f
    "4:3" -> 4f / 3f
    "1:1" -> 1f
    "3:4" -> 3f / 4f
    else -> default
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun DuiCarousel(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val items = node.objects("items")
    if (items.isEmpty()) return
    val aspect = aspectOf(node.string("aspect"))
    val hasImages = items.any { it["image"] is JsonObject }
    DuiCardCarousel(items.size, modifier, cardWidthFraction = if (aspect < 1f) .56f else .74f, animate = ctx.animate) { index ->
        val item = items[index]
        val action = item["action"] as? JsonObject
        val enabled = action != null && ctx.canRun(action)
        val source = remember { MutableInteractionSource() }
        val image = item["image"] as? JsonObject
        Column(
            Modifier
                .fillMaxWidth()
                .pressScale(source)
                .clip(RoundedCornerShape(18.dp))
                .background(ctx.palette.duiField)
                .border(1.dp, ctx.palette.duiEdge, RoundedCornerShape(18.dp))
                .then(if (enabled) Modifier.clickable(interactionSource = source, indication = null, role = Role.Button) { action?.let(ctx.runAction) } else Modifier),
        ) {
            if (hasImages) Box(Modifier.fillMaxWidth().aspectRatio(aspect)) {
                if (image != null) DuiImage(image.string("src"), image.string("alt"), Modifier.matchParentSize(), fallback = { DuiImageFallback(Modifier.matchParentSize()) })
                else DuiImageFallback(Modifier.matchParentSize())
                item.string("badge")?.let { badge ->
                    Text(
                        badge,
                        Modifier.align(Alignment.TopStart).padding(10.dp).clip(CircleShape).background(Color.Black.copy(alpha = .55f)).padding(horizontal = 9.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp), fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 1,
                    )
                }
            }
            Column(Modifier.padding(horizontal = 12.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                if (!hasImages) item.string("badge")?.let { DuiBadge(it, "accent", ctx.palette) }
                Text(item.string("title").orEmpty(), style = MaterialTheme.typography.titleSmall.copy(fontSize = 14.sp), fontWeight = FontWeight.SemiBold, color = ctx.palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                item.string("subtitle")?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = ctx.palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                val meta = item.strings("meta")
                if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp).merge(duiTabular), fontWeight = FontWeight.Medium, color = ctx.palette.text.copy(alpha = .78f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/**
 * Horizontal row of cards that snaps to each card, with page dots. Cards are
 * about three quarters wide so the next one peeks in and invites a swipe.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun DuiCardCarousel(count: Int, modifier: Modifier, cardWidthFraction: Float = .74f, maxCardWidth: androidx.compose.ui.unit.Dp = 300.dp, animate: Boolean = false, card: @Composable (Int) -> Unit) {
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val pager = rememberPagerState { count }
    val reduce = reducedMotion()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val width = min(maxWidth.value * cardWidthFraction, maxCardWidth.value).dp
            HorizontalPager(
                state = pager,
                pageSize = PageSize.Fixed(width),
                pageSpacing = 12.dp,
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
            ) { index ->
                Box(Modifier.width(width).duiRise(animate, index)) { card(index) }
            }
        }
        if (count > 1) {
            val active by remember { derivedStateOf { if (!pager.canScrollForward) count - 1 else pager.currentPage } }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                repeat(count) { index ->
                    val on = index == active
                    val dot by animateFloatAsState(if (on) 18f else 6f, if (reduce) snap() else tween(DUI_ROW_MS, easing = DuiEase), label = "dui_dot")
                    Box(Modifier.padding(horizontal = 3.dp).height(6.dp).width(dot.dp).clip(CircleShape).background(if (on) palette.text.copy(alpha = .75f) else palette.text.copy(alpha = .2f)))
                }
            }
        }
    }
}

// ── List ────────────────────────────────────────────────────────────────────

@Composable
internal fun DuiList(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val items = node.objects("items")
    val palette = ctx.palette
    Column(modifier.fillMaxWidth()) {
        items.forEachIndexed { index, item ->
            val action = item["action"] as? JsonObject
            val enabled = action != null && ctx.canRun(action)
            val image = item["image"] as? JsonObject
            val icon = item.string("icon")
            Row(
                Modifier
                    .fillMaxWidth()
                    .duiRise(ctx.animate, index)
                    .clip(RoundedCornerShape(12.dp))
                    .then(if (enabled) Modifier.clickable(role = Role.Button) { action?.let(ctx.runAction) } else Modifier)
                    .heightIn(min = 52.dp)
                    .padding(horizontal = 4.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when {
                    image != null -> DuiImage(image.string("src"), image.string("alt"), Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)), fallback = { DuiImageFallback(Modifier.size(44.dp)) })
                    icon != null -> Box(Modifier.size(36.dp).clip(CircleShape).background(palette.accent.copy(alpha = .13f)), contentAlignment = Alignment.Center) {
                        val vector = uiIconFor(icon)
                        if (vector != null) Icon(vector, null, tint = palette.accent, modifier = Modifier.size(18.dp))
                        else Text(icon, fontSize = 17.sp)
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(ctx.rt.template(item.string("title").orEmpty()), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), fontWeight = FontWeight.Medium, color = palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    item.string("subtitle")?.let { Text(ctx.rt.template(it), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                }
                item.string("trailing")?.let { Text(ctx.rt.template(it), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text, textAlign = TextAlign.End, maxLines = 1) }
                if (enabled) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = palette.muted, modifier = Modifier.size(18.dp))
            }
            if (index < items.lastIndex) HorizontalDivider(Modifier.padding(start = if (image != null || icon != null) 56.dp else 4.dp), thickness = 1.dp, color = palette.text.copy(alpha = .07f))
        }
    }
}

// ── Timeline ────────────────────────────────────────────────────────────────

@Composable
internal fun DuiTimeline(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val items = node.objects("items")
    val palette = ctx.palette
    val line = palette.text.copy(alpha = .14f)
    Column(modifier.fillMaxWidth()) {
        items.forEachIndexed { index, item ->
            val status = item.string("status")
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).duiRise(ctx.animate, index)) {
                Box(Modifier.width(28.dp).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
                    Canvas(Modifier.width(2.dp).fillMaxHeight()) {
                        val dotCenter = 11.dp.toPx()
                        if (index > 0) drawLine(line, Offset(size.width / 2, 0f), Offset(size.width / 2, dotCenter), strokeWidth = 2.dp.toPx())
                        if (index < items.lastIndex) drawLine(if (status == "done") palette.accent.copy(alpha = .55f) else line, Offset(size.width / 2, dotCenter), Offset(size.width / 2, size.height), strokeWidth = 2.dp.toPx())
                    }
                    Box(Modifier.padding(top = 3.dp).size(16.dp), contentAlignment = Alignment.Center) {
                        when (status) {
                            "done" -> Box(Modifier.size(16.dp).clip(CircleShape).background(palette.accent), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(11.dp))
                            }
                            "current" -> Box(Modifier.size(16.dp).clip(CircleShape).background(palette.accent.copy(alpha = .22f)), contentAlignment = Alignment.Center) {
                                Box(Modifier.size(8.dp).clip(CircleShape).background(palette.accent))
                            }
                            else -> Box(Modifier.size(12.dp).clip(CircleShape).background(com.claudewebui.app.ui.theme.PlumTheme.palette.background).border(2.dp, palette.text.copy(alpha = .28f), CircleShape))
                        }
                    }
                }
                Column(Modifier.weight(1f).padding(start = 8.dp, bottom = if (index < items.lastIndex) 18.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    item.string("time")?.let { Text(it, style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp).merge(duiTabular), fontWeight = FontWeight.Medium, color = if (status == "current") palette.accent else palette.muted) }
                    Text(item.string("title").orEmpty(), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), fontWeight = FontWeight.SemiBold, color = if (status == "upcoming") palette.text.copy(alpha = .8f) else palette.text)
                    item.string("text")?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted) }
                }
            }
        }
    }
}

// ── Callout ─────────────────────────────────────────────────────────────────

@Composable
internal fun DuiCallout(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val tone = duiTone(node.string("tone"), ctx.palette)
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(tone.fill)
            .border(1.dp, tone.color.copy(alpha = .22f), shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(tone.icon, null, tint = tone.color, modifier = Modifier.padding(top = 1.dp).size(19.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            node.string("title")?.let { Text(ctx.rt.template(it), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = ctx.palette.text, modifier = Modifier.semantics { heading() }) }
            Text(ctx.rt.template(node.string("text").orEmpty()), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp), color = ctx.palette.text.copy(alpha = .9f))
        }
    }
}

// ── Progress ────────────────────────────────────────────────────────────────

@Composable
internal fun DuiProgress(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val value = uiNum(ctx.rt.safe(node.string("value").orEmpty())).takeIf { it.isFinite() } ?: 0.0
    val max = node.string("max")?.let { uiNum(ctx.rt.safe(it)) }?.takeIf { it.isFinite() && it > 0 } ?: 100.0
    val fraction = (value / max).coerceIn(0.0, 1.0).toFloat()
    val shown = node.string("format")?.let { formatUiValue(value, it) } ?: "${Math.round(fraction * 100)} %"
    val label = node.string("label")?.let { ctx.rt.template(it) }
    val reduce = reducedMotion()
    val animated = remember { Animatable(if (ctx.animate && !reduce) 0f else fraction) }
    LaunchedEffect(fraction) { if (reduce) animated.snapTo(fraction) else animated.animateTo(fraction, tween(900, easing = DuiEase)) }
    val palette = ctx.palette
    if (node.string("kind") == "ring") {
        Row(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = listOfNotNull(label, shown).joinToString(": ") }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(64.dp)) {
                    val stroke = 7.dp.toPx()
                    val inset = stroke / 2
                    drawArc(palette.text.copy(alpha = .1f), 0f, 360f, false, Offset(inset, inset), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke))
                    drawArc(palette.accent, -90f, 360f * animated.value, false, Offset(inset, inset), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Round))
                }
                Text("${Math.round(fraction * 100)}%", style = MaterialTheme.typography.labelLarge.merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text)
            }
            Column(Modifier.weight(1f)) {
                label?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = palette.text) }
                // The ring already shows the share; the caption gives the absolute values.
                val caption = node.string("format")?.let { shown } ?: if (max != 100.0) "${formatUiValue(value)} / ${formatUiValue(max)}" else null
                caption?.let { Text(it, style = MaterialTheme.typography.bodySmall.merge(duiTabular), color = palette.muted) }
            }
        }
    } else {
        Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = listOfNotNull(label, shown).joinToString(": ") }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Text(label.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.text)
                Text(shown, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text)
            }
            Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(palette.text.copy(alpha = .09f))) {
                Box(Modifier.fillMaxWidth(animated.value).height(8.dp).clip(CircleShape).background(palette.accent))
            }
        }
    }
}

// ── Rating ──────────────────────────────────────────────────────────────────

@Composable
internal fun DuiRating(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val value = (node.number("value") ?: 0.0).coerceIn(0.0, 5.0)
    val count = node.number("count")
    val label = node.string("label")
    val gold = Color(0xFFF5B83D)
    val description = stringResource(R.string.dynamic_ui_rating, formatUiValue(value, "decimal:1"))
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = listOfNotNull(label, description).joinToString(", ") }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Row {
            for (star in 1..5) {
                val icon = when {
                    value >= star -> Icons.Outlined.Star
                    value >= star - .5 -> Icons.AutoMirrored.Outlined.StarHalf
                    else -> Icons.Outlined.StarBorder
                }
                Icon(icon, null, tint = if (value >= star - .5) gold else ctx.palette.text.copy(alpha = .25f), modifier = Modifier.size(18.dp))
            }
        }
        Text(formatUiValue(value, "decimal:1"), style = MaterialTheme.typography.labelLarge.merge(duiTabular), fontWeight = FontWeight.SemiBold, color = ctx.palette.text)
        count?.let { Text("(${formatUiValue(it, "integer")})", style = MaterialTheme.typography.labelMedium.merge(duiTabular), color = ctx.palette.muted) }
        label?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = ctx.palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

// ── Image ───────────────────────────────────────────────────────────────────

@Composable
internal fun DuiImageNode(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val src = node.string("src") ?: return
    val alt = node.string("alt")
    val caption = node.string("caption")
    var failed by remember(src) { mutableStateOf(false) }
    var lightbox by remember { mutableStateOf(false) }
    // A broken image disappears quietly (plan 2.1).
    if (failed) return
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        DuiImage(
            src, alt,
            Modifier.fillMaxWidth().aspectRatio(aspectOf(node.string("aspect"), 16f / 9f)).clip(RoundedCornerShape(16.dp)).clickable(role = Role.Image) { lightbox = true },
            onFailed = { failed = true },
        )
        caption?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = ctx.palette.muted) }
    }
    if (lightbox) DuiLightbox(listOf(DuiLightboxImage(src, alt, caption)), 0) { lightbox = false }
}

// ── Code ────────────────────────────────────────────────────────────────────

@Composable
internal fun DuiCode(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        node.string("title")?.let { Text(it, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = ctx.palette.text) }
        CodeBlock(node.string("code").orEmpty(), node.string("language").orEmpty(), Modifier.fillMaxWidth())
    }
}

// ── Math ────────────────────────────────────────────────────────────────────

@Composable
internal fun DuiMath(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val tex = node.string("tex").orEmpty()
    val display = node.bool("display") != false
    val text = remember(tex) { texToUnicode(tex) }
    Box(
        modifier
            .fillMaxWidth()
            .then(if (display) Modifier.clip(RoundedCornerShape(14.dp)).background(ctx.palette.duiField).padding(vertical = 14.dp, horizontal = 12.dp) else Modifier)
            .horizontalScroll(rememberScrollState())
            .semantics { contentDescription = tex },
        contentAlignment = if (display) Alignment.Center else Alignment.CenterStart,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge.copy(fontSize = if (display) 19.sp else 16.sp, fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic, letterSpacing = .2.sp),
            color = ctx.palette.text,
            maxLines = 4,
        )
    }
}

private val TEX_SYMBOLS = mapOf(
    "alpha" to "α", "beta" to "β", "gamma" to "γ", "delta" to "δ", "epsilon" to "ε", "varepsilon" to "ε", "zeta" to "ζ", "eta" to "η",
    "theta" to "θ", "vartheta" to "ϑ", "iota" to "ι", "kappa" to "κ", "lambda" to "λ", "mu" to "μ", "nu" to "ν", "xi" to "ξ", "pi" to "π",
    "rho" to "ρ", "sigma" to "σ", "tau" to "τ", "upsilon" to "υ", "phi" to "φ", "varphi" to "φ", "chi" to "χ", "psi" to "ψ", "omega" to "ω",
    "Gamma" to "Γ", "Delta" to "Δ", "Theta" to "Θ", "Lambda" to "Λ", "Xi" to "Ξ", "Pi" to "Π", "Sigma" to "Σ", "Phi" to "Φ", "Psi" to "Ψ", "Omega" to "Ω",
    "cdot" to "·", "times" to "×", "div" to "÷", "pm" to "±", "mp" to "∓", "leq" to "≤", "le" to "≤", "geq" to "≥", "ge" to "≥", "neq" to "≠", "ne" to "≠",
    "approx" to "≈", "equiv" to "≡", "sim" to "∼", "propto" to "∝", "infty" to "∞", "partial" to "∂", "nabla" to "∇", "sum" to "∑", "prod" to "∏",
    "int" to "∫", "oint" to "∮", "to" to "→", "rightarrow" to "→", "leftarrow" to "←", "Rightarrow" to "⇒", "Leftrightarrow" to "⇔", "mapsto" to "↦",
    "in" to "∈", "notin" to "∉", "subset" to "⊂", "subseteq" to "⊆", "cup" to "∪", "cap" to "∩", "forall" to "∀", "exists" to "∃", "emptyset" to "∅",
    "degree" to "°", "circ" to "∘", "ldots" to "…", "cdots" to "⋯", "dots" to "…", "angle" to "∠", "perp" to "⊥", "parallel" to "∥", "hbar" to "ħ",
    "sqrt" to "√", "log" to "log", "ln" to "ln", "sin" to "sin", "cos" to "cos", "tan" to "tan", "lim" to "lim", "exp" to "exp", "max" to "max", "min" to "min",
    "quad" to "  ", "qquad" to "    ", "," to " ", ";" to " ", ":" to " ", "!" to "", " " to " ", "{" to "{", "}" to "}", "%" to "%", "\\" to "\n",
)
private const val SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"
private const val SUPERSCRIPT_SOURCE = "0123456789+-=()ni"
private const val SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₙᵢⱼₖₘₚₛₜ"
private const val SUBSCRIPT_SOURCE = "0123456789+-=()aeoxnijkmpst"

/**
 * A readable plain-text rendering of TeX without a math engine: Greek letters
 * and operators become Unicode, fractions and roots get brackets, short
 * exponents and indices use superscript/subscript digits.
 */
internal fun texToUnicode(source: String): String {
    var i = 0
    fun group(): String {
        while (i < source.length && source[i] == ' ') i++
        if (i >= source.length) return ""
        if (source[i] == '{') {
            var depth = 0
            val start = i + 1
            while (i < source.length) {
                if (source[i] == '{') depth++
                if (source[i] == '}') { depth--; if (depth == 0) break }
                i++
            }
            val inner = source.substring(start, i.coerceAtMost(source.length))
            i++
            return texToUnicode(inner)
        }
        if (source[i] == '\\') {
            val start = i
            i++
            while (i < source.length && source[i].isLetter()) i++
            return texToUnicode(source.substring(start, i))
        }
        return source[i++].toString()
    }
    fun script(text: String, from: String, to: String): String? = if (text.all { from.indexOf(it) >= 0 }) text.map { to[from.indexOf(it)] }.joinToString("") else null
    fun wrap(text: String) = if (text.length <= 1 || text.all { it.isLetterOrDigit() }) text else "($text)"
    val out = StringBuilder()
    while (i < source.length) {
        val c = source[i]
        when {
            c == '\\' -> {
                i++
                val start = i
                if (i < source.length && !source[i].isLetter()) { i++ } else while (i < source.length && source[i].isLetter()) i++
                val command = source.substring(start, i)
                when (command) {
                    "frac", "dfrac", "tfrac" -> { val a = group(); val b = group(); out.append(wrap(a)).append('/').append(wrap(b)) }
                    "sqrt" -> {
                        var index = ""
                        if (i < source.length && source[i] == '[') { val end = source.indexOf(']', i); if (end > i) { index = source.substring(i + 1, end); i = end + 1 } }
                        val body = group()
                        out.append(script(index, SUPERSCRIPT_SOURCE, SUPERSCRIPTS) ?: index).append('√').append(wrap(body))
                    }
                    "text", "mathrm", "mathbf", "mathit", "operatorname", "textbf", "mathsf", "boldsymbol" -> out.append(group())
                    "left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "limits" -> Unit
                    else -> out.append(TEX_SYMBOLS[command] ?: command)
                }
            }
            c == '^' || c == '_' -> {
                i++
                val body = group()
                val mapped = if (c == '^') script(body, SUPERSCRIPT_SOURCE, SUPERSCRIPTS) else script(body, SUBSCRIPT_SOURCE, SUBSCRIPTS)
                out.append(mapped ?: (if (c == '^') "^" else "_") + wrap(body))
            }
            c == '{' || c == '}' -> i++
            c == '&' -> { out.append("  "); i++ }
            else -> { out.append(c); i++ }
        }
    }
    return out.toString().replace(Regex(" {3,}"), "  ").trim()
}
