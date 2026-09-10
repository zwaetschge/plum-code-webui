package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.*
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import kotlinx.serialization.json.*

@Composable
fun ToolExecutionCard(
    tool: ToolExecution,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = false,
) {
    val componentTokens = PlumTheme.tokens
    var expanded by remember(tool.toolId) {
        mutableStateOf(initiallyExpanded || tool.status == ToolStatus.STARTED)
    }

    val chevronAngle by animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        animationSpec = tween(componentTokens.motion.medium),
        label = "chevron",
    )

    val toolConfig = toolConfig(tool.toolName)
    val statusColor = statusColor(tool.status)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .animateContentSize(animationSpec = componentTokens.motion.tweenMedium()),
        shape = RoundedCornerShape(componentTokens.radius.sm),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 0.dp,
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = statusColor.copy(alpha = 0.3f),
        ),
    ) {
        Column {
            // Header row — always visible
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.compact),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            ) {
                // Tool icon
                Icon(
                    imageVector = toolConfig.icon,
                    contentDescription = tool.toolName,
                    tint = toolConfig.color,
                    modifier = Modifier.size(componentTokens.sizing.iconSm),
                )

                // Tool name
                Text(
                    text = toolConfig.label,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )

                // File path or command preview (if available)
                toolConfig.extractPreview(tool)?.let { preview ->
                    Text(
                        text = preview,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        modifier = Modifier.weight(2f),
                        fontFamily = JetBrainsMonoFamily,
                        fontSize = 11.sp,
                    )
                }

                // Status indicator
                StatusBadge(status = tool.status, color = statusColor)

                // Expand/collapse icon
                Icon(
                    imageVector = Icons.Filled.KeyboardArrowDown,
                    contentDescription = if (expanded) stringResource(R.string.component_collapse) else stringResource(R.string.component_expand),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .size(componentTokens.sizing.iconSm)
                        .rotate(chevronAngle),
                )
            }

            // Expanded content
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            color = MaterialTheme.colorScheme.surfaceContainerHighest,
                            shape = RoundedCornerShape(bottomStart = componentTokens.spacing.sm, bottomEnd = componentTokens.spacing.sm),
                        )
                ) {
                    // Divider
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        thickness = 0.5.dp,
                    )

                    // Input section
                    tool.input?.let { input ->
                        ExpandedSection(
                            label = stringResource(R.string.component_input),
                            content = formatJson(input),
                            isCode = true,
                        )
                    }

                    // Result section
                    tool.result?.let { result ->
                        if (result.isNotBlank()) {
                            ExpandedSection(
                                label = stringResource(R.string.component_output),
                                content = result,
                                isCode = true,
                                isSuccess = true,
                            )
                        }
                    }

                    // Error section
                    tool.error?.let { error ->
                        ExpandedSection(
                            label = stringResource(R.string.component_error),
                            content = error,
                            isCode = false,
                            isError = true,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ExpandedSection(
    label: String,
    content: String,
    isCode: Boolean,
    isSuccess: Boolean = false,
    isError: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val textColor = when {
        isError -> MaterialTheme.colorScheme.error
        isSuccess -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
        verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
        )

        val displayContent = content.take(2000).let {
            if (content.length > 2000) stringResource(R.string.component_truncated, it) else it
        }

        Text(
            text = displayContent,
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = if (isCode) JetBrainsMonoFamily else null,
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = textColor,
            ),
        )
    }
}

@Composable
private fun StatusBadge(
    status: ToolStatus,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    when (status) {
        ToolStatus.STARTED -> {
            val infiniteTransition = if (PlumTheme.tokens.motion.reduceMotion) null else rememberInfiniteTransition(label = "spinner")
            val rotation by infiniteTransition?.animateFloat(
                initialValue = 0f,
                targetValue = 360f,
                animationSpec = infiniteRepeatable(
                    animation = tween(800, easing = LinearEasing)
                ),
                label = "rotation",
            ) ?: androidx.compose.runtime.rememberUpdatedState(0f)
            Icon(
                imageVector = Icons.Outlined.Refresh,
                contentDescription = stringResource(R.string.component_running),
                tint = color,
                modifier = modifier
                    .size(componentTokens.sizing.iconXs)
                    .rotate(rotation),
            )
        }
        ToolStatus.COMPLETED -> {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = stringResource(R.string.component_completed),
                tint = color,
                modifier = modifier.size(componentTokens.sizing.iconXs),
            )
        }
        ToolStatus.ERROR -> {
            Icon(
                imageVector = Icons.Filled.Cancel,
                contentDescription = stringResource(R.string.component_error),
                tint = color,
                modifier = modifier.size(componentTokens.sizing.iconXs),
            )
        }
    }
}

