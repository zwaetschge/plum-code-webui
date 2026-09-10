package com.claudewebui.app.ui.screens.library

import com.claudewebui.app.R
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.chipWidth
import com.claudewebui.app.ui.components.common.isTabletWidth
import com.claudewebui.app.ui.components.common.listColumns
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.SectionHeading
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.screens.settings.SettingsUiState
import com.claudewebui.app.ui.screens.settings.SettingsViewModel
import com.claudewebui.app.data.model.ConfigItemKind
import org.koin.compose.viewmodel.koinViewModel

/**
 * [short] is what fits on the 9sp chip; [label] is the full name used for the
 * section heading and the search placeholder. Without the split, "MCP Servers"
 * and "Commands" wrapped mid-word on the chip.
 */
private enum class LibraryTab(
    private val labelRes: Int,
    private val shortRes: Int,
    val icon: ImageVector,
) {
    AGENTS(R.string.library_agents_64acf, R.string.library_agents_64acf, Icons.Outlined.SmartToy),
    SKILLS(R.string.library_skills_e0921, R.string.library_skills_e0921, Icons.Outlined.Bolt),
    PLUGINS(R.string.library_plugins_ab2e2, R.string.library_plugins_ab2e2, Icons.Outlined.Extension),
    MARKETPLACE(R.string.library_marketplace_98309, R.string.library_market_569bb, Icons.Outlined.Download),
    MCP(R.string.library_mcp_servers_3c23b, R.string.library_mcp_21593, Icons.Outlined.SettingsEthernet),
    COMMANDS(R.string.library_commands_45e5f, R.string.library_cmds_43f37, Icons.Outlined.Terminal),
    STYLES(R.string.library_styles_52db5, R.string.library_styles_52db5, Icons.Outlined.Palette);

    val label: String
        @androidx.compose.runtime.Composable get() = androidx.compose.ui.res.stringResource(labelRes)

    val short: String
        @androidx.compose.runtime.Composable get() = androidx.compose.ui.res.stringResource(shortRes)

}

/**
 * One row of the library, regardless of which catalogue it came from.
 *
 * Agents, skills, plugins, MCP servers, commands and styles all live in
 * different backend shapes but render identically, so each tab flattens its
 * source into this before the list is drawn.
 */
private data class LibraryEntry(
    val id: String,
    val title: String,
    val subtitle: String,
    val meta: String?,
    val enabled: Boolean,
    val accent: Color,
    val icon: ImageVector,
    val onToggle: ((Boolean) -> Unit)? = null,
    val onOpen: (() -> Unit)? = null,
    val actionLabel: String? = null,
    val onAction: (() -> Unit)? = null,
)

