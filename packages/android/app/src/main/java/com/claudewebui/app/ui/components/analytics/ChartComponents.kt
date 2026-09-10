package com.claudewebui.app.ui.components.analytics

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.screens.analytics.ActivityDay
import com.claudewebui.app.ui.screens.analytics.CostPoint
import com.claudewebui.app.ui.screens.analytics.DurationPoint

// ── Data holders ──────────────────────────────────────────────────────────────

data class BarItem(
    val label: String,
    val value: Float,
    val color: Color,
    val maxValue: Float = 0f  // filled by chart
)

data class SliceItem(
    val label: String,
    val value: Float,
    val color: Color
)

data class PointItem(
    val label: String,
    val value: Float
)

// ── HorizontalBarChart ────────────────────────────────────────────────────────

@Composable
fun HorizontalBarChart(
    items: List<BarItem>,
    modifier: Modifier = Modifier,
    barHeight: Dp = 20.dp,
    labelWidth: Dp = 80.dp,
    animDurationMs: Int = 700
) {
    val componentTokens = PlumTheme.tokens
    if (items.isEmpty()) return

    val maxVal = items.maxOf { it.value }.coerceAtLeast(0.001f)
    val normalised = items.map { it.copy(maxValue = maxVal) }

    val progress = remember { Animatable(0f) }
    LaunchedEffect(items) {
        progress.snapTo(0f)
        progress.animateTo(1f, animationSpec = tween(animDurationMs, easing = FastOutSlowInEasing))
    }

    val textMeasurer = rememberTextMeasurer()
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant
    val barHeightPx = barHeight.value
    val gapPx = 12f
    val totalHeight = (barHeightPx + gapPx) * normalised.size - gapPx

    Canvas(modifier = modifier.fillMaxWidth().height((totalHeight / 2.5f).dp)) {
        val labelWidthPx = labelWidth.toPx()
        val availableWidth = size.width - labelWidthPx - componentTokens.spacing.sm.toPx()
        val barH = barHeightPx.dp.toPx()
        val gap = gapPx.dp.toPx()

        normalised.forEachIndexed { idx, item ->
            val top = idx * (barH + gap)

            // Label
            val measured = textMeasurer.measure(
                item.label,
                style = TextStyle(fontSize = 11.sp, color = labelColor)
            )
            drawText(
                textLayoutResult = measured,
                topLeft = Offset(0f, top + (barH - measured.size.height) / 2f)
            )

            // Bar background
            drawRoundRect(
                color = item.color.copy(alpha = 0.15f),
                topLeft = Offset(labelWidthPx, top),
                size = Size(availableWidth, barH),
                cornerRadius = CornerRadius(barH / 2f)
            )

            // Bar fill (animated)
            val fillWidth = availableWidth * (item.value / maxVal) * progress.value
            if (fillWidth > barH) {
                drawRoundRect(
                    color = item.color,
                    topLeft = Offset(labelWidthPx, top),
                    size = Size(fillWidth, barH),
                    cornerRadius = CornerRadius(barH / 2f)
                )
            }

            // Value label at end of bar
            val valueText = if (item.value >= 1000) "${(item.value / 1000).toInt()}k" else item.value.toInt().toString()
            val vMeasured = textMeasurer.measure(
                valueText,
                style = TextStyle(fontSize = 10.sp, color = item.color, fontWeight = FontWeight.SemiBold)
            )
            val vx = labelWidthPx + fillWidth + componentTokens.spacing.xs.toPx()
            if (vx + vMeasured.size.width < size.width) {
                drawText(
                    textLayoutResult = vMeasured,
                    topLeft = Offset(vx, top + (barH - vMeasured.size.height) / 2f)
                )
            }
        }
    }
}

// ── DonutChart ────────────────────────────────────────────────────────────────

