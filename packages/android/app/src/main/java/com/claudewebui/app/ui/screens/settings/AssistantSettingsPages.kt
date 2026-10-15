package com.claudewebui.app.ui.screens.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ManageSearch
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Cable
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.TravelExplore
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AssistantPersonalization
import com.claudewebui.app.ui.components.chat.DesignPresetSheet
import com.claudewebui.app.ui.components.chat.WritingStyleSheet
import com.claudewebui.app.ui.components.chat.presetName
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.screens.dashboard.readBytesLimited
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Page ids of the assistant part of the settings hierarchy. */
internal object AssistantPages {
    const val ROOT = "assistant"
    const val VOICE = "voice"
    const val VOICE_PICKER = "voice-picker"
    const val PERSONAL = "personal"
    const val PROFILE = "profile"
    const val PHOTOS = "photos"
    const val WRITING = "writing"
    const val RESPONSE = "response"
    const val INSTRUCTIONS = "instructions"
    const val MEMORY = "memory"
    val all = setOf(ROOT, VOICE, VOICE_PICKER, PERSONAL, PROFILE, PHOTOS, WRITING, RESPONSE, INSTRUCTIONS, MEMORY)
}

/** The three assistant rows; used by the settings root and the "Assistent" page. */
internal fun SettingsGroupScope.assistantRows(controller: AssistantSettingsController?, push: (String) -> Unit) {
    item {
        SettingsRow(
            title = stringResource(R.string.settings_hub_voice),
            icon = Icons.Outlined.RecordVoiceOver,
            tone = TileTone.Pink,
            value = controller?.value?.let { assistantVoiceLabel(it.voiceName) },
            enabled = controller != null,
            onClick = { push(AssistantPages.VOICE) },
        )
    }
    item {
        SettingsRow(
            title = stringResource(R.string.settings_hub_personalization),
            icon = Icons.Outlined.Person,
            tone = TileTone.Violet,
            value = controller?.value?.nickname?.ifBlank { null },
            enabled = controller != null,
            onClick = { push(AssistantPages.PERSONAL) },
        )
    }
    item {
        SettingsRow(
            title = stringResource(R.string.settings_hub_memory),
            icon = Icons.Outlined.Psychology,
            tone = TileTone.Indigo,
            value = controller?.value?.let { stringResource(if (it.memoryEnabled) R.string.settings_hub_on else R.string.settings_hub_off) },
            enabled = controller != null,
            onClick = { push(AssistantPages.MEMORY) },
        )
    }
}

/** Load state, save state and the last error of the personalization, as page items. */
private fun LazyListScope.controllerStatus(controller: AssistantSettingsController) {
    item(key = "assistant-status") {
        val error = controller.error
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (controller.loading || controller.saving) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            if (error != null) SettingsGroup {
                item(hasIcon = false) {
                    SettingsMessage(
                        error,
                        error = true,
                        actionLabel = stringResource(R.string.assistant_reload),
                        onAction = { controller.load() },
                    )
                }
            }
        }
    }
}

/**
 * Renders one assistant page. Every change is saved through [controller] the
 * moment it is made; there is no draft and no save button.
 */
