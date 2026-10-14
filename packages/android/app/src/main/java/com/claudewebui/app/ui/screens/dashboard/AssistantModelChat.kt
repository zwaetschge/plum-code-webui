package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
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
import com.claudewebui.app.ui.components.chat.WritingStyleSheet
import com.claudewebui.app.ui.components.chat.presetName
import java.time.Instant
import java.time.temporal.ChronoUnit

@Composable
fun AssistantModelChat(topInset: androidx.compose.ui.unit.Dp, historyOpen: Boolean, onHistoryDismiss: () -> Unit, onAreaSelect: (String) -> Unit, onAgentChats: () -> Unit, api: ApiClient = koinInject()) {
    // Debug design previews run without an account; they still render the layout.
    val owner = TokenStore.assistantOwnerKey() ?: (if (com.claudewebui.app.BuildConfig.DEBUG) "preview" else return)
    // All state, thumbnails and effects are discarded when the account changes.
    key(owner) { ModelChatAccount(owner, api, topInset, historyOpen, onHistoryDismiss, onAreaSelect, onAgentChats) }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun ModelChatAccount(owner: String, api: ApiClient, topInset: androidx.compose.ui.unit.Dp, historyOpen: Boolean, onHistoryDismiss: () -> Unit, onAreaSelect: (String) -> Unit, onAgentChats: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }
    val outbox = remember(owner) { AssistantApiOutbox(api, owner) }
    var providers by remember { mutableStateOf<List<AssistantApiProvider>>(emptyList()) }
    var profiles by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var sources by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var chats by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var chat by remember { mutableStateOf<AssistantResource?>(null) }
    var turns by remember { mutableStateOf<List<AssistantApiTurn>>(emptyList()) }
    var pending by remember { mutableStateOf<List<AssistantPendingCommand>>(emptyList()) }
    var providerId by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var profileId by remember { mutableStateOf<String?>(null) }
    var sourceIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var imageIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var prompt by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var temporary by remember { mutableStateOf(false) }
    var research by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var offset by remember { mutableIntStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var pendingReview by remember { mutableStateOf<AssistantPendingCommand?>(null) }
    var voiceBusy by remember { mutableStateOf(false) }
    var cameraBusy by remember { mutableStateOf(false) }
    var readText by remember { mutableStateOf<String?>(null) }
    var personalization by remember { mutableStateOf<AssistantPersonalization?>(null) }
    var writingStyles by remember { mutableStateOf<List<ConfigSkill>>(emptyList()) }
    // New chat: false keeps the account default, true sends newChatStyle (null = none).
    var newChatStyleSet by remember { mutableStateOf(false) }
    var newChatStyle by remember { mutableStateOf<String?>(null) }
    var showStyleSheet by remember { mutableStateOf(false) }
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
    val voiceEnabled = personalization?.voiceChat == true
    LaunchedEffect(voiceEnabled) { if (!voiceEnabled) readText = null }
    val isTemporary = chat?.body?.get("temporary")?.jsonPrimitive?.booleanOrNull == true
    val chatId = chat?.id
    val running = turns.any { it.status == "running" }
    LaunchedEffect(owner, chatId) { readText = null }
    fun checkOwner() { if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed") }
    fun updatePending() { scope.launch { checkOwner(); pending = outbox.pending() } }
    fun accept(path: String, result: JsonObject) {
        checkOwner()
        if (path == "/api/assistant/api-chats") {
            chat = json.decodeFromJsonElement<AssistantResource>(result); turns = emptyList(); imageIds = emptyList()
        } else if (path.endsWith("/branches")) {
            chat = json.decodeFromJsonElement<AssistantResource>(result.getValue("chat"))
            turns = emptyList(); prompt = result["prompt"]?.jsonPrimitive?.content.orEmpty()
            imageIds = result["imageAssetIds"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
        } else if (path == "/api/assistant/api-chats/${chat?.id}/turns") { prompt = ""; imageIds = emptyList() }
        else if (path.endsWith("/results")) notice = context.getString(R.string.assistant_result_saved)
        refresh++
    }
    fun command(path: String, payload: JsonObject, label: String, expiresAt: String? = chat?.body?.get("expiresAt")?.jsonPrimitive?.contentOrNull) {
        if (busy) return
        scope.launch {
            busy = true; error = null
            try { accept(path, outbox.send(path, payload, label, expiresAt)) }
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
            providerId = providers.firstOrNull()?.id.orEmpty(); model = providers.firstOrNull()?.models?.firstOrNull().orEmpty()
            val profileResult = api.getAssistantResources("profiles"); checkOwner(); profiles = profileResult.data.orEmpty()
            val sourceResult = api.getAssistantResources("sources"); checkOwner(); sources = sourceResult.data.orEmpty()
            runCatching { api.getStyleLibrary() }.getOrNull()?.data?.let { checkOwner(); writingStyles = it.writingStyles }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message }
    }
    LaunchedEffect(owner, chatId, refresh, offset, search) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                try {
                    if (chatId == null) {
                        val response = api.getAssistantResources("api-chats", offset, search); checkOwner()
                        if (!response.success) kotlin.error(response.error?.message ?: "Conversation list unavailable")
                        val page = response.data.orEmpty()
                        chats = if (offset == 0) page else (chats + page).distinctBy { it.id }
                        hasMore = page.size == 100
                    } else {
                        val response = api.getAssistantApiTurns(chatId); checkOwner()
                        if (!response.success) kotlin.error(response.error?.message ?: "Conversation unavailable")
                        val history = requireNotNull(response.data)
                        // Latest snapshots replace their suffix, retaining older loaded pages.
                        val first = history.turns.firstOrNull()?.seq ?: Long.MAX_VALUE
                        turns = if (turns.isNotEmpty() && turns.last().seq < first - 1) history.turns else (turns.filter { it.seq < first } + history.turns).distinctBy { it.id }.sortedBy { it.seq }
                        chat = history.chat
                    }
                    pending = outbox.pending()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { checkOwner(); error = failure.message }
                delay(if (turns.any { it.status == "running" }) 500 else 5_000)
            }
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val target = chat
        if (uri != null && target != null && !busy && imageIds.size < 4) scope.launch {
            busy = true; error = null
            try {
                val resolver = context.contentResolver
                val mime = resolver.getType(uri) ?: kotlin.error("Image type unavailable")
                val bytes = withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)?.use { input ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (output.size() <= 5 * 1024 * 1024) {
                            val length = input.read(buffer, 0, minOf(buffer.size, 5 * 1024 * 1024 + 1 - output.size()))
                            if (length < 0) break
                            output.write(buffer, 0, length)
                        }
                        output.toByteArray()
                    } ?: kotlin.error("Image unavailable")
                }
                checkOwner()
                val response = api.uploadAssistantApiImage(owner, target.id, "image.${mime.substringAfter('/')}", mime, bytes)
                checkOwner()
                if (!response.success) kotlin.error(response.error?.message ?: "Image upload failed")
                val image = requireNotNull(response.data)
                if (chat?.id == target.id) imageIds = (imageIds + image.id).distinct()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
        }
    }
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val showHistory = historyOpen
    LaunchedEffect(historyOpen) { if (historyOpen) offset = 0 }
    var showAttach by remember { mutableStateOf(false) }
    var showModelSheet by remember { mutableStateOf(false) }
    var effort by rememberSaveable { mutableStateOf<String?>(null) }
    val effortStops = apiEffortStops()
    val effortLabel = effortStops.firstOrNull { it.id == effort && it.id != null }?.label
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val lastLength = turns.lastOrNull()?.response?.length ?: 0
    LaunchedEffect(chatId, turns.size) { if (turns.isNotEmpty()) listState.animateScrollToItem(turns.lastIndex) }
    LaunchedEffect(lastLength) { if (running && turns.isNotEmpty()) listState.scrollBy(100000f) }
    // The conversation list only polls while no chat is open, so the history
    // sheet loads its own page.
    LaunchedEffect(showHistory, search, offset) {
        if (showHistory && chatId != null) {
            try {
                val response = api.getAssistantResources("api-chats", offset, search); checkOwner()
                val page = response.data.orEmpty()
                chats = if (offset == 0) page else (chats + page).distinctBy { it.id }
                hasMore = page.size == 100
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
        }
    }
    fun send() {
        val text = prompt.trim()
        if (text.isEmpty() || busy || running) return
        val current = chat
        if (current != null) {
            command("/api/assistant/api-chats/${current.id}/turns", buildJsonObject { put("prompt", text); put("expectedRevision", current.revision); put("imageAssetIds", JsonArray(imageIds.map(::JsonPrimitive))); effort?.let { put("reasoningEffort", it) } }, context.getString(R.string.assistant_send))
        } else if (providerId.isNotBlank() && model.isNotBlank()) scope.launch {
            busy = true; error = null
            try {
                val created = outbox.send("/api/assistant/api-chats", buildJsonObject {
                    put("title", text.take(48)); put("providerId", providerId); put("model", model)
                    profileId?.let { put("profileId", it) }; put("sourceIds", JsonArray(emptyList()))
                    if (newChatStyleSet) put("writingStyleSkill", newChatStyle?.let(::JsonPrimitive) ?: JsonNull)
                }, context.getString(R.string.assistant_new), null)
                checkOwner(); accept("/api/assistant/api-chats", created)
                val target = chat ?: return@launch
                val sent = outbox.send("/api/assistant/api-chats/${target.id}/turns", buildJsonObject { put("prompt", text); put("expectedRevision", target.revision); put("imageAssetIds", JsonArray(emptyList())); effort?.let { put("reasoningEffort", it) } }, context.getString(R.string.assistant_send), null)
                checkOwner(); accept("/api/assistant/api-chats/${target.id}/turns", sent)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { checkOwner(); error = failure.message }
            finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; updatePending() } }
        }
    }
    val researchChat = chat?.body?.get("workflow")?.jsonPrimitive?.contentOrNull == "research"
    val activeWritingStyle = chat?.let { it.body["writingStyleSkill"]?.jsonPrimitive?.contentOrNull }
        ?: if (chat != null) null else if (newChatStyleSet) newChatStyle else personalization?.defaultWritingStyle?.ifBlank { null }
    Column(Modifier.fillMaxSize().padding(top = topInset).navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (chat == null) {
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.assistant_greeting), style = MaterialTheme.typography.headlineMedium, color = palette.text, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
                    if (providers.isEmpty()) Text(stringResource(R.string.assistant_api_missing), color = palette.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(24.dp))
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(chat!!.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = palette.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        IconButton(enabled = !busy, onClick = { chat = null; turns = emptyList(); prompt = ""; imageIds = emptyList(); offset = 0 }) {
                            Icon(androidx.compose.material.icons.Icons.Outlined.Edit, stringResource(R.string.assistant_new_chat), tint = palette.text)
                        }
                    }
                    if (isTemporary) Text(stringResource(R.string.assistant_temporary_detail, chat!!.body["expiresAt"]?.jsonPrimitive?.content.orEmpty()), color = palette.muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 4.dp))
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                        if ((turns.firstOrNull()?.seq ?: 0) > 1) item(key = "older") { TextButton(enabled = !busy, onClick = { scope.launch {
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
                        items(turns, key = { it.id }) { turn ->
                            var menu by remember { mutableStateOf(false) }
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp), color = palette.controlSurface, modifier = Modifier.widthIn(max = 320.dp)) {
                                        Text(turn.prompt, Modifier.padding(horizontal = 16.dp, vertical = 11.dp), style = MaterialTheme.typography.bodyLarge, color = palette.text)
                                    }
                                    turn.imageAssetIds.forEach { id -> ModelImage(owner, api, chatId!!, id) }
                                }
                                Text(
                                    if (turn.response.isEmpty() && turn.status == "running") "…" else turn.response,
                                    style = MaterialTheme.typography.bodyLarge, color = palette.text,
                                )
                                turn.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                                if (turn.status != "running" && turn.response.isNotBlank()) Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    IconButton(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(turn.response)) }) { Icon(androidx.compose.material.icons.Icons.Outlined.ContentCopy, stringResource(R.string.assistant_copy), tint = palette.muted, modifier = Modifier.size(20.dp)) }
                                    if (voiceEnabled) IconButton(onClick = { readText = turn.response }) { Icon(androidx.compose.material.icons.Icons.Outlined.VolumeUp, stringResource(R.string.assistant_read_aloud), tint = palette.muted, modifier = Modifier.size(20.dp)) }
                                    if (!isTemporary) Box {
                                        IconButton(onClick = { menu = true }) { Icon(androidx.compose.material.icons.Icons.Outlined.MoreHoriz, stringResource(R.string.assistant_more_actions), tint = palette.muted, modifier = Modifier.size(20.dp)) }
                                        DropdownMenu(menu, { menu = false }) {
                                            DropdownMenuItem(text = { Text(stringResource(R.string.assistant_edit_branch)) }, enabled = !busy && !running, onClick = { menu = false; command("/api/assistant/api-chats/$chatId/branches", buildJsonObject { put("turnId", turn.id); put("includeAnswer", false) }, context.getString(R.string.assistant_edit_branch)) })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.assistant_branch)) }, enabled = !busy && !running, onClick = { menu = false; command("/api/assistant/api-chats/$chatId/branches", buildJsonObject { put("turnId", turn.id); put("includeAnswer", true) }, context.getString(R.string.assistant_branch)) })
                                            if (turn.status == "completed") {
                                                val kinds = listOf("document" to R.string.assistant_artifacts, "task" to R.string.assistant_task, "memory" to R.string.assistant_memory) + if (researchChat) listOf("research" to R.string.assistant_research) else emptyList()
                                                kinds.forEach { (kind, label) ->
                                                    DropdownMenuItem(text = { Text("${stringResource(R.string.assistant_save_as)}: ${stringResource(label)}") }, enabled = !busy, onClick = { menu = false; command("/api/assistant/api-chats/$chatId/results", buildJsonObject { put("turnId", turn.id); put("kind", kind) }, context.getString(R.string.assistant_save_as)) })
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        item(key = "read-aloud") { key(owner, chatId, readText) { AssistantReadAloud(owner, api, if (voiceEnabled) readText else null, personalization?.voiceName.orEmpty()) { readText = null } } }
                    }
                }
            }
        }
        error?.let { message -> Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) }
        notice?.let { message -> Text(message, color = palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) }
        if (pending.isNotEmpty()) Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState())) {
            pending.forEach { entry -> AssistChip(onClick = { pendingReview = entry }, enabled = !busy, label = { Text(entry.label, maxLines = 1) }) }
        }
        if (imageIds.isNotEmpty()) Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            imageIds.forEach { id -> InputChip(selected = true, onClick = { imageIds = imageIds - id }, label = { Text(stringResource(R.string.assistant_remove_image)) }) }
        }
        androidx.compose.animation.AnimatedVisibility(showAttach && chat != null && !researchChat) {
            Column(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(enabled = !busy && !cameraBusy && !running && imageIds.size < 4, onClick = { imagePicker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")) }) { Text(stringResource(R.string.assistant_attach_image)) }
                key(owner, chatId) { AssistantCamera(owner, chatId!!, api, !busy && !running && imageIds.size < 4, { id -> imageIds = (imageIds + id).distinct() }, { cameraBusy = it }) }
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
                        IconButton(onClick = { plusOpen = true }) { Icon(androidx.compose.material.icons.Icons.Outlined.Add, stringResource(R.string.assistant_add), tint = palette.text) }
                        DropdownMenu(plusOpen, { plusOpen = false }) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.assistant_attach_image)) },
                                enabled = chat != null && !researchChat,
                                onClick = { plusOpen = false; showAttach = !showAttach },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.preset_style_label, writingStyles.presetName(activeWritingStyle) ?: stringResource(R.string.preset_style_none)), maxLines = 1) },
                                enabled = !busy && !running,
                                onClick = { plusOpen = false; showStyleSheet = true },
                            )
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    ModelEffortChip(
                        model = if (chat == null) model else chat!!.body["model"]?.jsonPrimitive?.content.orEmpty(),
                        effortLabel = effortLabel, enabled = !busy, onClick = { showModelSheet = true },
                    )
                    Spacer(Modifier.width(8.dp))
                    val runningTurn = turns.lastOrNull { it.status == "running" }
                    val canSend = prompt.isNotBlank() && !busy && !voiceBusy && !cameraBusy && !running
                    FilledIconButton(
                        enabled = runningTurn != null || canSend,
                        onClick = { if (runningTurn != null) command("/api/assistant/api-chats/$chatId/turns/${runningTurn.id}/stop", buildJsonObject {}, context.getString(R.string.assistant_stop)) else send() },
                    ) {
                        Icon(if (runningTurn != null) androidx.compose.material.icons.Icons.Outlined.Stop else androidx.compose.material.icons.Icons.Outlined.ArrowUpward, stringResource(if (runningTurn != null) R.string.assistant_stop else R.string.assistant_send))
                    }
                }
            }
        }
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
        onSelectModel = { providerId = it.groupId; model = it.model },
        stops = effortStops, effort = effort, onEffort = { effort = it },
        onDismiss = { showModelSheet = false }, showModels = chat == null,
    )
    if (showHistory) ModalBottomSheet(onDismissRequest = onHistoryDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(search, { search = it; offset = 0 }, placeholder = { Text(stringResource(R.string.assistant_search_chats)) }, singleLine = true, shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth())
            if (chats.isEmpty()) Text(stringResource(R.string.assistant_no_chats), color = palette.muted, modifier = Modifier.padding(vertical = 16.dp))
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(chats, key = { it.id }) { resource ->
                    Text(resource.title, Modifier.fillMaxWidth().clickable(enabled = !busy) { chat = resource; turns = emptyList(); prompt = ""; imageIds = emptyList(); onHistoryDismiss() }.padding(vertical = 14.dp, horizontal = 4.dp), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
                if (hasMore) item { TextButton(onClick = { offset += 100 }) { Text(stringResource(R.string.assistant_more)) } }
            }
        }
    }
    pendingReview?.let { entry -> AlertDialog(onDismissRequest = { if (!busy) pendingReview = null }, title = { Text(stringResource(R.string.assistant_pending_delivery)) }, text = { Text(entry.payload["prompt"]?.jsonPrimitive?.content ?: entry.payload["title"]?.jsonPrimitive?.content ?: entry.label) }, confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
        busy = true; error = null
        try { accept(entry.path, outbox.retry(entry.id)); pendingReview = null }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message }
        finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; updatePending() } }
    } }) { Text(stringResource(R.string.assistant_retry_delivery)) } }, dismissButton = { TextButton(enabled = !busy, onClick = { scope.launch { outbox.discard(entry.id); pending = outbox.pending(); pendingReview = null } }) { Text(stringResource(R.string.assistant_discard_delivery)) } }) }
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
