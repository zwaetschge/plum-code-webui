package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantPersonalization
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.theme.PlumGlassCard
import com.claudewebui.app.ui.theme.GlassRole
import kotlinx.coroutines.*
import org.koin.compose.koinInject
import androidx.compose.foundation.clickable
import com.claudewebui.app.ui.components.chat.DesignPresetSheet
import com.claudewebui.app.ui.components.chat.WritingStyleSheet
import com.claudewebui.app.ui.components.chat.presetName

@Composable
fun AssistantPersonalizationScreen(onClose: () -> Unit, onOpenFeature: (String) -> Unit, api: ApiClient = koinInject()) {
    val owner = TokenStore.assistantOwnerKey() ?: return
    key(owner) { PersonalizationAccount(owner, api, onClose, onOpenFeature) }
}

@Composable
private fun PersonalizationAccount(owner: String, api: ApiClient, onClose: () -> Unit, onOpenFeature: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var providers by remember { mutableStateOf<List<com.claudewebui.app.data.model.AssistantApiProvider>>(emptyList()) }
    var draft by remember { mutableStateOf(AssistantPersonalization()) }
    var showVoicePicker by remember { mutableStateOf(false) }
    var baseline by remember { mutableStateOf<AssistantPersonalization?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var photoSlot by remember { mutableStateOf("portrait") }
    var destination by remember { mutableStateOf<String?>(null) }
    var confirmClose by remember { mutableStateOf(false) }
    var styleLibrary by remember { mutableStateOf(com.claudewebui.app.data.model.StyleLibrary()) }
    var showWritingDefault by remember { mutableStateOf(false) }
    var showDesignDefault by remember { mutableStateOf(false) }
    val dirty = baseline != null && draft != baseline
    fun checkOwner() { if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed") }
    fun close(target: String? = null) { destination = target; if (dirty) confirmClose = true else if (target != null) onOpenFeature(target) else onClose() }
    BackHandler { close() }
    LaunchedEffect(owner, reload) {
        busy = true; error = null
        try {
            val response = api.getAssistantPersonalization(); checkOwner()
            check(response.success) { response.error?.message ?: context.getString(R.string.assistant_load_failed) }
            draft = requireNotNull(response.data); baseline = draft
            runCatching { api.getStyleLibrary() }.getOrNull()?.data?.let { checkOwner(); styleLibrary = it }
            val models = api.getAssistantApiProviders(); checkOwner()
            if (models.success) {
                val rank = mapOf("anthropic" to 0, "mistral" to 1, "deepseek" to 2, "z-ai" to 3, "zai" to 3)
                providers = models.data.orEmpty().filter { it.models.isNotEmpty() }.sortedBy { rank[it.id] ?: 4 }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message }
        finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
    }
    fun acceptPhoto(next: AssistantPersonalization) {
        checkOwner()
        baseline = next
        draft = draft.copy(revision = next.revision, referencePhotos = next.referencePhotos)
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && !busy && baseline != null) {
            val slot = photoSlot; val revision = draft.revision
            scope.launch {
                busy = true; error = null
                try {
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytesLimited(5 * 1024 * 1024) } ?: kotlin.error("Image unavailable") }
                    checkOwner()
                    val response = api.changeAssistantReferencePhoto(owner, slot, revision, "reference.${mime.substringAfter('/')}", mime, bytes)
                    check(response.success) { response.error?.message ?: context.getString(R.string.assistant_save_failed) }
                    acceptPhoto(requireNotNull(response.data))
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { checkOwner(); error = failure.message }
                finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
            }
        }
    }
    PlumBackdrop {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { close() }) { Text(stringResource(R.string.assistant_back)) }
                Text(stringResource(R.string.assistant_personalization), modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            }
            LazyColumn(Modifier.weight(1f).padding(horizontal = 16.dp), contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                error?.let { message -> item { PlumGlassCard { Text(message, color = MaterialTheme.colorScheme.error); TextButton(enabled = !busy, onClick = { reload++ }) { Text(stringResource(R.string.assistant_reload)) } } } }
                if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (baseline != null) {
                    item { PersonalizationGroup(R.string.assistant_memory) {
                        PreferenceToggle(R.string.assistant_memory_enabled, draft.memoryEnabled, !busy) { draft = draft.copy(memoryEnabled = it) }
                        PreferenceToggle(R.string.assistant_memory_learning, draft.memoryLearning, !busy) { draft = draft.copy(memoryLearning = it) }
                        PreferenceToggle(R.string.assistant_memory_agent_sharing, draft.agentMemorySharing, !busy) { draft = draft.copy(agentMemorySharing = it) }
                        PreferenceToggle(R.string.assistant_chat_history, draft.chatHistory, !busy) { draft = draft.copy(chatHistory = it) }
                        AssistantChoice(stringResource(R.string.assistant_memory_provider_choice), draft.memoryProviderId,
                            listOf("" to stringResource(R.string.assistant_automatic)) + providers.map { it.id to it.name }, !busy) {
                            draft = draft.copy(memoryProviderId = it, memoryModel = "")
                        }
                        val models = (providers.firstOrNull { it.id == draft.memoryProviderId } ?: providers.firstOrNull())?.models.orEmpty()
                        AssistantChoice(stringResource(R.string.assistant_memory_model_choice), draft.memoryModel,
                            listOf("" to stringResource(R.string.assistant_automatic)) + models.map { it to it }, !busy) { draft = draft.copy(memoryModel = it, memoryProviderId = if (it.isNotBlank() && draft.memoryProviderId.isBlank()) providers.firstOrNull()?.id.orEmpty() else draft.memoryProviderId) }
                        TextButton(onClick = { close("/assistant/memory") }) { Text(stringResource(R.string.assistant_manage_memory)) }
                        Text(stringResource(R.string.assistant_memory_boundaries), style = MaterialTheme.typography.bodySmall)
                    } }
                    item { PersonalizationGroup(R.string.assistant_writing_style) {
                        PreferenceToggle(R.string.assistant_writing_enabled, draft.writingStyleEnabled, !busy) { draft = draft.copy(writingStyleEnabled = it) }
                        PreferenceToggle(R.string.assistant_writing_learning, draft.writingStyleLearning, !busy) { draft = draft.copy(writingStyleLearning = it) }
                        PreferenceText(R.string.assistant_writing_sample, draft.writingSample, !busy, 10000, true) { draft = draft.copy(writingSample = it) }
                    } }
                    item { PersonalizationGroup(R.string.preset_defaults_title) {
                        PresetDefaultRow(
                            stringResource(R.string.preset_default_writing),
                            styleLibrary.writingStyles.presetName(draft.defaultWritingStyle) ?: stringResource(R.string.preset_style_none),
                            !busy,
                        ) { showWritingDefault = true }
                        PresetDefaultRow(
                            stringResource(R.string.preset_default_design),
                            styleLibrary.designStyles.presetName(draft.defaultDesignStyle, design = true) ?: stringResource(R.string.preset_design_none),
                            !busy,
                        ) { showDesignDefault = true }
                        Text(stringResource(R.string.preset_default_design_caption), style = MaterialTheme.typography.bodySmall)
                    } }
                    item { PersonalizationGroup(R.string.assistant_about_you) {
                        PreferenceText(R.string.assistant_nickname, draft.nickname, !busy, 100) { draft = draft.copy(nickname = it) }
                        PreferenceText(R.string.assistant_occupation, draft.occupation, !busy, 200) { draft = draft.copy(occupation = it) }
                        PreferenceText(R.string.assistant_about_you, draft.aboutYou, !busy, 10000, true) { draft = draft.copy(aboutYou = it) }
                    } }
                    item { PersonalizationGroup(R.string.assistant_reference_photos) {
                        listOf("portrait" to R.string.assistant_portrait, "fullBody" to R.string.assistant_full_body).forEach { (slot, label) ->
                            Text(stringResource(label), style = MaterialTheme.typography.titleSmall)
                            val photo = draft.referencePhotos[slot]
                            var bytes by remember(owner, photo?.id) { mutableStateOf<ByteArray?>(null) }
                            LaunchedEffect(owner, photo?.id) { if (photo != null) try { val data = api.getAssistantReferencePhoto(slot); checkOwner(); bytes = data } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { bytes = null } }
                            bytes?.let { AsyncImage(it, stringResource(label), Modifier.fillMaxWidth().heightIn(max = 180.dp)) }
                            photo?.let { Text(it.filename, style = MaterialTheme.typography.bodySmall) }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(enabled = !busy, onClick = { photoSlot = slot; picker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")) }) { Text(stringResource(if (photo == null) R.string.assistant_add else R.string.assistant_replace)) }
                                if (photo != null) TextButton(enabled = !busy, onClick = { scope.launch {
                                    busy = true; error = null
                                    try { val response = api.changeAssistantReferencePhoto(owner, slot, draft.revision, null, null, null); check(response.success) { response.error?.message ?: context.getString(R.string.assistant_save_failed) }; acceptPhoto(requireNotNull(response.data)) }
                                    catch (cancelled: CancellationException) { throw cancelled }
                                    catch (failure: Exception) { checkOwner(); error = failure.message }
                                    finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
                                } }) { Text(stringResource(R.string.assistant_remove_image)) }
                            }
                        }
                        Text(stringResource(R.string.assistant_photos_private), style = MaterialTheme.typography.bodySmall)
                    } }
                    item { PersonalizationGroup(R.string.assistant_response_style) {
                        AssistantChoice(stringResource(R.string.assistant_base_style), draft.baseStyle, listOf("default" to stringResource(R.string.assistant_style_default), "friendly" to stringResource(R.string.assistant_style_friendly), "professional" to stringResource(R.string.assistant_style_professional), "direct" to stringResource(R.string.assistant_style_direct), "creative" to stringResource(R.string.assistant_style_creative)), !busy) { draft = draft.copy(baseStyle = it) }
                        PreferenceLevel(R.string.assistant_warmth, draft.warmth, !busy) { draft = draft.copy(warmth = it) }
                        PreferenceLevel(R.string.assistant_enthusiasm, draft.enthusiasm, !busy) { draft = draft.copy(enthusiasm = it) }
                        PreferenceLevel(R.string.assistant_emoji, draft.emoji, !busy) { draft = draft.copy(emoji = it) }
                        PreferenceLevel(R.string.assistant_visual_layout, draft.visualLayout, !busy) { draft = draft.copy(visualLayout = it) }
                        PreferenceLevel(R.string.assistant_headings, draft.headings, !busy) { draft = draft.copy(headings = it) }
                    } }
                    item { PersonalizationGroup(R.string.assistant_custom_instructions) {
                        PreferenceText(R.string.assistant_chat, draft.chatInstructions, !busy, 10000, true) { draft = draft.copy(chatInstructions = it) }
                        PreferenceText(R.string.assistant_task, draft.taskInstructions, !busy, 10000, true) { draft = draft.copy(taskInstructions = it) }
                        PreferenceText(R.string.assistant_code, draft.codeInstructions, !busy, 10000, true) { draft = draft.copy(codeInstructions = it) }
                    } }
                    item { PersonalizationGroup(R.string.assistant_preferences) {
                        PreferenceToggle(R.string.assistant_concise, draft.conciseAnswers, !busy) { draft = draft.copy(conciseAnswers = it) }
                        PreferenceToggle(R.string.assistant_suggestions, draft.suggestedPrompts, !busy) { draft = draft.copy(suggestedPrompts = it) }
                        PreferenceToggle(R.string.assistant_voice_history, draft.voiceHistory, !busy) { draft = draft.copy(voiceHistory = it) }
                        PreferenceToggle(R.string.assistant_web_search, draft.webSearch, !busy) { draft = draft.copy(webSearch = it) }
                        PreferenceToggle(R.string.assistant_voice_chat, draft.voiceChat, !busy) { draft = draft.copy(voiceChat = it) }
                        TextButton(onClick = { showVoicePicker = true }, enabled = !busy) {
                            Text(stringResource(R.string.assistant_voice_pick) + ": " + draft.voiceName.ifBlank { stringResource(R.string.model_picker_default) })
                        }
                        PreferenceToggle(R.string.assistant_project_search, draft.projectSearch, !busy) { draft = draft.copy(projectSearch = it) }
                        PreferenceToggle(R.string.assistant_connector_search, draft.connectorSearch, !busy) { draft = draft.copy(connectorSearch = it) }
                    } }
                }
            }
            PlumGlassCard(Modifier.fillMaxWidth(), role = GlassRole.Strong) {
                Button(modifier = Modifier.fillMaxWidth(), enabled = dirty && !busy, onClick = { scope.launch {
                    busy = true; error = null
                    try { val response = api.updateAssistantPersonalization(owner, draft.updatePayload()); checkOwner(); check(response.success) { response.error?.message ?: context.getString(R.string.assistant_save_failed) }; draft = requireNotNull(response.data); baseline = draft }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { checkOwner(); error = failure.message }
                    finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
                } }) { Text(stringResource(if (busy) R.string.assistant_saving else R.string.assistant_save)) }
            }
        }
    }
    if (confirmClose) AlertDialog(onDismissRequest = { confirmClose = false }, title = { Text(stringResource(R.string.assistant_unsaved)) }, text = { Text(stringResource(R.string.assistant_unsaved_detail)) }, confirmButton = { TextButton(onClick = { destination?.let(onOpenFeature) ?: onClose() }) { Text(stringResource(R.string.assistant_discard)) } }, dismissButton = { TextButton(onClick = { confirmClose = false }) { Text(stringResource(R.string.assistant_continue_editing)) } })
    if (showWritingDefault) WritingStyleSheet(
        styles = styleLibrary.writingStyles,
        selected = draft.defaultWritingStyle.ifBlank { null },
        onSelect = { draft = draft.copy(defaultWritingStyle = it.orEmpty()); showWritingDefault = false },
        onDismiss = { showWritingDefault = false },
    )
    if (showDesignDefault) DesignPresetSheet(
        styles = styleLibrary.designStyles,
        selected = draft.defaultDesignStyle.ifBlank { null },
        title = stringResource(R.string.preset_default_design_title),
        caption = stringResource(R.string.preset_default_design_caption),
        onSelect = { draft = draft.copy(defaultDesignStyle = it.orEmpty()); showDesignDefault = false },
        onDismiss = { showDesignDefault = false },
    )
    if (showVoicePicker) VoicePickerSheet(owner, api, draft.voiceName, { draft = draft.copy(voiceName = it) }, { showVoicePicker = false })
}

