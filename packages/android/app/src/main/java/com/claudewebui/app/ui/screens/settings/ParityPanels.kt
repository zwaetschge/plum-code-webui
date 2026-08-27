package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
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
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Control-gateway tokens and the Codex plugin catalogue. Both surfaces existed
 * only in the WebUI, so a phone could not issue a supervisor token or turn a
 * Codex plugin on or off.
 */
@Composable
fun GatewayTokensPanel(state: SettingsUiState, viewModel: SettingsViewModel) {
    var name by remember { mutableStateOf("") }
    // Off by default, matching the server: read-only has to be chosen, so a
    // supervisor that needs to act is never crippled by accident.
    var readOnly by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.loadGatewayTokens() }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text("Control gateway", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                "Tokens let an external supervisor drive this account through the same API you do.",
                color = PlumMuted,
                fontSize = 12.sp,
            )

            // The secret is returned exactly once; the server keeps only a hash.
            state.newGatewayTokenSecret?.let { secret ->
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        "Copy this now — it is shown only once:",
                        color = PlumGreen,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(secret, color = PlumText, fontSize = 12.sp)
                    ParityAction("Dismiss", false) { viewModel.dismissGatewayTokenSecret() }
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Token name") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                ParityAction("Issue", state.parityBusy || name.isBlank()) {
                    viewModel.createGatewayToken(name, readOnly)
                    name = ""
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { readOnly = !readOnly },
            ) {
                Switch(checked = readOnly, onCheckedChange = { readOnly = it })
                Text(
                    "Read-only — may query everything, may change nothing",
                    color = PlumMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(start = 10.dp),
                )
            }

            if (state.gatewayTokens.isEmpty()) {
                Text("No tokens issued", color = PlumMuted, fontSize = 12.sp)
            } else {
                state.gatewayTokens.forEach { token ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                token.name,
                                color = if (token.revoked) PlumMuted else PlumText,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(
                                    "${token.tokenPrefix}…",
                                    if (token.scope == "read") "read-only" else "full access",
                                    "revoked".takeIf { token.revoked },
                                    token.lastUsedAt?.take(10)?.let { "last used $it" },
                                ).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 11.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (!token.revoked) {
                            ParityAction("Revoke", state.parityBusy, destructive = true) {
                                viewModel.revokeGatewayToken(token.id)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CodexPluginsPanel(state: SettingsUiState, viewModel: SettingsViewModel) {
    LaunchedEffect(Unit) { viewModel.loadCodexPlugins() }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Codex plugins",
                    color = PlumText,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                ParityAction("Reload", state.parityBusy) { viewModel.loadCodexPlugins() }
            }

            if (state.codexPlugins.isEmpty()) {
                Text("No plugins installed", color = PlumMuted, fontSize = 12.sp)
            } else {
                state.codexPlugins.forEach { plugin ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                plugin.displayName.ifBlank { plugin.name },
                                color = PlumText,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(
                                    plugin.marketplace.takeIf { it.isNotBlank() },
                                    plugin.version.takeIf { it.isNotBlank() },
                                    plugin.description.takeIf { it.isNotBlank() },
                                ).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 11.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        // /api/codex/plugins lists the whole catalogue, installed
                        // first. Anything not installed yet gets an install action
                        // instead of a toggle.
                        if (plugin.installed) {
                            Switch(
                                checked = plugin.enabled,
                                enabled = !state.parityBusy,
                                onCheckedChange = { viewModel.setCodexPluginEnabled(plugin.id, it) },
                            )
                        } else {
                            ParityAction("Install", state.parityBusy) {
                                viewModel.installCodexPlugin(plugin.name, plugin.marketplace)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
@ReadOnlyComposable
private fun actionColor(disabled: Boolean, destructive: Boolean) = when {
    disabled -> PlumMuted
    destructive -> PlumRed
    else -> PlumAccent
}

@Composable
private fun ParityAction(
    label: String,
    disabled: Boolean,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    Text(
        label,
        color = actionColor(disabled, destructive),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .padding(start = 12.dp)
            .clickable(enabled = !disabled, onClick = onClick),
    )
}
