package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Hub
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.data.model.*
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import org.koin.compose.koinInject
import java.util.UUID

/** Round floating header control shared by the Chat / Task / Code areas. */
@Composable
internal fun PlumRoundButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
    tint: androidx.compose.ui.graphics.Color = PlumTheme.palette.text,
) {
    val palette = PlumTheme.palette
    val source = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.9f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "round_button_press",
    )
    Box(
        modifier = Modifier
            .size(44.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape)
            .background(palette.controlSurface)
            .border(1.dp, palette.border.copy(alpha = .7f), CircleShape)
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, description, tint = tint, modifier = Modifier.size(22.dp)) }
}

/**
 * ChatGPT-style area header: a round control on each side and a segmented
 * Chat / Task / Code pill whose indicator glides between the segments.
 */
@Composable
fun PlumAreaSelector(
    area: String,
    onSelect: (String) -> Unit,
    onPersonalize: (() -> Unit)? = null,
    onNavigation: (() -> Unit)? = null,
    trailingIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    trailingLabel: String? = null,
    onTrailing: (() -> Unit)? = null,
) {
    val palette = PlumTheme.palette
    val tabs = listOf("chat" to R.string.assistant_tab_chat, "task" to R.string.assistant_tab_task, "code" to R.string.assistant_tab_code, "swarm" to R.string.assistant_swarm)
    val index = tabs.indexOfFirst { it.first == area }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (onNavigation != null) PlumRoundButton(Icons.Outlined.Menu, stringResource(R.string.assistant_navigation), onNavigation)
        BoxWithConstraints(
            Modifier.weight(1f).height(44.dp).clip(CircleShape)
                .background(palette.segmentTrack).border(1.dp, palette.border.copy(alpha = .7f), CircleShape),
        ) {
            val segment = maxWidth / tabs.size
            val indicatorX by animateDpAsState(segment * index.coerceAtLeast(0), spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow), label = "area_indicator")
            if (index >= 0) Box(Modifier.offset(x = indicatorX).width(segment).fillMaxHeight().padding(3.dp).clip(CircleShape).background(palette.segmentSelected))
            Row(Modifier.fillMaxSize()) {
                tabs.forEach { (id, resource) ->
                    val label = stringResource(resource)
                    val active = area == id
                    val color by animateColorAsState(if (active) palette.onSegmentSelected else palette.muted, tween(180), label = "area_label")
                    Box(
                        Modifier.weight(1f).fillMaxHeight().clip(CircleShape)
                            .semantics { selected = active; role = Role.Tab; contentDescription = label }
                            .clickable(onClick = { onSelect(id) }),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, color = color, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false) }
                }
            }
        }
        when {
            onTrailing != null && trailingIcon != null -> PlumRoundButton(trailingIcon, trailingLabel.orEmpty(), onTrailing)
            onPersonalize != null -> PlumRoundButton(Icons.Outlined.Tune, stringResource(R.string.assistant_personalization), onPersonalize)
            else -> Unit
        }
    }
}

