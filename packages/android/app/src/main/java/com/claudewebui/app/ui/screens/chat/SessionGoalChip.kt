package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.TodoItem
import com.claudewebui.app.data.model.TodoStatus
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.theme.LocalPlumPalette

private const val MAX_GOAL_LENGTH = 4000
private val GOAL_COMMAND = Regex("^/goal\\s+([\\s\\S]+)$", RegexOption.IGNORE_CASE)

/** The goal is the latest `/goal …` the user sent in this chat thread. */
internal fun latestGoal(messages: List<Message>): String? =
    messages.lastOrNull { it.role == MessageRole.USER && GOAL_COMMAND.matches(it.content.trim()) }
        ?.let { GOAL_COMMAND.find(it.content.trim())?.groupValues?.getOrNull(1)?.trim() }

/**
 * Goal of the run under the chat header of task and code sessions. Setting it
 * sends the provider's own `/goal`, so it is offered only where one exists.
 */
@Composable
internal fun SessionGoalChip(
    goal: String?,
    canSetGoal: Boolean,
    onSetGoal: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (goal == null && !canSetGoal) return
    var editing by remember { mutableStateOf(false) }
    val palette = LocalPlumPalette.current
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .padding(horizontal = 16.dp)
                .widthIn(max = 560.dp)
                .heightIn(min = 36.dp)
                .clip(CircleShape)
                .background(palette.controlSurface)
                .border(1.dp, palette.border.copy(alpha = if (goal == null) .45f else .7f), CircleShape)
                .clickable(enabled = canSetGoal, role = Role.Button) { editing = true }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.Flag, contentDescription = null, tint = if (goal == null) PlumMuted else PlumAccent, modifier = Modifier.size(16.dp))
            Text(
                stringResource(if (goal == null) R.string.session_goal_set else R.string.session_goal),
                style = MaterialTheme.typography.labelMedium,
                color = PlumMuted,
                fontWeight = FontWeight.SemiBold,
            )
            goal?.let {
                Text(it, style = MaterialTheme.typography.labelMedium, color = PlumText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    if (editing) {
        var draft by remember { mutableStateOf(goal.orEmpty()) }
        val trimmed = draft.trim()
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text(stringResource(R.string.session_goal_set)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        label = { Text(stringResource(R.string.session_goal_placeholder)) },
                        isError = trimmed.length > MAX_GOAL_LENGTH,
                        minLines = 2,
                        maxLines = 6,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(stringResource(R.string.session_goal_hint), style = MaterialTheme.typography.bodySmall, color = PlumMuted)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = trimmed.isNotEmpty() && trimmed.length <= MAX_GOAL_LENGTH,
                    onClick = { editing = false; onSetGoal(trimmed) },
                ) { Text(stringResource(R.string.session_goal_set)) }
            },
            dismissButton = { TextButton(onClick = { editing = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

/** Goal and todo list at the top of the Fortschritt sheet. */
internal fun LazyListScope.progressItems(goal: String?, todos: List<TodoItem>) {
    item(key = "progress-goal") {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.session_goal), style = MaterialTheme.typography.titleMedium)
            Text(
                goal ?: stringResource(R.string.session_goal_none),
                style = MaterialTheme.typography.bodyMedium,
                color = if (goal == null) PlumMuted else PlumText,
            )
        }
    }
    if (todos.isNotEmpty()) {
        item(key = "progress-todos-title") {
            Text(
                stringResource(R.string.component_tasks_count, todos.count { it.status == TodoStatus.COMPLETED }, todos.size),
                style = MaterialTheme.typography.titleMedium,
            )
        }
        todos.forEachIndexed { index, todo ->
            item(key = "progress-todo-$index") {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        when (todo.status) {
                            TodoStatus.COMPLETED -> "✓"
                            TodoStatus.IN_PROGRESS -> "▸"
                            TodoStatus.PENDING -> "○"
                        },
                        color = when (todo.status) {
                            TodoStatus.COMPLETED -> Color(0xFF22C55E)
                            TodoStatus.IN_PROGRESS -> PlumAccent
                            TodoStatus.PENDING -> PlumMuted
                        },
                    )
                    Text(
                        todo.activeForm?.takeIf { todo.status == TodoStatus.IN_PROGRESS && it.isNotBlank() } ?: todo.content,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (todo.status == TodoStatus.COMPLETED) PlumMuted else PlumText,
                    )
                }
            }
        }
    }
    item(key = "progress-divider") { HorizontalDivider() }
}
