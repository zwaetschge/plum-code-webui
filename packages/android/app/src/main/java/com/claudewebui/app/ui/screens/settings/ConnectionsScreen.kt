package com.claudewebui.app.ui.screens.settings

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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.data.model.SshConnection
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

/** The form is open for a new connection ([connection] = null) or for editing one. */
private data class ConnectionEditorTarget(val connection: SshConnection?)

/**
 * Settings → Verbindungen: saved SSH hosts that sessions can attach. Mirrors
 * the WebUI connections page; the private key is write-only.
 */
@Composable
fun ConnectionsScreen(
    viewModel: ConnectionsViewModel,
    onNavigateBack: () -> Unit,
) {
    val tokens = com.claudewebui.app.ui.theme.PlumTheme.tokens
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val wide = isTabletWidth()

    var editor by remember { mutableStateOf<ConnectionEditorTarget?>(null) }
    var deleting by remember { mutableStateOf<SshConnection?>(null) }

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (wide) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(tokens.spacing.md),
            ) {
                item(key = "header") {
                    PlumScreenHeader(
                        title = stringResource(R.string.connections_title),
                        subtitle = stringResource(R.string.connections_subtitle),
                        actions = {
                            PlumIconButton(Icons.Outlined.Add, stringResource(R.string.connections_add), {
                                viewModel.clearMessages()
                                editor = ConnectionEditorTarget(null)
                            })
                            PlumIconButton(Icons.Outlined.Refresh, stringResource(R.string.connections_reload), viewModel::load)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                stringResource(R.string.connections_back),
                                onNavigateBack,
                            )
                        },
                    )
                }

                val message = if (editor == null) state.saveError ?: state.notice else null
                if (message != null || state.loadError != null) {
                    item(key = "message") {
                        Column(verticalArrangement = Arrangement.spacedBy(tokens.spacing.inline)) {
                            state.loadError?.let { Text(it, color = PlumRed, fontSize = 12.sp) }
                            message?.let {
                                Text(it, color = if (state.saveError != null) PlumRed else PlumGreen, fontSize = 12.sp)
                            }
                        }
                    }
                }

                if (state.isLoading && state.connections.isEmpty()) {
                    item(key = "loading") {
                        Box(Modifier.fillMaxWidth().height(140.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else if (state.connections.isEmpty()) {
                    item(key = "empty") {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Column(
                                Modifier.fillMaxWidth().padding(15.dp),
                                verticalArrangement = Arrangement.spacedBy(9.dp),
                            ) {
                                Text(stringResource(R.string.connections_empty), color = PlumMuted, fontSize = 13.sp)
                                PillAction(stringResource(R.string.connections_add), disabled = false) {
                                    viewModel.clearMessages()
                                    editor = ConnectionEditorTarget(null)
                                }
                            }
                        }
                    }
                } else {
                    items(state.connections, key = { it.id }) { connection ->
                        ConnectionCard(
                            connection = connection,
                            test = state.tests[connection.id] ?: ConnectionTestState(),
                            busy = state.isSaving,
                            onTest = { viewModel.test(connection.id) },
                            onEdit = {
                                viewModel.clearMessages()
                                editor = ConnectionEditorTarget(connection)
                            },
                            onDelete = { deleting = connection },
                        )
                    }
                }

                item(key = "note") {
                    Text(
                        stringResource(R.string.connections_secret_note),
                        color = PlumMuted,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = tokens.spacing.xs, vertical = tokens.spacing.inline),
                    )
                }
            }
        }
    }

    editor?.let { target ->
        ConnectionEditorDialog(
            editing = target.connection,
            state = state,
            onDismiss = {
                editor = null
                viewModel.clearMessages()
            },
            onSave = { draft -> viewModel.save(target.connection, draft) { editor = null } },
        )
    }

    deleting?.let { connection ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(stringResource(R.string.connections_delete_title)) },
            text = { Text(stringResource(R.string.connections_delete_body, connection.name.ifBlank { connection.alias })) },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleting = null
                        viewModel.delete(connection)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = PlumRed),
                ) { Text(stringResource(R.string.connections_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.connections_cancel)) }
            },
        )
    }
}

