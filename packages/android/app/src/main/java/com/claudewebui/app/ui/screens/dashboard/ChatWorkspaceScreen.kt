package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import com.claudewebui.app.ui.components.common.PlumContentWidth
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.theme.PlumGlassCard
import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
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
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ChatWorkspaceScreen(
    owner: String, api: ApiClient, providers: List<AssistantApiProvider>,
    initialProfile: String?, initialProject: String?,
    onApply: (AssistantResource?, String?) -> Unit,
    onNewChat: (AssistantResource?, String?) -> Unit,
    modifier: Modifier = Modifier,
    onChat: (AssistantResource) -> Unit,
    onDismiss: () -> Unit,
    initialCollection: String? = null,
) {
    val palette = PlumTheme.palette
    val tokens = PlumTheme.tokens
    val scope = rememberCoroutineScope()
    var profiles by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var projects by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var sources by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var chats by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var selectedProfile by remember { mutableStateOf(initialProfile) }
    var selectedProject by remember { mutableStateOf(initialProject) }
    var collection by remember { mutableStateOf(initialCollection ?: if (initialProject != null) "projects" else if (initialProfile != null) "profiles" else "projects") }
    var viewedId by remember { mutableStateOf(if (initialCollection != null) null else initialProject ?: initialProfile) }
    var editing by remember { mutableStateOf<AssistantResource?>(null) }
    var editor by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var memoryMode by remember { mutableStateOf("default") }
    var expertMemory by remember { mutableStateOf("off") }
    var includeGlobalChatInstructions by remember { mutableStateOf(true) }
    var provider by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var sourceIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmProject by remember { mutableStateOf<AssistantResource?>(null) }
    var confirmChat by remember { mutableStateOf<AssistantResource?>(null) }
    var capabilityProfile by remember { mutableStateOf<AssistantResource?>(null) }
    var compareResource by remember { mutableStateOf<AssistantResource?>(null) }
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
        // Legacy hand-written expert notes are folded into the instructions on the next save.
        resource?.body?.get("sharedMemories")?.jsonPrimitive?.contentOrNull?.takeIf { collection == "profiles" && it.isNotBlank() }
            ?.let { instructions = listOf(instructions, it).filter(String::isNotBlank).joinToString("\n\nNotizen:\n") }
        description = resource?.body?.get("description")?.jsonPrimitive?.contentOrNull.orEmpty()
        memoryMode = projectMemoryMode(resource?.body)
        expertMemory = resource?.body?.get("memory")?.jsonPrimitive?.contentOrNull ?: "off"
        includeGlobalChatInstructions = resource?.body?.get("includeGlobalChatInstructions")?.jsonPrimitive?.booleanOrNull != false
        provider = resource?.body?.get("apiProviderId")?.jsonPrimitive?.contentOrNull.orEmpty()
        model = resource?.body?.get("model")?.jsonPrimitive?.contentOrNull.orEmpty()
        sourceIds = (resource?.body?.get("sourceIds") as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
    }
    fun goBack() {
        if (busy) return
        error = null
        when {
            editor -> editor = false
            collection == "sources" -> { collection = "projects"; viewedId = selectedProject }
            viewedId != null -> viewedId = null
            else -> onDismiss()
        }
    }
    BackHandler { goBack() }
    fun remove(action: suspend () -> com.claudewebui.app.data.model.ApiResponse<*>, done: () -> Unit) {
        scope.launch {
            busy = true; error = null
            try {
                checkOwner(); val response = action()
                checkOwner(); check(response.success) { response.error?.message.orEmpty() }
                done(); load()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { busy = false; confirmProject = null; confirmChat = null }
        }
    }
    confirmProject?.let { project ->
        val count = chats.count { it.body["projectId"]?.jsonPrimitive?.contentOrNull == project.id }
        AlertDialog(
            onDismissRequest = { if (!busy) confirmProject = null },
            title = { Text(stringResource(R.string.chat_workspace_delete_project_title)) },
            text = { Text(stringResource(R.string.chat_workspace_delete_project_text, project.title, count)) },
            confirmButton = {
                TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = {
                    remove({ api.deleteAssistantProject(project.id) }) {
                        if (selectedProject == project.id) selectedProject = null
                        if (viewedId == project.id) viewedId = null
                        editor = false
                    }
                }) { Text(stringResource(R.string.assistant_delete_chat), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { confirmProject = null }) { Text(stringResource(R.string.assistant_cancel)) } },
        )
    }
    confirmChat?.let { chat ->
        AlertDialog(
            onDismissRequest = { if (!busy) confirmChat = null },
            title = { Text(stringResource(R.string.assistant_delete_chat_title)) },
            text = { Text(stringResource(R.string.assistant_delete_chat_text, chat.title)) },
            confirmButton = {
                TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { remove({ api.deleteAssistantApiChat(chat.id) }) {} }) {
                    Text(stringResource(R.string.assistant_delete_chat), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { confirmChat = null }) { Text(stringResource(R.string.assistant_cancel)) } },
        )
    }
    capabilityProfile?.let { profile -> ChatWorkbenchSheet(owner, api, profile, providers, profile.body["chatOptions"] as? JsonObject ?: JsonObject(emptyMap()), onSaved = { _, resource -> resource?.let { updated -> profiles = profiles.map { if (it.id == updated.id) updated else it } } }, onImported = {}, onDismiss = { capabilityProfile = null }) }
    compareResource?.let { resource -> ResourceRevisionDiff(owner, api, if (resource.kind == "project") "projects" else "profiles", resource.id, resource.revision) { compareResource = null } }
    val viewed = (if (collection == "projects") projects else profiles).firstOrNull { it.id == viewedId }
    val newLabel = stringResource(when (collection) {
        "projects" -> R.string.chat_workspace_new_project
        "sources" -> R.string.chat_workspace_new_source
        else -> R.string.chat_workspace_new_assistant
    })
    val heading = if (editor) editing?.title ?: newLabel else if (collection == "sources") stringResource(R.string.chat_workspace_sources)
        else viewed?.title ?: stringResource(if (collection == "projects") R.string.chat_workspace_projects else R.string.chat_workspace_assistants)
    CompositionLocalProvider(LocalContentColor provides palette.text) {
        Box(modifier.fillMaxSize()) {
            PlumContentWidth(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = tokens.spacing.screenHorizontal), max = 840.dp) {
                Column(Modifier.fillMaxWidth().padding(top = tokens.spacing.lg, bottom = tokens.spacing.xxl), verticalArrangement = Arrangement.spacedBy(tokens.spacing.lg)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(tokens.spacing.md), verticalAlignment = Alignment.CenterVertically) {
                        PlumIconButton(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.chat_workspace_back), { goBack() })
                        Text(heading, Modifier.weight(1f), style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (!editor && (viewed == null || collection == "sources")) FilledTonalIconButton(enabled = !busy, onClick = { edit(null) }, modifier = Modifier.size(tokens.sizing.touchTarget)) {
                            Icon(Icons.Outlined.Add, newLabel)
                        }
                    }
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    if (editor) {
                        PlumGlassCard(Modifier.fillMaxWidth(), shape = tokens.radius.panelShape, contentPadding = tokens.spacing.section) {
                            Column(verticalArrangement = Arrangement.spacedBy(tokens.spacing.lg)) {
                                WorkspaceField(title, { title = it.take(200) }, label = stringResource(R.string.chat_workspace_name), enabled = !busy, modifier = Modifier.fillMaxWidth())
                                if (collection == "projects") WorkspaceField(description, { description = it.take(30000) }, label = stringResource(R.string.chat_workspace_project_description), enabled = !busy, modifier = Modifier.fillMaxWidth())
                                if (collection == "projects") {
                                    Text(stringResource(R.string.chat_workspace_memory), style = MaterialTheme.typography.titleSmall)
                                    listOf(
                                    Triple("default", R.string.chat_workspace_memory_default, R.string.chat_workspace_memory_default_hint),
                                    Triple("project-only", R.string.chat_workspace_memory_project, R.string.chat_workspace_memory_project_hint),
                                    ).forEach { (value, label, hint) -> MemoryOption(memoryMode == value, stringResource(label), stringResource(hint), !busy) { memoryMode = value } }
                                }
                                WorkspaceField(instructions, { instructions = it.take(if (collection == "sources") 50000 else 30000) }, label = stringResource(if (collection == "sources") R.string.chat_workspace_source_text else R.string.chat_workspace_instructions), minLines = 4, enabled = !busy, modifier = Modifier.fillMaxWidth())
                                if (collection != "sources") Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(checked = includeGlobalChatInstructions, enabled = !busy, onCheckedChange = { includeGlobalChatInstructions = it })
                                    Text("Globale Chat-Anweisungen übernehmen", Modifier.weight(1f))
                                }
                                if (collection == "profiles") {
                                    Text(stringResource(R.string.chat_workspace_memory), style = MaterialTheme.typography.titleSmall)
                                    listOf(
                                    Triple("off", R.string.chat_workspace_expert_memory_off, R.string.chat_workspace_expert_memory_off_hint),
                                    Triple("read", R.string.chat_workspace_expert_memory_read, R.string.chat_workspace_expert_memory_read_hint),
                                    Triple("read-write", R.string.chat_workspace_expert_memory_learn, R.string.chat_workspace_expert_memory_learn_hint),
                                    ).forEach { (value, label, hint) -> MemoryOption(expertMemory == value, stringResource(label), stringResource(hint), !busy) { expertMemory = value } }
                                    WorkspaceChoice(stringResource(R.string.chat_workspace_provider), provider, listOf("" to stringResource(R.string.chat_workspace_keep_model)) + providers.map { it.id to it.name }, !busy) { provider = it; model = "" }
                                    if (provider.isNotEmpty()) WorkspaceChoice(stringResource(R.string.chat_workspace_model), model, listOf("" to stringResource(R.string.chat_workspace_default)) + providers.firstOrNull { it.id == provider }?.models.orEmpty().map { it to it }, !busy) { model = it }
                                    Text(stringResource(R.string.chat_workspace_knowledge), style = MaterialTheme.typography.titleSmall)
                                    sources.forEach { source ->
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Checkbox(source.id in sourceIds, enabled = !busy && (source.id in sourceIds || sourceIds.size < 20), onCheckedChange = { checked -> sourceIds = if (checked) sourceIds + source.id else sourceIds - source.id })
                                            Text(source.title, Modifier.weight(1f).padding(top = 12.dp))
                                        }
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(modifier = Modifier.heightIn(min = tokens.sizing.touchTarget), enabled = !busy && title.isNotBlank() && (collection != "sources" || instructions.isNotBlank()), onClick = {
                                        scope.launch {
                                            busy = true; error = null
                                            try {
                                                checkOwner()
                                                val body = buildJsonObject {
                                                    editing?.body?.forEach { (k,v) -> if ((collection != "profiles" || k !in setOf("apiProviderId", "sharedMemories")) && (collection != "projects" || k != "contextMode")) put(k,v) }
                                                    put(if (collection == "sources") "text" else "instructions", instructions)
                                                    if (collection != "sources") put("includeGlobalChatInstructions", includeGlobalChatInstructions)
                                                    if (collection == "sources") put("projectId", requireNotNull(selectedProject))
                                                    if (collection == "projects") { put("description", description); put("memoryMode", memoryMode) }
                                                    if (collection == "profiles") {
                                                        put("memory", expertMemory)
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
                                                if (collection != "sources") viewedId = saved.id
                                            } catch (cancelled: CancellationException) { throw cancelled }
                                            catch (failure: Exception) { error = failure.message }
                                            finally { busy = false }
                                        }
                                    }) { Text(stringResource(R.string.chat_workspace_save)) }
                                    TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { editor = false }) { Text(stringResource(R.string.chat_workspace_back)) }
                                }
                                if (collection == "projects") editing?.let { resource ->
                                    TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { confirmProject = resource }) {
                                        Text(stringResource(R.string.chat_workspace_delete_project), color = MaterialTheme.colorScheme.error)
                                    }
                                }
                                if (collection != "projects") editing?.let { resource ->
                                    TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = {
                                        scope.launch {
                                            busy = true; error = null
                                            try {
                                                checkOwner(); val response = api.archiveAssistantResource(collection, resource.id, resource.revision)
                                                checkOwner(); check(response.success) { response.error?.message.orEmpty() }
                                                if (selectedProfile == resource.id) selectedProfile = null
                                                if (selectedProject == resource.id) selectedProject = null
                                                if (viewedId == resource.id) viewedId = null
                                                load(); editor = false
                                            } catch (cancelled: CancellationException) { throw cancelled }
                                            catch (failure: Exception) { error = failure.message }
                                            finally { busy = false }
                                        }
                                    }) { Text(stringResource(R.string.chat_workspace_archive)) }
                                }
                            }
                        }
                    } else {
                        if (collection == "sources") {
                            Text(projects.firstOrNull { it.id == selectedProject }?.title.orEmpty(), style = MaterialTheme.typography.headlineSmall)
                            val projectSources = sources.filter { it.body["projectId"]?.jsonPrimitive?.contentOrNull == selectedProject }
                            if (projectSources.isEmpty() && !busy) Text(stringResource(R.string.chat_workspace_empty))
                            projectSources.forEach { resource ->
                                WorkspaceResourceRow(resource.title, resource.body["text"]?.jsonPrimitive?.contentOrNull.orEmpty(), Icons.Outlined.FolderOpen, !busy) { edit(resource) }
                            }
                        } else if (viewed == null) {
                            val resources = if (collection == "projects") projects else profiles
                            if (resources.isEmpty() && !busy) PlumGlassCard(Modifier.fillMaxWidth()) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(tokens.spacing.md)) {
                                    WorkspaceIcon(if (collection == "projects") Icons.Outlined.FolderOpen else Icons.Outlined.SmartToy)
                                    Text(stringResource(R.string.chat_workspace_empty), color = palette.muted)
                                }
                            }
                            resources.forEach { resource ->
                                WorkspaceResourceRow(resource.title, resource.body[if (collection == "projects") "description" else "instructions"]?.jsonPrimitive?.contentOrNull.orEmpty(), if (collection == "projects") Icons.Outlined.FolderOpen else Icons.Outlined.SmartToy, !busy) {
                                    viewedId = resource.id
                                    if (collection == "projects") selectedProject = resource.id else selectedProfile = resource.id
                                }
                            }
                        } else {
                            val isProject = collection == "projects"
                            PlumGlassCard(Modifier.fillMaxWidth(), shape = tokens.radius.panelShape, contentPadding = tokens.spacing.section) {
                                Column(verticalArrangement = Arrangement.spacedBy(tokens.spacing.lg)) {
                                    if (isProject) {
                                        val sealed = projectMemoryMode(viewed.body) == "project-only"
                                        Text(stringResource(if (sealed) R.string.chat_workspace_memory_project else R.string.chat_workspace_memory_default), style = MaterialTheme.typography.titleSmall)
                                        viewed.body["description"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }?.let { Text(it) }
                                        WorkspaceChoice(stringResource(R.string.chat_workspace_assistant), selectedProfile.orEmpty(), listOf("" to stringResource(R.string.chat_workspace_all_experts)) + profiles.map { it.id to it.title }, !busy) { selectedProfile = it.ifBlank { null } }
                                    } else {
                                        Text(viewed.body["instructions"]?.jsonPrimitive?.contentOrNull.orEmpty(), maxLines = 4)
                                        WorkspaceChoice(stringResource(R.string.chat_workspace_project), selectedProject.orEmpty(), listOf("" to stringResource(R.string.chat_workspace_no_project)) + projects.map { it.id to it.title }, !busy) { selectedProject = it.ifBlank { null } }
                                    }
                                    Button(modifier = Modifier.heightIn(min = tokens.sizing.touchTarget), enabled = !busy, onClick = { onNewChat(profiles.firstOrNull { it.id == selectedProfile }, selectedProject) }) { Text(stringResource(R.string.chat_workspace_new_chat)) }
                                    TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { onApply(profiles.firstOrNull { it.id == selectedProfile }, selectedProject) }) { Text(stringResource(R.string.chat_workspace_apply)) }
                                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { edit(viewed) }) { Text(stringResource(R.string.chat_workspace_edit)) }
                                        if (!isProject) TextButton(enabled = !busy, onClick = { capabilityProfile = viewed }) { Text("Fähigkeiten") }
                                        TextButton(enabled = !busy, onClick = { compareResource = viewed }) { Text("Änderungen") }
                                        if (isProject) TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { collection = "sources" }) { Text(stringResource(R.string.chat_workspace_sources)) }
                                        if (isProject) TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { confirmProject = viewed }) {
                                            Text(stringResource(R.string.chat_workspace_delete_project), color = MaterialTheme.colorScheme.error)
                                        }
                                    }
                                }
                            }
                            Text(stringResource(R.string.chat_workspace_conversations), style = MaterialTheme.typography.titleMedium)
                            val related = chats.filter { resource ->
                                (if (isProject) resource.body["projectId"]?.jsonPrimitive?.contentOrNull == viewed.id else resource.body["profileId"]?.jsonPrimitive?.contentOrNull == viewed.id) &&
                                (!isProject || selectedProfile == null || resource.body["profileId"]?.jsonPrimitive?.contentOrNull == selectedProfile) &&
                                (isProject || selectedProject == null || resource.body["projectId"]?.jsonPrimitive?.contentOrNull == selectedProject)
                            }
                            if (related.isEmpty() && !busy) Text(stringResource(R.string.chat_workspace_empty_chats))
                            related.forEach { resource ->
                                Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    TextButton(colors = ButtonDefaults.textButtonColors(contentColor = palette.text), enabled = !busy, onClick = { onChat(resource) }, modifier = Modifier.weight(1f).heightIn(min = tokens.sizing.touchTarget)) {
                                        Text(resource.title, Modifier.fillMaxWidth(), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    }
                                    IconButton(enabled = !busy, onClick = { confirmChat = resource }) {
                                        Icon(Icons.Outlined.Delete, stringResource(R.string.assistant_delete_chat))
                                    }
                                }
                            }
                        }

                    }
                }
            }
        }
    }
}

