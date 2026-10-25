package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionPeerLink
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Per-session settings beyond the chat bar: presentation presets, mesh peers,
 * templates and allowed directories. Provider, model and thinking depth
 * are chips in the composer; execution mode lives in the session tools.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SessionSettingsSheet(
    session: Session,
    isApplying: Boolean,
    allowedDirectories: List<String>,
    directoriesLoading: Boolean,
    onAddAllowedDirectory: (String) -> Unit,
    onRemoveAllowedDirectory: (String) -> Unit,
    meshPeers: List<SessionPeerLink> = emptyList(),
    /** Freeze this setup as a reusable template. */
    onSaveTemplate: (String) -> Unit = {},
    /** Hand the whole transcript to the system share sheet. */
    onShareTranscript: () -> Unit = {},
    isSharing: Boolean = false,
    onDismiss: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var newDirectory by remember { mutableStateOf("") }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = PlumSurfaceStrong,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = componentTokens.spacing.headerHorizontal)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.headerHorizontal),
        ) {
            Text(stringResource(R.string.component_session_settings), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)

            // Provider, model and thinking depth are chat-bar chips; the design
            // preset sits in ⋯ → Darstellung, the Task writing style in the composer `+`.

            if (meshPeers.isNotEmpty()) {
                SettingsGroup(stringResource(R.string.component_session_mesh), stringResource(R.string.component_sessions_this_one_can_delegate_to)) {
                    meshPeers.forEach { peer ->
                        OptionRow(
                            title = peer.target?.name ?: peer.targetSessionId,
                            subtitle = listOfNotNull(
                                peer.role,
                                peer.target?.status,
                            ).joinToString(" · ").ifBlank { null },
                            selected = peer.enabled,
                            enabled = false,
                        ) { }
                    }
                }
            }

            SettingsGroup(stringResource(R.string.component_this_session), stringResource(R.string.component_reuse_or_hand_it_off)) {
                var templateName by remember(session.id) { mutableStateOf(session.name) }
                Text(
                    stringResource(R.string.component_a_template_keeps_provider_model_mode_and_workspace_not_the_messag),
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
                OutlinedTextField(
                    value = templateName,
                    onValueChange = { templateName = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.component_template_name)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                SheetActionRow(
                    label = stringResource(R.string.component_save_as_template),
                    enabled = templateName.isNotBlank(),
                ) { onSaveTemplate(templateName.trim()) }
                SheetActionRow(
                    label = if (isSharing) stringResource(R.string.component_preparing_transcript) else stringResource(R.string.component_share_transcript),
                    enabled = !isSharing,
                ) { onShareTranscript() }
            }

            SettingsGroup(stringResource(R.string.component_allowed_directories), stringResource(R.string.component_enforced_per_session)) {
                Text(
                    stringResource(R.string.component_adds_explicit_read_write_roots_beyond_the_session_workspace),
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
                allowedDirectories.forEach { directory ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(componentTokens.radius.md))
                            .background(PlumSubtleFill)
                            .border(1.dp, PlumBorder, RoundedCornerShape(componentTokens.radius.md))
                            .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            directory,
                            color = PlumText,
                            fontSize = 11.sp,
                            modifier = Modifier.weight(1f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        TextButton(
                            onClick = { onRemoveAllowedDirectory(directory) },
                            enabled = !directoriesLoading,
                        ) { Text(stringResource(R.string.component_remove)) }
                    }
                }
                if (allowedDirectories.isEmpty()) {
                    Text(stringResource(R.string.component_no_additional_roots), color = PlumMuted, fontSize = 11.sp)
                }
                OutlinedTextField(
                    value = newDirectory,
                    onValueChange = { newDirectory = it },
                    label = { Text(stringResource(R.string.component_server_directory_path)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        TextButton(
                            onClick = {
                                onAddAllowedDirectory(newDirectory)
                                newDirectory = ""
                            },
                            enabled = newDirectory.isNotBlank() && !directoriesLoading,
                        ) { Text(stringResource(R.string.component_add)) }
                    },
                )
            }
        }
    }
}

@Composable
private fun SettingsGroup(
    title: String,
    caption: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text(caption, color = PlumMuted, fontSize = 10.sp)
        }
        content()
    }
}

/** A plain action, as opposed to the selectable OptionRow above it. */
@Composable
private fun SheetActionRow(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val componentTokens = PlumTheme.tokens
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.md))
            .background(PlumSubtleFill)
            .border(1.dp, PlumBorder, RoundedCornerShape(componentTokens.radius.md))
            .heightIn(min = componentTokens.sizing.touchTarget)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = componentTokens.spacing.md, vertical = 11.dp),
    ) {
        Text(
            label,
            color = if (enabled) PlumAccent else PlumMuted,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun OptionRow(
    title: String,
    subtitle: String?,
    selected: Boolean,
    enabled: Boolean,
    accent: Color = PlumAccent,
    onClick: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.md))
            .background(PlumSubtleFill)
            .border(1.dp, if (selected) accent else PlumBorder, RoundedCornerShape(componentTokens.radius.md))
            .heightIn(min = componentTokens.sizing.touchTarget)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = componentTokens.spacing.md, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(13.dp)
                .clip(CircleShape)
                .background(if (selected) accent else Color.Transparent)
                .border(1.dp, if (selected) accent else PlumBorder, CircleShape),
        )
        Column(Modifier.weight(1f).padding(start = 11.dp)) {
            Text(
                title,
                color = if (enabled) PlumText else PlumMuted,
                fontSize = 13.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            subtitle?.let { Text(it, color = PlumMuted, fontSize = 10.sp, maxLines = 1) }
        }
    }
}
