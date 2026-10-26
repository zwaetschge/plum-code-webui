package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantResource
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun ChatManagerSheet(owner: String, api: ApiClient, onOpenChat: (AssistantResource) -> Unit, onChanged: (List<String>) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val decoder = remember { Json { ignoreUnknownKeys = true } }
    var archived by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var projects by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var selection by remember { mutableStateOf<Map<String, AssistantResource>>(emptyMap()) }
    var busyChats by remember { mutableStateOf<JsonObject>(JsonObject(emptyMap())) }
    var nextOffset by remember { mutableStateOf<Int?>(null) }
    var targetProject by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun current() = TokenStore.assistantOwnerKey() == owner
    suspend fun load(offset: Int = 0) {
        val response = api.getManagedChats(archived, search, offset); check(current())
        require(response.success) { response.error?.message ?: "Verlauf konnte nicht geladen werden" }
        val data = requireNotNull(response.data)
        val page = (data["entries"] as? JsonArray)?.map { decoder.decodeFromJsonElement<AssistantResource>(it) }.orEmpty()
        entries = if (offset == 0) page else (entries + page).distinctBy { it.id }
        val states = data["busyChats"] as? JsonObject ?: JsonObject(emptyMap())
        busyChats = if (offset == 0) states else JsonObject(busyChats + states)
        nextOffset = data["nextOffset"]?.jsonPrimitive?.intOrNull
    }
    fun act(action: String) {
        if (busy || selection.isEmpty()) return
        scope.launch {
            busy = true; error = null
            try {
                check(current())
                val ids = selection.keys.toList()
                val payload = buildJsonObject {
                    put("commandId", UUID.randomUUID().toString()); put("action", action)
                    put("chats", JsonArray(selection.values.map { entry -> buildJsonObject { put("id", entry.id); put("expectedRevision", entry.revision) } }))
                    if (action == "move") put("projectId", targetProject.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                }
                val response = api.bulkManageChats(owner, payload); check(current())
                require(response.success) { response.error?.message ?: "Änderung fehlgeschlagen" }
                selection = emptyMap(); load(); onChanged(if (action == "archive") ids else emptyList())
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (current()) error = failure.message }
            finally { if (current()) busy = false }
        }
    }
    LaunchedEffect(owner, archived, search) {
        selection = emptyMap(); error = null
        if (search.isNotBlank()) delay(250)
        busy = true
        try { load(); val response = api.getAssistantResources("projects"); check(current()); projects = response.data.orEmpty() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (current()) error = failure.message }
        finally { if (current()) busy = false }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.92f).imePadding().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Verlauf", style = MaterialTheme.typography.headlineSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!archived, { if (!busy) archived = false }, label = { Text("Gespräche") })
                FilterChip(archived, { if (!busy) archived = true }, label = { Text("Archiv") })
            }
            OutlinedTextField(search, { search = it.take(200) }, label = { Text("Gespräche suchen") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${selection.size} ausgewählt", Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.labelMedium)
                TextButton(enabled = !busy, onClick = { selection = entries.filter { !busyChats.containsKey(it.id) }.take(100).associateBy { it.id } }) { Text("Bis zu 100 auswählen") }
                if (selection.isNotEmpty()) TextButton(enabled = !busy, onClick = { selection = emptyMap() }) { Text("Auswahl aufheben") }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (archived) Button(enabled = !busy && selection.isNotEmpty(), onClick = { act("restore") }) { Text("Wiederherstellen") }
                else {
                    var menu by remember { mutableStateOf(false) }
                    Box {
                        OutlinedButton(enabled = !busy, onClick = { menu = true }, modifier = Modifier.widthIn(max = 320.dp)) { Text(projects.firstOrNull { it.id == targetProject }?.title ?: "Ohne Projekt", maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { Text("Ohne Projekt") }, onClick = { targetProject = ""; menu = false })
                            projects.forEach { project -> DropdownMenuItem(text = { Text(project.title) }, onClick = { targetProject = project.id; menu = false }) }
                        }
                    }
                    Button(enabled = !busy && selection.isNotEmpty(), onClick = { act("move") }) { Text("Verschieben") }
                    OutlinedButton(enabled = !busy && selection.isNotEmpty(), onClick = { act("archive") }) { Text("Archivieren") }
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(entries, key = { it.id }) { entry ->
                    Row(Modifier.fillMaxWidth()) {
                        Checkbox(entry.id in selection, { checked -> selection = if (checked) selection + (entry.id to entry) else selection - entry.id }, enabled = !busy && (entry.id in selection || (!busyChats.containsKey(entry.id) && selection.size < 100)), modifier = Modifier.semantics { contentDescription = "${entry.title} auswählen" })
                        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            if (archived) Text(entry.title, style = MaterialTheme.typography.titleSmall)
                            else TextButton(enabled = !busy, onClick = { onOpenChat(entry) }, contentPadding = PaddingValues(0.dp)) { Text(entry.title, style = MaterialTheme.typography.titleSmall) }
                            val project = projects.firstOrNull { it.id == entry.body["projectId"]?.jsonPrimitive?.contentOrNull }
                            project?.let { Text(it.title, style = MaterialTheme.typography.labelSmall) }
                            val time = runCatching { java.time.Instant.parse(entry.updatedAt).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy")) }.getOrDefault(entry.updatedAt.take(10))
                            Text(time, style = MaterialTheme.typography.labelSmall)
                            busyChats[entry.id]?.jsonPrimitive?.contentOrNull?.let { Text(if (it == "running") "Antwort läuft" else "Nachricht vorgemerkt", style = MaterialTheme.typography.labelSmall) }
                        }
                    }
                    HorizontalDivider()
                }
                if (!busy && entries.isEmpty()) item { Text(if (archived) "Archiv ist leer." else "Keine Gespräche.") }
                nextOffset?.let { offset -> item { TextButton(enabled = !busy, onClick = { scope.launch { busy = true; try { load(offset) } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (current()) error = failure.message } finally { if (current()) busy = false } } }) { Text("Weitere Gespräche") } } }
            }
        }
    }
}
