package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.CreateCustomAgentInput
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.data.model.UpdateCustomAgentInput
import kotlinx.coroutines.launch
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var showAddSheet by remember { mutableStateOf(false) }
    var editingAgent by remember { mutableStateOf<CustomAgent?>(null) }
    var deletingAgent by remember { mutableStateOf<CustomAgent?>(null) }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(screenResources.getString(R.string.settings_custom_agents_be5ee), fontWeight = FontWeight.SemiBold) },
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
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showAddSheet = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White,
            ) {
                Icon(Icons.Default.Add, contentDescription = screenResources.getString(R.string.settings_add_agent_73287))
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        if (state.agents.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                ) {
                    Icon(
                        Icons.Default.SmartToy,
                        contentDescription = null,
                        modifier = Modifier.size(screenTokens.sizing.touchTarget),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        screenResources.getString(R.string.settings_no_custom_agents_yet_b3b3a),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        screenResources.getString(R.string.settings_tap_to_create_your_first_agent_7b44d),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .padding(horizontal = screenTokens.spacing.lg),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                item { Spacer(Modifier.height(4.dp)) }
                items(state.agents, key = { it.id }) { agent ->
                    AgentCard(
                        agent = agent,
                        onEdit = { editingAgent = agent },
                        onDuplicate = {
                            scope.launch { viewModel.duplicateAgent(agent) }
                        },
                        onDelete = { deletingAgent = agent },
                        onToggle = { enabled ->
                            scope.launch { viewModel.toggleAgent(agent.id, enabled) }
                        },
                    )
                }
                item { Spacer(Modifier.height(88.dp)) }
            }
        }
    }

    // Add sheet
    if (showAddSheet) {
        AgentEditSheet(
            agent = null,
            onDismiss = { showAddSheet = false },
            onSave = { input ->
                scope.launch {
                    viewModel.addAgent(input.toCreateInput())
                    showAddSheet = false
                }
            },
        )
    }

    // Edit sheet
    editingAgent?.let { agent ->
        AgentEditSheet(
            agent = agent,
            onDismiss = { editingAgent = null },
            onSave = { input ->
                scope.launch {
                    viewModel.updateAgent(agent.id, input.toUpdateInput())
                    editingAgent = null
                }
            },
        )
    }

    // Delete confirmation
    deletingAgent?.let { agent ->
        AlertDialog(
            onDismissRequest = { deletingAgent = null },
            title = { Text(screenResources.getString(R.string.settings_delete_agent_09b37)) },
            text = { Text(screenResources.getString(R.string.settings_delete_1_s_this_cannot_be_undone_ef247, agent.name)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            viewModel.deleteAgent(agent.id)
                            deletingAgent = null
                        }
                    },
                ) {
                    Text(screenResources.getString(R.string.settings_delete_f6fdb), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingAgent = null }) { Text(screenResources.getString(R.string.settings_cancel_77dfd)) }
            },
        )
    }
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

