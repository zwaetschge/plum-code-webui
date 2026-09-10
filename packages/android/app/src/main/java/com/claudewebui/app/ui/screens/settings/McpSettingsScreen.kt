package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.McpServerType
import kotlinx.coroutines.launch
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServer?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(screenResources.getString(R.string.settings_mcp_servers_3c23b), fontWeight = FontWeight.SemiBold) },
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
                Icon(Icons.Default.Add, contentDescription = screenResources.getString(R.string.settings_add_mcp_server_fea74))
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(innerPadding)
                .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.sm),
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
        ) {
            if (state.mcpServers.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                    ) {
                        Icon(
                            Icons.Default.Extension,
                            contentDescription = null,
                            modifier = Modifier.size(screenTokens.sizing.touchTarget),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            screenResources.getString(R.string.settings_no_mcp_servers_configured_a6d33),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            screenResources.getString(R.string.settings_tap_to_connect_a_model_context_protocol_server_b2c77),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            state.mcpServers.forEach { server ->
                McpServerCard(
                    server = server,
                    testResult = state.mcpTestResults[server.id] ?: TestResult.Idle,
                    isExpanded = server.id in state.expandedMcpIds,
                    onToggleExpand = { viewModel.toggleMcpExpanded(server.id) },
                    onToggleEnabled = { enabled ->
                        viewModel.updateMcpServer(server.id, enabled = enabled)
                    },
                    onEdit = { editingServer = server },
                    onDelete = { viewModel.deleteMcpServer(server.id) },
                    onTest = { viewModel.testMcpConnection(server.id) },
                )
            }

            Spacer(Modifier.height(72.dp))
        }
    }

    // ── Add sheet ─────────────────────────────────────────────────────────────
    if (showAddSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAddSheet = false },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            McpServerEditForm(
                server = null,
                onSave = { name, type, url, command, args, env ->
                    viewModel.addMcpServer(name, type, url, command, args, env)
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showAddSheet = false }
                },
                onCancel = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showAddSheet = false }
                },
            )
        }
    }

    // ── Edit sheet ────────────────────────────────────────────────────────────
    editingServer?.let { server ->
        ModalBottomSheet(
            onDismissRequest = { editingServer = null },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            McpServerEditForm(
                server = server,
                onSave = { name, type, url, command, _, _ ->
                    viewModel.updateMcpServer(server.id, name = name, url = url, command = command)
                    scope.launch { sheetState.hide() }.invokeOnCompletion { editingServer = null }
                },
                onCancel = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { editingServer = null }
                },
            )
        }
    }
}

// ── MCP server card ───────────────────────────────────────────────────────────

