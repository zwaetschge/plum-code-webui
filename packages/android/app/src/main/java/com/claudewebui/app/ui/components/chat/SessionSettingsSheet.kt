package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.components.common.localizedLabel
import com.claudewebui.app.ui.components.common.localizedDescription
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
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.data.model.StyleKind
import com.claudewebui.app.data.model.ReasoningLevel
import com.claudewebui.app.data.model.ServiceTier
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionPeerLink
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.providerColor

/**
 * Per-session controls: which harness runs it, on which model, at which
 * reasoning level, and how freely it may use tools.
 *
 * Provider, model and reasoning are persisted settings. The backend reloads a
 * running harness immediately while preserving its conversation context. Mode
 * remains a live socket setting.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SessionSettingsSheet(
    session: Session,
    mode: SessionMode,
    availableModels: List<String>,
    isApplying: Boolean,
    allowedDirectories: List<String>,
    directoriesLoading: Boolean,
    onProviderChange: (CLIProvider) -> Unit,
    onModelChange: (String?) -> Unit,
    onReasoningChange: (String?) -> Unit,
    onModeChange: (SessionMode) -> Unit,
    onAddAllowedDirectory: (String) -> Unit,
    onRemoveAllowedDirectory: (String) -> Unit,
    designStyles: List<ConfigSkill> = emptyList(),
    writingStyles: List<ConfigSkill> = emptyList(),
    onStyleChange: (StyleKind, String?) -> Unit = { _, _ -> },
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

            SettingsGroup(stringResource(R.string.component_mode), stringResource(R.string.component_applies_immediately)) {
                SessionMode.entries.forEach { option ->
                    OptionRow(
                        title = option.localizedLabel(),
                        subtitle = option.localizedDescription(),
                        selected = option == mode,
                        enabled = true,
                    ) { onModeChange(option) }
                }
            }

            SettingsGroup(stringResource(R.string.component_provider), stringResource(R.string.component_applies_immediately)) {
                CLIProvider.active.forEach { provider ->
                    OptionRow(
                        title = provider.displayName,
                        subtitle = null,
                        selected = provider == session.cliProvider,
                        enabled = !isApplying,
                        accent = providerColor(provider),
                    ) { onProviderChange(provider) }
                }
            }

            SettingsGroup(stringResource(R.string.component_model), stringResource(R.string.component_applies_immediately)) {
                OptionRow(
                    title = stringResource(R.string.component_provider_default),
                    subtitle = null,
                    selected = session.cliModel.isNullOrBlank(),
                    enabled = !isApplying,
                ) { onModelChange(null) }
                availableModels.forEach { model ->
                    OptionRow(
                        title = model,
                        subtitle = null,
                        selected = model == session.cliModel,
                        enabled = !isApplying,
                    ) { onModelChange(model) }
                }
                if (availableModels.isEmpty()) {
                    Text(
                        stringResource(R.string.component_this_provider_reports_no_model_list),
                        color = PlumMuted,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(vertical = componentTokens.spacing.inline),
                    )
                }
            }

            SettingsGroup(stringResource(R.string.component_reasoning), stringResource(R.string.component_applies_immediately)) {
                val levels = ReasoningLevel.forProvider(session.cliProvider)
                val fastActive = session.cliServiceTier.equals(ServiceTier.FAST.id, ignoreCase = true)
                OptionRow(
                    title = stringResource(R.string.component_provider_default),
                    subtitle = null,
                    selected = session.cliReasoning.isNullOrBlank() && !fastActive,
                    enabled = !isApplying,
                ) { onReasoningChange(null) }
                levels.forEach { level ->
                    OptionRow(
                        title = level.localizedLabel(),
                        subtitle = null,
                        selected = !fastActive &&
                            level.id.equals(session.cliReasoning, ignoreCase = true),
                        enabled = !isApplying,
                    ) { onReasoningChange(level.id) }
                }
                // A level the server set but this provider no longer lists
                // (e.g. after a provider switch) would otherwise vanish from the
                // sheet and read as stringResource(R.string.component_provider_default).
                ReasoningLevel.fromId(session.cliReasoning)
                    ?.takeIf { it !in levels }
                    ?.let { orphan ->
                        OptionRow(
                            title = orphan.localizedLabel(),
                            subtitle = stringResource(R.string.component_set_on_the_server_for_another_provider),
                            selected = !fastActive,
                            enabled = !isApplying,
                        ) { onReasoningChange(orphan.id) }
                    }
                if (session.cliProvider == CLIProvider.CODEX) {
                    OptionRow(
                        title = ServiceTier.FAST.localizedLabel(),
                        subtitle = stringResource(R.string.component_codex_service_tier_lowest_latency),
                        selected = fastActive,
                        enabled = !isApplying,
                    ) { onReasoningChange(ServiceTier.FAST.id) }
                }
            }

            if (designStyles.isNotEmpty() || writingStyles.isNotEmpty()) {
                SettingsGroup(stringResource(R.string.component_presentation_presets), stringResource(R.string.component_applied_to_this_session_s_turns)) {
                    StylePicker(stringResource(R.string.component_design), designStyles, session.designStyleSkill, isApplying) {
                        onStyleChange(StyleKind.DESIGN, it)
                    }
                    StylePicker(stringResource(R.string.component_writing), writingStyles, session.writingStyleSkill, isApplying) {
                        onStyleChange(StyleKind.WRITING, it)
                    }
                }
            }

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

/**
 * One preset slot: stringResource(R.string.component_none) plus the catalogue entries. Collapsed to a scrollable
 * list because the design library alone ships several dozen presets.
 */
@Composable
private fun StylePicker(
    label: String,
    styles: List<ConfigSkill>,
    selected: String?,
    isApplying: Boolean,
    onSelect: (String?) -> Unit,
) {
    if (styles.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val active = styles.firstOrNull { it.id == selected || it.name == selected }

    OptionRow(
        title = label,
        subtitle = active?.name ?: stringResource(R.string.component_none),
        selected = active != null,
        enabled = !isApplying,
    ) { expanded = !expanded }

    if (expanded) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 240.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            OptionRow(
                title = stringResource(R.string.component_none),
                subtitle = null,
                selected = active == null,
                enabled = !isApplying,
            ) {
                onSelect(null)
                expanded = false
            }
            styles.forEach { style ->
                OptionRow(
                    title = style.name,
                    subtitle = style.description.takeIf { it.isNotBlank() },
                    selected = style.id == selected || style.name == selected,
                    enabled = !isApplying,
                ) {
                    onSelect(style.id)
                    expanded = false
                }
            }
        }
    }
}