@Composable
fun DonutChart(
    items: List<SliceItem>,
    centerText: String = "",
    centerSubtext: String = "",
    modifier: Modifier = Modifier,
    strokeWidth: Dp = 28.dp,
    animDurationMs: Int = 900
) {
    val componentTokens = PlumTheme.tokens
    if (items.isEmpty()) return

    val total = items.sumOf { it.value.toDouble() }.toFloat().coerceAtLeast(0.001f)
    val progress = remember { Animatable(0f) }
    LaunchedEffect(items) {
        progress.snapTo(0f)
        progress.animateTo(1f, animationSpec = tween(animDurationMs, easing = FastOutSlowInEasing))
    }

    val textMeasurer = rememberTextMeasurer()
    val onSurface = MaterialTheme.colorScheme.onSurface
    val onSurfaceVariant = MaterialTheme.colorScheme.onSurfaceVariant

    Canvas(modifier = modifier) {
        val stroke = strokeWidth.toPx()
        val diameter = minOf(size.width, size.height) - stroke
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        val arcSize = Size(diameter, diameter)
        val gap = 2f  // degrees gap between slices

        var startAngle = -90f
        items.forEach { item ->
            val sweep = (item.value / total) * 360f * progress.value - gap
            if (sweep > 0f) {
                drawArc(
                    color = item.color,
                    startAngle = startAngle,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round)
                )
            }
            startAngle += (item.value / total) * 360f
        }

        // Center text
        if (centerText.isNotBlank()) {
            val main = textMeasurer.measure(
                centerText,
                style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold, color = onSurface)
            )
            drawText(
                main,
                topLeft = Offset(
                    (size.width - main.size.width) / 2f,
                    size.height / 2f - main.size.height.toFloat() - componentTokens.spacing.xxs.toPx()
                )
            )
        }
        if (centerSubtext.isNotBlank()) {
            val sub = textMeasurer.measure(
                centerSubtext,
                style = TextStyle(fontSize = 11.sp, color = onSurfaceVariant)
            )
            drawText(
                sub,
                topLeft = Offset(
                    (size.width - sub.size.width) / 2f,
                    size.height / 2f + componentTokens.spacing.xxs.toPx()
                )
            )
        }
    }
}

// ── LineChart ─────────────────────────────────────────────────────────────────

