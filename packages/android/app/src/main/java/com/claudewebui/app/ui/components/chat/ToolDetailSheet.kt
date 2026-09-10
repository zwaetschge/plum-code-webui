package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ── Tool Detail Bottom Sheet ──────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToolDetailSheet(
    tool: ToolExecution,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val toolInfo = ToolIconMapper.forTool(tool.toolName)
    val isBash = tool.toolName.lowercase() == "bash"
    val isFileOp = tool.toolName.lowercase() in listOf("read", "write", "edit", "multiedit")
    val isAgent = tool.toolName.lowercase().contains("agent")
    val duration = tool.completedAt?.let { it - tool.timestamp }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        dragHandle = {
            Box(
                modifier = Modifier
                    .padding(top = componentTokens.spacing.md, bottom = componentTokens.spacing.sm)
                    .size(width = componentTokens.spacing.xxl, height = componentTokens.spacing.xs)
                    .background(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        shape = RoundedCornerShape(componentTokens.radius.xxs),
                    )
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = componentTokens.spacing.xxl),
        ) {
            // ── Header ────────────────────────────────────────────────────────
            SheetHeader(tool = tool, toolInfo = toolInfo, duration = duration)

            // ── Timestamps ────────────────────────────────────────────────────
            TimestampRow(tool = tool)

            HorizontalDivider(
                modifier = Modifier.padding(horizontal = componentTokens.spacing.lg, vertical = componentTokens.spacing.md),
                color = MaterialTheme.colorScheme.outlineVariant,
                thickness = 0.5.dp,
            )

            // ── Input Section ─────────────────────────────────────────────────
            tool.input?.let { input ->
                when {
                    isBash -> BashInputSection(input = input)
                    isFileOp -> FileInputSection(tool = tool, input = input)
                    isAgent -> AgentInputSection(input = input)
                    else -> GenericInputSection(input = input)
                }
            }

            // ── Output Section ────────────────────────────────────────────────
            tool.result?.let { result ->
                if (result.isNotBlank()) {
                    when {
                        isBash -> BashOutputSection(output = result)
                        isFileOp -> FileOutputSection(tool = tool, output = result)
                        isAgent -> AgentOutputSection(output = result)
                        else -> GenericOutputSection(output = result)
                    }
                }
            }

            // ── Error Section ─────────────────────────────────────────────────
            tool.error?.let { error ->
                if (error.isNotBlank()) {
                    ErrorSection(error = error)
                }
            }
        }
    }
}

// ── Header ────────────────────────────────────────────────────────────────────

@Composable
private fun SheetHeader(
    tool: ToolExecution,
    toolInfo: ToolDisplayInfo,
    duration: Long?,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.section, vertical = componentTokens.spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.md),
    ) {
        // Tool icon with colored background
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(
                    color = toolInfo.color.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(componentTokens.radius.chip),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = toolInfo.icon,
                contentDescription = null,
                tint = toolInfo.color,
                modifier = Modifier.size(22.dp),
            )
        }

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = toolInfo.label,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            duration?.let {
                Text(
                    text = formatDuration(it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        StatusChip(status = tool.status)
    }
}

@Composable
private fun StatusChip(status: ToolStatus) {
    val componentTokens = PlumTheme.tokens
    val (label, color, icon) = when (status) {
        ToolStatus.STARTED -> Triple(
            stringResource(R.string.component_running),
            MaterialTheme.colorScheme.tertiary,
            Icons.Outlined.Refresh,
        )
        ToolStatus.COMPLETED -> Triple(
            stringResource(R.string.component_completed),
            Color(0xFF22C55E),
            Icons.Filled.CheckCircle,
        )
        ToolStatus.ERROR -> Triple(
            stringResource(R.string.component_error),
            MaterialTheme.colorScheme.error,
            Icons.Outlined.ErrorOutline,
        )
    }

    Surface(
        shape = RoundedCornerShape(componentTokens.radius.panel),
        color = color.copy(alpha = 0.12f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = componentTokens.spacing.compact, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(componentTokens.spacing.md),
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun TimestampRow(tool: ToolExecution) {
    val componentTokens = PlumTheme.tokens
    val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.section),
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.lg),
    ) {
        TimestampItem(label = stringResource(R.string.component_started), value = fmt.format(Date(tool.timestamp)))
        tool.completedAt?.let {
            TimestampItem(label = stringResource(R.string.component_completed), value = fmt.format(Date(it)))
        }
    }
}

@Composable
private fun TimestampItem(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            fontSize = 10.sp,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontFamily = JetBrainsMonoFamily,
        )
    }
}

