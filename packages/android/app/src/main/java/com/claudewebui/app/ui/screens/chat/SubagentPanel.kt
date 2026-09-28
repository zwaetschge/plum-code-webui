package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.SubagentRun
import com.claudewebui.app.ui.theme.LocalPlumPalette
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

@Composable
internal fun SubagentSummary(runs: List<SubagentRun>, onClick: () -> Unit) {
    val palette = LocalPlumPalette.current
    val shape = RoundedCornerShape(16.dp)
    val summary = stringResource(
        R.string.agents_summary,
        runs.count { it.isActive },
        runs.count { it.isActive && it.activity == "waiting" },
        runs.count { it.state == "completed" },
    )
    Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp), contentAlignment = Alignment.CenterStart) {
        Row(
            modifier = Modifier
                .clip(shape)
                .background(palette.surface.copy(alpha = if (palette.glassHighlight == androidx.compose.ui.graphics.Color.Transparent) 1f else .76f))
                .border(1.dp, palette.border, shape)
                .semantics { role = Role.Button }
                .clickable(onClick = onClick)
                .heightIn(min = 44.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.Groups, contentDescription = null, tint = palette.accent, modifier = Modifier.size(17.dp))
            Text(stringResource(R.string.agents_summary_label), color = palette.text, style = MaterialTheme.typography.labelMedium)
            Text(summary, color = palette.muted, style = MaterialTheme.typography.labelSmall)
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = palette.muted, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
internal fun SubagentPanel(state: ChatUiState, onLoadMore: () -> Unit) {
    val runs = state.agentRuns.filter { it.chatId == state.activeChatId }
    var filter by remember { mutableIntStateOf(0) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(runs.any { it.isActive }) {
        while (runs.any { it.isActive }) { now = System.currentTimeMillis(); delay(1_000) }
    }
    LazyColumn(Modifier.fillMaxWidth().fillMaxHeight(0.85f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.agents_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.agents_summary, runs.count { it.isActive }, runs.count { it.isActive && it.activity == "waiting" }, state.agentTotals?.completed ?: runs.count { it.state == "completed" }), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.agents_counts, runs.count { it.state == "queued" }, state.agentTotals?.failed ?: runs.count { it.state == "failed" }, state.agentTotals?.interrupted ?: runs.count { it.state in listOf("interrupted", "cancelled") }), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.agents_scope), style = MaterialTheme.typography.bodySmall)
            state.agentsCapturedAt?.let { Text(stringResource(R.string.agents_updated, DateFormat.getTimeInstance().format(Date(it))), style = MaterialTheme.typography.bodySmall) }
            if (state.agentsError || !state.isConnected) Text(stringResource(R.string.agents_stale), color = MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(R.string.agents_all, R.string.agents_active, R.string.agents_history).forEachIndexed { index, label ->
                    FilterChip(selected = filter == index, onClick = { filter = index }, label = { Text(stringResource(label)) })
                }
            }
        }
        val visible = runs.filter { filter == 0 || if (filter == 1) it.isActive else !it.isActive }
        if (visible.isEmpty()) item { Text(stringResource(if (state.agentsLoading) R.string.agents_loading else R.string.agents_empty)) }
        items(visible, key = { it.runId }) { run ->
            var expanded by remember(run.runId) { mutableStateOf(false) }
            OutlinedCard(Modifier.fillMaxWidth().clickable { expanded = !expanded }) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(run.agentType, style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(when {
                        run.isActive && run.activity == "waiting" -> R.string.agents_waiting
                        run.state == "running" -> R.string.agents_active
                        run.state == "completed" -> R.string.agents_done
                        run.state == "failed" -> R.string.agents_failed
                        run.state == "cancelled" -> R.string.agents_cancelled
                        run.state == "queued" -> R.string.agents_queued
                        else -> R.string.agents_interrupted
                    }))
                    Text(run.description ?: stringResource(R.string.agents_no_task), maxLines = if (expanded) Int.MAX_VALUE else 2)
                    Text(listOfNotNull(run.provider ?: stringResource(R.string.agents_no_provider), run.model ?: stringResource(R.string.agents_no_model), if (run.background) stringResource(R.string.agents_background) else null).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    Text(run.activitySummary ?: stringResource(R.string.agents_no_activity), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.agents_timing, ((run.completedAt ?: now) - run.startedAt).coerceAtLeast(0) / 1000, (now - (run.updatedAt ?: run.completedAt ?: run.startedAt)).coerceAtLeast(0) / 1000), style = MaterialTheme.typography.bodySmall)
                    if (expanded) {
                        run.waitingReason?.let { Text(it) }
                        run.parentRunId?.let { Text(stringResource(R.string.agents_parent, it)) }
                        run.activities.forEach { Text("${DateFormat.getTimeInstance().format(Date(it.at))}  ${it.text}", style = MaterialTheme.typography.bodySmall) }
                        run.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        run.result?.let { Text(it) }
                        Text(run.runId, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        if (state.agentsHasMore) item { TextButton(onClick = onLoadMore, enabled = !state.agentsLoading) { Text(stringResource(R.string.agents_more)) } }
    }
}
