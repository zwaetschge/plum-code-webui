package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.PlumPalette
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.max
import kotlin.math.min

/**
 * Live widgets: the server resolves weather, currency, stock, entity, news and
 * gallery data (`turn.uiResults[id]`). Until a result arrives the widget
 * shows a placeholder at its final size; a failed fetch is a quiet card with
 * „Erneut versuchen“. A result applies only while its key matches the node.
 */
@Composable
internal fun DuiLive(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val type = node.string("type") ?: return
    val id = node.string("id") ?: return
    val key = remember(node) { uiLiveKey(node) }
    val raw = ctx.results[id]
    val result = remember(raw, key) { raw?.let { UiLiveResult(it) }?.takeIf { (it.type == null || it.type == type) && uiLiveKeysMatch(it.key, key) } }
    val data = remember(result) { if (result?.status == "resolved") decodeLiveData(type, result.data) else null }
    val phase = when {
        data != null -> 2
        result?.status == "failed" || result?.status == "resolved" -> 1
        else -> 0
    }
    val reduce = reducedMotion()
    AnimatedContent(
        targetState = phase,
        transitionSpec = {
            if (reduce) EnterTransition.None togetherWith ExitTransition.None
            else fadeIn(tween(DUI_FADE_MS, easing = DuiEase)) togetherWith fadeOut(tween(200))
        },
        modifier = modifier.fillMaxWidth(),
        label = "dui_live_$type",
    ) { shown ->
        when (shown) {
            2 -> when (data) {
                is UiWeatherData -> WeatherWidget(node, data, ctx)
                is UiCurrencyData -> CurrencyWidget(data, ctx)
                is UiStockData -> StockWidget(data, ctx)
                is UiEntityData -> DuiPanel { EntityContent(data, ctx.palette) }
                is UiNewsData -> NewsWidget(data, ctx)
                is UiGalleryData -> GalleryWidget(data, ctx)
                else -> LiveSkeleton(type)
            }
            1 -> LiveFailed(node, type, result?.error, result?.retryable == true, raw, ctx)
            else -> LiveSkeleton(type)
        }
    }
}

private fun decodeLiveData(type: String, data: JsonElement?): Any? = when (type) {
    "weather" -> decodeLive<UiWeatherData>(data)?.takeIf { it.hourly.isNotEmpty() || it.daily.isNotEmpty() }
    "currency" -> decodeLive<UiCurrencyData>(data)?.takeIf { it.rate > 0 }
    "stock" -> decodeLive<UiStockData>(data)?.takeIf { it.priceText.isNotBlank() }
    "entity" -> decodeLive<UiEntityData>(data)?.takeIf { it.displayTitle.isNotBlank() || it.title.isNotBlank() }
    "news" -> decodeLive<UiNewsData>(data)?.takeIf { it.articles.isNotEmpty() }
    "gallery" -> decodeLive<UiGalleryData>(data)?.takeIf { it.images.isNotEmpty() }
    else -> null
}

@Composable
private fun liveTitle(node: JsonObject, type: String): String = when (type) {
    "weather" -> stringResource(R.string.dynamic_ui_live_weather, node.string("location").orEmpty())
    "currency" -> "${node.string("from")} → ${node.string("to")}"
    "stock" -> stringResource(R.string.dynamic_ui_live_stock, node.string("symbol").orEmpty().uppercase())
    "entity" -> node.string("title").orEmpty()
    "news" -> stringResource(R.string.dynamic_ui_live_news, node.string("query").orEmpty())
    else -> stringResource(R.string.dynamic_ui_live_gallery, node.string("query").orEmpty())
}

