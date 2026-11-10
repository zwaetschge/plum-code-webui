package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.PlumPalette
import kotlinx.serialization.json.JsonObject
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

private class Series(val key: String, val label: String, val color: Color)

/** Rounded tick spacing (1, 2, 2.5, 5 × 10ⁿ) for about [count] intervals. */
private fun niceStep(range: Double, count: Int): Double {
    if (range <= 0 || !range.isFinite()) return 1.0
    val raw = range / count
    val magnitude = 10.0.pow(floor(log10(raw)))
    val normalized = raw / magnitude
    val nice = when {
        normalized <= 1 -> 1.0
        normalized <= 2 -> 2.0
        normalized <= 2.5 -> 2.5
        normalized <= 5 -> 5.0
        else -> 10.0
    }
    return nice * magnitude
}

/** X-axis label: the raw category, like the WebUI's chart axis. */
private fun categoryLabel(value: Any?): String = when (value) {
    null -> ""
    is Double -> jsNumberString(value)
    else -> jsString(value)
}

/** Where the last frame put the plot, for hit testing touches. */
private class ChartGeometry {
    var left = 0f
    var right = 0f
    var top = 0f
    var bottom = 0f
    var xs = FloatArray(0)
    var points: List<Triple<Int, Int, Offset>> = emptyList()
    var center = Offset.Zero
    var outer = 0f
    var inner = 0f
}

/**
 * Bar, line, area, pie and scatter charts drawn with Compose Canvas, matching
 * the WebUI's Recharts output: compact y-axis labels, a light grid, gradient
 * area fills, a donut for pies. v2: an optional range segment bound to state,
 * a touch tooltip, legend entries that hide series, a draw-in animation
 * (static when motion is reduced), full screen and CSV export.
 */