@Composable
private fun McpServerCard(
    server: McpServer,
    testResult: TestResult,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    onToggleEnabled: (Boolean) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var showDeleteConfirm by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(screenTokens.radius.lg),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            ListItem(
                headlineContent = {
                    Text(server.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                },
                supportingContent = {
                    Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.xxs)) {
                        // Type badge
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(
                                        if (server.type == McpServerType.SSE)
                                            PlumBlue.copy(alpha = 0.15f)
                                        else
                                            MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                                    )
                                    .padding(horizontal = screenTokens.spacing.inline, vertical = screenTokens.spacing.xxs),
                            ) {
                                Text(
                                    text = server.type.name,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (server.type == McpServerType.SSE) PlumBlue else MaterialTheme.colorScheme.primary,
                                )
                            }

                            // Status dot
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(androidx.compose.foundation.shape.CircleShape)
                                    .background(
                                        if (server.enabled) PlumGreen
                                        else MaterialTheme.colorScheme.onSurfaceVariant
                                    ),
                            )
                            Text(
                                if (server.enabled) screenResources.getString(R.string.settings_enabled_df174) else screenResources.getString(R.string.settings_disabled_f4f44),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        // URL or command
                        val address = server.url ?: server.command
                        if (address != null) {
                            Text(
                                address,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                },
                leadingContent = {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(screenTokens.radius.md))
                            .background(PlumBlue.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Default.Extension,
                            contentDescription = null,
                            tint = PlumBlue,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                },
                trailingContent = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Switch(
                            checked = server.enabled,
                            onCheckedChange = onToggleEnabled,
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = MaterialTheme.colorScheme.primary,
                                checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                            ),
                        )
                    }
                },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
            )

            HorizontalDivider(
                modifier = Modifier.padding(horizontal = screenTokens.spacing.lg),
                color = MaterialTheme.colorScheme.outlineVariant,
            )

            // Action row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = screenTokens.spacing.md, vertical = screenTokens.spacing.sm),
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Test button
                FilledTonalButton(
                    onClick = onTest,
                    enabled = testResult !is TestResult.Testing,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(screenTokens.radius.chip),
                ) {
                    AnimatedContent(
                        targetState = testResult,
                        transitionSpec = { fadeIn() togetherWith fadeOut() },
                        label = "mcp_test",
                    ) { result ->
                        when (result) {
                            is TestResult.Testing -> Row(
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(screenTokens.sizing.iconXs), strokeWidth = 2.dp)
                                Text(screenResources.getString(R.string.settings_testing_95c45), style = MaterialTheme.typography.labelMedium)
                            }
                            is TestResult.Success -> Row(
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Default.Check, contentDescription = null, tint = PlumGreen, modifier = Modifier.size(screenTokens.sizing.iconXs))
                                Text(screenResources.getString(R.string.settings_connected_c2f9b), style = MaterialTheme.typography.labelMedium, color = PlumGreen)
                            }
                            is TestResult.Failure -> Row(
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Default.Close, contentDescription = null, tint = PlumRed, modifier = Modifier.size(screenTokens.sizing.iconXs))
                                Text(screenResources.getString(R.string.settings_failed_09fef), style = MaterialTheme.typography.labelMedium, color = PlumRed)
                            }
                            else -> Row(
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconXs))
                                Text(screenResources.getString(R.string.settings_test_640ab), style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }

                // Expand tools button
                IconButton(onClick = onToggleExpand) {
                    Icon(
                        if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = if (isExpanded) screenResources.getString(R.string.settings_collapse_9cf18) else screenResources.getString(R.string.settings_show_tools_063a5),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, contentDescription = screenResources.getString(R.string.settings_edit_53016), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                IconButton(onClick = { showDeleteConfirm = true }) {
                    Icon(Icons.Default.Delete, contentDescription = screenResources.getString(R.string.settings_delete_f6fdb), tint = PlumRed)
                }
            }

            // Expandable tools section
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.sm),
                ) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        screenResources.getString(R.string.settings_available_tools_e7b87),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                    // Placeholder — real implementation would fetch tools from server
                    Text(
                        screenResources.getString(R.string.settings_tools_are_discovered_when_the_server_connects_enable_the_server_a_7e2df),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (server.args.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            screenResources.getString(R.string.settings_args_1_s_0d9aa, server.args.joinToString(" ")),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (server.env.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            screenResources.getString(R.string.settings_env_1_s_edb51, server.env.keys.joinToString(", ")),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }

    if (showDeleteConfirm) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text(screenResources.getString(R.string.settings_remove_mcp_server_75ae1)) },
            text = { Text(screenResources.getString(R.string.settings_remove_1_s_this_cannot_be_undone_88c2e, server.name)) },
            confirmButton = {
                TextButton(
                    onClick = { showDeleteConfirm = false; onDelete() },
                    colors = ButtonDefaults.textButtonColors(contentColor = PlumRed),
                ) { Text(screenResources.getString(R.string.settings_remove_e9639)) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text(screenResources.getString(R.string.settings_cancel_77dfd)) }
            },
        )
    }
}

// ── MCP server edit form ──────────────────────────────────────────────────────

