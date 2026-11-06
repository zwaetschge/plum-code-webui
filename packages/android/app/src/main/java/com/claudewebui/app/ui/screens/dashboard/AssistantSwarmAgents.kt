package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.SwarmDirectory
import com.claudewebui.app.data.model.SwarmContainerState
import com.claudewebui.app.data.model.SwarmDirectoryAgent
import com.claudewebui.app.data.model.SwarmHubState
import com.claudewebui.app.ui.theme.PlumGlassCard
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val GROUPS = listOf(
    "swarm" to R.string.swarm_group_swarm,
    "watch" to R.string.swarm_group_watch,
    "plum" to R.string.swarm_group_plum,
    "service" to R.string.swarm_group_service,
)

private fun healthLabel(health: String) = when (health) {
    "online" -> R.string.swarm_health_online
    "idle" -> R.string.swarm_health_idle
    "offline" -> R.string.swarm_health_offline
    "stopped" -> R.string.swarm_health_stopped
    else -> R.string.swarm_health_unknown
}

private fun healthColor(health: String) = when (health) {
    "online" -> Color(0xFF22C55E)
    "idle" -> Color(0xFF38BDF8)
    "offline" -> Color(0xFFF59E0B)
    "stopped" -> Color(0xFFEF4444)
    else -> Color(0xFF9CA3AF)
}