@Composable
private fun ConnectionCard(
    connection: SshConnection,
    test: ConnectionTestState,
    busy: Boolean,
    onTest: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val tokens = com.claudewebui.app.ui.theme.PlumTheme.tokens
    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    connection.name.ifBlank { connection.alias },
                    color = PlumText,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(connection.alias, PlumAccent)
            }
            Text(
                sshTarget(connection),
                color = PlumMuted,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            connection.jumpHost?.takeIf { it.isNotBlank() }?.let {
                Text(
                    stringResource(R.string.connections_field_jump_host).substringBefore(" (") + ": " + it,
                    color = PlumMuted,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (connection.tags.isNotEmpty()) {
                Text(
                    connection.tags.joinToString("  ") { "#$it" },
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                keySummary(connection),
                color = if (connection.keyConfigured || connection.keySource == SSH_KEY_SOURCE_FILE) PlumMuted else PlumRed,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            TestResultLine(test)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(tokens.spacing.compact),
            ) {
                Text(
                    stringResource(R.string.connections_edit_action),
                    color = if (busy) PlumMuted else PlumAccent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable(enabled = !busy, onClick = onEdit)
                        .padding(horizontal = tokens.spacing.sm, vertical = tokens.spacing.inline),
                )
                Text(
                    stringResource(R.string.connections_delete),
                    color = if (busy) PlumMuted else PlumRed,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable(enabled = !busy, onClick = onDelete)
                        .padding(horizontal = tokens.spacing.sm, vertical = tokens.spacing.inline),
                )
                Box(Modifier.weight(1f))
                if (test.running) {
                    CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.dp, modifier = Modifier.size(17.dp))
                }
                PillAction(stringResource(R.string.connections_test), disabled = test.running, onClick = onTest)
            }
        }
    }
}

/** `user@host:port`, the way `ssh` would address it. */
internal fun sshTarget(connection: SshConnection): String =
    buildString {
        if (connection.user.isNotBlank()) append(connection.user).append('@')
        append(connection.host)
        if (connection.port != 22) append(':').append(connection.port)
    }

@Composable
private fun keySummary(connection: SshConnection): String =
    if (connection.keySource == SSH_KEY_SOURCE_FILE) {
        stringResource(R.string.connections_key_source_file) + (connection.keyFile?.let { ": $it" } ?: "")
    } else if (connection.keyConfigured) {
        stringResource(R.string.connections_key_configured)
    } else {
        stringResource(R.string.connections_key_missing)
    }

/** One line with the outcome of the last probe; empty until the first test. */
@Composable
internal fun TestResultLine(test: ConnectionTestState) {
    val text = when {
        test.running -> stringResource(R.string.connections_testing)
        test.ok == null -> return
        else -> {
            val base = test.message ?: stringResource(
                if (test.ok == true) R.string.connections_test_ok else R.string.connections_test_failed,
            )
            test.durationMs?.let { stringResource(R.string.connections_test_duration, base, it.toInt()) } ?: base
        }
    }
    Text(
        text,
        color = when (test.ok) {
            true -> PlumGreen
            false -> PlumRed
            else -> PlumMuted
        },
        fontSize = 12.sp,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
internal fun PillAction(label: String, disabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = PlumText,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (disabled) PlumSubtleFill else PlumAccent.copy(alpha = .18f))
            .clickable(enabled = !disabled, onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 9.dp),
    )
}