@Composable
fun AssistantWorkspace(onAreaSelect: (String) -> Unit, onNavigateToChat: (String) -> Unit, api: ApiClient = koinInject()) {
    val tokens = PlumTheme.tokens
    val scope = rememberCoroutineScope()
    var collection by remember { mutableStateOf("tasks") }
    var resources by remember { mutableStateOf<List<AssistantResource>>(emptyList()) }
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var provider by remember { mutableStateOf(CLIProvider.CODEX) }
    LaunchedEffect(collection, refresh) {
        error = null
        busy = true
        try {
            apiCall { api.getAssistantResources(collection) }.onSuccess { result ->
                if (result.success) resources = result.data.orEmpty() else error = result.error?.message
            }.onFailure { error = it.message }
        } finally { busy = false }
    }
    fun command(resource: AssistantResource, action: String) {
        scope.launch {
            busy = true
            try {
                apiCall { api.sendAssistantTaskCommand(resource.id, AssistantTaskCommand(UUID.randomUUID().toString(), resource.revision, action)) }
                    .onSuccess { result -> if (result.success) refresh++ else error = result.error?.message }
                    .onFailure { error = it.message }
            } finally { busy = false }
        }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
    PlumAreaSelector("task", onAreaSelect)
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(tokens.spacing.cozy)) {
        item { LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(listOf("tasks" to R.string.assistant_task, "profiles" to R.string.assistant_profiles, "memory" to R.string.assistant_memory, "artifacts" to R.string.assistant_artifacts)) { (id,label) ->
                FilterChip(selected = collection == id, onClick = { collection = id; creating = false }, label = { Text(stringResource(label)) })
            }
        } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { creating = !creating }, enabled = !busy) { Text(stringResource(R.string.assistant_new)) }
            OutlinedButton(onClick = { refresh++ }, enabled = !busy) { Text(stringResource(R.string.assistant_refresh)) }
        } }
        error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (creating) item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text(stringResource(R.string.assistant_name)) }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = content, onValueChange = { content = it }, label = { Text(stringResource(R.string.assistant_content)) }, modifier = Modifier.fillMaxWidth(), minLines = 4)
                if (collection == "tasks" || collection == "profiles") {
                    Text(stringResource(R.string.assistant_provider))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { items(CLIProvider.active) { option -> FilterChip(selected = provider == option, onClick = { provider = option }, label = { Text(option.displayName) }) } }
                }
                Button(enabled = !busy && title.isNotBlank() && content.isNotBlank(), onClick = {
                    val requestCollection = collection
                    val body = buildJsonObject {
                        when (requestCollection) {
                            "tasks" -> { put("goal", content); put("provider", provider.name.lowercase()) }
                            "profiles" -> { put("instructions", content); put("provider", provider.name.lowercase()); put("voice", "Rufus Beck") }
                            "memory" -> { put("text", content); put("scope", "personal") }
                            else -> { put("content", content); put("type", "document"); put("format", "markdown") }
                        }
                    }
                    scope.launch {
                        busy = true
                        try {
                            apiCall { api.createAssistantResource(requestCollection, AssistantResourceInput(title.trim(), body)) }
                                .onSuccess { result -> if (result.success) { creating = false; title = ""; content = ""; refresh++ } else error = result.error?.message }
                                .onFailure { error = it.message }
                        } finally { busy = false }
                    }
                }) { Text(stringResource(R.string.assistant_save)) }
            }
        }
        if (!busy && resources.isEmpty()) item { Text(stringResource(R.string.assistant_empty)) }
        items(resources, key = { it.id }) { resource ->
            com.claudewebui.app.ui.theme.PlumGlassCard(Modifier.fillMaxWidth(), shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp), contentPadding = 16.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(resource.title, style = MaterialTheme.typography.titleMedium)
                    val state = resource.body["status"]?.jsonPrimitive?.content
                    state?.let { Text(stringResource(when(it) {
                        "draft" -> R.string.assistant_draft; "queued" -> R.string.assistant_queued; "running" -> R.string.assistant_running
                        "waiting_input" -> R.string.assistant_waiting_input; "completed" -> R.string.assistant_completed; "failed" -> R.string.assistant_failed
                        "cancelled" -> R.string.assistant_cancelled; else -> R.string.assistant_interrupted
                    })) }
                    Text((resource.body["result"] ?: resource.body["goal"] ?: resource.body["text"] ?: resource.body["content"] ?: resource.body["instructions"])?.jsonPrimitive?.content.orEmpty())
                    resource.body["sessionId"]?.jsonPrimitive?.content?.let { sessionId -> TextButton(onClick = { onNavigateToChat(sessionId) }) { Text(stringResource(R.string.assistant_open_chat)) } }
                    if (resource.kind == "task") {
                        AssistantTaskResults(resource, api) { changed -> resources = resources.map { if (it.id == changed.id && changed.revision >= it.revision) changed else it }; refresh++ }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state in listOf("draft", "failed", "interrupted", "cancelled", "completed")) Button(enabled = !busy, onClick = { command(resource, if (state == "draft") "submit" else "retry") }) { Text(stringResource(if (state == "draft") R.string.assistant_start else R.string.assistant_retry)) }
                            if (state == "waiting_input" && resource.body["nativeTaskId"] == null && resource.body["agentId"]?.jsonPrimitive?.content?.startsWith("matrix:") != true) Button(enabled = !busy && assistantTaskResultsReviewed(resource), onClick = { command(resource, "complete") }) { Text(stringResource(R.string.assistant_accept)) }
                            if (state in listOf("draft", "queued", "running", "waiting_input", "interrupted")) OutlinedButton(enabled = !busy, onClick = { command(resource, "cancel") }) { Text(stringResource(R.string.assistant_cancel)) }
                        }
                    }
                }
            }
        }
    }
    }
}