/** Quiet local fallback with „Erneut versuchen“ when the server allows it. */
@Composable
private fun LiveFailed(node: JsonObject, type: String, error: String?, retryable: Boolean, raw: JsonObject?, ctx: DuiCtx) {
    val palette = ctx.palette
    var retrying by remember(raw) { mutableStateOf(false) }
    LaunchedEffect(retrying) { if (retrying) { delay(15_000); retrying = false } }
    val refresh = ctx.host.onRefresh
    val icon = when (type) {
        "weather" -> Icons.Outlined.CloudOff
        "currency" -> Icons.Outlined.Payments
        "stock" -> Icons.AutoMirrored.Outlined.ShowChart
        "entity" -> Icons.Outlined.Person
        "news" -> Icons.AutoMirrored.Outlined.Article
        else -> Icons.Outlined.Image
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(palette.duiField)
            .border(1.dp, palette.duiEdge, RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(palette.text.copy(alpha = .07f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = palette.muted, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(liveTitle(node, type), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(error ?: stringResource(R.string.dynamic_ui_live_failed), style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (retryable && refresh != null) {
            Row(
                Modifier
                    .clip(CircleShape)
                    .border(1.dp, palette.duiEdge, CircleShape)
                    .clickable(enabled = !retrying, role = Role.Button) {
                        retrying = true
                        node.string("id")?.let(refresh)
                    }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (retrying) CircularProgressIndicator(Modifier.size(14.dp), color = palette.accent, strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Refresh, null, tint = palette.text, modifier = Modifier.size(15.dp))
                Text(stringResource(R.string.dynamic_ui_retry), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = palette.text)
            }
        }
    }
}

/** Placeholders shaped like the final widget, so nothing jumps when data arrives. */
@Composable
private fun LiveSkeleton(type: String) {
    val label = stringResource(R.string.dynamic_ui_live_loading)
    val wrap = Modifier.semantics { contentDescription = label; liveRegion = LiveRegionMode.Polite }
    when (type) {
        "weather" -> DuiPanel(wrap) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { DuiSkeletonLine(.55f, 14.dp); DuiSkeletonLine(.35f, 11.dp) }
                DuiSkeleton(Modifier.width(78.dp).height(30.dp), RoundedCornerShape(10.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                DuiSkeleton(Modifier.size(64.dp), CircleShape)
                DuiSkeleton(Modifier.width(96.dp).height(52.dp), RoundedCornerShape(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { DuiSkeletonLine(.9f, 10.dp); DuiSkeletonLine(.7f, 10.dp); DuiSkeletonLine(.5f, 10.dp) }
            }
            DuiSkeleton(Modifier.width(200.dp).height(30.dp), RoundedCornerShape(10.dp))
            DuiSkeleton(Modifier.fillMaxWidth().height(150.dp), RoundedCornerShape(14.dp))
            repeat(5) { DuiSkeleton(Modifier.fillMaxWidth().height(28.dp), RoundedCornerShape(8.dp)) }
        }
        "currency" -> DuiPanel(wrap) {
            DuiSkeletonLine(.6f, 14.dp)
            DuiSkeleton(Modifier.fillMaxWidth().height(58.dp), RoundedCornerShape(14.dp))
            DuiSkeleton(Modifier.fillMaxWidth().height(58.dp), RoundedCornerShape(14.dp))
            DuiSkeletonLine(.5f, 11.dp)
            DuiSkeleton(Modifier.fillMaxWidth().height(72.dp), RoundedCornerShape(12.dp))
        }
        "stock" -> DuiPanel(wrap) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { DuiSkeletonLine(.5f, 14.dp); DuiSkeletonLine(.3f, 11.dp) }
            DuiSkeleton(Modifier.width(150.dp).height(36.dp), RoundedCornerShape(10.dp))
            DuiSkeletonLine(.4f, 11.dp)
            DuiSkeleton(Modifier.width(210.dp).height(30.dp), RoundedCornerShape(10.dp))
            DuiSkeleton(Modifier.fillMaxWidth().height(170.dp), RoundedCornerShape(14.dp))
            repeat(3) { DuiSkeleton(Modifier.fillMaxWidth().height(22.dp), RoundedCornerShape(8.dp)) }
        }
        "entity" -> DuiPanel(wrap) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { DuiSkeletonLine(.7f, 16.dp); DuiSkeletonLine(.5f, 11.dp) }
                DuiSkeleton(Modifier.size(76.dp), RoundedCornerShape(14.dp))
            }
            repeat(3) { DuiSkeletonLine(if (it == 2) .6f else 1f, 11.dp) }
        }
        "news" -> Column(wrap.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            DuiSkeletonLine(.4f, 13.dp)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                repeat(2) {
                    Column(Modifier.width(250.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        DuiSkeleton(Modifier.fillMaxWidth().aspectRatio(16f / 9f), RoundedCornerShape(16.dp))
                        DuiSkeletonLine(.5f, 10.dp); DuiSkeletonLine(.95f, 12.dp); DuiSkeletonLine(.7f, 12.dp)
                    }
                }
            }
        }
        else -> Column(wrap.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DuiSkeletonLine(.35f, 13.dp)
            repeat(2) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(3) { DuiSkeleton(Modifier.weight(1f).aspectRatio(1f), RoundedCornerShape(12.dp)) }
                }
            }
        }
    }
}

@Composable
private fun WidgetHeader(title: String, subtitle: String?, palette: PlumPalette, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp), fontWeight = FontWeight.SemiBold, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        trailing()
    }
}

// ── Weather glyphs ──────────────────────────────────────────────────────────

/** A colour weather symbol for UI_WEATHER_ICONS, drawn at any size. */
@Composable
internal fun WeatherGlyph(icon: String, modifier: Modifier, description: String? = null) {
    val dark = !PlumTheme.palette.isLight
    Canvas(modifier.semantics { if (description != null) contentDescription = description }) { drawWeatherGlyph(icon, Offset.Zero, min(size.width, size.height), dark) }
}

