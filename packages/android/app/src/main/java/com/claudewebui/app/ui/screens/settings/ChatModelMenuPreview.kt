package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.systemBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import com.claudewebui.app.data.model.AssistantApiProvider

/**
 * Debug fixture for `claudewebui://preview-chatmodels`: the „Modelle im Chat“
 * section of the chat settings with sample providers, reachable without a login.
 */
@Composable
fun ChatModelMenuPreviewScreen() {
    val providers = remember {
        listOf(
            AssistantApiProvider("deepseek", "DeepSeek", "openai", listOf("deepseek-v4-pro", "deepseek-v4-flash")),
            AssistantApiProvider("mistral", "Mistral", "openai", listOf("mistral-large-latest", "mistral-medium-latest", "devstral-medium-latest")),
            AssistantApiProvider("zai", "Z.AI", "openai", listOf("glm-5.3", "glm-5.3-flash")),
        )
    }
    var stored by remember { mutableStateOf(listOf("mistral/mistral-large-latest", "deepseek/deepseek-v4-pro", "zai/glm-5.3")) }
    SettingsPageScaffold(stringResource(R.string.settings_hub_personalization), onBack = null, contentPadding = WindowInsets.systemBars.asPaddingValues()) {
        item(key = "chat-models") {
            Column(Modifier.fillMaxWidth()) {
                SettingsGroup(header = stringResource(R.string.assistant_chat_models)) {}
                PiModelMenuPanel(
                    catalog = providers.flatMap { provider -> provider.models.map { "${provider.id}/$it" } },
                    stored = stored,
                    providerDefault = null,
                    saving = false,
                    onSave = { stored = it },
                    searchLabel = stringResource(R.string.assistant_chat_models_search),
                    loadingLabel = stringResource(R.string.assistant_chat_models_loading),
                    emptyLabel = stringResource(R.string.assistant_chat_models_none),
                    groupLabels = providers.associate { it.id to it.name },
                )
            }
        }
    }
}
