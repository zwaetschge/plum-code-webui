package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.motion.PlumMotionTokens
import com.claudewebui.app.ui.motion.StreamingCaret
import com.claudewebui.app.ui.motion.ThinkingDots
import com.claudewebui.app.ui.motion.orSnap
import com.claudewebui.app.ui.motion.plumSwitchTransform
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.motion.riseIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import coil3.compose.AsyncImage
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.AssistantApiOutbox
import com.claudewebui.app.data.AssistantPendingCommand
import com.claudewebui.app.data.model.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.koin.compose.koinInject
import com.claudewebui.app.ui.components.chat.MarkdownContent
import com.claudewebui.app.ui.components.chat.WritingStyleSheet
import com.claudewebui.app.ui.components.chat.presetName
import com.claudewebui.app.ui.components.dynamicui.DynamicUi
import com.claudewebui.app.ui.components.dynamicui.DynamicUiStateStore
import com.claudewebui.app.ui.components.dynamicui.DynamicUiNote
import com.claudewebui.app.ui.components.dynamicui.DynamicUiPending
import java.time.Instant
import java.time.temporal.ChronoUnit

@Composable
fun AssistantModelChat(
    topInset: androidx.compose.ui.unit.Dp,
    historyOpen: Boolean,
    onHistoryDismiss: () -> Unit,
    onAreaSelect: (String) -> Unit,
    onAgentChats: () -> Unit,
    // The open conversation is owned by the area workspace, so it survives
    // fold changes and the expanded layout's history column can drive it.
    selectedChatId: String? = null,
    onChatSelected: (String?) -> Unit = {},
    api: ApiClient = koinInject(),
) {
    // Debug design previews run without an account; they still render the layout.
    val owner = TokenStore.assistantOwnerKey() ?: (if (com.claudewebui.app.BuildConfig.DEBUG) "preview" else return)
    // All state, thumbnails and effects are discarded when the account changes.
    key(owner) { ModelChatAccount(owner, api, topInset, historyOpen, onHistoryDismiss, onAreaSelect, onAgentChats, selectedChatId, onChatSelected) }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun ModelChatAccount(owner: String, api: ApiClient, topInset: androidx.compose.ui.unit.Dp, historyOpen: Boolean, onHistoryDismiss: () -> Unit, onAreaSelect: (String) -> Unit, onAgentChats: () -> Unit, selectedChatId: String?, onChatSelected: (String?) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }
    val outbox = remember(owner) { AssistantApiOutbox(api, owner) }
    var providers by remember { mutableStateOf<List<AssistantApiProvider>>(emptyList()) }
    var profiles by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var projects by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var sources by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var chat by remember { mutableStateOf<AssistantResource?>(null) }
    var turns by remember { mutableStateOf<List<AssistantApiTurn>>(emptyList()) }
    val dynamicUiState = rememberSaveable(chat?.id, saver = DynamicUiStateStore.StateSaver) { DynamicUiStateStore() }
    var pending by remember { mutableStateOf<List<AssistantPendingCommand>>(emptyList()) }
    var providerId by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var profileId by rememberSaveable { mutableStateOf<String?>(null) }
    var projectId by rememberSaveable { mutableStateOf<String?>(null) }
    var showWorkspace by remember { mutableStateOf(false) }
    var workspaceCollection by rememberSaveable { mutableStateOf("projects") }
    var workspaceNavigation by remember { mutableIntStateOf(0) }
    var sourceIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var imageIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var documentIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var documentNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var realtimeVoice by remember { mutableStateOf(false) }
    var showAdvanced by remember { mutableStateOf(false) }
    var newChatOptions by remember { mutableStateOf(buildJsonObject {}) }
    var prompt by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var temporary by rememberSaveable { mutableStateOf(false) }
    var memoryRead by rememberSaveable { mutableStateOf(true) }
    var memoryLearn by rememberSaveable { mutableStateOf(true) }
    var showMemory by remember { mutableStateOf(false) }
    var research by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var openedCode by remember { mutableStateOf<Triple<String, String, List<AssistantChatSource>>?>(null) }
    var openedSource by remember { mutableStateOf<AssistantChatSource?>(null) }
    var sourceDownload by remember { mutableStateOf<ByteArray?>(null) }
    val sourceSave = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val bytes = sourceDownload; sourceDownload = null
        if (uri != null && bytes != null) scope.launch {
            try { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } } }
            catch (failure: Exception) { error = failure.message }
        }
    }
    var refresh by remember { mutableIntStateOf(0) }
    var pendingReview by remember { mutableStateOf<AssistantPendingCommand?>(null) }
    var voiceBusy by remember { mutableStateOf(false) }
    var cameraBusy by remember { mutableStateOf(false) }
    var readText by remember { mutableStateOf<String?>(null) }
    var personalization by remember { mutableStateOf<AssistantPersonalization?>(null) }
    var writingStyles by remember { mutableStateOf<List<ConfigSkill>>(emptyList()) }
    // New chat: false keeps the account default, true sends newChatStyle (null = none).
    var newChatStyleSet by rememberSaveable { mutableStateOf(false) }
    var newChatStyle by rememberSaveable { mutableStateOf<String?>(null) }
    var showStyleSheet by remember { mutableStateOf(false) }
    var showVoiceSheet by remember { mutableStateOf(false) }
    var voiceMode by remember { mutableStateOf(false) }
    // Which chat's history defined the "already there" turns, and their highest seq.
    var baselineChat by remember { mutableStateOf<String?>(null) }
    var baselineSeq by remember { mutableLongStateOf(Long.MAX_VALUE) }
    LaunchedEffect(owner) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                try { val result = api.getAssistantPersonalization(); if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed"); personalization = if (result.success) result.data else null }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { personalization = null }
                delay(10000)
            }
        }
    }
    // A voice or switch changed in the settings (or the voice sheet) applies to
    // the next read-aloud right away instead of after the periodic refresh.
    LaunchedEffect(owner) {
        com.claudewebui.app.ui.screens.settings.AssistantPersonalizationEvents.latest.collect { latest ->
            if (latest != null && latest.first == owner) personalization = latest.second
        }
    }
    val voiceEnabled = personalization?.voiceChat == true
    LaunchedEffect(voiceEnabled) { if (!voiceEnabled) readText = null }
    val chatId = chat?.id
    val running = turns.any { it.status == "running" || it.status == "queued" }
    LaunchedEffect(owner, chatId) { readText = null }
    fun checkOwner() { if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed") }
    fun refreshWorkspaceResources() {
        scope.launch {
            try {
                val profileResult = api.getAssistantResources("profiles"); checkOwner(); profiles = profileResult.data.orEmpty()
                val projectResult = api.getAssistantResources("projects"); checkOwner(); projects = projectResult.data.orEmpty()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
        }
    }
    val currentOnChatSelected by rememberUpdatedState(onChatSelected)
    // Reloading the selected chat after recreation must keep its unsent draft.
    var draftChatId by rememberSaveable { mutableStateOf(selectedChatId) }
    fun showChat(resource: AssistantResource?, restoring: Boolean = false) {
        if (!restoring || draftChatId != resource?.id) prompt = ""
        draftChatId = resource?.id
        chat = resource; turns = emptyList(); imageIds = emptyList(); documentIds = emptyList(); documentNames = emptyMap()
    }
    // The workspace picked another conversation (history column, restored
    // selection, "new chat"): follow it. Internal switches report back through
    // currentOnChatSelected, so both sides agree and this stays a no-op.
    LaunchedEffect(owner, selectedChatId) {
        if (selectedChatId == chat?.id) return@LaunchedEffect
        if (selectedChatId == null) { showChat(null, restoring = true); return@LaunchedEffect }
        RecentModelChats.get(selectedChatId)?.let { showChat(it, restoring = true); return@LaunchedEffect }
        try {
            val response = api.getAssistantApiTurns(selectedChatId); checkOwner()
            val loaded = response.data?.chat
            if (response.success && loaded != null) showChat(loaded, restoring = true) else currentOnChatSelected(chat?.id)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message; currentOnChatSelected(chat?.id) }
    }
    var regenerating by remember { mutableStateOf(false) }
    fun updatePending() { scope.launch { checkOwner(); pending = outbox.pending() } }
    fun accept(path: String, result: JsonObject, keepDraft: Boolean = false) {
        checkOwner()
        if (path == "/api/assistant/api-chats") {
            chat = json.decodeFromJsonElement<AssistantResource>(result); turns = emptyList(); imageIds = emptyList()
            draftChatId = chat?.id
            currentOnChatSelected(chat?.id)
        } else if (path.endsWith("/branches")) {
            chat = json.decodeFromJsonElement<AssistantResource>(result.getValue("chat"))
            draftChatId = chat?.id
            currentOnChatSelected(chat?.id)
            turns = emptyList(); prompt = result["prompt"]?.jsonPrimitive?.content.orEmpty()
            imageIds = result["imageAssetIds"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
        } else if (path == "/api/assistant/api-chats/${chat?.id}/turns") {
            if (!keepDraft) prompt = ""
            // A regenerated version replaces part of the thread: reload it whole.
            if (result["versionOf"] != null || regenerating) { turns = emptyList(); regenerating = false } else { imageIds = emptyList(); documentIds = emptyList(); documentNames = emptyMap() }
        }
        else if (path.endsWith("/results")) notice = context.getString(R.string.assistant_result_saved)
        refresh++
    }
    fun command(path: String, payload: JsonObject, label: String, expiresAt: String? = chat?.body?.get("expiresAt")?.jsonPrimitive?.contentOrNull, keepDraft: Boolean = false) {
        if (busy) return
        scope.launch {
            busy = true; error = null
            try { accept(path, outbox.send(path, payload, label, expiresAt), keepDraft) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; updatePending() } }
        }
    }
    LaunchedEffect(owner) {
        try {
            pending = outbox.pending()
            val catalog = api.getAssistantApiProviders(); checkOwner()
            providers = catalog.data.orEmpty()
            val selectedProvider = providers.firstOrNull { it.id == providerId } ?: providers.firstOrNull()
            providerId = selectedProvider?.id.orEmpty()
            if (model !in selectedProvider?.models.orEmpty()) model = selectedProvider?.models?.firstOrNull().orEmpty()
            val profileResult = api.getAssistantResources("profiles"); checkOwner(); profiles = profileResult.data.orEmpty()
            val projectResult = api.getAssistantResources("projects"); checkOwner(); projects = projectResult.data.orEmpty()
            val sourceResult = api.getAssistantResources("sources"); checkOwner(); sources = sourceResult.data.orEmpty()
            runCatching { api.getStyleLibrary() }.getOrNull()?.data?.let { checkOwner(); writingStyles = it.writingStyles }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message }
    }
    LaunchedEffect(owner, chatId, refresh) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                try {
                    // The conversation list lives in ModelChatHistoryList now.
                    if (chatId != null) {
                        val response = api.getAssistantApiTurns(chatId); checkOwner()
                        if (!response.success) kotlin.error(response.error?.message ?: "Conversation unavailable")
                        val history = requireNotNull(response.data)
                        // Latest snapshots replace their suffix, retaining older loaded pages.
                        val first = history.turns.firstOrNull()?.seq ?: Long.MAX_VALUE
                        // A short snapshot is the whole visible thread (regenerated versions may
                        // have hidden older turns); only a full page keeps loaded older pages.
                        val merged = if (history.turns.size < 50 || (turns.isNotEmpty() && turns.last().seq < first - 1)) history.turns else (turns.filter { it.seq < first } + history.turns).distinctBy { it.id }.sortedBy { it.seq }
                        // The first snapshot of a chat is its history: it is drawn in
                        // place. Only turns with a higher seq rise in afterwards.
                        if (baselineChat != chatId) { baselineChat = chatId; baselineSeq = merged.maxOfOrNull { it.seq } ?: 0L }
                        turns = merged
                        chat = history.chat
                    }
                    pending = outbox.pending()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { checkOwner(); error = failure.message }
                delay(if (turns.any { it.status == "running" || it.status == "queued" }) 500 else 5_000)
            }
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && !busy && imageIds.size + documentIds.size < 4) scope.launch {
            busy = true; error = null
            try {
                var target = chat
                if (target == null) {
                    require(providerId.isNotBlank() && model.isNotBlank()) { "Modell auswählen" }
                    val created = outbox.send("/api/assistant/api-chats", buildJsonObject {
                        put("title", prompt.trim().take(80).ifEmpty { "Neues Gespräch" }); put("providerId", providerId); put("model", model)
                        profileId?.let { put("profileId", it) }; put("projectId", if (temporary) JsonNull else projectId?.let(::JsonPrimitive) ?: JsonNull)
                        put("sourceIds", JsonArray(sourceIds.map(::JsonPrimitive))); put("temporary", temporary); put("chatOptions", newChatOptions)
                        put("memoryRead", !temporary && memoryRead); put("memoryLearn", !temporary && memoryLearn)
                        if (newChatStyleSet) put("writingStyleSkill", newChatStyle?.let(::JsonPrimitive) ?: JsonNull)
                    }, context.getString(R.string.assistant_new), null)
                    checkOwner(); accept("/api/assistant/api-chats", created); target = requireNotNull(chat)
                }
                val destination = requireNotNull(target)
                val resolver = context.contentResolver
                val mime = resolver.getType(uri) ?: "application/octet-stream"
                val isImage = mime.startsWith("image/")
                val limit = (if (isImage) 5 else 25) * 1024 * 1024
                val filename = resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: "Datei"
                val bytes = withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)?.use { input ->
                        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                        while (output.size() <= limit) { val length = input.read(buffer, 0, minOf(buffer.size, limit + 1 - output.size())); if (length < 0) break; output.write(buffer, 0, length) }
                        require(output.size() <= limit) { "Datei ist zu gross" }; output.toByteArray()
                    } ?: kotlin.error("Datei nicht verfügbar")
                }
                checkOwner()
                if (isImage) {
                    val response = api.uploadAssistantApiImage(owner, destination.id, filename, mime, bytes)
                    checkOwner(); require(response.success) { response.error?.message ?: "Upload fehlgeschlagen" }
                    if (chat?.id == destination.id) imageIds = (imageIds + requireNotNull(response.data).id).distinct()
                } else {
                    val response = api.uploadAssistantApiDocument(owner, destination.id, filename, mime, bytes)
                    checkOwner(); require(response.success) { response.error?.message ?: "Upload fehlgeschlagen" }
                    val id = requireNotNull(response.data?.get("id")?.jsonPrimitive?.content)
                    if (chat?.id == destination.id) { documentIds = (documentIds + id).distinct(); documentNames = documentNames + (id to filename) }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
        }
    }
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val showHistory = historyOpen
    var showAttach by remember { mutableStateOf(false) }
    var showModelSheet by remember { mutableStateOf(false) }
    var effort by rememberSaveable { mutableStateOf<String?>(null) }
    val effortStops = apiEffortStops()
    val effortLabel = effortStops.firstOrNull { it.id == effort && it.id != null }?.label
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val reduce = reducedMotion()
    // A Dynamic UI button (override) sends like the composer, into the open chat,
    // but leaves the typed draft alone.
    val voicePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) voiceMode = true else error = context.getString(R.string.voice_mode_permission)
    }
    val realtimePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) realtimeVoice = true else error = context.getString(R.string.voice_mode_permission)
    }
    fun openRealtime() {
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) realtimeVoice = true
        else realtimePermission.launch(android.Manifest.permission.RECORD_AUDIO)
    }
    fun openVoiceMode() {
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) voiceMode = true
        else voicePermission.launch(android.Manifest.permission.RECORD_AUDIO)
    }
    // Voice and writing style from the ≡ header menu. Without voice features the
    // voice sheet opens, which has the switch to turn them on.
    val voiceAllowed by rememberUpdatedState(voiceEnabled)
    val dismissHistory by rememberUpdatedState(onHistoryDismiss)
    LaunchedEffect(owner) {
        DashboardMenuBus.events.collect { command ->
            when (command) {
                DashboardMenuCommand.CHAT -> showWorkspace = false
                DashboardMenuCommand.PROJECTS, DashboardMenuCommand.ASSISTANTS -> {
                    workspaceCollection = if (command == DashboardMenuCommand.PROJECTS) "projects" else "profiles"
                    workspaceNavigation++
                    showWorkspace = true
                    dismissHistory()
                }
                DashboardMenuCommand.VOICE_MODE -> { if (voiceAllowed) openVoiceMode() else showVoiceSheet = true }
                DashboardMenuCommand.VOICE -> showVoiceSheet = true
                DashboardMenuCommand.WRITING_STYLE -> showStyleSheet = true
                else -> Unit
            }
        }
    }
    // The voice mode (voice = true) also starts a new chat and leaves the draft alone.
    // ChatGPT semantics: answer again (or with an edited question) in this chat;
    // the previous version stays reachable through the version switcher.
    fun regenerate(turn: AssistantApiTurn, text: String = turn.prompt) {
        val current = chat ?: return
        if (busy || running || text.isBlank()) return
        regenerating = true
        command("/api/assistant/api-chats/${current.id}/turns", buildJsonObject {
            put("prompt", text.trim()); put("expectedRevision", current.revision)
            put("imageAssetIds", JsonArray(turn.imageAssetIds.map(::JsonPrimitive))); put("regenerate", turn.id)
            effort?.let { put("reasoningEffort", it) }
        }, context.getString(if (text.trim() == turn.prompt) R.string.assistant_regenerate else R.string.assistant_edit_message), keepDraft = true)
    }
    fun showVersion(turnId: String) {
        val current = chat ?: return
        if (busy || running) return
        scope.launch {
            busy = true; error = null
            try {
                val response = api.activateAssistantApiTurn(current.id, turnId); checkOwner()
                check(response.success) { response.error?.message.orEmpty() }
                turns = emptyList(); refresh++
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
        }
    }
    fun send(override: String? = null, voice: Boolean = false) {
        val text = (override ?: prompt).trim()
        if (text.isEmpty() || busy || (voice && running)) return
        val current = chat
        if (current != null) {
            command("/api/assistant/api-chats/${current.id}/turns", buildJsonObject { put("prompt", text); put("expectedRevision", current.revision); put("imageAssetIds", JsonArray(if (voice) emptyList() else imageIds.map(::JsonPrimitive))); put("documentSourceIds", JsonArray(if (voice) emptyList() else documentIds.map(::JsonPrimitive))); if (voice) put("voice", true) else effort?.let { put("reasoningEffort", it) } }, context.getString(R.string.assistant_send), keepDraft = override != null)
        } else if ((override == null || voice) && providerId.isNotBlank() && model.isNotBlank()) scope.launch {
            busy = true; error = null
            try {
                val created = outbox.send("/api/assistant/api-chats", buildJsonObject {
                    put("title", text.take(48)); put("providerId", providerId); put("model", model)
                    profileId?.let { put("profileId", it) }; put("sourceIds", JsonArray(sourceIds.map(::JsonPrimitive)))
                    put("temporary", temporary); put("chatOptions", newChatOptions)
                        put("memoryRead", !temporary && memoryRead); put("memoryLearn", !temporary && memoryLearn)
                    if (research && !temporary) put("workflow", "research")
                    put("projectId", projectId?.let(::JsonPrimitive) ?: JsonNull)
                    if (newChatStyleSet) put("writingStyleSkill", newChatStyle?.let(::JsonPrimitive) ?: JsonNull)
                }, context.getString(R.string.assistant_new), null)
                checkOwner(); accept("/api/assistant/api-chats", created)
                val target = chat ?: return@launch
                // A brand-new chat has no history: its first turn rises in.
                baselineChat = target.id; baselineSeq = 0L
                val sent = outbox.send("/api/assistant/api-chats/${target.id}/turns", buildJsonObject { put("prompt", text); put("expectedRevision", target.revision); put("imageAssetIds", JsonArray(emptyList())); if (voice) put("voice", true) else effort?.let { put("reasoningEffort", it) } }, context.getString(R.string.assistant_send), null)
                checkOwner(); accept("/api/assistant/api-chats/${target.id}/turns", sent, keepDraft = voice)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; updatePending() } }
        }
    }
    val researchChat = chat?.body?.get("workflow")?.jsonPrimitive?.contentOrNull == "research"
    val activeWritingStyle = chat?.let { it.body["writingStyleSkill"]?.jsonPrimitive?.contentOrNull }
        ?: if (chat != null) null else if (newChatStyleSet) newChatStyle else personalization?.defaultWritingStyle?.ifBlank { null }
    openedCode?.let { (code, language, sources) -> ChatCodeSheet(code, language, sources, api) { openedCode = null } }
    openedSource?.let { source ->
        AlertDialog(onDismissRequest = { openedSource = null }, title = { Text(source.title) }, text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Revision ${source.revision}" + (source.page?.let { " · Seite $it" } ?: ""), style = MaterialTheme.typography.labelSmall)
                Text(source.text, style = MaterialTheme.typography.bodyMedium)
            }
        }, confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
            busy = true; error = null
            try { val bytes = api.getAssistantSourceFile(source.id, source.revision); checkOwner(); sourceDownload = bytes; sourceSave.launch(source.title.replace(Regex("[\\/\\p{Cntrl}]"), "_")); openedSource = null }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
        } }) { Text("Originaldatei") } }, dismissButton = { TextButton(onClick = { openedSource = null }) { Text("Schliessen") } })
    }
    if (realtimeVoice && chat != null) RealtimeVoiceSheet(owner, chat!!.id, { refresh++ }) { realtimeVoice = false; refresh++ }
    if (showAdvanced) ChatWorkbenchSheet(
        owner, api, chat, providers, newChatOptions.takeIf { it.isNotEmpty() } ?: (profiles.firstOrNull { it.id == profileId }?.body?.get("chatOptions") as? JsonObject ?: newChatOptions),
        onSaved = { options, resource -> newChatOptions = options; resource?.let { chat = it }; refresh++ },
        onImported = { id -> scope.launch { try { val loaded = api.getAssistantApiTurns(id); checkOwner(); loaded.data?.chat?.let { showChat(it); currentOnChatSelected(it.id) }; showAdvanced = false } catch (failure: Exception) { error = failure.message } } },
        onDismiss = { showAdvanced = false },
    )
    if (!showWorkspace) Column(Modifier.fillMaxSize().padding(top = topInset).navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
        // Switching chats: the old conversation leaves quickly, the new one
        // settles in. Each slot renders its own snapshot, so the leaving chat
        // never shows the arriving chat's title or turns.
        val switchDensity = LocalDensity.current
        val switchRise = with(switchDensity) { 16.dp.roundToPx() }
        val switchExit = with(switchDensity) { 8.dp.roundToPx() }
        AnimatedContent(
            targetState = chat,
            contentKey = { it?.id },
            transitionSpec = { plumSwitchTransform(reduce, switchRise, switchExit) },
            modifier = Modifier.weight(1f).fillMaxWidth(),
            label = "chat_switch",
        ) { shown ->
            if (shown == null) {
                // Same frame as the WebUI start page: greeting and suggestions on top,
                // the composer stays at the bottom where a started chat keeps it.
                val suggestions = personalization?.suggestedPrompts != false
                androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
                    val columns = startColumns(maxWidth.value)
                    Column(
                        Modifier.fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 4.dp, vertical = 20.dp).heightIn(min = maxHeight - 40.dp),
                        verticalArrangement = if (suggestions) Arrangement.spacedBy(14.dp) else Arrangement.Center,
                        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                    ) {
                        Text(stringResource(R.string.assistant_greeting), style = MaterialTheme.typography.headlineMedium, color = palette.text, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
                        if (providers.isEmpty()) Text(stringResource(R.string.assistant_api_missing), color = palette.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
                        if (suggestions) {
                            Text(stringResource(R.string.assistant_start_sub), color = palette.muted, style = MaterialTheme.typography.bodySmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
                            AssistantStartSuggestions(enabled = !busy, columns = columns, onPick = { prompt = it }, modifier = Modifier.widthIn(max = 760.dp).fillMaxWidth())
                        }
                        RecentChatsBlock(
                            owner, api, enabled = !busy,
                            onSelect = { resource -> RecentModelChats.put(resource); showChat(resource); currentOnChatSelected(resource.id) },
                            onShowAll = { DashboardMenuBus.send(DashboardMenuCommand.HISTORY) },
                            modifier = Modifier.widthIn(max = 760.dp).fillMaxWidth().padding(top = 8.dp),
                        )
                    }
                }
            } else {
                val shownId = shown.id
                val live = shownId == chatId
                val frozenTurns = remember { arrayOf(turns) }
                if (live) frozenTurns[0] = turns
                val shownTurns = if (live) turns else frozenTurns[0]
                val shownTemporary = shown.body["temporary"]?.jsonPrimitive?.booleanOrNull == true
                val listState = androidx.compose.foundation.lazy.rememberLazyListState()
                // Turns that already rose once; scrolling back must not replay it.
                val risen = remember { HashSet<String>() }
                var positioned by remember { mutableStateOf(false) }
                val lastLength = shownTurns.lastOrNull()?.response?.length ?: 0
                LaunchedEffect(shownTurns.size) {
                    if (!live || shownTurns.isEmpty()) return@LaunchedEffect
                    // Opening a chat lands at the end without scrolling through the history.
                    val lastItem = shownTurns.lastIndex + if ((shownTurns.first().seq) > 1) 1 else 0
                    if (positioned) listState.animateScrollToItem(lastItem) else { listState.scrollToItem(lastItem); positioned = true }
                }
                LaunchedEffect(lastLength) { if (live && running && shownTurns.isNotEmpty()) listState.scrollBy(100000f) }
                Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(shown.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = palette.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        IconButton(enabled = !busy, onClick = { showChat(null); currentOnChatSelected(null) }) {
                            Icon(androidx.compose.material.icons.Icons.Outlined.Edit, stringResource(R.string.assistant_new_chat), tint = palette.text)
                        }
                    }
                    if (shownTemporary) Text(stringResource(R.string.assistant_temporary_detail, shown.body["expiresAt"]?.jsonPrimitive?.content.orEmpty()), color = palette.muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 4.dp))
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                        if ((shownTurns.firstOrNull()?.seq ?: 0) > 1) item(key = "older") { TextButton(enabled = !busy && live, onClick = { scope.launch {
                            busy = true
                            try {
                                val target = chatId ?: return@launch
                                val response = api.getAssistantApiTurns(target, turns.first().seq); checkOwner()
                                if (!response.success) kotlin.error(response.error?.message ?: "History unavailable")
                                if (chat?.id == target) turns = (response.data?.turns.orEmpty() + turns).distinctBy { it.id }.sortedBy { it.seq }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { checkOwner(); error = failure.message }
                            finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
                        } }) { Text(stringResource(R.string.assistant_older)) } }
                        items(shownTurns, key = { it.id }) { turn ->
                            var menu by remember { mutableStateOf(false) }
                            // Only turns newer than the loaded history rise, and only once.
                            val rise = remember { live && baselineChat == shownId && turn.seq > baselineSeq && risen.add(turn.id) }
                            Column(Modifier.riseIn(rise), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                var editing by remember(turn.id) { mutableStateOf<String?>(null) }
                                Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    val draft = editing
                                    if (draft != null) Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp), color = palette.controlSurface, modifier = Modifier.fillMaxWidth()) {
                                        Column(Modifier.padding(12.dp)) {
                                            OutlinedTextField(draft, { editing = it.take(20000) }, label = { Text(stringResource(R.string.assistant_edit_message)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
                                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                                TextButton(onClick = { editing = null }) { Text(stringResource(R.string.assistant_cancel)) }
                                                Button(enabled = !busy && !running && draft.isNotBlank(), onClick = { regenerate(turn, draft); editing = null }) { Text(stringResource(R.string.assistant_send)) }
                                            }
                                        }
                                    } else Row(verticalAlignment = androidx.compose.ui.Alignment.Top) {
                                        if (turn.status != "running" && !running && live) IconButton(onClick = { editing = turn.prompt }, enabled = !busy) {
                                            Icon(androidx.compose.material.icons.Icons.Outlined.Edit, stringResource(R.string.assistant_edit_message), tint = palette.muted, modifier = Modifier.size(18.dp))
                                        }
                                        Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp), color = palette.controlSurface, modifier = Modifier.widthIn(max = 320.dp)) {
                                            Text(turn.prompt, Modifier.padding(horizontal = 16.dp, vertical = 11.dp), style = MaterialTheme.typography.bodyLarge, color = palette.text)
                                        }
                                    }
                                    turn.imageAssetIds.forEach { id -> ModelImage(owner, api, shownId, id) }
                                }
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    AnswerHeader(turn.status, palette.muted, palette.accent)
                                    if (turn.status == "queued") {
                                        Text("Vorgemerkt", color = palette.muted, style = MaterialTheme.typography.labelMedium)
                                        TextButton(enabled = !busy && live, onClick = { command("/api/assistant/api-chats/$shownId/turns/${turn.id}/stop", buildJsonObject {}, "Wartende Nachricht entfernen", keepDraft = true) }) { Text("Wartende Nachricht entfernen") }
                                    }
                                    val thinking = turn.status == "running" && turn.response.isEmpty() && !turn.uiPending
                                    val streaming = turn.status == "running" && turn.response.isNotEmpty()
                                    if (thinking) {
                                        val thinkingLabel = stringResource(R.string.component_thinking)
                                        ThinkingDots(palette.accent, Modifier.padding(vertical = 8.dp).semantics { contentDescription = thinkingLabel })
                                    } else if (turn.response.isNotEmpty() || (turn.ui == null && !turn.uiPending)) {
                                        MarkdownContent(turn.response, Modifier.fillMaxWidth(), isStreaming = streaming, onRunCode = { code, language -> openedCode = Triple(code, language, turn.sources) })
                                    }
                                    // Dynamic UI: an interactive view below the text, rendered natively.
                                    if (turn.uiPending && turn.ui == null) DynamicUiPending()
                                    turn.ui?.let { spec -> DynamicUi(spec, stateStore = dynamicUiState, stateKey = turn.id, busy = busy || running || !live, onSendMessage = if (live) ({ text: String -> send(text) }) else null) }
                                    turn.uiError?.let { note -> if (turn.status != "running") DynamicUiNote(note) }
                                }
                                ChatContextReceipt(turn.contextReceipt) { id ->
                                    scope.launch {
                                        try {
                                            val loaded = api.getAssistantApiTurns(id); checkOwner()
                                            loaded.data?.let { showChat(it.chat); currentOnChatSelected(it.chat.id) }
                                        } catch (failure: Exception) { error = failure.message }
                                    }
                                }
                                if (turn.toolEvents.isNotEmpty()) {
                                    turn.toolEvents.filter { it.status == "waiting" }.forEach { event -> ChatToolDecision(owner, api, shownId, turn.id, event) }
                                    Text(turn.toolEvents.joinToString(" · ") { event -> "${if (event.name == "web_search") "Websuche" else if (event.name == "web_fetch") "Seitenabruf" else event.name}: ${if (event.status == "running") "Läuft …" else if (event.status == "failed") "Fehlgeschlagen" else "Fertig"}" }, style = MaterialTheme.typography.labelSmall, color = palette.muted)
                                }
                                if (turn.sources.isNotEmpty()) Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    turn.sources.forEach { source -> AssistChip(onClick = { openedSource = source }, label = { Text(source.title + (source.page?.let { " · S. $it" } ?: "")) }) }
                                }
                                turn.comparisons.forEach { candidate ->
                                    Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), border = androidx.compose.foundation.BorderStroke(1.dp, palette.border)) {
                                        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Text(candidate.model, style = MaterialTheme.typography.labelMedium, color = palette.muted)
                                            MarkdownContent(candidate.response.ifEmpty { candidate.error ?: "Antwortet …" }, Modifier.fillMaxWidth(), isStreaming = candidate.status == "running", onRunCode = { code, language -> openedCode = Triple(code, language, turn.sources) })
                                        }
                                    }
                                }
                                if (turn.comparisons.any { it.status == "completed" }) TextButton(enabled = live && !busy && !running, onClick = {
                                    val current = chat ?: return@TextButton
                                    command("/api/assistant/api-chats/${current.id}/turns", buildJsonObject { put("expectedRevision", current.revision); put("prompt", turn.prompt); put("mergeTurnId", turn.id); effort?.let { put("reasoningEffort", it) } }, "Antworten zusammenführen", keepDraft = true)
                                }) { Text("Antworten zusammenführen") }
                                turn.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                                if (turn.status != "running" && turn.status != "queued" && (turn.response.isNotBlank() || turn.versions.size > 1)) Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    if (turn.versions.size > 1) {
                                        val index = turn.versions.indexOf(turn.id)
                                        IconButton(onClick = { showVersion(turn.versions[index - 1]) }, enabled = index > 0 && !busy && !running && live) { Icon(androidx.compose.material.icons.Icons.Outlined.ChevronLeft, stringResource(R.string.assistant_previous_version), tint = palette.muted, modifier = Modifier.size(20.dp)) }
                                        Text("${index + 1}/${turn.versions.size}", style = MaterialTheme.typography.labelMedium, color = palette.muted)
                                        IconButton(onClick = { showVersion(turn.versions[index + 1]) }, enabled = index < turn.versions.size - 1 && !busy && !running && live) { Icon(androidx.compose.material.icons.Icons.Outlined.ChevronRight, stringResource(R.string.assistant_next_version), tint = palette.muted, modifier = Modifier.size(20.dp)) }
                                    }
                                    var copied by remember { mutableStateOf(false) }
                                    LaunchedEffect(copied) { if (copied) { delay(PlumMotionTokens.COPY_CONFIRM_MS); copied = false } }
                                    val copySource = remember { MutableInteractionSource() }
                                    IconButton(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(turn.response)); copied = true }, interactionSource = copySource, modifier = Modifier.pressScale(copySource)) {
                                        AnimatedContent(
                                            targetState = copied,
                                            transitionSpec = {
                                                if (reduce) EnterTransition.None togetherWith ExitTransition.None
                                                else (scaleIn(spring(0.5f, 700f), initialScale = .5f) + fadeIn(tween(110))) togetherWith (scaleOut(tween(110), targetScale = .5f) + fadeOut(tween(110)))
                                            },
                                            label = "copy_confirm",
                                        ) { done ->
                                            Icon(
                                                if (done) androidx.compose.material.icons.Icons.Outlined.Check else androidx.compose.material.icons.Icons.Outlined.ContentCopy,
                                                stringResource(if (done) R.string.component_copied else R.string.assistant_copy),
                                                tint = if (done) palette.accent else palette.muted, modifier = Modifier.size(20.dp),
                                            )
                                        }
                                    }
                                    if (live) { val regenSource = remember { MutableInteractionSource() }; IconButton(onClick = { regenerate(turn) }, enabled = !busy && !running, interactionSource = regenSource, modifier = Modifier.pressScale(regenSource)) { Icon(androidx.compose.material.icons.Icons.Outlined.Refresh, stringResource(R.string.assistant_regenerate), tint = palette.muted, modifier = Modifier.size(20.dp)) } }
                                    if (voiceEnabled) { val readSource = remember { MutableInteractionSource() }; IconButton(onClick = { readText = turn.response }, interactionSource = readSource, modifier = Modifier.pressScale(readSource)) { Icon(androidx.compose.material.icons.Icons.Outlined.VolumeUp, stringResource(R.string.assistant_read_aloud), tint = palette.muted, modifier = Modifier.size(20.dp)) } }
                                    if (!shownTemporary) Box {
                                        val moreSource = remember { MutableInteractionSource() }
                                        IconButton(onClick = { menu = true }, interactionSource = moreSource, modifier = Modifier.pressScale(moreSource)) { Icon(androidx.compose.material.icons.Icons.Outlined.MoreHoriz, stringResource(R.string.assistant_more_actions), tint = palette.muted, modifier = Modifier.size(20.dp)) }
                                        DropdownMenu(menu, { menu = false }) {
                                            DropdownMenuItem(text = { Text(stringResource(R.string.assistant_branch)) }, enabled = !busy && !running, onClick = { menu = false; command("/api/assistant/api-chats/$shownId/branches", buildJsonObject { put("turnId", turn.id); put("includeAnswer", true) }, context.getString(R.string.assistant_branch)) })
                                            if (turn.status == "completed") {
                                                val kinds = listOf("document" to R.string.assistant_artifacts, "task" to R.string.assistant_task, "memory" to R.string.assistant_memory) + if (researchChat) listOf("research" to R.string.assistant_research) else emptyList()
                                                kinds.forEach { (kind, label) ->
                                                    DropdownMenuItem(text = { Text("${stringResource(R.string.assistant_save_as)}: ${stringResource(label)}") }, enabled = !busy, onClick = { menu = false; command("/api/assistant/api-chats/$shownId/results", buildJsonObject { put("turnId", turn.id); put("kind", kind) }, context.getString(R.string.assistant_save_as)) })
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        item(key = "read-aloud") { key(owner, shownId, readText) { AssistantReadAloud(owner, api, if (voiceEnabled && live) readText else null, personalization?.voiceName.orEmpty(), onPickVoice = { showVoiceSheet = true }) { readText = null } } }
                    }
                }
            }
        }
        error?.let { message -> Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) }
        notice?.let { message -> Text(message, color = palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) }
        if (pending.isNotEmpty()) Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState())) {
            pending.forEach { entry -> val chipSource = remember { MutableInteractionSource() }; AssistChip(onClick = { pendingReview = entry }, enabled = !busy, label = { Text(entry.label, maxLines = 1) }, interactionSource = chipSource, modifier = Modifier.pressScale(chipSource)) }
        }
        if (imageIds.isNotEmpty()) Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            imageIds.forEach { id -> val chipSource = remember { MutableInteractionSource() }; InputChip(selected = true, onClick = { imageIds = imageIds - id }, label = { Text(stringResource(R.string.assistant_remove_image)) }, interactionSource = chipSource, modifier = Modifier.pressScale(chipSource)) }
        }
        if (documentIds.isNotEmpty()) Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            documentIds.forEach { id -> InputChip(selected = true, onClick = { documentIds = documentIds - id }, label = { Text(documentNames[id] ?: "Dokument") }) }
        }
        androidx.compose.animation.AnimatedVisibility(showAttach && !researchChat) {
            Column(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(enabled = !busy && !cameraBusy && imageIds.size < 4, onClick = { imagePicker.launch(arrayOf("*/*")) }) { Text("Dateien anhängen") }
                if (chatId != null) key(owner, chatId) { AssistantCamera(owner, chatId, api, !busy && !running && imageIds.size < 4, { id -> imageIds = (imageIds + id).distinct() }, { cameraBusy = it }) }
                key(owner, chatId) { AssistantDictation(owner, api, voiceEnabled && !busy && !running, { text -> prompt = (prompt + (if (prompt.isBlank()) "" else "\n") + text).take(20000) }, { voiceBusy = it }) }
            }
        }
        Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp), color = palette.controlSurface.copy(alpha = 1f), border = androidx.compose.foundation.BorderStroke(1.dp, palette.border.copy(alpha = .8f)), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp, top = 4.dp)) {
            Column(Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp)) {
                TextField(
                    value = prompt, onValueChange = { prompt = it.take(20000) },
                    placeholder = { Text(stringResource(R.string.assistant_ask_hint), color = palette.muted) },
                    modifier = Modifier.fillMaxWidth(), maxLines = 6, enabled = !busy,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    ),
                )
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    var plusOpen by remember { mutableStateOf(false) }
                    Box {
                        val plusSource = remember { MutableInteractionSource() }
                        IconButton(onClick = { plusOpen = true }, interactionSource = plusSource, modifier = Modifier.pressScale(plusSource)) { Icon(androidx.compose.material.icons.Icons.Outlined.Add, stringResource(R.string.assistant_add), tint = palette.text) }
                        DropdownMenu(plusOpen, { plusOpen = false }) {
                            DropdownMenuItem(text = { Text("Chat-Werkzeuge") }, enabled = !busy, onClick = { plusOpen = false; showAdvanced = true })
                            if (chat?.body?.get("temporary")?.jsonPrimitive?.booleanOrNull != true && (chat != null || !temporary)) DropdownMenuItem(
                                text = { Text("Gedächtnis") }, enabled = !busy && !running,
                                onClick = { plusOpen = false; showMemory = true },
                            )
                            if (chat == null) DropdownMenuItem(text = { Text(if (temporary) "Temporärer Chat ✓" else "Temporärer Chat") }, enabled = !busy, onClick = { temporary = !temporary; if (temporary) research = false; plusOpen = false })
                            DropdownMenuItem(
                                text = { Text("Dateien anhängen") },
                                enabled = !researchChat && !busy,
                                onClick = { plusOpen = false; showAttach = !showAttach },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.preset_style_label, writingStyles.presetName(activeWritingStyle) ?: stringResource(R.string.preset_style_none)), maxLines = 1) },
                                enabled = !busy && !running,
                                onClick = { plusOpen = false; showStyleSheet = true },
                            )
                            DropdownMenuItem(text = { Text("Realtime-Sprache") }, enabled = chat != null && !busy && !running, onClick = { plusOpen = false; openRealtime() })
                            if (voiceEnabled) DropdownMenuItem(
                                text = { Text(stringResource(R.string.voice_mode_title)) },
                                enabled = !busy && !running && !researchChat && (chat != null || providers.isNotEmpty()),
                                onClick = { plusOpen = false; openVoiceMode() },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.settings_hub_voice_menu, com.claudewebui.app.ui.screens.settings.assistantVoiceLabel(personalization?.voiceName.orEmpty())), maxLines = 1) },
                                onClick = { plusOpen = false; showVoiceSheet = true },
                            )
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    ModelEffortChip(
                        model = if (chat == null) model else chat!!.body["model"]?.jsonPrimitive?.content.orEmpty(),
                        effortLabel = effortLabel, enabled = !busy, onClick = { showModelSheet = true },
                    )
                    Spacer(Modifier.width(8.dp))
                    val runningTurn = turns.firstOrNull { it.status == "running" || it.status == "queued" }
                    val canSend = prompt.isNotBlank() && !busy && !voiceBusy && !cameraBusy
                    // An empty composer offers the voice conversation instead of sending.
                    val canTalk = voiceEnabled && prompt.isBlank() && !busy && !voiceBusy && !cameraBusy && !running && !researchChat && (chat != null || providers.isNotEmpty())
                    // One button that morphs: the arrow cross-fades into the stop square
                    // and the container takes on a stop tint while a reply runs.
                    val stopping = runningTurn != null && prompt.isBlank()
                    if (runningTurn != null && prompt.isNotBlank()) IconButton(enabled = !busy, onClick = { command("/api/assistant/api-chats/$chatId/turns/${runningTurn.id}/stop", buildJsonObject {}, context.getString(R.string.assistant_stop), keepDraft = true) }) { Icon(androidx.compose.material.icons.Icons.Outlined.Stop, stringResource(R.string.assistant_stop)) }
                    val sendSource = remember { MutableInteractionSource() }
                    val sendContainer by animateColorAsState(
                        if (stopping) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primary,
                        PlumMotionTokens.menuSpring<androidx.compose.ui.graphics.Color>().orSnap(reduce), label = "send_container",
                    )
                    val sendContent by animateColorAsState(
                        if (stopping) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onPrimary,
                        PlumMotionTokens.menuSpring<androidx.compose.ui.graphics.Color>().orSnap(reduce), label = "send_content",
                    )
                    FilledIconButton(
                        enabled = stopping || canSend || canTalk,
                        onClick = { if (stopping && runningTurn != null) command("/api/assistant/api-chats/$chatId/turns/${runningTurn.id}/stop", buildJsonObject {}, context.getString(R.string.assistant_stop)) else if (canSend) send() else openVoiceMode() },
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = sendContainer, contentColor = sendContent),
                        interactionSource = sendSource,
                        modifier = Modifier.pressScale(sendSource),
                    ) {
                        AnimatedContent(
                            targetState = if (stopping) 2 else if (canTalk) 1 else 0,
                            transitionSpec = {
                                if (reduce) EnterTransition.None togetherWith ExitTransition.None
                                else (fadeIn(tween(160, 40)) + scaleIn(PlumMotionTokens.menuSpring(), initialScale = .6f)) togetherWith (fadeOut(tween(120)) + scaleOut(tween(120), targetScale = .6f))
                            },
                            label = "send_stop_icon",
                        ) { mode ->
                            when (mode) {
                                2 -> Icon(androidx.compose.material.icons.Icons.Outlined.Stop, stringResource(R.string.assistant_stop))
                                1 -> Icon(androidx.compose.material.icons.Icons.Outlined.GraphicEq, stringResource(R.string.voice_mode_title))
                                else -> Icon(androidx.compose.material.icons.Icons.Outlined.ArrowUpward, stringResource(R.string.assistant_send))
                            }
                        }
                    }
                }
            }
        }
    }
    if (showVoiceSheet) VoicePickerSheet(api) { showVoiceSheet = false }
    if (showWorkspace) key(workspaceCollection, workspaceNavigation) { ChatWorkspaceScreen(
        modifier = Modifier.padding(top = topInset).navigationBarsPadding().imePadding(),
        owner = owner, api = api, providers = providers,
        initialCollection = workspaceCollection,
        initialProfile = if (chat == null) profileId else chat?.body?.get("profileId")?.jsonPrimitive?.contentOrNull,
        initialProject = if (chat == null) projectId else chat?.body?.get("projectId")?.jsonPrimitive?.contentOrNull,
        onDismiss = { showWorkspace = false; refreshWorkspaceResources() },
        onChat = { resource -> showWorkspace = false; showChat(resource); currentOnChatSelected(resource.id) },
        onNewChat = { selected, project ->
            showChat(null); currentOnChatSelected(null)
            profileId = selected?.id; projectId = project
            newChatOptions = selected?.body?.get("chatOptions") as? JsonObject ?: buildJsonObject {}
            profiles = profiles.filter { it.id != selected?.id } + listOfNotNull(selected)
            val preferred = providers.firstOrNull { it.id == selected?.body?.get("apiProviderId")?.jsonPrimitive?.contentOrNull }
            if (preferred != null) {
                providerId = preferred.id
                model = selected?.body?.get("model")?.jsonPrimitive?.contentOrNull?.takeIf { it in preferred.models } ?: preferred.models.firstOrNull().orEmpty()
            }
            showWorkspace = false; refreshWorkspaceResources()
        },
        onApply = { selected, project ->
            val current = chat
            if (current == null) {
                profileId = selected?.id; projectId = project
            newChatOptions = selected?.body?.get("chatOptions") as? JsonObject ?: buildJsonObject {}
                profiles = profiles.filter { it.id != selected?.id } + listOfNotNull(selected)
                val preferred = providers.firstOrNull { it.id == selected?.body?.get("apiProviderId")?.jsonPrimitive?.contentOrNull }
                if (preferred != null) {
                    providerId = preferred.id
                    model = selected?.body?.get("model")?.jsonPrimitive?.contentOrNull?.takeIf { it in preferred.models } ?: preferred.models.firstOrNull().orEmpty()
                }
                showWorkspace = false; refreshWorkspaceResources()
            } else scope.launch {
                busy = true; error = null
                try {
                    checkOwner()
                    val response = api.updateAssistantApiChat(owner, current.id, buildJsonObject {
                        put("title", current.title); put("expectedRevision", current.revision)
                        put("providerId", current.body.getValue("providerId")); put("model", current.body.getValue("model"))
                        put("profileId", selected?.id?.let(::JsonPrimitive) ?: JsonNull)
                        put("projectId", project?.let(::JsonPrimitive) ?: JsonNull)
                        put("sourceIds", current.body["sourceIds"] as? JsonArray ?: JsonArray(emptyList()))
                    })
                    checkOwner(); check(response.success) { response.error?.message.orEmpty() }
                    chat = requireNotNull(response.data); refresh++; showWorkspace = false; refreshWorkspaceResources()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message }
                finally { busy = false }
            }
        },
    ) }
    LaunchedEffect(voiceEnabled) { if (!voiceEnabled) voiceMode = false }
    if (voiceMode) AssistantVoiceMode(
        owner = owner, api = api,
        voice = personalization?.voiceName?.ifBlank { null } ?: "Rufus Beck",
        title = chat?.title,
        turns = { turns }, running = { turns.any { it.status == "running" } }, lastError = { error },
        send = { text -> if (busy || turns.any { it.status == "running" } || (chat == null && (providerId.isBlank() || model.isBlank()))) false else { send(text, voice = true); true } },
        stopTurn = { turns.lastOrNull { it.status == "running" }?.let { turn -> command("/api/assistant/api-chats/$chatId/turns/${turn.id}/stop", buildJsonObject {}, context.getString(R.string.assistant_stop)) } },
        onClose = { reason -> voiceMode = false; reason?.let { notice = it } },
    )
    if (showMemory) key(chat?.id, chat?.revision) {
        var read by remember { mutableStateOf(if (chat == null) memoryRead else chat?.body?.get("memoryRead")?.jsonPrimitive?.booleanOrNull != false) }
        var learn by remember { mutableStateOf(if (chat == null) memoryLearn else chat?.body?.get("memoryLearn")?.jsonPrimitive?.booleanOrNull != false) }
        AlertDialog(
            onDismissRequest = { if (!busy) showMemory = false },
            title = { Text("Gedächtnis für dieses Gespräch") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text("Frühere Erinnerungen und Chats verwenden", Modifier.weight(1f))
                        Switch(checked = read, onCheckedChange = { read = it }, enabled = !busy)
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text("Aus diesem Gespräch lernen", Modifier.weight(1f))
                        Switch(checked = learn, onCheckedChange = { learn = it }, enabled = !busy)
                    }
                }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { showMemory = false }) { Text("Abbrechen") } },
            confirmButton = {
                TextButton(enabled = !busy && !running, onClick = {
                    val current = chat
                    if (current == null) { memoryRead = read; memoryLearn = learn; showMemory = false }
                    else scope.launch {
                        busy = true; error = null
                        try {
                            checkOwner()
                            val response = api.updateAssistantApiChat(owner, current.id, buildJsonObject {
                                put("title", current.title); put("expectedRevision", current.revision)
                                put("providerId", current.body.getValue("providerId")); put("model", current.body.getValue("model"))
                                put("profileId", current.body["profileId"] ?: JsonNull)
                                put("sourceIds", current.body["sourceIds"] ?: JsonArray(emptyList()))
                                put("memoryRead", read); put("memoryLearn", learn)
                            })
                            checkOwner(); check(response.success) { response.error?.message.orEmpty() }
                            if (chat?.id == current.id) { chat = requireNotNull(response.data); refresh++; showMemory = false }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { checkOwner(); error = failure.message }
                        finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
                    }
                }) { Text("Speichern") }
            },
        )
    }
    if (showStyleSheet) WritingStyleSheet(
        styles = writingStyles,
        selected = activeWritingStyle,
        enabled = !busy && !running,
        onSelect = { skill ->
            showStyleSheet = false
            val current = chat
            if (current == null) { newChatStyleSet = true; newChatStyle = skill }
            else scope.launch {
                busy = true; error = null
                try {
                    val body = current.body
                    val response = api.updateAssistantApiChat(owner, current.id, buildJsonObject {
                        put("title", current.title)
                        put("providerId", body["providerId"]?.jsonPrimitive?.contentOrNull.orEmpty())
                        put("model", body["model"]?.jsonPrimitive?.contentOrNull.orEmpty())
                        put("profileId", body["profileId"]?.jsonPrimitive?.contentOrNull?.let(::JsonPrimitive) ?: JsonNull)
                        put("sourceIds", body["sourceIds"] as? JsonArray ?: JsonArray(emptyList()))
                        put("writingStyleSkill", skill?.let(::JsonPrimitive) ?: JsonNull)
                        put("expectedRevision", current.revision)
                    })
                    checkOwner()
                    if (!response.success) kotlin.error(response.error?.message ?: "Style update failed")
                    response.data?.let { updated -> if (chat?.id == updated.id) chat = updated }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { checkOwner(); error = failure.message }
                finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
            }
        },
        onDismiss = { showStyleSheet = false },
    )
    if (showModelSheet) ModelEffortSheet(
        models = providers.flatMap { p -> p.models.map { m -> ModelOption(p.id, p.name, m) } },
        selectedGroup = providerId, selectedModel = model,
        onSelectModel = { option ->
            val current = chat
            if (current == null) { providerId = option.groupId; model = option.model }
            else if (!busy && !running) scope.launch {
                busy = true; error = null
                try {
                    val response = api.updateAssistantApiChat(owner, current.id, buildJsonObject {
                        put("expectedRevision", current.revision); put("title", current.title)
                        put("providerId", option.groupId); put("model", option.model)
                        put("profileId", current.body["profileId"] ?: JsonNull)
                        put("sourceIds", current.body["sourceIds"] ?: JsonArray(emptyList()))
                    })
                    checkOwner(); require(response.success) { response.error?.message ?: "Modellwechsel fehlgeschlagen" }
                    chat = requireNotNull(response.data); providerId = option.groupId; model = option.model
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { checkOwner(); error = failure.message }
                finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
            }
        },
        stops = effortStops, effort = effort, onEffort = { effort = it },
        onDismiss = { showModelSheet = false }, showModels = true,
    )
    if (showHistory) ModalBottomSheet(onDismissRequest = onHistoryDismiss) {
        ModelChatHistoryList(
            selectedChatId = chatId,
            onSelect = { resource -> showChat(resource); currentOnChatSelected(resource.id); onHistoryDismiss() },
            onNewChat = { showChat(null); currentOnChatSelected(null); onHistoryDismiss() },
            enabled = !busy,
            listModifier = Modifier.heightIn(max = 420.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            api = api,
        )
    }
    pendingReview?.let { entry -> AlertDialog(onDismissRequest = { if (!busy) pendingReview = null }, title = { Text(stringResource(R.string.assistant_pending_delivery)) }, text = { Text(entry.payload["prompt"]?.jsonPrimitive?.content ?: entry.payload["title"]?.jsonPrimitive?.content ?: entry.label) }, confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
        busy = true; error = null
        try { accept(entry.path, outbox.retry(entry.id)); pendingReview = null }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message }
        finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; updatePending() } }
    } }) { Text(stringResource(R.string.assistant_retry_delivery)) } }, dismissButton = { TextButton(enabled = !busy, onClick = { scope.launch { outbox.discard(entry.id); pending = outbox.pending(); pendingReview = null } }) { Text(stringResource(R.string.assistant_discard_delivery)) } }) }
}