@Composable
internal fun DuiChart(node: JsonObject, ctx: DuiCtx, modifier: Modifier = Modifier, expanded: Boolean = false) {
    val palette = ctx.palette
    val context = LocalContext.current
    val rows = ctx.rt.source(dataOf(node))
    val colors = chartColors(palette)
    val kind = node.string("kind") ?: "bar"
    val xKey = node.string("x").orEmpty()
    val allSeries = node.objects("series").mapIndexed { index, it -> Series(it.string("key").orEmpty(), it.string("label").orEmpty(), colors[index % colors.size]) }
    var hidden by remember(node) { mutableStateOf(emptySet<String>()) }
    val series = allSeries.filter { it.key !in hidden }
    val format = node.string("format")
    val baseHeight = (node.number("height") ?: 240.0).coerceIn(120.0, 480.0)
    val height = (if (expanded) max(baseHeight, 380.0) else baseHeight).dp
    val stacked = node.bool("stacked") == true
    val measurer = rememberTextMeasurer()
    val axisStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, color = palette.muted)
    val tipStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp, color = palette.text)
    val tipTitle = tipStyle.copy(fontWeight = FontWeight.SemiBold)
    val description = stringResource(R.string.dynamic_ui_chart, allSeries.joinToString(", ") { it.label })
    val chartLabel = stringResource(R.string.dynamic_ui_chart_title)
    val reduce = reducedMotion()
    val progress = remember { Animatable(if (ctx.animate && !reduce) 0f else 1f) }
    LaunchedEffect(Unit) { if (progress.value < 1f) progress.animateTo(1f, tween(DUI_CHART_MS, easing = DuiEase)) }
    var active by remember(rows) { mutableStateOf<Int?>(null) }
    var fullscreen by remember { mutableStateOf(false) }
    val geometry = remember { ChartGeometry() }
    val ranges = node.objects("ranges")
    val rangeBind = node.string("rangeBind")
    val valueFormat: (Any?) -> String = { formatUiValue(it, format) }
    fun exportCsv() = uiCsv(listOf(xKey) + allSeries.map { it.label }, rows.map { row -> listOf(csvValue(row[xKey])) + allSeries.map { csvValue(row[it.key]) } })

    Column(modifier.fillMaxWidth().semantics { contentDescription = description }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (ranges.isNotEmpty() && rangeBind != null) {
                val current = ctx.rt.state[rangeBind]
                val selected = ranges.indexOfFirst { sameOption(uiValueOf(it["value"]), current) }
                DuiSegmentBar(ranges.map { it.string("label").orEmpty() }, selected, { index -> ctx.set(rangeBind, uiValueOf(ranges[index]["value"])) }, fill = false, small = true, enabled = !ctx.busy)
            }
            Spacer(Modifier.weight(1f))
            if (!expanded) DuiToolButton(Icons.Outlined.OpenInFull, stringResource(R.string.dynamic_ui_expand), { fullscreen = true })
            DuiToolButton(Icons.Outlined.Share, stringResource(R.string.dynamic_ui_share_csv), { shareUiText(context, exportCsv(), "$chartLabel.csv") })
        }
        val touch = Modifier
            .pointerInput(rows, kind) {
                detectTapGestures(
                    onPress = { offset ->
                        active = hit(kind, geometry, offset)
                        tryAwaitRelease()
                    },
                )
            }
            .pointerInput(rows, kind) {
                detectHorizontalDragGestures(
                    onDragStart = { offset -> active = hit(kind, geometry, offset) },
                    onDragEnd = {},
                    onDragCancel = {},
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        active = hit(kind, geometry, change.position)
                    },
                )
            }
        if (kind == "pie") {
            val first = series.firstOrNull() ?: allSeries.firstOrNull()
            val values = rows.map { row -> uiNum(first?.key?.let { key -> row[key] }).takeIf { it.isFinite() && it > 0 } ?: 0.0 }
            val total = values.sum()
            Box(Modifier.fillMaxWidth().height(height), contentAlignment = Alignment.Center) {
                Canvas(Modifier.fillMaxWidth().height(height).then(touch)) { drawPie(values, colors, active, progress.value, geometry) }
                val index = active
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (index != null && index in rows.indices) categoryLabel(rows[index][xKey]) else (first?.label ?: ""), style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 1)
                    Text(
                        if (index != null && index in rows.indices) valueFormat(rows[index][first?.key.orEmpty()]) else valueFormat(total),
                        style = MaterialTheme.typography.titleMedium.merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text,
                    )
                }
            }
            Legend(rows.mapIndexed { index, row -> LegendEntry(categoryLabel(row[xKey]) + "  " + valueFormat(first?.key?.let { key -> row[key] }), colors[index % colors.size], true, null) }, palette)
        } else {
            val grid = palette.text.copy(alpha = .10f)
            val axisFormat: (Double) -> String = { value ->
                if (format?.startsWith("currency") == true) formatUiValue(value, "compact")
                else formatUiValue(value, if (format == "percent") "percent" else null)
            }
            val labels = remember(rows, xKey) { rows.map { categoryLabel(it[xKey]) } }
            val tooltipBg = if (palette.isLight) Color.White else Color(0xFF1E2126)
            Canvas(Modifier.fillMaxWidth().height(height).then(touch)) {
                if (kind == "scatter") drawScatter(rows, xKey, series, grid, axisFormat, measurer, axisStyle, progress.value, active, geometry)
                else drawCartesian(kind, rows, series, labels, stacked, grid, axisFormat, measurer, axisStyle, progress.value, active, geometry)
                val index = active
                if (index != null && index in rows.indices) {
                    val title = if (kind == "scatter") "${xKey}: ${categoryLabel(rows[index][xKey])}" else labels.getOrElse(index) { "" }
                    val lines = series.map { it to "${it.label}: ${valueFormat(rows[index][it.key])}" }
                    val anchor = if (kind == "scatter") geometry.points.firstOrNull { it.second == index }?.third?.x ?: geometry.xs.getOrElse(0) { 0f } else geometry.xs.getOrElse(index) { 0f }
                    drawTooltip(anchor, title, lines, measurer, tipTitle, tipStyle, tooltipBg, palette.duiEdge, geometry)
                }
            }
            if (allSeries.size > 1) Legend(
                allSeries.map { entry ->
                    LegendEntry(entry.label, entry.color, entry.key !in hidden) {
                        hidden = if (entry.key in hidden) hidden - entry.key else if (hidden.size < allSeries.size - 1) hidden + entry.key else hidden
                    }
                },
                palette,
            )
        }
    }
    if (fullscreen) DuiFullscreen(chartLabel, onDismiss = { fullscreen = false }) { DuiChart(node, ctx, Modifier, expanded = true) }
}

