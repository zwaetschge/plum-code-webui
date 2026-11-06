package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.RestartAlt
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
import com.claudewebui.app.data.model.ApiResponse
import com.claudewebui.app.data.model.HermesAgent
import com.claudewebui.app.data.model.HermesAgentContainer
import com.claudewebui.app.data.model.HermesStatus
import com.claudewebui.app.ui.theme.PlumGlassCard
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

private val PLATFORM_LABEL = mapOf("telegram" to "Telegram", "discord" to "Discord", "matrix" to "Matrix", "api_server" to "API")
private val GROUPS = listOf("swarm" to R.string.hermes_group_swarm, "watch" to R.string.hermes_group_watch)
private val GREEN = Color(0xFF22C55E)

/**
 * The Hermes area (it replaced Schwarm in the area selector): every Schwarm
 * agent with its containers, Hermes version, update and restart. The
 * Schwarm's rooms and orders open from here, which is also where the menu's
 * emergency stop lands.
 */
@Composable
fun AssistantHermesScreen(
    topInset: androidx.compose.ui.unit.Dp,
    emergencyOpen: Boolean,
    onEmergencyDismiss: () -> Unit,
    onAreaSelect: (String) -> Unit,
    api: ApiClient = koinInject(),
) {
    var showSwarm by rememberSaveable { mutableStateOf(false) }
    if (showSwarm || emergencyOpen) {
        Box(Modifier.fillMaxSize()) {
            AssistantSwarmScreen(topInset = topInset + 44.dp, emergencyOpen = emergencyOpen, onEmergencyDismiss = onEmergencyDismiss, onAreaSelect = onAreaSelect, api = api)
            TextButton(
                onClick = { showSwarm = false; onEmergencyDismiss() },
                modifier = Modifier.padding(top = topInset, start = 8.dp),
            ) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.hermes_back))
            }
        }
        return
    }

    val palette = PlumTheme.palette
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<HermesStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var confirmRebuild by remember { mutableStateOf<HermesAgent?>(null) }

    suspend fun load(fresh: Boolean) {
        try {
            val response = api.getHermesStatus(fresh)
            if (response.success) { status = response.data; error = null } else error = response.error?.message
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
    }
    // An update recreates a container within minutes: follow it closely, otherwise relax.
    LaunchedEffect(reload) {
        while (true) {
            load(fresh = false)
            delay(if (status?.agents?.any { it.update?.running == true } == true) 5_000 else 60_000)
        }
    }
    val act: (suspend () -> ApiResponse<HermesStatus>) -> Unit = { call ->
        scope.launch {
            busy = true
            try {
                val response = call()
                if (response.success) { status = response.data; error = null } else error = response.error?.message
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { busy = false; reload++ }
        }
    }
    val containerAction: (HermesAgentContainer, String) -> Unit = { container, verb ->
        act {
            val result = api.swarmContainerAction(container.name, verb, container.host)
            if (result.success) api.getHermesStatus(fresh = true)
            else ApiResponse(success = false, error = result.error)
        }
    }

    Column(
        Modifier.fillMaxSize().padding(top = topInset).navigationBarsPadding().padding(horizontal = 16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.hermes_subtitle), color = palette.muted, style = MaterialTheme.typography.bodyMedium)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        val data = status
        if (data == null) {
            if (error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        } else {
            PlumGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), contentPadding = 16.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.hermes_latest, data.latestTag ?: "–"), color = palette.text, fontWeight = FontWeight.SemiBold)
                            Text(stringResource(R.string.hermes_latest_hint), color = palette.muted, style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(enabled = !busy, onClick = { scope.launch { busy = true; load(fresh = true); busy = false } }) {
                            Icon(Icons.Outlined.Refresh, null, tint = palette.muted)
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).padding(end = 12.dp)) {
                            Text(stringResource(R.string.hermes_auto_update), color = palette.text)
                            Text(
                                if (data.autoUpdate.paused) data.autoUpdate.reason?.lineSequence()?.firstOrNull() ?: stringResource(R.string.hermes_paused)
                                else stringResource(R.string.hermes_auto_update_on),
                                color = palette.muted, style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Switch(checked = !data.autoUpdate.paused, enabled = !busy, onCheckedChange = { on -> act { api.setHermesAutoUpdate(paused = !on) } })
                    }
                }
            }
            GROUPS.forEach { (group, label) ->
                val agents = data.agents.filter { it.group == group }
                if (agents.isNotEmpty()) {
                    Text(stringResource(label), color = palette.muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 4.dp))
                    agents.forEach { agent ->
                        HermesAgentCard(
                            agent = agent,
                            busy = busy,
                            onUpdate = {
                                if (agent.update?.kind == "rebuild") confirmRebuild = agent
                                else act { api.updateHermesAgent(agent.id) }
                            },
                            onContainerAction = containerAction,
                        )
                    }
                }
            }
        }
        TextButton(onClick = { showSwarm = true }) {
            Icon(Icons.Outlined.Hub, null, modifier = Modifier.size(18.dp), tint = palette.muted)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.hermes_swarm_background), color = palette.muted)
        }
        Spacer(Modifier.height(24.dp))
    }

    confirmRebuild?.let { agent ->
        AlertDialog(
            onDismissRequest = { confirmRebuild = null },
            text = { Text(stringResource(R.string.hermes_rebuild_confirm, agent.name)) },
            confirmButton = { TextButton(onClick = { confirmRebuild = null; act { api.updateHermesAgent(agent.id) } }) { Text(stringResource(R.string.hermes_rebuild)) } },
            dismissButton = { TextButton(onClick = { confirmRebuild = null }) { Text(stringResource(R.string.hermes_cancel)) } },
        )
    }
}

