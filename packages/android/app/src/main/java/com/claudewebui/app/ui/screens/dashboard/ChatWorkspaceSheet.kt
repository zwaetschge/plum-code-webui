package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantApiProvider
import com.claudewebui.app.data.model.AssistantResource
import com.claudewebui.app.data.model.AssistantResourceInput
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/** The same saved profiles/projects as the WebUI. No provider-specific assistant store. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatWorkspaceSheet(
    owner: String, api: ApiClient, providers: List<AssistantApiProvider>,
    initialProfile: String?, initialProject: String?,
    onApply: (AssistantResource?, String?) -> Unit,
    onChat: (AssistantResource) -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var profiles by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var projects by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var sources by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var chats by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var selectedProfile by remember { mutableStateOf(initialProfile) }
    var selectedProject by remember { mutableStateOf(initialProject) }
    var collection by remember { mutableStateOf("profiles") }
    var editing by remember { mutableStateOf<AssistantResource?>(null) }
    var editor by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var sourceIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun checkOwner() { if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed") }
    suspend fun load() {
        profiles = api.getAssistantResources("profiles").also { checkOwner(); check(it.success) { it.error?.message.orEmpty() } }.data.orEmpty()
        projects = api.getAssistantResources("projects").also { checkOwner(); check(it.success) { it.error?.message.orEmpty() } }.data.orEmpty()
        sources = api.getAssistantResources("sources").also { checkOwner(); check(it.success) { it.error?.message.orEmpty() } }.data.orEmpty()
        chats = api.getAssistantResources("api-chats").also { checkOwner(); check(it.success) { it.error?.message.orEmpty() } }.data.orEmpty()
    }
    LaunchedEffect(owner) {
        busy = true
        try { load() } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
        finally { busy = false }
    }
    fun edit(resource: AssistantResource?) {
        editing = resource; editor = true; error = null
        title = resource?.title.orEmpty()
        instructions = resource?.body?.get(if (collection == "sources") "text" else "instructions")?.jsonPrimitive?.contentOrNull.orEmpty()
        description = resource?.body?.get("description")?.jsonPrimitive?.contentOrNull.orEmpty()
        provider = resource?.body?.get("apiProviderId")?.jsonPrimitive?.contentOrNull.orEmpty()
        model = resource?.body?.get("model")?.jsonPrimitive?.contentOrNull.orEmpty()
        sourceIds = (resource?.body?.get("sourceIds") as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
    }
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.chat_workspace_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.chat_workspace_description), style = MaterialTheme.typography.bodySmall)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (editor) {
                OutlinedTextField(title, { title = it.take(200) }, label = { Text(stringResource(R.string.chat_workspace_name)) }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                if (collection == "projects") OutlinedTextField(description, { description = it.take(30000) }, label = { Text(stringResource(R.string.chat_workspace_project_description)) }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(instructions, { instructions = it.take(if (collection == "sources") 50000 else 30000) }, label = { Text(stringResource(if (collection == "sources") R.string.chat_workspace_source_text else R.string.chat_workspace_instructions)) }, minLines = 4, enabled = !busy, modifier = Modifier.fillMaxWidth())
                if (collection == "profiles") {
                    WorkspaceChoice(stringResource(R.string.chat_workspace_provider), provider, listOf("" to stringResource(R.string.chat_workspace_keep_model)) + providers.map { it.id to it.name }, !busy) { provider = it; model = "" }
                    if (provider.isNotEmpty()) WorkspaceChoice(stringResource(R.string.chat_workspace_model), model, listOf("" to stringResource(R.string.chat_workspace_default)) + providers.firstOrNull { it.id == provider }?.models.orEmpty().map { it to it }, !busy) { model = it }
                    Text(stringResource(R.string.chat_workspace_knowledge), style = MaterialTheme.typography.titleSmall)
                    sources.forEach { source ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Checkbox(source.id in sourceIds, enabled = !busy && (source.id in sourceIds || sourceIds.size < 20), onCheckedChange = { checked -> sourceIds = if (checked) sourceIds + source.id else sourceIds - source.id })
                            Text(source.title, Modifier.weight(1f).padding(top = 12.dp))
                        }
                    }
                    Text(stringResource(R.string.chat_workspace_revision_hint), style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy && title.isNotBlank() && (collection != "sources" || instructions.isNotBlank()), onClick = {
                        scope.launch {
                            busy = true; error = null
                            try {
                                checkOwner()
                                val body = buildJsonObject {
                                    editing?.body?.forEach { (k,v) -> if (collection != "profiles" || k != "apiProviderId") put(k,v) }
                                    put(if (collection == "sources") "text" else "instructions", instructions)
                                    if (collection == "sources") put("projectId", requireNotNull(selectedProject))
                                    if (collection == "projects") put("description", description)
                                    if (collection == "profiles") {
                                        put("sourceIds", JsonArray(sourceIds.map(::JsonPrimitive)))
                                        put("model", model.ifBlank { null }?.let(::JsonPrimitive) ?: JsonNull)
                                        if (provider.isNotEmpty()) put("apiProviderId", provider)
                                    }
                                }
                                val input = AssistantResourceInput(title.trim(), body, editing?.revision)
                                val response = editing?.let { api.updateAssistantResource(collection, it.id, input) } ?: api.createAssistantResource(collection, input)
                                checkOwner(); check(response.success) { response.error?.message.orEmpty() }
                                val saved = requireNotNull(response.data)
                                if (collection == "profiles") selectedProfile = saved.id
                                if (collection == "projects") selectedProject = saved.id
                                load(); editor = false
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message }
                            finally { busy = false }
                        }
                    }) { Text(stringResource(R.string.chat_workspace_save)) }
                    TextButton(enabled = !busy, onClick = { editor = false }) { Text(stringResource(R.string.chat_workspace_back)) }
                }
                editing?.let { resource ->
                    TextButton(enabled = !busy, onClick = {
                        scope.launch {
                            busy = true; error = null
                            try {
                                checkOwner(); val response = api.archiveAssistantResource(collection, resource.id, resource.revision)
                                checkOwner(); check(response.success) { response.error?.message.orEmpty() }
                                if (selectedProfile == resource.id) selectedProfile = null
                                if (selectedProject == resource.id) selectedProject = null
                                load(); editor = false
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message }
                            finally { busy = false }
                        }
                    }) { Text(stringResource(R.string.chat_workspace_archive)) }
                }
            } else {
                WorkspaceChoice(stringResource(R.string.chat_workspace_assistant), selectedProfile.orEmpty(), listOf("" to stringResource(R.string.chat_workspace_default)) + profiles.map { it.id to it.title }, !busy) { selectedProfile = it.ifBlank { null } }
                WorkspaceChoice(stringResource(R.string.chat_workspace_project), selectedProject.orEmpty(), listOf("" to stringResource(R.string.chat_workspace_no_project)) + projects.map { it.id to it.title }, !busy) { selectedProject = it.ifBlank { null } }
                Button(enabled = !busy, onClick = { onApply(profiles.firstOrNull { it.id == selectedProfile }, selectedProject) }) { Text(stringResource(R.string.chat_workspace_apply)) }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = { collection = "profiles" }, enabled = !busy) { Text(stringResource(R.string.chat_workspace_assistants)) }
                    TextButton(onClick = { collection = "projects" }, enabled = !busy) { Text(stringResource(R.string.chat_workspace_projects)) }
                    if (selectedProject != null) TextButton(onClick = { collection = "sources" }, enabled = !busy) { Text(stringResource(R.string.chat_workspace_sources)) }
                }
                Text(stringResource(when(collection) { "projects" -> R.string.chat_workspace_projects; "sources" -> R.string.chat_workspace_sources; else -> R.string.chat_workspace_assistants }), style = MaterialTheme.typography.titleMedium)
                OutlinedButton(enabled = !busy, onClick = { edit(null) }) { Text(stringResource(when(collection) { "projects" -> R.string.chat_workspace_new_project; "sources" -> R.string.chat_workspace_new_source; else -> R.string.chat_workspace_new_assistant })) }
                val resources = when(collection) { "projects" -> projects; "sources" -> sources.filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == selectedProject }; else -> profiles }
                if (resources.isEmpty() && !busy) Text(stringResource(R.string.chat_workspace_empty))
                resources.forEach { resource -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(resource.title, Modifier.weight(1f).padding(top = 12.dp))
                    TextButton(enabled = !busy, onClick = { edit(resource) }) { Text(stringResource(R.string.chat_workspace_edit)) }
                } }
                if (collection == "projects" && selectedProject != null) {
                    Text(stringResource(R.string.chat_workspace_conversations), style = MaterialTheme.typography.titleMedium)
                    val related = chats.filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == selectedProject }
                    if (related.isEmpty()) Text(stringResource(R.string.chat_workspace_empty_chats))
                    related.forEach { resource -> TextButton(enabled = !busy, onClick = { onChat(resource) }) { Text(resource.title) } }
                }
            }
        }
    }
}

@Composable
private fun WorkspaceChoice(label: String, value: String, options: List<Pair<String,String>>, enabled: Boolean, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        OutlinedButton(modifier = Modifier.fillMaxWidth(), enabled = enabled, onClick = { expanded = true }) { Text("$label: ${options.firstOrNull { it.first == value }?.second ?: value}") }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onSelect(id) }) }
        }
    }
}
