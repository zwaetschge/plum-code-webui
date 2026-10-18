package com.claudewebui.app.ui.screens.settings

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Brightness4
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Token
import androidx.compose.material.icons.outlined.ViewColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.core.updates.AppUpdateChecker
import com.claudewebui.app.core.updates.UpdateState
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.ui.components.common.ErrorBanner
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.dashboard.IdlePrefs
import com.claudewebui.app.ui.components.dashboard.IdleThreshold
import com.claudewebui.app.ui.theme.AppBackgroundStyle
import com.claudewebui.app.ui.theme.AppThemeOption
import com.claudewebui.app.ui.theme.LayoutPrefs
import com.claudewebui.app.ui.theme.TwoPaneOption
import com.claudewebui.app.widget.UsageAlerts
import org.koin.compose.koinInject

/** Page ids of the app part of the settings hierarchy (assistant pages: [AssistantPages]). */
private object SettingsPages {
    const val ROOT = "root"
    const val PROVIDERS = "providers"
    const val SUBAGENTS = "subagents"
    const val CODEX_PLUGINS = "codex-plugins"
    const val BROWSER = "browser"
    const val GATEWAY = "gateway"
    const val APPEARANCE = "appearance"
    const val THEME = "theme"
    const val BACKGROUND = "background"
    const val LAYOUT = "layout"
    const val IDLE = "idle"
    const val NOTIFICATIONS = "notifications"
    const val SECURITY = "security"
    const val ABOUT = "about"
}

/** One search hit: a row or subpage, with the path it lives under. */
private class SettingsSearchEntry(
    val title: String,
    val crumb: String,
    val keywords: String,
    val icon: ImageVector,
    val tone: TileTone,
    val open: () -> Unit,
)

/**
 * Settings as one hierarchy, like the system settings app: an account card,
 * the search field and inset groups of rows; every row opens its own page
 * (or one of the existing settings routes). Changes apply immediately.
 */
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateToCliProvider: (String) -> Unit = {},
    onNavigateToMcp: () -> Unit,
    onNavigateToCliTools: () -> Unit,
    onNavigateToAgents: () -> Unit,
    onNavigateToPermissions: () -> Unit,
    onNavigateToIntegrations: () -> Unit,
    onNavigateToConnections: () -> Unit = {},
    onNavigateToOperations: () -> Unit,
    onLoggedOut: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit = {},
    onOpenAssistantFeature: (String) -> Unit = {},
    api: ApiClient = koinInject(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val controller = rememberAssistantSettingsController(api)
    var stackRaw by rememberSaveable { mutableStateOf(SettingsPages.ROOT) }
    val stack = stackRaw.toStack(SettingsPages.ROOT)
    var query by rememberSaveable { mutableStateOf("") }
    var showLogoutDialog by remember { mutableStateOf(false) }
    fun push(id: String) { stackRaw = (stack + id).toStackString() }
    fun pop() { if (stack.size > 1) stackRaw = stack.dropLast(1).toStackString() }
    fun open(vararg ids: String) { query = ""; stackRaw = (listOf(SettingsPages.ROOT) + ids).toStackString() }

    LaunchedEffect(Unit) {
        viewModel.ensureLoaded()
        viewModel.refreshNotificationPermission()
    }
    // Back on the pushed page hands the assistant's pending text edits to the server.
    LaunchedEffect(stack.size) { controller?.flush() }

    val routes = SettingsRoutes(
        cliProvider = onNavigateToCliProvider,
        mcp = onNavigateToMcp,
        cliTools = onNavigateToCliTools,
        agents = onNavigateToAgents,
        permissions = onNavigateToPermissions,
        integrations = onNavigateToIntegrations,
        connections = onNavigateToConnections,
        operations = onNavigateToOperations,
    )

    PlumBackdrop {
        PlumNavScaffold(MainDestination.SETTINGS, onNavigateMain) { padding ->
            val insets = PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding())
            SettingsStack(stack = stack, onPop = ::pop) { id ->
                when {
                    id == SettingsPages.ROOT -> SettingsRoot(
                        state = state,
                        viewModel = viewModel,
                        controller = controller,
                        insets = insets,
                        query = query,
                        onQuery = { query = it },
                        push = ::push,
                        open = { ids -> open(*ids.toTypedArray()) },
                        routes = routes,
                        onLogout = { showLogoutDialog = true },
                    )
                    id in AssistantPages.all -> AssistantSettingsPage(
                        id = id,
                        controller = controller,
                        api = api,
                        contentPadding = insets,
                        onBack = ::pop,
                        push = ::push,
                        openFeature = onOpenAssistantFeature,
                    )
                    else -> AppSettingsPage(id, state, viewModel, insets, ::pop, ::push, routes)
                }
            }
        }
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text(stringResource(R.string.settings_log_out_dd4dd)) },
            text = { Text(stringResource(R.string.settings_you_can_sign_in_to_plum_code_again_at_any_time_cfcf1)) },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout(onLoggedOut)
                }) { Text(stringResource(R.string.settings_log_out_6e78c), color = PlumRed) }
            },
            dismissButton = { TextButton(onClick = { showLogoutDialog = false }) { Text(stringResource(R.string.settings_cancel_77dfd)) } },
        )
    }
}

