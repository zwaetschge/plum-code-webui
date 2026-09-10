package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText

/**
 * The subagent layer, previously reachable only from the WebUI.
 *
 * Two independent mechanisms, deliberately shown as two panels because they
 * fail in different ways: an upstream swaps the API endpoint underneath a
 * Claude-transport agent (a wrong token there means a failing agent), while a
 * CLI subagent spawns a whole other provider binary (a missing login there
 * means a failing spawn).
 */

/** Providers the `subagents` MCP bridge knows how to spawn. */
private val CLI_SUBAGENT_PROVIDERS = listOf("codex", "claude", "zai", "opencode", "pi")

@Composable
fun CliSubagentsPanel(state: SettingsUiState, viewModel: SettingsViewModel) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    // `zai` first: it is the entry most people want and the one whose meaning
    // is least obvious from its name.
    var provider by remember { mutableStateOf("zai") }
    var label by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { viewModel.loadSubagents() }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(screenTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(screenResources.getString(R.string.settings_cli_subagents_c1a3d), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                screenResources.getString(R.string.settings_whole_provider_clis_any_harness_may_spawn_as_one_shot_workers_thr_a12e8) +
                    screenResources.getString(R.string.settings_subagents_mcp_tool_they_use_their_own_shared_logins_so_no_secrets_c3014),
                color = PlumMuted,
                fontSize = 12.sp,
            )
            Text(
                screenResources.getString(R.string.settings_z_ai_is_the_exception_it_runs_the_claude_cli_against_your_z_ai_en_3e163) +
                    screenResources.getString(R.string.settings_the_same_second_claude_transport_a_z_ai_session_uses_not_opencode_c25b9) +
                    screenResources.getString(R.string.settings_disappears_server_side_while_no_z_ai_endpoint_is_configured_f649f),
                color = PlumMuted,
                fontSize = 12.sp,
            )

            if (state.cliSubagents.isEmpty()) {
                Text(screenResources.getString(R.string.settings_no_subagents_configured_e075f), color = PlumMuted, fontSize = 12.sp)
            } else {
                state.cliSubagents.forEach { entry ->
                    var draftModel by remember(entry.id, entry.model) { mutableStateOf(entry.model) }
                    Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.xs)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    entry.label.ifBlank { entry.provider },
                                    color = if (entry.enabled) PlumText else PlumMuted,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    listOfNotNull(
                                        entry.provider,
                                        entry.model.takeIf { it.isNotBlank() } ?: screenResources.getString(R.string.settings_default_model_f13dd),
                                    ).joinToString(" · "),
                                    color = PlumMuted,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Switch(
                                checked = entry.enabled,
                                enabled = !state.subagentBusy,
                                onCheckedChange = { viewModel.setCliSubagentEnabled(entry.id, it) },
                            )
                            SubagentAction(screenResources.getString(R.string.settings_remove_e9639), state.subagentBusy, destructive = true) {
                                viewModel.removeCliSubagent(entry.id)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = draftModel,
                                onValueChange = { draftModel = it },
                                label = { Text(screenResources.getString(R.string.settings_model_override_optional_d1e28)) },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            SubagentAction(screenResources.getString(R.string.settings_save_efc00), state.subagentBusy || draftModel == entry.model) {
                                viewModel.setCliSubagentModel(entry.id, draftModel)
                            }
                        }
                    }
                }
            }

            Text(screenResources.getString(R.string.settings_add_61cc5), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline)) {
                CLI_SUBAGENT_PROVIDERS.forEach { candidate ->
                    ProviderChip(candidate, candidate == provider) { provider = candidate }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text(screenResources.getString(R.string.settings_label_74341)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text(screenResources.getString(R.string.settings_model_optional_1cde0)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                SubagentAction(screenResources.getString(R.string.settings_add_61cc5), state.subagentBusy) {
                    viewModel.addCliSubagent(provider, label, model)
                    label = ""
                    model = ""
                }
            }
        }
    }
}

@Composable
fun SubagentUpstreamsPanel(state: SettingsUiState, viewModel: SettingsViewModel) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var label by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var models by remember { mutableStateOf("") }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(screenTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(
                screenResources.getString(R.string.settings_subagent_upstreams_bd40a),
                color = PlumText,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                screenResources.getString(R.string.settings_any_anthropic_compatible_endpoint_matched_per_request_by_model_an_d8ed1) +
                    screenResources.getString(R.string.settings_frontmatter_names_one_of_these_models_runs_there_while_the_sessio_d77a2) +
                    screenResources.getString(R.string.settings_agent_stays_on_the_subscription_bdd74),
                color = PlumMuted,
                fontSize = 12.sp,
            )

            if (state.subagentUpstreams.isEmpty()) {
                Text(screenResources.getString(R.string.settings_no_custom_upstreams_7bd9f), color = PlumMuted, fontSize = 12.sp)
            } else {
                state.subagentUpstreams.forEach { upstream ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                upstream.label,
                                color = PlumText,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(
                                    upstream.baseUrl,
                                    upstream.authTokenPreview.takeIf { it.isNotBlank() },
                                    upstream.models.joinToString(", ").takeIf { it.isNotBlank() },
                                ).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 11.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        SubagentAction(screenResources.getString(R.string.settings_remove_e9639), state.subagentBusy, destructive = true) {
                            viewModel.removeSubagentUpstream(upstream.id)
                        }
                    }
                }
            }

            // The picker groups the agent editors offer, so it is visible here
            // whether an upstream actually contributes anything routable.
            if (state.subagentModelGroups.isNotEmpty()) {
                Text(
                    screenResources.getString(R.string.settings_routable_05933) + state.subagentModelGroups.joinToString(" · ") {
                        "${it.group} (${it.models.size})"
                    },
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
            }

            Text(screenResources.getString(R.string.settings_add_61cc5), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = label,
                onValueChange = { label = it },
                label = { Text(screenResources.getString(R.string.settings_label_74341)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text(screenResources.getString(R.string.settings_base_url_1dbd6)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text(screenResources.getString(R.string.settings_api_token_bc020)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = models,
                    onValueChange = { models = it },
                    label = { Text(screenResources.getString(R.string.settings_models_comma_separated_kimi_allowed_2d043)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                SubagentAction(screenResources.getString(R.string.settings_add_61cc5), state.subagentBusy) {
                    viewModel.addSubagentUpstream(label, baseUrl, token, models)
                    label = ""
                    baseUrl = ""
                    token = ""
                    models = ""
                }
            }
        }
    }
}

@Composable
private fun ProviderChip(name: String, selected: Boolean, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        name,
        color = if (selected) PlumAccent else PlumMuted,
        fontSize = 12.sp,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .background(
                if (selected) PlumSubtleFill else PlumBorder.copy(alpha = .18f),
                RoundedCornerShape(screenTokens.radius.chip),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = screenTokens.spacing.compact, vertical = screenTokens.spacing.inline),
    )
}

@Composable
private fun SubagentAction(
    label: String,
    disabled: Boolean,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        label,
        color = when {
            disabled -> PlumMuted
            destructive -> PlumRed
            else -> PlumAccent
        },
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .padding(start = screenTokens.spacing.md)
            .clickable(enabled = !disabled, onClick = onClick),
    )
}
