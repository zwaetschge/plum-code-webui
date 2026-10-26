package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantResource
import com.claudewebui.app.data.model.AssistantResourceInput
import com.claudewebui.app.ui.components.common.PlumBackdrop
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

@Composable
internal fun MemoryTopicsScreen(api: ApiClient, onClose: () -> Unit, onOpenFeature: (String) -> Unit) {
    val owner = remember { TokenStore.assistantOwnerKey() } ?: return
    val scope = rememberCoroutineScope()
    val decoder = remember { Json { ignoreUnknownKeys = true } }
    var topics by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var selected by remember { mutableStateOf<JsonObject?>(null) }
    var entries by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var search by remember { mutableStateOf("") }
    var nextTopics by remember { mutableStateOf<Int?>(null) }
    var nextEntries by remember { mutableStateOf<Int?>(null) }
    var version by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<AssistantResource?>(null) }
    var editor by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }
    var projectId by remember { mutableStateOf("") }
    var projects by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var forget by remember { mutableStateOf(false) }
    var diff by remember { mutableStateOf<AssistantResource?>(null) }
    fun current() = TokenStore.assistantOwnerKey() == owner
    suspend fun loadTopics(offset: Int = 0) {
        val response = api.getMemoryTopics(search, offset); check(current())
        require(response.success) { response.error?.message ?: "Themen konnten nicht geladen werden" }
        val data = requireNotNull(response.data)
        val loaded = (data["topics"] as? JsonArray)?.map { it.jsonObject }.orEmpty()
        topics = if (offset == 0) loaded else (topics + loaded).distinctBy { it["id"] }
        nextTopics = data["nextOffset"]?.jsonPrimitive?.intOrNull
    }
    suspend fun loadDocument(offset: Int = 0) {
        val id = selected?.get("id")?.jsonPrimitive?.contentOrNull ?: return
        val response = api.getMemoryTopicDocument(id, offset); check(current())
        if (!response.success && response.error?.message?.contains("nicht gefunden") == true) { selected = null; entries = emptyList(); return }
        require(response.success) { response.error?.message ?: "Thema konnte nicht geladen werden" }
        val data = requireNotNull(response.data)
        val loaded = (data["entries"] as? JsonArray)?.map { decoder.decodeFromJsonElement<AssistantResource>(it) }.orEmpty()
        entries = if (offset == 0) loaded else (entries + loaded).distinctBy { it.id }
        version = data["version"]?.jsonPrimitive?.contentOrNull.orEmpty()
        nextEntries = data["nextOffset"]?.jsonPrimitive?.intOrNull
    }
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
    LaunchedEffect(owner, search) {
        delay(250)
        busy = true
        try { loadTopics() } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (current()) error = failure.message }
        finally { if (current()) busy = false }
    }
    LaunchedEffect(selected?.get("id")) { if (selected != null) { busy = true; try { loadDocument() } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (current()) error = failure.message } finally { busy = false } } }
    LaunchedEffect(owner, selected?.get("id")) {
        while (isActive) {
            delay(10000)
            if (!busy && !editor && !forget) {
                try { loadTopics(); loadDocument() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { if (current()) error = failure.message }
            }
        }
    }
    BackHandler { if (selected != null) selected = null else onClose() }
    diff?.let { entry -> ResourceRevisionDiff(owner, api, "memory", entry.id, entry.revision) { diff = null } }
    if (forget) AlertDialog(onDismissRequest = { if (!busy) forget = false }, title = { Text("Thema vergessen?") }, text = { Text(selected?.get("title")?.jsonPrimitive?.contentOrNull.orEmpty()) }, confirmButton = { TextButton(enabled = !busy, onClick = { act {
        val id = requireNotNull(selected?.get("id")?.jsonPrimitive?.contentOrNull)
        val response = api.forgetMemoryTopic(owner, id, version); check(current()); require(response.success) { response.error?.message ?: "Vergessen fehlgeschlagen" }
        selected = null; entries = emptyList(); forget = false; loadTopics()
    } }) { Text("Thema vergessen", color = MaterialTheme.colorScheme.error) } }, dismissButton = { TextButton(onClick = { forget = false }) { Text("Abbrechen") } })
    if (editor) AlertDialog(onDismissRequest = { if (!busy) editor = false }, title = { Text(if (creating) "Neues Thema" else "Wissensstand") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(title, { title = it.take(200) }, label = { Text(if (creating) "Thema" else "Titel") }, modifier = Modifier.fillMaxWidth())
            if (creating) {
                var menu by remember { mutableStateOf(false) }
                Box { OutlinedButton(onClick = { menu = true }) { Text(projects.firstOrNull { it.id == projectId }?.title ?: "Persönlich") }; DropdownMenu(menu, { menu = false }) { DropdownMenuItem(text = { Text("Persönlich") }, onClick = { projectId = ""; menu = false }); projects.forEach { project -> DropdownMenuItem(text = { Text(project.title) }, onClick = { projectId = project.id; menu = false }) } } }
            }
            OutlinedTextField(text, { text = it.take(50000) }, label = { Text("Wissensstand") }, modifier = Modifier.fillMaxWidth(), minLines = 4)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }, confirmButton = { TextButton(enabled = !busy && title.isNotBlank() && text.isNotBlank(), onClick = { act {
        val prior = editing
        val body = if (prior != null) JsonObject(prior.body + mapOf("text" to JsonPrimitive(text.trim()), "pinned" to JsonPrimitive(true), "state" to JsonPrimitive("active"))) else buildJsonObject {
            val targetScope = if (creating) (if (projectId.isBlank()) "personal" else "project") else selected?.get("scope")?.jsonPrimitive?.contentOrNull ?: "personal"
            val scopeId = if (creating) projectId else selected?.get("scopeId")?.jsonPrimitive?.contentOrNull.orEmpty()
            put("text", text.trim()); put("topic", if (creating) title.trim() else selected?.get("title")?.jsonPrimitive?.contentOrNull.orEmpty()); put("scope", targetScope); put("pinned", true)
            if (targetScope == "project") put("projectId", scopeId)
            if (targetScope == "agent") put("agentId", scopeId)
        }
        val input = AssistantResourceInput(title.trim(), body, prior?.revision)
        val response = api.saveChatMemory(owner, prior?.id, input)
        check(current()); require(response.success) { response.error?.message ?: "Speichern fehlgeschlagen" }
        editor = false; loadTopics(); loadDocument()
    } }) { Text("Speichern") } }, dismissButton = { TextButton(enabled = !busy, onClick = { editor = false }) { Text("Abbrechen") } })
    PlumBackdrop {
        Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { if (selected != null) selected = null else onClose() }) { Text("Zurück") }
                TextButton(enabled = !busy, onClick = { act { loadTopics(); loadDocument() } }) { Text("Aktualisieren") }
            }
            Text(selected?.get("title")?.jsonPrimitive?.contentOrNull ?: "Themen", style = MaterialTheme.typography.headlineMedium)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (selected == null) {
                OutlinedTextField(search, { search = it.take(200) }, label = { Text("Themen suchen") }, modifier = Modifier.fillMaxWidth())
                OutlinedButton(enabled = !busy, onClick = { act { val response = api.getAssistantResources("projects"); check(current()); projects = response.data.orEmpty(); editing = null; creating = true; title = ""; text = ""; projectId = ""; editor = true } }) { Text("Neues Thema") }
                topics.forEach { topic -> TextButton(enabled = !busy, onClick = { selected = topic; error = null }) { Column(Modifier.fillMaxWidth()) { Text(topic["title"]?.jsonPrimitive?.contentOrNull.orEmpty()); Text("${when(topic["scope"]?.jsonPrimitive?.contentOrNull) { "project" -> "Projekt"; "agent" -> "Agent"; else -> "Persönlich" }} · ${topic["count"]?.jsonPrimitive?.contentOrNull.orEmpty()}", style = MaterialTheme.typography.labelSmall) } } }
                if (!busy && topics.isEmpty()) Text("Keine Themen.")
                nextTopics?.let { offset -> TextButton(enabled = !busy, onClick = { act { loadTopics(offset) } }) { Text("Weitere Themen") } }
            } else {
                OutlinedButton(enabled = !busy, onClick = { editing = null; creating = false; title = ""; text = ""; editor = true }) { Text("Abschnitt ergänzen") }
                entries.forEach { entry ->
                    Text(entry.title, style = MaterialTheme.typography.titleMedium)
                    Text("Revision ${entry.revision}${if (entry.body["state"]?.jsonPrimitive?.contentOrNull == "proposed") " · Zur Prüfung" else ""}", style = MaterialTheme.typography.labelSmall)
                    Text(entry.body["text"]?.jsonPrimitive?.contentOrNull.orEmpty())
                    Row { TextButton(enabled = !busy, onClick = { editing = entry; creating = false; title = entry.title; text = entry.body["text"]?.jsonPrimitive?.contentOrNull.orEmpty(); editor = true }) { Text("Bearbeiten") }; TextButton(onClick = { diff = entry }) { Text("Änderungen") } }
                    TextButton(enabled = !busy, onClick = { act { val response = api.forgetChatMemory(owner, entry.id, entry.revision); check(current()); require(response.success) { response.error?.message ?: "Vergessen fehlgeschlagen" }; entries = entries.filter { it.id != entry.id }; if (entries.isEmpty() && nextEntries == null) selected = null; loadTopics(); loadDocument() } }) { Text("Vergessen") }
                    var provenance by remember(entry.id) { mutableStateOf(false) }
                    val origins = entry.body["origins"] as? JsonArray
                    if (!origins.isNullOrEmpty()) {
                        TextButton(onClick = { provenance = !provenance }) { Text("Herkunft und Belege") }
                        if (provenance) origins.forEach { value -> val origin = value.jsonObject; Text(origin["quote"]?.jsonPrimitive?.contentOrNull.orEmpty(), style = MaterialTheme.typography.bodySmall); if (origin["type"]?.jsonPrimitive?.contentOrNull == "api") TextButton(onClick = { onOpenFeature("/chat/model/" + origin["id"]?.jsonPrimitive?.contentOrNull.orEmpty()) }) { Text("Ursprüngliches Gespräch") } }
                    }
                    HorizontalDivider()
                }
                nextEntries?.let { offset -> TextButton(enabled = !busy, onClick = { act { loadDocument(offset) } }) { Text("Weitere Abschnitte") } }
                TextButton(enabled = !busy && version.isNotBlank(), onClick = { forget = true }) { Text("Thema vergessen", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}
