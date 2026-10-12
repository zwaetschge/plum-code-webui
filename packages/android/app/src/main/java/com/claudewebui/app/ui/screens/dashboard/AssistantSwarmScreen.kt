package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.AddReaction
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Reply
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.*
import com.claudewebui.swarm.data.*
import com.claudewebui.app.ui.screens.auth.BiometricPromptHost
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import org.koin.compose.koinInject
import java.util.UUID

private fun JsonObject.value(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Native identities, room IDs, task cards and confirmation events remain authoritative. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AssistantSwarmScreen(topInset: androidx.compose.ui.unit.Dp, emergencyOpen: Boolean, onEmergencyDismiss: () -> Unit, onAreaSelect: (String) -> Unit, api: ApiClient = koinInject()) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var connected by remember { mutableStateOf(false) }
    var nativeUserId by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var rooms by remember { mutableStateOf<List<AssistantMatrixRoom>>(emptyList()) }
    var roomId by remember { mutableStateOf<String?>(null) }
    var threadId by remember { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf<List<AssistantMatrixEvent>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    // A failed network delivery retries the same Matrix transaction, with the same content.
    var pending by remember { mutableStateOf<Pair<String,AssistantMatrixSend>?>(null) }
    val emergency = remember(context) { NotAusSpeicher(context) }
    var emergencyUrl by remember { mutableStateOf(emergency.url) }
    var emergencyAction by remember { mutableStateOf<String?>(null) }
    var confirmAction by remember { mutableStateOf<String?>(null) }
    var biometric by remember { mutableStateOf(false) }
    var emergencyResult by remember { mutableStateOf<String?>(null) }

    suspend fun deliver(target: String, command: AssistantMatrixSend) {
        busy = true; error = null
        try {
            val response = api.sendAssistantMatrixEvent(target, command)
            if (!response.success) error = response.error?.message else {
                pending = null; input = ""; refresh++
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
        finally { busy = false }
    }
    fun send(type: String, content: JsonObject) {
        val target = roomId ?: return
        val command = AssistantMatrixSend(UUID.randomUUID().toString(),type,content)
        pending = target to command
        scope.launch { deliver(target,command) }
    }
    fun executeEmergency(action: String) {
        scope.launch {
            busy = true
            try {
                val url = NotAusDraht.urlPruefen(emergency.url, emergency.domain.orEmpty())
                    ?: throw IllegalStateException("Not-Aus-Endpunkt ist nicht eingerichtet")
                val result = NotAusDraht.ausloesen(url,action)
                emergencyResult = result.fehler ?: "${result.aktion}: HTTP ${result.status} · ${result.eingefroren} · ${result.offen} · ${result.laufend}"
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { busy = false; emergencyAction = null }
        }
    }
    LaunchedEffect(refresh,connected) {
        try {
            val status = api.getAssistantMatrixStatus().data
            connected = status?.get("connected")?.jsonPrimitive?.booleanOrNull == true
            nativeUserId = status?.value("userId").orEmpty()
            if (connected) {
                rooms = api.getAssistantMatrixRooms().data.orEmpty()
                if (roomId == null) roomId = rooms.firstOrNull()?.id
                val hub = "@schwarm:${nativeUserId.substringAfter(':')}"
                val state = rooms.flatMap { it.state }.firstOrNull {
                    it.type == "ch.zwaetschge.swarm.notaus" && it.sender == hub && (it.content["v"]?.jsonPrimitive?.intOrNull ?: 1) == 1
                }
                state?.let {
                    val domain = nativeUserId.substringAfter(':')
                    NotAusDraht.urlPruefen(it.content.value("url"),domain)?.let { url ->
                        emergency.domain = domain; emergency.url = url; emergencyUrl = url
                    }
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
    }
    LaunchedEffect(roomId,threadId,refresh) {
        messages = emptyList(); cursor = null
        val target = roomId ?: return@LaunchedEffect
        if (rooms.find { it.id == target }?.encrypted == true) return@LaunchedEffect
        while (true) {
            try {
                val page = api.getAssistantMatrixMessages(target,threadId).data
                if (page != null) {
                    messages = (messages + page.chunk).distinctBy { it.id }.sortedBy { it.timestamp }
                    if (cursor == null) cursor = page.end ?: page.nextBatch
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            delay(5000)
        }
    }
    BiometricPromptHost(trigger = biometric, onSuccess = { emergencyAction?.let(::executeEmergency) },
        onError = { _, message -> error = message; emergencyAction = null },
        onCancelled = { emergencyAction = null },onResetTrigger = { biometric = false })
    confirmAction?.let { action -> AlertDialog(onDismissRequest = { confirmAction = null },
        title = { Text(stringResource(R.string.assistant_emergency_confirm)) },
        text = { Text(stringResource(if (action == "stopp") R.string.assistant_emergency_stop else R.string.assistant_emergency_resume)) },
        confirmButton = { TextButton(onClick = {
            confirmAction = null; emergencyAction = action
            if (NotAusSchluessel.mitBiometrie()) biometric = true else executeEmergency(action)
        }) { Text(stringResource(R.string.assistant_send)) } },
        dismissButton = { TextButton(onClick = { confirmAction = null }) { Text(stringResource(R.string.assistant_cancel)) } }) }

    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    val showEmergency = emergencyOpen
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val encrypted = rooms.find { it.id == roomId }?.encrypted == true
    val redacted = messages.filter { it.type == "m.room.redaction" }.mapNotNull { it.redacts ?: it.content.value("redacts") }.toSet()
    val shown = messages.filter { it.type == "m.room.message" && it.id !in redacted && (it.content["m.relates_to"] as? JsonObject)?.value("rel_type") != "m.replace" }
    LaunchedEffect(shown.size, roomId, threadId) { if (shown.isNotEmpty()) listState.scrollBy(100000f) }
    fun sendComposer() {
        val retry = pending
        if (retry != null) scope.launch { deliver(retry.first, retry.second) } else send("m.room.message", buildJsonObject {
            put("msgtype", "m.text"); put("body", input)
            threadId?.let { put("m.relates_to", buildJsonObject { put("rel_type", "m.thread"); put("event_id", it); put("is_falling_back", true); put("m.in_reply_to", buildJsonObject { put("event_id", it) }) }) }
        })
    }
    Column(Modifier.fillMaxSize().padding(top = topInset).navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 4.dp)) }
        if (!connected) {
            Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.Center, horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                Text(stringResource(R.string.assistant_swarm), style = MaterialTheme.typography.headlineMedium, color = palette.text)
                Spacer(Modifier.height(20.dp))
                com.claudewebui.app.ui.theme.PlumGlassCard(Modifier.fillMaxWidth().widthIn(max = 480.dp), shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp), contentPadding = 16.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(username, { username = it }, label = { Text(stringResource(R.string.assistant_username)) }, singleLine = true, shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(password, { password = it }, label = { Text(stringResource(R.string.assistant_password)) }, singleLine = true, shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                        Button(enabled = !busy && username.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), onClick = {
                            val request = AssistantMatrixLogin(username, password); password = ""
                            scope.launch { busy = true; try {
                                val result = api.connectAssistantMatrix(request)
                                if (result.success) { connected = true; refresh++ } else error = result.error?.message
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message } finally { busy = false } }
                        }) { Text(stringResource(R.string.assistant_connect)) }
                    }
                }
            }
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
                item { AssistChip(enabled = !busy, onClick = { scope.launch { try {
                    val response = api.openAssistantBrianConversation()
                    response.data?.value("roomId")?.let { roomId = it; threadId = null; refresh++ }
                    if (!response.success) error = response.error?.message
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message } } }, label = { Text(stringResource(R.string.assistant_brian)) }) }
                items(rooms, key = { it.id }) { room ->
                    FilterChip(selected = roomId == room.id, onClick = { roomId = room.id; threadId = null; pending = null }, label = { Text(room.name, maxLines = 1) })
                }
            }
            threadId?.let { TextButton(onClick = { threadId = null }) { Text(stringResource(R.string.assistant_back_room)) } }
            if (encrypted) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                Text(stringResource(R.string.assistant_encrypted), color = palette.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(24.dp))
            } else {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    cursor?.let { before -> item(key = "older") { TextButton(enabled = !busy, onClick = { scope.launch {
                        try { val page = api.getAssistantMatrixMessages(roomId!!, threadId, before).data
                            if (page != null) { messages = (messages + page.chunk).distinctBy { it.id }.sortedBy { it.timestamp }; cursor = page.end ?: page.nextBatch }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { error = failure.message }
                    } }) { Text(stringResource(R.string.assistant_older)) } } }
                    items(shown, key = { it.id.orEmpty() }) { event ->
                        val edited = messages.filter { it.sender == event.sender && (it.content["m.relates_to"] as? JsonObject)?.value("rel_type") == "m.replace" && (it.content["m.relates_to"] as? JsonObject)?.value("event_id") == event.id }.maxByOrNull { it.timestamp }
                        val body = (edited?.content?.get("m.new_content") as? JsonObject ?: event.content).value("body").orEmpty()
                        val own = event.sender == nativeUserId
                        var menu by remember { mutableStateOf(false) }
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) androidx.compose.ui.Alignment.End else androidx.compose.ui.Alignment.Start, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (!own) Text(event.sender.orEmpty().removePrefix("@").substringBefore(':'), style = MaterialTheme.typography.labelMedium, color = palette.muted, modifier = Modifier.padding(horizontal = 6.dp))
                            Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp), color = if (own) palette.selectionTint else palette.controlSurface, modifier = Modifier.widthIn(max = 520.dp)) {
                                Text(body, Modifier.padding(horizontal = 14.dp, vertical = 10.dp), style = MaterialTheme.typography.bodyLarge, color = palette.text)
                            }
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                IconButton(onClick = { threadId = event.id }) { Icon(androidx.compose.material.icons.Icons.Outlined.Reply, stringResource(R.string.assistant_reply), tint = palette.muted, modifier = Modifier.size(18.dp)) }
                                Box {
                                    IconButton(enabled = !busy && pending == null, onClick = { menu = true }) { Icon(androidx.compose.material.icons.Icons.Outlined.AddReaction, null, tint = palette.muted, modifier = Modifier.size(18.dp)) }
                                    DropdownMenu(menu, { menu = false }) {
                                        Row(Modifier.padding(horizontal = 8.dp)) {
                                            listOf("✅", "❌", "👍", "👎", "🔕", "🔔", "🛑").forEach { emoji ->
                                                TextButton(onClick = { menu = false; send("m.reaction", buildJsonObject { put("m.relates_to", buildJsonObject { put("rel_type", "m.annotation"); put("event_id", event.id.orEmpty()); put("key", emoji) }) }) }, contentPadding = PaddingValues(horizontal = 6.dp)) { Text(emoji, style = MaterialTheme.typography.titleMedium) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp), color = palette.controlSurface.copy(alpha = 1f), border = androidx.compose.foundation.BorderStroke(1.dp, palette.border.copy(alpha = .8f)), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp, top = 4.dp)) {
                    Row(Modifier.padding(start = 6.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = androidx.compose.ui.Alignment.Bottom) {
                        TextField(
                            value = input, onValueChange = { input = it },
                            placeholder = { Text(stringResource(R.string.assistant_ask_hint), color = palette.muted) },
                            modifier = Modifier.weight(1f), maxLines = 6, enabled = pending == null,
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                                disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                                disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                            ),
                        )
                        FilledIconButton(enabled = !busy && (input.isNotBlank() || pending != null), onClick = { sendComposer() }) {
                            Icon(
                                if (pending == null) androidx.compose.material.icons.Icons.Outlined.ArrowUpward else androidx.compose.material.icons.Icons.Outlined.Refresh,
                                stringResource(if (pending == null) R.string.assistant_send else R.string.assistant_retry),
                            )
                        }
                    }
                }
            }
        }
    }
    if (showEmergency) ModalBottomSheet(onDismissRequest = onEmergencyDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.assistant_emergency), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.assistant_emergency_cached), color = palette.muted)
            if (connected) OutlinedButton(enabled = !busy, onClick = {
                NotAusSchluessel.erzeugen(context)
                input = "!geraet neu plum-android ${NotAusSchluessel.spki()?.let { android.util.Base64.encodeToString(it, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING) }.orEmpty()}"
                roomId = rooms.find { it.alias?.startsWith("#schwarm-lobby:") == true }?.id ?: roomId
                threadId = null; onEmergencyDismiss()
            }) { Text(stringResource(R.string.assistant_emergency_setup)) }
            if (emergencyUrl != null && NotAusSchluessel.vorhanden()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy, onClick = { onEmergencyDismiss(); confirmAction = "stopp" }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text(stringResource(R.string.assistant_emergency_stop)) }
                OutlinedButton(enabled = !busy, onClick = { onEmergencyDismiss(); confirmAction = "weiter" }) { Text(stringResource(R.string.assistant_emergency_resume)) }
            }
            emergencyResult?.let { Text(it) }
            HorizontalDivider()
            TextButton(onClick = { context.startActivity(android.content.Intent(context, com.claudewebui.swarm.MainActivity::class.java)) }) { Text(stringResource(R.string.assistant_swarm_full)) }
        }
    }
}
