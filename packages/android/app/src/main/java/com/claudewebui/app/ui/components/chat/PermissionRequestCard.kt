package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionRequest
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import kotlinx.coroutines.delay
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// ── Permission Request Card ───────────────────────────────────────────────────

/** Dangerous operations that warrant a red warning treatment */
private val DESTRUCTIVE_PATTERNS = listOf(
    "rm ", "rmdir", "rm -", "sudo rm", "del ", "delete",
    "force", "--force", "-f ", "DROP TABLE", "DROP DATABASE",
    "force-recreate", "git push --force", "git push -f",
    "truncate", "mkfs", "dd if=", "shred",
)

@Composable
fun PermissionRequestCard(
    request: PermissionRequest,
    onAction: (PermissionAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val haptic = LocalHapticFeedback.current
    val toolInfo = ToolIconMapper.forTool(request.toolName)
    val isDestructive = isDestructiveOperation(request)

    // Key the state as well as the coroutine to the request. A new approval
    // must never inherit the previous card's elapsed/expired state.
    var elapsedSeconds by remember(request.requestId) { mutableIntStateOf(0) }

    LaunchedEffect(request.requestId) {
        elapsedSeconds = 0
        repeat(PERMISSION_REQUEST_LIFETIME_SECONDS) {
            delay(1000)
            elapsedSeconds++
        }
    }

    val secondsRemaining = permissionSecondsRemaining(elapsedSeconds)
    val awaitingServer = secondsRemaining == 0
    val timerProgress = secondsRemaining.toFloat() / PERMISSION_REQUEST_LIFETIME_SECONDS
    val timerColor by animateColorAsState(
        targetValue = when {
            timerProgress > 0.5f -> Color(0xFF22C55E)
            timerProgress > 0.25f -> Color(0xFFF59E0B)
            else -> Color(0xFFEF4444)
        },
        animationSpec = tween(componentTokens.motion.slow),
        label = "timerColor",
    )

    val cardBorderColor = if (isDestructive) {
        Color(0xFFEF4444).copy(alpha = 0.4f)
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }
    val cardBgColor = if (isDestructive) {
        Color(0xFFEF4444).copy(alpha = 0.04f)
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = cardBorderColor,
                shape = RoundedCornerShape(componentTokens.radius.md),
            ),
        shape = RoundedCornerShape(componentTokens.radius.md),
        color = cardBgColor,
    ) {
        Column(modifier = Modifier.padding(componentTokens.spacing.cozy)) {

            // ── Top: permission type header ───────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            ) {
                // Permission icon (lock with exclamation for destructive)
                Box(
                    modifier = Modifier
                        .size(componentTokens.spacing.xxl)
                        .background(
                            color = if (isDestructive)
                                Color(0xFFEF4444).copy(alpha = 0.12f)
                            else
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                            shape = RoundedCornerShape(componentTokens.radius.sm),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = if (isDestructive) Icons.Outlined.Warning else Icons.Outlined.Lock,
                        contentDescription = null,
                        tint = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(componentTokens.sizing.iconSm),
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (isDestructive) stringResource(R.string.component_permission_required_destructive) else stringResource(R.string.component_permission_required),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = stringResource(R.string.component_the_active_agent_wants_to_use_a_tool),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                    )
                }

                // Countdown chip
                if (!awaitingServer) {
                    CountdownChip(
                        seconds = secondsRemaining,
                        color = timerColor,
                        progress = timerProgress,
                    )
                } else {
                    AwaitingServerChip()
                }
            }

            Spacer(modifier = Modifier.height(componentTokens.spacing.md))

            // ── Tool info row ─────────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        color = MaterialTheme.colorScheme.surfaceContainerHighest,
                        shape = RoundedCornerShape(componentTokens.radius.sm),
                    )
                    .padding(componentTokens.spacing.compact),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.compact),
            ) {
                Icon(
                    imageVector = toolInfo.icon,
                    contentDescription = null,
                    tint = toolInfo.color,
                    modifier = Modifier.size(componentTokens.sizing.iconInline),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = toolInfo.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = request.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 16.sp,
                    )
                }
            }

            // ── Command / path preview ────────────────────────────────────────
            extractCommandPreview(request)?.let { preview ->
                Spacer(modifier = Modifier.height(componentTokens.spacing.sm))
                CommandPreview(
                    text = preview,
                    isDestructive = isDestructive,
                )
            }

            Spacer(modifier = Modifier.height(componentTokens.spacing.cozy))

            // ── Action buttons ────────────────────────────────────────────────
            // The backend is authoritative. Keep the controls usable after the
            // local countdown: transport latency must not disable a request
            // that the server still accepts.
            PermissionActions(
                isDestructive = isDestructive,
                onAllow = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAction(PermissionAction.ALLOW_ONCE)
                },
                onAllowAlways = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAction(PermissionAction.ALLOW_PROJECT)
                },
                onDeny = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAction(PermissionAction.DENY)
                },
            )

            // ── Timer progress bar ────────────────────────────────────────────
            if (!awaitingServer) {
                Spacer(modifier = Modifier.height(componentTokens.spacing.compact))
                LinearProgressIndicator(
                    progress = { timerProgress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(componentTokens.spacing.xxs)
                        .clip(RoundedCornerShape(1.dp)),
                    color = timerColor,
                    trackColor = timerColor.copy(alpha = 0.15f),
                )
            }
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@Composable
private fun CountdownChip(seconds: Int, color: Color, progress: Float) {
    val componentTokens = PlumTheme.tokens
    Surface(
        shape = RoundedCornerShape(componentTokens.radius.panel),
        color = color.copy(alpha = 0.12f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = componentTokens.spacing.sm, vertical = componentTokens.spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
        ) {
            Icon(
                imageVector = Icons.Outlined.Timer,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(componentTokens.spacing.md),
            )
            Text(
                text = stringResource(R.string.component_seconds, seconds),
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun AwaitingServerChip() {
    val componentTokens = PlumTheme.tokens
    Surface(
        shape = RoundedCornerShape(componentTokens.radius.panel),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
    ) {
        Text(
            text = stringResource(R.string.component_checking),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = componentTokens.spacing.sm, vertical = componentTokens.spacing.xs),
        )
    }
}

@Composable
private fun CommandPreview(text: String, isDestructive: Boolean) {
    val componentTokens = PlumTheme.tokens
    val bgColor = if (isDestructive) Color(0xFFEF4444).copy(alpha = 0.06f)
    else MaterialTheme.colorScheme.surfaceContainerHighest
    val borderColor = if (isDestructive) Color(0xFFEF4444).copy(alpha = 0.2f)
    else MaterialTheme.colorScheme.outlineVariant

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(color = bgColor, shape = RoundedCornerShape(componentTokens.spacing.inline))
            .border(width = 0.5.dp, color = borderColor, shape = RoundedCornerShape(componentTokens.spacing.inline))
            .padding(horizontal = componentTokens.spacing.compact, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
    ) {
        Icon(
            imageVector = Icons.Outlined.Terminal,
            contentDescription = null,
            tint = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(13.dp),
        )
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall.copy(
                fontFamily = JetBrainsMonoFamily,
                fontSize = 11.sp,
            ),
            color = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurface,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun PermissionActions(
    isDestructive: Boolean,
    onAllow: () -> Unit,
    onAllowAlways: () -> Unit,
    onDeny: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
    ) {
        // Deny button — always first, muted
        OutlinedButton(
            onClick = onDeny,
            modifier = Modifier.weight(1f).testTag("permission-action-deny"),
            contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        ) {
            Icon(
                imageVector = Icons.Outlined.Block,
                contentDescription = null,
                modifier = Modifier.size(componentTokens.sizing.iconXs),
            )
            Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
            Text(
                text = stringResource(R.string.component_deny),
                style = MaterialTheme.typography.labelMedium,
            )
        }

        // Allow once button
        FilledTonalButton(
            onClick = onAllow,
            modifier = Modifier.weight(1f).testTag("permission-action-allow_once"),
            contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = if (isDestructive)
                    Color(0xFFEF4444).copy(alpha = 0.15f)
                else
                    MaterialTheme.colorScheme.secondaryContainer,
                contentColor = if (isDestructive)
                    Color(0xFFEF4444)
                else
                    MaterialTheme.colorScheme.onSecondaryContainer,
            ),
        ) {
            Icon(
                imageVector = Icons.Outlined.Check,
                contentDescription = null,
                modifier = Modifier.size(componentTokens.sizing.iconXs),
            )
            Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
            Text(
                text = stringResource(R.string.component_allow),
                style = MaterialTheme.typography.labelMedium,
            )
        }

        // Allow always button — only for non-destructive (too risky otherwise)
        if (!isDestructive) {
            FilledTonalButton(
                onClick = onAllowAlways,
                modifier = Modifier.weight(1.3f).testTag("permission-action-allow_project"),
                contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                colors = ButtonDefaults.filledTonalButtonColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f),
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            ) {
                Icon(
                    imageVector = Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(componentTokens.sizing.iconXs),
                )
                Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
                Text(
                    text = stringResource(R.string.component_allow_always),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun isDestructiveOperation(request: PermissionRequest): Boolean {
    val description = request.description.lowercase()
    val inputStr = request.toolInput?.toString()?.lowercase() ?: ""
    return DESTRUCTIVE_PATTERNS.any { pattern ->
        description.contains(pattern.lowercase()) || inputStr.contains(pattern.lowercase())
    }
}

private fun extractCommandPreview(request: PermissionRequest): String? {
    val input = request.toolInput ?: return null
    return try {
        val obj = input.jsonObject
        obj["command"]?.jsonPrimitive?.content
            ?: obj["file_path"]?.jsonPrimitive?.content
            ?: obj["pattern"]?.jsonPrimitive?.content
            ?: obj["url"]?.jsonPrimitive?.content
    } catch (_: Exception) { null }
}
