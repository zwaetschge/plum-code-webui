package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ResourceRevisionDiff(owner: String, api: ApiClient, collection: String, id: String, revision: Long, onDismiss: () -> Unit) {
    var from by remember { mutableStateOf(maxOf(1L, revision - 1).toString()) }
    var to by remember { mutableStateOf(revision.toString()) }
    var lines by remember { mutableStateOf<JsonArray?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(owner, id, from, to) {
        val a = from.toLongOrNull(); val b = to.toLongOrNull()
        if (a == null || b == null || a !in 1..revision || b !in 1..revision) return@LaunchedEffect
        busy = true; error = null
        try {
            val response = api.getResourceRevisionDiff(collection, id, a, b)
            check(TokenStore.assistantOwnerKey() == owner)
            require(response.success) { response.error?.message ?: "Änderungen konnten nicht geladen werden" }
            lines = response.data?.get("lines") as? JsonArray
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (TokenStore.assistantOwnerKey() == owner) error = failure.message }
        finally { busy = false }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Revisionen vergleichen", style = MaterialTheme.typography.headlineSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(from, { from = it.filter(Char::isDigit) }, label = { Text("Vorher") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(to, { to = it.filter(Char::isDigit) }, label = { Text("Nachher") }, modifier = Modifier.weight(1f), singleLine = true)
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            lines?.forEach { value ->
                val line = value.jsonObject
                val kind = line["type"]?.jsonPrimitive?.contentOrNull
                val prefix = when (kind) { "added" -> "+ "; "removed" -> "− "; else -> "  " }
                Text(prefix + line["text"]?.jsonPrimitive?.contentOrNull.orEmpty(), color = when (kind) { "added" -> MaterialTheme.colorScheme.primary; "removed" -> MaterialTheme.colorScheme.error; else -> MaterialTheme.colorScheme.onSurfaceVariant }, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
