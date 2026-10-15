package com.claudewebui.app.ui.motion

import android.content.Context
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext

/*
 * Unfold reveal: the screen is one picture across both displays. What the
 * cover display showed is the part right of the hinge, and it stays sharp and
 * in place. The newly opened part left of the hinge starts blurred and dark —
 * both growing from the hinge towards the outer edge — and clears as the
 * device opens flat. Blur and darkening follow the hinge angle; a time ramp
 * caps them so a device left half open (flex mode) is never stuck blurred.
 */

private const val MAX_BLUR_DP = 34f
private const val REVEAL_MS = 1400

/** Live hinge angle in degrees (180 = flat), or null without a hinge sensor. */
@Composable
fun rememberHingeAngle(): State<Float?> {
    val context = LocalContext.current
    val angle = remember { mutableStateOf<Float?>(null) }
    DisposableEffect(context) {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val sensor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            manager?.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE)
        } else {
            null
        }
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                angle.value = event.values.firstOrNull()
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        if (manager != null && sensor != null) {
            manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
        }
        onDispose { manager?.unregisterListener(listener) }
    }
    return angle
}

private fun smoothstep(x: Float): Float {
    val t = x.coerceIn(0f, 1f)
    return t * t * (3f - 2f * t)
}

/**
 * Strength 0..1 of the reveal effect. Jumps to 1 when the window turns from
 * compact to expanded (the device was just unfolded), then clears: along the
 * hinge angle where a sensor exists, and never slower than the time ramp.
 */
@Composable
fun rememberUnfoldReveal(expanded: Boolean, reduce: Boolean): State<Float> {
    val hinge by rememberHingeAngle()
    val ramp = remember { Animatable(0f) }
    var lastExpanded by rememberSaveable { mutableStateOf(expanded) }
    LaunchedEffect(expanded, reduce) {
        val unfolded = expanded && !lastExpanded
        lastExpanded = expanded
        if (reduce || !expanded) {
            ramp.snapTo(0f)
            return@LaunchedEffect
        }
        if (unfolded) {
            ramp.snapTo(1f)
            ramp.animateTo(0f, tween(REVEAL_MS, easing = LinearEasing))
        }
    }
    // The sensor reports in steps; a stiff spring keeps the reveal fluid.
    val fromHinge by animateFloatAsState(
        targetValue = hinge?.let { smoothstep((165f - it) / 75f) } ?: 1f,
        animationSpec = spring(stiffness = 900f),
        label = "hinge_reveal",
    )
    return remember { derivedStateOf { minOf(smoothstep(ramp.value), fromHinge) } }
}

private const val REVEAL_SHADER = """
uniform shader content;
uniform float hingeX;
uniform float strength;
uniform float maxRadius;

half4 main(float2 p) {
    // 0 at the hinge, 1 at the outer left edge; nothing right of the hinge.
    float edge = clamp((hingeX - p.x) / max(hingeX, 1.0), 0.0, 1.0);
    float blurAmount = pow(edge, 1.35);
    float darkAmount = pow(clamp((edge - 0.2) / 0.8, 0.0, 1.0), 1.35);
    float radius = maxRadius * strength * blurAmount;
    half4 color;
    if (radius < 0.5) {
        color = content.eval(p);
    } else {
        color = half4(0.0);
        for (int y = -2; y <= 2; y++) {
            for (int x = -2; x <= 2; x++) {
                float wx = x == 0 ? 6.0 : (x == 1 || x == -1 ? 4.0 : 1.0);
                float wy = y == 0 ? 6.0 : (y == 1 || y == -1 ? 4.0 : 1.0);
                color += content.eval(p + float2(float(x), float(y)) * radius * 0.5) * (wx * wy / 256.0);
            }
        }
    }
    float dark = min(1.0, strength * darkAmount * 2.0);
    return half4(color.rgb * (1.0 - dark), color.a);
}
"""

/**
 * Applies the reveal to everything the modifier wraps. `hingeX` is in pixels
 * of this layer. Android 13+ gets the graded blur; older versions keep the
 * graded darkening only.
 */
fun Modifier.hingeReveal(strength: () -> Float, hingeX: () -> Float): Modifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) composed {
        val shader = remember { RuntimeShader(REVEAL_SHADER) }
        graphicsLayer {
            val s = strength()
            renderEffect = if (s > 0.002f) {
                shader.setFloatUniform("hingeX", hingeX())
                shader.setFloatUniform("strength", s)
                shader.setFloatUniform("maxRadius", MAX_BLUR_DP * density)
                RenderEffect.createRuntimeShaderEffect(shader, "content").asComposeRenderEffect()
            } else {
                null
            }
        }
    } else {
        drawWithContent {
            drawContent()
            val s = strength()
            val hinge = hingeX()
            if (s > 0.002f && hinge > 0f) {
                val dark = (s * 2f).coerceAtMost(1f)
                drawRect(
                    Brush.horizontalGradient(
                        0f to Color.Black.copy(alpha = dark),
                        .8f to Color.Black.copy(alpha = 0f),
                        startX = 0f,
                        endX = hinge,
                    ),
                    size = size.copy(width = hinge),
                    topLeft = Offset.Zero,
                )
            }
        }
    }