private fun hit(kind: String, geometry: ChartGeometry, offset: Offset): Int? = when (kind) {
    "pie" -> {
        val dx = offset.x - geometry.center.x
        val dy = offset.y - geometry.center.y
        val distance = hypot(dx, dy)
        if (distance < geometry.inner * .6f || distance > geometry.outer * 1.15f) null
        else {
            var angle = Math.toDegrees(atan2(dy, dx).toDouble()).toFloat() + 90f
            if (angle < 0) angle += 360f
            geometry.xs.indexOfFirst { it > angle }.takeIf { it >= 0 }
        }
    }
    "scatter" -> geometry.points.minByOrNull { hypot(it.third.x - offset.x, it.third.y - offset.y) }?.takeIf { hypot(it.third.x - offset.x, it.third.y - offset.y) < 48f }?.second
    else -> if (geometry.xs.isEmpty() || offset.x < geometry.left - 24f || offset.x > geometry.right + 24f) null
    else geometry.xs.indices.minByOrNull { kotlin.math.abs(geometry.xs[it] - offset.x) }
}

private class LegendEntry(val label: String, val color: Color, val on: Boolean, val onToggle: (() -> Unit)?)

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun Legend(entries: List<LegendEntry>, palette: PlumPalette) {
    // Entries wrap onto further lines, so long labels stay whole.
    androidx.compose.foundation.layout.FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
                entries.forEach { entry ->
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .then(if (entry.onToggle != null) Modifier.clickable(role = Role.Checkbox) { entry.onToggle.invoke() } else Modifier)
                            .padding(horizontal = 6.dp, vertical = 4.dp)
                            .alpha(if (entry.on) 1f else .4f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(entry.color))
                        Text(entry.label, style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp), color = palette.muted, maxLines = 1)
                    }
                }
    }
}

private fun DrawScope.drawPie(values: List<Double>, colors: List<Color>, active: Int?, progress: Float, geometry: ChartGeometry) {
    val total = values.sum()
    if (total <= 0) return
    val outer = min(size.width, size.height) / 2f * .85f
    val inner = outer * (62f / 85f)
    val thickness = outer - inner
    val radius = inner + thickness / 2f
    val center = Offset(size.width / 2f, size.height / 2f)
    geometry.center = center
    geometry.outer = outer
    geometry.inner = inner
    val gap = if (values.count { it > 0 } > 1) 2f else 0f
    var start = -90f
    val ends = FloatArray(values.size)
    values.forEachIndexed { index, value ->
        val sweep = (value / total * 360.0).toFloat()
        ends[index] = start + 90f + sweep
        val shown = sweep * progress
        val grow = if (active == index) 5.dp.toPx() else 0f
        if (shown > gap) drawArc(
            color = colors[index % colors.size].copy(alpha = if (active == null || active == index) 1f else .45f),
            startAngle = start + gap / 2f,
            sweepAngle = shown - gap,
            useCenter = false,
            topLeft = Offset(center.x - radius - grow / 2, center.y - radius - grow / 2),
            size = Size(radius * 2 + grow, radius * 2 + grow),
            style = Stroke(width = thickness + grow),
        )
        start += sweep
    }
    geometry.xs = ends
}

