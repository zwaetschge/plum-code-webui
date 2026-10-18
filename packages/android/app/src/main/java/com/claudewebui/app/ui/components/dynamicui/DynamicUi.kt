package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.NorthEast
import androidx.compose.material.icons.outlined.SouthEast
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.chat.MarkdownContent
import com.claudewebui.app.ui.motion.orSnap
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.GlassRole
import com.claudewebui.app.ui.theme.PlumPalette
import com.claudewebui.app.ui.theme.PlumTheme
import com.claudewebui.app.ui.theme.plumGlass
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.math.max
import kotlin.math.min

/**
 * Native renderer for Dynamic UI (generative UI) in the model chat, matching
 * `DynamicUi.tsx` in the WebUI. All components of one message share one
 * state; every input change rebuilds the [UiRuntime], so formulas, views,
 * KPIs, tables and charts recompute at once without a network round trip.
 */

private class DuiCtx(
    val rt: UiRuntime,
    val palette: PlumPalette,
    val set: (String, Any?) -> Unit,
    val reset: () -> Unit,
    val send: ((String) -> Unit)?,
    val busy: Boolean,
)

/* WebUI's --dui-edge (foreground / 0.12) and --dui-field (foreground / 0.06). */
private val PlumPalette.duiEdge: Color get() = text.copy(alpha = .12f)
private val PlumPalette.duiField: Color get() = text.copy(alpha = .06f)
private val PlumPalette.success: Color get() = Color.hsl(142f, .60f, .52f)

private val tabular = TextStyle(fontFeatureSettings = "tnum")

private val StateSaver = Saver<Map<String, Any?>, String>(
    save = { state -> JsonObject(state.mapValues { uiValueToJson(it.value) }).toString() },
    restore = { saved -> runCatching { Json.parseToJsonElement(saved).jsonObject.mapValues { uiValueOf(it.value) } }.getOrNull() },
)

/**
 * Renders a Dynamic UI description inside an assistant message. Invalid
 * descriptions show only a short muted note; the text answer stands alone.
 */
@Composable
fun DynamicUi(spec: JsonObject, busy: Boolean, onSendMessage: ((String) -> Unit)?, modifier: Modifier = Modifier, stateStore: DynamicUiStateStore? = null, stateKey: String = "local") {
    // Client-side validation: stored history must pass the same gate as fresh answers.
    val checked = remember(spec) { validateDynamicUi(spec) }
    if (checked is DynamicUiValidation.Invalid) {
        DynamicUiNote(stringResource(R.string.dynamic_ui_rejected, checked.error), modifier)
        return
    }
    val doc = (checked as DynamicUiValidation.Valid).doc
    val view = spec.string("viewId") ?: stateKey
    val localStore = rememberSaveable(view, saver = DynamicUiStateStore.StateSaver) { DynamicUiStateStore() }
    val store = stateStore ?: localStore
    val state = mergeDynamicUiState(doc.state, store.edits[view].orEmpty())
    val palette = PlumTheme.palette
    val runtime = remember(doc, state) { UiRuntime(doc, state) }
    val ctx = DuiCtx(
        rt = runtime,
        palette = palette,
        set = { key, value -> if (!busy) store.set(view, key, value) },
        reset = { if (!busy) store.reset(view) },
        send = onSendMessage,
        busy = busy,
    )
    Column(modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        doc.title?.let { title ->
            Text(title, style = MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp), fontWeight = FontWeight.SemiBold, color = palette.text, modifier = Modifier.semantics { heading() })
        }
        DuiNode(doc.root, ctx)
    }
}

/** Shown while the model still streams the view's description. */
@Composable
fun DynamicUiPending(modifier: Modifier = Modifier) {
    val palette = PlumTheme.palette
    val reduce = reducedMotion()
    val label = stringResource(R.string.dynamic_ui_pending)
    val shift = if (reduce) 0f else {
        val transition = rememberInfiniteTransition(label = "dui_pending")
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "dui_shimmer").value
    }
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .clip(RoundedCornerShape(16.dp))
            .border(1.dp, palette.text.copy(alpha = .16f), RoundedCornerShape(16.dp))
            .padding(16.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted)
        listOf(1f, .78f, .55f).forEach { fraction ->
            BoxWithConstraints(Modifier.fillMaxWidth(fraction).height(10.dp).clip(CircleShape)) {
                val width = constraints.maxWidth.toFloat().coerceAtLeast(1f)
                val base = palette.text.copy(alpha = .06f)
                val shine = palette.text.copy(alpha = .14f)
                val offset = (1f - 2f * shift) * width * 2f
                Box(
                    Modifier.fillMaxWidth().height(10.dp).background(
                        if (reduce) SolidColor(base) else Brush.horizontalGradient(listOf(base, shine, base), startX = offset - width, endX = offset + width),
                    ),
                )
            }
        }
    }
}

