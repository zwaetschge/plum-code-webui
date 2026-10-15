package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.theme.PlumPalette
import kotlinx.serialization.json.JsonObject
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

private class Series(val key: String, val label: String)

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

/**
 * Bar, line, area and pie charts drawn with Compose Canvas, matching the
 * WebUI's Recharts output: compact y-axis labels, a light horizontal grid,
 * gradient area fills, a donut for pies and a legend for several series.
 * Drawing is not animated, as on the web, so reduced motion needs nothing.
 */
@Composable
internal fun DuiChart(node: JsonObject, rows: List<UiRow>, colors: List<Color>, palette: PlumPalette, modifier: Modifier = Modifier) {
    val kind = node.string("kind") ?: "bar"
    val xKey = node.string("x").orEmpty()
    val series = node.objects("series").map { Series(it.string("key").orEmpty(), it.string("label").orEmpty()) }
    val format = node.string("format")
    val height = (node.number("height") ?: 240.0).coerceIn(120.0, 480.0).dp
    val stacked = node.bool("stacked") == true
    val measurer = rememberTextMeasurer()
    val axisStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, color = palette.muted)
    val description = stringResource(R.string.dynamic_ui_chart, series.joinToString(", ") { it.label })
    Column(modifier.fillMaxWidth().semantics { contentDescription = description }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (kind == "pie") {
            val first = series.firstOrNull()
            val values = rows.map { row -> uiNum(first?.key?.let { key -> row[key] }).takeIf { it.isFinite() && it > 0 } ?: 0.0 }
            Canvas(Modifier.fillMaxWidth().height(height)) { drawPie(values, colors) }
            Legend(rows.mapIndexed { index, row -> categoryLabel(row[xKey]) + "  " + formatUiValue(first?.key?.let { key -> row[key] }, format) to colors[index % colors.size] }, palette)
        } else {
            val grid = palette.text.copy(alpha = .12f)
            val axisFormat: (Double) -> String = { value ->
                if (format?.startsWith("currency") == true) formatUiValue(value, "compact")
                else formatUiValue(value, if (format == "percent") "percent" else null)
            }
            val labels = remember(rows, xKey) { rows.map { categoryLabel(it[xKey]) } }
            Canvas(Modifier.fillMaxWidth().height(height)) {
                drawCartesian(kind, rows, series, labels, stacked, colors, grid, axisFormat, measurer, axisStyle)
            }
            if (series.size > 1) Legend(series.mapIndexed { index, entry -> entry.label to colors[index % colors.size] }, palette)
        }
    }
}

@Composable
private fun Legend(entries: List<Pair<String, Color>>, palette: PlumPalette) {
    // Wraps into lines of three on narrow widths; long legends stay readable.
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        entries.chunked(3).forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                line.forEach { (label, color) ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
                        Text(label, style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp), color = palette.muted, maxLines = 1)
                    }
                }
            }
        }
    }
}

private fun DrawScope.drawPie(values: List<Double>, colors: List<Color>) {
    val total = values.sum()
    if (total <= 0) return
    val outer = min(size.width, size.height) / 2f * .85f
    val inner = outer * (55f / 85f)
    val thickness = outer - inner
    val radius = inner + thickness / 2f
    val center = Offset(size.width / 2f, size.height / 2f)
    val gap = if (values.count { it > 0 } > 1) 2f else 0f
    var start = -90f
    values.forEachIndexed { index, value ->
        val sweep = (value / total * 360.0).toFloat()
        if (sweep > gap) drawArc(
            color = colors[index % colors.size],
            startAngle = start + gap / 2f,
            sweepAngle = sweep - gap,
            useCenter = false,
            topLeft = Offset(center.x - radius, center.y - radius),
            size = Size(radius * 2, radius * 2),
            style = Stroke(width = thickness),
        )
        start += sweep
    }
}