@Composable
private fun WorkspaceIcon(icon: ImageVector) {
    val tokens = PlumTheme.tokens
    Box(Modifier.size(tokens.sizing.touchTarget).background(PlumTheme.palette.accent.copy(alpha = .12f), tokens.radius.rowShape), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = PlumTheme.palette.accent, modifier = Modifier.size(tokens.sizing.iconLg))
    }
}

@Composable
private fun WorkspaceResourceRow(title: String, description: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    val tokens = PlumTheme.tokens
    PlumGlassCard(Modifier.fillMaxWidth(), shape = tokens.radius.panelShape, onClick = if (enabled) onClick else null) {
        Row(horizontalArrangement = Arrangement.spacedBy(tokens.spacing.md), verticalAlignment = Alignment.CenterVertically) {
            WorkspaceIcon(icon)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(tokens.spacing.xs)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (description.isNotBlank()) Text(description, style = MaterialTheme.typography.bodyMedium, color = PlumTheme.palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = PlumTheme.palette.muted)
        }
    }
}

@Composable
private fun WorkspaceField(value: String, onValueChange: (String) -> Unit, label: String, enabled: Boolean, modifier: Modifier = Modifier, minLines: Int = 1) {
    val palette = PlumTheme.palette
    OutlinedTextField(value, onValueChange, label = { Text(label) }, enabled = enabled, modifier = modifier, minLines = minLines,
        shape = PlumTheme.tokens.radius.cardShape,
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = palette.accent, unfocusedBorderColor = palette.borderSoft, focusedContainerColor = palette.controlSurface, unfocusedContainerColor = palette.controlSurface, focusedTextColor = palette.text, unfocusedTextColor = palette.text))
}