internal fun DrawScope.drawWeatherGlyph(icon: String, origin: Offset, side: Float, dark: Boolean) {
    fun p(x: Float, y: Float) = Offset(origin.x + x * side, origin.y + y * side)
    val sun = Color(0xFFFFC23D)
    val moon = if (dark) Color(0xFFF3E3A6) else Color(0xFFE0B23C)
    val cloud = if (dark) Color(0xFFDDE4EE) else Color(0xFFB8C3D1)
    val storm = if (dark) Color(0xFF9AA6B6) else Color(0xFF8592A3)
    val rain = Color(0xFF4DA3FF)
    val snow = if (dark) Color(0xFFCFEAFF) else Color(0xFF7DB9E6)
    fun drawSun(cx: Float, cy: Float, r: Float) {
        val center = p(cx, cy)
        for (k in 0 until 8) {
            val angle = Math.toRadians(k * 45.0)
            val inner = r * side * 1.38f
            val outer = r * side * 1.78f
            drawLine(sun, Offset(center.x + (Math.cos(angle) * inner).toFloat(), center.y + (Math.sin(angle) * inner).toFloat()), Offset(center.x + (Math.cos(angle) * outer).toFloat(), center.y + (Math.sin(angle) * outer).toFloat()), strokeWidth = side * .055f, cap = StrokeCap.Round)
        }
        drawCircle(sun, r * side, center)
    }
    fun drawMoon(cx: Float, cy: Float, r: Float) {
        val center = p(cx, cy)
        val disc = Path().apply { addOval(androidx.compose.ui.geometry.Rect(center, r * side)) }
        val bite = Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset(center.x + r * side * .55f, center.y - r * side * .35f), r * side * .9f)) }
        val crescent = Path().apply { op(disc, bite, PathOperation.Difference) }
        drawPath(crescent, moon)
    }
    fun drawCloud(cx: Float, cy: Float, w: Float, color: Color) {
        val width = w * side
        val h = width * .55f
        val center = p(cx, cy)
        drawRoundRect(color, Offset(center.x - width / 2, center.y), Size(width, h * .44f), CornerRadius(h * .22f))
        drawCircle(color, h * .34f, Offset(center.x - width * .24f, center.y + h * .06f))
        drawCircle(color, h * .47f, Offset(center.x + width * .02f, center.y - h * .14f))
        drawCircle(color, h * .31f, Offset(center.x + width * .27f, center.y + h * .08f))
    }
    fun drawDrops(count: Int, top: Float, length: Float, color: Color = rain) {
        val spread = .56f
        for (k in 0 until count) {
            val x = .5f - spread / 2 + spread * (k + .5f) / count
            drawLine(color, p(x + .03f, top), p(x - .04f, top + length), strokeWidth = side * .055f, cap = StrokeCap.Round)
        }
    }
    fun drawFlakes(count: Int, top: Float) {
        val spread = .56f
        for (k in 0 until count) {
            val x = .5f - spread / 2 + spread * (k + .5f) / count
            val y = top + if (k % 2 == 0) 0f else .1f
            drawCircle(snow, side * .045f, p(x, y))
        }
    }
    when (icon) {
        "clear-day" -> drawSun(.5f, .5f, .2f)
        "clear-night" -> drawMoon(.48f, .5f, .3f)
        "partly-cloudy-day" -> { drawSun(.36f, .38f, .15f); drawCloud(.56f, .56f, .66f, cloud) }
        "partly-cloudy-night" -> { drawMoon(.38f, .36f, .2f); drawCloud(.56f, .58f, .66f, cloud) }
        "cloudy" -> { drawCloud(.62f, .4f, .5f, storm.copy(alpha = .85f)); drawCloud(.46f, .54f, .72f, cloud) }
        "fog" -> {
            drawCloud(.5f, .36f, .66f, cloud)
            listOf(.7f to .62f, .82f to .5f).forEach { (y, w) -> drawLine(storm, p(.5f - w / 2, y), p(.5f + w / 2, y), strokeWidth = side * .06f, cap = StrokeCap.Round) }
        }
        "drizzle" -> { drawCloud(.5f, .36f, .74f, cloud); drawDrops(3, .7f, .08f) }
        "rain" -> { drawCloud(.5f, .34f, .74f, cloud); drawDrops(3, .68f, .16f) }
        "heavy-rain" -> { drawCloud(.5f, .32f, .78f, storm); drawDrops(4, .64f, .22f) }
        "freezing-rain" -> { drawCloud(.5f, .34f, .74f, cloud); drawDrops(2, .68f, .14f); drawFlakes(2, .76f) }
        "showers" -> { drawSun(.3f, .3f, .13f); drawCloud(.56f, .42f, .66f, cloud); drawDrops(3, .74f, .13f) }
        "snow" -> { drawCloud(.5f, .34f, .74f, cloud); drawFlakes(3, .72f) }
        "heavy-snow" -> { drawCloud(.5f, .32f, .78f, storm); drawFlakes(5, .7f) }
        "snow-showers" -> { drawSun(.3f, .3f, .13f); drawCloud(.56f, .42f, .66f, cloud); drawFlakes(3, .76f) }
        "thunderstorm" -> {
            drawCloud(.5f, .32f, .78f, storm)
            val bolt = Path().apply {
                moveTo(p(.54f, .6f).x, p(.54f, .6f).y)
                lineTo(p(.42f, .78f).x, p(.42f, .78f).y)
                lineTo(p(.51f, .78f).x, p(.51f, .78f).y)
                lineTo(p(.45f, .95f).x, p(.45f, .95f).y)
                lineTo(p(.62f, .72f).x, p(.62f, .72f).y)
                lineTo(p(.53f, .72f).x, p(.53f, .72f).y)
                close()
            }
            drawPath(bolt, sun)
        }
        "hail" -> {
            drawCloud(.5f, .32f, .78f, storm)
            listOf(.36f to .72f, .5f to .82f, .64f to .72f, .43f to .92f, .57f to .92f).forEach { (x, y) -> drawCircle(snow, side * .05f, p(x, y), style = Stroke(side * .025f)) }
        }
        else -> drawCloud(.5f, .46f, .74f, cloud)
    }
}

// ── Weather ─────────────────────────────────────────────────────────────────