@Composable
internal fun AssistantSettingsPage(
    id: String,
    controller: AssistantSettingsController?,
    api: ApiClient,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
    push: (String) -> Unit,
    openFeature: (String) -> Unit,
) {
    val title = stringResource(
        when (id) {
            AssistantPages.ROOT -> R.string.settings_hub_assistant
            AssistantPages.VOICE -> R.string.settings_hub_voice
            AssistantPages.VOICE_PICKER -> R.string.assistant_voice_pick
            AssistantPages.PERSONAL -> R.string.settings_hub_personalization
            AssistantPages.PROFILE -> R.string.settings_hub_profile
            AssistantPages.PHOTOS -> R.string.assistant_reference_photos
            AssistantPages.WRITING -> R.string.assistant_writing_style
            AssistantPages.RESPONSE -> R.string.assistant_response_style
            AssistantPages.INSTRUCTIONS -> R.string.assistant_custom_instructions
            else -> R.string.settings_hub_memory
        },
    )
    if (controller == null) {
        SettingsPageScaffold(title, onBack, contentPadding = contentPadding) {
            item { SettingsGroup { item(hasIcon = false) { SettingsMessage(stringResource(R.string.settings_hub_assistant_unavailable)) } } }
        }
        return
    }
    val value = controller.value
    var sheet by remember { mutableStateOf<String?>(null) }
    SettingsPageScaffold(title, onBack, contentPadding = contentPadding) {
        controllerStatus(controller)
        if (id == AssistantPages.ROOT) {
            item { SettingsGroup(footer = stringResource(R.string.settings_hub_assistant_footer)) { assistantRows(controller, push) } }
            return@SettingsPageScaffold
        }
        if (value == null) return@SettingsPageScaffold
        val enabled = !controller.loading
        when (id) {
            AssistantPages.VOICE -> voicePage(controller, value, enabled, push)
            AssistantPages.VOICE_PICKER -> item(key = "voices") {
                val catalog = rememberVoiceCatalog(controller.owner, api)
                SettingsBlock {
                    VoiceChoiceGroups(catalog, value.voiceName, enabled) { controller.setChoice("voiceName", it) }
                    Text(stringResource(R.string.settings_hub_voice_footer), color = PlumMuted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
            AssistantPages.PERSONAL -> personalPage(controller, value, enabled, push) { sheet = it }
            AssistantPages.PROFILE -> item(key = "profile") {
                SettingsGroup(footer = stringResource(R.string.settings_hub_autosave_footer)) {
                    item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_nickname), value.nickname, { controller.setText("nickname", it) }, controller::flush, 100, enabled = enabled) }
                    item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_occupation), value.occupation, { controller.setText("occupation", it) }, controller::flush, 200, enabled = enabled) }
                    item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_about_you), value.aboutYou, { controller.setText("aboutYou", it) }, controller::flush, 10000, multiline = true, enabled = enabled) }
                }
            }
            AssistantPages.PHOTOS -> item(key = "photos") { PhotosPage(controller, value, enabled) }
            AssistantPages.WRITING -> item(key = "writing") {
                SettingsBlock {
                    SettingsGroup {
                        item { SettingsSwitchRow(stringResource(R.string.assistant_writing_enabled), value.writingStyleEnabled, { controller.setBoolean("writingStyleEnabled", it) }, Icons.Outlined.FormatQuote, TileTone.Orange, enabled = enabled) }
                        item { SettingsSwitchRow(stringResource(R.string.assistant_writing_learning), value.writingStyleLearning, { controller.setBoolean("writingStyleLearning", it) }, Icons.Outlined.School, TileTone.Amber, enabled = enabled) }
                    }
                    SettingsGroup(footer = stringResource(R.string.settings_hub_autosave_footer)) {
                        item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_writing_sample), value.writingSample, { controller.setText("writingSample", it) }, controller::flush, 10000, multiline = true, enabled = enabled) }
                    }
                    SettingsGroup(header = stringResource(R.string.preset_defaults_title)) {
                        item {
                            SettingsRow(
                                title = stringResource(R.string.preset_default_writing),
                                icon = Icons.Outlined.EditNote,
                                tone = TileTone.Teal,
                                value = controller.styleLibrary.writingStyles.presetName(value.defaultWritingStyle) ?: stringResource(R.string.preset_style_none),
                                enabled = enabled,
                                onClick = { sheet = "writing" },
                            )
                        }
                    }
                }
            }
            AssistantPages.RESPONSE -> item(key = "response") {
                val levels = listOf("less" to stringResource(R.string.assistant_style_less), "default" to stringResource(R.string.assistant_style_default), "more" to stringResource(R.string.assistant_style_more))
                SettingsBlock {
                    SettingsGroup {
                        item {
                            SettingsMenuRow(
                                stringResource(R.string.assistant_base_style), value.baseStyle,
                                listOf(
                                    "default" to stringResource(R.string.assistant_style_default),
                                    "friendly" to stringResource(R.string.assistant_style_friendly),
                                    "professional" to stringResource(R.string.assistant_style_professional),
                                    "direct" to stringResource(R.string.assistant_style_direct),
                                    "creative" to stringResource(R.string.assistant_style_creative),
                                ),
                                { controller.setChoice("baseStyle", it) }, Icons.Outlined.Tune, TileTone.Violet, enabled,
                            )
                        }
                    }
                    SettingsGroup {
                        listOf(
                            "warmth" to R.string.assistant_warmth,
                            "enthusiasm" to R.string.assistant_enthusiasm,
                            "emoji" to R.string.assistant_emoji,
                            "visualLayout" to R.string.assistant_visual_layout,
                            "headings" to R.string.assistant_headings,
                        ).forEach { (field, label) ->
                            item(hasIcon = false) {
                                val current = when (field) {
                                    "warmth" -> value.warmth
                                    "enthusiasm" -> value.enthusiasm
                                    "emoji" -> value.emoji
                                    "visualLayout" -> value.visualLayout
                                    else -> value.headings
                                }
                                SettingsMenuRow(stringResource(label), current, levels, { controller.setChoice(field, it) }, enabled = enabled)
                            }
                        }
                    }
                }
            }
            AssistantPages.INSTRUCTIONS -> item(key = "instructions") {
                SettingsGroup(footer = stringResource(R.string.settings_hub_autosave_footer)) {
                    item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_chat), value.chatInstructions, { controller.setText("chatInstructions", it) }, controller::flush, 10000, multiline = true, enabled = enabled) }
                    item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_task), value.taskInstructions, { controller.setText("taskInstructions", it) }, controller::flush, 10000, multiline = true, enabled = enabled) }
                    item(hasIcon = false) { SettingsTextField(stringResource(R.string.assistant_code), value.codeInstructions, { controller.setText("codeInstructions", it) }, controller::flush, 10000, multiline = true, enabled = enabled) }
                }
            }
            AssistantPages.MEMORY -> memoryPage(controller, value, enabled, openFeature)
        }
    }
    val current = controller.value
    if (sheet == "writing" && current != null) WritingStyleSheet(
        styles = controller.styleLibrary.writingStyles,
        selected = current.defaultWritingStyle.ifBlank { null },
        onSelect = { controller.setChoice("defaultWritingStyle", it.orEmpty()); sheet = null },
        onDismiss = { sheet = null },
    )
    if (sheet == "design" && current != null) DesignPresetSheet(
        styles = controller.styleLibrary.designStyles,
        selected = current.defaultDesignStyle.ifBlank { null },
        title = stringResource(R.string.preset_default_design_title),
        caption = stringResource(R.string.preset_default_design_caption),
        onSelect = { controller.setChoice("defaultDesignStyle", it.orEmpty()); sheet = null },
        onDismiss = { sheet = null },
    )
}