// ── Input Sections ────────────────────────────────────────────────────────────

@Composable
private fun BashInputSection(input: JsonElement) {
    val componentTokens = PlumTheme.tokens
    val command = extractField(input, "command") ?: formatJson(input)
    SectionLabel(stringResource(R.string.component_command))
    TerminalBlock(
        content = command,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
        isOutput = false,
    )
}

@Composable
private fun FileInputSection(tool: ToolExecution, input: JsonElement) {
    val componentTokens = PlumTheme.tokens
    val filePath = extractField(input, "file_path")
    filePath?.let {
        SectionLabel(stringResource(R.string.component_file_path))
        FilePathChip(
            path = it,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.lg)
                .padding(bottom = componentTokens.spacing.md),
        )
    }

    // Show old_string / new_string for edits as diff
    val oldString = extractField(input, "old_string")
    val newString = extractField(input, "new_string")
    if (oldString != null || newString != null) {
        SectionLabel(stringResource(R.string.component_changes))
        DiffView(
            removed = oldString,
            added = newString,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.lg)
                .padding(bottom = componentTokens.spacing.md),
        )
    } else {
        val content = extractField(input, "content") ?: extractField(input, "new_content")
        content?.let {
            SectionLabel(stringResource(R.string.component_content))
            CopyableCodeBlock(
                content = it,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = componentTokens.spacing.lg)
                    .padding(bottom = componentTokens.spacing.md),
            )
        }
    }
}

@Composable
private fun AgentInputSection(input: JsonElement) {
    val componentTokens = PlumTheme.tokens
    val description = extractField(input, "description") ?: extractField(input, "task")
    description?.let {
        SectionLabel(stringResource(R.string.component_task))
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.lg)
                .padding(bottom = componentTokens.spacing.md),
            shape = RoundedCornerShape(componentTokens.radius.sm),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
        ) {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(componentTokens.spacing.md),
                lineHeight = 20.sp,
            )
        }
    }

    val agentType = extractField(input, "agent_type") ?: extractField(input, "type")
    agentType?.let {
        val agentInfo = ToolIconMapper.forAgent(it)
        SectionLabel(stringResource(R.string.component_agent_type))
        Row(
            modifier = Modifier
                .padding(horizontal = componentTokens.spacing.lg)
                .padding(bottom = componentTokens.spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        ) {
            Icon(
                imageVector = agentInfo.icon,
                contentDescription = null,
                tint = agentInfo.color,
                modifier = Modifier.size(componentTokens.sizing.iconInline),
            )
            Text(
                text = agentInfo.label,
                style = MaterialTheme.typography.labelLarge,
                color = agentInfo.color,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun GenericInputSection(input: JsonElement) {
    val componentTokens = PlumTheme.tokens
    SectionLabel(stringResource(R.string.component_input))
    CopyableCodeBlock(
        content = formatJson(input),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
    )
}

// ── Output Sections ───────────────────────────────────────────────────────────

@Composable
private fun BashOutputSection(output: String) {
    val componentTokens = PlumTheme.tokens
    SectionLabel(stringResource(R.string.component_output))
    TerminalBlock(
        content = output,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
        isOutput = true,
    )
}

@Composable
private fun FileOutputSection(tool: ToolExecution, output: String) {
    val componentTokens = PlumTheme.tokens
    if (output.isBlank()) return
    SectionLabel(stringResource(R.string.component_result))
    CopyableCodeBlock(
        content = output.take(4000).let {
            if (output.length > 4000) stringResource(R.string.component_truncated_characters, it, output.length - 4000) else it
        },
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
    )
}

@Composable
private fun AgentOutputSection(output: String) {
    val componentTokens = PlumTheme.tokens
    SectionLabel(stringResource(R.string.component_result_summary))
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
        shape = RoundedCornerShape(componentTokens.radius.sm),
        color = Color(0xFF22C55E).copy(alpha = 0.08f),
        border = androidx.compose.foundation.BorderStroke(
            width = 0.5.dp,
            color = Color(0xFF22C55E).copy(alpha = 0.3f),
        ),
    ) {
        Row(
            modifier = Modifier.padding(componentTokens.spacing.md),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.compact),
        ) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = Color(0xFF22C55E),
                modifier = Modifier
                    .size(componentTokens.sizing.iconSm)
                    .padding(top = componentTokens.spacing.xxs),
            )
            Text(
                text = output.take(2000),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = 18.sp,
            )
        }
    }
}

