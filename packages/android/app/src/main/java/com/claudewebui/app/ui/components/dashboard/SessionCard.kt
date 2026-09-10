package com.claudewebui.app.ui.components.dashboard

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileMove
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.BadgeSize
import com.claudewebui.app.ui.components.common.ProviderBadge
import com.claudewebui.app.ui.components.common.StatusDot
import com.claudewebui.app.ui.components.common.SessionStatus as UiSessionStatus
import com.claudewebui.app.ui.theme.CliProvider
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import com.claudewebui.app.ui.components.common.PlumGreen

// ── Public API ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SessionCard(
    session: Session,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    onArchive: () -> Unit,
    onRename: () -> Unit,
    onDuplicate: () -> Unit,
    onMoveToCategory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showContextMenu by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> {
                    onArchive()
                    false // don't auto-dismiss, let the caller animate out
                }
                SwipeToDismissBoxValue.EndToStart -> {
                    showDeleteConfirm = true
                    false // show confirm dialog instead
                }
                SwipeToDismissBoxValue.Settled -> false
            }
        },
        positionalThreshold = { it * 0.35f },
    )

    // Reset dismiss state if dialog was cancelled
    LaunchedEffect(showDeleteConfirm) {
        if (!showDeleteConfirm) {
            dismissState.reset()
        }
    }

    if (showDeleteConfirm) {
        DeleteConfirmDialog(
            sessionName = session.name,
            onConfirm = {
                showDeleteConfirm = false
                onDelete()
            },
            onDismiss = {
                showDeleteConfirm = false
            }
        )
    }

    SwipeToDismissBox(
        state = dismissState,
        modifier = modifier,
        backgroundContent = {
            SwipeBackground(dismissState.dismissDirection)
        },
        enableDismissFromStartToEnd = true,
        enableDismissFromEndToStart = true,
    ) {
        Box {
            SessionCardContent(
                session = session,
                onClick = onClick,
                onLongClick = { showContextMenu = true },
            )

            DropdownMenu(
                expanded = showContextMenu,
                onDismissRequest = { showContextMenu = false },
            ) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.component_rename)) },
                    leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                    onClick = { showContextMenu = false; onRename() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.component_duplicate)) },
                    leadingIcon = { Icon(Icons.Default.ContentCopy, contentDescription = null) },
                    onClick = { showContextMenu = false; onDuplicate() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.component_move_to_category)) },
                    leadingIcon = { Icon(Icons.Default.DriveFileMove, contentDescription = null) },
                    onClick = { showContextMenu = false; onMoveToCategory() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.component_archive)) },
                    leadingIcon = { Icon(Icons.Default.Archive, contentDescription = null) },
                    onClick = { showContextMenu = false; onArchive() },
                )
                DropdownMenuItem(
                    text = {
                        Text(
                            text = stringResource(R.string.component_delete),
                            color = MaterialTheme.colorScheme.error,
                        )
                    },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                        )
                    },
                    onClick = { showContextMenu = false; showDeleteConfirm = true },
                )
            }
        }
    }
}

// ── Card Content ──────────────────────────────────────────────────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SessionCardContent(
    session: Session,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val isDark = isSystemInDarkTheme()
    val isRunning = session.status == SessionStatus.RUNNING

    val containerColor by animateColorAsState(
        targetValue = if (isRunning) {
            if (isDark) Color(0xFF1A2A1A) else Color(0xFFF0FDF4)
        } else {
            MaterialTheme.colorScheme.surface
        },
        animationSpec = tween(componentTokens.motion.slow),
        label = "cardColor",
    )

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.lg))
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick,
            ),
        shape = RoundedCornerShape(componentTokens.radius.lg),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.lg, vertical = componentTokens.spacing.cozy),
        ) {
            // ── Top Row: Status dot + Title + Badge ──────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StatusDot(
                    status = session.status.toUiStatus(),
                    size = 9.dp,
                )
                Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
                Text(
                    text = session.name,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
                ProviderBadge(
                    provider = session.cliProvider.toCliProvider(),
                    size = BadgeSize.SMALL,
                    showLabel = false,
                )
            }

            // ── Last message preview ─────────────────────────────────────────
            if (!session.lastMessage.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(componentTokens.spacing.inline))
                Text(
                    text = session.lastMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 17.dp), // align with title
                )
            }

            // ── Bottom Row: timestamp + running indicator ─────────────────────
            Spacer(modifier = Modifier.height(componentTokens.spacing.sm))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 17.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = relativeTime(session.updatedAt, androidx.compose.ui.platform.LocalContext.current),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (isRunning) {
                    RunningPill()
                }
            }
        }
    }
}

