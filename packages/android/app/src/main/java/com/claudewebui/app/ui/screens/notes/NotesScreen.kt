package com.claudewebui.app.ui.screens.notes

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.Note
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * Scratch notes for one session — the mobile counterpart to the WebUI notepad.
 */
@Composable
fun NotesScreen(
    viewModel: NotesViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            // Include the IME so editors/fields lift above the keyboard.
            contentWindowInsets = WindowInsets.safeDrawing,
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (isTabletWidth()) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.notes_notes_70440),
                        subtitle = screenResources.getString(R.string.notes_scratch_space_for_this_session_2aad1),
                        actions = {
                            PlumIconButton(Icons.Outlined.Add, screenResources.getString(R.string.notes_new_note_2b7b0), viewModel::startNew)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                screenResources.getString(R.string.notes_back_b52b3),
                                onNavigateBack,
                            )
                        },
                    )
                }

                state.editingId?.let {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
                            Column(
                                Modifier.padding(screenTokens.spacing.cozy),
                                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
                            ) {
                                OutlinedTextField(
                                    value = state.draftTitle,
                                    onValueChange = viewModel::onTitleChange,
                                    label = { Text(screenResources.getString(R.string.notes_title_768e0)) },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PlumAccent,
                                        focusedLabelColor = PlumAccent,
                                    ),
                                )
                                OutlinedTextField(
                                    value = state.draftContent,
                                    onValueChange = viewModel::onContentChange,
                                    label = { Text(screenResources.getString(R.string.notes_note_2c924)) },
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PlumAccent,
                                        focusedLabelColor = PlumAccent,
                                    ),
                                )
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        if (state.isSaving) screenResources.getString(R.string.notes_saving_56a22) else screenResources.getString(R.string.notes_saved_automatically_5bee9),
                                        color = PlumMuted,
                                        fontSize = 11.sp,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(
                                        screenResources.getString(R.string.notes_done_e9b45),
                                        color = PlumText,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(50))
                                            .background(PlumAccent.copy(alpha = .18f))
                                            .clickable(onClick = viewModel::closeEditor)
                                            .padding(horizontal = screenTokens.spacing.lg, vertical = 9.dp),
                                    )
                                }
                            }
                        }
                    }
                }

                if (state.isLoading) {
                    item {
                        Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else if (state.notes.isEmpty() && state.editingId == null) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Column(
                                Modifier.fillMaxWidth().padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(screenResources.getString(R.string.notes_no_notes_yet_d2a1e), color = PlumText, fontWeight = FontWeight.SemiBold)
                                Text(
                                    screenResources.getString(R.string.notes_tap_to_jot_something_down_for_this_session_22b60),
                                    color = PlumMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }

                items(state.notes, key = { it.id }) { note ->
                    NoteRow(
                        note = note,
                        onOpen = { viewModel.startEditing(note) },
                        onTogglePin = { viewModel.togglePinned(note) },
                        onDelete = { viewModel.delete(note) },
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
                            Text(message, color = PlumRed, fontSize = 12.sp, modifier = Modifier.weight(1f))
                            Text(
                                screenResources.getString(R.string.notes_dismiss_70afe),
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
private fun NoteRow(
    note: Note,
    onOpen: () -> Unit,
    onTogglePin: () -> Unit,
    onDelete: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(screenTokens.spacing.cozy),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    note.title.ifBlank { screenResources.getString(R.string.notes_untitled_62152) },
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    note.content.ifBlank { screenResources.getString(R.string.notes_empty_3159f) },
                    color = PlumMuted,
                    fontSize = 12.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.Outlined.PushPin,
                if (note.isPinned) screenResources.getString(R.string.notes_unpin_2eba6) else screenResources.getString(R.string.notes_pin_9c918),
                tint = if (note.isPinned) PlumAccent else PlumMuted,
                modifier = Modifier
                    .size(screenTokens.sizing.touchTarget)
                    .clip(RoundedCornerShape(screenTokens.radius.chip))
                    .clickable(onClick = onTogglePin)
                    .padding(screenTokens.spacing.cozy),
            )
            Icon(
                Icons.Outlined.Delete,
                screenResources.getString(R.string.notes_delete_f6fdb),
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