@Composable private fun PersonalizationGroup(title: Int, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { Text(stringResource(title), style = MaterialTheme.typography.titleMedium); PlumGlassCard(Modifier.fillMaxWidth()) { Column(verticalArrangement = Arrangement.spacedBy(12.dp), content = content) } }
}
@Composable private fun PreferenceText(label: Int, value: String, enabled: Boolean, limit: Int, multiline: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(value, { onChange(it.take(limit)) }, label = { Text(stringResource(label)) }, enabled = enabled, modifier = Modifier.fillMaxWidth(), minLines = if (multiline) 3 else 1, singleLine = !multiline)
}
@Composable private fun PresetDefaultRow(label: String, value: String, enabled: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = enabled, onClick = onClick), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label)
            Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, maxLines = 1)
        }
        Text("›", style = MaterialTheme.typography.titleMedium)
    }
}
@Composable private fun PreferenceToggle(label: Int, value: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { Text(stringResource(label), Modifier.weight(1f)); Switch(value, onChange, enabled = enabled) }
}
@Composable private fun PreferenceLevel(label: Int, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    AssistantChoice(stringResource(label), value, listOf("less" to stringResource(R.string.assistant_style_less), "default" to stringResource(R.string.assistant_style_default), "more" to stringResource(R.string.assistant_style_more)), enabled, onChange)
}
internal fun java.io.InputStream.readBytesLimited(max: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val n = read(buffer); if (n < 0) break; require(out.size() + n <= max) { "Datei ist zu gross" }; out.write(buffer, 0, n) }
    return out.toByteArray()
}