/** A short muted note below the answer: a discarded or broken view. */
@Composable
fun DynamicUiNote(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = PlumTheme.palette.muted)
}

// ── Registry ────────────────────────────────────────────────────────────────

/** The component registry: the only UI a model can reach. */
@Composable
private fun DuiNode(node: JsonObject, ctx: DuiCtx, modifier: Modifier = Modifier) {
    when (node.string("type")) {
        "stack" -> DuiStack(node, ctx, modifier)
        "row" -> DuiRow(node, ctx, modifier)
        "grid" -> DuiGrid(node, ctx, modifier)
        "card" -> DuiCard(node, ctx, modifier)
        "calculator" -> DuiCalculator(node, ctx, modifier)
        "heading" -> DuiHeading(node, ctx, modifier)
        "text" -> DuiText(node, ctx, modifier)
        "markdown" -> MarkdownContent(ctx.rt.template(node.string("text").orEmpty()), modifier.fillMaxWidth())
        "badge" -> Box(modifier) { DuiBadge(ctx.rt.template(node.string("text").orEmpty()), node.string("tone") ?: "neutral", ctx.palette) }
        "divider" -> HorizontalDivider(modifier, thickness = 1.dp, color = ctx.palette.duiEdge)
        "kpi" -> DuiKpi(node, ctx, modifier)
        "slider" -> DuiSlider(node, ctx, modifier)
        "input" -> DuiInput(node, ctx, modifier)
        "select" -> DuiSelect(node, ctx, modifier)
        "segmented" -> DuiSegmented(node, ctx, modifier)
        "checkbox" -> DuiCheckbox(node, ctx, modifier)
        "button" -> DuiButton(node, ctx, modifier)
        "table" -> DuiTable(node, ctx, modifier)
        "chart" -> DuiChart(node, ctx.rt.source(dataOf(node)), chartColors(ctx.palette), ctx.palette, modifier)
        "compare" -> DuiCompare(node, ctx, modifier)
    }
}

/** A component's `data`: a dataset or view name, or inline rows. */
private fun dataOf(node: JsonObject): Any? {
    val data = node["data"]
    return if (data.isStr()) (data as JsonPrimitive).content else rowsOf(data)
}

private fun gapOf(node: JsonObject): Dp = when (node.string("gap")) { "sm" -> 8.dp; "lg" -> 18.dp; else -> 12.dp }

@Composable
private fun Children(nodes: List<JsonObject>, ctx: DuiCtx) {
    nodes.forEach { DuiNode(it, ctx) }
}

@Composable
private fun DuiStack(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gapOf(node))) { Children(node.objects("children"), ctx) }
}