@Composable
private fun WeatherWidget(node: JsonObject, data: UiWeatherData, ctx: DuiCtx) {
    val palette = ctx.palette
    val memory = rememberDuiMemory(ctx.memoryKey, node.string("id")?.let { "$it.unit" })
    val unit = memory.value.string("unit") ?: "c"
    var mode by rememberSaveable { mutableIntStateOf(0) }
    val current = data.current
    DuiPanel {
        WidgetHeader(data.location.label.ifBlank { data.location.name }, current.description, palette) {
            DuiSegmentBar(listOf("°C", "°F"), if (unit == "f") 1 else 0, { memory.update(JsonObject(mapOf("unit" to JsonPrimitive(if (it == 1) "f" else "c")))) }, fill = false, small = true, description = stringResource(R.string.dynamic_ui_weather_unit))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            WeatherGlyph(current.icon, Modifier.size(64.dp), current.description)
            Text(
                formatUiTemperature(current.temperatureC, unit, bare = true),
                style = MaterialTheme.typography.displaySmall.copy(fontSize = 50.sp, letterSpacing = (-1.5).sp).merge(duiTabular),
                fontWeight = FontWeight.Light,
                color = palette.text,
            )
            Column(Modifier.weight(1f).padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.dynamic_ui_weather_feels, formatUiTemperature(current.feelsLikeC, unit)), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.text)
                Text(stringResource(R.string.dynamic_ui_weather_wind, current.windText), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted)
                Text(stringResource(R.string.dynamic_ui_weather_humidity, current.humidityText), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted)
            }
        }
        if (data.hourly.isNotEmpty()) {
            DuiSegmentBar(listOf(stringResource(R.string.dynamic_ui_weather_temperature), stringResource(R.string.dynamic_ui_weather_precipitation)), mode, { mode = it }, fill = false, small = true)
            WeatherHourly(data.hourly, unit, mode == 1, ctx)
        }
        if (data.daily.isNotEmpty()) WeatherDaily(data.daily, current.temperatureC, unit, ctx)
        DuiSourceLine(data.source)
    }
}

