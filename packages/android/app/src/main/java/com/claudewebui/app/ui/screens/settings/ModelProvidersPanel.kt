package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.ModelProvider
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill

/**
 * The model provider registry (`/api/model-providers`): API key, base URL and
 * model list per provider. Pi, model chat and voice resolve from it, so it is
 * not tied to any one CLI harness.
 */
@Composable
fun ModelProvidersPanel(
    providers: List<ModelProvider>,
    saving: Boolean,
    tests: Map<String, TestResult>,
    testMessages: Map<String, String>,
    error: String?,
    onSave: (String, String, String, String, Boolean, List<String>, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onTest: (String) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var editing by remember { mutableStateOf<ModelProvider?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<ModelProvider?>(null) }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    screenResources.getString(R.string.settings_model_providers),
                    color = PlumText,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    screenResources.getString(R.string.settings_add_61cc5),
                    color = PlumAccent,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { creating = true; editing = null }.padding(screenTokens.spacing.sm),
                )
            }

            providers.forEach { provider ->
                Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                provider.name,
                                color = if (provider.enabled) PlumText else PlumMuted,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                listOfNotNull(
                                    provider.id,
                                    provider.baseUrl?.takeIf { it.isNotBlank() },
                                    provider.models.size.takeIf { it > 0 }?.let {
                                        screenResources.getQuantityString(R.plurals.settings_model_count, it, it)
                                    },
                                    provider.envVars.takeIf { it.isNotEmpty() }?.joinToString(" / "),
                                    screenResources.getString(R.string.settings_model_provider_not_in_pi)
                                        .takeIf { provider.enabled && !provider.pi },
                                ).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 10.sp,
                                maxLines = 2,
                            )
                        }
                        StatusPill(if (provider.hasKey) screenResources.getString(R.string.settings_key_stored_5626e) else screenResources.getString(R.string.settings_no_key_38878), if (provider.hasKey) PlumGreen else PlumMuted)
                    }
                    testMessages[provider.id]?.let { message ->
                        Text(
                            message,
                            color = if (tests[provider.id] is TestResult.Success) PlumGreen else PlumRed,
                            fontSize = 10.sp,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.xs)) {
                        TextButton(onClick = { onTest(provider.id) }, enabled = tests[provider.id] !is TestResult.Testing) {
                            Text(if (tests[provider.id] is TestResult.Testing) screenResources.getString(R.string.settings_testing_95c45) else screenResources.getString(R.string.settings_test_640ab))
                        }
                        TextButton(onClick = { editing = provider; creating = false }) { Text(screenResources.getString(R.string.settings_edit_53016)) }
                        TextButton(onClick = { deleting = provider }) { Text(screenResources.getString(R.string.settings_delete_f6fdb), color = PlumRed) }
                    }
                }
            }

            if (providers.isEmpty() && !creating) {
                Text(screenResources.getString(R.string.settings_no_model_providers), color = PlumMuted, fontSize = 12.sp)
            }

            if (creating || editing != null) {
                ModelProviderForm(
                    provider = editing,
                    saving = saving,
                    error = error,
                    onCancel = { creating = false; editing = null },
                    onSave = { id, name, key, url, enabled, models, pi ->
                        onSave(id, name, key, url, enabled, models, pi)
                        creating = false
                        editing = null
                    },
                )
            }
        }
    }

    deleting?.let { provider ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(screenResources.getString(R.string.settings_delete_1_s_137cd, provider.name)) },
            text = { Text(screenResources.getString(R.string.settings_model_provider_delete_body)) },
            confirmButton = {
                TextButton(onClick = { onDelete(provider.id); deleting = null }) {
                    Text(screenResources.getString(R.string.settings_delete_f6fdb), color = PlumRed)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(screenResources.getString(R.string.settings_cancel_77dfd)) } },
        )
    }
}

@Composable
private fun ModelProviderForm(
    provider: ModelProvider?,
    saving: Boolean,
    error: String?,
    onCancel: () -> Unit,
    onSave: (String, String, String, String, Boolean, List<String>, Boolean) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var id by remember(provider?.id) { mutableStateOf(provider?.id.orEmpty()) }
    var name by remember(provider?.id) { mutableStateOf(provider?.name.orEmpty()) }
    var key by remember(provider?.id) { mutableStateOf("") }
    var baseUrl by remember(provider?.id) { mutableStateOf(provider?.baseUrl.orEmpty()) }
    var enabled by remember(provider?.id) { mutableStateOf(provider?.enabled ?: true) }
    var pi by remember(provider?.id) { mutableStateOf(provider?.pi ?: true) }
    // One model id per line; commas are accepted too. Empty means the catalog's list.
    var models by remember(provider?.id) { mutableStateOf(provider?.models.orEmpty().joinToString("\n")) }
    val valid = id.isNotBlank() && name.isNotBlank() && (provider?.hasKey == true || key.isNotBlank()) && !saving

    Text(if (provider == null) screenResources.getString(R.string.settings_new_provider_7c2e6) else screenResources.getString(R.string.settings_edit_provider_c3c1d), color = PlumText, fontWeight = FontWeight.Bold)
    OutlinedTextField(
        value = id,
        onValueChange = { id = it },
        label = { Text(screenResources.getString(R.string.settings_provider_id_61099)) },
        placeholder = { Text("z-ai") },
        enabled = provider == null,
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(screenResources.getString(R.string.settings_display_name_c7874)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        value = key,
        onValueChange = { key = it },
        label = { Text(if (provider?.hasKey == true) screenResources.getString(R.string.settings_new_api_key_leave_blank_to_keep_48230) else screenResources.getString(R.string.settings_api_key_cf678)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text(screenResources.getString(R.string.settings_base_url_optional_c5d67)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        value = models,
        onValueChange = { models = it },
        label = { Text(screenResources.getString(R.string.settings_model_provider_models)) },
        placeholder = { Text("glm-5.1\nglm-4.5-air") },
        minLines = 2,
        maxLines = 8,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(screenResources.getString(R.string.settings_enabled_df174), color = PlumText, modifier = Modifier.weight(1f))
        Switch(checked = enabled, onCheckedChange = { enabled = it })
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(screenResources.getString(R.string.settings_model_provider_in_pi), color = PlumText, modifier = Modifier.weight(1f))
        Switch(checked = pi, onCheckedChange = { pi = it })
    }
    error?.let { Text(it, color = PlumRed, fontSize = 11.sp) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm, Alignment.End)) {
        TextButton(onClick = onCancel, enabled = !saving) { Text(screenResources.getString(R.string.settings_cancel_77dfd)) }
        TextButton(
            onClick = {
                val modelIds = models.split('\n', ',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
                onSave(id.trim(), name.trim(), key, baseUrl, enabled, modelIds, pi)
            },
            enabled = valid,
        ) { Text(if (saving) screenResources.getString(R.string.settings_saving_56a22) else screenResources.getString(R.string.settings_save_efc00)) }
    }
}