/** Lines of equal-width cells; the last line of a wrapping row stretches like CSS flex-grow. */
@Composable
private fun Lines(children: List<JsonObject>, perLine: Int, gap: Dp, ctx: DuiCtx, fillLast: Boolean) {
    val stretch = children.isNotEmpty() && children.all { it.string("type") == "kpi" }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
        children.chunked(max(1, perLine)).forEach { line ->
            // KPI tiles in one line share their height, like CSS grid stretch.
            Row(Modifier.fillMaxWidth().then(if (stretch) Modifier.height(IntrinsicSize.Min) else Modifier), horizontalArrangement = Arrangement.spacedBy(gap)) {
                line.forEach { child -> DuiNode(child, ctx, Modifier.weight(1f).then(if (stretch) Modifier.fillMaxHeight() else Modifier)) }
                if (!fillLast) repeat(perLine - line.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun DuiRow(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val children = node.objects("children")
    val gap = gapOf(node)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // CSS: flex 1 1 160px with wrapping; without wrap everything shares one line.
        val perLine = if (node.bool("wrap") == false) children.size else ((maxWidth + gap) / (160.dp + gap)).toInt().coerceIn(1, max(1, children.size))
        Lines(children, perLine, gap, ctx, fillLast = true)
    }
}

@Composable
private fun DuiGrid(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val columns = (node.number("columns") ?: 2.0).toInt().coerceIn(1, 4)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // Narrow message widths get fewer columns, like the WebUI's media queries.
        val shown = when {
            maxWidth < 300.dp -> 1
            maxWidth < 520.dp -> min(columns, 2)
            else -> columns
        }
        Lines(node.objects("children"), shown, 12.dp, ctx, fillLast = false)
    }
}

@Composable
private fun DuiSurface(modifier: Modifier, highlighted: Boolean = false, palette: PlumPalette, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val reduce = reducedMotion()
    val border by animateColorAsState(
        if (highlighted) palette.accent.copy(alpha = .55f) else palette.duiEdge,
        tween<Color>(160).orSnap(reduce), label = "dui_card_border",
    )
    Box(
        modifier
            .fillMaxWidth()
            .then(if (highlighted) Modifier.border(3.dp, palette.accent.copy(alpha = .14f), shape) else Modifier)
            .plumGlass(GlassRole.Default, shape, borderColor = border),
    ) { content() }
}

@Composable
private fun DuiCard(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val highlighted = node.string("highlight")?.let { uiTruthy(ctx.rt.safe(it)) } ?: false
    DuiSurface(modifier, highlighted, ctx.palette) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val title = node.string("title")
            val subtitle = node.string("subtitle")
            if (title != null || subtitle != null) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                title?.let { Text(ctx.rt.template(it), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = ctx.palette.text, modifier = Modifier.semantics { heading() }) }
                subtitle?.let { Text(ctx.rt.template(it), style = MaterialTheme.typography.bodySmall, color = ctx.palette.muted) }
            }
            Children(node.objects("children"), ctx)
        }
    }
}

@Composable
private fun DuiCalculator(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    DuiSurface(modifier, palette = ctx.palette) {
        BoxWithConstraints(Modifier.padding(16.dp)) {
            val wide = maxWidth >= 520.dp
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                node.string("title")?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = ctx.palette.text, modifier = Modifier.semantics { heading() }) }
                val inputs = @Composable { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { Children(node.objects("inputs"), ctx) } }
                val outputs = @Composable { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { Children(node.objects("outputs"), ctx) } }
                // Inputs and outputs side by side when wide, stacked when narrow.
                if (wide) Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Box(Modifier.weight(1.2f)) { inputs() }
                    Box(Modifier.weight(1f)) { outputs() }
                } else {
                    inputs()
                    outputs()
                }
                (node["chart"] as? JsonObject)?.let { DuiNode(it, ctx) }
            }
        }
    }
}

@Composable
private fun DuiHeading(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val text = ctx.rt.template(node.string("text").orEmpty())
    val small = node.number("level") == 3.0
    Text(
        if (small) text.uppercase() else text,
        modifier.semantics { heading() },
        style = if (small) MaterialTheme.typography.labelMedium.copy(fontSize = 13.sp, letterSpacing = .5.sp) else MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp),
        fontWeight = FontWeight.SemiBold,
        color = if (small) ctx.palette.muted else ctx.palette.text,
    )
}

@Composable
private fun DuiText(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val tone = node.string("tone")
    Text(
        ctx.rt.template(node.string("text").orEmpty()),
        modifier,
        style = if (tone == "muted") MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp) else MaterialTheme.typography.bodyMedium,
        fontWeight = if (tone == "strong") FontWeight.SemiBold else null,
        color = if (tone == "muted") ctx.palette.muted else ctx.palette.text,
    )
}

@Composable
private fun DuiBadge(text: String, tone: String, palette: PlumPalette) {
    val (fill, content) = when (tone) {
        "accent" -> palette.accent.copy(alpha = .18f) to palette.accent
        "success" -> Color.hsl(142f, .66f, .45f).copy(alpha = .16f) to palette.success
        "warning" -> Color.hsl(38f, .92f, .55f).copy(alpha = .18f) to Color.hsl(36f, .90f, .55f)
        "danger" -> MaterialTheme.colorScheme.error.copy(alpha = .16f) to MaterialTheme.colorScheme.error
        else -> palette.text.copy(alpha = .08f) to palette.text
    }
    Text(
        text,
        Modifier.clip(CircleShape).background(fill).padding(horizontal = 9.dp, vertical = 2.dp),
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
        fontWeight = FontWeight.SemiBold,
        color = content,
        maxLines = 1,
    )
}

