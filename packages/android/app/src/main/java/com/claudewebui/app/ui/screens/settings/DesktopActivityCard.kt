package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.DesktopActivity
import com.claudewebui.app.data.model.DesktopActionInput
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText

@Composable
fun DesktopActivityCard(connectionId: String, activity: DesktopActivity?, busy: Boolean, dispatch: (DesktopActionInput) -> Unit) {
    var message by remember(connectionId) { mutableStateOf("") }
    var showHistory by remember(connectionId) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        activity?.let { a ->
            Text("${a.sessionName} · ${a.status}", color = PlumText, fontSize = 13.sp)
            if (a.action.isNotBlank()) Text(a.action, color = PlumMuted, fontSize = 12.sp)
            if (a.progress.isNotBlank()) Text(a.progress, color = PlumText, fontSize = 12.sp)
            if (a.chat.isNotBlank()) Text(a.chat, color = PlumText, fontSize = 12.sp)
            if (a.result.isNotBlank()) Text(a.result, color = PlumText, fontSize = 12.sp)
            if (a.history.isNotEmpty()) {
                TextButton(onClick = { showHistory = !showHistory }) { Text(stringResource(R.string.desktop_recent_steps)) }
                if (showHistory) a.history.forEach { Text(it, color = PlumMuted, fontSize = 11.sp) }
            }
        }
        OutlinedButton(enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "stop")) }) { Text(stringResource(R.string.desktop_stop_task)) }
        TextButton(enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "context")) }) { Text(stringResource(R.string.desktop_select_context)) }
        if (!activity?.resultTarget.isNullOrBlank()) TextButton(enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "open_result")) }) { Text(stringResource(R.string.desktop_open_result)) }
        OutlinedTextField(message, { message = it.take(4000) }, label = { Text(stringResource(R.string.desktop_message)) }, modifier = Modifier.fillMaxWidth())
        Button(enabled = !busy && message.isNotBlank(), onClick = { dispatch(DesktopActionInput(connectionId, "message", message.trim())) }) { Text(stringResource(R.string.desktop_send)) }
        activity?.layout?.let { layout ->
            Text(stringResource(R.string.desktop_chat_screen), color = PlumMuted, fontSize = 12.sp)
            val screens = listOf("primary" to stringResource(R.string.desktop_screen_primary), "secondary" to stringResource(R.string.desktop_screen_secondary)) + activity.screens.map { it.name to "${it.name} · ${it.width}×${it.height}" }
            screens.forEach { (id, label) ->
                FilterChip(selected = layout.chatScreen == id, enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "layout", layout = layout.copy(chatScreen = id))) }, label = { Text(label) })
            }
            listOf("floating" to R.string.desktop_layout_floating, "left" to R.string.desktop_layout_left, "right" to R.string.desktop_layout_right, "full" to R.string.desktop_layout_full).forEach { (id, label) ->
                FilterChip(selected = layout.chatPlacement == id, enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "layout", layout = layout.copy(chatPlacement = id))) }, label = { Text(stringResource(label)) })
            }
            Text(stringResource(R.string.desktop_chat_zoom), color = PlumMuted, fontSize = 12.sp)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(100, 125, 150, 175, 200, 250).forEach { zoom ->
                    FilterChip(selected = layout.chatZoom == zoom, enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "layout", layout = layout.copy(chatZoom = zoom))) }, label = { Text("$zoom %") })
                }
            }
            Text(stringResource(R.string.desktop_chat_top_space), color = PlumMuted, fontSize = 12.sp)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(0, 48, 64, 80, 96, 120, 160, 200).forEach { space ->
                    FilterChip(selected = layout.chatInsetTop == space, enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "layout", layout = layout.copy(chatInsetTop = space))) }, label = { Text("$space px") })
                }
            }
            TextButton(enabled = !busy, onClick = { dispatch(DesktopActionInput(connectionId, "layout", layout = layout.copy(chatVisible = !layout.chatVisible))) }) {
                Text(stringResource(if (layout.chatVisible) R.string.desktop_chat_hide else R.string.desktop_chat_show))
            }
        }
    }
}