private const val CARET_ID = "plum_caret"

/**
 * Conversations the history list handed over, so a selection made there opens
 * at once instead of waiting for a round trip. Process-local and tiny.
 */
internal object RecentModelChats {
    private val cache = object : LinkedHashMap<String, AssistantResource>(32, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, AssistantResource>?) = size > 64
    }
    @Synchronized fun put(resource: AssistantResource) { cache[resource.id] = resource }
    @Synchronized fun get(id: String): AssistantResource? = cache[id]
}

/**
 * Model-chat history: search, "new chat" and the conversation list. Used in
 * the phone's history sheet and as the expanded layout's list column, where
 * it sits permanently beside the open conversation.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ModelChatHistoryList(
    selectedChatId: String?,
    onSelect: (AssistantResource) -> Unit,
    onNewChat: (() -> Unit)?,
    modifier: Modifier = Modifier,
    listModifier: Modifier = Modifier,
    enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    api: ApiClient = koinInject(),
) {
    val owner = TokenStore.assistantOwnerKey() ?: (if (com.claudewebui.app.BuildConfig.DEBUG) "preview" else return)
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    key(owner) {
        var search by remember { mutableStateOf("") }
        var offset by remember { mutableIntStateOf(0) }
        var chats by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
        var projects by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
        var expandedProjects by rememberSaveable { mutableStateOf<List<String>>(emptyList()) }
        val projectChats = remember { mutableStateMapOf<String, List<AssistantResource>>() }
        val projectOffsets = remember { mutableStateMapOf<String, Int>() }
        val projectMore = remember { mutableStateMapOf<String, Boolean>() }
        val projectErrors = remember { mutableStateMapOf<String, String>() }
        var hasMore by remember { mutableStateOf(false) }
        var loaded by remember { mutableStateOf(false) }
        var refreshList by remember { mutableIntStateOf(0) }
        // Refreshes while visible, and right away when the open conversation
        // changes, so a chat created in the composer shows up in the list.
        LaunchedEffect(owner, search, offset, selectedChatId, refreshList) {
            if (search.isNotEmpty()) delay(250)
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    try {
                        val response = api.getAssistantResources("api-chats", offset, search)
                        if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                        val page = response.data.orEmpty()
                        chats = if (offset == 0) page else (chats + page).distinctBy { it.id }
                        hasMore = page.size == 100
                        val folders = api.getAssistantResources("projects")
                        if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                        if (folders.success) projects = folders.data.orEmpty()
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { }
                    loaded = true
                    if (offset != 0) break
                    delay(10_000)
                }
            }
        }
        val selectedProject = (chats.firstOrNull { it.id == selectedChatId }
            ?: projectChats.values.asSequence().flatten().firstOrNull { it.id == selectedChatId })?.body?.get("projectId")?.jsonPrimitive?.contentOrNull
        LaunchedEffect(selectedChatId, selectedProject) {
            if (selectedProject != null && selectedProject !in expandedProjects) expandedProjects = expandedProjects + selectedProject
        }
        val folderOffsets = projectOffsets.toMap()
        LaunchedEffect(owner, expandedProjects, folderOffsets, selectedChatId, refreshList, search) {
            if (search.isNotBlank() || expandedProjects.isEmpty()) return@LaunchedEffect
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    for (id in expandedProjects) {
                        try {
                            val offsetForProject = folderOffsets[id] ?: 0
                            val result = api.getAssistantResources("api-chats", offset = offsetForProject, projectId = id)
                            if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                            check(result.success) { result.error?.message.orEmpty() }
                            val rawPage = result.data.orEmpty()
                            val page = rawPage.filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == id }
                            projectChats[id] = if (offsetForProject == 0) page else (projectChats[id].orEmpty() + page).distinctBy { it.id }
                            projectMore[id] = rawPage.size == 100
                            projectErrors.remove(id)
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { projectErrors[id] = "load" }
                    }
                    delay(10_000)
                }
            }
        }
        @Composable
        fun HistoryRow(resource: AssistantResource, nested: Boolean = false) {
            val active = resource.id == selectedChatId
            var rowMenu by remember { mutableStateOf(false) }
            var renaming by remember { mutableStateOf<String?>(null) }
            var confirmDelete by remember { mutableStateOf(false) }
            val rowScope = rememberCoroutineScope()
            fun manage(remove: Boolean = true, action: suspend () -> Unit) { rowScope.launch {
                try { action(); if (remove) {
                    chats = chats.filter { it.id != resource.id }
                    projectChats.keys.toList().forEach { id -> projectChats[id] = projectChats[id].orEmpty().filter { it.id != resource.id } }
                }; offset = 0; refreshList++ }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { }
            } }
            Box(Modifier.padding(start = if (nested) 20.dp else 0.dp)) {
            Row(
                Modifier.fillMaxWidth()
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                    .background(if (active) palette.controlSurface else androidx.compose.ui.graphics.Color.Transparent)
                    .semantics { selected = active }
                    .combinedClickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button, onLongClick = { rowMenu = true }) { RecentModelChats.put(resource); onSelect(resource) }
                    .padding(vertical = 12.dp, horizontal = 12.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                Text(
                    resource.title, Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (active) palette.text else palette.text.copy(alpha = .86f),
                    fontWeight = if (active) FontWeight.SemiBold else null,
                    maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                Text(chatTime(resource.updatedAt, LocalContext.current), style = MaterialTheme.typography.labelSmall, color = palette.muted, modifier = Modifier.padding(start = 8.dp))
            }
            // Long press: ChatGPT's chat menu (rename, archive, delete).
            DropdownMenu(rowMenu, { rowMenu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.assistant_rename_chat)) }, onClick = { rowMenu = false; renaming = resource.title })
                DropdownMenuItem(text = { Text(stringResource(R.string.assistant_archive_chat)) }, onClick = { rowMenu = false; manage { check(api.archiveAssistantResource("api-chats", resource.id, resource.revision).success) } })
                DropdownMenuItem(text = { Text(stringResource(R.string.assistant_delete_chat), color = MaterialTheme.colorScheme.error) }, onClick = { rowMenu = false; confirmDelete = true })
            }
            }
            renaming?.let { title ->
                AlertDialog(
                    onDismissRequest = { renaming = null },
                    title = { Text(stringResource(R.string.assistant_rename_chat)) },
                    text = { OutlinedTextField(title, { renaming = it.take(200) }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
                    confirmButton = { TextButton(enabled = title.isNotBlank(), onClick = { manage(remove = false) { check(api.updateAssistantApiChatMeta(resource.id, buildJsonObject { put("expectedRevision", resource.revision); put("title", title.trim()) }).success) }; renaming = null }) { Text(stringResource(R.string.assistant_save)) } },
                    dismissButton = { TextButton(onClick = { renaming = null }) { Text(stringResource(R.string.assistant_cancel)) } },
                )
            }
            if (confirmDelete) AlertDialog(
                onDismissRequest = { confirmDelete = false },
                title = { Text(stringResource(R.string.assistant_delete_chat_title)) },
                text = { Text(stringResource(R.string.assistant_delete_chat_text, resource.title)) },
                confirmButton = { TextButton(onClick = { confirmDelete = false; manage { check(api.deleteAssistantApiChat(resource.id).success); if (active) onNewChat?.invoke() } }) { Text(stringResource(R.string.assistant_delete_chat), color = MaterialTheme.colorScheme.error) } },
                dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.assistant_cancel)) } },
            )
        }
        Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(search, { search = it; offset = 0 }, placeholder = { Text(stringResource(R.string.assistant_search_chats)) }, singleLine = true, shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth())
            if (onNewChat != null) {
                val newSource = remember { MutableInteractionSource() }
                FilledTonalButton(onClick = onNewChat, enabled = enabled, interactionSource = newSource, modifier = Modifier.fillMaxWidth().pressScale(newSource)) {
                    Icon(androidx.compose.material.icons.Icons.Outlined.Edit, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.assistant_new_chat))
                }
            }
            // As in ChatGPT, project chats live in their project folder; a search still finds them.
            val shown = if (search.isNotEmpty()) chats else chats.filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == null }
            if (loaded && shown.isEmpty() && (search.isNotBlank() || projects.isEmpty())) Text(stringResource(R.string.assistant_no_chats), color = palette.muted, modifier = Modifier.padding(vertical = 16.dp, horizontal = 4.dp))
            LazyColumn(listModifier, contentPadding = contentPadding, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                item(key = "workspace_navigation") {
                    Column {
                        TextButton(enabled = enabled, onClick = { DashboardMenuBus.send(DashboardMenuCommand.ASSISTANTS) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Icon(androidx.compose.material.icons.Icons.Outlined.SmartToy, null, Modifier.size(20.dp), tint = palette.muted)
                                Text(stringResource(R.string.chat_workspace_assistants), Modifier.padding(start = 12.dp), color = palette.text)
                            }
                        }
                        TextButton(enabled = enabled, onClick = { DashboardMenuBus.send(DashboardMenuCommand.PROJECTS) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Icon(androidx.compose.material.icons.Icons.Outlined.FolderOpen, null, Modifier.size(20.dp), tint = palette.muted)
                                Text(stringResource(R.string.chat_workspace_projects), Modifier.padding(start = 12.dp), color = palette.text)
                            }
                        }
                    }
                }
                if (search.isBlank()) projects.forEach { project ->
                    val expanded = project.id in expandedProjects
                    item(key = "project_${project.id}") {
                        Row(
                            Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                                .clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button) {
                                    expandedProjects = if (expanded) expandedProjects - project.id else expandedProjects + project.id
                                    if (!expanded) projectOffsets[project.id] = 0
                                }.padding(horizontal = 12.dp, vertical = 12.dp),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Icon(if (expanded) androidx.compose.material.icons.Icons.Outlined.FolderOpen else androidx.compose.material.icons.Icons.Outlined.Folder, null, tint = palette.muted, modifier = Modifier.size(20.dp))
                            Text(project.title, Modifier.weight(1f).padding(horizontal = 10.dp), color = palette.text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Icon(if (expanded) androidx.compose.material.icons.Icons.Outlined.ExpandMore else androidx.compose.material.icons.Icons.Outlined.ChevronRight, stringResource(if (expanded) R.string.component_collapse else R.string.component_expand), tint = palette.muted, modifier = Modifier.size(18.dp))
                        }
                    }
                    if (expanded) {
                        val folderChats = projectChats[project.id] ?: chats.filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == project.id }
                        items(folderChats.sortedByDescending { it.updatedAt }, key = { "project_chat_${it.id}" }) { resource -> HistoryRow(resource, nested = true) }
                        if (projectErrors.containsKey(project.id)) item(key = "project_error_${project.id}") { Text(stringResource(R.string.chat_workspace_load_chats_error), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 32.dp, bottom = 8.dp)) }
                        else if (!projectChats.containsKey(project.id)) item(key = "project_loading_${project.id}") { LinearProgressIndicator(Modifier.fillMaxWidth().padding(start = 32.dp)) }
                        else if (folderChats.isEmpty()) item(key = "project_empty_${project.id}") { Text(stringResource(R.string.assistant_no_chats), color = palette.muted, modifier = Modifier.padding(start = 32.dp, bottom = 8.dp)) }
                        if (projectMore[project.id] == true) item(key = "project_more_${project.id}") { TextButton(onClick = { projectOffsets[project.id] = (projectOffsets[project.id] ?: 0) + 100 }, modifier = Modifier.padding(start = 20.dp)) { Text(stringResource(R.string.assistant_more)) } }
                    }
                }
                // Grouped by day like the chat apps: Heute, Gestern, Diese Woche, Älter.
                shown.groupBy { chatBucket(it.updatedAt) }.toSortedMap().forEach { (bucket, group) ->
                    item(key = "bucket_$bucket") {
                        Text(stringResource(CHAT_BUCKETS[bucket]), style = MaterialTheme.typography.labelMedium, color = palette.muted, modifier = Modifier.padding(start = 12.dp, top = 14.dp, bottom = 4.dp))
                    }
                    items(group, key = { it.id }) { resource -> HistoryRow(resource) }
                }
                if (hasMore) item { TextButton(onClick = { offset += 100 }) { Text(stringResource(R.string.assistant_more)) } }
            }
        }
    }
}

/**
 * "Plum" above each answer. When a reply finishes while it is on screen, a
 * single shine sweeps across the name — a quiet "done". Replies that were
 * already complete when the history loaded never shine.
 */