// ── Running Pill ──────────────────────────────────────────────────────────────

@Composable
private fun RunningPill() {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = Modifier
            .background(
                color = PlumGreen.copy(alpha = 0.12f),
                shape = RoundedCornerShape(50),
            )
            .padding(horizontal = componentTokens.spacing.sm, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
    ) {
        StatusDot(status = UiSessionStatus.RUNNING, size = componentTokens.spacing.inline)
        Text(
            text = stringResource(R.string.component_running),
            style = MaterialTheme.typography.labelSmall,
            color = PlumGreen,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Swipe Background ──────────────────────────────────────────────────────────

@Composable
private fun SwipeBackground(direction: SwipeToDismissBoxValue) {
    val componentTokens = PlumTheme.tokens
    val archiveColor = MaterialTheme.colorScheme.secondaryContainer
    val deleteColor = MaterialTheme.colorScheme.errorContainer

    val (backgroundColor, icon, iconTint, alignment) = when (direction) {
        SwipeToDismissBoxValue.StartToEnd -> SwipeBgParams(
            bg = archiveColor,
            icon = Icons.Default.Archive,
            tint = MaterialTheme.colorScheme.onSecondaryContainer,
            align = Alignment.CenterStart,
        )
        SwipeToDismissBoxValue.EndToStart -> SwipeBgParams(
            bg = deleteColor,
            icon = Icons.Default.Delete,
            tint = MaterialTheme.colorScheme.onErrorContainer,
            align = Alignment.CenterEnd,
        )
        SwipeToDismissBoxValue.Settled -> SwipeBgParams(
            bg = Color.Transparent,
            icon = Icons.Default.Delete,
            tint = Color.Transparent,
            align = Alignment.CenterEnd,
        )
    }

    val iconScale by animateFloatAsState(
        targetValue = if (direction == SwipeToDismissBoxValue.Settled) 0.7f else 1f,
        animationSpec = tween(componentTokens.motion.medium),
        label = "swipeIconScale",
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(componentTokens.radius.lg))
            .background(backgroundColor)
            .padding(horizontal = componentTokens.spacing.section),
        contentAlignment = alignment,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = iconTint,
            modifier = Modifier
                .size(componentTokens.sizing.iconLg)
                .scale(iconScale),
        )
    }
}

private data class SwipeBgParams(
    val bg: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val tint: Color,
    val align: Alignment,
)

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

@Composable
private fun DeleteConfirmDialog(
    sessionName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.component_delete_session)) },
        text = {
            Text(
                text = stringResource(R.string.component_delete_session_body, sessionName),
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = onConfirm,
            ) {
                Text(
                    text = stringResource(R.string.component_delete),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.component_cancel))
            }
        },
    )
}

// ── Skeleton Card ─────────────────────────────────────────────────────────────

