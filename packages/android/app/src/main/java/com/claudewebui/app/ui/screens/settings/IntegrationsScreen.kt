package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.claudewebui.app.data.model.UpdateDiscordSettingsInput
import com.claudewebui.app.data.model.UpdateHomeAssistantSettingsInput
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * ComfyUI, Discord and Home Assistant status with connection probes.
 */
@Composable
fun IntegrationsScreen(
    viewModel: IntegrationsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val wide = isTabletWidth()

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
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
                        title = screenResources.getString(R.string.settings_integrations_a7881),
                        subtitle = screenResources.getString(R.string.settings_image_generation_alerts_and_home_automation_82c78),
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, screenResources.getString(R.string.settings_reload_cce71), viewModel::load)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                screenResources.getString(R.string.settings_back_b52b3),
                                onNavigateBack,
                            )
                        },
                    )
                }

                if (state.isLoading) {
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(140.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else {
                    item {
                        val comfy = state.comfyUi
                        IntegrationCard(
                            title = screenResources.getString(R.string.settings_comfyui_039d8),
                            enabled = comfy?.enabled == true,
                            configured = !comfy?.url.isNullOrBlank(),
                            details = listOfNotNull(
                                comfy?.url?.takeIf { it.isNotBlank() }?.let { screenResources.getString(R.string.settings_url_1_s_11794, it) },
                            ),
                            test = state.comfyTest,
                            onTest = viewModel::testComfyUi,
                        )
                    }

                    item {
                        val discord = state.discord
                        IntegrationCard(
                            title = screenResources.getString(R.string.settings_discord_bccc1),
                            enabled = discord?.enabled == true,
                            configured = discord?.configured == true,
                            details = listOfNotNull(
                                discord?.transport?.takeIf { it.isNotBlank() }
                                    ?.let { screenResources.getString(R.string.settings_transport_1_s_e8bc5, it) },
                                discord?.channelLabel?.takeIf { it.isNotBlank() }
                                    ?.let { screenResources.getString(R.string.settings_channel_1_s_5079e, it) },
                                discord?.minSeverity?.takeIf { it.isNotBlank() }
                                    ?.let { screenResources.getString(R.string.settings_min_severity_1_s_74ad8, it) },
                                discord?.let {
                                    screenResources.getString(R.string.settings_outbox_1_s_pending_2_s_failed_8e8ce, it.outboxPending, it.outboxFailed)
                                },
                                discord?.lastSentAt?.let { screenResources.getString(R.string.settings_last_sent_1_s_0ec6d, it.take(19)) },
                            ),
                            warning = state.discord?.lastError,
                            test = state.discordTest,
                            onTest = viewModel::testDiscord,
                        )
                    }

                    item {
                        val ha = state.homeAssistant
                        IntegrationCard(
                            title = screenResources.getString(R.string.settings_home_assistant_c8fd3),
                            enabled = ha?.enabled == true,
                            configured = ha?.configured == true,
                            details = listOfNotNull(
                                ha?.baseUrl?.takeIf { it.isNotBlank() }?.let { screenResources.getString(R.string.settings_url_1_s_11794, it) },
                                ha?.let {
                                    screenResources.getString(R.string.settings_token_ceafa) + if (it.accessTokenConfigured) "configured" else "missing"
                                },
                            ),
                            test = state.haTest,
                            onTest = viewModel::testHomeAssistant,
                        )
                    }

                    item {
                        IntegrationEditor(state = state, viewModel = viewModel)
                    }

                    item {
                        Text(
                            screenResources.getString(R.string.settings_secrets_are_write_only_the_server_reports_only_whether_a_token_a69a0) +
                                screenResources.getString(R.string.settings_is_present_leave_a_field_empty_to_keep_the_stored_value_0333e),
                            color = PlumMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = screenTokens.spacing.xs, vertical = screenTokens.spacing.inline),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun IntegrationCard(
    title: String,
    enabled: Boolean,
    configured: Boolean,
    details: List<String>,
    test: TestState,
    onTest: () -> Unit,
    warning: String? = null,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = PlumText,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(
                    when {
                        enabled -> screenResources.getString(R.string.settings_enabled_3ea3f)
                        configured -> "configured"
                        else -> "off"
                    },
                    when {
                        enabled -> PlumGreen
                        configured -> PlumAccent
                        else -> PlumMuted
                    },
                )
            }

            details.forEach { line ->
                Text(
                    line,
                    color = PlumMuted,
                    fontSize = 12.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            warning?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = PlumRed, fontSize = 11.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
            ) {
                Text(
                    when {
                        test.running -> screenResources.getString(R.string.settings_testing_95c45)
                        test.ok == true -> screenResources.getString(R.string.settings_reachable_fa887)
                        test.ok == false -> test.message ?: screenResources.getString(R.string.settings_failed_09fef)
                        else -> ""
                    },
                    color = when (test.ok) {
                        true -> PlumGreen
                        false -> PlumRed
                        else -> PlumMuted
                    },
                    fontSize = 12.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (test.running) {
                    CircularProgressIndicator(
                        color = PlumAccent,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(17.dp),
                    )
                }
                Text(
                    screenResources.getString(R.string.settings_test_640ab),
                    color = PlumText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(if (test.running) PlumSubtleFill else PlumAccent.copy(alpha = .18f))
                        .clickable(enabled = !test.running, onClick = onTest)
                        .padding(horizontal = 15.dp, vertical = 9.dp),
                )
            }
        }
    }
}

/**
 * Edit form for the three integrations. Only non-empty fields are submitted, so
 * a stored secret survives a save that leaves its field blank; the explicit
 * "clear" toggles are the way to remove one.
 */
@Composable
private fun IntegrationEditor(
    state: IntegrationsUiState,
    viewModel: IntegrationsViewModel,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var comfyUrl by remember(state.comfyUi?.url) { mutableStateOf(state.comfyUi?.url.orEmpty()) }
    var comfyEnabled by remember(state.comfyUi?.enabled) {
        mutableStateOf(state.comfyUi?.enabled ?: false)
    }

    var discordWebhook by remember { mutableStateOf("") }
    var discordChannel by remember(state.discord?.channelId) {
        mutableStateOf(state.discord?.channelId.orEmpty())
    }
    var discordEnabled by remember(state.discord?.enabled) {
        mutableStateOf(state.discord?.enabled ?: false)
    }

    var haUrl by remember(state.homeAssistant?.baseUrl) {
        mutableStateOf(state.homeAssistant?.baseUrl.orEmpty())
    }
    var haToken by remember { mutableStateOf("") }
    var haEnabled by remember(state.homeAssistant?.enabled) {
        mutableStateOf(state.homeAssistant?.enabled ?: false)
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
        ) {
            Text(screenResources.getString(R.string.settings_configure_792c8), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)

            state.savedNotice?.let { Text(it, color = PlumGreen, fontSize = 12.sp) }
            state.saveError?.let { Text(it, color = PlumRed, fontSize = 12.sp) }

            // ComfyUI
            Text(screenResources.getString(R.string.settings_comfyui_039d8), color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = comfyUrl,
                onValueChange = { comfyUrl = it },
                label = { Text(screenResources.getString(R.string.settings_base_url_1dbd6)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow(screenResources.getString(R.string.settings_enabled_df174), comfyEnabled) { comfyEnabled = it }
            SaveRow(state.isSaving) {
                viewModel.saveComfyUi(comfyUrl.trim().takeIf { it.isNotBlank() }, comfyEnabled)
            }

            // Discord
            Text(screenResources.getString(R.string.settings_discord_bccc1), color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = discordWebhook,
                onValueChange = { discordWebhook = it },
                label = { Text(screenResources.getString(R.string.settings_webhook_url_leave_blank_to_keep_6cdda)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = discordChannel,
                onValueChange = { discordChannel = it.filter(Char::isDigit) },
                label = { Text(screenResources.getString(R.string.settings_channel_id_a4370)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow(screenResources.getString(R.string.settings_enabled_df174), discordEnabled) { discordEnabled = it }
            SaveRow(state.isSaving) {
                viewModel.saveDiscord(
                    UpdateDiscordSettingsInput(
                        enabled = discordEnabled,
                        webhookUrl = discordWebhook.trim().takeIf { it.isNotBlank() },
                        channelId = discordChannel.trim().takeIf { it.isNotBlank() },
                    )
                )
                discordWebhook = ""
            }

            // Home Assistant
            Text(screenResources.getString(R.string.settings_home_assistant_c8fd3), color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = haUrl,
                onValueChange = { haUrl = it },
                label = { Text(screenResources.getString(R.string.settings_base_url_1dbd6)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = haToken,
                onValueChange = { haToken = it },
                label = { Text(screenResources.getString(R.string.settings_long_lived_token_leave_blank_to_keep_e0900)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow(screenResources.getString(R.string.settings_enabled_df174), haEnabled) { haEnabled = it }
            SaveRow(state.isSaving) {
                viewModel.saveHomeAssistant(
                    UpdateHomeAssistantSettingsInput(
                        enabled = haEnabled,
                        baseUrl = haUrl.trim().takeIf { it.isNotBlank() },
                        accessToken = haToken.trim().takeIf { it.isNotBlank() },
                    )
                )
                haToken = ""
            }
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = PlumText, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun SaveRow(saving: Boolean, onSave: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Text(
        if (saving) screenResources.getString(R.string.settings_saving_56a22) else screenResources.getString(R.string.settings_save_efc00),
        color = if (saving) PlumMuted else PlumAccent,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clickable(enabled = !saving, onClick = onSave)
            .padding(vertical = screenTokens.spacing.inline),
    )
}