private fun LazyListScope.voicePage(controller: AssistantSettingsController, value: AssistantPersonalization, enabled: Boolean, push: (String) -> Unit) {
    item(key = "voice-output") {
        SettingsGroup(header = stringResource(R.string.settings_hub_voice_output), footer = stringResource(R.string.settings_hub_voice_footer)) {
            item {
                SettingsSwitchRow(stringResource(R.string.assistant_voice_chat), value.voiceChat, { controller.setBoolean("voiceChat", it) }, Icons.AutoMirrored.Outlined.VolumeUp, TileTone.Pink, enabled = enabled)
            }
            item {
                SettingsRow(
                    title = stringResource(R.string.assistant_voice_pick),
                    icon = Icons.Outlined.RecordVoiceOver,
                    tone = TileTone.Violet,
                    value = assistantVoiceLabel(value.voiceName),
                    enabled = enabled,
                    onClick = { push(AssistantPages.VOICE_PICKER) },
                )
            }
        }
    }
    item(key = "voice-history") {
        SettingsGroup {
            item { SettingsSwitchRow(stringResource(R.string.assistant_voice_history), value.voiceHistory, { controller.setBoolean("voiceHistory", it) }, Icons.Outlined.Mic, TileTone.Red, enabled = enabled) }
        }
    }
}