@Composable
private fun DuiKpi(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val label = node.string("label").orEmpty()
    val shown = formatUiValue(ctx.rt.safe(node.string("value").orEmpty()), node.string("format"))
    val trend = node.string("trend")?.let { uiNum(ctx.rt.safe(it)) } ?: Double.NaN
    val hint = node.string("hint")?.let { ctx.rt.template(it) }
    val trendLabel = when {
        !trend.isFinite() || trend == 0.0 -> null
        trend > 0 -> stringResource(R.string.dynamic_ui_trend_up)
        else -> stringResource(R.string.dynamic_ui_trend_down)
    }
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ctx.palette.duiField)
            .border(1.dp, ctx.palette.duiEdge, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = listOfNotNull("$label: $shown", trendLabel, hint).joinToString(", ")
                liveRegion = LiveRegionMode.Polite
            },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp), color = ctx.palette.muted)
        Text(shown, style = MaterialTheme.typography.titleLarge.copy(fontSize = 22.sp, letterSpacing = (-.4).sp).merge(tabular), fontWeight = FontWeight.SemiBold, color = ctx.palette.text)
        if (hint != null || trendLabel != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (trendLabel != null) Icon(
                if (trend > 0) Icons.Outlined.NorthEast else Icons.Outlined.SouthEast, null,
                tint = if (trend > 0) ctx.palette.success else MaterialTheme.colorScheme.error,
                modifier = Modifier.size(13.dp),
            )
            hint?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = ctx.palette.muted) }
        }
    }
}

@Composable
private fun FieldLabel(text: String, palette: PlumPalette, modifier: Modifier = Modifier) {
    Text(text, modifier, style = MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp), color = palette.muted)
}

/** Decimal places of a slider step, so 0.1 steps do not show 5.300000001. */
private fun stepDecimals(step: Double): Int = runCatching { java.math.BigDecimal(step.toString()).stripTrailingZeros().scale().coerceIn(0, 10) }.getOrDefault(0)

@Composable
private fun DuiSlider(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val lo = node.number("min") ?: 0.0
    val hi = node.number("max") ?: 1.0
    val step = node.number("step") ?: 1.0
    val raw = uiNum(ctx.rt.state[bind] ?: lo)
    val value = if (raw.isFinite()) raw.coerceIn(lo, hi) else lo
    val shown = formatUiValue(value, node.string("format"))
    val decimals = remember(step) { stepDecimals(step) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            FieldLabel(label, ctx.palette, Modifier.weight(1f))
            Text(shown, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp).merge(tabular), fontWeight = FontWeight.SemiBold, color = ctx.palette.text)
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { moved ->
                // A continuous track snapped to the step: many steps would draw a picket fence of ticks.
                val snapped = lo + Math.round((moved - lo) / step) * step
                val clean = java.math.BigDecimal(snapped).setScale(decimals, java.math.RoundingMode.HALF_UP).toDouble().coerceIn(lo, hi)
                if (clean != value) ctx.set(bind, clean)
            },
            enabled = !ctx.busy,
            valueRange = lo.toFloat()..hi.toFloat(),
            colors = SliderDefaults.colors(
                thumbColor = Color.White,
                activeTrackColor = ctx.palette.accent,
                inactiveTrackColor = ctx.palette.text.copy(alpha = .14f),
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent,
            ),
            modifier = Modifier.fillMaxWidth().height(32.dp).semantics {
                contentDescription = label
                stateDescription = shown
            },
        )
    }
}

@Composable
private fun FieldBox(palette: PlumPalette, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(palette.duiField)
            .border(1.dp, palette.duiEdge, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 9.dp),
        contentAlignment = Alignment.CenterStart,
    ) { content() }
}

private fun inputText(value: Any?): String = when (value) {
    null -> ""
    is Double -> if (value.isFinite()) jsNumberString(value) else ""
    else -> jsString(value)
}