@Composable
fun LibraryScreen(
    onNavigateMain: (MainDestination) -> Unit,
    viewModel: SettingsViewModel = koinViewModel(),
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    var tab by remember { mutableStateOf(LibraryTab.AGENTS) }
    var query by remember { mutableStateOf("") }

    // Recovers from the pre-authentication load that the shared ViewModel runs
    // when the navigation graph is built.
    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    val columns = listColumns()
    val entries = entriesFor(tab, state, viewModel)
    val filtered = entries.filter {
        query.isBlank() ||
            it.title.contains(query, true) ||
            it.subtitle.contains(query, true)
    }
    val activeCount = entries.count { it.enabled }

    PlumBackdrop {
        PlumNavScaffold(MainDestination.LIBRARY, onNavigateMain) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
                contentPadding = PaddingValues(bottom = 18.dp + padding.calculateBottomPadding()),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.cozy),
            ) {
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.library_library_b8100),
                        subtitle = screenResources.getString(R.string.library_agents_skills_plugins_and_more_as_plum_ships_them_829eb),
                        actions = {
                            tab.configKind()?.let { kind ->
                                PlumIconButton(
                                    icon = Icons.Outlined.Add,
                                    contentDescription = screenResources.getString(R.string.library_create_1_s_8db05, kind.name.lowercase()),
                                    onClick = { viewModel.createConfigDocument(kind) },
                                )
                            }
                            // Refresh everything: MCP servers come from loadSettings, not the
                            // config-library call.
                            PlumIconButton(Icons.Outlined.Refresh, screenResources.getString(R.string.library_refresh_56e3b), viewModel::loadSettings)
                        },
                    )
                }
                item {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.xs),
                    ) {
                        items(LibraryTab.entries) { item ->
                            LibraryTabCard(
                                tab = item,
                                count = countFor(item, state),
                                selected = item == tab,
                            ) { tab = item }
                        }
                    }
                }
                item {
                    TextField(
                        value = query,
                        onValueChange = { query = it },
                        leadingIcon = { Icon(Icons.Outlined.Search, null, tint = PlumMuted) },
                        placeholder = { Text(screenResources.getString(R.string.library_search_1_s_c89dd, tab.label.lowercase()), color = PlumMuted) },
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = PlumSurfaceStrong,
                            unfocusedContainerColor = PlumSurfaceStrong,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            focusedTextColor = PlumText,
                            unfocusedTextColor = PlumText,
                        ),
                        shape = RoundedCornerShape(screenTokens.radius.lg),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = screenTokens.spacing.cozy)
                            .border(1.dp, PlumBorder, RoundedCornerShape(screenTokens.radius.lg)),
                    )
                }
                item {
                    SectionHeading(
                        title = tab.label,
                        modifier = Modifier.padding(horizontal = screenTokens.spacing.cozy),
                        caption = when {
                            state.libraryLoading && entries.isEmpty() -> screenResources.getString(R.string.library_loading_fd3e3)
                            entries.isEmpty() -> screenResources.getString(R.string.library_0_items_a4d51)
                            else -> screenResources.getString(R.string.library_1_s_of_2_s_3_s_active_c6c65, filtered.size, entries.size, activeCount)
                        },
                    )
                }
                when {
                    // An empty catalogue mid-fetch is indistinguishable from a
                    // genuinely empty one, so say which it is.
                    state.libraryLoading && entries.isEmpty() -> item { LibraryLoading() }

                    filtered.isEmpty() -> item {
                        LibraryEmpty(
                            title = if (entries.isEmpty()) {
                                screenResources.getString(R.string.library_no_1_s_available_00ace, tab.label.lowercase())
                            } else {
                                screenResources.getString(R.string.library_nothing_matches_1_s_970c5, query)
                            },
                            subtitle = emptyHintFor(tab, entries.isEmpty()),
                        )
                    }

                    columns == 1 -> items(filtered, key = { it.id }) { entry ->
                        LibraryRow(entry, Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy))
                    }

                    // Wide screens get columns rather than one very long line
                    // length; chunking keeps this a LazyColumn so the existing
                    // header and search items stay in the same scroll.
                    else -> items(
                        filtered.chunked(columns),
                        key = { row -> row.first().id },
                    ) { row ->
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy),
                            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                        ) {
                            row.forEach { entry ->
                                LibraryRow(entry, Modifier.weight(1f))
                            }
                            repeat(columns - row.size) { Box(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }

    state.libraryEditorKind?.let {
        ConfigEditorSheet(
            document = state.libraryDocument,
            loading = state.libraryEditorLoading,
            saving = state.librarySaving,
            error = state.error,
            onDismiss = viewModel::dismissConfigEditor,
            onSave = viewModel::saveConfigDocument,
            onDelete = viewModel::deleteConfigDocument,
        )
    }
}

private fun LibraryTab.configKind(): ConfigItemKind? = when (this) {
    LibraryTab.AGENTS -> ConfigItemKind.AGENT
    LibraryTab.SKILLS -> ConfigItemKind.SKILL
    LibraryTab.PLUGINS -> ConfigItemKind.PLUGIN
    else -> null
}

/** Item counts for the tab strip — always the full catalogue, never the filtered view. */
private fun countFor(tab: LibraryTab, state: SettingsUiState): Int = when (tab) {
    LibraryTab.AGENTS -> state.configAgents.size + state.agents.size
    LibraryTab.SKILLS -> state.configSkills.size
    LibraryTab.PLUGINS -> state.configPlugins.size
    LibraryTab.MARKETPLACE -> state.configMarketplaces.sumOf { it.plugins.size }
    LibraryTab.MCP -> state.mcpServers.size
    LibraryTab.COMMANDS -> state.commands.size
    LibraryTab.STYLES -> state.designStyles.size + state.writingStyles.size
}

// Composable because the accent colours resolve through the active palette.
@Composable
private fun entriesFor(
    tab: LibraryTab,
    state: SettingsUiState,
    viewModel: SettingsViewModel,
): List<LibraryEntry> {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    return when (tab) {
    LibraryTab.AGENTS -> {
        val onDisk = state.configAgents.map { agent ->
            LibraryEntry(
                id = agent.id,
                title = agent.name,
                subtitle = agent.description.ifBlank { screenResources.getString(R.string.library_agent_definition_d017e) },
                meta = listOfNotNull(
                    agent.model?.takeIf { it.isNotBlank() },
                    agent.tools.size.takeIf { it > 0 }?.let { screenResources.getString(R.string.library_1_s_tools_9d483, it) },
                    agent.source,
                ).joinToString(" · "),
                enabled = agent.enabled,
                accent = PlumAccent,
                icon = Icons.Outlined.SmartToy,
                onToggle = if (agent.source == "user") {
                    { viewModel.toggleConfigAgent(agent.id.removePrefix("user-")) }
                } else null,
                onOpen = if (agent.source == "user") {
                    { viewModel.openConfigDocument(ConfigItemKind.AGENT, agent.id.removePrefix("user-")) }
                } else null,
            )
        }
        // Agents authored in the WebUI database live alongside the on-disk ones.
        val custom = state.agents.map { agent ->
            LibraryEntry(
                id = "db-${agent.id}",
                title = agent.name,
                subtitle = agent.description ?: screenResources.getString(R.string.library_custom_agent_500be),
                meta = screenResources.getString(R.string.library_1_s_custom_4a1ae, agent.model),
                enabled = agent.enabled,
                accent = PlumBlue,
                icon = Icons.Outlined.SmartToy,
                onToggle = { viewModel.toggleAgent(agent.id, it) },
            )
        }
        onDisk + custom
    }

    LibraryTab.SKILLS -> state.configSkills.map { skill ->
        LibraryEntry(
            id = skill.id,
            title = skill.name,
            subtitle = skill.description.ifBlank { screenResources.getString(R.string.library_skill_pack_45ee2) },
            // A disabled skill isn't broken — it's searchable on demand rather
            // than loaded into every prompt. Say that instead of "off".
            meta = if (skill.enabled) screenResources.getString(R.string.library_active_1_s_84528, skill.source) else screenResources.getString(R.string.library_on_demand_1_s_f8596, skill.source),
            enabled = skill.enabled,
            accent = PlumAmber,
            icon = Icons.Outlined.Bolt,
            onToggle = {
                viewModel.toggleConfigSkill(skill.baseName ?: skill.id.removePrefix("user-"))
            },
            onOpen = if (skill.source == "user") {
                {
                    viewModel.openConfigDocument(
                        ConfigItemKind.SKILL,
                        skill.baseName ?: skill.id.removePrefix("user-"),
                    )
                }
            } else null,
        )
    }

    LibraryTab.PLUGINS -> state.configPlugins.map { plugin ->
        LibraryEntry(
            id = plugin.id,
            title = plugin.name,
            subtitle = plugin.description.ifBlank { screenResources.getString(R.string.library_plugin_8dc20) },
            meta = listOfNotNull(
                plugin.version?.let { "v$it" },
                plugin.marketplace ?: plugin.source,
            ).joinToString(" · "),
            enabled = plugin.enabled,
            accent = PlumGreen,
            icon = Icons.Outlined.Extension,
            onToggle = if (plugin.source == "user") {
                { viewModel.toggleConfigPlugin(plugin.id.removePrefix("user-")) }
            } else null,
            onOpen = if (plugin.source == "user") {
                { viewModel.openConfigDocument(ConfigItemKind.PLUGIN, plugin.id.removePrefix("user-")) }
            } else null,
        )
    }

    LibraryTab.MARKETPLACE -> state.configMarketplaces.flatMap { marketplace ->
        marketplace.plugins.map { plugin ->
            val id = "${plugin.name}@${marketplace.id}"
            val installed = state.configPlugins.any {
                it.id == id || (it.name == plugin.name && it.marketplace == marketplace.id)
            }
            val busy = id in state.marketplaceBusyIds
            LibraryEntry(
                id = "market-$id",
                title = plugin.name,
                subtitle = plugin.description.ifBlank { screenResources.getString(R.string.library_marketplace_plugin_67456) },
                meta = "${marketplace.name} · v${plugin.version}",
                enabled = installed,
                accent = PlumGreen,
                icon = Icons.Outlined.Extension,
                actionLabel = when {
                    installed -> screenResources.getString(R.string.library_installed_7bb44)
                    busy -> screenResources.getString(R.string.library_installing_8d278)
                    else -> screenResources.getString(R.string.library_install_fd6c3)
                },
                onAction = if (!installed && !busy) {
                    { viewModel.installMarketplacePlugin(plugin.name, marketplace.id) }
                } else null,
            )
        }
    }

    LibraryTab.MCP -> state.mcpServers.map { server ->
        LibraryEntry(
            id = server.id,
            title = server.name,
            subtitle = server.command ?: server.url ?: screenResources.getString(R.string.library_mcp_server_94cbf),
            meta = server.type.name.lowercase(),
            enabled = server.enabled,
            accent = PlumBlue,
            icon = Icons.Outlined.SettingsEthernet,
        )
    }

    LibraryTab.COMMANDS -> state.commands.map { command ->
        LibraryEntry(
            id = "${command.scope}-${command.name}",
            title = "/${command.name}",
            subtitle = command.description.ifBlank { screenResources.getString(R.string.library_slash_command_f2662) },
            meta = command.scope,
            enabled = true,
            accent = PlumMuted,
            icon = Icons.Outlined.Terminal,
        )
    }

    LibraryTab.STYLES -> {
        val design = state.designStyles.map { it to "design" }
        val writing = state.writingStyles.map { it to "writing" }
        (design + writing).map { (style, kind) ->
            LibraryEntry(
                id = style.id,
                title = style.name,
                subtitle = style.description.ifBlank { screenResources.getString(R.string.library_style_preset_0db1b) },
                meta = kind,
                enabled = style.enabled,
                accent = Color(0xFFFF59B4),
                icon = Icons.Outlined.Palette,
            )
        }
    }
}

}

@Composable
private fun emptyHintFor(tab: LibraryTab, catalogueEmpty: Boolean): String {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    if (!catalogueEmpty) return screenResources.getString(R.string.library_try_a_different_search_term_0ba62)
    return when (tab) {
        LibraryTab.AGENTS -> screenResources.getString(R.string.library_agents_live_in_claude_agents_on_the_server_f78a1)
        LibraryTab.SKILLS -> screenResources.getString(R.string.library_skill_packs_sync_from_the_configured_skills_directories_b37ae)
        LibraryTab.PLUGINS -> screenResources.getString(R.string.library_install_plugins_from_a_marketplace_in_the_webui_bbe1e)
        LibraryTab.MARKETPLACE -> screenResources.getString(R.string.library_add_a_marketplace_in_the_webui_then_refresh_this_page_515d4)
        LibraryTab.MCP -> screenResources.getString(R.string.library_add_servers_in_settings_mcp_servers_24526)
        LibraryTab.COMMANDS -> screenResources.getString(R.string.library_slash_commands_are_provided_by_the_active_harness_a6206)
        LibraryTab.STYLES -> screenResources.getString(R.string.library_style_presets_live_in_claude_style_library_7219e)
    }
}

@Composable
private fun LibraryTabCard(tab: LibraryTab, count: Int, selected: Boolean, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Column(
        modifier = Modifier
            .width(chipWidth())
            .height(78.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) LocalPlumPalette.current.selectionTint else PlumSurfaceStrong)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(7.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(tab.icon, null, tint = if (selected) PlumAccent else PlumMuted, modifier = Modifier.size(screenTokens.sizing.iconInline))
            Spacer(Modifier.weight(1f))
            Text(count.toString(), color = if (selected) PlumAccent else PlumMuted, fontSize = 9.sp)
        }
        Text(
            tab.short,
            color = PlumText,
            fontSize = if (isTabletWidth()) 10.sp else 9.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun LibraryRow(entry: LibraryEntry, modifier: Modifier = Modifier.fillMaxWidth()) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    // Single-column callers take the default and add their own inset; grid
    // callers pass a weighted modifier and the parent Row supplies the padding.
    GlassPanel(
        modifier.then(if (entry.onOpen != null) Modifier.clickable(onClick = entry.onOpen) else Modifier),
        radius = 16.dp,
    ) {
        Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).background(entry.accent.copy(alpha = .15f), RoundedCornerShape(13.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(entry.icon, null, tint = entry.accent)
            }
            Column(Modifier.weight(1f).padding(horizontal = screenTokens.spacing.md)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(entry.title, color = PlumText, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Box(Modifier.padding(start = screenTokens.spacing.inline).size(6.dp).background(if (entry.enabled) PlumGreen else PlumMuted, CircleShape))
                }
                Text(entry.subtitle, color = PlumMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                entry.meta?.takeIf { it.isNotBlank() }?.let {
                    Text(it, color = PlumMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            entry.onToggle?.let { toggle ->
                Switch(
                    checked = entry.enabled,
                    onCheckedChange = toggle,
                    colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = PlumAccent),
                )
            }
            entry.actionLabel?.let { label ->
                Text(
                    label,
                    color = if (entry.onAction != null) PlumAccent else PlumMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .padding(start = screenTokens.spacing.sm)
                        .clip(RoundedCornerShape(50))
                        .background(if (entry.onAction != null) PlumAccent.copy(alpha = .14f) else Color.Transparent)
                        .clickable(enabled = entry.onAction != null) { entry.onAction?.invoke() }
                        .padding(horizontal = screenTokens.spacing.compact, vertical = 7.dp),
                )
            }
            if (entry.onOpen != null) {
                Icon(
                    Icons.Outlined.Edit,
                    contentDescription = screenResources.getString(R.string.library_edit_1_s_5fa4d, entry.title),
                    tint = PlumMuted,
                    modifier = Modifier.padding(start = screenTokens.spacing.sm).size(screenTokens.sizing.iconInline),
                )
            }
        }
    }
}

@Composable
private fun LibraryLoading() {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy), radius = 17.dp) {
        Box(
            Modifier.fillMaxWidth().height(140.dp),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
private fun LibraryEmpty(title: String, subtitle: String) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy), radius = 17.dp) {
        Column(Modifier.fillMaxWidth().padding(30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Extension, null, tint = PlumMuted, modifier = Modifier.size(31.dp))
            Text(title, color = PlumText, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = screenTokens.spacing.sm))
            Text(subtitle, color = PlumMuted, fontSize = 12.sp)
        }
    }
}