private fun LazyListScope.personalPage(
    controller: AssistantSettingsController,
    value: AssistantPersonalization,
    enabled: Boolean,
    push: (String) -> Unit,
    openSheet: (String) -> Unit,
) {
    item(key = "about-you") {
        SettingsGroup(header = stringResource(R.string.settings_hub_about_you)) {
            item {
                SettingsRow(
                    title = stringResource(R.string.settings_hub_profile),
                    icon = Icons.Outlined.Person,
                    tone = TileTone.Blue,
                    value = value.nickname.ifBlank { stringResource(R.string.settings_hub_not_set) },
                    onClick = { push(AssistantPages.PROFILE) },
                )
            }
            item {
                val count = value.referencePhotos.values.count { it != null }
                SettingsRow(
                    title = stringResource(R.string.assistant_reference_photos),
                    icon = Icons.Outlined.Image,
                    tone = TileTone.Green,
                    value = if (count == 0) stringResource(R.string.settings_hub_photos_none) else stringResource(R.string.settings_hub_photos_count, count),
                    onClick = { push(AssistantPages.PHOTOS) },
                )
            }
        }
    }
    item(key = "style") {
        SettingsGroup(header = stringResource(R.string.settings_hub_style)) {
            item {
                SettingsRow(
                    title = stringResource(R.string.assistant_writing_style),
                    icon = Icons.Outlined.FormatQuote,
                    tone = TileTone.Orange,
                    value = stringResource(if (value.writingStyleEnabled) R.string.settings_hub_on else R.string.settings_hub_off),
                    onClick = { push(AssistantPages.WRITING) },
                )
            }
            item {
                SettingsRow(
                    title = stringResource(R.string.assistant_response_style),
                    icon = Icons.Outlined.Tune,
                    tone = TileTone.Violet,
                    value = when (value.baseStyle) {
                        "friendly" -> stringResource(R.string.assistant_style_friendly)
                        "professional" -> stringResource(R.string.assistant_style_professional)
                        "direct" -> stringResource(R.string.assistant_style_direct)
                        "creative" -> stringResource(R.string.assistant_style_creative)
                        else -> stringResource(R.string.assistant_style_default)
                    },
                    onClick = { push(AssistantPages.RESPONSE) },
                )
            }
            item {
                SettingsRow(
                    title = stringResource(R.string.assistant_custom_instructions),
                    icon = Icons.Outlined.EditNote,
                    tone = TileTone.Teal,
                    onClick = { push(AssistantPages.INSTRUCTIONS) },
                )
            }
            item {
                SettingsRow(
                    title = stringResource(R.string.preset_default_design),
                    icon = Icons.Outlined.Palette,
                    tone = TileTone.Pink,
                    value = controller.styleLibrary.designStyles.presetName(value.defaultDesignStyle, design = true) ?: stringResource(R.string.preset_design_none),
                    enabled = enabled,
                    onClick = { openSheet("design") },
                )
            }
        }
    }
    item(key = "answers") {
        SettingsGroup(header = stringResource(R.string.settings_hub_answers), footer = stringResource(R.string.settings_hub_autosave_footer)) {
            item { SettingsSwitchRow(stringResource(R.string.assistant_concise), value.conciseAnswers, { controller.setBoolean("conciseAnswers", it) }, Icons.Outlined.Speed, TileTone.Amber, enabled = enabled) }
            item { SettingsSwitchRow(stringResource(R.string.assistant_suggestions), value.suggestedPrompts, { controller.setBoolean("suggestedPrompts", it) }, Icons.Outlined.Lightbulb, TileTone.Amber, enabled = enabled) }
            item { SettingsSwitchRow(stringResource(R.string.assistant_web_search), value.webSearch, { controller.setBoolean("webSearch", it) }, Icons.Outlined.TravelExplore, TileTone.Blue, enabled = enabled) }
            item { SettingsSwitchRow(stringResource(R.string.assistant_project_search), value.projectSearch, { controller.setBoolean("projectSearch", it) }, Icons.Outlined.FolderOpen, TileTone.Blue, enabled = enabled) }
            item { SettingsSwitchRow(stringResource(R.string.assistant_connector_search), value.connectorSearch, { controller.setBoolean("connectorSearch", it) }, Icons.Outlined.Cable, TileTone.Gray, enabled = enabled) }
        }
    }
}

