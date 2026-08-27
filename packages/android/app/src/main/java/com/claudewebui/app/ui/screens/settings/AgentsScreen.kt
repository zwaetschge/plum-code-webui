package com.claudewebui.app.ui.screens.settings

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
                title = { Text("Custom Agents", fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
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
                Icon(Icons.Default.Add, contentDescription = "Add Agent")
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
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        Icons.Default.SmartToy,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "No custom agents yet",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Tap + to create your first agent",
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
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
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
            title = { Text("Delete Agent") },
            text = { Text("Delete \"${agent.name}\"? This cannot be undone.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            viewModel.deleteAgent(agent.id)
                            deletingAgent = null
                        }
                    },
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingAgent = null }) { Text("Cancel") }
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
    val accentColor = agentColor(agent.color)

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Avatar
                Box(
                    modifier = Modifier
                        .size(48.dp)
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
                            modifier = Modifier.size(24.dp),
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
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                            label = "${agent.allowedTools.size} tool${if (agent.allowedTools.size != 1) "s" else ""}",
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
                        contentDescription = "Duplicate",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = "Edit",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Delete",
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun AgentChip(label: String, color: Color) {
    Box(
        modifier = androidx.compose.ui.Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
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
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Title
            Text(
                if (agent == null) "New Agent" else "Edit Agent",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )

            // Name
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name *") },
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
                label = { Text("Description") },
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
                label = { Text("System Prompt") },
                placeholder = { Text("Instructions for the agent's behavior…") },
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
                label = { Text("Model Override") },
                placeholder = { Text("e.g. glm-5.3 (Z.AI) or sonnet — empty for default") },
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
                label = { Text("Allowed Tools") },
                placeholder = { Text("Bash, Read, Write, Edit (comma-separated)") },
                modifier = Modifier.fillMaxWidth(),
                supportingText = { Text("Leave empty to inherit default tools") },
                minLines = 2,
                maxLines = 4,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // Permission Mode
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Permission Mode",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val modes = listOf("default", "auto", "manual")
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                OutlinedTextField(
                    value = icon,
                    onValueChange = { icon = it },
                    label = { Text("Icon (emoji)") },
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
                    label = { Text("Color (hex)") },
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
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Enable Agent", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text(
                        "Make this agent available in sessions",
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
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Cancel")
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
                    Text(if (agent == null) "Create" else "Save")
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