@Composable
private fun AgentCard(
    agent: CustomAgent,
    onEdit: () -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    onToggle: (Boolean) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val accentColor = agentColor(agent.color)

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(screenTokens.radius.lg),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(screenTokens.spacing.lg)) {
            // Header row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Avatar
                Box(
                    modifier = Modifier
                        .size(screenTokens.sizing.touchTarget)
                        .clip(CircleShape)
                        .background(accentColor.copy(alpha = if (agent.enabled) 0.2f else 0.08f)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (agent.icon != null) {
                        Text(
                            agent.icon,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    } else {
                        Icon(
                            Icons.Default.Person,
                            contentDescription = null,
                            tint = if (agent.enabled) accentColor else accentColor.copy(alpha = 0.4f),
                            modifier = Modifier.size(screenTokens.sizing.iconLg),
                        )
                    }
                }

                Spacer(Modifier.width(12.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        agent.name,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = if (agent.enabled) MaterialTheme.colorScheme.onSurface
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (!agent.description.isNullOrBlank()) {
                        Text(
                            agent.description ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                        )
                    }
                }

                Switch(
                    checked = agent.enabled,
                    onCheckedChange = onToggle,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = MaterialTheme.colorScheme.primary,
                        checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                    ),
                )
            }

            // Model + tools info
            if (agent.model != null || agent.allowedTools.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(Modifier.height(10.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (agent.model != null) {
                        AgentChip(
                            label = agent.model,
                            color = PlumBlue,
                        )
                    }
                    if (agent.allowedTools.isNotEmpty()) {
                        AgentChip(
                            label = screenResources.getQuantityString(R.plurals.settings_tool_count, agent.allowedTools.size, agent.allowedTools.size),
                            color = PlumGreen,
                        )
                    }
                    agent.permissionMode?.let { mode ->
                        AgentChip(
                            label = mode.replaceFirstChar { it.uppercase() },
                            color = PlumAmber,
                        )
                    }
                }
            }

            // Action row
            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                IconButton(onClick = onDuplicate) {
                    Icon(
                        Icons.Default.ContentCopy,
                        contentDescription = screenResources.getString(R.string.settings_duplicate_972d5),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(screenTokens.sizing.iconMd),
                    )
                }
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = screenResources.getString(R.string.settings_edit_53016),
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(screenTokens.sizing.iconMd),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = screenResources.getString(R.string.settings_delete_f6fdb),
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(screenTokens.sizing.iconMd),
                    )
                }
            }
        }
    }
}

@Composable
private fun AgentChip(label: String, color: Color) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Box(
        modifier = androidx.compose.ui.Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = screenTokens.spacing.sm, vertical = screenTokens.spacing.xs),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Agent Edit Sheet ───────────────────────────────────────────────────────────

