package com.claudewebui.app.ui.screens.settings

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
    val state by viewModel.uiState.collectAsState()
    val twoPaneOption by LayoutPrefs.twoPane.collectAsState()
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
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Settings",
                        subtitle = "Connection, providers and app preferences",
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, "Refresh", viewModel::loadSettings)
                        },
                    )
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Server Status", color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Row(Modifier.padding(top = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(10.dp).background(PlumGreen, CircleShape))
                                Column(Modifier.weight(1f).padding(horizontal = 11.dp)) {
                                    Text("Connected to plum-code-webui", color = PlumText, fontWeight = FontWeight.Bold)
                                    Text(state.serverUrl.ifBlank { "Server configured" }, color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                StatusPill("Healthy", PlumGreen)
                            }
                            Box(Modifier.fillMaxWidth().padding(vertical = 13.dp).height(1.dp).background(PlumBorder))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Sync, null, tint = PlumMuted, modifier = Modifier.size(18.dp))
                                Text("  Last sync: just now", color = PlumMuted, fontSize = 12.sp)
                            }
                        }
                    }
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(horizontal = 14.dp, vertical = 13.dp)) {
                            Text("Providers", color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 5.dp))
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
                        first = { groupModifier -> SettingsGroup("Security", groupModifier) {
                            CompactSettingRow(Icons.Outlined.Fingerprint, "Biometric lock", "Use fingerprint", PlumAccent) {
                                PlumSwitch(state.biometricEnabled) { viewModel.setBiometricEnabled(it) }
                            }
                            CompactSettingRow(Icons.Outlined.Security, "Encrypted tokens", "Stored securely", PlumAccent) {
                                Icon(Icons.Outlined.CloudDone, "Enabled", tint = PlumGreen)
                            }
                            CompactSettingRow(
                                Icons.Outlined.Lock,
                                "Permissions",
                                "Per session",
                                PlumAccent,
                                onClick = onNavigateToPermissions,
                            )
                        } },
                        second = { groupModifier -> SettingsGroup("Appearance", groupModifier) {
                            CompactSettingRow(
                                Icons.Outlined.Brightness4,
                                "Theme",
                                state.theme.label,
                                PlumMuted,
                                onClick = { showThemePicker = true },
                            )
                            // The automatic breakpoint measures dp, so a raised
                            // display zoom can hide the two-pane layout on a
                            // screen that plainly has room for it.
                            CompactSettingRow(
                                Icons.Outlined.ViewColumn,
                                "Two-pane layout",
                                twoPaneOption.label + " · " + twoPaneOption.description,
                                PlumMuted,
                                onClick = {
                                    val order = TwoPaneOption.entries
                                    val next = order[(order.indexOf(twoPaneOption) + 1) % order.size]
                                    LayoutPrefs.set(context, next)
                                },
                            )
                        } },
                    )
                }
                item {
                    ResponsiveSettingsPair(
                        first = { groupModifier -> SettingsGroup("Notifications", groupModifier) {
                            val notificationsActive = state.notificationsEnabled &&
                                state.notificationsAllowedBySystem
                            val notificationStatus = when {
                                !state.notificationsAllowedBySystem -> "Blocked by Android settings"
                                notificationsActive -> "Reply, goal and approval alerts"
                                else -> "Off"
                            }
                            CompactSettingRow(Icons.Outlined.Notifications, "Push notifications", notificationStatus, PlumAccent) {
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
                                "Usage alerts",
                                "Quota ≥${com.claudewebui.app.widget.UsageAlerts.LIMIT_THRESHOLD_PERCENT}% " +
                                    "or cost ≥$${"%.0f".format(com.claudewebui.app.widget.UsageAlerts.dailyCostThreshold(context))}/day",
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
                        second = { groupModifier -> SettingsGroup("Advanced", groupModifier) {
                            // The update checker existed but nothing ever called
                            // it — without this row the in-app update path was
                            // unreachable and every install had to be sideloaded.
                            val updateChecker: com.claudewebui.app.core.updates.AppUpdateChecker =
                                org.koin.compose.koinInject()
                            val updateState by updateChecker.updateState.collectAsState()
                            CompactSettingRow(
                                Icons.Outlined.Sync,
                                "App update",
                                when (val u = updateState) {
                                    is com.claudewebui.app.core.updates.UpdateState.UpdateAvailable ->
                                        "Version ${u.newVersion} available — tap to install"
                                    com.claudewebui.app.core.updates.UpdateState.Checking -> "Checking…"
                                    com.claudewebui.app.core.updates.UpdateState.UpToDate -> "Up to date"
                                    is com.claudewebui.app.core.updates.UpdateState.Downloading ->
                                        "Downloading… ${u.progress}%"
                                    else -> "Version ${com.claudewebui.app.BuildConfig.VERSION_NAME} · tap to check"
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
                            CompactSettingRow(Icons.Outlined.SettingsEthernet, "MCP Servers", "${state.mcpServers.size} configured", PlumMuted, onNavigateToMcp)
                            CompactSettingRow(
                                Icons.Outlined.SmartToy,
                                "Agents & Skills",
                                "${state.configAgents.size + state.agents.size} agents · ${state.configSkills.size} skills",
                                PlumMuted,
                                onNavigateToAgents,
                            )
                            CompactSettingRow(Icons.Outlined.Terminal, "CLI Tools", "${state.cliTools.size} tools", PlumMuted, onNavigateToCliTools)
                            CompactSettingRow(
                                Icons.Outlined.Hub,
                                "Integrations",
                                "ComfyUI · Discord · Home Assistant",
                                PlumMuted,
                                onNavigateToIntegrations,
                            )
                            CompactSettingRow(
                                Icons.Outlined.AdminPanelSettings,
                                "Operations",
                                "Containers, watchdogs, audit",
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
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Outlined.ExitToApp, null, tint = PlumRed, modifier = Modifier.size(27.dp))
                            Column(Modifier.weight(1f).padding(start = 13.dp)) {
                                Text("Log out", color = PlumRed, fontWeight = FontWeight.Bold)
                                Text("Sign out of your Plum Code account", color = PlumMuted, fontSize = 12.sp)
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
            title = { Text("Theme", color = PlumText) },
            text = {
                Column {
                    AppThemeOption.entries.forEach { option ->
                        val selected = option == state.theme
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable {
                                    viewModel.updateTheme(option)
                                    showThemePicker = false
                                }
                                .padding(vertical = 11.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(15.dp)
                                    .clip(CircleShape)
                                    .background(if (selected) PlumAccent else Color.Transparent)
                                    .border(1.dp, if (selected) PlumAccent else PlumBorder, CircleShape)
                            )
                            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                Text(option.label, color = PlumText, fontWeight = FontWeight.Medium)
                                Text(option.description, color = PlumMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showThemePicker = false }) { Text("Close", color = PlumAccent) }
            },
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log out?") },
            text = { Text("You can sign in to Plum Code again at any time.") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout(onLoggedOut)
                }) { Text("Log out", color = PlumRed) }
            },
            dismissButton = { TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ProviderRow(provider: CLIProvider, config: CLIProviderConfig?, onClick: () -> Unit) {
    val connected = config?.available ?: (provider == CLIProvider.CODEX || provider == CLIProvider.OPENCODE)
    val enabled = config?.enabled ?: true
    val status = when {
        !enabled -> "Disabled"
        connected -> "Connected"
        else -> "Needs login"
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
            .padding(vertical = 8.dp),
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
    if (rememberWindowWidth() == WindowWidth.COMPACT) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            first(Modifier.fillMaxWidth())
            second(Modifier.fillMaxWidth())
        }
    } else {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            first(Modifier.weight(1f))
            second(Modifier.weight(1f))
        }
    }
}

@Composable
private fun SettingsGroup(title: String, modifier: Modifier, content: @Composable () -> Unit) {
    GlassPanel(modifier, radius = 18.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
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
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(22.dp))
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
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
