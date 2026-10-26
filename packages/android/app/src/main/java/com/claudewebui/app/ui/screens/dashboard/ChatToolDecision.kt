package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantChatToolEvent
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun ChatToolDecision(owner: String, api: ApiClient, chatId: String, turnId: String, event: AssistantChatToolEvent) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun decide(decision: String) {
        scope.launch {
            busy = true; error = null
            try {
                check(TokenStore.assistantOwnerKey() == owner)
                val response = api.decideChatTool(owner, chatId, turnId, event.id, decision)
                check(TokenStore.assistantOwnerKey() == owner)
                require(response.success) { response.error?.message ?: "Entscheidung fehlgeschlagen" }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (TokenStore.assistantOwnerKey() == owner) error = failure.message }
            finally { busy = false }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Genehmigung erforderlich · ${event.name}", style = MaterialTheme.typography.labelMedium)
        event.arguments?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = !busy, onClick = { decide("allow") }) { Text("Einmal erlauben") }
            OutlinedButton(enabled = !busy, onClick = { decide("deny") }) { Text("Ablehnen") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