/** The existing settings routes the rows open. */
private class SettingsRoutes(
    val cliProvider: (String) -> Unit,
    val mcp: () -> Unit,
    val cliTools: () -> Unit,
    val agents: () -> Unit,
    val permissions: () -> Unit,
    val integrations: () -> Unit,
    val connections: () -> Unit,
    val operations: () -> Unit,
)

@Composable
private fun SettingsRoot(
    state: SettingsUiState,
    viewModel: SettingsViewModel,
    controller: AssistantSettingsController?,
    insets: PaddingValues,
    query: String,
    onQuery: (String) -> Unit,
    push: (String) -> Unit,
    open: (List<String>) -> Unit,
    routes: SettingsRoutes,
    onLogout: () -> Unit,
) {
    val connectedProviders = CLIProvider.active.count { provider ->
        state.cliProviders.firstOrNull { it.id.equals(provider.name, ignoreCase = true) }?.let { it.enabled && it.available } ?: false
    }
    val entries = settingsSearchEntries(state, push = { open(it) }, routes = routes)
    SettingsPageScaffold(
        title = stringResource(R.string.settings_settings_c7f73),
        onBack = null,
        contentPadding = insets,
        actions = { PlumIconButton(Icons.Outlined.Refresh, stringResource(R.string.settings_refresh_56e3b), { viewModel.loadSettings(); controller?.load() }) },
    ) {
        state.error?.let { message ->
            item(key = "settings-error") { ErrorBanner(message = message, onRetry = viewModel::loadSettings) }
        }
        item(key = "account") { AccountCard(state) { push(SettingsPages.ABOUT) } }
        item(key = "search") { SettingsSearchField(query, onQuery) }
        if (query.isNotBlank()) {
            val needle = query.trim().lowercase().replace(".", "")
            val hits = entries.filter { (it.title + " " + it.crumb + " " + it.keywords).lowercase().replace(".", "").contains(needle) }
            item(key = "search-results") {
                SettingsGroup {
                    if (hits.isEmpty()) item(hasIcon = false) { SettingsMessage(stringResource(R.string.settings_no_results)) }
                    hits.forEach { hit ->
                        item { SettingsRow(title = hit.title, icon = hit.icon, tone = hit.tone, subtitle = hit.crumb, onClick = hit.open) }
                    }
                }
            }
            return@SettingsPageScaffold
        }
        item(key = "group-assistant") {
            SettingsGroup(header = stringResource(R.string.settings_hub_assistant)) { assistantRows(controller, push) }
        }
        item(key = "group-models") {
            SettingsGroup(header = stringResource(R.string.settings_hub_models_tools)) {
                item { SettingsRow(stringResource(R.string.settings_hub_providers), Icons.Outlined.Hub, TileTone.Accent, value = stringResource(R.string.settings_hub_connected_count, connectedProviders), onClick = { push(SettingsPages.PROVIDERS) }) }
                item { SettingsRow(stringResource(R.string.settings_hub_agents), Icons.Outlined.SmartToy, TileTone.Blue, value = "${state.configAgents.size + state.agents.size} · ${state.configSkills.size}", onClick = routes.agents) }
                item { SettingsRow(stringResource(R.string.settings_hub_subagents), Icons.Outlined.AccountTree, TileTone.Teal, value = state.cliSubagents.size.takeIf { it > 0 }?.toString(), onClick = { push(SettingsPages.SUBAGENTS) }) }
                item { SettingsRow(stringResource(R.string.settings_hub_mcp), Icons.Outlined.SettingsEthernet, TileTone.Indigo, value = state.mcpServers.size.toString(), onClick = routes.mcp) }
                item { SettingsRow(stringResource(R.string.settings_hub_cli_tools), Icons.Outlined.Terminal, TileTone.Gray, value = state.cliTools.size.toString(), onClick = routes.cliTools) }
                item { SettingsRow(stringResource(R.string.settings_hub_codex_plugins), Icons.Outlined.Extension, TileTone.Green, value = state.codexPlugins.size.takeIf { it > 0 }?.toString(), onClick = { push(SettingsPages.CODEX_PLUGINS) }) }
            }
        }
        item(key = "group-connections") {
            SettingsGroup(header = stringResource(R.string.settings_hub_connections)) {
                item { SettingsRow(stringResource(R.string.settings_hub_ssh), Icons.Outlined.Dns, TileTone.Gray, onClick = routes.connections) }
                item { SettingsRow(stringResource(R.string.settings_hub_integrations), Icons.Outlined.Hub, TileTone.Orange, subtitle = stringResource(R.string.settings_comfyui_discord_home_assistant_b5f60), onClick = routes.integrations) }
                item { SettingsRow(stringResource(R.string.settings_hub_browser), Icons.Outlined.Language, TileTone.Orange, value = state.browserConnections.size.takeIf { it > 0 }?.toString(), onClick = { push(SettingsPages.BROWSER) }) }
                item { SettingsRow(stringResource(R.string.settings_hub_gateway), Icons.Outlined.Token, TileTone.Violet, value = state.gatewayTokens.size.takeIf { it > 0 }?.toString(), onClick = { push(SettingsPages.GATEWAY) }) }
            }
        }
        item(key = "group-app") {
            SettingsGroup(header = stringResource(R.string.settings_hub_app)) {
                item { SettingsRow(stringResource(R.string.settings_hub_appearance), Icons.Outlined.Palette, TileTone.Blue, value = state.theme.localizedLabel(LocalContext.current.resources), onClick = { push(SettingsPages.APPEARANCE) }) }
                item { SettingsRow(stringResource(R.string.settings_hub_notifications), Icons.Outlined.Notifications, TileTone.Red, value = stringResource(if (state.notificationsEnabled && state.notificationsAllowedBySystem) R.string.settings_hub_on else R.string.settings_hub_off), onClick = { push(SettingsPages.NOTIFICATIONS) }) }
                item { SettingsRow(stringResource(R.string.settings_hub_security), Icons.Outlined.Security, TileTone.Gray, onClick = { push(SettingsPages.SECURITY) }) }
                item { SettingsRow(stringResource(R.string.settings_hub_operations), Icons.Outlined.AdminPanelSettings, TileTone.Amber, subtitle = stringResource(R.string.settings_containers_watchdogs_audit_a3e6e), onClick = routes.operations) }
                item { SettingsRow(stringResource(R.string.settings_hub_about), Icons.Outlined.Info, TileTone.Gray, value = BuildConfig.VERSION_NAME, onClick = { push(SettingsPages.ABOUT) }) }
            }
        }
        item(key = "group-logout") {
            SettingsGroup {
                item { SettingsRow(stringResource(R.string.settings_hub_logout), Icons.AutoMirrored.Outlined.ExitToApp, destructive = true, chevron = false, onClick = onLogout) }
            }
        }
    }
}