@Composable
private fun DuiInput(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val numeric = node.string("kind") != "text"
    val current = ctx.rt.state[bind]
    var text by remember(bind) { mutableStateOf(inputText(current)) }
    // A set/reset action changes the value from outside: follow it unless the
    // typed text already means the same number ("1." while typing 1).
    LaunchedEffect(current) {
        val typed: Any? = if (numeric) text.replace(',', '.').trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull() else text
        if (typed != current) text = inputText(current)
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label, ctx.palette)
        FieldBox(ctx.palette) {
            if (text.isEmpty()) node.string("placeholder")?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = ctx.palette.muted) }
            BasicTextField(
                enabled = !ctx.busy,
                value = text,
                onValueChange = { typed ->
                    text = typed.take(200)
                    if (!numeric) ctx.set(bind, text)
                    else {
                        val clean = text.replace(',', '.').trim()
                        if (clean.isEmpty()) ctx.set(bind, null)
                        else clean.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { ctx.set(bind, it) }
                    }
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = ctx.palette.text).merge(tabular),
                cursorBrush = SolidColor(ctx.palette.accent),
                keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.Decimal else KeyboardType.Text),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
            )
        }
    }
}

private class UiOption(val value: Any?, val label: String)

private fun optionsOf(node: JsonObject): List<UiOption> = node.objects("options").map { UiOption(uiValueOf(it["value"]), it.string("label").orEmpty()) }

/** Options keep their declared type: numeric option values stay numbers in state. */
private fun sameOption(option: Any?, current: Any?): Boolean = jsString(option) == (if (current == null) "" else jsString(current))