private fun DrawScope.drawTooltip(
    anchor: Float,
    title: String,
    lines: List<Pair<Series, String>>,
    measurer: TextMeasurer,
    titleStyle: TextStyle,
    style: TextStyle,
    background: Color,
    border: Color,
    geometry: ChartGeometry,
) {
    val guide = Path().apply { moveTo(anchor, geometry.top); lineTo(anchor, geometry.bottom) }
    drawPath(guide, border.copy(alpha = .9f), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))))
    val head = measurer.measure(title, titleStyle)
    val measured = lines.map { it.first to measurer.measure(it.second, style) }
    val pad = 8.dp.toPx()
    val dot = 8.dp.toPx()
    val width = max(head.size.width.toFloat(), measured.maxOfOrNull { it.second.size.width + dot + 6.dp.toPx() } ?: 0f) + pad * 2
    val heightPx = head.size.height + measured.sumOf { it.second.size.height } + pad * 2 + 2.dp.toPx() * measured.size
    val x = (anchor + 10.dp.toPx()).let { if (it + width > size.width) anchor - 10.dp.toPx() - width else it }.coerceIn(0f, max(0f, size.width - width))
    val y = geometry.top
    drawRoundRect(Color.Black.copy(alpha = .12f), Offset(x, y + 2.dp.toPx()), Size(width, heightPx), CornerRadius(10.dp.toPx()))
    drawRoundRect(background, Offset(x, y), Size(width, heightPx), CornerRadius(10.dp.toPx()))
    drawRoundRect(border, Offset(x, y), Size(width, heightPx), CornerRadius(10.dp.toPx()), style = Stroke(1.dp.toPx()))
    drawText(head, topLeft = Offset(x + pad, y + pad))
    var lineY = y + pad + head.size.height + 2.dp.toPx()
    measured.forEach { (series, layout) ->
        drawCircle(series.color, dot / 2, Offset(x + pad + dot / 2, lineY + layout.size.height / 2f))
        drawText(layout, topLeft = Offset(x + pad + dot + 6.dp.toPx(), lineY))
        lineY += layout.size.height + 2.dp.toPx()
    }
}

/** Shared y-axis: ticks, grid lines and labels; returns the plot's left edge. */
private fun DrawScope.drawYAxis(low: Double, high: Double, step: Double, grid: Color, axisFormat: (Double) -> String, measurer: TextMeasurer, axisStyle: TextStyle, top: Float, bottom: Float, right: Float): Float {
    val ticks = generateSequence(low) { it + step }.takeWhile { it <= high + step / 1000 }.take(12).toList()
    val tickLabels: List<TextLayoutResult> = ticks.map { measurer.measure(axisFormat(it), axisStyle) }
    val gutter = (tickLabels.maxOfOrNull { it.size.width } ?: 0).toFloat().coerceIn(28.dp.toPx(), 72.dp.toPx()) + 8.dp.toPx()
    val left = gutter
    ticks.forEachIndexed { index, tick ->
        val ty = (bottom - (tick - low) / (high - low) * (bottom - top)).toFloat()
        drawLine(grid, Offset(left, ty), Offset(right, ty), strokeWidth = 1.dp.toPx())
        val label = tickLabels[index]
        drawText(label, topLeft = Offset(left - 8.dp.toPx() - label.size.width, ty - label.size.height / 2f))
    }
    return left
}

private fun domain(values: List<Double>, includeZero: Boolean): Triple<Double, Double, Double> {
    val finite = values.filter { it.isFinite() }
    var low = finite.minOrNull() ?: 0.0
    var high = finite.maxOrNull() ?: 0.0
    if (includeZero) { low = min(0.0, low); high = max(0.0, high) }
    if (high == low) high = low + 1
    val step = niceStep(high - low, 4)
    return Triple(floor(low / step) * step, ceil(high / step) * step, step)
}