@Composable
private fun AnswerHeader(status: String, color: androidx.compose.ui.graphics.Color, shine: androidx.compose.ui.graphics.Color) {
    val reduce = reducedMotion()
    val sweep = remember { Animatable(-1f) }
    var wasRunning by remember { mutableStateOf(status == "running") }
    LaunchedEffect(status) {
        val finished = wasRunning && status == "completed"
        wasRunning = status == "running"
        if (finished && !reduce) {
            sweep.snapTo(0f)
            sweep.animateTo(1f, tween(900, easing = PlumMotionTokens.EnterEasing))
            sweep.snapTo(-1f)
        }
    }
    Text(
        "Plum",
        style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = color,
        modifier = Modifier
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                val p = sweep.value
                if (p >= 0f) {
                    val band = size.width * .7f
                    val center = -band + p * (size.width + band * 2)
                    drawRect(
                        Brush.horizontalGradient(listOf(androidx.compose.ui.graphics.Color.Transparent, shine, androidx.compose.ui.graphics.Color.Transparent), startX = center - band / 2, endX = center + band / 2),
                        blendMode = BlendMode.SrcAtop,
                    )
                }
            },
    )
}

@Composable
internal fun AssistantChoice(label: String, selected: String, choices: List<Pair<String, String>>, enabled: Boolean, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(enabled = enabled && choices.isNotEmpty(), onClick = { expanded = true }) { Text("$label: ${choices.firstOrNull { it.first == selected }?.second.orEmpty()}") }
        DropdownMenu(expanded, { expanded = false }) { choices.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onSelect(id) }) } }
    }
}