@Composable
private fun AccountCard(state: SettingsUiState, onClick: () -> Unit) {
    val user = state.currentUser
    val name = user?.name?.ifBlank { null } ?: user?.email?.substringBefore('@') ?: stringResource(R.string.settings_hub_account_fallback)
    val (statusText, statusColor) = when {
        state.isLoading -> stringResource(R.string.settings_hub_server_checking) to PlumAmber
        state.error != null -> stringResource(R.string.settings_hub_server_error) to PlumRed
        else -> stringResource(R.string.settings_hub_server_online) to PlumGreen
    }
    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(CircleShape)) {
                AvatarInitial(name, 56.dp)
                user?.avatarUrl?.takeIf { it.isNotBlank() }?.let { url -> AsyncImage(url, null, Modifier.size(56.dp).clip(CircleShape)) }
            }
            Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                user?.email?.let { Text(it, color = PlumMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Box(Modifier.size(8.dp).background(statusColor, CircleShape))
                    Text(
                        "${stringResource(R.string.settings_hub_server)} · $statusText · ${stringResource(R.string.settings_hub_version, BuildConfig.VERSION_NAME)}",
                        color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(start = 7.dp),
                    )
                }
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted)
        }
    }
}

@Composable
private fun SettingsSearchField(query: String, onQuery: (String) -> Unit) {
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        singleLine = true,
        placeholder = { Text(stringResource(R.string.settings_search)) },
        leadingIcon = { Icon(Icons.Outlined.Search, null, tint = PlumMuted) },
        trailingIcon = if (query.isNotEmpty()) ({
            IconButton(onClick = { onQuery("") }) { Icon(Icons.Outlined.Close, stringResource(R.string.settings_close_bbfa7), tint = PlumMuted) }
        }) else null,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun settingsSearchEntries(state: SettingsUiState, push: (List<String>) -> Unit, routes: SettingsRoutes): List<SettingsSearchEntry> {
    val assistant = stringResource(R.string.settings_hub_assistant)
    val models = stringResource(R.string.settings_hub_models_tools)
    val connections = stringResource(R.string.settings_hub_connections)
    val app = stringResource(R.string.settings_hub_app)
    val voice = stringResource(R.string.settings_hub_voice)
    val personal = stringResource(R.string.settings_hub_personalization)
    val appearance = stringResource(R.string.settings_hub_appearance)
    val providers = stringResource(R.string.settings_hub_providers)
    fun path(vararg ids: String): () -> Unit = { push(ids.toList()) }
    return buildList {
        add(SettingsSearchEntry(voice, assistant, "stimme voice tts vorlesen read aloud sprache speech sprachchat", Icons.Outlined.RecordVoiceOver, TileTone.Pink, path(AssistantPages.VOICE)))
        add(SettingsSearchEntry(stringResource(R.string.assistant_voice_pick), "$assistant › $voice", "stimme voice omnivoice mistral rufus beck sprecher", Icons.Outlined.RecordVoiceOver, TileTone.Violet, path(AssistantPages.VOICE, AssistantPages.VOICE_PICKER)))
        add(SettingsSearchEntry(personal, assistant, "personalisierung personalization", Icons.Outlined.Person, TileTone.Violet, path(AssistantPages.PERSONAL)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_profile), "$assistant › $personal", "name beruf über dich about nickname occupation profil", Icons.Outlined.AutoAwesome, TileTone.Blue, path(AssistantPages.PERSONAL, AssistantPages.PROFILE)))
        add(SettingsSearchEntry(stringResource(R.string.assistant_reference_photos), "$assistant › $personal", "foto photo bild porträt portrait referenz", Icons.Outlined.AutoAwesome, TileTone.Green, path(AssistantPages.PERSONAL, AssistantPages.PHOTOS)))
        add(SettingsSearchEntry(stringResource(R.string.assistant_writing_style), "$assistant › $personal", "schreibstil writing style probe sample", Icons.Outlined.AutoAwesome, TileTone.Orange, path(AssistantPages.PERSONAL, AssistantPages.WRITING)))
        add(SettingsSearchEntry(stringResource(R.string.assistant_response_style), "$assistant › $personal", "antwortstil ton tone emoji herzlichkeit", Icons.Outlined.AutoAwesome, TileTone.Violet, path(AssistantPages.PERSONAL, AssistantPages.RESPONSE)))
        add(SettingsSearchEntry(stringResource(R.string.assistant_custom_instructions), "$assistant › $personal", "anweisungen instructions prompt", Icons.Outlined.AutoAwesome, TileTone.Teal, path(AssistantPages.PERSONAL, AssistantPages.INSTRUCTIONS)))
        add(SettingsSearchEntry(stringResource(R.string.preset_default_design), "$assistant › $personal", "design vorgabe preset", Icons.Outlined.Palette, TileTone.Pink, path(AssistantPages.PERSONAL)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_memory), assistant, "gedächtnis memory erinnerungen verlauf history", Icons.Outlined.Psychology, TileTone.Indigo, path(AssistantPages.MEMORY)))
        add(SettingsSearchEntry(providers, models, "anbieter provider codex opencode claude pi vibe login api modell model", Icons.Outlined.Hub, TileTone.Accent, path(SettingsPages.PROVIDERS)))
        CLIProvider.active.forEach { provider ->
            add(SettingsSearchEntry(provider.displayName, "$models › $providers", "provider anbieter ${provider.name.lowercase()}", Icons.Outlined.Terminal, TileTone.Accent) { routes.cliProvider(provider.name.lowercase()) })
        }
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_upstreams), "$models › $providers", "upstreams zai api subagenten", Icons.Outlined.Hub, TileTone.Accent, path(SettingsPages.PROVIDERS)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_agents), models, "agents agenten skills", Icons.Outlined.SmartToy, TileTone.Blue, routes.agents))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_subagents), models, "subagenten subagents cli worker", Icons.Outlined.AccountTree, TileTone.Teal, path(SettingsPages.SUBAGENTS)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_mcp), models, "mcp tools server", Icons.Outlined.SettingsEthernet, TileTone.Indigo, routes.mcp))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_cli_tools), models, "cli tools werkzeuge", Icons.Outlined.Terminal, TileTone.Gray, routes.cliTools))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_codex_plugins), models, "codex plugins", Icons.Outlined.Extension, TileTone.Green, path(SettingsPages.CODEX_PLUGINS)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_ssh), connections, "ssh host server verbindungen connections jump schlüssel key", Icons.Outlined.Dns, TileTone.Gray, routes.connections))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_integrations), connections, "discord home assistant comfyui integrationen", Icons.Outlined.Hub, TileTone.Orange, routes.integrations))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_browser), connections, "browser firefox chrome edge erweiterung extension koppeln pair steuerung", Icons.Outlined.Language, TileTone.Orange, path(SettingsPages.BROWSER)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_gateway), connections, "gateway token supervisor hermes api", Icons.Outlined.Token, TileTone.Violet, path(SettingsPages.GATEWAY)))
        add(SettingsSearchEntry(appearance, app, "darstellung appearance design theme modus dunkel hell eink", Icons.Outlined.Palette, TileTone.Blue, path(SettingsPages.APPEARANCE)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_theme), "$app › $appearance", "theme modus dark light dunkel hell e-ink", Icons.Outlined.Brightness4, TileTone.Blue, path(SettingsPages.APPEARANCE, SettingsPages.THEME)))
        add(SettingsSearchEntry(stringResource(R.string.settings_background_title), "$app › $appearance", "background wallpaper hintergrund waves rain neon galaxy", Icons.Outlined.AutoAwesome, TileTone.Violet, path(SettingsPages.APPEARANCE, SettingsPages.BACKGROUND)))
        add(SettingsSearchEntry(stringResource(R.string.settings_two_pane_layout_e5d18), "$app › $appearance", "layout zwei spalten two pane tablet fold", Icons.Outlined.ViewColumn, TileTone.Teal, path(SettingsPages.APPEARANCE, SettingsPages.LAYOUT)))
        add(SettingsSearchEntry(stringResource(R.string.settings_call_a_session_quiet_after_6f50e), "$app › $appearance", "leerlauf idle inaktiv quiet", Icons.Outlined.Timer, TileTone.Amber, path(SettingsPages.APPEARANCE, SettingsPages.IDLE)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_notifications), app, "mitteilungen notifications push meldungen nutzung usage warnung", Icons.Outlined.Notifications, TileTone.Red, path(SettingsPages.NOTIFICATIONS)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_security), app, "berechtigungen permissions sicherheit security biometrie fingerabdruck", Icons.Outlined.Security, TileTone.Gray, path(SettingsPages.SECURITY)))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_operations), app, "betrieb operations container watchdog audit", Icons.Outlined.AdminPanelSettings, TileTone.Amber, routes.operations))
        add(SettingsSearchEntry(stringResource(R.string.settings_hub_about), app, "update version download info server", Icons.Outlined.Info, TileTone.Gray, path(SettingsPages.ABOUT)))
    }
}

