package com.claudewebui.app.ui.screens.settings

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
    // `zai` first: it is the entry most people want and the one whose meaning
    // is least obvious from its name.
    var provider by remember { mutableStateOf("zai") }
    var label by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { viewModel.loadSubagents() }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text("CLI subagents", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                "Whole provider CLIs any harness may spawn as one-shot workers through the " +
                    "subagents MCP tool. They use their own shared logins, so no secrets live here.",
                color = PlumMuted,
                fontSize = 12.sp,
            )
            Text(
                "\"Z.AI\" is the exception: it runs the Claude CLI against your Z.AI endpoint — " +
                    "the same second Claude transport a Z.AI session uses, not OpenCode. It " +
                    "disappears server-side while no Z.AI endpoint is configured.",
                color = PlumMuted,
                fontSize = 12.sp,
            )

            if (state.cliSubagents.isEmpty()) {
                Text("No subagents configured", color = PlumMuted, fontSize = 12.sp)
            } else {
                state.cliSubagents.forEach { entry ->
                    var draftModel by remember(entry.id, entry.model) { mutableStateOf(entry.model) }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
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
                                        entry.model.takeIf { it.isNotBlank() } ?: "default model",
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
                            SubagentAction("Remove", state.subagentBusy, destructive = true) {
                                viewModel.removeCliSubagent(entry.id)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = draftModel,
                                onValueChange = { draftModel = it },
                                label = { Text("Model override (optional)") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            SubagentAction("Save", state.subagentBusy || draftModel == entry.model) {
                                viewModel.setCliSubagentModel(entry.id, draftModel)
                            }
                        }
                    }
                }
            }

            Text("Add", color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CLI_SUBAGENT_PROVIDERS.forEach { candidate ->
                    ProviderChip(candidate, candidate == provider) { provider = candidate }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text("Label") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("Model (optional)") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                SubagentAction("Add", state.subagentBusy) {
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
    var label by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var models by remember { mutableStateOf("") }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(
                "Subagent upstreams",
                color = PlumText,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Any Anthropic-compatible endpoint, matched per request by model. An agent whose " +
                    "frontmatter names one of these models runs there while the session's main " +
                    "agent stays on the subscription.",
                color = PlumMuted,
                fontSize = 12.sp,
            )

            if (state.subagentUpstreams.isEmpty()) {
                Text("No custom upstreams", color = PlumMuted, fontSize = 12.sp)
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
                        SubagentAction("Remove", state.subagentBusy, destructive = true) {
                            viewModel.removeSubagentUpstream(upstream.id)
                        }
                    }
                }
            }

            // The picker groups the agent editors offer, so it is visible here
            // whether an upstream actually contributes anything routable.
            if (state.subagentModelGroups.isNotEmpty()) {
                Text(
                    "Routable: " + state.subagentModelGroups.joinToString(" · ") {
                        "${it.group} (${it.models.size})"
                    },
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
            }

            Text("Add", color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = label,
                onValueChange = { label = it },
                label = { Text("Label") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("Base URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("API token") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = models,
                    onValueChange = { models = it },
                    label = { Text("Models (comma separated, kimi-* allowed)") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                SubagentAction("Add", state.subagentBusy) {
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
    Text(
        name,
        color = if (selected) PlumAccent else PlumMuted,
        fontSize = 12.sp,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .background(
                if (selected) PlumSubtleFill else PlumBorder.copy(alpha = .18f),
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

@Composable
private fun SubagentAction(
    label: String,
    disabled: Boolean,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
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
            .padding(start = 12.dp)
            .clickable(enabled = !disabled, onClick = onClick),
    )
}
