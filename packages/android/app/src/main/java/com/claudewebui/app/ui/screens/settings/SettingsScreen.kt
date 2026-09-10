package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.ViewColumn
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Brightness4
import androidx.compose.material.icons.outlined.Cached
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CLIProviderConfig
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.dashboard.IdlePrefs
import com.claudewebui.app.ui.components.dashboard.IdleThreshold
import com.claudewebui.app.ui.theme.LayoutPrefs
import com.claudewebui.app.ui.theme.TwoPaneOption
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.PlumContentWidth
import com.claudewebui.app.ui.components.common.rememberWindowWidth
import com.claudewebui.app.ui.components.common.WindowWidth
import com.claudewebui.app.ui.theme.AppThemeOption
import com.claudewebui.app.ui.components.common.providerColor

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateToCliProvider: (String) -> Unit = {},
    onNavigateToMcp: () -> Unit,
    onNavigateToCliTools: () -> Unit,
    onNavigateToAgents: () -> Unit,
    onNavigateToPermissions: () -> Unit,
    onNavigateToIntegrations: () -> Unit,
    onNavigateToOperations: () -> Unit,
    onLoggedOut: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit = {},
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val twoPaneOption by LayoutPrefs.twoPane.collectAsState()
    val idleThreshold by IdlePrefs.threshold.collectAsState()
    val context = LocalContext.current
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showThemePicker by remember { mutableStateOf(false) }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> viewModel.onNotificationPermissionResult(granted) }

    LaunchedEffect(Unit) {
        viewModel.ensureLoaded()
        viewModel.refreshNotificationPermission()
    }

    PlumBackdrop {
        PlumNavScaffold(MainDestination.SETTINGS, onNavigateMain) { padding ->
            PlumContentWidth(
                modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
                max = 1040.dp,
            ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 4.dp,
                    bottom = 4.dp + padding.calculateBottomPadding(),
                ),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                state.error?.let { message ->
                    item {
                        com.claudewebui.app.ui.components.common.ErrorBanner(
                            message = message,
                            onRetry = viewModel::loadSettings,
                        )
                    }
                }
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.settings_settings_c7f73),
                        subtitle = screenResources.getString(R.string.settings_connection_providers_and_app_preferences_a8c65),
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, screenResources.getString(R.string.settings_refresh_56e3b), viewModel::loadSettings)
                        },
                    )
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(screenTokens.spacing.lg)) {
                            Text(screenResources.getString(R.string.settings_server_status_fd709), color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Row(Modifier.padding(top = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(10.dp).background(PlumGreen, CircleShape))
                                Column(Modifier.weight(1f).padding(horizontal = 11.dp)) {
                                    Text(screenResources.getString(R.string.settings_connected_to_plum_code_webui_82f9f), color = PlumText, fontWeight = FontWeight.Bold)
                                    Text(state.serverUrl.ifBlank { screenResources.getString(R.string.settings_server_configured_c7807) }, color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                StatusPill(screenResources.getString(R.string.settings_healthy_80ea1), PlumGreen)
                            }
                            Box(Modifier.fillMaxWidth().padding(vertical = 13.dp).height(1.dp).background(PlumBorder))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Sync, null, tint = PlumMuted, modifier = Modifier.size(screenTokens.sizing.iconInline))
                                Text(screenResources.getString(R.string.settings_last_sync_just_now_ca523), color = PlumMuted, fontSize = 12.sp)
                            }
                        }
                    }
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(horizontal = screenTokens.spacing.cozy, vertical = 13.dp)) {
                            Text(screenResources.getString(R.string.settings_providers_87b7c), color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 5.dp))
                            CLIProvider.active.forEachIndexed { index, provider ->
                                ProviderRow(
                                    provider = provider,
                                    config = state.cliProviders.firstOrNull {
                                        it.id.equals(provider.name, ignoreCase = true)
                                    },
                                    // The row is about this CLI harness, so it
                                    // opens that harness — not the unrelated
                                    // database-provider list.
                                    onClick = { onNavigateToCliProvider(provider.name.lowercase()) },
                                )
                                if (index < CLIProvider.active.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(PlumBorder))
                            }
                        }
                    }
                }
                item {
                    ResponsiveSettingsPair(
                        first = { groupModifier -> SettingsGroup(screenResources.getString(R.string.settings_security_f25ce), groupModifier) {
                            CompactSettingRow(Icons.Outlined.Fingerprint, screenResources.getString(R.string.settings_biometric_lock_20972), screenResources.getString(R.string.settings_use_fingerprint_8b19c), PlumAccent) {
                                PlumSwitch(state.biometricEnabled) { viewModel.setBiometricEnabled(it) }
                            }
                            CompactSettingRow(Icons.Outlined.Security, screenResources.getString(R.string.settings_encrypted_tokens_9a220), screenResources.getString(R.string.settings_stored_securely_4f6fe), PlumAccent) {
                                Icon(Icons.Outlined.CloudDone, screenResources.getString(R.string.settings_enabled_df174), tint = PlumGreen)
                            }
                            CompactSettingRow(
                                Icons.Outlined.Lock,
                                screenResources.getString(R.string.settings_permissions_d06d5),
                                screenResources.getString(R.string.settings_per_session_66a54),
                                PlumAccent,
                                onClick = onNavigateToPermissions,
                            )
                        } },
                        second = { groupModifier -> SettingsGroup(screenResources.getString(R.string.settings_appearance_41def), groupModifier) {
                            CompactSettingRow(
                                Icons.Outlined.Brightness4,
                                screenResources.getString(R.string.settings_theme_a797e),
                                state.theme.localizedLabel(screenResources),
                                PlumMuted,
                                onClick = { showThemePicker = true },
                            )
                            // The automatic breakpoint measures dp, so a raised
                            // display zoom can hide the two-pane layout on a
                            // screen that plainly has room for it.
                            CompactSettingRow(
                                Icons.Outlined.ViewColumn,
                                screenResources.getString(R.string.settings_two_pane_layout_e5d18),
                                twoPaneOption.localizedLabel(screenResources) + " · " + twoPaneOption.localizedDescription(screenResources),
                                PlumMuted,
                                onClick = {
                                    val order = TwoPaneOption.entries
                                    val next = order[(order.indexOf(twoPaneOption) + 1) % order.size]
                                    LayoutPrefs.set(context, next)
                                },
                            )
                            // How long a session may claim to be working with
                            // nothing to show for it before the dashboard says
                            // so. Sessions running a test suite are quiet for
                            // minutes by design; ones editing files are not.
                            CompactSettingRow(
                                Icons.Outlined.Timer,
                                screenResources.getString(R.string.settings_call_a_session_quiet_after_6f50e),
                                idleThreshold.label + screenResources.getString(R.string.settings_then_the_card_stops_claiming_it_is_working_e4e6d),
                                PlumMuted,
                                onClick = {
                                    val order = IdleThreshold.entries
                                    val next = order[(order.indexOf(idleThreshold) + 1) % order.size]
                                    IdlePrefs.set(context, next)
                                },
                            )
                        } },
                    )
                }
                item {
                    ResponsiveSettingsPair(
                        first = { groupModifier -> SettingsGroup(screenResources.getString(R.string.settings_notifications_753a2), groupModifier) {
                            val notificationsActive = state.notificationsEnabled &&
                                state.notificationsAllowedBySystem
                            val notificationStatus = when {
                                !state.notificationsAllowedBySystem -> screenResources.getString(R.string.settings_blocked_by_android_settings_2f8f9)
                                notificationsActive -> screenResources.getString(R.string.settings_reply_goal_and_approval_alerts_52963)
                                else -> screenResources.getString(R.string.settings_off_e3de5)
                            }
                            CompactSettingRow(Icons.Outlined.Notifications, screenResources.getString(R.string.settings_push_notifications_03be2), notificationStatus, PlumAccent) {
                                PlumSwitch(notificationsActive) { enable ->
                                    when {
                                        !enable -> viewModel.setNotificationsEnabled(false)
                                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                            !LocalNotificationManager.hasNotificationPermission(context) ->
                                            LocalNotificationManager.requestNotificationPermission(
                                                notificationPermissionLauncher,
                                            )
                                        else -> viewModel.setNotificationsEnabled(true)
                                    }
                                }
                            }
                            var usageAlerts by remember {
                                mutableStateOf(
                                    com.claudewebui.app.widget.UsageAlerts.isEnabled(context)
                                )
                            }
                            CompactSettingRow(
                                Icons.Outlined.Notifications,
                                screenResources.getString(R.string.settings_usage_alerts_ca98c),
                                screenResources.getString(R.string.settings_quota_1_s_2c324, com.claudewebui.app.widget.UsageAlerts.LIMIT_THRESHOLD_PERCENT) +
                                    screenResources.getString(R.string.settings_or_cost_1_s_day_edc99, "%.0f".format(com.claudewebui.app.widget.UsageAlerts.dailyCostThreshold(context))),
                                PlumAccent,
                            ) {
                                PlumSwitch(usageAlerts) { enable ->
                                    usageAlerts = enable
                                    com.claudewebui.app.widget.UsageAlerts.setEnabled(context, enable)
                                    // Keep the account-wide setting authoritative so
                                    // the WebUI sees the same thresholds.
                                    viewModel.updateUsageAlerts(enabled = enable)
                                }
                            }
                        } },
                        second = { groupModifier -> SettingsGroup(screenResources.getString(R.string.settings_advanced_4d064), groupModifier) {
                            // The update checker existed but nothing ever called
                            // it — without this row the in-app update path was
                            // unreachable and every install had to be sideloaded.
                            val updateChecker: com.claudewebui.app.core.updates.AppUpdateChecker =
                                org.koin.compose.koinInject()
                            val updateState by updateChecker.updateState.collectAsState()
                            CompactSettingRow(
                                Icons.Outlined.Sync,
                                screenResources.getString(R.string.settings_app_update_45b5d),
                                when (val u = updateState) {
                                    is com.claudewebui.app.core.updates.UpdateState.UpdateAvailable ->
                                        screenResources.getString(R.string.settings_version_1_s_available_tap_to_install_4cc36, u.newVersion)
                                    com.claudewebui.app.core.updates.UpdateState.Checking -> screenResources.getString(R.string.settings_checking_820d6)
                                    com.claudewebui.app.core.updates.UpdateState.UpToDate -> screenResources.getString(R.string.settings_up_to_date_82fb1)
                                    is com.claudewebui.app.core.updates.UpdateState.Downloading ->
                                        screenResources.getString(R.string.settings_downloading_1_s_926c0, u.progress)
                                    else -> screenResources.getString(R.string.settings_version_1_s_tap_to_check_57029, com.claudewebui.app.BuildConfig.VERSION_NAME)
                                },
                                PlumAccent,
                                onClick = {
                                    val current = updateState
                                    if (current is com.claudewebui.app.core.updates.UpdateState.UpdateAvailable) {
                                        updateChecker.downloadAndInstall(current.downloadUrl)
                                    } else {
                                        updateChecker.checkForUpdate()
                                    }
                                },
                            )
                            CompactSettingRow(Icons.Outlined.SettingsEthernet, screenResources.getString(R.string.settings_mcp_servers_3c23b), screenResources.getString(R.string.settings_1_s_configured_9e3b8, state.mcpServers.size), PlumMuted, onNavigateToMcp)
                            CompactSettingRow(
                                Icons.Outlined.SmartToy,
                                screenResources.getString(R.string.settings_agents_skills_e140f),
                                screenResources.getString(R.string.settings_1_s_agents_2_s_skills_d9944, state.configAgents.size + state.agents.size, state.configSkills.size),
                                PlumMuted,
                                onNavigateToAgents,
                            )
                            CompactSettingRow(Icons.Outlined.Terminal, screenResources.getString(R.string.settings_cli_tools_4b238), screenResources.getString(R.string.settings_1_s_tools_9d483, state.cliTools.size), PlumMuted, onNavigateToCliTools)
                            CompactSettingRow(
                                Icons.Outlined.Hub,
                                screenResources.getString(R.string.settings_integrations_a7881),
                                screenResources.getString(R.string.settings_comfyui_discord_home_assistant_b5f60),
                                PlumMuted,
                                onNavigateToIntegrations,
                            )
                            CompactSettingRow(
                                Icons.Outlined.AdminPanelSettings,
                                screenResources.getString(R.string.settings_operations_a1fda),
                                screenResources.getString(R.string.settings_containers_watchdogs_audit_a3e6e),
                                PlumMuted,
                                onNavigateToOperations,
                            )
                        } },
                    )
                }
                item { GatewayTokensPanel(state = state, viewModel = viewModel) }
                item { CodexPluginsPanel(state = state, viewModel = viewModel) }
                item { SubagentUpstreamsPanel(state = state, viewModel = viewModel) }
                item { CliSubagentsPanel(state = state, viewModel = viewModel) }
                item {
                    GlassPanel(
                        modifier = Modifier.fillMaxWidth().clickable { showLogoutDialog = true },
                        radius = 18.dp,
                        borderColor = PlumRed.copy(alpha = .45f),
                    ) {
                        Row(Modifier.padding(screenTokens.spacing.lg), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Outlined.ExitToApp, null, tint = PlumRed, modifier = Modifier.size(27.dp))
                            Column(Modifier.weight(1f).padding(start = 13.dp)) {
                                Text(screenResources.getString(R.string.settings_log_out_6e78c), color = PlumRed, fontWeight = FontWeight.Bold)
                                Text(screenResources.getString(R.string.settings_sign_out_of_your_plum_code_account_bfaa9), color = PlumMuted, fontSize = 12.sp)
                            }
                            Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted)
                        }
                    }
                }
                item { Spacer(Modifier.height(5.dp)) }
            }
            }
        }
    }

    if (showThemePicker) {
        AlertDialog(
            onDismissRequest = { showThemePicker = false },
            containerColor = PlumSurfaceStrong,
            title = { Text(screenResources.getString(R.string.settings_theme_a797e), color = PlumText) },
            text = {
                Column {
                    AppThemeOption.entries.forEach { option ->
                        val selected = option == state.theme
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(screenTokens.radius.md))
                                .clickable {
                                    viewModel.updateTheme(option)
                                    showThemePicker = false
                                }
                                .padding(vertical = 11.dp, horizontal = screenTokens.spacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(15.dp)
                                    .clip(CircleShape)
                                    .background(if (selected) PlumAccent else Color.Transparent)
                                    .border(1.dp, if (selected) PlumAccent else PlumBorder, CircleShape)
                            )
                            Column(Modifier.weight(1f).padding(start = screenTokens.spacing.md)) {
                                Text(option.localizedLabel(screenResources), color = PlumText, fontWeight = FontWeight.Medium)
                                Text(option.localizedDescription(screenResources), color = PlumMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showThemePicker = false }) { Text(screenResources.getString(R.string.settings_close_bbfa7), color = PlumAccent) }
            },
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text(screenResources.getString(R.string.settings_log_out_dd4dd)) },
            text = { Text(screenResources.getString(R.string.settings_you_can_sign_in_to_plum_code_again_at_any_time_cfcf1)) },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout(onLoggedOut)
                }) { Text(screenResources.getString(R.string.settings_log_out_6e78c), color = PlumRed) }
            },
            dismissButton = { TextButton(onClick = { showLogoutDialog = false }) { Text(screenResources.getString(R.string.settings_cancel_77dfd)) } },
        )
    }
}