@Composable
private fun WeatherHourly(hours: List<UiWeatherHour>, unit: String, precipitation: Boolean, ctx: DuiCtx) {
    val palette = ctx.palette
    val measurer = rememberTextMeasurer()
    val labelStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, color = palette.muted)
    val valueStyle = MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp, color = palette.text, fontWeight = FontWeight.SemiBold)
    val rainStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, color = Color(0xFF4DA3FF), fontWeight = FontWeight.SemiBold)
    val dark = !palette.isLight
    val reduce = reducedMotion()
    val progress = remember(precipitation) { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(precipitation) { if (progress.value < 1f) progress.animateTo(1f, tween(DUI_CHART_MS, easing = DuiEase)) }
    var selected by remember { mutableStateOf<Int?>(null) }
    val temperatures = hours.map { it.temperatureC }
    val low = temperatures.minOrNull() ?: 0.0
    val high = (temperatures.maxOrNull() ?: 1.0).let { if (it - low < 1) low + 1 else it }
    val accent = Color(0xFFFFB13D)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        // 46 dp per hour scrolls on phones; wide layouts stretch the 24 hours over the width.
        val column = maxOf(46.dp, maxWidth / hours.size.coerceAtLeast(1))
        Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Canvas(
                Modifier
                    .width(column * hours.size)
                    .height(156.dp)
                    .pointerInput(hours) {
                        detectTapGestures { offset ->
                            val index = (offset.x / column.toPx()).toInt().coerceIn(0, hours.lastIndex)
                            selected = if (selected == index) null else index
                        }
                    },
            ) {
                val w = column.toPx()
                val chartTop = 72.dp.toPx()
                val chartBottom = 128.dp.toPx()
                selected?.let { index -> drawRoundRect(palette.text.copy(alpha = .06f), Offset(index * w + 2.dp.toPx(), 0f), Size(w - 4.dp.toPx(), size.height), CornerRadius(12.dp.toPx())) }
                val points = hours.mapIndexed { index, hour ->
                    Offset(index * w + w / 2, (chartBottom - (hour.temperatureC - low) / (high - low) * (chartBottom - chartTop)).toFloat())
                }
                hours.forEachIndexed { index, hour ->
                    val cx = index * w + w / 2
                    val label = measurer.measure(hour.label, if (index == 0 || selected == index) labelStyle.copy(color = palette.text, fontWeight = FontWeight.SemiBold) else labelStyle)
                    drawText(label, topLeft = Offset(cx - label.size.width / 2f, 0f))
                    drawWeatherGlyph(hour.icon, Offset(cx - 12.dp.toPx(), 20.dp.toPx()), 24.dp.toPx(), dark)
                }
                if (!precipitation) {
                    val line = Path().apply { points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
                    val fill = Path().apply {
                        addPath(line)
                        lineTo(points.last().x, chartBottom + 14.dp.toPx())
                        lineTo(points.first().x, chartBottom + 14.dp.toPx())
                        close()
                    }
                    clipRect(right = size.width * progress.value) {
                        drawPath(fill, Brush.verticalGradient(listOf(accent.copy(alpha = .30f), accent.copy(alpha = 0f)), startY = chartTop, endY = chartBottom + 14.dp.toPx()))
                        drawPath(line, accent, style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                    hours.forEachIndexed { index, hour ->
                        val point = points[index]
                        if (selected == index) {
                            drawCircle(Color.White, 4.5.dp.toPx(), point)
                            drawCircle(accent, 3.dp.toPx(), point)
                        }
                        val text = measurer.measure(formatUiTemperature(hour.temperatureC, unit, bare = true), valueStyle)
                        drawText(text, topLeft = Offset(point.x - text.size.width / 2f, point.y - text.size.height - 5.dp.toPx()), alpha = progress.value)
                        val chance = hour.precipChance
                        if (chance != null && chance >= 20) {
                            val rainText = measurer.measure("${Math.round(chance)}%", rainStyle)
                            drawText(rainText, topLeft = Offset(point.x - rainText.size.width / 2f, size.height - rainText.size.height))
                        }
                    }
                } else {
                    val maxMm = max(1.0, hours.maxOf { it.precipitationMm })
                    hours.forEachIndexed { index, hour ->
                        val cx = index * w + w / 2
                        val share = (hour.precipChance?.div(100.0) ?: (hour.precipitationMm / maxMm)).coerceIn(0.0, 1.0).toFloat()
                        val barTop = chartBottom - (chartBottom - chartTop + 12.dp.toPx()) * share * progress.value
                        drawRoundRect(Color(0xFF4DA3FF).copy(alpha = .14f), Offset(cx - 9.dp.toPx(), chartTop - 12.dp.toPx()), Size(18.dp.toPx(), chartBottom - chartTop + 12.dp.toPx()), CornerRadius(6.dp.toPx()))
                        if (share > 0f) drawRoundRect(Color(0xFF4DA3FF).copy(alpha = if (selected == null || selected == index) .9f else .5f), Offset(cx - 9.dp.toPx(), barTop), Size(18.dp.toPx(), chartBottom - barTop), CornerRadius(6.dp.toPx()))
                        val text = measurer.measure(hour.precipChance?.let { "${Math.round(it)}%" } ?: "${formatUiValue(hour.precipitationMm, "decimal:1")}", rainStyle.copy(color = palette.text))
                        drawText(text, topLeft = Offset(cx - text.size.width / 2f, size.height - text.size.height))
                    }
                }
            }
        }
    }
}

@Composable
private fun WeatherDaily(days: List<UiWeatherDay>, currentC: Double, unit: String, ctx: DuiCtx) {
    val palette = ctx.palette
    val low = days.minOf { it.lowC }
    val high = days.maxOf { it.highC }.let { if (it - low < 1) low + 1 else it }
    Column(Modifier.fillMaxWidth()) {
        days.forEachIndexed { index, day ->
            val dayLabel = stringResource(R.string.dynamic_ui_weather_day, day.weekday, day.description, formatUiTemperature(day.lowC, unit), formatUiTemperature(day.highC, unit))
            Row(
                Modifier.fillMaxWidth().heightIn(min = 40.dp).duiRise(ctx.animate, index).semantics(mergeDescendants = true) {
                    contentDescription = dayLabel
                },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(day.label, Modifier.width(58.dp), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp), fontWeight = if (index == 0) FontWeight.SemiBold else FontWeight.Medium, color = palette.text, maxLines = 1)
                WeatherGlyph(day.icon, Modifier.size(26.dp))
                Text(day.precipChance?.takeIf { it >= 10 }?.let { "${Math.round(it)}%" } ?: "", Modifier.width(34.dp), style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = Color(0xFF4DA3FF))
                Text(formatUiTemperature(day.lowC, unit, bare = true), Modifier.width(34.dp), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp).merge(duiTabular), color = palette.muted, textAlign = TextAlign.End)
                Canvas(Modifier.weight(1f).height(6.dp)) {
                    val radius = CornerRadius(size.height / 2)
                    drawRoundRect(palette.text.copy(alpha = .09f), cornerRadius = radius)
                    val start = ((day.lowC - low) / (high - low)).toFloat() * size.width
                    val end = ((day.highC - low) / (high - low)).toFloat() * size.width
                    drawRoundRect(
                        Brush.horizontalGradient(listOf(Color(0xFF5AB8FF), Color(0xFFFFC23D), Color(0xFFFF8A3D)), startX = 0f, endX = size.width),
                        topLeft = Offset(start, 0f),
                        size = Size(max(size.height, end - start), size.height),
                        cornerRadius = radius,
                    )
                    if (index == 0) {
                        val x = (((currentC - low) / (high - low)).toFloat() * size.width).coerceIn(size.height / 2, size.width - size.height / 2)
                        drawCircle(palette.text, size.height * .95f, Offset(x, size.height / 2))
                        drawCircle(palette.background, size.height * .45f, Offset(x, size.height / 2))
                    }
                }
                Text(formatUiTemperature(day.highC, unit, bare = true), Modifier.width(34.dp), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text, textAlign = TextAlign.End)
            }
        }
    }
}

// ── Currency ────────────────────────────────────────────────────────────────

/** Editable amount: two decimals, no grouping. */
private fun plainAmount(value: Double): String {
    if (!value.isFinite()) return ""
    val rounded = java.math.BigDecimal(value.toString()).setScale(2, java.math.RoundingMode.HALF_UP)
    return rounded.stripTrailingZeros().toPlainString().let { if (it.contains('.') && it.substringAfter('.').length == 1) it + "0" else it }
}