@Composable
private fun WorkspaceChoice(label: String, value: String, options: List<Pair<String,String>>, enabled: Boolean, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val palette = PlumTheme.palette
    val tokens = PlumTheme.tokens
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = palette.muted)
        Box {
            Surface(onClick = { expanded = true }, enabled = enabled, color = palette.controlSurface, contentColor = palette.text, shape = tokens.radius.cardShape, border = androidx.compose.foundation.BorderStroke(tokens.border.hairline, palette.borderSoft)) {
                Row(Modifier.fillMaxWidth().heightIn(min = tokens.sizing.touchTarget).padding(horizontal = tokens.spacing.lg, vertical = tokens.spacing.md), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
                    Text(options.firstOrNull { it.first == value }?.second ?: value, Modifier.weight(1f))
                    Icon(Icons.Outlined.ExpandMore, null)
                }
            }
            DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
                options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onSelect(id) }) }
            }
        }
    }
}

/** ChatGPT project memory; legacy `contextMode: separate` projects read as project-only. */
internal fun projectMemoryMode(body: Map<String, kotlinx.serialization.json.JsonElement>?): String =
    when (val mode = body?.get("memoryMode")?.jsonPrimitive?.contentOrNull) {
        "default", "project-only" -> mode
        else -> if (body?.get("contextMode")?.jsonPrimitive?.contentOrNull == "separate") "project-only" else "default"
    }

@Composable
private fun MemoryOption(selected: Boolean, label: String, hint: String, enabled: Boolean, onSelect: () -> Unit) {
    val palette = PlumTheme.palette
    val tokens = PlumTheme.tokens
    Row(Modifier.fillMaxWidth().background(if (selected) palette.accent.copy(alpha = .10f) else palette.controlSurface, tokens.radius.cardShape).border(tokens.border.hairline, if (selected) palette.accent.copy(alpha = .45f) else palette.borderSoft, tokens.radius.cardShape).selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect).heightIn(min = tokens.sizing.touchTarget).padding(tokens.spacing.md), horizontalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
        RadioButton(selected, onClick = null, enabled = enabled)
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = palette.muted)
        }
    }
}