private fun DrawScope.drawScatter(
    rows: List<UiRow>,
    xKey: String,
    series: List<Series>,
    grid: Color,
    axisFormat: (Double) -> String,
    measurer: TextMeasurer,
    axisStyle: TextStyle,
    progress: Float,
    active: Int?,
    geometry: ChartGeometry,
) {
    if (rows.isEmpty() || series.isEmpty()) return
    val (yLow, yHigh, yStep) = domain(series.flatMap { entry -> rows.map { uiNum(it[entry.key]) } }, includeZero = false)
    val (xLow, xHigh, xStep) = domain(rows.map { uiNum(it[xKey]) }, includeZero = false)
    val xLabelHeight = measurer.measure("0", axisStyle).size.height.toFloat()
    val bottom = size.height - xLabelHeight - 8.dp.toPx()
    val top = xLabelHeight / 2f
    val right = size.width - 6.dp.toPx()
    val left = drawYAxis(yLow, yHigh, yStep, grid, axisFormat, measurer, axisStyle, top, bottom, right)
    fun px(value: Double) = (left + (value - xLow) / (xHigh - xLow) * (right - left)).toFloat()
    fun py(value: Double) = (bottom - (value - yLow) / (yHigh - yLow) * (bottom - top)).toFloat()
    generateSequence(xLow) { it + xStep }.takeWhile { it <= xHigh + xStep / 1000 }.take(12).forEach { tick ->
        val label = measurer.measure(formatUiValue(tick, null), axisStyle)
        drawText(label, topLeft = Offset((px(tick) - label.size.width / 2f).coerceIn(0f, size.width - label.size.width), bottom + 6.dp.toPx()))
    }
    val points = ArrayList<Triple<Int, Int, Offset>>()
    series.forEachIndexed { s, entry ->
        rows.forEachIndexed { index, row ->
            val x = uiNum(row[xKey])
            val y = uiNum(row[entry.key])
            if (!x.isFinite() || !y.isFinite()) return@forEachIndexed
            val point = Offset(px(x), py(y))
            points += Triple(s, index, point)
            val highlighted = active == index
            drawCircle(entry.color.copy(alpha = if (active == null || highlighted) .88f else .35f), (if (highlighted) 6.dp else 4.5.dp).toPx() * progress, point)
            if (highlighted) drawCircle(entry.color, 9.dp.toPx(), point, style = Stroke(1.5.dp.toPx()))
        }
    }
    geometry.left = left; geometry.right = right; geometry.top = top; geometry.bottom = bottom
    geometry.points = points
    geometry.xs = points.map { it.third.x }.toFloatArray()
}

