package com.claudewebui.app.ui.screens.dashboard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.AssistantApiOutbox
import com.claudewebui.app.data.model.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

fun assistantTaskResultsReviewed(task: AssistantResource): Boolean {
    val labels = task.body["deliverables"]?.jsonArray.orEmpty()
    if (labels.isEmpty()) return true
    val reviews = task.body["deliverableReviews"]?.jsonArray.orEmpty()
    return task.body["deliverableReviewedBy"]?.jsonPrimitive?.content == TokenStore.getUserId() && reviews.size == labels.size &&
        reviews.mapNotNull { it.jsonObject["index"]?.jsonPrimitive?.intOrNull }.toSet().size == labels.size &&
        reviews.all { item -> val review = item.jsonObject; val index = review["index"]?.jsonPrimitive?.intOrNull; index != null && index in labels.indices && review["label"] == labels[index] }
}

@Composable
fun AssistantTaskResults(task: AssistantResource, api: ApiClient, onChanged: (AssistantResource) -> Unit) {
    val owner = TokenStore.assistantOwnerKey() ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val outbox = remember(owner) { AssistantApiOutbox(api, owner) }
    var open by remember(task.id) { mutableStateOf(false) }
    var candidates by remember(task.id, task.revision, owner) { mutableStateOf<List<AssistantTaskResultCandidate>>(emptyList()) }
    var choices by remember(task.id, task.revision, owner) { mutableStateOf<Map<Int, AssistantTaskResultCandidate>>(emptyMap()) }
    var pending by remember(owner) { mutableStateOf(emptyList<com.claudewebui.app.data.AssistantPendingCommand>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val labels = task.body["deliverables"]?.jsonArray.orEmpty().map { it.jsonPrimitive.content }
    val path = "/api/assistant/tasks/${task.id}/results"
    fun checkOwner() { if (TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed") }
    fun accept(data: JsonObject) { checkOwner(); onChanged(Json { ignoreUnknownKeys = true }.decodeFromJsonElement<AssistantResource>(data)) }
    fun view(id: String, revision: Long) {
        checkOwner()
        val server = TokenStore.getServerUrl()?.trimEnd('/') ?: return
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$server/assistant/artifacts?resource=$id&revision=$revision")))
    }
    LaunchedEffect(open, task.id, task.revision, owner) {
        if (!open) return@LaunchedEffect
        busy = true; error = null
        try {
            val response = api.getAssistantTaskResults(task.id); checkOwner()
            check(response.success) { response.error?.message ?: "Results unavailable" }
            candidates = response.data.orEmpty()
            pending = outbox.pending().filter { it.path == path }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkOwner(); error = failure.message }
        finally { if (TokenStore.assistantOwnerKey() == owner) busy = false }
    }
    TextButton(onClick = { open = !open }) { Text(stringResource(R.string.assistant_task_results)) }
    if (open) Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        candidates.forEach { file -> TextButton(onClick = { view(file.id, file.revision) }) { Text("${file.title} · ${file.revision}") } }
        if (candidates.isEmpty() && !busy) Text(stringResource(R.string.assistant_task_results_empty))
        val editable = task.body["status"]?.jsonPrimitive?.content == "waiting_input" && task.body["agentId"]?.jsonPrimitive?.content?.startsWith("matrix:") != true
        if (editable && labels.isNotEmpty()) {
            Text(stringResource(R.string.assistant_task_results_hint))
            labels.forEachIndexed { index, label ->
                var expanded by remember(task.id, index) { mutableStateOf(false) }
                Text(label, style = MaterialTheme.typography.labelLarge)
                Box { OutlinedButton(onClick = { expanded = true }, enabled = !busy && pending.isEmpty()) { Text(choices[index]?.title ?: stringResource(R.string.assistant_task_result_choose)) }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        candidates.forEach { file -> DropdownMenuItem(text = { Text("${file.title} · ${file.revision}") }, onClick = { choices = choices + (index to file); expanded = false }) }
                    }
                }
            }
            Button(enabled = !busy && pending.isEmpty() && choices.size == labels.size, onClick = {
                scope.launch {
                    busy = true; error = null
                    try {
                        val body = buildJsonObject { put("expectedRevision", task.revision); put("items", buildJsonArray { labels.indices.forEach { index -> val file = choices.getValue(index); add(buildJsonObject { put("index", index); put("artifactId", file.id); put("revision", file.revision) }) } }) }
                        accept(outbox.send(path, body, context.getString(R.string.assistant_task_results_save)))
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { checkOwner(); error = failure.message }
                    finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; pending = outbox.pending().filter { it.path == path } } }
                }
            }) { Text(stringResource(R.string.assistant_task_results_save)) }
        }
        pending.forEach { command ->
            Text(stringResource(R.string.assistant_task_results_unconfirmed))
            OutlinedButton(enabled = !busy, onClick = { scope.launch {
                busy = true; error = null
                try { accept(outbox.retry(command.id)) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { checkOwner(); error = failure.message }
                finally { if (TokenStore.assistantOwnerKey() == owner) { busy = false; pending = outbox.pending().filter { it.path == path } } }
            } }) { Text(stringResource(R.string.assistant_retry_delivery)) }
        }
        if (assistantTaskResultsReviewed(task) && labels.isNotEmpty()) Text(stringResource(R.string.assistant_task_results_reviewed))
    }
}
