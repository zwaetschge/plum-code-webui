package com.claudewebui.app.ui.screens.dashboard

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantApiProvider
import com.claudewebui.app.data.model.AssistantResource
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Native controls; generated code is opened separately in an isolated renderer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatWorkbenchSheet(
    owner: String, api: ApiClient, chat: AssistantResource?, providers: List<AssistantApiProvider>,
    initial: JsonObject, onSaved: (JsonObject, AssistantResource?) -> Unit,
    onImported: (String) -> Unit, onDismiss: () -> Unit,
) {
    val profileMode = chat?.kind == "profile"
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val saved = chat?.body?.get("chatOptions") as? JsonObject ?: initial
    var web by remember { mutableStateOf(saved["webSearch"]?.jsonPrimitive?.booleanOrNull ?: false) }
    var full by remember { mutableStateOf(saved["fullDocuments"]?.jsonPrimitive?.booleanOrNull ?: false) }
    var writes by remember { mutableStateOf(saved["allowToolWrites"]?.jsonPrimitive?.booleanOrNull ?: false) }
    var servers by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var selected by remember { mutableStateOf((saved["mcpServerIds"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()) }
    var referenceChatIds by remember { mutableStateOf((saved["referenceChatIds"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()) }
    var referenceChats by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var referenceSearch by remember { mutableStateOf("") }
    var selectedSkills by remember { mutableStateOf((saved["skillNames"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()) }
    var skills by remember { mutableStateOf<List<com.claudewebui.app.data.model.ConfigSkill>>(emptyList()) }
    var skillSearch by remember { mutableStateOf("") }
    var catalog by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var toolSearch by remember { mutableStateOf("") }
    var toolLoading by remember { mutableStateOf(saved["toolLoading"]?.jsonPrimitive?.contentOrNull ?: "on-demand") }
    var permissions by remember { mutableStateOf(saved["toolPermissions"] as? JsonObject ?: JsonObject(emptyMap())) }
    var comparisons by remember { mutableStateOf((saved["comparisonModels"] as? JsonArray)?.map { it.jsonObject }.orEmpty()) }
    var temperature by remember { mutableStateOf(saved["temperature"]?.jsonPrimitive?.content.orEmpty()) }
    var tokens by remember { mutableStateOf(saved["maxOutputTokens"]?.jsonPrimitive?.content ?: "8192") }
    var turns by remember { mutableStateOf(saved["contextTurns"]?.jsonPrimitive?.content ?: "20") }
    var autoCompact by remember { mutableStateOf(saved["autoCompact"]?.jsonPrimitive?.booleanOrNull ?: true) }
    var shares by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<String?>(null) }
    var exportBytes by remember { mutableStateOf<ByteArray?>(null) }
    fun current() = owner == TokenStore.assistantOwnerKey()
    fun act(block: suspend () -> Unit) {
        if (busy) return
        scope.launch {
            busy = true; error = null
            try { check(current()); block() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (current()) error = failure.message }
            finally { if (current()) busy = false }
        }
    }
    val saveFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val bytes = exportBytes; exportBytes = null
        if (uri != null && bytes != null) act { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: kotlin.error("Datei nicht verfügbar") } }
    }
    val importFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) act {
            val bytes = withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    java.io.ByteArrayOutputStream().also { out ->
                        val chunk = ByteArray(8192)
                        while (true) {
                            val count = input.read(chunk)
                            if (count < 0) break
                            out.write(chunk, 0, count)
                            require(out.size() <= 25 * 1024 * 1024) { "Archiv überschreitet 25 MB" }
                        }
                    }.toByteArray()
                } ?: kotlin.error("Datei nicht verfügbar")
            }
            require(bytes.size <= 25 * 1024 * 1024) { "Archiv überschreitet 25 MB" }
            val provider = providers.firstOrNull() ?: kotlin.error("Anbieter fehlt")
            val response = api.importModelChats(owner, provider.id, provider.models.first(), bytes)
            check(current()); require(response.success) { response.error?.message ?: "Import fehlgeschlagen" }
            val data = requireNotNull(response.data)
            val notice = data["attachmentNotice"]?.jsonPrimitive?.contentOrNull
            result = "${data["count"]?.jsonPrimitive?.content ?: "0"} Gespräche importiert" + (notice?.let { " · $it" } ?: "")
            if (notice == null) (data["chats"] as? JsonArray)?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.content?.let(onImported)
        }
    }
    LaunchedEffect(owner, referenceSearch) {
        if (referenceSearch.isNotBlank()) delay(250)
        try { val response = api.getAssistantResources("api-chats", search = referenceSearch); check(current()); require(response.success); referenceChats = response.data.orEmpty() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (current()) error = failure.message }
    }
    LaunchedEffect(owner, chat?.id) {
        try {
            val response = api.getChatToolServers(); check(current())
            require(response.success); servers = response.data.orEmpty().filter { it["enabled"]?.jsonPrimitive?.booleanOrNull == true }
            val skillResponse = api.getConfigSkills("skill"); check(current())
            require(skillResponse.success); skills = skillResponse.data.orEmpty()
            if (!profileMode && chat != null && chat.body["temporary"]?.jsonPrimitive?.booleanOrNull != true) shares = api.getModelChatShares(chat.id).data.orEmpty()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (current()) error = failure.message }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (profileMode) "Fähigkeiten" else "Chat-Werkzeuge", style = MaterialTheme.typography.headlineSmall)
            var showReferences by remember { mutableStateOf(false) }
            TextButton(onClick = { showReferences = !showReferences }) { Text("Gesprächsreferenzen · ${referenceChatIds.size}" + if (chat?.body?.get("memoryRead")?.jsonPrimitive?.booleanOrNull == false) " · Lesen aus" else "") }
            if (showReferences) {
                if (referenceChatIds.isNotEmpty()) TextButton(onClick = { referenceChatIds = emptyList() }) { Text("Referenzen entfernen") }
                OutlinedTextField(referenceSearch, { referenceSearch = it }, label = { Text("Gespräche suchen") }, modifier = Modifier.fillMaxWidth())
                referenceChats.filter { it.id != chat?.id && it.body["temporary"]?.jsonPrimitive?.booleanOrNull != true && it.title.contains(referenceSearch, ignoreCase = true) }.forEach { entry -> Row(Modifier.fillMaxWidth()) {
                    Checkbox(entry.id in referenceChatIds, { checked -> referenceChatIds = if (checked) (referenceChatIds + entry.id).distinct().take(10) else referenceChatIds - entry.id }, enabled = !busy && chat?.body?.get("memoryRead")?.jsonPrimitive?.booleanOrNull != false && (entry.id in referenceChatIds || referenceChatIds.size < 10))
                    Text(entry.title, Modifier.padding(top = 12.dp).weight(1f))
                } }
            }
            var showSkills by remember { mutableStateOf(false) }
            TextButton(onClick = { showSkills = !showSkills }) { Text("Fachliche Skills · ${selectedSkills.size}") }
            if (showSkills) {
                OutlinedTextField(skillSearch, { skillSearch = it }, label = { Text("Skills suchen") }, modifier = Modifier.fillMaxWidth())
                skills.filter { it.presetKey in selectedSkills || "${it.name} ${it.description}".contains(skillSearch, ignoreCase = true) }.take(60).forEach { skill ->
                    Row(Modifier.fillMaxWidth()) {
                        Checkbox(skill.presetKey in selectedSkills, { checked -> selectedSkills = if (checked) (selectedSkills + skill.presetKey).distinct().take(12) else selectedSkills - skill.presetKey }, enabled = !busy && (selectedSkills.size < 12 || skill.presetKey in selectedSkills))
                        Text(skill.name, Modifier.padding(top = 12.dp).weight(1f))
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Websuche und Seitenabruf", Modifier.weight(1f)); Switch(web, { web = it }, enabled = !busy) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Volltext statt Fundstellen", Modifier.weight(1f)); Switch(full, { full = it }, enabled = !busy) }
            Text("MCP-Werkzeuge", style = MaterialTheme.typography.titleMedium)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(toolLoading == "on-demand", { toolLoading = "on-demand" }, label = { Text("Bei Bedarf") })
                FilterChip(toolLoading == "eager", { toolLoading = "eager" }, label = { Text("Direkt") })
            }
            servers.forEach { server ->
                val id = server.getValue("id").jsonPrimitive.content
                Row(Modifier.fillMaxWidth()) {
                    Checkbox(id in selected, { checked -> selected = if (checked) (selected + id).distinct().take(6) else selected - id }, enabled = !busy)
                    Text(server["name"]?.jsonPrimitive?.content ?: id, Modifier.padding(top = 12.dp).weight(1f))
                }
            }
            Row { Checkbox(writes, { writes = it }, enabled = !busy); Text("Schreibende Werkzeuge erlauben", Modifier.padding(top = 12.dp)) }
            OutlinedButton(enabled = !busy && selected.isNotEmpty(), onClick = { act {
                val response = api.getChatToolCatalog(owner, buildJsonObject { put("mcpServerIds", JsonArray(selected.map(::JsonPrimitive))); put("allowToolWrites", writes); put("toolLoading", toolLoading); put("toolPermissions", permissions) })
                check(current()); require(response.success) { response.error?.message ?: "Funktionen konnten nicht geladen werden" }; catalog = response.data.orEmpty()
            } }) { Text("Funktionen verwalten") }
            if (catalog.isNotEmpty()) {
                OutlinedTextField(toolSearch, { toolSearch = it }, label = { Text("Funktionen suchen") }, modifier = Modifier.fillMaxWidth())
                catalog.filter { "${it["name"]} ${it["description"]}".contains(toolSearch, ignoreCase = true) }.take(100).forEach { item ->
                    val key = item.getValue("key").jsonPrimitive.content
                    Text(item["name"]?.jsonPrimitive?.contentOrNull.orEmpty(), style = MaterialTheme.typography.labelMedium)
                    var menu by remember(key) { mutableStateOf(false) }
                    val selectedPermission = permissions[key]?.jsonPrimitive?.contentOrNull ?: "allow"
                    Box {
                        OutlinedButton(enabled = !busy, onClick = { menu = true }) { Text(when (selectedPermission) { "ask" -> "Einzeln genehmigen"; "block" -> "Blockieren"; else -> "Auto-Accept" }) }
                        DropdownMenu(menu, { menu = false }) {
                            listOf("allow" to "Auto-Accept", "ask" to "Einzeln genehmigen", "block" to "Blockieren").forEach { (value, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { permissions = JsonObject(permissions + (key to JsonPrimitive(value))); menu = false }) }
                        }
                    }
                }
            }
            Text("Modellvergleich", style = MaterialTheme.typography.titleMedium)
            comparisons.forEachIndexed { index, model -> Row {
                Text("${model["providerId"]?.jsonPrimitive?.content} · ${model["model"]?.jsonPrimitive?.content}", Modifier.weight(1f))
                TextButton(enabled = !busy, onClick = { comparisons = comparisons.filterIndexed { i, _ -> i != index } }) { Text("Entfernen") }
            } }
            var modelMenu by remember { mutableStateOf(false) }
            Box {
                OutlinedButton(enabled = !busy && comparisons.size < 3, onClick = { modelMenu = true }) { Text("Modell hinzufügen") }
                DropdownMenu(modelMenu, { modelMenu = false }, Modifier.heightIn(max = 360.dp)) {
                    providers.forEach { provider -> provider.models.forEach { model ->
                        DropdownMenuItem(text = { Text("${provider.name} · $model") }, onClick = {
                            val entry = buildJsonObject { put("providerId", provider.id); put("model", model) }
                            comparisons = (comparisons + entry).distinct().take(3); modelMenu = false
                        })
                    } }
                }
            }
            OutlinedTextField(temperature, { temperature = it }, label = { Text("Temperatur (0–2)") }, enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(tokens, { tokens = it }, label = { Text("Ausgabetokens (128–32768)") }, enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(turns, { turns = it }, label = { Text("Kontextnachrichten (1–100)") }, enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row { Checkbox(autoCompact, { autoCompact = it }, enabled = !busy); Text("Lange Verläufe verdichten", Modifier.padding(top = 12.dp)) }
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { act {
                val maxTokens = tokens.toIntOrNull(); val contextTurns = turns.toIntOrNull(); val temp = temperature.takeIf { it.isNotBlank() }?.toDoubleOrNull()
                require(maxTokens != null && maxTokens in 128..32768 && contextTurns != null && contextTurns in 1..100 && (temperature.isBlank() || (temp != null && temp in 0.0..2.0))) { "Modellparameter prüfen" }
                val options = buildJsonObject { put("referenceChatIds", JsonArray(referenceChatIds.map(::JsonPrimitive))); put("autoCompact", autoCompact); put("webSearch", web); put("fullDocuments", full); put("allowToolWrites", writes); put("mcpServerIds", JsonArray(selected.map(::JsonPrimitive))); put("skillNames", JsonArray(selectedSkills.map(::JsonPrimitive))); put("toolLoading", toolLoading); put("toolPermissions", permissions); put("comparisonModels", JsonArray(comparisons)); put("maxOutputTokens", maxTokens); put("contextTurns", contextTurns); temp?.let { put("temperature", it) } }
                val resource = chat?.let { val payload = buildJsonObject { put("expectedRevision", it.revision); put("options", options) }; val response = if (profileMode) api.saveProfileChatOptions(owner, it.id, payload) else api.saveChatOptions(owner, it.id, payload); require(response.success) { response.error?.message ?: "Speichern fehlgeschlagen" }; requireNotNull(response.data) }
                check(current()); onSaved(options, resource); onDismiss()
            } }) { Text(if (busy) "Speichert …" else "Speichern") }
            if (!profileMode) {
            HorizontalDivider()
            OutlinedButton(enabled = !busy && providers.isNotEmpty(), onClick = { importFile.launch(arrayOf("application/json", "text/plain")) }) { Text("Chats importieren") }
            if (chat != null) {
                OutlinedButton(enabled = !busy, onClick = { act { val bytes = api.exportModelChat(chat.id); check(current()); exportBytes = bytes; saveFile.launch("plum-chat.json") } }) { Text("Chat exportieren") }
                if (chat.body["temporary"]?.jsonPrimitive?.booleanOrNull != true) {
                    OutlinedButton(enabled = !busy, onClick = { act {
                        val response = api.shareModelChat(chat.id); require(response.success); check(current())
                        val path = requireNotNull(response.data?.get("viewPath")?.jsonPrimitive?.content)
                        val base = java.net.URI(TokenStore.getServerUrl().orEmpty())
                        val link = java.net.URI(base.scheme, base.authority, path, null, null).toString()
                        shares = api.getModelChatShares(chat.id).data.orEmpty()
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, link) }, "Chat teilen"))
                    } }) { Text("Chat teilen") }
                    shares.filter { it["revoked"]?.jsonPrimitive?.longOrNull != 1L }.forEach { share ->
                        TextButton(enabled = !busy, onClick = { act { require(api.revokeModelChatShare(share.getValue("id").jsonPrimitive.content).success); check(current()); shares = api.getModelChatShares(chat.id).data.orEmpty() } }) { Text("Freigabe widerrufen · ${share["expiresAt"]?.jsonPrimitive?.content?.take(10).orEmpty()}") }
                    }
                }
            }
            }
            result?.let { Text(it) }; error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