@Composable
private fun ConnectionEditorDialog(
    editing: SshConnection?,
    state: ConnectionsUiState,
    onDismiss: () -> Unit,
    onSave: (SshConnectionDraft) -> Unit,
) {
    val initial = remember(editing?.id) {
        editing?.let { SshConnectionDraft.from(it) }
            ?: SshConnectionDraft(keyFile = state.keyFiles.firstOrNull())
    }
    var draft by remember(editing?.id) { mutableStateOf(initial) }
    // New connections derive the alias from the name until the alias is edited.
    var aliasTouched by remember(editing?.id) { mutableStateOf(editing != null) }

    AlertDialog(
        onDismissRequest = { if (!state.isSaving) onDismiss() },
        title = {
            Text(stringResource(if (editing == null) R.string.connections_new else R.string.connections_edit))
        },
        text = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                state.saveError?.let { Text(it, color = PlumRed, fontSize = 12.sp) }
                OutlinedTextField(
                    value = draft.name,
                    onValueChange = { value ->
                        draft = draft.copy(
                            name = value,
                            alias = if (aliasTouched) draft.alias else sshAliasFromName(value),
                        )
                    },
                    label = { Text(stringResource(R.string.connections_field_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draft.alias,
                    onValueChange = { value ->
                        aliasTouched = true
                        draft = draft.copy(alias = value.lowercase().filterNot { it.isWhitespace() })
                    },
                    label = { Text(stringResource(R.string.connections_field_alias)) },
                    supportingText = { Text(stringResource(R.string.connections_field_alias_hint)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draft.host,
                    onValueChange = { value -> draft = draft.copy(host = value.filterNot { it.isWhitespace() }) },
                    label = { Text(stringResource(R.string.connections_field_host)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = draft.portText,
                        onValueChange = { value -> draft = draft.copy(portText = value.filter(Char::isDigit).take(5)) },
                        label = { Text(stringResource(R.string.connections_field_port)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(0.38f),
                    )
                    OutlinedTextField(
                        value = draft.user,
                        onValueChange = { value -> draft = draft.copy(user = value.filterNot { it.isWhitespace() }) },
                        label = { Text(stringResource(R.string.connections_field_user)) },
                        singleLine = true,
                        modifier = Modifier.weight(0.62f),
                    )
                }
                OutlinedTextField(
                    value = draft.jumpHost,
                    onValueChange = { value -> draft = draft.copy(jumpHost = value.filterNot { it.isWhitespace() }) },
                    label = { Text(stringResource(R.string.connections_field_jump_host)) },
                    placeholder = { Text("user@bastion:22") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draft.tagsText,
                    onValueChange = { value -> draft = draft.copy(tagsText = value) },
                    label = { Text(stringResource(R.string.connections_field_tags)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Text(
                    stringResource(R.string.connections_key_source),
                    color = PlumMuted,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
                ChoiceRow(
                    label = stringResource(R.string.connections_key_source_file),
                    selected = draft.keySource == SSH_KEY_SOURCE_FILE,
                ) { draft = draft.copy(keySource = SSH_KEY_SOURCE_FILE) }
                ChoiceRow(
                    label = stringResource(R.string.connections_key_source_upload),
                    selected = draft.keySource == SSH_KEY_SOURCE_UPLOAD,
                ) { draft = draft.copy(keySource = SSH_KEY_SOURCE_UPLOAD) }

                if (draft.keySource == SSH_KEY_SOURCE_FILE) {
                    Text(
                        stringResource(R.string.connections_key_file),
                        color = PlumMuted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    when {
                        !state.keyFilesAvailable -> Text(
                            stringResource(R.string.connections_key_files_unavailable),
                            color = PlumMuted,
                            fontSize = 12.sp,
                        )
                        state.keyFiles.isEmpty() -> Text(
                            stringResource(R.string.connections_key_files_empty),
                            color = PlumMuted,
                            fontSize = 12.sp,
                        )
                        else -> state.keyFiles.forEach { file ->
                            ChoiceRow(label = file, selected = draft.keyFile == file, monospace = true) {
                                draft = draft.copy(keyFile = file)
                            }
                        }
                    }
                    // A stored file that vanished from ~/.ssh stays visible so the user sees why it fails.
                    draft.keyFile?.takeIf { it !in state.keyFiles }?.let { missing ->
                        ChoiceRow(label = missing, selected = true, monospace = true) {}
                    }
                } else {
                    val stored = editing != null && editing.keyConfigured && editing.keySource == SSH_KEY_SOURCE_UPLOAD
                    if (stored) {
                        StatusPill(stringResource(R.string.connections_key_configured), PlumGreen)
                    }
                    OutlinedTextField(
                        value = draft.privateKey,
                        onValueChange = { value -> draft = draft.copy(privateKey = value) },
                        label = { Text(stringResource(R.string.connections_private_key)) },
                        placeholder = { Text("-----BEGIN OPENSSH PRIVATE KEY-----", fontSize = 11.sp) },
                        enabled = !draft.clearKey,
                        minLines = 4,
                        maxLines = 8,
                        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (stored) {
                        Text(stringResource(R.string.connections_private_key_keep), color = PlumMuted, fontSize = 11.sp)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.clickable { draft = draft.copy(clearKey = !draft.clearKey) },
                        ) {
                            Checkbox(
                                checked = draft.clearKey,
                                onCheckedChange = { checked -> draft = draft.copy(clearKey = checked) },
                            )
                            Text(stringResource(R.string.connections_clear_key), color = PlumRed, fontSize = 13.sp)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(draft) }, enabled = !state.isSaving) {
                Text(stringResource(if (state.isSaving) R.string.connections_saving else R.string.connections_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !state.isSaving) {
                Text(stringResource(R.string.connections_cancel))
            }
        },
    )
}

@Composable
private fun ChoiceRow(
    label: String,
    selected: Boolean,
    monospace: Boolean = false,
    onSelect: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onSelect),
    ) {
        RadioButton(selected = selected, onClick = onSelect)
        Text(
            label,
            color = PlumText,
            fontSize = 13.sp,
            fontFamily = if (monospace) FontFamily.Monospace else null,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