// ── Tool Config ───────────────────────────────────────────────────────────────

private data class ToolConfig(
    val label: String,
    val icon: ImageVector,
    val color: Color,
    val extractPreview: (ToolExecution) -> String?,
)

@Composable

private fun toolConfig(toolName: String): ToolConfig {
    val name = toolName.lowercase()
    return when {
        name == "read" -> ToolConfig(
            label = stringResource(R.string.component_read_file),
            icon = Icons.Outlined.Description,
            color = Color(0xFF3B82F6),
            extractPreview = { tool -> extractStringField(tool.input, "file_path") },
        )
        name == "write" -> ToolConfig(
            label = stringResource(R.string.component_write_file),
            icon = Icons.Outlined.Edit,
            color = Color(0xFF22C55E),
            extractPreview = { tool -> extractStringField(tool.input, "file_path") },
        )
        name == "edit" || name == "multiedit" -> ToolConfig(
            label = if (name == "multiedit") stringResource(R.string.component_multi_edit) else stringResource(R.string.component_edit_file),
            icon = Icons.Outlined.DriveFileRenameOutline,
            color = Color(0xFFF59E0B),
            extractPreview = { tool -> extractStringField(tool.input, "file_path") },
        )
        name == "bash" -> ToolConfig(
            label = stringResource(R.string.component_bash),
            icon = Icons.Outlined.Terminal,
            color = Color(0xFF8B5CF6),
            extractPreview = { tool ->
                extractStringField(tool.input, "command")?.take(60)
            },
        )
        name == "glob" -> ToolConfig(
            label = stringResource(R.string.component_find_files),
            icon = Icons.Outlined.FolderOpen,
            color = Color(0xFF06B6D4),
            extractPreview = { tool -> extractStringField(tool.input, "pattern") },
        )
        name == "grep" -> ToolConfig(
            label = stringResource(R.string.component_search),
            icon = Icons.Outlined.Search,
            color = Color(0xFFEC4899),
            extractPreview = { tool -> extractStringField(tool.input, "pattern") },
        )
        name == "agent" || name.contains("agent") -> ToolConfig(
            label = stringResource(R.string.component_agent),
            icon = Icons.Outlined.Psychology,
            color = Color(0xFFCC785C),
            extractPreview = { tool ->
                extractStringField(tool.input, "description")
                    ?: extractStringField(tool.input, "task")
            },
        )
        name == "todowrite" -> ToolConfig(
            label = stringResource(R.string.component_update_todos),
            icon = Icons.Outlined.Checklist,
            color = Color(0xFF10B981),
            extractPreview = { _ -> null },
        )
        name == "websearch" -> ToolConfig(
            label = stringResource(R.string.component_web_search),
            icon = Icons.Outlined.TravelExplore,
            color = Color(0xFF3B82F6),
            extractPreview = { tool -> extractStringField(tool.input, "query") },
        )
        name == "webfetch" -> ToolConfig(
            label = stringResource(R.string.component_fetch_url),
            icon = Icons.Outlined.Language,
            color = Color(0xFF3B82F6),
            extractPreview = { tool -> extractStringField(tool.input, "url") },
        )
        else -> ToolConfig(
            label = toolName,
            icon = Icons.Outlined.Build,
            color = Color(0xFF6B7280),
            extractPreview = { _ -> null },
        )
    }
}

@Composable
private fun statusColor(status: ToolStatus): Color = when (status) {
    ToolStatus.STARTED -> MaterialTheme.colorScheme.tertiary
    ToolStatus.COMPLETED -> Color(0xFF22C55E)
    ToolStatus.ERROR -> MaterialTheme.colorScheme.error
}

// ── JSON Helpers ──────────────────────────────────────────────────────────────

private fun extractStringField(element: kotlinx.serialization.json.JsonElement?, field: String): String? {
    return try {
        element?.jsonObject?.get(field)?.jsonPrimitive?.content
    } catch (_: Exception) { null }
}

private fun formatJson(element: kotlinx.serialization.json.JsonElement): String {
    return try {
        Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), element)
    } catch (_: Exception) {
        element.toString()
    }
}