private fun DrawScope.drawCartesian(
    kind: String,
    rows: List<UiRow>,
    series: List<Series>,
    labels: List<String>,
    stacked: Boolean,
    colors: List<Color>,
    grid: Color,
    axisFormat: (Double) -> String,
    measurer: TextMeasurer,
    axisStyle: androidx.compose.ui.text.TextStyle,
) {
    if (rows.isEmpty() || series.isEmpty()) return
    val stack = stacked && kind != "line"
    val values = series.map { entry -> rows.map { uiNum(it[entry.key]) } }
    // Stacked charts draw cumulative bands; the domain covers the sums.
    val tops = if (stack) {
        val running = DoubleArray(rows.size)
        values.map { column -> column.mapIndexed { index, value -> running[index] += if (value.isFinite()) value else 0.0; running[index] } }
    } else values
    val finite = (tops.flatten() + if (stack) values.flatten() else emptyList()).filter { it.isFinite() }
    var low = min(0.0, finite.minOrNull() ?: 0.0)
    var high = max(0.0, finite.maxOrNull() ?: 0.0)
    if (high == low) high = low + 1
    val step = niceStep(high - low, 4)
    low = floor(low / step) * step
    high = ceil(high / step) * step
    val ticks = generateSequence(low) { it + step }.takeWhile { it <= high + step / 1000 }.take(12).toList()
    val tickLabels: List<TextLayoutResult> = ticks.map { measurer.measure(axisFormat(it), axisStyle) }
    val gutter = (tickLabels.maxOfOrNull { it.size.width } ?: 0).toFloat().coerceIn(28.dp.toPx(), 72.dp.toPx()) + 8.dp.toPx()
    val xLabelHeight = measurer.measure("0", axisStyle).size.height.toFloat()
    val bottom = size.height - xLabelHeight - 8.dp.toPx()
    val top = xLabelHeight / 2f
    val left = gutter
    val right = size.width - 4.dp.toPx()
    val plotWidth = (right - left).coerceAtLeast(1f)
    fun y(value: Double): Float = (bottom - (value - low) / (high - low) * (bottom - top)).toFloat()

    // Grid and y-axis labels.
    ticks.forEachIndexed { index, tick ->
        val ty = y(tick)
        drawLine(grid, Offset(left, ty), Offset(right, ty), strokeWidth = 1.dp.toPx())
        val label = tickLabels[index]
        drawText(label, topLeft = Offset(left - 8.dp.toPx() - label.size.width, ty - label.size.height / 2f))
    }

    val count = rows.size
    val band = plotWidth / count
    val bars = kind == "bar"
    // Bars sit in category bands; lines and areas run from edge to edge.
    fun x(index: Int): Float = if (bars || count == 1) left + band * (index + .5f) else left + plotWidth * index / (count - 1)

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
            series.indices.forEach { s ->
                val color = colors[s % colors.size]
                rows.indices.forEach { index ->
                    val value = values[s][index]
                    if (!value.isFinite()) return@forEach
                    val start = left + band * index + band * .1f + if (stack) 0f else barWidth * s
                    val upper: Double
                    val lower: Double
                    if (stack) { upper = tops[s][index]; lower = upper - value } else { upper = value; lower = 0.0 }
                    val y1 = y(max(upper, lower)); val y2 = y(min(upper, lower))
                    if (y2 - y1 < .5f) return@forEach
                    val rounded = !stack || s == series.lastIndex
                    val path = Path().apply {
                        addRoundRect(
                            RoundRect(
                                Rect(start + 1f, y1, start + barWidth - 1f, y2),
                                topLeft = if (rounded) CornerRadius(radius) else CornerRadius.Zero,
                                topRight = if (rounded) CornerRadius(radius) else CornerRadius.Zero,
                                bottomRight = CornerRadius.Zero,
                                bottomLeft = CornerRadius.Zero,
                            ),
                        )
                    }
                    drawPath(path, color)
                }
            }
        }
        else -> {
            series.indices.forEach { s ->
                val color = colors[s % colors.size]
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
                    drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = .35f), color.copy(alpha = 0f)), startY = top, endY = bottom))
                }
                drawPath(line, color, style = Stroke(width = 2.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                if (points.size == 1) drawCircle(color, 3.dp.toPx(), points.first())
            }
        }
    }
}
