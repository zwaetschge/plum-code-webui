package com.claudewebui.app.ui.screens.library

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.koin.compose.koinInject

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun SkillFilesSheet(name: String, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val api = koinInject<ApiClient>()
    val owner = remember { TokenStore.assistantOwnerKey() } ?: return
    val scope = rememberCoroutineScope()
    var files by remember { mutableStateOf<List<String>>(emptyList()) }
    var selected by remember { mutableStateOf("SKILL.md") }
    var hash by remember { mutableStateOf<String?>(null) }
    var content by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf("") }
    var newPath by remember { mutableStateOf("") }
    var history by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var before by remember { mutableStateOf<String?>(null) }
    var readOnly by remember { mutableStateOf(true) }
    var creating by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun current() = owner == TokenStore.assistantOwnerKey()
    suspend fun refresh() {
        val response = api.getSkillFiles(name); check(current()); require(response.success) { response.error?.message ?: "Dateien nicht verfügbar" }
        files = (response.data?.get("files") as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
        readOnly = response.data?.get("readOnly")?.jsonPrimitive?.booleanOrNull != false
    }
    suspend fun load() {
        val response = api.getSkillFile(name, selected); check(current()); require(response.success) { response.error?.message ?: "Datei nicht verfügbar" }
        content = response.data?.get("content")?.jsonPrimitive?.content.orEmpty(); saved = content
        hash = response.data?.get("hash")?.jsonPrimitive?.content
        val versions = api.getSkillFileHistory(name, selected); check(current()); history = versions.data.orEmpty()
    }
    LaunchedEffect(owner, name, selected, creating) {
        busy = true; error = null; before = null
        try { refresh(); if (!creating) load() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (current()) error = failure.message }
        finally { if (current()) busy = false }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.92f).imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("$name · Dateien", style = MaterialTheme.typography.titleLarge)
            var menu by remember { mutableStateOf(false) }
            val dirty = creating || content != saved
            Box {
                OutlinedButton(onClick = { menu = true }, enabled = !busy && !dirty) { Text(selected) }
                DropdownMenu(menu, { menu = false }) { files.forEach { file -> DropdownMenuItem(text = { Text(file) }, onClick = { selected = file; creating = false; menu = false }) } }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(newPath, { newPath = it.take(240) }, label = { Text("Neue Skilldatei") }, modifier = Modifier.weight(1f), enabled = !busy && !dirty && !readOnly, singleLine = true)
                TextButton(enabled = !busy && !dirty && !readOnly && newPath.isNotBlank(), onClick = { selected = newPath; newPath = ""; hash = null; content = ""; saved = ""; history = emptyList(); creating = true }) { Text("Anlegen") }
            }
            if (readOnly) Text("Von Plum verwaltet · Schreibgeschützt")
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            OutlinedTextField(content, { content = it.take(500000) }, label = { Text("Dateiinhalt") }, minLines = 10, maxLines = 22, enabled = !busy && !readOnly, modifier = Modifier.fillMaxWidth(), textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy && !readOnly && dirty, onClick = { scope.launch {
                    busy = true; error = null
                    try {
                        check(current())
                        val response = api.writeSkillFile(owner, name, buildJsonObject { put("path", selected); put("expectedHash", hash?.let(::JsonPrimitive) ?: JsonNull); put("content", content) })
                        check(current()); require(response.success) { response.error?.message ?: "Speichern fehlgeschlagen" }
                        creating = false; load(); refresh(); onChanged()
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { if (current()) error = failure.message }
                    finally { if (current()) busy = false }
                } }) { Text("Datei speichern") }
                TextButton(enabled = !busy, onClick = { scope.launch {
                    busy = true
                    try { creating = false; refresh(); load(); error = null }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { if (current()) error = failure.message }
                    finally { if (current()) busy = false }
                } }) { Text("Neu laden") }
            }
            var versions by remember { mutableStateOf(false) }
            Box {
                TextButton(onClick = { versions = true }, enabled = !busy && history.isNotEmpty()) { Text("Versionsvergleich") }
                DropdownMenu(versions, { versions = false }) { history.forEach { version ->
                    DropdownMenuItem(text = { Text(version["createdAt"]?.jsonPrimitive?.content.orEmpty()) }, onClick = {
                        versions = false; scope.launch {
                            try { val response = api.getSkillFile(name, selected, version["hash"]?.jsonPrimitive?.content); check(current()); require(response.success); before = response.data?.get("content")?.jsonPrimitive?.content }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { if (current()) error = failure.message }
                        }
                    })
                } }
            }
            before?.let { Text("Vorher", style = MaterialTheme.typography.titleSmall); Text(it, fontFamily = FontFamily.Monospace); Text("Aktuell", style = MaterialTheme.typography.titleSmall); Text(content, fontFamily = FontFamily.Monospace) }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            TextButton(onClick = onDismiss) { Text("Schliessen") }
        }
    }
}
