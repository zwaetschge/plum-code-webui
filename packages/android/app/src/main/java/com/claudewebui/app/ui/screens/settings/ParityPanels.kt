package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
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
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var name by remember { mutableStateOf("") }
    // Off by default, matching the server: read-only has to be chosen, so a
    // supervisor that needs to act is never crippled by accident.
    var readOnly by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.loadGatewayTokens() }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(screenTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(screenResources.getString(R.string.settings_control_gateway_3cd41), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                screenResources.getString(R.string.settings_tokens_let_an_external_supervisor_drive_this_account_through_the_fd54e),
                color = PlumMuted,
                fontSize = 12.sp,
            )

            // The secret is returned exactly once; the server keeps only a hash.
            state.newGatewayTokenSecret?.let { secret ->
                Column(
                    Modifier.fillMaxWidth().padding(vertical = screenTokens.spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.xs),
                ) {
                    Text(
                        screenResources.getString(R.string.settings_copy_this_now_it_is_shown_only_once_6a195),
                        color = PlumGreen,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(secret, color = PlumText, fontSize = 12.sp)
                    ParityAction(screenResources.getString(R.string.settings_dismiss_70afe), false) { viewModel.dismissGatewayTokenSecret() }
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(screenResources.getString(R.string.settings_token_name_b031b)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                ParityAction(screenResources.getString(R.string.settings_issue_73781), state.parityBusy || name.isBlank()) {
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
                    screenResources.getString(R.string.settings_read_only_may_query_everything_may_change_nothing_7d96d),
                    color = PlumMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(start = screenTokens.spacing.compact),
                )
            }

            if (state.gatewayTokens.isEmpty()) {
                Text(screenResources.getString(R.string.settings_no_tokens_issued_5e7e8), color = PlumMuted, fontSize = 12.sp)
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
                                    if (token.scope == "read") "read-only" else screenResources.getString(R.string.settings_full_access_9e440),
                                    "revoked".takeIf { token.revoked },
                                    token.lastUsedAt?.take(10)?.let { screenResources.getString(R.string.settings_last_used_1_s_1dd0c, it) },
                                ).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 11.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (!token.revoked) {
                            ParityAction(screenResources.getString(R.string.settings_revoke_0be72), state.parityBusy, destructive = true) {
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
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    LaunchedEffect(Unit) { viewModel.loadCodexPlugins() }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(screenTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    screenResources.getString(R.string.settings_codex_plugins_cba13),
                    color = PlumText,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                ParityAction(screenResources.getString(R.string.settings_reload_cce71), state.parityBusy) { viewModel.loadCodexPlugins() }
            }

            if (state.codexPlugins.isEmpty()) {
                Text(screenResources.getString(R.string.settings_no_plugins_installed_969f6), color = PlumMuted, fontSize = 12.sp)
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
                            ParityAction(screenResources.getString(R.string.settings_install_fd6c3), state.parityBusy) {
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
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        label,
        color = actionColor(disabled, destructive),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .padding(start = screenTokens.spacing.md)
            .clickable(enabled = !disabled, onClick = onClick),
    )
}