@Composable
private fun McpServerEditForm(
    server: McpServer?,
    onSave: (
        name: String,
        type: McpServerType,
        url: String?,
        command: String?,
        args: List<String>,
        env: Map<String, String>,
    ) -> Unit,
    onCancel: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var name by remember { mutableStateOf(server?.name ?: "") }
    var selectedType by remember { mutableStateOf(server?.type ?: McpServerType.SSE) }
    var url by remember { mutableStateOf(server?.url ?: "") }
    var command by remember { mutableStateOf(server?.command ?: "") }
    var argsText by remember { mutableStateOf(server?.args?.joinToString(" ") ?: "") }
    var authToken by remember { mutableStateOf("") }
    var tokenVisible by remember { mutableStateOf(false) }
    var envText by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = screenTokens.spacing.xl, vertical = screenTokens.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.lg),
    ) {
        Text(
            text = if (server == null) screenResources.getString(R.string.settings_add_mcp_server_c76ec) else screenResources.getString(R.string.settings_edit_mcp_server_00d68),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )

        // Name
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text(screenResources.getString(R.string.settings_server_name_73882)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = RoundedCornerShape(screenTokens.radius.md),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
        )

        // Type selector
        Column {
            Text(
                screenResources.getString(R.string.settings_transport_type_a7f6a),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                McpServerType.entries.forEachIndexed { index, type ->
                    SegmentedButton(
                        selected = selectedType == type,
                        onClick = { selectedType = type },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = McpServerType.entries.size),
                        label = {
                            Text(
                                when (type) {
                                    McpServerType.SSE -> screenResources.getString(R.string.settings_sse_http_f5261)
                                    McpServerType.SUBPROCESS -> screenResources.getString(R.string.settings_subprocess_231ca)
                                },
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                    )
                }
            }
        }

        // Type-specific fields
        AnimatedVisibility(visible = selectedType == McpServerType.SSE) {
            Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(screenResources.getString(R.string.settings_server_url_1d5d1)) },
                    placeholder = { Text("https://mcp.example.com/sse") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
                OutlinedTextField(
                    value = authToken,
                    onValueChange = { authToken = it },
                    label = { Text(screenResources.getString(R.string.settings_auth_token_optional_aa591)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = if (tokenVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { tokenVisible = !tokenVisible }) {
                            Icon(
                                if (tokenVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = screenResources.getString(
                                    if (tokenVisible) R.string.settings_hide_token else R.string.settings_show_token,
                                ),
                                modifier = Modifier.size(screenTokens.sizing.iconMd),
                            )
                        }
                    },
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
            }
        }

        AnimatedVisibility(visible = selectedType == McpServerType.SUBPROCESS) {
            Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
                OutlinedTextField(
                    value = command,
                    onValueChange = { command = it },
                    label = { Text(screenResources.getString(R.string.settings_command_89018)) },
                    placeholder = { Text("npx @mcp-server/package") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
                OutlinedTextField(
                    value = argsText,
                    onValueChange = { argsText = it },
                    label = { Text(screenResources.getString(R.string.settings_arguments_space_separated_37bad)) },
                    placeholder = { Text("--port 3000 --verbose") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
                OutlinedTextField(
                    value = envText,
                    onValueChange = { envText = it },
                    label = { Text(screenResources.getString(R.string.settings_environment_key_value_one_per_line_7a8d6)) },
                    placeholder = { Text("API_KEY=abc123\nDEBUG=true") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 4,
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
            }
        }

        // Buttons
        Row(
            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            modifier = Modifier.fillMaxWidth(),
        ) {
            TextButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
                Text(screenResources.getString(R.string.settings_cancel_77dfd))
            }
            Button(
                onClick = {
                    val args = argsText.split(" ").map { it.trim() }.filter { it.isNotBlank() }
                    val env = envText.lines()
                        .map { it.trim() }
                        .filter { it.contains("=") }
                        .associate { line ->
                            val (key, value) = line.split("=", limit = 2)
                            key.trim() to value.trim()
                        }
                    onSave(
                        name,
                        selectedType,
                        url.takeIf { selectedType == McpServerType.SSE && it.isNotBlank() },
                        command.takeIf { selectedType == McpServerType.SUBPROCESS && it.isNotBlank() },
                        args,
                        env,
                    )
                },
                enabled = name.isNotBlank() && (
                    (selectedType == McpServerType.SSE && url.isNotBlank()) ||
                    (selectedType == McpServerType.SUBPROCESS && command.isNotBlank())
                ),
                modifier = Modifier.weight(2f),
                shape = RoundedCornerShape(screenTokens.radius.md),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
                Text(if (server == null) screenResources.getString(R.string.settings_add_61cc5) else screenResources.getString(R.string.settings_save_efc00))
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}