@Composable
private fun DuiSelect(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val options = optionsOf(node)
    val current = ctx.rt.state[bind]
    val selected = options.firstOrNull { sameOption(it.value, current) }
    var open by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label, ctx.palette)
        Box {
            FieldBox(
                ctx.palette,
                Modifier.clickable(enabled = !ctx.busy, role = Role.DropdownList, onClickLabel = label) { open = true }.semantics(mergeDescendants = true) {
                    contentDescription = label
                    stateDescription = selected?.label ?: inputText(current)
                },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(selected?.label ?: inputText(current), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = ctx.palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.Outlined.ArrowDropDown, null, tint = ctx.palette.muted, modifier = Modifier.size(20.dp))
                }
            }
            DropdownMenu(open, { open = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        trailingIcon = { if (option === selected) Icon(Icons.Outlined.Check, null, tint = ctx.palette.accent) },
                        onClick = { open = false; ctx.set(bind, option.value) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DuiSegmented(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val current = ctx.rt.state[bind]
    val reduce = reducedMotion()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label, ctx.palette)
        Row(
            Modifier
                .horizontalScroll(rememberScrollState())
                .clip(RoundedCornerShape(12.dp))
                .background(ctx.palette.duiField)
                .border(1.dp, ctx.palette.duiEdge, RoundedCornerShape(12.dp))
                .padding(3.dp)
                .selectableGroup()
                .semantics { contentDescription = label },
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            optionsOf(node).forEach { option ->
                val active = sameOption(option.value, current)
                val fill by animateColorAsState(if (active) ctx.palette.accent.copy(alpha = .2f) else Color.Transparent, tween<Color>(160).orSnap(reduce), label = "dui_segment")
                val source = remember { MutableInteractionSource() }
                Box(
                    Modifier
                        .pressScale(source)
                        .clip(RoundedCornerShape(9.dp))
                        .background(fill)
                        .selectable(active, enabled = !ctx.busy, interactionSource = source, indication = null, role = Role.RadioButton) { ctx.set(bind, option.value) }
                        .heightIn(min = 34.dp)
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(option.label, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), fontWeight = if (active) FontWeight.SemiBold else null, color = if (active) ctx.palette.text else ctx.palette.muted, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun DuiCheckbox(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val checked = uiTruthy(ctx.rt.state[bind] ?: false)
    Row(
        modifier.toggleable(checked, enabled = !ctx.busy, role = Role.Checkbox) { ctx.set(bind, it) }.padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Checkbox(checked, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = ctx.palette.accent, uncheckedColor = ctx.palette.muted), modifier = Modifier.padding(8.dp))
        Text(node.string("label").orEmpty(), style = MaterialTheme.typography.bodyMedium, color = ctx.palette.text)
    }
}

@Composable
private fun DuiButton(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val action = node["action"] as? JsonObject ?: return
    val type = action.string("type")
    val enabled = !ctx.busy && (type != "sendMessage" || ctx.send != null)
    val primary = node.string("variant") != "secondary"
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(11.dp)
    Surface(
        onClick = {
            when (type) {
                "sendMessage" -> ctx.send?.invoke(ctx.rt.template(action.string("text").orEmpty()))
                "set" -> ctx.set(action.string("key").orEmpty(), ctx.rt.safe(action.string("value").orEmpty()))
                else -> ctx.reset()
            }
        },
        enabled = enabled,
        shape = shape,
        color = if (primary) ctx.palette.accent.copy(alpha = .24f) else ctx.palette.duiField,
        contentColor = ctx.palette.text,
        border = BorderStroke(1.dp, if (primary) ctx.palette.accent.copy(alpha = .5f) else ctx.palette.duiEdge),
        interactionSource = source,
        modifier = modifier.pressScale(source).alpha(if (enabled) 1f else .5f).heightIn(min = 40.dp),
    ) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
            Text(node.string("label").orEmpty(), style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        }
    }
}

// ── Table ───────────────────────────────────────────────────────────────────

@Composable
private fun DuiTable(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val rows = ctx.rt.source(dataOf(node))
    val columns = node.objects("columns")
    val highlight = node.string("highlight")
    val palette = ctx.palette
    val shape = RoundedCornerShape(14.dp)
    val tableLabel = stringResource(R.string.dynamic_ui_table)
    val cells = rows.map { row -> columns.map { formatUiValue(row[it.string("key").orEmpty()], it.string("format")) } }
    fun right(column: JsonObject, value: Any?): Boolean = column.string("align")?.let { it == "right" } ?: (value is Double)
    BoxWithConstraints(modifier.fillMaxWidth().plumGlass(GlassRole.Sunken, shape, borderColor = palette.duiEdge, highlight = false)) {
        // Column widths from the longest text, stretched to fill a wide container.
        val natural = columns.mapIndexed { index, column ->
            val longest = max(column.string("label").orEmpty().length * 1.1f, cells.maxOfOrNull { it[index].length.toFloat() } ?: 0f)
            (longest * 7.6f + 26f).coerceIn(64f, 240f)
        }
        val total = natural.sum()
        val scale = if (total < maxWidth.value) maxWidth.value / total else 1f
        val widths = natural.map { (it * scale).dp }
        Column(Modifier.horizontalScroll(rememberScrollState()).semantics { contentDescription = tableLabel }) {
            Row {
                columns.forEachIndexed { index, column ->
                    Text(
                        column.string("label").orEmpty().uppercase(),
                        Modifier.width(widths[index]).padding(horizontal = 12.dp, vertical = 9.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, letterSpacing = .3.sp),
                        fontWeight = FontWeight.SemiBold,
                        color = palette.muted,
                        textAlign = if (right(column, rows.firstOrNull()?.get(column.string("key").orEmpty()))) TextAlign.End else TextAlign.Start,
                        maxLines = 2,
                    )
                }
            }
            HorizontalDivider(Modifier.width(widths.fold(0.dp) { sum, w -> sum + w }), thickness = 1.dp, color = palette.duiEdge)
            if (rows.isEmpty()) Text(
                stringResource(R.string.dynamic_ui_table_empty),
                Modifier.width(widths.fold(0.dp) { sum, w -> sum + w }).padding(12.dp),
                style = MaterialTheme.typography.bodySmall, color = palette.muted, textAlign = TextAlign.Center,
            )
            rows.forEachIndexed { rowIndex, row ->
                val marked = highlight != null && uiTruthy(ctx.rt.with(row).safe(highlight))
                Row(Modifier.then(if (marked) Modifier.background(palette.accent.copy(alpha = .1f)) else Modifier).semantics(mergeDescendants = true) {}) {
                    columns.forEachIndexed { index, column ->
                        Text(
                            cells[rowIndex][index],
                            Modifier.width(widths[index]).padding(horizontal = 12.dp, vertical = 9.dp),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp).merge(tabular),
                            fontWeight = if (marked) FontWeight.SemiBold else null,
                            color = palette.text,
                            textAlign = if (right(column, row[column.string("key").orEmpty()])) TextAlign.End else TextAlign.Start,
                        )
                    }
                }
                if (rowIndex < rows.lastIndex) HorizontalDivider(Modifier.width(widths.fold(0.dp) { sum, w -> sum + w }), thickness = 1.dp, color = palette.text.copy(alpha = .06f))
            }
        }
    }
}

// ── Compare ─────────────────────────────────────────────────────────────────

@Composable
private fun DuiCompare(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind")
    val selected = bind?.let { ctx.rt.state[it] }?.let(::jsString)
    val items = node.objects("items")
    val specs = node.objects("specs")
    // Best value per spec, for the subtle "best" marker.
    val best = specs.mapNotNull { spec ->
        val key = spec.string("key") ?: return@mapNotNull null
        val values = items.mapNotNull { uiValueOf((it["values"] as? JsonObject)?.get(key)) as? Double }
        when {
            values.isEmpty() -> null
            spec.string("better") == "higher" -> key to values.max()
            spec.string("better") == "lower" -> key to values.min()
            else -> null
        }
    }.toMap()
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val fits = maxWidth >= (190.dp + 12.dp) * items.size - 12.dp
        Row(
            Modifier
                .then(if (fits) Modifier.fillMaxWidth() else Modifier.horizontalScroll(rememberScrollState()))
                .height(IntrinsicSize.Max)
                .then(if (bind != null) Modifier.selectableGroup() else Modifier),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items.forEach { item ->
                val id = item.string("id").orEmpty()
                CompareItem(item, id, specs, best, active = id == selected, ctx = ctx,
                    onSelect = bind?.let { key -> { ctx.set(key, id) } },
                    modifier = (if (fits) Modifier.weight(1f) else Modifier.width(220.dp)).fillMaxHeight())
            }
        }
    }
}

@Composable
private fun CompareItem(item: JsonObject, id: String, specs: List<JsonObject>, best: Map<String, Double>, active: Boolean, ctx: DuiCtx, onSelect: (() -> Unit)?, modifier: Modifier) {
    val palette = ctx.palette
    val reduce = reducedMotion()
    val shape = RoundedCornerShape(16.dp)
    val border by animateColorAsState(if (active) palette.accent.copy(alpha = .6f) else palette.duiEdge, tween<Color>(160).orSnap(reduce), label = "dui_compare_border")
    val source = remember { MutableInteractionSource() }
    val values = item["values"] as? JsonObject ?: JsonObject(emptyMap())
    val selectedLabel = stringResource(R.string.dynamic_ui_selected)
    val bestLabel = stringResource(R.string.dynamic_ui_best)
    Column(
        modifier
            .then(if (active) Modifier.border(3.dp, palette.accent.copy(alpha = .14f), shape) else Modifier)
            .then(if (onSelect != null) Modifier.pressScale(source) else Modifier)
            .plumGlass(GlassRole.Default, shape, borderColor = border)
            .then(if (onSelect != null) Modifier.selectable(active, enabled = !ctx.busy, interactionSource = source, indication = null, role = Role.RadioButton, onClick = onSelect) else Modifier)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(item.string("title").orEmpty(), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.text)
                item.string("subtitle")?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = palette.muted) }
            }
            item.string("badge")?.let { DuiBadge(it, "accent", palette) }
            if (active) Box(
                Modifier.size(22.dp).clip(CircleShape).background(palette.accent).semantics { contentDescription = selectedLabel },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.Check, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(14.dp)) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            specs.forEach { spec ->
                val key = spec.string("key").orEmpty()
                val value = uiValueOf(values[key])
                val isBest = value is Double && best[key] == value
                val shown = formatUiValue(value, spec.string("format"))
                Row(
                    Modifier.fillMaxWidth().semantics(mergeDescendants = true) {
                        contentDescription = "${spec.string("label").orEmpty()}: $shown" + if (isBest) ", $bestLabel" else ""
                    },
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(spec.string("label").orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted)
                    Text(shown, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp).merge(tabular), fontWeight = FontWeight.SemiBold, color = if (isBest) palette.accent else palette.text, textAlign = TextAlign.End)
                }
            }
        }
    }
}

// ── Chart colours ───────────────────────────────────────────────────────────

/** The WebUI chart palette: the theme accent first, then fixed hues. */
internal fun chartColors(palette: PlumPalette): List<Color> = listOf(
    palette.accent,
    Color.hsl(262f, .83f, .66f),
    Color.hsl(38f, .92f, .56f),
    Color.hsl(199f, .89f, .56f),
    Color.hsl(340f, .82f, .62f),
    Color.hsl(142f, .66f, .48f),
)