data class AgentFormInput(
    val name: String,
    val description: String,
    val systemPrompt: String,
    val model: String,
    val allowedTools: String,
    val permissionMode: String,
    val icon: String,
    val color: String,
    val enabled: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentEditSheet(
    agent: CustomAgent?,
    onDismiss: () -> Unit,
    onSave: (AgentFormInput) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var name by remember { mutableStateOf(agent?.name ?: "") }
    var description by remember { mutableStateOf(agent?.description ?: "") }
    var systemPrompt by remember { mutableStateOf(agent?.systemPrompt ?: "") }
    var model by remember { mutableStateOf(agent?.model ?: "") }
    var allowedTools by remember { mutableStateOf(agent?.allowedTools?.joinToString(", ") ?: "") }
    var permissionMode by remember { mutableStateOf(agent?.permissionMode ?: "default") }
    var icon by remember { mutableStateOf(agent?.icon ?: "") }
    var agentColor by remember { mutableStateOf(agent?.color ?: "#B87333") }
    var enabled by remember { mutableStateOf(agent?.enabled ?: true) }

    val isValid = name.isNotBlank()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = screenTokens.spacing.section)
                .padding(bottom = screenTokens.spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.lg),
        ) {
            // Title
            Text(
                if (agent == null) screenResources.getString(R.string.settings_new_agent_94c53) else screenResources.getString(R.string.settings_edit_agent_07c50),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )

            // Name
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(screenResources.getString(R.string.settings_name_d145b)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // Description
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text(screenResources.getString(R.string.settings_description_55f8e)) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 4,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // System Prompt
            OutlinedTextField(
                value = systemPrompt,
                onValueChange = { systemPrompt = it },
                label = { Text(screenResources.getString(R.string.settings_system_prompt_7bb6c)) },
                placeholder = { Text(screenResources.getString(R.string.settings_instructions_for_the_agent_s_behavior_9e679)) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                maxLines = 10,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // Model
            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text(screenResources.getString(R.string.settings_model_override_9fbf6)) },
                placeholder = { Text(screenResources.getString(R.string.settings_e_g_glm_5_3_z_ai_or_sonnet_empty_for_default_5758d)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // Allowed Tools
            OutlinedTextField(
                value = allowedTools,
                onValueChange = { allowedTools = it },
                label = { Text(screenResources.getString(R.string.settings_allowed_tools_54788)) },
                placeholder = { Text(screenResources.getString(R.string.settings_bash_read_write_edit_comma_separated_428c4)) },
                modifier = Modifier.fillMaxWidth(),
                supportingText = { Text(screenResources.getString(R.string.settings_leave_empty_to_inherit_default_tools_a28ef)) },
                minLines = 2,
                maxLines = 4,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // Permission Mode
            Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
                Text(
                    screenResources.getString(R.string.settings_permission_mode_de70c),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val modes = listOf("default", "auto", "manual")
                Row(
                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    modes.forEach { mode ->
                        FilterChip(
                            selected = permissionMode == mode,
                            onClick = { permissionMode = mode },
                            label = { Text(mode.replaceFirstChar { it.uppercase() }) },
                        )
                    }
                }
            }

            // Icon + Color row
            Row(
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                modifier = Modifier.fillMaxWidth(),
            ) {
                OutlinedTextField(
                    value = icon,
                    onValueChange = { icon = it },
                    label = { Text(screenResources.getString(R.string.settings_icon_emoji_2b894)) },
                    placeholder = { Text("🤖") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        focusedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                )
                OutlinedTextField(
                    value = agentColor,
                    onValueChange = { agentColor = it },
                    label = { Text(screenResources.getString(R.string.settings_color_hex_7c261)) },
                    placeholder = { Text("#B87333") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        focusedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                )
            }

            // Enabled toggle
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = screenTokens.spacing.xs),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(screenResources.getString(R.string.settings_enable_agent_cc689), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text(
                        screenResources.getString(R.string.settings_make_this_agent_available_in_sessions_0447d),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = enabled,
                    onCheckedChange = { enabled = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = MaterialTheme.colorScheme.primary,
                        checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                    ),
                )
            }

            // Save / Cancel
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(screenResources.getString(R.string.settings_cancel_77dfd))
                }
                androidx.compose.material3.Button(
                    onClick = {
                        onSave(
                            AgentFormInput(
                                name = name.trim(),
                                description = description.trim(),
                                systemPrompt = systemPrompt.trim(),
                                model = model.trim(),
                                allowedTools = allowedTools,
                                permissionMode = permissionMode,
                                icon = icon.trim(),
                                color = agentColor.trim(),
                                enabled = enabled,
                            )
                        )
                    },
                    modifier = Modifier.weight(1f),
                    enabled = isValid,
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                    ),
                ) {
                    Text(if (agent == null) screenResources.getString(R.string.settings_create_6e157) else screenResources.getString(R.string.settings_save_efc00))
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun AgentFormInput.toCreateInput() = CreateCustomAgentInput(
    name = name,
    description = description.ifBlank { null },
    systemPrompt = systemPrompt,
    model = model,
    allowedTools = allowedTools.split(",").map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty { null },
    permissionMode = permissionMode.ifBlank { null },
    icon = icon.ifBlank { null },
    color = color.ifBlank { null },
    enabled = enabled,
)

private fun AgentFormInput.toUpdateInput() = UpdateCustomAgentInput(
    name = name,
    description = description.ifBlank { null },
    systemPrompt = systemPrompt,
    model = model,
    allowedTools = allowedTools.split(",").map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty { null },
    permissionMode = permissionMode.ifBlank { null },
    icon = icon.ifBlank { null },
    color = color.ifBlank { null },
    enabled = enabled,
)

// Composable because the fallback now comes from the active theme.
@Composable
private fun agentColor(hex: String?): Color {
    if (hex.isNullOrBlank()) return MaterialTheme.colorScheme.primary
    return try {
        val cleaned = hex.trimStart('#')
        val colorLong = cleaned.toLong(16)
        if (cleaned.length == 6) {
            Color(0xFF000000 or colorLong)
        } else {
            Color(colorLong)
        }
    } catch (_: Exception) {
        MaterialTheme.colorScheme.primary
    }
}