@Composable
fun LineChart(
    points: List<PointItem>,
    lineColor: Color = Color(0xFF2B75E2),
    modifier: Modifier = Modifier,
    showDots: Boolean = true,
    showGradient: Boolean = true,
    animDurationMs: Int = 800
) {
    val componentTokens = PlumTheme.tokens
    if (points.size < 2) return

    val progress = remember { Animatable(0f) }
    LaunchedEffect(points) {
        progress.snapTo(0f)
        progress.animateTo(1f, animationSpec = tween(animDurationMs, easing = FastOutSlowInEasing))
    }

    val textMeasurer = rememberTextMeasurer()
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)

    Canvas(modifier = modifier) {
        val labelHeight = componentTokens.spacing.section.toPx()
        val chartHeight = size.height - labelHeight
        val chartWidth = size.width

        val maxVal = points.maxOf { it.value }.coerceAtLeast(0.001f)
        val minVal = points.minOf { it.value }.coerceAtMost(maxVal * 0.9f)
        val valueRange = (maxVal - minVal).coerceAtLeast(0.001f)

        val stepX = chartWidth / (points.size - 1)

        fun xOf(idx: Int) = idx * stepX
        fun yOf(value: Float) = chartHeight - ((value - minVal) / valueRange) * chartHeight * 0.85f - chartHeight * 0.075f

        // Grid lines (3 horizontal)
        for (i in 0..2) {
            val y = chartHeight * (0.15f + i * 0.35f)
            drawLine(gridColor, Offset(0f, y), Offset(chartWidth, y), strokeWidth = 1f)
        }

        // Build full path
        val fullPath = Path().apply {
            points.forEachIndexed { idx, p ->
                val x = xOf(idx)
                val y = yOf(p.value)
                if (idx == 0) moveTo(x, y) else lineTo(x, y)
            }
        }

        // Animated clipping via progress
        val animatedPoints = buildList {
            val total = points.size - 1
            val progIdx = (progress.value * total).toInt().coerceIn(0, total - 1)
            val frac = (progress.value * total) - progIdx
            for (i in 0..progIdx) add(points[i])
            if (progIdx < total) {
                val interp = PointItem(
                    points[progIdx].label,
                    points[progIdx].value + (points[progIdx + 1].value - points[progIdx].value) * frac
                )
                add(interp)
            }
        }

        if (animatedPoints.size < 2) return@Canvas

        // Gradient fill
        if (showGradient) {
            val fillPath = Path().apply {
                animatedPoints.forEachIndexed { idx, p ->
                    val x = xOf(idx)
                    val y = yOf(p.value)
                    if (idx == 0) moveTo(x, y) else lineTo(x, y)
                }
                lineTo(xOf(animatedPoints.size - 1), chartHeight)
                lineTo(0f, chartHeight)
                close()
            }
            drawPath(
                fillPath,
                brush = Brush.verticalGradient(
                    colors = listOf(lineColor.copy(alpha = 0.3f), lineColor.copy(alpha = 0f)),
                    startY = 0f,
                    endY = chartHeight
                )
            )
        }

        // Line
        val linePath = Path().apply {
            animatedPoints.forEachIndexed { idx, p ->
                val x = xOf(idx)
                val y = yOf(p.value)
                if (idx == 0) moveTo(x, y) else lineTo(x, y)
            }
        }
        drawPath(
            linePath,
            color = lineColor,
            style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        )

        // Dots at data points
        if (showDots) {
            animatedPoints.forEachIndexed { idx, p ->
                val x = xOf(idx)
                val y = yOf(p.value)
                drawCircle(Color.White, radius = componentTokens.spacing.xs.toPx(), center = Offset(x, y))
                drawCircle(lineColor, radius = 2.5.dp.toPx(), center = Offset(x, y))
            }
        }

        // X-axis labels (show every other one if many points)
        val labelStep = if (points.size > 8) 2 else 1
        points.forEachIndexed { idx, p ->
            if (idx % labelStep == 0) {
                val measured = textMeasurer.measure(
                    p.label,
                    style = TextStyle(fontSize = 9.sp, color = labelColor)
                )
                drawText(
                    measured,
                    topLeft = Offset(
                        (xOf(idx) - measured.size.width / 2f).coerceIn(0f, chartWidth - measured.size.width),
                        chartHeight + componentTokens.spacing.xs.toPx()
                    )
                )
            }
        }
    }
}

// ── ActivityHeatmap ───────────────────────────────────────────────────────────

@Composable
fun ActivityHeatmap(
    days: List<ActivityDay>,
    modifier: Modifier = Modifier,
    cellSize: Dp = 36.dp,
    cellGap: Dp = 6.dp,
    baseColor: Color = Color(0xFF2B75E2),
    animDurationMs: Int = 600
) {
    val componentTokens = PlumTheme.tokens
    if (days.isEmpty()) return

    val progress = remember { Animatable(0f) }
    LaunchedEffect(days) {
        progress.snapTo(0f)
        progress.animateTo(1f, animationSpec = tween(animDurationMs, easing = FastOutSlowInEasing))
    }

    val textMeasurer = rememberTextMeasurer()
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant

    val maxMessages = days.maxOf { it.messageCount }.coerceAtLeast(1)
    val labelHeightPx = componentTokens.spacing.section

    Canvas(modifier = modifier.height(cellSize + labelHeightPx + cellGap)) {
        val cell = cellSize.toPx()
        val gap = cellGap.toPx()

        days.forEachIndexed { idx, day ->
            val x = idx * (cell + gap)
            val intensity = (day.messageCount.toFloat() / maxMessages) * progress.value

            // Cell background
            drawRoundRect(
                color = surfaceVariant,
                topLeft = Offset(x, labelHeightPx.toPx()),
                size = Size(cell, cell),
                cornerRadius = CornerRadius(componentTokens.spacing.inline.toPx())
            )

            // Heat fill
            if (intensity > 0.02f) {
                drawRoundRect(
                    color = baseColor.copy(alpha = 0.15f + intensity * 0.75f),
                    topLeft = Offset(x, labelHeightPx.toPx()),
                    size = Size(cell, cell),
                    cornerRadius = CornerRadius(componentTokens.spacing.inline.toPx())
                )
            }

            // Day label
            val label = textMeasurer.measure(
                day.dayLabel,
                style = TextStyle(fontSize = 10.sp, color = labelColor)
            )
            drawText(
                label,
                topLeft = Offset(x + (cell - label.size.width) / 2f, 0f)
            )

            // Count badge
            if (day.messageCount > 0) {
                val count = textMeasurer.measure(
                    day.messageCount.toString(),
                    style = TextStyle(
                        fontSize = if (day.messageCount >= 10) 9.sp else 10.sp,
                        color = if (intensity > 0.5f) Color.White else baseColor,
                        fontWeight = FontWeight.Bold
                    )
                )
                drawText(
                    count,
                    topLeft = Offset(
                        x + (cell - count.size.width) / 2f,
                        labelHeightPx.toPx() + (cell - count.size.height) / 2f
                    )
                )
            }
        }
    }
}