@Composable
private fun ModelImage(owner: String, api: ApiClient, chatId: String, id: String) {
    var bytes by remember(owner, chatId, id) { mutableStateOf<ByteArray?>(null) }
    var failed by remember(owner, chatId, id) { mutableStateOf(false) }
    LaunchedEffect(owner, chatId, id) {
        try { val image = api.getAssistantApiImage(chatId, id); if (TokenStore.assistantOwnerKey() == owner) bytes = image }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { if (TokenStore.assistantOwnerKey() == owner) failed = true }
    }
    if (failed) Text(stringResource(R.string.assistant_image_unavailable))
    bytes?.let { AsyncImage(it, stringResource(R.string.assistant_image), modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp)) }
}

private val CHAT_BUCKETS = listOf(R.string.history_today, R.string.history_yesterday, R.string.history_week, R.string.history_older)

/** 0 today, 1 yesterday, 2 this week, 3 older. */
private fun chatBucket(iso: String): Int {
    val day = runCatching { java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()).toLocalDate() }.getOrNull() ?: return 3
    val days = java.time.temporal.ChronoUnit.DAYS.between(day, java.time.LocalDate.now())
    return when { days <= 0 -> 0; days == 1L -> 1; days < 7 -> 2; else -> 3 }
}

/** Clock time today, otherwise the relative age ("gestern", "vor 3 Tagen"). */
private fun chatTime(iso: String, context: android.content.Context): String {
    val instant = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return ""
    return if (chatBucket(iso) == 0) java.time.format.DateTimeFormatter.ofPattern("HH:mm").withZone(java.time.ZoneId.systemDefault()).format(instant)
    else ageLabel(iso, context)
}

