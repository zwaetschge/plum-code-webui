package com.claudewebui.app.ui.components.common

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.claudewebui.app.ui.theme.AppBackgroundStyle
import com.claudewebui.app.ui.theme.PlumPalette
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Native, lightweight versions of the WebUI's three optional wallpapers. */
@Composable
fun AppearanceBackdropEffects(
    style: AppBackgroundStyle,
    palette: PlumPalette,
    modifier: Modifier = Modifier,
) {
    // E-ink deliberately has no wallpaper. The normal aurora is drawn by PlumBackdrop.
    if (style == AppBackgroundStyle.AURORA || palette.waveViolet == Color.Transparent) return

    val animate = !PlumTheme.tokens.motion.reduceMotion
    val time = if (style == AppBackgroundStyle.STILL) rememberGalaxyTime(animate)
        else rememberAmbientWaveTime(animate)
    val stars = remember { createGalaxyStars() }
    Canvas(modifier) {
        when (style) {
            AppBackgroundStyle.GLASS -> drawMistyWaterdrops(palette.isLight, time.value)
            AppBackgroundStyle.RIBBONS -> drawNeonGlow(palette.isLight, time.value)
            AppBackgroundStyle.STILL -> drawAuroraGalaxy(palette.isLight, time.value, stars)
            AppBackgroundStyle.AURORA -> Unit
        }
    }
}

/** Galaxy light changes slowly; ten frames per second keep the drift smooth without a full-speed redraw. */
@Composable
private fun rememberGalaxyTime(animate: Boolean): State<Long> {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    return produceState(0L, lifecycle, animate) {
        if (!animate) return@produceState
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            val start = SystemClock.uptimeMillis()
            while (true) {
                value = SystemClock.uptimeMillis() - start
                delay(100L)
            }
        }
    }
}

private fun DrawScope.drawSoftGlow(center: Offset, radius: Float, color: Color) {
    drawCircle(
        brush = Brush.radialGradient(
            colors = listOf(color, color.copy(alpha = color.alpha * .38f), Color.Transparent),
            center = center,
            radius = radius,
        ),
        center = center,
        radius = radius,
    )
}

private data class DropTrack(
    val x: Float,
    val start: Float,
    val speed: Float,
    val width: Float,
    val trail: Float,
    val phase: Float,
)

private val dropTracks = listOf(
    DropTrack(.07f, .16f, 25f, 8f, 105f, .3f),
    DropTrack(.23f, .72f, 39f, 13f, 205f, 1.8f),
    DropTrack(.39f, .38f, 22f, 9f, 130f, 2.9f),
    DropTrack(.56f, .86f, 34f, 11f, 185f, 4.1f),
    DropTrack(.75f, .09f, 28f, 10f, 155f, 5.2f),
    DropTrack(.92f, .6f, 44f, 14f, 245f, 6.4f),
    DropTrack(.14f, .28f, 19f, 8f, 100f, 7.7f),
    DropTrack(.48f, .79f, 36f, 12f, 200f, 9.2f),
    DropTrack(.83f, .43f, 24f, 9f, 125f, 10.6f),
)