// ── MiniBarIndicator ──────────────────────────────────────────────────────────

@Composable
fun MiniBarIndicator(
    value: Float,
    maxValue: Float,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp
) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(value, maxValue) {
        progress.snapTo(0f)
        progress.animateTo(
            (value / maxValue.coerceAtLeast(0.001f)).coerceIn(0f, 1f),
            animationSpec = tween(500, easing = FastOutSlowInEasing)
        )
    }

    Canvas(modifier = modifier.fillMaxWidth().height(height)) {
        // Track
        drawRoundRect(
            color = color.copy(alpha = 0.15f),
            cornerRadius = CornerRadius(size.height / 2f)
        )
        // Fill
        if (progress.value > 0.01f) {
            drawRoundRect(
                color = color,
                size = Size(size.width * progress.value, size.height),
                cornerRadius = CornerRadius(size.height / 2f)
            )
        }
    }
}

// ── BarChart (vertical, for duration trend) ───────────────────────────────────

@Composable
fun VerticalBarChart(
    points: List<DurationPoint>,
    barColor: Color = Color(0xFFCC785C),
    modifier: Modifier = Modifier,
    animDurationMs: Int = 700
) {
    val componentTokens = PlumTheme.tokens
    if (points.isEmpty()) return

    val progress = remember { Animatable(0f) }
    LaunchedEffect(points) {
        progress.snapTo(0f)
        progress.animateTo(1f, animationSpec = tween(animDurationMs, easing = FastOutSlowInEasing))
    }

    val textMeasurer = rememberTextMeasurer()
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f)

    Canvas(modifier = modifier) {
        val labelH = componentTokens.spacing.headerHorizontal.toPx()
        val chartH = size.height - labelH
        val maxVal = points.maxOf { it.avgDurationMin }.coerceAtLeast(0.001)
        val barW = (size.width / points.size) * 0.6f
        val step = size.width / points.size

        // Grid
        for (i in 1..3) {
            val y = chartH * (1f - i / 4f)
            drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        }

        points.forEachIndexed { idx, pt ->
            val cx = idx * step + step / 2f
            val barHeight = (chartH * (pt.avgDurationMin / maxVal) * progress.value).toFloat()

            drawRoundRect(
                color = barColor.copy(alpha = 0.2f),
                topLeft = Offset(cx - barW / 2f, 0f),
                size = Size(barW, chartH),
                cornerRadius = CornerRadius(componentTokens.spacing.xs.toPx())
            )
            if (barHeight > componentTokens.spacing.xs.toPx()) {
                drawRoundRect(
                    color = barColor,
                    topLeft = Offset(cx - barW / 2f, chartH - barHeight),
                    size = Size(barW, barHeight),
                    cornerRadius = CornerRadius(componentTokens.spacing.xs.toPx())
                )
            }

            val label = textMeasurer.measure(
                pt.label,
                style = TextStyle(fontSize = 9.sp, color = labelColor)
            )
            drawText(
                label,
                topLeft = Offset(cx - label.size.width / 2f, chartH + componentTokens.spacing.xs.toPx())
            )
        }
    }
}