@Composable
private fun GenericOutputSection(output: String) {
    val componentTokens = PlumTheme.tokens
    SectionLabel(stringResource(R.string.component_output))
    CopyableCodeBlock(
        content = output.take(4000).let {
            if (output.length > 4000) stringResource(R.string.component_truncated_characters, it, output.length - 4000) else it
        },
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
    )
}

@Composable
private fun ErrorSection(error: String) {
    val componentTokens = PlumTheme.tokens
    SectionLabel(stringResource(R.string.component_error))
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.lg)
            .padding(bottom = componentTokens.spacing.md),
        shape = RoundedCornerShape(componentTokens.radius.sm),
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
    ) {
        Row(
            modifier = Modifier.padding(componentTokens.spacing.md),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        ) {
            Icon(
                imageVector = Icons.Outlined.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(componentTokens.sizing.iconSm),
            )
            Text(
                text = error,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
                fontFamily = JetBrainsMonoFamily,
                lineHeight = 18.sp,
            )
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(label: String) {
    val componentTokens = PlumTheme.tokens
    Text(
        text = label.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .padding(horizontal = componentTokens.spacing.section)
            .padding(bottom = componentTokens.spacing.inline),
        letterSpacing = 1.sp,
    )
}

@Composable
private fun FilePathChip(path: String, modifier: Modifier = Modifier) {
    val componentTokens = PlumTheme.tokens
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(componentTokens.spacing.inline),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = androidx.compose.foundation.BorderStroke(
            0.5.dp, MaterialTheme.colorScheme.outlineVariant
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.compact, vertical = componentTokens.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        ) {
            Icon(
                imageVector = Icons.Outlined.FolderOpen,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(componentTokens.sizing.iconXs),
            )
            Text(
                text = path,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontFamily = JetBrainsMonoFamily,
                fontSize = 12.sp,
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(rememberScrollState()),
                maxLines = 1,
            )
            IconButton(
                onClick = {
                    clipboard.setText(AnnotatedString(path))
                    copied = true
                },
                modifier = Modifier.size(componentTokens.sizing.touchTarget),
            ) {
                Icon(
                    imageVector = if (copied) Icons.Outlined.CheckCircle else Icons.Outlined.ContentCopy,
                    contentDescription = stringResource(R.string.component_copy_path),
                    tint = if (copied) Color(0xFF22C55E) else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(componentTokens.sizing.iconXs),
                )
            }
        }
    }

    LaunchedEffect(copied) {
        if (copied) {
            kotlinx.coroutines.delay(2000)
            copied = false
        }
    }
}

@Composable
private fun TerminalBlock(
    content: String,
    isOutput: Boolean,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    val displayContent = content.take(4000).let {
        if (content.length > 4000) stringResource(R.string.component_truncated, it) else it
    }

    Column(modifier = modifier) {
        // Terminal chrome bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = Color(0xFF1A1A1A),
                    shape = RoundedCornerShape(topStart = componentTokens.spacing.sm, topEnd = componentTokens.spacing.sm),
                )
                .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline),
        ) {
            // Traffic lights
            repeat(3) { i ->
                Box(
                    modifier = Modifier
                        .size(componentTokens.spacing.compact)
                        .background(
                            color = when (i) {
                                0 -> Color(0xFFFF5F57)
                                1 -> Color(0xFFFFBD2E)
                                else -> Color(0xFF28CA42)
                            },
                            shape = RoundedCornerShape(5.dp),
                        )
                )
            }
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = if (isOutput) stringResource(R.string.component_output) else stringResource(R.string.component_command),
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF666666),
                fontSize = 10.sp,
                fontFamily = JetBrainsMonoFamily,
            )
            IconButton(
                onClick = {
                    clipboard.setText(AnnotatedString(content))
                    copied = true
                },
                modifier = Modifier.size(componentTokens.sizing.touchTarget),
            ) {
                Icon(
                    imageVector = if (copied) Icons.Outlined.CheckCircle else Icons.Outlined.ContentCopy,
                    contentDescription = stringResource(R.string.component_copy),
                    tint = if (copied) Color(0xFF28CA42) else Color(0xFF666666),
                    modifier = Modifier.size(componentTokens.sizing.iconXs),
                )
            }
        }
        // Terminal content
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = Color(0xFF0D1117),
                    shape = RoundedCornerShape(bottomStart = componentTokens.spacing.sm, bottomEnd = componentTokens.spacing.sm),
                )
                .padding(componentTokens.spacing.md)
                .horizontalScroll(rememberScrollState()),
        ) {
            Text(
                text = displayContent,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = JetBrainsMonoFamily,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = if (isOutput) Color(0xFF00FF41) else Color(0xFFE8E8E8),
                ),
            )
        }
    }

    LaunchedEffect(copied) {
        if (copied) {
            kotlinx.coroutines.delay(2000)
            copied = false
        }
    }
}