private fun parseAmount(text: String): Double? = text.replace("'", "").replace("’", "").replace(" ", "").replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }

@Composable
private fun CurrencyWidget(data: UiCurrencyData, ctx: DuiCtx) {
    val palette = ctx.palette
    var reversed by rememberSaveable { mutableStateOf(false) }
    val from = if (reversed) data.to else data.from
    val to = if (reversed) data.from else data.to
    val fromName = if (reversed) data.toName else data.fromName
    val toName = if (reversed) data.fromName else data.toName
    val rate = if (reversed) data.inverseRate.takeIf { it > 0 } ?: (1 / data.rate) else data.rate
    var top by remember(reversed) { mutableStateOf(plainAmount(data.amount)) }
    var bottom by remember(reversed) { mutableStateOf(plainAmount(data.amount * rate)) }
    val series = remember(data, reversed) { data.series.map { if (reversed && it.rate > 0) it.copy(rate = 1 / it.rate) else it } }
    var scrub by remember(series) { mutableStateOf<Int?>(null) }
    DuiPanel {
        WidgetHeader(listOfNotNull(fromName ?: from, toName ?: to).joinToString(" → "), data.dateText.ifBlank { null }, palette) {
            DuiToolButton(Icons.Outlined.SwapVert, stringResource(R.string.dynamic_ui_currency_swap), { reversed = !reversed })
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CurrencyField(from, fromName, top, palette) { typed ->
                top = typed
                parseAmount(typed)?.let { bottom = plainAmount(it * rate) } ?: run { if (typed.isBlank()) bottom = "" }
            }
            CurrencyField(to, toName, bottom, palette) { typed ->
                bottom = typed
                parseAmount(typed)?.let { top = plainAmount(it / rate) } ?: run { if (typed.isBlank()) top = "" }
            }
        }
        val point = scrub?.let { series.getOrNull(it) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (point != null) "1 $from = ${formatUiNumber(point.rate, 4)} $to" else if (reversed) data.inverseRateText else data.rateText,
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp).merge(duiTabular),
                fontWeight = FontWeight.Medium,
                color = palette.text,
            )
            Text(
                if (point != null) formatUiDate(point.date) else data.changeText,
                style = MaterialTheme.typography.labelMedium.merge(duiTabular),
                color = if (point != null) palette.muted else changeColor(if (reversed) flipTone(data.changeTone) else data.changeTone, palette),
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (series.size >= 2) {
            val color = changeColor(if (reversed) flipTone(data.changeTone) else data.changeTone, palette).let { if (it == palette.muted) palette.accent else it }
            ScrubLine(series.map { it.rate }, color, scrub, { scrub = it }, Modifier.fillMaxWidth().height(72.dp), ctx.animate)
        }
        DuiSourceLine(data.source)
    }
}

private fun flipTone(tone: String) = when (tone) { "positive" -> "negative"; "negative" -> "positive"; else -> tone }

@Composable
private fun CurrencyField(code: String, name: String?, text: String, palette: PlumPalette, onChange: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(palette.duiField)
            .border(1.dp, palette.duiEdge, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BasicTextField(
            value = text,
            onValueChange = { onChange(it.take(18)) },
            singleLine = true,
            textStyle = MaterialTheme.typography.titleLarge.copy(fontSize = 22.sp, color = palette.text, fontWeight = FontWeight.SemiBold).merge(duiTabular),
            cursorBrush = SolidColor(palette.accent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.weight(1f).semantics { contentDescription = name ?: code },
        )
        Column(horizontalAlignment = Alignment.End) {
            Text(code, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = palette.text)
            name?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(110.dp), textAlign = TextAlign.End) }
        }
    }
}

/**
 * A line chart with a soft fill that follows the finger: [onScrub] reports
 * the nearest point while pressed (null on release).
 */
@Composable
private fun ScrubLine(values: List<Double>, color: Color, scrub: Int?, onScrub: (Int?) -> Unit, modifier: Modifier, animate: Boolean, baseline: Double? = null) {
    val palette = PlumTheme.palette
    val reduce = reducedMotion()
    val progress = remember(values) { Animatable(if (animate && !reduce) 0f else 1f) }
    LaunchedEffect(values) { if (progress.value < 1f) progress.animateTo(1f, tween(DUI_CHART_MS, easing = DuiEase)) }
    fun index(x: Float, width: Float) = if (values.size < 2) 0 else Math.round(x / width * (values.size - 1)).coerceIn(0, values.lastIndex)
    Canvas(
        modifier
            .pointerInput(values) {
                detectTapGestures(onPress = { offset ->
                    onScrub(index(offset.x, size.width.toFloat()))
                    tryAwaitRelease()
                    onScrub(null)
                })
            }
            .pointerInput(values) {
                detectHorizontalDragGestures(
                    onDragStart = { offset -> onScrub(index(offset.x, size.width.toFloat())) },
                    onDragEnd = { onScrub(null) },
                    onDragCancel = { onScrub(null) },
                    onHorizontalDrag = { change, _ -> change.consume(); onScrub(index(change.position.x, size.width.toFloat())) },
                )
            },
    ) {
        if (values.size < 2) return@Canvas
        val pad = 4.dp.toPx()
        val all = if (baseline != null) values + baseline else values
        val low = all.min()
        val high = all.max().let { if (it == low) low + 1 else it }
        fun y(value: Double) = (pad + (1 - (value - low) / (high - low)) * (size.height - pad * 2)).toFloat()
        val points = values.mapIndexed { i, value -> Offset(size.width * i / (values.size - 1), y(value)) }
        baseline?.let { base ->
            drawLine(palette.text.copy(alpha = .25f), Offset(0f, y(base)), Offset(size.width, y(base)), strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx())))
        }
        val line = Path().apply { points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
        val fill = Path().apply {
            addPath(line)
            lineTo(points.last().x, size.height)
            lineTo(points.first().x, size.height)
            close()
        }
        clipRect(right = size.width * progress.value + 2f) {
            drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = .26f), color.copy(alpha = 0f))))
            drawPath(line, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        scrub?.let { i ->
            val p = points.getOrNull(i) ?: return@let
            drawLine(palette.text.copy(alpha = .35f), Offset(p.x, 0f), Offset(p.x, size.height), strokeWidth = 1.dp.toPx())
            drawCircle(Color.White, 5.dp.toPx(), p)
            drawCircle(color, 3.5.dp.toPx(), p)
        }
    }
}

