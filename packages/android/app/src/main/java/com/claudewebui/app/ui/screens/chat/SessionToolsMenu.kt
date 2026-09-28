package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.ui.theme.PlumTheme

/** Tools stay first; configuration opens only when explicitly selected. */
@Composable
internal fun SessionToolsMenu(
    modelSummary: String,
    appearanceSummary: String,
    activeAgents: Int,
    waitingAgents: Int,
    onTasks: () -> Unit,
    onAgents: () -> Unit,
    onFiles: () -> Unit,
    onGit: () -> Unit,
    onNotes: () -> Unit,
    onLog: () -> Unit,
    onChecks: () -> Unit,
    onMemory: () -> Unit,
    onDevTools: () -> Unit,
    onRuntime: () -> Unit,
    onAppearance: () -> Unit,
) {
    val t = PlumTheme.tokens
    var more by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(t.spacing.lg), verticalArrangement = Arrangement.spacedBy(t.spacing.xs)) {
        Text(stringResource(R.string.chat_tools), style = MaterialTheme.typography.titleLarge)
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = onTasks, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(stringResource(R.string.session_menu_tasks)) }
            TextButton(onClick = onAgents, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                Column { Text(stringResource(R.string.agents_title)); Text(stringResource(R.string.session_menu_agent_activity, activeAgents, waitingAgents), style = MaterialTheme.typography.labelSmall) }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = onFiles, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(stringResource(R.string.chat_files)) }
            TextButton(onClick = onGit, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(stringResource(R.string.chat_panel_git)) }
        }
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = onNotes, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(stringResource(R.string.chat_panel_notes)) }
            TextButton(onClick = onLog, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(stringResource(R.string.session_menu_tool_log)) }
        }
        TextButton(onClick = { more = !more }) { Text(stringResource(if (more) R.string.session_menu_less else R.string.session_menu_more)) }
        if (more) {
            TextButton(onClick = onChecks) { Text(stringResource(R.string.chat_checks)) }
            TextButton(onClick = onMemory) { Text(stringResource(R.string.chat_memory)) }
            TextButton(onClick = onDevTools) { Text(stringResource(R.string.chat_dev_tools)) }
        }
        HorizontalDivider()
        TextButton(onClick = onRuntime, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            Column(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.session_menu_runtime), style = MaterialTheme.typography.titleSmall)
                Text(modelSummary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        TextButton(onClick = onAppearance, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            Column(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.session_menu_appearance), style = MaterialTheme.typography.titleSmall)
                Text(appearanceSummary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