@Composable
private fun DiffView(
    removed: String?,
    added: String?,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(componentTokens.radius.sm))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        removed?.let {
            DiffLine(
                prefix = "−",
                content = it.take(500).let { s ->
                    if (it.length > 500) stringResource(R.string.component_truncated, s) else s
                },
                bgColor = Color(0xFFEF4444).copy(alpha = 0.08f),
                textColor = Color(0xFFEF4444),
            )
        }
        added?.let {
            DiffLine(
                prefix = "+",
                content = it.take(500).let { s ->
                    if (it.length > 500) stringResource(R.string.component_truncated, s) else s
                },
                bgColor = Color(0xFF22C55E).copy(alpha = 0.08f),
                textColor = Color(0xFF22C55E),
            )
        }
    }
}

@Composable
private fun DiffLine(
    prefix: String,
    content: String,
    bgColor: Color,
    textColor: Color,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bgColor)
            .padding(horizontal = componentTokens.spacing.compact, vertical = componentTokens.spacing.inline),
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
    ) {
        Text(
            text = prefix,
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = JetBrainsMonoFamily,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = textColor,
        )
        Text(
            text = content,
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = JetBrainsMonoFamily,
                fontSize = 12.sp,
                lineHeight = 18.sp,
            ),
            color = textColor.copy(alpha = 0.85f),
        )
    }
}

@Composable
private fun CopyableCodeBlock(
    content: String,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        // Top bar with copy
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                    shape = RoundedCornerShape(topStart = componentTokens.spacing.sm, topEnd = componentTokens.spacing.sm),
                )
                .padding(horizontal = componentTokens.spacing.compact, vertical = componentTokens.spacing.xs),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(
                onClick = {
                    clipboard.setText(AnnotatedString(content))
                    copied = true
                },
                contentPadding = PaddingValues(horizontal = componentTokens.spacing.sm, vertical = componentTokens.spacing.xs),
            ) {
                Icon(
                    imageVector = if (copied) Icons.Outlined.CheckCircle else Icons.Outlined.ContentCopy,
                    contentDescription = stringResource(R.string.component_copy),
                    modifier = Modifier.size(componentTokens.sizing.iconXs),
                    tint = if (copied) Color(0xFF22C55E) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
                Text(
                    text = if (copied) stringResource(R.string.component_copied) else stringResource(R.string.component_copy),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (copied) Color(0xFF22C55E) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // Content
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    shape = RoundedCornerShape(bottomStart = componentTokens.spacing.sm, bottomEnd = componentTokens.spacing.sm),
                )
                .padding(componentTokens.spacing.md),
        ) {
            Text(
                text = content,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = JetBrainsMonoFamily,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
            )
        }
    }

    LaunchedEffect(copied) {
        if (copied) {
            kotlinx.coroutines.delay(2000)
            copied = false
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun extractField(element: JsonElement, field: String): String? = try {
    element.jsonObject[field]?.jsonPrimitive?.content
} catch (_: Exception) { null }

private fun formatJson(element: JsonElement): String = try {
    Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), element)
} catch (_: Exception) { element.toString() }

private fun formatDuration(millis: Long): String = when {
    millis < 1000 -> "${millis}ms"
    millis < 60_000 -> "${"%.1f".format(millis / 1000.0)}s"
    else -> "${millis / 60_000}m ${(millis % 60_000) / 1000}s"
}