private fun DrawScope.drawMistyWaterdrops(light: Boolean, elapsedMs: Long) {
    drawRect(
        Brush.linearGradient(
            colors = if (light) listOf(Color(0xFFB9D4D9), Color(0xFFDCE9E7), Color(0xFFD2D8E8))
            else listOf(Color(0xFF0D1C25), Color(0xFF14212B), Color(0xFF1B1729)),
            start = Offset.Zero,
            end = Offset(size.width, size.height),
        ),
    )

    // A few diffuse shapes suggest distant light behind the condensation.
    val drift = sin(elapsedMs / 48_000.0 * 2 * PI).toFloat() * size.width * .018f
    drawSoftGlow(Offset(size.width * .13f + drift, size.height * .22f), size.width * .45f,
        Color(0xFFF5C258).copy(alpha = if (light) .08f else .10f))
    drawSoftGlow(Offset(size.width * .85f - drift, size.height * .2f), size.width * .54f,
        Color(0xFF22D5EB).copy(alpha = if (light) .12f else .14f))
    drawSoftGlow(Offset(size.width * .45f + drift, size.height * .78f), size.width * .66f,
        Color(0xFFB56BFF).copy(alpha = if (light) .10f else .13f))
    drawRect(if (light) Color(0x339CB7BF) else Color(0x1EBBD3DE))

    val count = if (size.width < 600.dp.toPx()) 6 else dropTracks.size
    val seconds = elapsedMs / 1_000f
    repeat(count) { index ->
        val track = dropTracks[index]
        val width = track.width.dp.toPx()
        val trail = track.trail.dp.toPx()
        val distance = size.height + trail + 100.dp.toPx()
        val y = (track.start * size.height + seconds * track.speed.dp.toPx()) % distance - trail * .32f
        val from = (y - trail).coerceAtLeast(-15.dp.toPx())
        if (y < -20.dp.toPx() || from >= size.height) return@repeat
        val to = min(y, size.height + 20.dp.toPx())
        val path = Path()
        fun xAt(pointY: Float): Float {
            val logicalY = pointY / density
            return track.x * size.width +
                sin(logicalY * .012f + track.phase) * 3.2.dp.toPx() +
                sin(logicalY * .032f + track.phase * 1.7f) * 1.1.dp.toPx()
        }
        path.moveTo(xAt(from), from)
        var pointY = from + 18.dp.toPx()
        while (pointY < to) {
            path.lineTo(xAt(pointY), pointY)
            pointY += 18.dp.toPx()
        }
        path.lineTo(xAt(to), to)

        // Dark centre with opposed highlights reads as a wiped channel in fog.
        drawPath(path, if (light) Color(0x304B7B8B) else Color(0x3805101C),
            style = Stroke(width = width * .52f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawPath(path, if (light) Color.White.copy(alpha = .25f) else Color(0xFFDCF5F9).copy(alpha = .18f),
            style = Stroke(width = width * .12f, cap = StrokeCap.Round, join = StrokeJoin.Round))

        if (y in -20.dp.toPx()..(size.height + 20.dp.toPx())) {
            drawWaterdrop(Offset(xAt(y), y), width, light)
            if (track.width >= 11f) {
                drawWaterdrop(Offset(xAt(y - width * 2.7f), y - width * 2.7f), width * .28f, light)
            }
        }
    }
}

private fun DrawScope.drawWaterdrop(center: Offset, width: Float, light: Boolean) {
    val half = width * .5f
    val height = width * 1.6f
    val path = Path().apply {
        moveTo(center.x - half * .15f, center.y - height * .8f)
        cubicTo(center.x + half * .18f, center.y - height * .55f,
            center.x + half * .9f, center.y - height * .34f,
            center.x + half, center.y + height * .12f)
        cubicTo(center.x + half * 1.12f, center.y + height * .62f,
            center.x + half * .54f, center.y + height * .9f,
            center.x, center.y + height * .9f)
        cubicTo(center.x - half * .75f, center.y + height * .9f,
            center.x - half * 1.14f, center.y + height * .5f,
            center.x - half, center.y + height * .05f)
        cubicTo(center.x - half * .9f, center.y - height * .38f,
            center.x - half * .28f, center.y - height * .6f,
            center.x - half * .15f, center.y - height * .8f)
        close()
    }
    drawPath(path,
        brush = Brush.linearGradient(
            if (light) listOf(Color(0xADFFFFFF), Color(0x4AEEFAFB), Color(0x40878091), Color(0x99FFFFFF))
            else listOf(Color(0x8FE2F7FA), Color(0x2B6B9BB0), Color(0x8C041320), Color(0x80B4E1ED)),
            start = Offset(center.x - half, center.y - height),
            end = Offset(center.x + half, center.y + height),
        ),
    )
    drawPath(path,
        color = if (light) Color(0x616A7B86) else Color(0x6BBFE5ED),
        style = Stroke(width = .8.dp.toPx()),
    )
    drawLine(
        color = Color.White.copy(alpha = if (light) .65f else .58f),
        start = Offset(center.x - half * .45f, center.y - height * .2f),
        end = Offset(center.x - half * .09f, center.y - height * .57f),
        strokeWidth = (width * .09f).coerceAtLeast(.65.dp.toPx()),
        cap = StrokeCap.Round,
    )
}

private fun DrawScope.drawNeonGlow(light: Boolean, elapsedMs: Long) {
    drawRect(
        if (light) Brush.linearGradient(
            listOf(Color(0xFFCBDFe9), Color(0xFFE6EBF5), Color(0xFFD7DCF0)),
            start = Offset.Zero, end = Offset(size.width, size.height),
        ) else Brush.linearGradient(
            listOf(Color(0xFF0B1524), Color(0xFF101329), Color(0xFF071C26)),
            start = Offset.Zero, end = Offset(size.width, size.height),
        ),
    )
    drawSoftGlow(Offset(size.width * .07f, size.height * .52f), size.width * .49f,
        Color(0xFF7433F4).copy(alpha = if (light) .10f else .15f))
    drawSoftGlow(Offset(size.width * .91f, size.height * .2f), size.width * .53f,
        Color(0xFF0BD7EF).copy(alpha = if (light) .10f else .14f))
    drawSoftGlow(Offset(size.width * .80f, size.height * .88f), size.width * .47f,
        Color(0xFFE833AE).copy(alpha = if (light) .07f else .10f))

    val seconds = elapsedMs / 1_000f
    val sway = sin(seconds * .34f).toFloat() * size.width * .035f
    drawNeonTube(baseX = .18f, phase = .25f, sway = sway, color = Color(0xFF00E6F5), light = light, seconds = seconds)
    drawNeonTube(baseX = .79f, phase = 2.15f, sway = -sway, color = Color(0xFFE833DB), light = light, seconds = seconds)
}

private fun DrawScope.drawNeonTube(
    baseX: Float,
    phase: Float,
    sway: Float,
    color: Color,
    light: Boolean,
    seconds: Float,
) {
    fun xAt(fractionY: Float): Float = size.width * (
        baseX + .055f * sin(fractionY * PI * 2 + phase + seconds * .17f).toFloat() +
            .013f * sin(fractionY * PI * 4 + phase * .7f - seconds * .11f).toFloat()
    ) + sway

    val path = Path().apply {
        moveTo(xAt(-.08f), -size.height * .08f)
        for (step in 0..40) {
            val y = step / 40f * 1.16f - .08f
            lineTo(xAt(y), size.height * y)
        }
    }
    val unit = 1.dp.toPx()
    drawPath(path, color.copy(alpha = if (light) .06f else .055f),
        style = Stroke(width = 28 * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(path, color.copy(alpha = if (light) .13f else .12f),
        style = Stroke(width = 14 * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(path, if (light) Color(0xFF39475B).copy(alpha = .34f) else Color(0xFF182E49).copy(alpha = .75f),
        style = Stroke(width = 6 * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(path, color.copy(alpha = if (light) .60f else .74f),
        style = Stroke(width = 3 * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(path, if (light) Color.White.copy(alpha = .48f) else Color.White.copy(alpha = .72f),
        style = Stroke(width = 1.1f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))

    repeat(2) { index ->
        val progress = (seconds * .09f + phase / 6f + index * .48f + 1_000f) % 1f
        val center = Offset(xAt(progress), size.height * progress)
        val radius = (6f - index * 1.3f) * unit
        drawSoftGlow(center, radius * 2.1f, color.copy(alpha = if (light) .12f else .21f))
        drawCircle(if (light) Color.White.copy(alpha = .55f) else Color.White.copy(alpha = .80f),
            radius = radius * .29f, center = center)
    }
}

private data class GalaxyStar(
    val x: Float,
    val y: Float,
    val radius: Float,
    val alpha: Float,
    val tone: Int,
    val bright: Boolean,
    val twinkle: Boolean,
)

private fun createGalaxyStars(): List<GalaxyStar> {
    var seed = 0x0724AC39
    fun random(): Float {
        seed = seed * 1664525 + 1013904223
        return ((seed.toLong() and 0xFFFF_FFFFL) / 4294967296.0).toFloat()
    }
    return List(30) { index ->
        val x = .03f + random() * .94f
        val y = .03f + random() * .94f
        val bright = index == 5 || index == 23
        val medium = !bright && random() < .18f
        val radius = if (bright) .83f + random() * .15f else if (medium) .57f + random() * .13f else .30f + random() * .18f
        val alpha = if (bright) .52f + random() * .09f else if (medium) .34f + random() * .10f else .18f + random() * .14f
        val toneRoll = random()
        GalaxyStar(x, y, radius, alpha,
            when {
                toneRoll < .72f -> 0
                toneRoll < .88f -> 1
                toneRoll < .97f -> 2
                else -> 3
            },
            bright, index == 5 || index == 12 || index == 17 || index == 23)
    }
}

private fun DrawScope.drawAuroraGalaxy(light: Boolean, elapsedMs: Long, stars: List<GalaxyStar>) {
    drawRect(
        Brush.verticalGradient(
            if (light) listOf(Color(0xFFE9E4F2), Color(0xFFDCE9ED), Color(0xFFE4E5F0))
            else listOf(Color(0xFF0D1021), Color(0xFF101A26), Color(0xFF151322)),
        ),
    )
    val seconds = elapsedMs / 1_000f
    val driftA = sin(seconds * (2 * PI / 28)).toFloat() * size.width * .055f
    val driftB = sin(seconds * (2 * PI / 36) + 1.1).toFloat() * size.width * .045f
    val cloudRadius = max(size.width, size.height)
    // Wide radial light fields imply a nebula without a visible geometric band or clipped edge.
    drawSoftGlow(Offset(size.width * .13f + driftA, size.height * .22f), cloudRadius * .52f,
        Color(0xFFA474D7).copy(alpha = if (light) .13f else .16f))
    drawSoftGlow(Offset(size.width * .73f - driftA, size.height * .38f), cloudRadius * .52f,
        Color(0xFF4CAABB).copy(alpha = if (light) .12f else .14f))
    drawSoftGlow(Offset(size.width * .43f + driftB, size.height * .87f), cloudRadius * .54f,
        Color(0xFFB278B0).copy(alpha = if (light) .10f else .12f))
    drawSoftGlow(Offset(size.width * .81f - driftB, size.height * .85f), cloudRadius * .37f,
        Color(0xFFD1A878).copy(alpha = if (light) .045f else .055f))

    val count = if (size.width < 640.dp.toPx()) 20 else stars.size
    repeat(count) { index ->
        val star = stars[index]
        val color = when (star.tone) {
            1 -> if (light) Color(0xFF215F6B) else Color(0xFFBCE9F2)
            2 -> if (light) Color(0xFF684A89) else Color(0xFFE5D7FA)
            3 -> if (light) Color(0xFF785D2F) else Color(0xFFF9EDCF)
            else -> if (light) Color(0xFF37465F) else Color(0xFFF1F7FA)
        }
        val twinkle = if (star.twinkle) .68f + .32f * sin(seconds * (1.15f + index % 3 * .17f) + index * 1.7f).toFloat() else 1f
        val alpha = star.alpha * twinkle * (if (light) .46f else 1f)
        val center = Offset(
            size.width * (star.x + sin(seconds * .18f + index * .7f).toFloat() * .006f),
            size.height * (star.y + sin(seconds * .11f + index * 1.3f).toFloat() * .003f),
        )
        val radius = star.radius.dp.toPx()
        if (star.bright) drawSoftGlow(center, radius * 4f, color.copy(alpha = if (light) .035f else .08f))
        drawCircle(color.copy(alpha = alpha), radius = radius, center = center)
    }
}
