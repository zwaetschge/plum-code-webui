package com.claudewebui.app.ui.screens.settings

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.Switch
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
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.isTabletWidth
import com.claudewebui.app.ui.components.common.providerColor
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import com.claudewebui.app.data.model.CliLoginSession
import com.claudewebui.app.data.model.ZaiApiStatus
import com.claudewebui.app.ui.components.common.PlumRed

/**
 * Detail view for one CLI harness.
 *
 * The settings list previously sent every provider row to the "AI Providers"
 * screen, which lists database-stored API providers — a different concept that
 * happens to be empty. This shows what the row actually refers to: whether the
 * harness is available, and which model it runs.
 */
@Composable
fun CliProviderDetailScreen(
    providerId: String,
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val provider = CLIProvider.entries.firstOrNull { it.name.equals(providerId, ignoreCase = true) }
    val config = state.cliProviders.firstOrNull { it.id.equals(providerId, ignoreCase = true) }
    val selectedModel = state.userSettings?.cliProviderModels?.get(providerId.lowercase())
        ?: config?.defaultModel
    // Before the registry arrives, screenResources.getString(R.string.settings_no_config_b4b66) and screenResources.getString(R.string.settings_harness_not_installed_50f6e) look
    // identical — say which one it is instead of claiming it needs a login.
    val stillLoading = config == null && state.isLoading

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
                        title = provider?.displayName ?: providerId,
                        subtitle = screenResources.getString(R.string.settings_harness_status_and_model_e16fa),
                        actions = {
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                screenResources.getString(R.string.settings_back_b52b3),
                                onNavigateBack,
                            )
                        },
                    )
                }

                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                provider?.let {
                                    Box(Modifier.size(10.dp).background(providerColor(it), CircleShape))
                                }
                                Text(
                                    screenResources.getString(R.string.settings_status_d4470),
                                    color = PlumText,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.weight(1f),
                                )
                                val available = config?.available == true
                                when {
                                    stillLoading -> StatusPill(screenResources.getString(R.string.settings_loading_33ce4), PlumMuted)
                                    available -> StatusPill(screenResources.getString(R.string.settings_available_7c62a), PlumGreen)
                                    else -> StatusPill(screenResources.getString(R.string.settings_needs_login_1867b), PlumAmber)
                                }
                            }
                            DetailRow(screenResources.getString(R.string.settings_enabled_df174), if (config?.enabled != false) screenResources.getString(R.string.settings_yes_5397e) else screenResources.getString(R.string.settings_no_816c5))
                            DetailRow(screenResources.getString(R.string.settings_default_model_5fbae), config?.defaultModel ?: if (stillLoading) "…" else "—")
                            DetailRow(screenResources.getString(R.string.settings_models_offered_18701), if (stillLoading) "…" else (config?.models?.size?.toString() ?: "0"))
                        }
                    }
                }

                item {
                    CliLoginPanel(
                        providerId = providerId,
                        available = config?.available == true,
                        login = state.cliLogin?.takeIf { state.cliLoginProvider == providerId },
                        error = state.cliLoginError,
                        onStart = { viewModel.startCliLogin(providerId) },
                        onSubmitCode = viewModel::submitCliLoginCode,
                        onCancel = viewModel::cancelCliLogin,
                    )
                }

                if (providerId.lowercase() in setOf("codex", "opencode", "pi")) {
                    item {
                        RuntimeDefaultsPanel(
                            providerId = providerId.lowercase(),
                            reasoning = state.userSettings?.cliProviderReasoning
                                ?.get(providerId.lowercase()) ?: "medium",
                            codexWebSearch = state.userSettings?.codexWebSearch ?: "auto",
                            codexFast = state.userSettings?.cliProviderServiceTiers
                                ?.get("codex") == "fast",
                            onReasoning = { viewModel.setProviderReasoning(providerId, it) },
                            onWebSearch = viewModel::setCodexWebSearch,
                            onFastTier = viewModel::setCodexFastTier,
                        )
                    }
                }

                if (providerId.equals("zai", ignoreCase = true)) {
                    item {
                        ZaiApiPanel(
                            status = state.zaiApi,
                            saving = state.zaiApiSaving,
                            error = state.error,
                            onSave = viewModel::saveZaiApi,
                            onReset = viewModel::resetZaiApi,
                        )
                    }
                }

                if (providerId.equals("opencode", ignoreCase = true)) {
                    item {
                        OpenCodeProvidersPanel(
                            providers = state.openCodeProviders,
                            saving = state.openCodeSaving,
                            tests = state.openCodeTestResults,
                            testMessages = state.openCodeTestMessages,
                            error = state.error,
                            onSave = viewModel::saveOpenCodeProvider,
                            onDelete = viewModel::deleteOpenCodeProvider,
                            onTest = viewModel::testOpenCodeProvider,
                        )
                    }
                }

                if (!config?.models.isNullOrEmpty()) {
                    item {
                        Text(
                            screenResources.getString(R.string.settings_model_for_new_sessions_844dd),
                            color = PlumText,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = screenTokens.spacing.xs),
                        )
                    }
                    items(config!!.models) { model ->
                        val active = model == selectedModel
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(13.dp))
                                .background(PlumSubtleFill)
                                .border(
                                    1.dp,
                                    if (active) PlumAccent else PlumBorder,
                                    RoundedCornerShape(13.dp),
                                )
                                .clickable { viewModel.setProviderModel(providerId, model) }
                                .padding(13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                model,
                                color = PlumText,
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (active) {
                                Icon(
                                    Icons.Outlined.Check,
                                    screenResources.getString(R.string.settings_selected_9a976),
                                    tint = PlumAccent,
                                    modifier = Modifier.size(19.dp),
                                )
                            }
                        }
                    }
                } else {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Box(
                                Modifier.fillMaxWidth().height(90.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    if (stillLoading) screenResources.getString(R.string.settings_loading_models_d23f2)
                                    else screenResources.getString(R.string.settings_this_harness_reports_no_model_list_e6070),
                                    color = PlumMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ZaiApiPanel(
    status: ZaiApiStatus?,
    saving: Boolean,
    error: String?,
    onSave: (String, String, String, String, String) -> Unit,
    onReset: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var baseUrl by remember(status?.baseUrl) {
        mutableStateOf(status?.baseUrl?.ifBlank { "https://api.z.ai/api/anthropic" }
            ?: "https://api.z.ai/api/anthropic")
    }
    var token by remember(status?.authTokenPreview) { mutableStateOf("") }
    var opus by remember(status?.opusModel) { mutableStateOf(status?.opusModel.orEmpty()) }
    var sonnet by remember(status?.sonnetModel) { mutableStateOf(status?.sonnetModel.orEmpty()) }
    var haiku by remember(status?.haikuModel) { mutableStateOf(status?.haikuModel.orEmpty()) }
    val canSave = baseUrl.isNotBlank() && (status?.configured == true || token.isNotBlank()) && !saving

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(screenResources.getString(R.string.settings_z_ai_endpoint_67646), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Text(
                        screenResources.getString(R.string.settings_separate_from_claude_subscription_sessions_fd917),
                        color = PlumMuted,
                        fontSize = 11.sp,
                    )
                }
                StatusPill(if (status?.configured == true) screenResources.getString(R.string.settings_configured_668c5) else screenResources.getString(R.string.settings_not_configured_81193), if (status?.configured == true) PlumGreen else PlumMuted)
            }
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
                label = { Text(if (status?.hasAuthToken == true) screenResources.getString(R.string.settings_new_api_token_leave_blank_to_keep_4b9cb) else screenResources.getString(R.string.settings_api_token_bc020)) },
                supportingText = status?.authTokenPreview?.let { preview -> { Text(screenResources.getString(R.string.settings_stored_1_s_dbf72, preview)) } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(value = opus, onValueChange = { opus = it }, label = { Text(screenResources.getString(R.string.settings_opus_model_2b846)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = sonnet, onValueChange = { sonnet = it }, label = { Text(screenResources.getString(R.string.settings_sonnet_model_ca6f9)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = haiku, onValueChange = { haiku = it }, label = { Text(screenResources.getString(R.string.settings_haiku_model_0e6d4)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = PlumRed, fontSize = 11.sp) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm, Alignment.End)) {
                if (status?.configured == true) ActionButton(screenResources.getString(R.string.settings_reset_44c57), enabled = !saving, onClick = onReset)
                ActionButton(screenResources.getString(R.string.settings_save_efc00), enabled = canSave) {
                    onSave(baseUrl, token, opus, sonnet, haiku)
                }
            }
        }
    }
}

@Composable
private fun RuntimeDefaultsPanel(
    providerId: String,
    reasoning: String,
    codexWebSearch: String,
    codexFast: Boolean,
    onReasoning: (String) -> Unit,
    onWebSearch: (String) -> Unit,
    onFastTier: (Boolean) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val reasoningOptions = if (providerId == "codex") {
        listOf("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")
    } else {
        listOf("low", "medium", "high", "xhigh", "max")
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Text(screenResources.getString(R.string.settings_runtime_defaults_3c313), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                screenResources.getString(R.string.settings_applied_to_new_sessions_and_the_next_provider_turn_735d9),
                color = PlumMuted,
                fontSize = 12.sp,
            )
            Text(screenResources.getString(R.string.settings_reasoning_e272c), color = PlumMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            reasoningOptions.chunked(4).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    row.forEach { option ->
                        ChoiceChip(
                            label = option,
                            selected = reasoning == option,
                            modifier = Modifier.weight(1f),
                        ) { onReasoning(option) }
                    }
                    repeat(4 - row.size) { Box(Modifier.weight(1f)) }
                }
            }

            if (providerId == "codex") {
                Text(screenResources.getString(R.string.settings_web_search_381ce), color = PlumMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf("auto", "cached", "live", "disabled").forEach { option ->
                        ChoiceChip(
                            label = option,
                            selected = codexWebSearch == option,
                            modifier = Modifier.weight(1f),
                        ) { onWebSearch(option) }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(screenResources.getString(R.string.settings_fast_service_tier_252e4), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text(screenResources.getString(R.string.settings_uses_priority_processing_when_the_model_supports_it_8f8aa), color = PlumMuted, fontSize = 11.sp)
                    }
                    Switch(checked = codexFast, onCheckedChange = onFastTier)
                }
            }
        }
    }
}

@Composable
private fun ChoiceChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) PlumAccent.copy(alpha = .22f) else PlumSubtleFill)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(horizontal = 7.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) PlumAccent else PlumText,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

/**
 * Runs the harness's own login command on the server and shows what it wants.
 *
 * Two shapes come back: a device-code flow, where the user opens a URL and
 * types a code, and a prompt that wants a code pasted back — the latter is what
 * `awaiting_code` means.
 */
@Composable
private fun CliLoginPanel(
    providerId: String,
    available: Boolean,
    login: CliLoginSession?,
    error: String?,
    onStart: () -> Unit,
    onSubmitCode: (String) -> Unit,
    onCancel: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    var code by remember(login?.id) { mutableStateOf("") }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Text(screenResources.getString(R.string.settings_sign_in_ada2e), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)

            when {
                login == null -> {
                    Text(
                        if (available) {
                            screenResources.getString(R.string.settings_this_harness_is_signed_in_run_it_again_to_switch_accounts_b23bc)
                        } else {
                            screenResources.getString(R.string.settings_run_the_harness_login_on_the_server_and_follow_it_here_af50d)
                        },
                        color = PlumMuted,
                        fontSize = 12.sp,
                    )
                    ActionButton(if (available) screenResources.getString(R.string.settings_sign_in_again_7842f) else screenResources.getString(R.string.settings_sign_in_ada2e)) { onStart() }
                }

                login.status == "starting" -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            color = PlumAccent,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(screenTokens.sizing.iconSm),
                        )
                        Text(screenResources.getString(R.string.settings_starting_1_s_login_9c0a9, providerId), color = PlumMuted, fontSize = 12.sp)
                    }
                    ActionButton(screenResources.getString(R.string.settings_cancel_77dfd)) { onCancel() }
                }

                login.status == "completed" -> {
                    Text(screenResources.getString(R.string.settings_signed_in_successfully_d4c69), color = PlumGreen, fontSize = 12.sp)
                    ActionButton(screenResources.getString(R.string.settings_done_e9b45)) { onCancel() }
                }

                login.status == "error" -> {
                    Text(login.error ?: screenResources.getString(R.string.settings_login_failed_c00f6), color = PlumRed, fontSize = 12.sp)
                    ActionButton(screenResources.getString(R.string.settings_try_again_042c8)) { onStart() }
                }

                else -> {
                    login.verificationCode?.let { verification ->
                        Text(screenResources.getString(R.string.settings_enter_this_code_443aa), color = PlumMuted, fontSize = 11.sp)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(screenTokens.radius.md))
                                .background(PlumSubtleFill)
                                .border(1.dp, PlumBorder, RoundedCornerShape(screenTokens.radius.md))
                                .clickable { clipboard.setText(AnnotatedString(verification)) }
                                .padding(13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                verification,
                                color = PlumText,
                                fontSize = 19.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f),
                            )
                            Text(screenResources.getString(R.string.settings_copy_af74f), color = PlumAccent, fontSize = 12.sp)
                        }
                    }
                    login.loginUrl?.let { loginUrl ->
                        ActionButton(screenResources.getString(R.string.settings_open_sign_in_page_b324e)) { uriHandler.openUri(loginUrl) }
                        Text(loginUrl, color = PlumMuted, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (login.needsCode) {
                        OutlinedTextField(
                            value = code,
                            onValueChange = { code = it },
                            label = { Text(screenResources.getString(R.string.settings_code_from_the_provider_7cbb8)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        ActionButton(screenResources.getString(R.string.settings_submit_code_32aef), enabled = code.isNotBlank()) { onSubmitCode(code.trim()) }
                    }
                    if (login.output.isNotBlank()) {
                        Text(
                            login.output.takeLast(400),
                            color = PlumMuted,
                            fontSize = 10.sp,
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    ActionButton(screenResources.getString(R.string.settings_cancel_77dfd)) { onCancel() }
                }
            }

            error?.let { Text(it, color = PlumRed, fontSize = 11.sp) }
        }
    }
}

@Composable
private fun ActionButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        label,
        color = if (enabled) PlumText else PlumMuted,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (enabled) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.compact),
    )
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = PlumMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
        Text(
            value,
            color = PlumText,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