// ── Stock ───────────────────────────────────────────────────────────────────

@Composable
private fun StockWidget(data: UiStockData, ctx: DuiCtx) {
    val palette = ctx.palette
    val available = UI_STOCK_RANGES.filter { data.ranges[it]?.points?.isNotEmpty() == true }.ifEmpty { listOf(data.defaultRange) }
    var range by rememberSaveable(data.symbol) { mutableStateOf(data.defaultRange.takeIf { it in available } ?: available.first()) }
    val rangeData = data.ranges[range]
    val points = rangeData?.points.orEmpty()
    var scrub by remember(range) { mutableStateOf<Int?>(null) }
    val point = scrub?.let { points.getOrNull(it) }
    val start = rangeData?.start ?: points.firstOrNull()?.close
    val headline = point?.let { formatUiPriceLike(it.close, data.priceText) } ?: data.priceText
    val change = point?.let { p -> start?.takeIf { it != 0.0 }?.let { s -> formatUiChange(p.close - s, (p.close - s) / s * 100) to uiTone(p.close - s) } }
        ?: ((rangeData?.changeText ?: data.changeText) to (rangeData?.changeTone ?: data.changeTone))
    val labels = mapOf("1M" to R.string.dynamic_ui_stock_1m, "6M" to R.string.dynamic_ui_stock_6m, "1Y" to R.string.dynamic_ui_stock_1y, "5Y" to R.string.dynamic_ui_stock_5y)
    val periods = mapOf("1M" to R.string.dynamic_ui_stock_period_1m, "6M" to R.string.dynamic_ui_stock_period_6m, "1Y" to R.string.dynamic_ui_stock_period_1y, "5Y" to R.string.dynamic_ui_stock_period_5y)
    val lineColor = changeColor(rangeData?.changeTone ?: data.changeTone, palette).let { if (it == palette.muted) palette.accent else it }
    DuiPanel {
        WidgetHeader(data.name ?: data.symbol, listOfNotNull(data.symbol.takeIf { data.name != null }, data.exchange, data.currency).joinToString(" · ").ifBlank { null }, palette) {
            Text(
                stringResource(R.string.dynamic_ui_stock_today, data.changeText.substringAfter('(').substringBefore(')').ifBlank { data.changeText }),
                Modifier.clip(CircleShape).background(changeColor(data.changeTone, palette).copy(alpha = .13f)).padding(horizontal = 10.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelMedium.merge(duiTabular),
                fontWeight = FontWeight.SemiBold,
                color = changeColor(data.changeTone, palette),
            )
        }
        Column(Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(headline, style = MaterialTheme.typography.headlineMedium.copy(fontSize = 32.sp, letterSpacing = (-.6).sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(change.first, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = changeColor(change.second, palette))
                Text(point?.let { formatUiDate(it.date) } ?: stringResource(periods[range] ?: R.string.dynamic_ui_stock_period_1m), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted)
            }
        }
        DuiSegmentBar(available.map { stringResource(labels[it] ?: R.string.dynamic_ui_stock_1m) }, available.indexOf(range).coerceAtLeast(0), { range = available[it] }, fill = false, small = true)
        if (points.size >= 2) {
            ScrubLine(points.map { it.close }, lineColor, scrub, { scrub = it }, Modifier.fillMaxWidth().height(170.dp), ctx.animate, baseline = start)
            Row(Modifier.fillMaxWidth()) {
                Text(formatUiDate(points.first().date), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = palette.muted)
                Text(formatUiDate(points.last().date), style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
        }
        if (data.metrics.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            data.metrics.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    pair.forEach { metric ->
                        Row(Modifier.weight(1f).heightIn(min = 30.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(metric.label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted, maxLines = 1)
                            Text(metric.valueText, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp).merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text, maxLines = 1)
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        DuiSourceLine(data.source, data.tradeDateText.ifBlank { null })
    }
}

private fun uiTone(value: Double): String = when { value > 1e-9 -> "positive"; value < -1e-9 -> "negative"; else -> "neutral" }

// ── Entity ──────────────────────────────────────────────────────────────────

/** Wikipedia summary card: title, short description, image, lead, link. */
@Composable
internal fun EntityContent(data: UiEntityData, palette: PlumPalette, large: Boolean = false) {
    val context = LocalContext.current
    var more by remember(data.title) { mutableStateOf(false) }
    var lightbox by remember { mutableStateOf(false) }
    val image = data.image?.src?.takeIf { isUiHttpsUrl(it) }
    var imageFailed by remember(image) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (large && image != null && !imageFailed) DuiImage(
            image, data.image?.alt?.ifBlank { null } ?: data.displayTitle,
            Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(RoundedCornerShape(16.dp)).clickable(role = Role.Image) { lightbox = true },
            onFailed = { imageFailed = true },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(data.displayTitle.ifBlank { data.title.replace('_', ' ') }, style = MaterialTheme.typography.titleMedium.copy(fontSize = if (large) 20.sp else 17.sp), fontWeight = FontWeight.SemiBold, color = palette.text, modifier = Modifier.semantics { heading() })
                data.description?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted) }
            }
            if (!large && image != null && !imageFailed) DuiImage(
                image, data.image?.alt?.ifBlank { null } ?: data.displayTitle,
                Modifier.size(76.dp).clip(RoundedCornerShape(14.dp)).clickable(role = Role.Image) { lightbox = true },
                onFailed = { imageFailed = true },
            )
        }
        if (data.kind == "disambiguation") Text(stringResource(R.string.dynamic_ui_entity_disambiguation), style = MaterialTheme.typography.bodySmall, color = palette.muted)
        if (data.extract.isNotBlank()) Text(
            data.extract,
            Modifier.clickable(role = Role.Button) { more = !more },
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp),
            color = palette.text.copy(alpha = .9f),
            maxLines = if (more || large) Int.MAX_VALUE else 4,
            overflow = TextOverflow.Ellipsis,
        )
        if (isUiHttpsUrl(data.url)) Row(
            Modifier.clip(CircleShape).border(1.dp, palette.duiEdge, CircleShape).clickable(role = Role.Button) { openUiUrl(context, data.url) }.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("W", style = MaterialTheme.typography.labelLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Serif), fontWeight = FontWeight.Bold, color = palette.text)
            Text(data.source.name.ifBlank { "Wikipedia" }, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = palette.text)
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, tint = palette.muted, modifier = Modifier.size(14.dp))
        }
    }
    if (lightbox && image != null) DuiLightbox(listOf(DuiLightboxImage(data.originalImage?.takeIf { isUiHttpsUrl(it) } ?: image, data.displayTitle, data.description, data.url)), 0) { lightbox = false }
}

