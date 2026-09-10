package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ThinkingIndicator(
    isThinking: Boolean,
    toolName: String? = null,
    thinkingStartTime: Long = 0L,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    AnimatedVisibility(
        visible = isThinking || toolName != null,
        enter = fadeIn() + slideInVertically(initialOffsetY = { it / 2 }),
        exit = fadeOut() + slideOutVertically(targetOffsetY = { it / 2 }),
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier
                .padding(start = componentTokens.spacing.lg, end = componentTokens.spacing.lg, bottom = componentTokens.spacing.sm)
                .wrapContentWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.compact),
        ) {
            // Avatar placeholder matching assistant bubble style
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.size(28.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = "✦",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 12.sp,
                    )
                }
            }

            // Bubble content
            Surface(
                shape = RoundedCornerShape(
                    topStart = componentTokens.spacing.xs, topEnd = componentTokens.spacing.lg, bottomEnd = componentTokens.spacing.lg, bottomStart = componentTokens.spacing.lg
                ),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                tonalElevation = 1.dp,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = componentTokens.spacing.cozy, vertical = componentTokens.spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                ) {
                    if (toolName != null) {
                        // Tool executing state. A long-running tool call is
                        // exactly where a missing timer reads as a hang, so it
                        // gets the same elapsed counter as thinking.
                        PulsingDots(color = MaterialTheme.colorScheme.tertiary)
                        ElapsedTime(
                            startTime = thinkingStartTime,
                            prefix = formatToolLabel(toolName).removeSuffix("…"),
                        )
                    } else {
                        // Thinking state
                        PulsingDots(color = MaterialTheme.colorScheme.primary)
                        ElapsedTime(
                            startTime = thinkingStartTime,
                            prefix = stringResource(R.string.component_thinking),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PulsingDots(
    color: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val infiniteTransition = if (PlumTheme.tokens.motion.reduceMotion) null else rememberInfiniteTransition(label = "dots")

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(3) { index ->
            val scale by infiniteTransition?.animateFloat(
                initialValue = 0.6f,
                targetValue = 1.0f,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = 600,
                        easing = FastOutSlowInEasing,
                        delayMillis = index * 120,
                    ),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "dot_scale_$index",
            ) ?: androidx.compose.runtime.rememberUpdatedState(0.6f)
            Surface(
                shape = CircleShape,
                color = color,
                modifier = Modifier
                    .size(componentTokens.spacing.inline)
                    .scale(scale),
            ) {}
        }
    }
}

@Composable
private fun ElapsedTime(
    startTime: Long,
    prefix: String,
    modifier: Modifier = Modifier,
) {
    var elapsed by remember { mutableStateOf(0L) }

    LaunchedEffect(startTime) {
        if (startTime > 0) {
            while (true) {
                elapsed = (System.currentTimeMillis() - startTime) / 1000
                kotlinx.coroutines.delay(1000)
            }
        }
    }

    Text(
        text = if (elapsed > 0) stringResource(R.string.component_elapsed_thinking, prefix, elapsed) else "$prefix…",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 13.sp,
        modifier = modifier,
    )
}

@Composable

private fun formatToolLabel(toolName: String): String = when (toolName.lowercase()) {
    "read" -> stringResource(R.string.component_reading_file)
    "write" -> stringResource(R.string.component_writing_file)
    "edit" -> stringResource(R.string.component_editing_file)
    "bash" -> stringResource(R.string.component_running_command)
    "glob" -> stringResource(R.string.component_searching_files)
    "grep" -> stringResource(R.string.component_searching_content)
    "agent" -> stringResource(R.string.component_running_agent)
    "todowrite" -> stringResource(R.string.component_updating_todos)
    "websearch" -> stringResource(R.string.component_searching_web)
    "webfetch" -> stringResource(R.string.component_fetching_url)
    else -> stringResource(R.string.component_using_tool, toolName)
}
