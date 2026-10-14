package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
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