/**
 * "Zuletzt" under the start suggestions: the five newest chats, so the way
 * back into a conversation is a scroll away. "Alle anzeigen" opens the history.
 */
@Composable
private fun RecentChatsBlock(owner: String, api: ApiClient, enabled: Boolean, onSelect: (AssistantResource) -> Unit, onShowAll: () -> Unit, modifier: Modifier = Modifier) {
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val context = LocalContext.current
    var chats by remember(owner) { mutableStateOf<List<AssistantResource>>(emptyList()) }
    LaunchedEffect(owner) {
        chats = runCatching { api.getAssistantResources("api-chats", 0, null).data.orEmpty().filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == null }.take(5) }.getOrDefault(emptyList())
    }
    if (chats.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(stringResource(R.string.history_recent), style = MaterialTheme.typography.titleSmall, color = palette.text, modifier = Modifier.weight(1f).padding(start = 4.dp))
            TextButton(onClick = onShowAll) { Text(stringResource(R.string.history_show_all)) }
        }
        chats.forEach { resource ->
            Row(
                Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(16.dp)).background(palette.subtleFill)
                    .clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button) { onSelect(resource) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                Icon(androidx.compose.material.icons.Icons.Outlined.History, null, tint = palette.muted, modifier = Modifier.size(18.dp))
                Text(resource.title, Modifier.weight(1f).padding(horizontal = 10.dp), color = palette.text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(chatTime(resource.updatedAt, context), style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
        }
    }
}
