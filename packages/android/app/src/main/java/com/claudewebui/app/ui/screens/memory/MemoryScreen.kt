package com.claudewebui.app.ui.screens.memory

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.MemoryFile
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * The session's persistent memory files — the mobile counterpart to the WebUI
 * memory panel.
 */
@Composable
fun MemoryScreen(
    viewModel: MemoryViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val wide = isTabletWidth()

    if (showCreate) {
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text(screenResources.getString(R.string.memory_new_memory_c8ff7)) },
            text = {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text(screenResources.getString(R.string.memory_file_name_09979)) },
                    placeholder = { Text("deployment-notes") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        focusedLabelColor = PlumAccent,
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.create(newName)
                    newName = ""
                    showCreate = false
                }) { Text(screenResources.getString(R.string.memory_create_6e157), color = PlumAccent) }
            },
            dismissButton = {
                TextButton(onClick = { showCreate = false }) { Text(screenResources.getString(R.string.memory_cancel_77dfd), color = PlumMuted) }
            },
        )
    }

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            // Include the IME so editors/fields lift above the keyboard.
            contentWindowInsets = WindowInsets.safeDrawing,
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (wide) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.memory_memory_89c8a),
                        subtitle = state.memoryDir.ifBlank { screenResources.getString(R.string.memory_persistent_notes_for_this_workspace_abbc9) },
                        actions = {
                            PlumIconButton(
                                Icons.Outlined.Add,
                                screenResources.getString(R.string.memory_new_memory_c8ff7),
                                onClick = { showCreate = true },
                            )
                            PlumIconButton(Icons.Outlined.Refresh, screenResources.getString(R.string.memory_reload_cce71), viewModel::load)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                screenResources.getString(R.string.memory_back_b52b3),
                                onNavigateBack,
                            )
                        },
                    )
                }

                state.openPath?.let {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
                            Column(
                                Modifier.padding(screenTokens.spacing.cozy),
                                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        state.openName,
                                        color = PlumText,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(
                                        when {
                                            state.isSaving -> screenResources.getString(R.string.memory_saving_56a22)
                                            state.hasChanges -> screenResources.getString(R.string.memory_unsaved_2ab06)
                                            else -> screenResources.getString(R.string.memory_saved_c0ae8)
                                        },
                                        color = if (state.hasChanges) PlumAccent else PlumMuted,
                                        fontSize = 11.sp,
                                    )
                                }
                                OutlinedTextField(
                                    value = state.draft,
                                    onValueChange = viewModel::onDraftChange,
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp),
                                    textStyle = TextStyle(
                                        color = PlumText,
                                        fontSize = 12.sp,
                                        fontFamily = FontFamily.Monospace,
                                        lineHeight = 17.sp,
                                    ),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PlumAccent,
                                        cursorColor = PlumAccent,
                                    ),
                                )
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(Modifier.weight(1f))
                                    Chip(screenResources.getString(R.string.memory_close_bbfa7), enabled = true, onClick = viewModel::closeEditor)
                                    Chip(
                                        screenResources.getString(R.string.memory_save_efc00),
                                        enabled = state.hasChanges && !state.isSaving,
                                        onClick = viewModel::save,
                                    )
                                }
                            }
                        }
                    }
                }

                if (state.isLoading) {
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(120.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else if (state.files.isEmpty()) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Column(
                                Modifier.fillMaxWidth().padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.xs),
                            ) {
                                Text(
                                    screenResources.getString(R.string.memory_no_memory_files_d97c4),
                                    color = PlumText,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    screenResources.getString(R.string.memory_memories_written_by_the_agent_show_up_here_08dc5),
                                    color = PlumMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }

                items(state.files, key = { it.path }) { file ->
                    MemoryRow(
                        file = file,
                        selected = file.path == state.openPath,
                        onOpen = { viewModel.open(file) },
                        onDelete = { viewModel.delete(file) },
                    )
                }

                state.error?.let { message ->
                    item {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(screenTokens.radius.md))
                                .background(PlumSubtleFill)
                                .padding(screenTokens.spacing.md),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                message,
                                color = PlumRed,
                                fontSize = 12.sp,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                screenResources.getString(R.string.memory_dismiss_70afe),
                                color = PlumAccent,
                                fontSize = 12.sp,
                                modifier = Modifier.clickable(onClick = viewModel::dismissError),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MemoryRow(
    file: MemoryFile,
    selected: Boolean,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(screenTokens.spacing.cozy),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Icon(
                Icons.Outlined.Description,
                null,
                tint = if (selected) PlumAccent else PlumMuted,
                modifier = Modifier.size(screenTokens.sizing.iconMd),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    file.name,
                    color = if (selected) PlumAccent else PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${file.size} B · ${file.modifiedAt.take(10)}",
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                )
            }
            Icon(
                Icons.Outlined.Delete,
                screenResources.getString(R.string.memory_delete_f6fdb),
                tint = PlumRed,
                modifier = Modifier
                    .size(screenTokens.sizing.touchTarget)
                    .clip(RoundedCornerShape(screenTokens.radius.chip))
                    .clickable(onClick = onDelete)
                    .padding(screenTokens.spacing.cozy),
            )
        }
    }
}

@Composable
private fun Chip(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (enabled) PlumText else PlumMuted,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (enabled) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 9.dp),
    )
}
