package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CliToolsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()

    // Load CLI tools when screen appears
    LaunchedEffect(Unit) {
        viewModel.loadCliTools()
    }

    val query = state.cliToolSearchQuery
    val filteredTools = state.cliTools.filter { tool ->
        query.isBlank() ||
            tool.name.contains(query, ignoreCase = true) ||
            tool.description.contains(query, ignoreCase = true)
    }

    // Group by category
    val builtinTools = filteredTools.filter { it.category == CliToolCategory.BUILTIN }
    val customTools = filteredTools.filter { it.category == CliToolCategory.CUSTOM }
    val mcpTools = filteredTools.filter { it.category == CliToolCategory.MCP_PROVIDED }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(screenResources.getString(R.string.settings_cli_tools_4b238), fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = screenResources.getString(R.string.settings_back_b52b3))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            // Search bar
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = viewModel::setCliToolSearchQuery,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.sm),
                    placeholder = { Text(screenResources.getString(R.string.settings_search_tools_97829)) },
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconMd))
                    },
                    trailingIcon = {
                        AnimatedVisibility(visible = query.isNotBlank(), enter = fadeIn(), exit = fadeOut()) {
                            IconButton(onClick = { viewModel.setCliToolSearchQuery("") }) {
                                Icon(Icons.Default.Close, contentDescription = screenResources.getString(R.string.settings_clear_719ea), modifier = Modifier.size(screenTokens.sizing.iconInline))
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        focusedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                )
            }

            // Summary chip
            item {
                val enabledCount = state.cliTools.count { it.enabled }
                val totalCount = state.cliTools.size
                Row(
                    modifier = Modifier.padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.xs),
                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(PlumGreen.copy(alpha = 0.15f))
                            .padding(horizontal = screenTokens.spacing.sm, vertical = screenTokens.spacing.xs),
                    ) {
                        Text(
                            screenResources.getString(R.string.settings_1_s_2_s_enabled_82c3a, enabledCount, totalCount),
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumGreen,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }

            // Built-in tools
            if (builtinTools.isNotEmpty()) {
                item {
                    ToolSectionHeader(
                        label = screenResources.getString(R.string.settings_built_in_20f40),
                        icon = Icons.Default.Build,
                        color = MaterialTheme.colorScheme.primary,
                        count = builtinTools.size,
                    )
                }
                item {
                    ToolGroupCard {
                        builtinTools.forEachIndexed { index, tool ->
                            ToolRow(
                                tool = tool,
                                onToggle = { enabled -> viewModel.toggleTool(tool.id, enabled) },
                            )
                            if (index < builtinTools.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = screenTokens.spacing.lg),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            // Custom tools
            if (customTools.isNotEmpty()) {
                item {
                    ToolSectionHeader(
                        label = screenResources.getString(R.string.settings_custom_081ae),
                        icon = Icons.Default.Terminal,
                        color = PlumBlue,
                        count = customTools.size,
                    )
                }
                item {
                    ToolGroupCard {
                        customTools.forEachIndexed { index, tool ->
                            ToolRow(
                                tool = tool,
                                onToggle = { enabled -> viewModel.toggleTool(tool.id, enabled) },
                            )
                            if (index < customTools.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = screenTokens.spacing.lg),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            // MCP-provided tools
            if (mcpTools.isNotEmpty()) {
                item {
                    ToolSectionHeader(
                        label = screenResources.getString(R.string.settings_mcp_provided_04e5b),
                        icon = Icons.Default.Extension,
                        color = PlumAmber,
                        count = mcpTools.size,
                    )
                }
                item {
                    ToolGroupCard {
                        mcpTools.forEachIndexed { index, tool ->
                            ToolRow(
                                tool = tool,
                                onToggle = { enabled -> viewModel.toggleTool(tool.id, enabled) },
                            )
                            if (index < mcpTools.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = screenTokens.spacing.lg),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            if (filteredTools.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                        ) {
                            Icon(
                                Icons.Default.Terminal,
                                contentDescription = null,
                                modifier = Modifier.size(screenTokens.sizing.touchTarget),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                if (query.isBlank()) screenResources.getString(R.string.settings_no_tools_available_44310) else screenResources.getString(R.string.settings_no_tools_match_1_s_e7f18, query),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ── Tool section header ───────────────────────────────────────────────────────

@Composable
private fun ToolSectionHeader(
    label: String,
    icon: ImageVector,
    color: androidx.compose.ui.graphics.Color,
    count: Int,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Row(
        modifier = Modifier.padding(horizontal = screenTokens.spacing.xl, vertical = screenTokens.spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(screenTokens.sizing.iconSm))
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.SemiBold,
        )
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(color.copy(alpha = 0.1f))
                .padding(horizontal = screenTokens.spacing.inline, vertical = screenTokens.spacing.xxs),
        ) {
            Text(
                count.toString(),
                style = MaterialTheme.typography.labelSmall,
                color = color,
            )
        }
    }
}

// ── Tool group card wrapper ───────────────────────────────────────────────────

@Composable
private fun ToolGroupCard(content: @Composable () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = screenTokens.spacing.lg),
        shape = RoundedCornerShape(screenTokens.radius.lg),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        content()
    }
    Spacer(Modifier.height(8.dp))
}

// ── Tool row ──────────────────────────────────────────────────────────────────

@Composable
private fun ToolRow(
    tool: CliTool,
    onToggle: (Boolean) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val categoryColor = when (tool.category) {
        CliToolCategory.BUILTIN -> MaterialTheme.colorScheme.primary
        CliToolCategory.CUSTOM -> PlumBlue
        CliToolCategory.MCP_PROVIDED -> PlumAmber
    }

    ListItem(
        headlineContent = {
            Text(
                tool.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = if (tool.enabled) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        supportingContent = {
            Text(
                tool.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
            )
        },
        leadingContent = {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(screenTokens.radius.chip))
                    .background(categoryColor.copy(alpha = if (tool.enabled) 0.15f else 0.07f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    tool.name.take(2),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (tool.enabled) categoryColor else categoryColor.copy(alpha = 0.4f),
                    fontWeight = FontWeight.Bold,
                )
            }
        },
        trailingContent = {
            Switch(
                checked = tool.enabled,
                onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = MaterialTheme.colorScheme.primary,
                    checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                ),
            )
        },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
    )
}