/**
 * Agenten view of the Schwarm area: every agent the server identifies, with
 * its real state, independent of the Matrix login. `onCommand` puts a hub
 * command into the room composer and is null without the swarm account.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SwarmAgentDirectory(
    api: ApiClient,
    onCommand: ((String) -> Unit)?,
    onOpenRoom: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val palette = PlumTheme.palette
    var directory by remember { mutableStateOf<SwarmDirectory?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("all") }
    var subagentsOpen by rememberSaveable { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Pair<SwarmContainerState, String>?>(null) }
    var logs by remember { mutableStateOf<Pair<String, List<String>>?>(null) }

    LaunchedEffect(reload) {
        while (true) {
            try {
                val response = api.getSwarmDirectory()
                if (response.success) { directory = response.data; error = null } else error = response.error?.message
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            delay(30_000)
        }
    }
    fun containerAction(container: SwarmContainerState, action: String) {
        scope.launch {
            try {
                val response = api.swarmContainerAction(container.name, action, container.host)
                if (!response.success) error = response.error?.message
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            reload++
        }
    }
    fun showLogs(container: SwarmContainerState) {
        val name = listOfNotNull(container.hostLabel, container.name).joinToString(" · ")
        if (logs?.first == name) { logs = null; return }
        scope.launch {
            try {
                logs = name to api.getSwarmContainerLogs(container.name, container.host).data?.lines.orEmpty()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
        }
    }

    confirm?.let { (container, action) ->
        val name = listOfNotNull(container.hostLabel, container.name).joinToString(" · ")
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(stringResource(if (action == "restart") R.string.swarm_restart_confirm else R.string.swarm_start_confirm, name)) },
            confirmButton = { TextButton(onClick = { confirm = null; containerAction(container, action) }) { Text(stringResource(if (action == "restart") R.string.swarm_restart else R.string.swarm_start)) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.assistant_cancel)) } },
        )
    }
    logs?.let { (name, lines) ->
        AlertDialog(
            onDismissRequest = { logs = null },
            title = { Text(name, fontFamily = FontFamily.Monospace) },
            text = {
                val empty = stringResource(R.string.swarm_no_output)
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(lines.ifEmpty { listOf(empty) }) { line ->
                        Text(line, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 14.sp)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { logs = null }) { Text(stringResource(R.string.component_back_to_work)) } },
        )
    }

    val data = directory
    if (data == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(error ?: stringResource(R.string.swarm_loading), color = if (error != null) MaterialTheme.colorScheme.error else palette.muted)
        }
        return
    }
    val visible = data.agents.filter { filter == "all" || it.group == filter }
    val countable = data.agents.filter { it.kind == "hub" || it.kind == "service" }
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "hub") { HubCard(data.hub, onCommand) }
        item(key = "filter") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (listOf("all" to R.string.swarm_group_all) + GROUPS).forEach { (id, label) ->
                        val count = if (id == "all") data.agents.size else data.agents.count { it.group == id }
                        FilterChip(selected = filter == id, onClick = { filter = id }, label = { Text("${stringResource(label)} $count") })
                    }
                }
                Text(
                    stringResource(R.string.swarm_counts, countable.count { it.health == "online" }, countable.count { it.health == "idle" }, countable.count { it.health == "offline" }, countable.count { it.health == "stopped" }),
                    style = MaterialTheme.typography.bodySmall, color = palette.muted,
                )
                if (!data.matrixConnected) Text(stringResource(R.string.swarm_needs_matrix), style = MaterialTheme.typography.bodySmall, color = palette.muted)
                if (!data.containersVisible) Text(stringResource(R.string.swarm_needs_admin), style = MaterialTheme.typography.bodySmall, color = palette.muted)
                data.containerErrors.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            }
        }
        GROUPS.filter { (id, _) -> visible.any { it.group == id } }.forEach { (id, label) ->
            item(key = "group-$id") { Text(stringResource(label), style = MaterialTheme.typography.titleMedium, color = palette.text, modifier = Modifier.padding(top = 4.dp)) }
            val members = visible.filter { it.group == id }
            items(members.filter { it.kind != "subagent" }, key = { it.id }) { agent ->
                AgentCard(
                    agent, data.containersVisible,
                    onCommand = if (data.matrixConnected) onCommand else null,
                    onOpenRoom = if (data.matrixConnected) onOpenRoom else null,
                    onContainer = { container, action -> confirm = container to action },
                    onLogs = ::showLogs,
                )
            }
            val subagents = members.filter { it.kind == "subagent" }
            if (subagents.isNotEmpty()) item(key = "subagents-$id") {
                PlumGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), contentPadding = 14.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth().clickable { subagentsOpen = !subagentsOpen }, verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.swarm_subagents, subagents.size), Modifier.weight(1f), fontWeight = FontWeight.Medium, color = palette.text)
                            Icon(if (subagentsOpen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = palette.muted)
                        }
                        if (subagentsOpen) subagents.forEach { sub ->
                            Column {
                                Text(listOfNotNull(sub.name, sub.model).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = palette.text)
                                sub.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HubCard(hub: SwarmHubState, onCommand: ((String) -> Unit)?) {
    val palette = PlumTheme.palette
    val (title, tone) = when {
        !hub.reachable -> R.string.swarm_hub_down to Color(0xFFEF4444)
        hub.frozen -> R.string.swarm_hub_frozen to Color(0xFFEF4444)
        hub.ok -> R.string.swarm_hub_ok to Color(0xFF22C55E)
        else -> R.string.swarm_hub_warn to Color(0xFFF59E0B)
    }
    var failuresOpen by remember { mutableStateOf(false) }
    PlumGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), contentPadding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(tone))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(title), style = MaterialTheme.typography.titleMedium, color = palette.text)
                    hub.container?.let { Text("${it.name} · ${it.status}", style = MaterialTheme.typography.bodySmall, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
            if (hub.reachable) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HubStat(R.string.swarm_open_tasks, hub.openTasks.toString(), Modifier.weight(1f))
                HubStat(R.string.swarm_approvals, hub.approvalsPending.toString(), Modifier.weight(1f))
                HubStat(R.string.swarm_cost_today, "$" + "%.2f".format(hub.costTodayUsd), Modifier.weight(1f))
                HubStat(R.string.swarm_undeliverable, hub.outboxDead.toString(), Modifier.weight(1f))
            } else hub.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = palette.muted) }
            if ("dead-letter-outbox" in hub.problems) Text("⚠ " + stringResource(R.string.swarm_dead_outbox), style = MaterialTheme.typography.bodySmall, color = palette.text)
            hub.problems.filter { it != "dead-letter-outbox" }.forEach { Text("⚠ $it", style = MaterialTheme.typography.bodySmall, color = palette.text) }
            if (hub.failures.isNotEmpty()) {
                Text(
                    stringResource(R.string.swarm_failures, hub.failures.size),
                    style = MaterialTheme.typography.bodySmall, color = palette.accent,
                    modifier = Modifier.clickable { failuresOpen = !failuresOpen },
                )
                if (failuresOpen) hub.failures.forEach { Text("${it.task} · ${it.state} · ${it.reason}", style = MaterialTheme.typography.bodySmall, color = palette.muted) }
            }
            if (onCommand != null) {
                if (hub.frozen) OutlinedButton(onClick = { onCommand("!weiter") }) { Text(stringResource(R.string.swarm_resume_prepare)) }
                else Button(onClick = { onCommand("!stop") }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text(stringResource(R.string.swarm_stop_prepare)) }
            }
        }
    }
}

@Composable
private fun HubStat(label: Int, value: String, modifier: Modifier) {
    val palette = PlumTheme.palette
    Column(modifier) {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = palette.text)
        Text(stringResource(label), style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 2)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AgentCard(
    agent: SwarmDirectoryAgent,
    containersVisible: Boolean,
    onCommand: ((String) -> Unit)?,
    onOpenRoom: ((String) -> Unit)?,
    onContainer: (container: SwarmContainerState, action: String) -> Unit,
    onLogs: (SwarmContainerState) -> Unit,
) {
    val palette = PlumTheme.palette
    val native = if (agent.kind == "hub") agent.id.removePrefix("hub:") else null
    val meta = listOfNotNull(
        agent.mode, agent.level, agent.trust, agent.model,
        agent.runtime?.takeIf { it != agent.containers.firstOrNull()?.name },
        agent.parallel?.takeIf { it > 1 }?.let { "$it parallel" },
    )
    PlumGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), contentPadding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(agent.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val color = healthColor(agent.health)
                Surface(shape = RoundedCornerShape(50), color = color.copy(alpha = .14f)) {
                    Row(Modifier.padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
                        Spacer(Modifier.width(5.dp))
                        Text(stringResource(healthLabel(agent.health)), style = MaterialTheme.typography.labelSmall, color = color)
                    }
                }
            }
            Text(agent.healthReason, style = MaterialTheme.typography.bodySmall, color = palette.text)
            agent.lastLog?.let {
                Surface(shape = RoundedCornerShape(10.dp), color = palette.controlSurface) {
                    Text(it, Modifier.padding(8.dp), fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 14.sp, color = palette.text)
                }
            }
            agent.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = palette.muted, maxLines = 3, overflow = TextOverflow.Ellipsis) }
            if (agent.skills.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                agent.skills.forEach { skill ->
                    Surface(shape = RoundedCornerShape(50), color = palette.controlSurface) {
                        Text(skill, Modifier.padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = palette.text)
                    }
                }
            }
            agent.puppets?.let { Text(stringResource(R.string.swarm_puppets, it.joinToString(", ")), style = MaterialTheme.typography.labelSmall, color = palette.muted) }
            agent.budgetUsdDay?.let { limit ->
                Text(stringResource(R.string.swarm_budget, "%.2f".format(agent.spentTodayUsd ?: 0.0), "%.2f".format(limit)), style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
            if (containersVisible) agent.containers.forEach { container ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(if (container.running) Color(0xFF22C55E) else Color(0xFFEF4444)))
                    Spacer(Modifier.width(6.dp))
                    Column(Modifier.weight(1f)) {
                        Text(container.name, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(container.hostLabel, container.status).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        container.ownerSessionName?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                    TextButton(onClick = { onLogs(container) }, contentPadding = PaddingValues(horizontal = 8.dp)) { Text(stringResource(R.string.swarm_logs)) }
                    if ((container.actions ?: listOf("start", "restart")).contains(if (container.running) "restart" else "start")) TextButton(onClick = { onContainer(container, if (container.running) "restart" else "start") }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                        Text(stringResource(if (container.running) R.string.swarm_restart else R.string.swarm_start))
                    }
                }
            }
            if (native != null && (onCommand != null || (onOpenRoom != null && agent.room?.id != null))) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (onCommand != null && "auftrag" in agent.accepts) OutlinedButton(onClick = { onCommand("!auftrag @$native ") }) { Text(stringResource(R.string.swarm_order)) }
                    val roomId = agent.room?.id
                    if (onOpenRoom != null && roomId != null) OutlinedButton(onClick = { onOpenRoom(roomId) }) { Text(stringResource(R.string.swarm_room)) }
                    if (onCommand != null && agent.group == "swarm") {
                        TextButton(onClick = { onCommand("!profil @$native") }) { Text(stringResource(R.string.swarm_profile)) }
                        TextButton(onClick = { onCommand("!stop @$native") }) { Text(stringResource(R.string.swarm_stop)) }
                        TextButton(onClick = { onCommand("!weiter @$native") }) { Text(stringResource(R.string.swarm_resume)) }
                    }
                }
            }
        }
    }
}