@Composable
private fun AppSettingsPage(
    id: String,
    state: SettingsUiState,
    viewModel: SettingsViewModel,
    insets: PaddingValues,
    onBack: () -> Unit,
    push: (String) -> Unit,
    routes: SettingsRoutes,
) {
    val context = LocalContext.current
    val resources = context.resources
    val twoPane by LayoutPrefs.twoPane.collectAsStateWithLifecycle()
    val idle by IdlePrefs.threshold.collectAsStateWithLifecycle()
    val title = when (id) {
        SettingsPages.PROVIDERS -> stringResource(R.string.settings_hub_providers)
        SettingsPages.SUBAGENTS -> stringResource(R.string.settings_hub_subagents)
        SettingsPages.CODEX_PLUGINS -> stringResource(R.string.settings_hub_codex_plugins)
        SettingsPages.BROWSER -> stringResource(R.string.settings_hub_browser)
        SettingsPages.GATEWAY -> stringResource(R.string.settings_hub_gateway)
        SettingsPages.APPEARANCE -> stringResource(R.string.settings_hub_appearance)
        SettingsPages.THEME -> stringResource(R.string.settings_hub_theme)
        SettingsPages.BACKGROUND -> stringResource(R.string.settings_background_title)
        SettingsPages.LAYOUT -> stringResource(R.string.settings_two_pane_layout_e5d18)
        SettingsPages.IDLE -> stringResource(R.string.settings_call_a_session_quiet_after_6f50e)
        SettingsPages.NOTIFICATIONS -> stringResource(R.string.settings_hub_notifications)
        SettingsPages.SECURITY -> stringResource(R.string.settings_hub_security)
        else -> stringResource(R.string.settings_hub_about)
    }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> viewModel.onNotificationPermissionResult(granted) }
    val updateChecker: AppUpdateChecker = koinInject()
    val updateState by updateChecker.updateState.collectAsStateWithLifecycle()
    var usageAlerts by remember { mutableStateOf(UsageAlerts.isEnabled(context)) }

    SettingsPageScaffold(title, onBack, contentPadding = insets) {
        when (id) {
            SettingsPages.PROVIDERS -> {
                item(key = "cli-providers") {
                    SettingsGroup(header = stringResource(R.string.settings_hub_cli_providers)) {
                        CLIProvider.active.forEach { provider ->
                            item {
                                val config = state.cliProviders.firstOrNull { it.id.equals(provider.name, ignoreCase = true) }
                                val connected = config?.available ?: (provider == CLIProvider.CODEX || provider == CLIProvider.OPENCODE)
                                val enabled = config?.enabled ?: true
                                SettingsRow(
                                    title = provider.displayName,
                                    icon = Icons.Outlined.Terminal,
                                    tileColor = providerColor(provider),
                                    value = when {
                                        !enabled -> stringResource(R.string.settings_disabled_f4f44)
                                        connected -> stringResource(R.string.settings_connected_c2f9b)
                                        else -> stringResource(R.string.settings_needs_login_1867b)
                                    },
                                    onClick = { routes.cliProvider(provider.name.lowercase()) },
                                )
                            }
                        }
                    }
                }
                item(key = "upstreams") { SubagentUpstreamsPanel(state = state, viewModel = viewModel) }
            }
            SettingsPages.SUBAGENTS -> item(key = "subagents") { CliSubagentsPanel(state = state, viewModel = viewModel) }
            SettingsPages.CODEX_PLUGINS -> item(key = "codex") { CodexPluginsPanel(state = state, viewModel = viewModel) }
            SettingsPages.BROWSER -> {
                item(key = "browser") { FirefoxBrowserPanel(state = state, viewModel = viewModel) }
                item(key = "desktop") { DesktopCompanionPanel() }
                item(key = "device-control") { DeviceControlPanel() }
            }
            SettingsPages.GATEWAY -> item(key = "gateway") { GatewayTokensPanel(state = state, viewModel = viewModel) }
            SettingsPages.APPEARANCE -> {
                item(key = "look") {
                    SettingsGroup {
                        item { SettingsRow(stringResource(R.string.settings_hub_theme), Icons.Outlined.Brightness4, TileTone.Blue, value = state.theme.localizedLabel(resources), onClick = { push(SettingsPages.THEME) }) }
                        item {
                            val eink = state.theme == AppThemeOption.EINK
                            SettingsRow(
                                stringResource(R.string.settings_background_title), Icons.Outlined.AutoAwesome, TileTone.Violet,
                                subtitle = if (eink) stringResource(R.string.settings_background_eink_disabled) else null,
                                value = if (eink) null else state.backgroundStyle.localizedLabel(resources),
                                enabled = !eink,
                                onClick = { push(SettingsPages.BACKGROUND) },
                            )
                        }
                    }
                }
                item(key = "sync") {
                    SettingsGroup(footer = stringResource(R.string.settings_appearance_sync_description)) {
                        item {
                            SettingsSwitchRow(
                                stringResource(R.string.settings_appearance_sync),
                                state.userSettings?.appearanceSync == true,
                                { viewModel.updateAppearanceSync(it) },
                                Icons.Outlined.Sync, TileTone.Green,
                                enabled = state.userSettings != null && !state.appearanceSaving,
                            )
                        }
                    }
                }
                item(key = "layout") {
                    SettingsGroup {
                        item { SettingsRow(stringResource(R.string.settings_two_pane_layout_e5d18), Icons.Outlined.ViewColumn, TileTone.Teal, value = twoPane.localizedLabel(resources), onClick = { push(SettingsPages.LAYOUT) }) }
                        item { SettingsRow(stringResource(R.string.settings_call_a_session_quiet_after_6f50e), Icons.Outlined.Timer, TileTone.Amber, value = idle.label, onClick = { push(SettingsPages.IDLE) }) }
                    }
                }
            }
            SettingsPages.THEME -> item(key = "themes") {
                SettingsGroup {
                    AppThemeOption.entries.forEach { option ->
                        item(hasIcon = false) {
                            SettingsOptionRow(option.localizedLabel(resources), option == state.theme, { viewModel.updateTheme(option) }, subtitle = option.localizedDescription(resources))
                        }
                    }
                }
            }
            SettingsPages.BACKGROUND -> item(key = "backgrounds") {
                SettingsGroup {
                    AppBackgroundStyle.entries.forEach { option ->
                        item {
                            SettingsOptionRow(
                                option.localizedLabel(resources), option == state.backgroundStyle, { viewModel.updateBackgroundStyle(option) },
                                subtitle = option.localizedDescription(resources),
                                enabled = state.theme != AppThemeOption.EINK,
                                leading = { BackgroundSwatch(option) },
                            )
                        }
                    }
                }
            }
            SettingsPages.LAYOUT -> item(key = "layouts") {
                SettingsGroup {
                    TwoPaneOption.entries.forEach { option ->
                        item(hasIcon = false) {
                            SettingsOptionRow(option.localizedLabel(resources), option == twoPane, { LayoutPrefs.set(context, option) }, subtitle = option.localizedDescription(resources))
                        }
                    }
                }
            }
            SettingsPages.IDLE -> item(key = "idle") {
                SettingsGroup(footer = stringResource(R.string.settings_then_the_card_stops_claiming_it_is_working_e4e6d).trim().trimStart('·').trim()) {
                    IdleThreshold.entries.forEach { option ->
                        item(hasIcon = false) { SettingsOptionRow(option.label, option == idle, { IdlePrefs.set(context, option) }) }
                    }
                }
            }
            SettingsPages.NOTIFICATIONS -> item(key = "notifications") {
                val active = state.notificationsEnabled && state.notificationsAllowedBySystem
                SettingsGroup {
                    item {
                        SettingsSwitchRow(
                            stringResource(R.string.settings_push_notifications_03be2),
                            active,
                            { enable ->
                                when {
                                    !enable -> viewModel.setNotificationsEnabled(false)
                                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                        !LocalNotificationManager.hasNotificationPermission(context) ->
                                        LocalNotificationManager.requestNotificationPermission(notificationPermissionLauncher)
                                    else -> viewModel.setNotificationsEnabled(true)
                                }
                            },
                            Icons.Outlined.Notifications, TileTone.Red,
                            subtitle = when {
                                !state.notificationsAllowedBySystem -> stringResource(R.string.settings_blocked_by_android_settings_2f8f9)
                                active -> stringResource(R.string.settings_reply_goal_and_approval_alerts_52963)
                                else -> stringResource(R.string.settings_off_e3de5)
                            },
                        )
                    }
                    item {
                        SettingsSwitchRow(
                            stringResource(R.string.settings_usage_alerts_ca98c),
                            usageAlerts,
                            { enable ->
                                usageAlerts = enable
                                UsageAlerts.setEnabled(context, enable)
                                // The account-wide setting stays authoritative so the WebUI sees the same thresholds.
                                viewModel.updateUsageAlerts(enabled = enable)
                            },
                            Icons.Outlined.Speed, TileTone.Amber,
                            subtitle = stringResource(R.string.settings_quota_1_s_2c324, UsageAlerts.LIMIT_THRESHOLD_PERCENT) +
                                stringResource(R.string.settings_or_cost_1_s_day_edc99, "%.0f".format(UsageAlerts.dailyCostThreshold(context))),
                        )
                    }
                }
            }
            SettingsPages.SECURITY -> item(key = "security") {
                SettingsGroup(footer = stringResource(R.string.settings_controls_the_active_harness_per_session_04007)) {
                    item { SettingsSwitchRow(stringResource(R.string.settings_biometric_lock_20972), state.biometricEnabled, { viewModel.setBiometricEnabled(it) }, Icons.Outlined.Fingerprint, TileTone.Green, subtitle = stringResource(R.string.settings_use_fingerprint_8b19c)) }
                    item {
                        SettingsRow(
                            stringResource(R.string.settings_encrypted_tokens_9a220), Icons.Outlined.Lock, TileTone.Gray,
                            subtitle = stringResource(R.string.settings_stored_securely_4f6fe),
                            trailing = { Icon(Icons.Outlined.CloudDone, stringResource(R.string.settings_enabled_df174), tint = PlumGreen) },
                        )
                    }
                    item { SettingsRow(stringResource(R.string.settings_permissions_d06d5), Icons.Outlined.Security, TileTone.Blue, subtitle = stringResource(R.string.settings_per_session_66a54), onClick = routes.permissions) }
                }
            }
            else -> {
                item(key = "server") {
                    SettingsGroup(header = stringResource(R.string.settings_hub_server)) {
                        item(hasIcon = false) {
                            SettingsRow(
                                title = state.serverUrl.ifBlank { stringResource(R.string.settings_server_configured_c7807) },
                                subtitle = when {
                                    state.isLoading -> stringResource(R.string.settings_hub_server_checking)
                                    state.error != null -> state.error
                                    else -> stringResource(R.string.settings_hub_server_online)
                                },
                                trailing = {
                                    Box(Modifier.size(10.dp).background(if (state.error != null) PlumRed else if (state.isLoading) PlumAmber else PlumGreen, CircleShape))
                                },
                            )
                        }
                    }
                }
                item(key = "app") {
                    SettingsGroup(header = stringResource(R.string.settings_hub_app)) {
                        item {
                            SettingsRow(
                                title = stringResource(R.string.settings_app_update_45b5d),
                                icon = Icons.Outlined.Sync,
                                tone = TileTone.Blue,
                                subtitle = when (val u = updateState) {
                                    is UpdateState.UpdateAvailable -> stringResource(R.string.settings_version_1_s_available_tap_to_install_4cc36, u.newVersion)
                                    UpdateState.Checking -> stringResource(R.string.settings_checking_820d6)
                                    UpdateState.UpToDate -> stringResource(R.string.settings_up_to_date_82fb1)
                                    is UpdateState.Downloading ->
                                        if (u.progress < 0) stringResource(R.string.update_downloading) else stringResource(R.string.settings_downloading_1_s_926c0, u.progress)
                                    is UpdateState.Error -> u.message
                                    UpdateState.ReadyToInstall -> stringResource(R.string.settings_version_1_s_available_tap_to_install_4cc36, "")
                                    else -> stringResource(R.string.settings_version_1_s_tap_to_check_57029, BuildConfig.VERSION_NAME)
                                },
                                chevron = false,
                                onClick = {
                                    when (val current = updateState) {
                                        is UpdateState.UpdateAvailable -> updateChecker.downloadAndInstall(current.downloadUrl)
                                        UpdateState.ReadyToInstall -> updateChecker.installReadyUpdate()
                                        is UpdateState.Downloading -> Unit
                                        else -> updateChecker.checkForUpdate()
                                    }
                                },
                            )
                        }
                        item { SettingsRow(stringResource(R.string.settings_hub_version, BuildConfig.VERSION_NAME), Icons.Outlined.Info, TileTone.Gray) }
                    }
                }
            }
        }
    }
}

@Composable
private fun BackgroundSwatch(option: AppBackgroundStyle) {
    val colors = when (option) {
        AppBackgroundStyle.AURORA -> listOf(Color(0xFF53357F), Color(0xFF3A89A5), Color(0xFFAE5D9F))
        AppBackgroundStyle.GLASS -> listOf(Color(0xFF829DAA), Color(0xFFBDD2D7), Color(0xFF777B9C))
        AppBackgroundStyle.RIBBONS -> listOf(Color(0xFF192044), Color(0xFF00A7BD), Color(0xFFE243BD))
        AppBackgroundStyle.STILL -> listOf(Color(0xFF24183D), Color(0xFF294963), Color(0xFF7E4A8D))
    }
    Spacer(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(Brush.linearGradient(colors)))
}
