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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.theme.ClaudeWebUITheme

// ── Status ───────────────────────────────────────────────────────────────────

enum class SessionStatus {
    RUNNING,
    STOPPED,
    ERROR,
    IDLE,
}

// ── StatusDot Composable ─────────────────────────────────────────────────────

@Composable
fun StatusDot(
    status: SessionStatus,
    modifier: Modifier = Modifier,
    size: Dp = 10.dp,
) {
    val baseColor = when (status) {
        SessionStatus.RUNNING -> PlumGreen
        SessionStatus.STOPPED -> Color(0xFF9CA3AF)
        SessionStatus.ERROR -> PlumRed
        SessionStatus.IDLE -> Color(0xFFD4D3CE)
    }

    if (status == SessionStatus.RUNNING) {
        AnimatedStatusDot(color = baseColor, size = size, modifier = modifier)
    } else {
        StaticStatusDot(color = baseColor, size = size, modifier = modifier)
    }
}

// ── Static Dot ───────────────────────────────────────────────────────────────

@Composable
private fun StaticStatusDot(
    color: Color,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.size(size)) {
        drawCircle(
            color = color,
            radius = this.size.minDimension / 2f,
            center = Offset(this.size.width / 2f, this.size.height / 2f),
        )
    }
}

// ── Animated Pulse Dot ───────────────────────────────────────────────────────

@Composable
private fun AnimatedStatusDot(
    color: Color,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = if (PlumTheme.tokens.motion.reduceMotion) null else rememberInfiniteTransition(label = "statusPulse")
    val pulseScale by infiniteTransition?.animateFloat(
        initialValue = 1f,
        targetValue = 2.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pulseScale",
    ) ?: androidx.compose.runtime.rememberUpdatedState(1f)
    val pulseAlpha by infiniteTransition?.animateFloat(
        initialValue = 0.5f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pulseAlpha",
    ) ?: androidx.compose.runtime.rememberUpdatedState(0.5f)

    Canvas(modifier = modifier.size(size * 2.5f)) {
        val center = Offset(this.size.width / 2f, this.size.height / 2f)
        val baseRadius = this.size.minDimension / 5f

        // Pulse ring
        drawCircle(
            color = color.copy(alpha = pulseAlpha),
            radius = baseRadius * pulseScale,
            center = center,
        )

        // Solid core
        drawCircle(
            color = color,
            radius = baseRadius,
            center = center,
        )
    }
}

// ── Previews ─────────────────────────────────────────────────────────────────

@Preview(showBackground = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun StatusDotPreview() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme {
        Row(
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusDot(status = SessionStatus.RUNNING)
            StatusDot(status = SessionStatus.STOPPED)
            StatusDot(status = SessionStatus.ERROR)
            StatusDot(status = SessionStatus.IDLE)
        }
    }
}