@Composable
fun SessionCardSkeleton(modifier: Modifier = Modifier) {
    val componentTokens = PlumTheme.tokens
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(componentTokens.radius.lg),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.lg, vertical = componentTokens.spacing.cozy),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            ) {
                ShimmerBox(width = 9.dp, height = 9.dp, roundedPercent = 50)
                ShimmerBox(width = 160.dp, height = componentTokens.spacing.cozy, roundedPercent = 4)
                Spacer(modifier = Modifier.weight(1f))
                ShimmerBox(width = 48.dp, height = 22.dp, roundedPercent = 4)
            }
            Spacer(modifier = Modifier.height(componentTokens.spacing.sm))
            ShimmerBox(modifier = Modifier.padding(start = 17.dp), width = 240.dp, height = 11.dp, roundedPercent = 4)
            Spacer(modifier = Modifier.height(5.dp))
            ShimmerBox(modifier = Modifier.padding(start = 17.dp), width = 180.dp, height = 11.dp, roundedPercent = 4)
            Spacer(modifier = Modifier.height(componentTokens.spacing.sm))
            ShimmerBox(modifier = Modifier.padding(start = 17.dp), width = 80.dp, height = componentTokens.spacing.compact, roundedPercent = 4)
        }
    }
}

@Composable
private fun ShimmerBox(
    width: androidx.compose.ui.unit.Dp,
    height: androidx.compose.ui.unit.Dp,
    roundedPercent: Int,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(width = width, height = height)
            .clip(RoundedCornerShape(roundedPercent))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun SessionStatus.toUiStatus(): UiSessionStatus = when (this) {
    SessionStatus.RUNNING -> UiSessionStatus.RUNNING
    SessionStatus.STOPPED -> UiSessionStatus.STOPPED
    SessionStatus.ERROR   -> UiSessionStatus.ERROR
}

private fun CLIProvider.toCliProvider(): CliProvider = when (this) {
    CLIProvider.CLAUDE -> CliProvider.CLAUDE
    CLIProvider.CODEX  -> CliProvider.CODEX
    CLIProvider.OPENCODE -> CliProvider.OPENCODE
    CLIProvider.PI -> CliProvider.PI
    CLIProvider.KIMI -> CliProvider.KIMI
    CLIProvider.ZAI -> CliProvider.ZAI
}

private fun relativeTime(isoTimestamp: String, context: android.content.Context): String {
    return try {
        val instant = Instant.parse(isoTimestamp)
        val now = Instant.now()
        val seconds = ChronoUnit.SECONDS.between(instant, now)
        val minutes = seconds / 60
        val hours = minutes / 60
        val days = hours / 24

        when {
            seconds < 60   -> context.getString(R.string.component_just_now)
            minutes < 60   -> context.getString(R.string.component_minutes_ago, minutes)
            hours < 24     -> context.getString(R.string.component_hours_ago, hours)
            days == 1L     -> context.getString(R.string.component_yesterday)
            days < 7       -> context.getString(R.string.component_days_ago, days)
            else -> {
                val local = instant.atZone(ZoneId.systemDefault()).toLocalDate()
                java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM).format(local)
            }
        }
    } catch (_: Exception) {
        ""
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

@Preview(showBackground = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun SessionCardPreview() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme {
        Column(
            modifier = Modifier.padding(componentTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.md),
        ) {
            SessionCard(
                session = Session(
                    id = "1",
                    userId = "u1",
                    name = "Build Android Dashboard",
                    workingDirectory = "/home/user/project",
                    status = SessionStatus.RUNNING,
                    lastMessage = "Creating the DashboardScreen composable with Material 3 components...",
                    cliProvider = CLIProvider.CODEX,
                    createdAt = "2024-01-15T10:00:00Z",
                    updatedAt = "2024-01-15T10:05:00Z",
                ),
                onClick = {},
                onDelete = {},
                onArchive = {},
                onRename = {},
                onDuplicate = {},
                onMoveToCategory = {},
            )
            SessionCard(
                session = Session(
                    id = "2",
                    userId = "u1",
                    name = "API Integration Tests",
                    workingDirectory = "/home/user/api",
                    status = SessionStatus.STOPPED,
                    lastMessage = "All tests passing. 47/47 green.",
                    cliProvider = CLIProvider.CODEX,
                    createdAt = "2024-01-14T08:00:00Z",
                    updatedAt = "2024-01-14T09:30:00Z",
                ),
                onClick = {},
                onDelete = {},
                onArchive = {},
                onRename = {},
                onDuplicate = {},
                onMoveToCategory = {},
            )
            SessionCardSkeleton()
        }
    }
}