@Composable
private fun ProviderRow(provider: CLIProvider, config: CLIProviderConfig?, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val connected = config?.available ?: (provider == CLIProvider.CODEX || provider == CLIProvider.OPENCODE)
    val enabled = config?.enabled ?: true
    val status = when {
        !enabled -> screenResources.getString(R.string.settings_disabled_f4f44)
        connected -> screenResources.getString(R.string.settings_connected_c2f9b)
        else -> screenResources.getString(R.string.settings_needs_login_1867b)
    }
    val statusColor = when {
        !enabled -> PlumMuted
        connected -> PlumGreen
        else -> PlumAmber
    }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(onClick = onClick)
            .padding(vertical = screenTokens.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(9.dp).background(providerColor(provider), CircleShape))
        Column(Modifier.weight(1f).padding(horizontal = 11.dp)) {
            Text(
                provider.displayName,
                color = PlumText,
                fontWeight = FontWeight.Medium,
            )
            Text("${provider.name.lowercase()}@plum.code", color = PlumMuted, fontSize = 11.sp)
        }
        StatusPill(status, statusColor)
        Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted, modifier = Modifier.padding(start = 7.dp))
    }
}

@Composable
private fun ResponsiveSettingsPair(
    first: @Composable (Modifier) -> Unit,
    second: @Composable (Modifier) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    if (rememberWindowWidth() == WindowWidth.COMPACT) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
            first(Modifier.fillMaxWidth())
            second(Modifier.fillMaxWidth())
        }
    } else {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
            first(Modifier.weight(1f))
            second(Modifier.weight(1f))
        }
    }
}

@Composable
private fun SettingsGroup(title: String, modifier: Modifier, content: @Composable () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(modifier, radius = 18.dp) {
        Column(Modifier.fillMaxWidth().padding(screenTokens.spacing.md)) {
            Text(title, color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 5.dp))
            content()
        }
    }
}

@Composable
private fun CompactSettingRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    tint: Color,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = screenTokens.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(22.dp))
        Column(Modifier.weight(1f).padding(start = screenTokens.spacing.compact)) {
            Text(title, color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) Text(subtitle, color = PlumMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        trailing?.invoke() ?: if (onClick != null) Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted, modifier = Modifier.size(17.dp)) else Unit
    }
}

@Composable
private fun PlumSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?) {
    Switch(checked = checked, onCheckedChange = onCheckedChange)
}
