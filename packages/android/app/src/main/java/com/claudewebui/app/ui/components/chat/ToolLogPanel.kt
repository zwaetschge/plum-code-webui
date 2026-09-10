package com.claudewebui.app.ui.components.chat

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

enum class ToolLogFilter(@StringRes val label: Int) {
    ALL(R.string.tool_log_all), READ(R.string.tool_log_read), WRITE(R.string.tool_log_write),
    BASH(R.string.tool_log_bash), WEB(R.string.tool_log_web), AGENT(R.string.tool_log_agent);

    fun matches(name: String): Boolean {
        val tool = name.lowercase(Locale.ROOT).substringAfterLast("__")
        return when (this) {
            ALL -> true
            READ -> tool in setOf("read", "glob", "grep", "ls", "read_file", "list_directory", "search_files")
            WRITE -> tool in setOf("write", "edit", "apply_patch", "write_file", "edit_file")
            BASH -> tool in setOf("bash", "exec_command", "shell", "run_command", "write_stdin")
            WEB -> tool in setOf("webfetch", "websearch", "web_search", "search_query", "fetch", "web.run")
            AGENT -> tool in setOf("task", "agent", "spawn_agent", "run_subagent", "send_message", "wait_agent")
        }
    }
}

internal fun toolInputPreview(tool: ToolExecution): String {
    val input = tool.input ?: return ""
    if (input is JsonPrimitive) return input.content
    val obj = input as? JsonObject ?: return input.toString()
    return listOf("command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt")
        .firstNotNullOfOrNull { key -> (obj[key] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() } }
        ?: input.toString()
}

internal fun toolDuration(tool: ToolExecution, now: Long): Long =
    ((tool.completedAt ?: now) - tool.timestamp).coerceAtLeast(0L)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToolLogSheet(tools: List<ToolExecution>, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PlumTheme.palette.surfaceStrong) {
        ToolLogPanel(tools, Modifier.fillMaxWidth().heightIn(max = 640.dp).padding(bottom = PlumTheme.tokens.spacing.xl))
    }
}

/** Live and completed tool calls with the same category filters as the WebUI. */
@Composable
fun ToolLogPanel(tools: List<ToolExecution>, modifier: Modifier = Modifier) {
    val tokens = PlumTheme.tokens
    var filter by rememberSaveable { mutableStateOf(ToolLogFilter.ALL) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val running = tools.any { it.status == ToolStatus.STARTED }
    LaunchedEffect(running) {
        while (running) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val filtered = remember(tools, filter) { tools.filter { filter.matches(it.toolName) }.sortedByDescending { it.timestamp } }
    Column(modifier.padding(horizontal = tokens.spacing.screenHorizontal), verticalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
        Text(stringResource(R.string.tool_log_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
            ToolLogFilter.entries.forEach { option ->
                val count = tools.count { option.matches(it.toolName) }
                FilterChip(
                    selected = option == filter,
                    onClick = { filter = option },
                    label = { Text("${stringResource(option.label)} ($count)") },
                )
            }
        }
        if (filtered.isEmpty()) {
            Text(stringResource(R.string.tool_log_empty), style = MaterialTheme.typography.bodyMedium)
        } else {
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(tokens.spacing.xs)) {
                items(filtered, key = { it.toolId }) { tool -> ToolLogRow(tool, now) }
            }
        }
    }
}

@Composable
private fun ToolLogRow(tool: ToolExecution, now: Long) {
    val tokens = PlumTheme.tokens
    var expanded by rememberSaveable(tool.toolId) { mutableStateOf(false) }
    val stateLabel = stringResource(when (tool.status) {
        ToolStatus.STARTED -> R.string.tool_log_running
        ToolStatus.COMPLETED -> R.string.tool_log_completed
        ToolStatus.ERROR -> R.string.tool_log_error
    })
    val expandLabel = stringResource(if (expanded) R.string.tool_log_collapse else R.string.tool_log_expand)
    Surface(shape = tokens.radius.rowShape, color = tokens.surfaces.raised.opaqueFallback, contentColor = tokens.surfaces.raised.foreground) {
        Column {
            Row(
                Modifier.fillMaxWidth().heightIn(min = tokens.sizing.touchTarget)
                    .semantics(mergeDescendants = true) { stateDescription = stateLabel }
                    .clickable(role = Role.Button, onClickLabel = expandLabel) { expanded = !expanded }
                    .padding(tokens.spacing.md),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(tokens.spacing.sm),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(tool.toolName, style = MaterialTheme.typography.labelLarge)
                    toolInputPreview(tool).takeIf { it.isNotBlank() }?.let {
                        Text(it, fontFamily = JetBrainsMonoFamily, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(stateLabel, style = MaterialTheme.typography.labelSmall)
                }
                Text(stringResource(R.string.tool_log_seconds, toolDuration(tool, now) / 1_000.0), style = MaterialTheme.typography.labelSmall)
                Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = null, modifier = Modifier.size(tokens.sizing.iconMd))
            }
            if (expanded) {
                Column(Modifier.padding(tokens.spacing.md), verticalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
                    tool.input?.let { ToolLogDetail(R.string.tool_log_input, it.toString()) }
                    tool.result?.takeIf { it.isNotBlank() }?.let { ToolLogDetail(R.string.tool_log_output, it) }
                    tool.error?.takeIf { it.isNotBlank() }?.let { ToolLogDetail(R.string.tool_log_error, it) }
                }
            }
        }
    }
}

@Composable
private fun ToolLogDetail(@StringRes title: Int, content: String) {
    Text(stringResource(title), style = MaterialTheme.typography.labelMedium)
    SelectionContainer {
        Text(content.take(6_000), fontFamily = JetBrainsMonoFamily, style = MaterialTheme.typography.bodySmall)
    }
}