// ── News ────────────────────────────────────────────────────────────────────

@Composable
private fun NewsWidget(data: UiNewsData, ctx: DuiCtx) {
    val palette = ctx.palette
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.dynamic_ui_live_news, data.query), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = palette.muted, modifier = Modifier.semantics { heading() })
        DuiCardCarousel(data.articles.size, Modifier, cardWidthFraction = .74f, maxCardWidth = 280.dp, animate = ctx.animate) { index ->
            val article = data.articles[index]
            val source = remember { MutableInteractionSource() }
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .clickable(interactionSource = source, indication = null, role = Role.Button) { openUiUrl(context, article.url) }
                    .semantics(mergeDescendants = true) {}
                    .padding(bottom = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(16.dp))) {
                    val fallback = @Composable {
                        Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(palette.accent.copy(alpha = .25f), palette.blue.copy(alpha = .18f)))), contentAlignment = Alignment.Center) {
                            Text(article.source.take(1).uppercase(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = palette.text.copy(alpha = .5f))
                        }
                    }
                    if (article.image != null) DuiImage(article.image, article.title, Modifier.matchParentSize(), fallback = fallback) else fallback()
                }
                Text(listOfNotNull(article.source.ifBlank { null }, article.dateText).joinToString(" · "), style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp), fontWeight = FontWeight.Medium, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(article.title, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 20.sp), fontWeight = FontWeight.SemiBold, color = palette.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
        DuiSourceLine(data.source)
    }
}

// ── Gallery ─────────────────────────────────────────────────────────────────

@Composable
private fun GalleryWidget(data: UiGalleryData, ctx: DuiCtx) {
    val palette = ctx.palette
    var open by remember { mutableStateOf<Int?>(null) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.dynamic_ui_live_gallery, data.query), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = palette.muted, modifier = Modifier.semantics { heading() })
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val columns = if (maxWidth < 300.dp) 2 else 3
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                data.images.chunked(columns).forEachIndexed { line, images ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        images.forEachIndexed { column, image ->
                            val index = line * columns + column
                            DuiImage(
                                image.thumbnail?.takeIf { isUiHttpsUrl(it) } ?: image.src,
                                image.title,
                                Modifier.weight(1f).aspectRatio(1f).duiRise(ctx.animate, index).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Image) { open = index },
                                fallback = { DuiImageFallback(Modifier.fillMaxSize()) },
                            )
                        }
                        repeat(columns - images.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        DuiSourceLine(data.source)
    }
    open?.let { start ->
        DuiLightbox(data.images.map { DuiLightboxImage(it.src, it.title, it.source, it.pageUrl) }, start) { open = null }
    }
}