private fun LazyListScope.memoryPage(controller: AssistantSettingsController, value: AssistantPersonalization, enabled: Boolean, openFeature: (String) -> Unit) {
    item(key = "memory") {
        SettingsGroup(footer = stringResource(R.string.assistant_memory_boundaries)) {
            item { SettingsSwitchRow(stringResource(R.string.assistant_memory_enabled), value.memoryEnabled, { controller.setBoolean("memoryEnabled", it) }, Icons.Outlined.Psychology, TileTone.Indigo, enabled = enabled) }
            item { SettingsSwitchRow(stringResource(R.string.assistant_memory_learning), value.memoryLearning, { controller.setBoolean("memoryLearning", it) }, Icons.Outlined.AutoAwesome, TileTone.Violet, enabled = enabled) }
            item { SettingsSwitchRow(stringResource(R.string.assistant_memory_agent_sharing), value.agentMemorySharing, { controller.setBoolean("agentMemorySharing", it) }, Icons.Outlined.Groups, TileTone.Teal, enabled = enabled) }
            item { SettingsRow(stringResource(R.string.assistant_manage_memory), Icons.AutoMirrored.Outlined.ManageSearch, TileTone.Blue, onClick = { openFeature("/assistant/memory") }) }
        }
    }
    item(key = "history") {
        SettingsGroup {
            item { SettingsSwitchRow(stringResource(R.string.assistant_chat_history), value.chatHistory, { controller.setBoolean("chatHistory", it) }, Icons.Outlined.History, TileTone.Gray, enabled = enabled) }
        }
    }
    item(key = "memory-model") {
        val providers = controller.providers
        val automatic = stringResource(R.string.assistant_automatic)
        SettingsGroup(header = stringResource(R.string.settings_hub_memory_model)) {
            item {
                SettingsMenuRow(
                    stringResource(R.string.assistant_memory_provider_choice), value.memoryProviderId,
                    listOf("" to automatic) + providers.map { it.id to it.name },
                    { controller.setChoices("memoryProviderId" to it, "memoryModel" to "") },
                    Icons.Outlined.Memory, TileTone.Gray, enabled,
                )
            }
            item {
                val models = (providers.firstOrNull { it.id == value.memoryProviderId } ?: providers.firstOrNull())?.models.orEmpty()
                SettingsMenuRow(
                    stringResource(R.string.assistant_memory_model_choice), value.memoryModel,
                    listOf("" to automatic) + models.map { it to it },
                    { model ->
                        val provider = if (model.isNotBlank() && value.memoryProviderId.isBlank()) providers.firstOrNull()?.id.orEmpty() else value.memoryProviderId
                        controller.setChoices("memoryModel" to model, "memoryProviderId" to provider)
                    },
                    Icons.Outlined.Memory, TileTone.Gray, enabled,
                )
            }
        }
    }
}

@Composable
private fun PhotosPage(controller: AssistantSettingsController, value: AssistantPersonalization, enabled: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var slotForPicker by rememberSaveable { mutableStateOf("portrait") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val slot = slotForPicker
            scope.launch {
                try {
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val bytes = withContext(Dispatchers.IO) {
                        context.contentResolver.openInputStream(uri)?.use { it.readBytesLimited(5 * 1024 * 1024) } ?: error("Image unavailable")
                    }
                    controller.changePhoto(slot, "reference.${mime.substringAfter('/')}", mime, bytes)
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    controller.reportError(failure.message)
                }
            }
        }
    }
    SettingsBlock {
        listOf("portrait" to R.string.assistant_portrait, "fullBody" to R.string.assistant_full_body).forEach { (slot, label) ->
            val photo = value.referencePhotos[slot]
            SettingsGroup(header = stringResource(label)) {
                if (photo != null) item(hasIcon = false) {
                    var bytes by remember(controller.owner, photo.id) { mutableStateOf<ByteArray?>(null) }
                    LaunchedEffect(controller.owner, photo.id) { bytes = controller.photo(slot) }
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        bytes?.let { AsyncImage(it, stringResource(label), Modifier.fillMaxWidth().heightIn(max = 220.dp).clip(RoundedCornerShape(12.dp))) }
                        Text(photo.filename, color = PlumMuted, fontSize = 12.sp)
                    }
                }
                item {
                    SettingsRow(
                        title = stringResource(if (photo == null) R.string.assistant_add else R.string.assistant_replace),
                        icon = Icons.Outlined.Image,
                        tone = TileTone.Green,
                        enabled = enabled && !controller.saving,
                        chevron = false,
                        onClick = { slotForPicker = slot; picker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")) },
                    )
                }
                if (photo != null) item {
                    SettingsRow(
                        title = stringResource(R.string.settings_hub_remove),
                        icon = Icons.Outlined.Image,
                        destructive = true,
                        enabled = enabled && !controller.saving,
                        chevron = false,
                        onClick = { controller.changePhoto(slot, null, null, null) },
                    )
                }
            }
        }
        Text(stringResource(R.string.assistant_photos_private), color = PlumMuted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp))
    }
}
