package com.claudewebui.wear.ui

import android.app.RemoteInput
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.input.RemoteInputIntentHelper
import com.claudewebui.wear.PlumBridge
import com.claudewebui.wear.SessionRow
import com.claudewebui.wear.SessionState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

private const val REPLY_KEY = "plum_reply"
private const val RECENT_SESSIONS = 5

/** Page 3 „Sessions“: the five most recent sessions with their state. */
@Composable
fun SessionsPage(
    bridge: PlumBridge,
    listState: ScalingLazyListState,
    visible: Boolean,
    onOpenSession: (String) -> Unit,
) {
    val sessions by bridge.sessions.collectAsStateWithLifecycle()
    val approvals by bridge.approvals.collectAsStateWithLifecycle()
    val connection by bridge.connection.collectAsStateWithLifecycle()
    val syncedAt by bridge.syncedAt.collectAsStateWithLifecycle()
    val now = rememberNow()
    val waiting = approvals.map { it.sessionId }.toSet()
    val recent = sessions.sortedByDescending { it.lastActivity }.take(RECENT_SESSIONS)
    val note = connectionNote(connection, syncedAt, now)

    // States change without a push; refresh while the page is in front.
    LaunchedEffect(visible) {
        while (visible) {
            bridge.refreshSessionsAsync()
            delay(30_000)
        }
    }

    ScalingLazyColumn(modifier = Modifier.fillMaxSize(), state = listState) {
        item { ListHeader { Text("Sessions") } }
        if (recent.isEmpty()) {
            item { CenteredText(if (connection is PlumBridge.Connection.Connecting) "Lade …" else "Keine Sessions") }
        }
        items(recent, key = { it.id }) { session ->
            SessionChip(session, SessionState.of(session, waiting)) { onOpenSession(session.id) }
        }
        if (note != null) item(key = "note") { CenteredText(note, color = WearColors.Faint) }
    }
}

@Composable
private fun SessionChip(session: SessionRow, state: SessionState, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = ChipDefaults.secondaryChipColors(
            backgroundColor = WearColors.Surface,
            contentColor = Color.White,
            secondaryContentColor = WearColors.Muted,
        ),
        icon = { StatusDot(Color(state.color)) },
        label = { Text(session.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        secondaryLabel = { Text(state.label, maxLines = 1) },
    )
}

/**
 * Reply to one session: dictate (shown for confirmation first — a misheard
 * instruction should not reach an agent unseen), type, or tap a quick reply.
 * „Stopp“ interrupts the running turn.
 */
@Composable
fun SessionScreen(bridge: PlumBridge, sessionId: String) {
    val sessions by bridge.sessions.collectAsStateWithLifecycle()
    val approvals by bridge.approvals.collectAsStateWithLifecycle()
    val connection by bridge.connection.collectAsStateWithLifecycle()
    val session = sessions.firstOrNull { it.id == sessionId }
    val waiting = approvals.map { it.sessionId }.toSet()
    val listState = rememberScalingLazyListState()
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    fun send(text: String) {
        if (sending || text.isBlank()) return
        sending = true
        feedback = null
        scope.launch {
            val outcome = bridge.send(sessionId, text.trim())
            sending = false
            feedback = outcome.fold(
                onSuccess = { status -> if (status == "queued") "In Warteschlange" else "Gesendet" },
                onFailure = { it.message ?: "Nicht gesendet" },
            )
            if (outcome.isSuccess) draft = null
        }
    }

    fun interrupt() {
        if (sending) return
        sending = true
        feedback = null
        scope.launch {
            val outcome = bridge.interrupt(sessionId)
            sending = false
            feedback = if (outcome.isSuccess) "Gestoppt" else outcome.exceptionOrNull()?.message ?: "Nicht gesendet"
        }
    }

    val typed = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data ?: return@rememberLauncherForActivityResult
        RemoteInput.getResultsFromIntent(data)
            ?.getCharSequence(REPLY_KEY)
            ?.toString()
            ?.takeIf { it.isNotBlank() }
            ?.let { send(it) }
    }
    val spoken = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            ?.takeIf { it.isNotBlank() }
            ?.let { draft = it.trim() }
    }

    fun typeReply() {
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(
            intent,
            listOf(RemoteInput.Builder(REPLY_KEY).setLabel("Nachricht").build()),
        )
        RemoteInputIntentHelper.putTitleExtra(intent, session?.name ?: "Nachricht")
        runCatching { typed.launch(intent) }.onFailure { feedback = "Keine Eingabe verfügbar" }
    }

    fun speak() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Nachricht an ${session?.name ?: "Plum"}")
        // Watches without a speech recognizer still have the system input (with its own mic).
        runCatching { spoken.launch(intent) }.onFailure { typeReply() }
    }

    val connected = connection is PlumBridge.Connection.Connected
    val enabled = connected && !sending

    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(modifier = Modifier.fillMaxSize(), state = listState) {
            item {
                ListHeader {
                    Text(
                        session?.name ?: "Session",
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            if (session != null) {
                val state = SessionState.of(session, waiting)
                item { CenteredText(state.label, color = Color(state.color)) }
            }
            val pending = draft
            if (pending != null) {
                item {
                    Panel {
                        Text("„$pending“", style = MaterialTheme.typography.body2, maxLines = 6, overflow = TextOverflow.Ellipsis)
                    }
                }
                item { ActionChip("Senden", background = WearColors.Green, enabled = enabled) { send(pending) } }
                item { ActionChip("Verwerfen", enabled = !sending) { draft = null } }
            } else {
                item { ActionChip("Sprechen", background = WearColors.Accent.copy(alpha = 0.45f), enabled = enabled) { speak() } }
                item { ActionChip("Tippen", enabled = enabled) { typeReply() } }
            }
            item { ActionChip("Weiter", enabled = enabled) { send("Weiter") } }
            item { ActionChip("Ja, mach das", enabled = enabled) { send("Ja, mach das") } }
            item { ActionChip("Stopp", background = WearColors.Red, enabled = enabled) { interrupt() } }
            val status = when {
                sending -> "Sende …"
                feedback != null -> feedback
                !connected -> if (connection is PlumBridge.Connection.Connecting) "Verbinde …" else "Nicht verbunden"
                else -> null
            }
            if (status != null) item { CenteredText(status) }
        }
    }
}
