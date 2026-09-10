package com.claudewebui.app.ui.components.common

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.theme.ClaudeWebUITheme

// ── LoadingIndicator ─────────────────────────────────────────────────────────

@Composable
fun LoadingIndicator(
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    strokeWidth: Dp = 3.dp,
    message: String? = null,
) {
    val componentTokens = PlumTheme.tokens
    val infiniteTransition = if (PlumTheme.tokens.motion.reduceMotion) null else rememberInfiniteTransition(label = "loading")
    val rotation by infiniteTransition?.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "rotation",
    ) ?: androidx.compose.runtime.rememberUpdatedState(0f)

    val accent = PlumAccent
    val trackColor = accent.copy(alpha = 0.12f)
    val gradientBrush = Brush.sweepGradient(
        0f to accent.copy(alpha = 0f),
        0.6f to accent,
        1f to PlumBlue,
    )

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.md),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(size)) {
                // Background track
                drawCircle(
                    color = trackColor,
                    radius = (this.size.minDimension - strokeWidth.toPx()) / 2f,
                    style = Stroke(width = strokeWidth.toPx()),
                )

                // Spinning arc with gradient
                rotate(rotation) {
                    drawArc(
                        brush = gradientBrush,
                        startAngle = 0f,
                        sweepAngle = 270f,
                        useCenter = false,
                        topLeft = Offset(strokeWidth.toPx() / 2f, strokeWidth.toPx() / 2f),
                        size = androidx.compose.ui.geometry.Size(
                            this.size.width - strokeWidth.toPx(),
                            this.size.height - strokeWidth.toPx(),
                        ),
                        style = Stroke(
                            width = strokeWidth.toPx(),
                            cap = StrokeCap.Round,
                        ),
                    )
                }
            }
        }

        if (message != null) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Compact variant for inline use ───────────────────────────────────────────

@Composable
fun LoadingIndicatorSmall(
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    LoadingIndicator(
        modifier = modifier,
        size = componentTokens.spacing.section,
        strokeWidth = componentTokens.spacing.xxs,
    )
}

// ── Previews ─────────────────────────────────────────────────────────────────

@Preview(showBackground = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun LoadingIndicatorPreview() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xl),
        ) {
            LoadingIndicator(message = "Loading sessions...")
            LoadingIndicator(size = componentTokens.spacing.xl, strokeWidth = componentTokens.spacing.xxs)
            LoadingIndicatorSmall()
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFF141413)
@Composable
private fun LoadingIndicatorDarkPreview() {
    ClaudeWebUITheme(darkTheme = true) {
        LoadingIndicator(message = "Connecting...")
    }
}
