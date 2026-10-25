package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Tune
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.ui.components.common.localizedLabel
import androidx.compose.material.icons.outlined.Cable
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Preview
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.ui.theme.PlumTheme

/**
 * Tools of the open session: Dateien, Vorschau (Code, only while a dev server
 * answers) and Verbindungen. Notes, log, mesh and appearance live in the
 * header's overflow menu.
 */
@Composable
internal fun SessionToolsMenu(
    surface: String,
    previewRunning: Boolean,
    mode: SessionMode,
    onModeChange: (SessionMode) -> Unit,
    onFiles: () -> Unit,
    onPreview: () -> Unit,
    onConnections: () -> Unit,
) {
    val t = PlumTheme.tokens
    val isCode = surface == "code"
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(t.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(t.spacing.xs),
    ) {
        Text(stringResource(R.string.chat_tools), style = MaterialTheme.typography.titleLarge)
        SessionModeMenu(mode, onModeChange)
        ToolRow(Icons.Outlined.FolderOpen, stringResource(R.string.chat_files), onClick = onFiles)
        if (isCode && previewRunning) {
            ToolRow(
                icon = Icons.Outlined.Preview,
                label = stringResource(R.string.session_tool_preview),
                detail = stringResource(R.string.session_tool_preview_running),
                onClick = onPreview,
            )
        }
        ToolRow(
            icon = Icons.Outlined.Cable,
            label = stringResource(R.string.session_tool_connections),
            detail = stringResource(R.string.session_tool_connections_hint),
            onClick = onConnections,
        )
    }
}

@Composable
private fun ToolRow(
    icon: ImageVector,
    label: String,
    detail: String? = null,
    badge: Int = 0,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.titleSmall)
                detail?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (badge > 0) Badge { Text(badge.toString()) }
        }
    }
}

/** Execution mode stays with the session tools, outside the composer. */
@Composable
private fun SessionModeMenu(mode: SessionMode, onModeChange: (SessionMode) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(20.dp))
                Text(stringResource(R.string.chat_mode_chip_title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Text(mode.localizedLabel(), style = MaterialTheme.typography.labelMedium)
                Icon(Icons.Outlined.ExpandMore, contentDescription = null, modifier = Modifier.size(16.dp))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf(SessionMode.PLANNING, SessionMode.MANUAL, SessionMode.AUTO_ACCEPT, SessionMode.DANGER).forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.localizedLabel()) },
                    trailingIcon = { if (option == mode) Icon(Icons.Outlined.Check, null) },
                    onClick = { expanded = false; if (option != mode) onModeChange(option) },
                )
            }
        }
    }
}