private fun DrawScope.drawCartesian(
    kind: String,
    rows: List<UiRow>,
    series: List<Series>,
    labels: List<String>,
    stacked: Boolean,
    grid: Color,
    axisFormat: (Double) -> String,
    measurer: TextMeasurer,
    axisStyle: TextStyle,
    progress: Float,
    active: Int?,
    geometry: ChartGeometry,
) {
    if (rows.isEmpty() || series.isEmpty()) return
    val stack = stacked && kind != "line"
    val values = series.map { entry -> rows.map { uiNum(it[entry.key]) } }
    // Stacked charts draw cumulative bands; the domain covers the sums.
    val tops = if (stack) {
        val running = DoubleArray(rows.size)
        values.map { column -> column.mapIndexed { index, value -> running[index] += if (value.isFinite()) value else 0.0; running[index] } }
    } else values
    val (low, high, step) = domain(tops.flatten() + if (stack) values.flatten() else emptyList(), includeZero = true)
    val xLabelHeight = measurer.measure("0", axisStyle).size.height.toFloat()
    val bottom = size.height - xLabelHeight - 8.dp.toPx()
    val top = xLabelHeight / 2f
    val right = size.width - 4.dp.toPx()
    val left = drawYAxis(low, high, step, grid, axisFormat, measurer, axisStyle, top, bottom, right)
    val plotWidth = (right - left).coerceAtLeast(1f)
    fun y(value: Double): Float = (bottom - (value - low) / (high - low) * (bottom - top)).toFloat()

    val count = rows.size
    val band = plotWidth / count
    val bars = kind == "bar"
    // Bars sit in category bands; lines and areas run from edge to edge.
    fun x(index: Int): Float = if (bars || count == 1) left + band * (index + .5f) else left + plotWidth * index / (count - 1)
    geometry.left = left; geometry.right = right; geometry.top = top; geometry.bottom = bottom
    geometry.xs = FloatArray(count) { x(it) }

    // X-axis labels, thinned so they never overlap.
    val measured = labels.map { measurer.measure(it, axisStyle) }
    val widest = measured.maxOfOrNull { it.size.width } ?: 0
    val slot = if (bars || count == 1) band else plotWidth / max(1, count - 1)
    val every = max(1, ceil((widest + 6.dp.toPx()) / slot.coerceAtLeast(1f)).toInt())
    measured.forEachIndexed { index, label ->
        if (index % every != 0) return@forEachIndexed
        val cx = x(index)
        val lx = (cx - label.size.width / 2f).coerceIn(0f, max(0f, size.width - label.size.width))
        drawText(label, topLeft = Offset(lx, bottom + 6.dp.toPx()))
    }

    val zero = y(max(low, min(0.0, high)))
    when (kind) {
        "bar" -> {
            val groupWidth = band * .8f
            val barWidth = if (stack) groupWidth else groupWidth / series.size
            val radius = min(6.dp.toPx(), barWidth / 2f)
            if (active != null && active in rows.indices) drawRect(grid.copy(alpha = grid.alpha * .7f), Offset(left + band * active, top), Size(band, bottom - top))
            series.indices.forEach { s ->
                val color = series[s].color
                rows.indices.forEach { index ->
                    val value = values[s][index]
                    if (!value.isFinite()) return@forEach
                    val start = left + band * index + band * .1f + if (stack) 0f else barWidth * s
                    val upper: Double
                    val lower: Double
                    if (stack) { upper = tops[s][index]; lower = upper - value } else { upper = value; lower = 0.0 }
                    // The draw-in grows every bar from the baseline.
                    val y1 = zero + (y(max(upper, lower)) - zero) * progress
                    val y2 = zero + (y(min(upper, lower)) - zero) * progress
                    if (kotlin.math.abs(y2 - y1) < .5f) return@forEach
                    val rounded = !stack || s == series.lastIndex
                    val path = Path().apply {
                        addRoundRect(
                            RoundRect(
                                Rect(start + 1f, min(y1, y2), start + barWidth - 1f, max(y1, y2)),
                                topLeft = if (rounded) CornerRadius(radius) else CornerRadius.Zero,
                                topRight = if (rounded) CornerRadius(radius) else CornerRadius.Zero,
                                bottomRight = CornerRadius.Zero,
                                bottomLeft = CornerRadius.Zero,
                            ),
                        )
                    }
                    drawPath(path, color.copy(alpha = if (active == null || active == index) 1f else .55f))
                }
            }
        }
        else -> clipRect(right = left + plotWidth * progress + 6.dp.toPx()) {
            series.indices.forEach { s ->
                val color = series[s].color
                val points = rows.indices.mapNotNull { index ->
                    val value = if (stack) tops[s][index] else values[s][index]
                    if (value.isFinite()) Offset(x(index), y(value)) else null
                }
                if (points.isEmpty()) return@forEach
                val line = Path().apply { points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
                if (kind == "area") {
                    // The fill runs down to the previous band when stacked, else to zero.
                    val baseline = if (stack && s > 0) rows.indices.map { index -> Offset(x(index), y(tops[s - 1][index])) }.reversed() else listOf(Offset(points.last().x, zero), Offset(points.first().x, zero))
                    val fill = Path().apply {
                        points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) }
                        baseline.forEach { lineTo(it.x, it.y) }
                        close()
                    }
                    drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = .32f), color.copy(alpha = 0f)), startY = top, endY = bottom))
                }
                drawPath(line, color, style = Stroke(width = 2.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                if (points.size == 1) drawCircle(color, 3.dp.toPx(), points.first())
                if (active != null && active in rows.indices) {
                    val value = if (stack) tops[s][active] else values[s][active]
                    if (value.isFinite()) {
                        drawCircle(Color.White, 5.dp.toPx(), Offset(x(active), y(value)))
                        drawCircle(color, 3.6.dp.toPx(), Offset(x(active), y(value)))
                    }
                }
            }
        }
    }
}
