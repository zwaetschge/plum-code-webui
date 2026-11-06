package com.claudewebui.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claudewebui.wear.Approval
import com.claudewebui.wear.PlumBridge
import kotlinx.coroutines.launch

/**
 * Page 2 „Freigaben“: open tool approvals with „Erlauben“ / „Immer“ /
 * „Ablehnen“, and questions with one chip per option. Several questions or a
 * multiple choice cannot be answered with one tap — those only offer
 * „Ablehnen“ and point to the phone.
 */
@Composable
fun ApprovalsPage(
    bridge: PlumBridge,
    listState: ScalingLazyListState,
    visible: Boolean,
) {
    val approvals by bridge.approvals.collectAsStateWithLifecycle()
    val connection by bridge.connection.collectAsStateWithLifecycle()
    val syncedAt by bridge.syncedAt.collectAsStateWithLifecycle()
    val now = rememberNow()
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(emptySet<String>()) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    val note = connectionNote(connection, syncedAt, now)

    // A notification frame may have been missed while the page was elsewhere.
    LaunchedEffect(visible) { if (visible) bridge.refreshApprovalsAsync() }

    fun submit(requestId: String, action: suspend () -> Result<Unit>) {
        if (requestId in busy) return
        busy = busy + requestId
        errors = errors - requestId
        scope.launch {
            val outcome = action()
            busy = busy - requestId
            outcome.exceptionOrNull()?.let { error ->
                errors = errors + (requestId to (error.message ?: "Nicht gesendet"))
            }
        }
    }

    ScalingLazyColumn(modifier = Modifier.fillMaxSize(), state = listState) {
        item { ListHeader { Text(if (approvals.isEmpty()) "Freigaben" else "Freigaben (${approvals.size})") } }
        if (approvals.isEmpty()) {
            item { CenteredText("Nichts offen") }
        }
        approvals.forEach { approval ->
            val id = approval.requestId
            val idle = id !in busy
            when (approval) {
                is Approval.Permission -> {
                    item(key = "$id:card") {
                        Panel {
                            Text(
                                approval.toolName.ifBlank { "Werkzeug" },
                                style = MaterialTheme.typography.title3,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            approval.sessionName?.let {
                                Text(it, style = MaterialTheme.typography.caption2, color = WearColors.Muted, maxLines = 1)
                            }
                            if (approval.description.isNotBlank()) {
                                Text(
                                    approval.description,
                                    style = MaterialTheme.typography.caption1,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    item(key = "$id:allow") {
                        ActionChip("Erlauben", background = WearColors.Green, enabled = idle) {
                            submit(id) { bridge.respondPermission(approval, "allow_once") }
                        }
                    }
                    item(key = "$id:more") {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            SmallChip("Immer", WearColors.SurfaceStrong, idle, Modifier.weight(1f)) {
                                submit(id) { bridge.respondPermission(approval, "allow_project") }
                            }
                            SmallChip("Ablehnen", WearColors.Red, idle, Modifier.weight(1f)) {
                                submit(id) { bridge.respondPermission(approval, "deny") }
                            }
                        }
                    }
                }
                is Approval.Question -> {
                    val first = approval.questions.firstOrNull()
                    item(key = "$id:card") {
                        Panel {
                            Text(
                                first?.header?.takeIf { it.isNotBlank() } ?: "Frage",
                                style = MaterialTheme.typography.title3,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            approval.sessionName?.let {
                                Text(it, style = MaterialTheme.typography.caption2, color = WearColors.Muted, maxLines = 1)
                            }
                            first?.question?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MaterialTheme.typography.caption1, maxLines = 5, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    if (approval.answerable && first != null) {
                        first.options.forEachIndexed { index, option ->
                            item(key = "$id:option:$index") {
                                ActionChip(option, enabled = idle) {
                                    submit(id) { bridge.respondQuestion(approval, option) }
                                }
                            }
                        }
                    } else {
                        item(key = "$id:phone") { CenteredText("Am Handy beantworten", color = WearColors.Accent) }
                    }
                    item(key = "$id:reject") {
                        ActionChip("Ablehnen", background = WearColors.Red, enabled = idle) {
                            submit(id) { bridge.respondQuestion(approval, null) }
                        }
                    }
                }
            }
            errors[id]?.let { message ->
                item(key = "$id:error") { CenteredText(message, color = Color(0xFFFCA5A5)) }
            }
        }
        if (note != null) item(key = "note") { CenteredText(note, color = WearColors.Faint) }
    }
}

@Composable
private fun SmallChip(
    label: String,
    background: Color,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    CompactChip(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ChipDefaults.primaryChipColors(backgroundColor = background, contentColor = Color.White),
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
    )
}
