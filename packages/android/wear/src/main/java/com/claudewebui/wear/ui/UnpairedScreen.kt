package com.claudewebui.wear.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.claudewebui.wear.PhoneRelay
import com.claudewebui.wear.WearApproval
import com.claudewebui.wear.WearFormat
import com.claudewebui.wear.WearQuestion
import com.claudewebui.wear.WearSnapshotStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Locale

/**
 * Not paired with Plum yet: the hint where to pair, and below it the phone's
 * snapshot as before — stats plus approvals and questions answered through
 * the phone (Data Layer messages to WearBridgeService).
 */
@Composable
fun UnpairedScreen() {
    val context = LocalContext.current
    val changes by WearSnapshotStore.changes.collectAsStateWithLifecycle()
    var snapshot by remember { mutableStateOf(WearSnapshotStore.cached(context)) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val listState = rememberScalingLazyListState()

    // One live read on open (it caches, which bumps [changes]); later pushes
    // only need the cache.
    LaunchedEffect(Unit) {
        snapshot = withContext(Dispatchers.IO) { WearSnapshotStore.readLive(context) }
    }
    LaunchedEffect(changes) {
        snapshot = WearSnapshotStore.cached(context)
    }

    fun deliver(path: String, payload: JSONObject, evict: () -> Unit) {
        message = null
        scope.launch {
            // Optimistic, but only once the phone has the message — otherwise a
            // watch out of Bluetooth range silently swallowed the answer.
            if (PhoneRelay.send(context, path, payload)) {
                evict()
            } else {
                message = "Handy nicht erreichbar"
            }
        }
    }

    fun respond(approval: WearApproval, approve: Boolean) = deliver(
        WearSnapshotStore.PATH_APPROVAL_RESPONSE,
        JSONObject()
            .put("sessionId", approval.sessionId)
            .put("requestId", approval.requestId)
            .put("approve", approve),
    ) {
        snapshot = snapshot.copy(approvals = snapshot.approvals.filterNot { it.requestId == approval.requestId })
    }

    /** [option] null rejects the question. */
    fun answer(question: WearQuestion, option: String?) = deliver(
        WearSnapshotStore.PATH_QUESTION_RESPONSE,
        JSONObject().apply {
            put("sessionId", question.sessionId)
            put("requestId", question.requestId)
            put("providerSessionId", question.providerSessionId)
            if (option != null) put("answer", option)
        },
    ) {
        snapshot = snapshot.copy(questions = snapshot.questions.filterNot { it.requestId == question.requestId })
    }

    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(modifier = Modifier.fillMaxSize(), state = listState) {
            item { ListHeader { Text("Plum Code") } }
            item {
                Panel {
                    Text("Nicht gekoppelt", style = MaterialTheme.typography.title3)
                    Text(
                        "Auf dem Handy unter Einstellungen → Uhr koppeln",
                        style = MaterialTheme.typography.caption1,
                        color = WearColors.Muted,
                    )
                }
            }
            if (snapshot.updatedAtMs > 0) {
                item {
                    CenteredText(
                        "${snapshot.running} aktiv · ${WearFormat.tokens(snapshot.tokensToday)} Tokens · " +
                            String.format(Locale.GERMAN, "%.2f $", snapshot.costToday)
                    )
                }
                if (snapshot.approvals.isEmpty() && snapshot.questions.isEmpty()) {
                    item { CenteredText("Nichts offen") }
                }
                snapshot.approvals.forEach { approval ->
                    item(key = "a:${approval.requestId}") {
                        Panel {
                            Text(approval.toolName, style = MaterialTheme.typography.title3, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(approval.sessionName, style = MaterialTheme.typography.caption2, color = WearColors.Muted, maxLines = 1)
                        }
                    }
                    item(key = "a:${approval.requestId}:allow") {
                        ActionChip("Erlauben", background = WearColors.Green) { respond(approval, true) }
                    }
                    item(key = "a:${approval.requestId}:deny") {
                        ActionChip("Ablehnen", background = WearColors.Red) { respond(approval, false) }
                    }
                }
                snapshot.questions.forEach { question ->
                    item(key = "q:${question.requestId}") {
                        Panel {
                            Text(
                                question.prompt.ifBlank { "Wartet auf Antwort" },
                                style = MaterialTheme.typography.title3,
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(question.sessionName, style = MaterialTheme.typography.caption2, color = WearColors.Muted, maxLines = 1)
                        }
                    }
                    if (question.answerable) {
                        question.options.forEachIndexed { index, option ->
                            item(key = "q:${question.requestId}:$index") {
                                ActionChip(option) { answer(question, option) }
                            }
                        }
                    } else {
                        // Multi-select, free text or several questions at once:
                        // there is no honest one-tap answer.
                        item(key = "q:${question.requestId}:phone") {
                            CenteredText("Am Handy beantworten", color = WearColors.Accent)
                        }
                    }
                    item(key = "q:${question.requestId}:reject") {
                        ActionChip("Ablehnen", background = WearColors.Red) { answer(question, null) }
                    }
                }
            }
            message?.let { text -> item(key = "message") { CenteredText(text) } }
        }
    }
}