@Composable
private fun HermesAgentCard(
    agent: HermesAgent,
    busy: Boolean,
    onUpdate: () -> Unit,
    onContainerAction: (HermesAgentContainer, String) -> Unit,
) {
    val palette = PlumTheme.palette
    var showLog by rememberSaveable(agent.id) { mutableStateOf(false) }
    val dot = when {
        agent.hermes?.platforms?.any { it.needsAttention } == true || agent.health == "stopped" -> MaterialTheme.colorScheme.error
        agent.health == "online" -> GREEN
        agent.health == "idle" -> Color(0xFF38BDF8)
        else -> palette.muted
    }
    PlumGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), contentPadding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(dot))
                Text("  ${agent.name}", color = palette.text, fontWeight = FontWeight.SemiBold)
                agent.version?.let { Text("  $it", color = palette.muted, style = MaterialTheme.typography.bodySmall) }
            }
            agent.description?.let { Text(it, color = palette.muted, style = MaterialTheme.typography.bodySmall) }
            val platforms = agent.hermes?.platforms.orEmpty()
            if (platforms.isNotEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    platforms.forEach { platform ->
                        val state = when (platform.state) {
                            "connected" -> stringResource(R.string.hermes_connected)
                            "disconnected" -> stringResource(R.string.hermes_disconnected)
                            else -> platform.state
                        }
                        Text(
                            "${PLATFORM_LABEL[platform.id] ?: platform.id}: $state",
                            fontSize = 11.sp,
                            color = when {
                                platform.state == "connected" -> GREEN
                                platform.needsAttention -> MaterialTheme.colorScheme.error
                                else -> palette.muted
                            },
                            modifier = Modifier.clip(RoundedCornerShape(50)).background(palette.controlSurface).padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
            }
            if (agent.containers.isEmpty()) {
                Text(
                    stringResource(if (agent.id == "hermes-phone") R.string.hermes_on_phone else R.string.hermes_no_container),
                    color = palette.muted, style = MaterialTheme.typography.bodySmall,
                )
            }
            agent.containers.forEach { container ->
                val verb = if (container.running) "restart" else "start"
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 32.dp)) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(if (container.running) GREEN else palette.muted))
                    Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                        Text(container.name, color = palette.text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(container.status, color = palette.muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (verb in container.actions) {
                        IconButton(enabled = !busy, onClick = { onContainerAction(container, verb) }, modifier = Modifier.size(40.dp)) {
                            Icon(
                                if (verb == "restart") Icons.Outlined.RestartAlt else Icons.Outlined.PlayArrow,
                                contentDescription = stringResource(if (verb == "restart") R.string.hermes_restart else R.string.hermes_start),
                                tint = palette.muted, modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }
            agent.update?.let { update ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val enabled = !busy && !update.running && (update.kind != "hermes" || update.available)
                    val label = when {
                        update.running -> stringResource(R.string.hermes_running_job)
                        update.kind == "rebuild" -> stringResource(R.string.hermes_rebuild)
                        update.available -> stringResource(R.string.hermes_update_to, update.target ?: "")
                        else -> stringResource(R.string.hermes_up_to_date)
                    }
                    if (update.kind == "hermes" && update.available) {
                        Button(enabled = enabled, onClick = onUpdate, modifier = Modifier.heightIn(min = 44.dp)) { UpdateLabel(update.running, label) }
                    } else {
                        OutlinedButton(enabled = enabled, onClick = onUpdate, modifier = Modifier.heightIn(min = 44.dp)) {
                            if (update.kind == "rebuild" && !update.running) { Icon(Icons.Outlined.Build, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
                            UpdateLabel(update.running, label)
                        }
                    }
                    if (update.log.isNotEmpty()) {
                        Text(stringResource(R.string.hermes_log), color = palette.muted, fontSize = 12.sp, modifier = Modifier.clickable { showLog = !showLog }.padding(8.dp))
                    }
                }
                if ((showLog || update.running) && update.log.isNotEmpty()) {
                    Text(
                        update.log.takeLast(16).joinToString("\n"),
                        fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = palette.muted,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                            .background(palette.controlSurface).padding(10.dp).horizontalScroll(rememberScrollState()),
                    )
                }
            }
        }
    }
}

@Composable
private fun UpdateLabel(running: Boolean, label: String) {
    if (running) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(8.dp))
    }
    Text(label)
}
