package com.claudewebui.app.ui.components.common

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.claudewebui.app.ui.theme.PlumPalette
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin

/** A 20 fps decorative clock that stops with the screen and with reduced motion. */
@Composable
internal fun rememberAmbientWaveTime(animate: Boolean): State<Long> {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    return produceState(0L, lifecycle, animate) {
        if (!animate) return@produceState
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            val start = SystemClock.uptimeMillis()
            while (true) {
                value = SystemClock.uptimeMillis() - start
                delay(50L)
            }
        }
    }
}

/** The WebUI's three aurora masks, painted as inexpensive Compose paths. */
internal fun DrawScope.drawAuroraWaves(palette: PlumPalette, elapsedMs: Long) {
    if (palette.waveViolet == Color.Transparent) return
    val strength = if (palette.isLight) .58f else 1f
    fun drift(periodMs: Double, phase: Double): Float =
        sin(elapsedMs / periodMs * 2.0 * PI + phase).toFloat()

    drawRibbon(
        index = 0, topFraction = .08f, heightFraction = .44f, overscan = .18f,
        driftX = drift(38_000.0, 0.0) * size.width * .045f,
        driftY = drift(38_000.0, 1.0) * size.height * .012f,
        wavePhase = elapsedMs / 21_000.0 * 2.0 * PI,
        colors = listOf(
            Color.Transparent,
            palette.waveViolet.copy(alpha = .08f * strength),
            palette.waveViolet.copy(alpha = .17f * strength),
            palette.waveCyan.copy(alpha = .14f * strength),
            Color.Transparent,
        ),
    )
    drawRibbon(
        index = 1, topFraction = .36f, heightFraction = .46f, overscan = .16f,
        driftX = drift(48_000.0, 2.0) * size.width * .045f,
        driftY = drift(48_000.0, 3.0) * size.height * .012f,
        wavePhase = elapsedMs / 27_000.0 * 2.0 * PI + 1.7,
        colors = listOf(
            Color.Transparent,
            palette.waveCyan.copy(alpha = .10f * strength),
            palette.waveRose.copy(alpha = .15f * strength),
            palette.waveViolet.copy(alpha = .11f * strength),
            Color.Transparent,
        ),
    )
    drawRibbon(
        index = 2, topFraction = .60f, heightFraction = .54f, overscan = .20f,
        driftX = drift(62_000.0, 4.0) * size.width * .035f,
        driftY = drift(62_000.0, 5.0) * size.height * .010f,
        wavePhase = elapsedMs / 33_000.0 * 2.0 * PI + 3.1,
        colors = listOf(
            Color.Transparent,
            palette.waveViolet.copy(alpha = .13f * strength),
            palette.waveGold.copy(alpha = .10f * strength),
            palette.waveCyan.copy(alpha = .11f * strength),
            Color.Transparent,
        ),
    )
}

private fun DrawScope.drawRibbon(
    index: Int,
    topFraction: Float,
    heightFraction: Float,
    overscan: Float,
    driftX: Float,
    driftY: Float,
    wavePhase: Double,
    colors: List<Color>,
) {
    val left = -size.width * overscan + driftX
    val top = size.height * topFraction + driftY
    val width = size.width * (1f + overscan * 2f)
    val height = size.height * heightFraction
    // The original ribbons only translated as rigid shapes. Bend their path
    // slowly as well: on a phone this moves the contour by roughly 10–15 dp
    // within a few seconds, while the transparent edges stay out of view.
    fun x(value: Int): Float {
        val fraction = value / 100f
        return left + width * fraction +
            sin(fraction * PI * 2.4 + wavePhase).toFloat() * width * .012f
    }
    fun y(value: Int): Float {
        val fraction = value / 100f
        return top + height * (fraction +
            sin(fraction * PI * 2.1 + wavePhase + 1.2).toFloat() * .052f)
    }
    val path = Path().apply {
        when (index) {
            0 -> {
                moveTo(x(0), y(41))
                cubicTo(x(10), y(29), x(20), y(28), x(31), y(39))
                cubicTo(x(42), y(50), x(51), y(57), x(63), y(44))
                cubicTo(x(76), y(29), x(88), y(28), x(100), y(40))
                lineTo(x(100), y(72))
                cubicTo(x(90), y(63), x(80), y(63), x(68), y(73))
                cubicTo(x(55), y(83), x(43), y(78), x(31), y(68))
                cubicTo(x(19), y(58), x(9), y(60), x(0), y(72))
            }
            1 -> {
                moveTo(x(0), y(46))
                cubicTo(x(12), y(58), x(23), y(62), x(36), y(49))
                cubicTo(x(51), y(34), x(65), y(36), x(78), y(50))
                cubicTo(x(88), y(61), x(95), y(57), x(100), y(49))
                lineTo(x(100), y(78))
                cubicTo(x(87), y(72), x(79), y(78), x(66), y(85))
                cubicTo(x(50), y(94), x(37), y(78), x(24), y(70))
                cubicTo(x(14), y(64), x(7), y(68), x(0), y(78))
            }
            else -> {
                moveTo(x(0), y(42))
                cubicTo(x(14), y(25), x(27), y(34), x(39), y(47))
                cubicTo(x(50), y(60), x(64), y(58), x(77), y(45))
                cubicTo(x(88), y(34), x(96), y(38), x(100), y(45))
                lineTo(x(100), y(86))
                cubicTo(x(86), y(73), x(74), y(76), x(61), y(86))
                cubicTo(x(47), y(97), x(35), y(84), x(23), y(72))
                cubicTo(x(13), y(62), x(5), y(67), x(0), y(80))
            }
        }
        close()
    }
    drawPath(
        path,
        Brush.linearGradient(
            colors = colors,
            start = Offset(left, top),
            end = Offset(left + width, top),
        ),
    )
}
