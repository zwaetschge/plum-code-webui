package com.claudewebui.app.ui.screens.library

import com.claudewebui.app.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.ConfigDocument
import com.claudewebui.app.data.model.ConfigItemKind
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigEditorSheet(
    document: ConfigDocument?,
    loading: Boolean,
    saving: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSave: (ConfigDocument) -> Unit,
    onDelete: (ConfigDocument) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        if (loading || document == null) {
            Box(
                Modifier.fillMaxWidth().height(220.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        } else {
            key(document.kind, document.key) {
                ConfigEditorForm(document, saving, error, onDismiss, onSave, onDelete)
            }
        }
    }
}

@Composable
private fun ConfigEditorForm(
    original: ConfigDocument,
    saving: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSave: (ConfigDocument) -> Unit,
    onDelete: (ConfigDocument) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var name by remember { mutableStateOf(original.name) }
    var description by remember { mutableStateOf(original.description) }
    var content by remember { mutableStateOf(original.content) }
    var tools by remember { mutableStateOf(original.tools.joinToString(", ")) }
    var model by remember { mutableStateOf(original.model) }
    var version by remember { mutableStateOf(original.version) }
    var author by remember { mutableStateOf(original.author) }
    var category by remember { mutableStateOf(original.category) }
    var confirmDelete by remember { mutableStateOf(false) }

    val label = when (original.kind) {
        ConfigItemKind.AGENT -> screenResources.getString(R.string.library_agent_5ce2e)
        ConfigItemKind.SKILL -> screenResources.getString(R.string.library_skill_ec9f6)
        ConfigItemKind.PLUGIN -> screenResources.getString(R.string.library_plugin_8dc20)
    }
    val valid = name.isNotBlank() && content.isNotBlank() && !saving
    val edited = original.copy(
        name = name.trim(),
        description = description.trim(),
        content = content,
        tools = tools.split(',').map { it.trim() }.filter { it.isNotBlank() },
        model = model.trim(),
        version = version.trim().ifBlank { "1.0.0" },
        author = author.trim(),
        category = category.trim(),
    )

    Column(
        Modifier
            .fillMaxWidth()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = screenTokens.spacing.section),
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
    ) {
        Text(
            if (original.key == null) screenResources.getString(R.string.library_new_1_s_5ccb8, label) else screenResources.getString(R.string.library_edit_1_s_5fa4d, label),
            color = PlumText,
            fontWeight = FontWeight.Bold,
        )
        Text(
            screenResources.getString(R.string.library_saved_on_the_server_and_available_to_new_cli_sessions_6896d),
            color = PlumMuted,
        )

        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text(screenResources.getString(R.string.library_name_709a2)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text(screenResources.getString(R.string.library_description_55f8e)) },
            minLines = 2,
            maxLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )

        if (original.kind != ConfigItemKind.PLUGIN) {
            OutlinedTextField(
                value = tools,
                onValueChange = { tools = it },
                label = { Text(if (original.kind == ConfigItemKind.SKILL) screenResources.getString(R.string.library_allowed_tools_36b46) else screenResources.getString(R.string.library_tools_4fa8c)) },
                supportingText = { Text(screenResources.getString(R.string.library_comma_separated_8cb78)) },
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text(screenResources.getString(R.string.library_model_optional_1cde0)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
                OutlinedTextField(
                    value = version,
                    onValueChange = { version = it },
                    label = { Text(screenResources.getString(R.string.library_version_2da60)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text(screenResources.getString(R.string.library_category_a3c68)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }
            OutlinedTextField(
                value = author,
                onValueChange = { author = it },
                label = { Text(screenResources.getString(R.string.library_author_5fda2)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        OutlinedTextField(
            value = content,
            onValueChange = { content = it },
            label = {
                Text(if (original.kind == ConfigItemKind.AGENT) screenResources.getString(R.string.library_prompt_a817d) else screenResources.getString(R.string.library_markdown_content_cbc16))
            },
            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace),
            minLines = 10,
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let { Text(it, color = PlumRed) }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (original.key != null) {
                TextButton(onClick = { confirmDelete = true }, enabled = !saving) {
                    Text(screenResources.getString(R.string.library_delete_f6fdb), color = PlumRed)
                }
            }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onDismiss, enabled = !saving) { Text(screenResources.getString(R.string.library_cancel_77dfd)) }
            Button(onClick = { onSave(edited) }, enabled = valid) {
                if (saving) CircularProgressIndicator(strokeWidth = 2.dp)
                else Text(screenResources.getString(R.string.library_save_efc00))
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(screenResources.getString(R.string.library_delete_1_s_137cd, label)) },
            text = { Text(screenResources.getString(R.string.library_1_s_will_be_removed_from_the_shared_server_library_c8442, original.name)) },
            confirmButton = {
                TextButton(onClick = { onDelete(original) }) { Text(screenResources.getString(R.string.library_delete_f6fdb), color = PlumRed) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(screenResources.getString(R.string.library_cancel_77dfd)) }
            },
        )
    }
}
