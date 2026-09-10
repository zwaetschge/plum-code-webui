package com.claudewebui.app.ui.screens.activity

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material3.TextButton
import com.claudewebui.app.data.local.entity.OutboxStatus
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.ui.components.dashboard.IdlePrefs
import com.claudewebui.app.ui.components.dashboard.SessionActivity
import com.claudewebui.app.ui.components.dashboard.SessionState
import com.claudewebui.app.ui.components.dashboard.SupervisedSession
import com.claudewebui.app.ui.components.dashboard.accentFor
import com.claudewebui.app.ui.components.dashboard.superviseSessions
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.SectionHeading
import com.claudewebui.app.ui.components.common.Sparkline
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.sessionModel
import com.claudewebui.app.ui.screens.dashboard.DashboardViewModel
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

private enum class ActivityFilter(private val labelRes: Int, val activity: SessionActivity?) {
    ALL(R.string.activity_all_6a720, null),
    NEEDS_YOU(R.string.activity_needs_you_0d9d0, SessionActivity.NEEDS_YOU),
    WORKING(R.string.activity_working_3b4df, SessionActivity.WORKING),
    QUEUED(R.string.activity_queued_6a599, SessionActivity.QUEUED),
    FAILED(R.string.activity_failed_09fef, SessionActivity.FAILED);

    val label: String
        @androidx.compose.runtime.Composable get() = androidx.compose.ui.res.stringResource(labelRes)

}

@Composable
fun ActivityScreen(
    onNavigateMain: (MainDestination) -> Unit,
    onOpenSession: (String) -> Unit,
    viewModel: DashboardViewModel = koinViewModel(),
    activityViewModel: ActivityViewModel = koinViewModel(),
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val activity by activityViewModel.uiState.collectAsState()
    val outbox by activityViewModel.outbox.collectAsState()
    var showOutbox by remember { mutableStateOf(false) }
    val socket: SocketManager = koinInject()
    val connection by socket.connectionState.collectAsState()
    val idleAfter by IdlePrefs.threshold.collectAsState()
    var filter by remember { mutableStateOf(ActivityFilter.ALL) }

    // Ordered by urgency, not by recency: the whole point of this screen is that
    // the session that has been blocked for an hour outranks the one that
    // printed a token a second ago. superviseSessions already orders groups
    // that way, so flattening it keeps one definition of "urgent".
    val ranked = remember(state.sessions, idleAfter) {
        superviseSessions(state.sessions, idleAfterMinutes = idleAfter.minutes).flatMap { it.sessions }
    }
    val rows = remember(ranked, filter) {
        filter.activity?.let { wanted -> ranked.filter { it.state.activity == wanted } } ?: ranked
    }
    val counts = remember(ranked) { ranked.groupingBy { it.state.activity }.eachCount() }
    val needsYou = counts[SessionActivity.NEEDS_YOU] ?: 0
    val working = counts[SessionActivity.WORKING] ?: 0
    val queued = counts[SessionActivity.QUEUED] ?: 0
    val failed = counts[SessionActivity.FAILED] ?: 0

    PlumBackdrop {
        PlumNavScaffold(
            selected = MainDestination.ACTIVITY,
            onNavigate = onNavigateMain,
            badgeCount = needsYou + failed,
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
                contentPadding = PaddingValues(bottom = 18.dp + padding.calculateBottomPadding()),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.cozy),
            ) {
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.activity_activity_81c0d),
                        subtitle = screenResources.getString(R.string.activity_realtime_overview_of_agents_tools_and_events_a04c0),
                        live = connection == ConnectionState.CONNECTED,
                        actions = {
                            PlumIconButton(
                                icon = Icons.Outlined.Refresh,
                                contentDescription = screenResources.getString(R.string.activity_refresh_56e3b),
                                onClick = {
                                    viewModel.refresh()
                                    activityViewModel.refresh()
                                },
                            )
                        },
                    )
                }
                item {
                    TextButton(onClick = { showOutbox = !showOutbox }, modifier = Modifier.padding(horizontal = screenTokens.spacing.cozy)) {
                        Text(screenResources.getString(R.string.activity_outbox_1_s_this_device_9640e, outbox.size))
                    }
                }
                if (showOutbox) {
                    if (outbox.isEmpty()) item {
                        Text(screenResources.getString(R.string.activity_no_messages_waiting_to_be_sent_1f175), modifier = Modifier.padding(horizontal = screenTokens.spacing.section), color = PlumMuted)
                    }
                    items(outbox, key = { "outbox_${it.clientMessageId}" }) { entry ->
                        Column(
                            Modifier.padding(horizontal = screenTokens.spacing.cozy).fillMaxWidth()
                                .background(LocalPlumPalette.current.surfaceStrong, RoundedCornerShape(screenTokens.radius.lg))
                                .padding(screenTokens.spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                        ) {
                            Text(state.sessions.find { it.id == entry.sessionId }?.name ?: screenResources.getString(R.string.activity_unavailable_session_64980), fontWeight = FontWeight.SemiBold)
                            Text(screenResources.getString(R.string.activity_chat_1_s_2_s_6330a, entry.chatId ?: screenResources.getString(R.string.activity_original_chat_b08b0), java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(entry.createdAt))), color = PlumMuted)
                            Text(entry.content, maxLines = 5, overflow = TextOverflow.Ellipsis)
                            Text(entry.error ?: screenResources.getString(R.string.activity_waiting_for_server_confirmation_2d41d), color = if (entry.deliveryStatus == OutboxStatus.FAILED) PlumRed else PlumMuted)
                            Row {
                                TextButton(onClick = { onOpenSession(entry.sessionId) }) { Text(screenResources.getString(R.string.activity_open_session_77709)) }
                                if (entry.deliveryStatus == OutboxStatus.FAILED) {
                                    TextButton(onClick = { activityViewModel.discardFailed(entry.clientMessageId) }) { Text(screenResources.getString(R.string.activity_discard_36fff), color = PlumRed) }
                                }
                            }
                        }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy),
                        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    ) {
                        ActivityMetric(screenResources.getString(R.string.activity_needs_you_0d9d0), needsYou, Icons.Outlined.Security, PlumAmber, Modifier.weight(1f))
                        ActivityMetric(screenResources.getString(R.string.activity_working_3b4df), working, Icons.Outlined.PlayCircle, PlumGreen, Modifier.weight(1f))
                        ActivityMetric(screenResources.getString(R.string.activity_queued_6a599), queued, Icons.Outlined.Layers, PlumAccent, Modifier.weight(1f))
                        ActivityMetric(screenResources.getString(R.string.activity_failed_09fef), failed, Icons.Outlined.ErrorOutline, PlumRed, Modifier.weight(1f))
                        // The only tile with a history behind it, so the only
                        // one that draws a curve.
                        ActivityMetric(
                            label = screenResources.getString(R.string.activity_requests_24h_f8785),
                            value = activity.requestsToday.toInt(),
                            icon = Icons.Outlined.Bolt,
                            color = PlumBlue,
                            modifier = Modifier.weight(1f),
                            trend = activity.requestsPerHour,
                        )
                    }
                }
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy),
                        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    ) {
                        ActivityFilter.entries.forEach { option ->
                            Box(
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(screenTokens.radius.md))
                                    .background(if (filter == option) LocalPlumPalette.current.selectionTint else Color.Transparent)
                                    .border(1.dp, if (filter == option) PlumAccent else PlumBorder, RoundedCornerShape(screenTokens.radius.md))
                                    .clickable { filter = option }
                                    .padding(vertical = screenTokens.spacing.compact),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    option.label,
                                    color = if (filter == option) PlumText else PlumMuted,
                                    fontSize = 10.sp,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
                item {
                    SectionHeading(
                        title = screenResources.getString(R.string.activity_live_activity_93df4),
                        modifier = Modifier.padding(horizontal = screenTokens.spacing.lg),
                        trailing = {
                            Text(
                                if (rows.isEmpty()) "" else screenResources.getQuantityString(R.plurals.activity_session_count, rows.size, rows.size),
                                color = PlumMuted,
                                fontSize = 13.sp,
                            )
                        },
                    )
                }
                if (rows.isEmpty()) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy), radius = 18.dp) {
                            Column(
                                Modifier.fillMaxWidth().padding(34.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Icon(Icons.Outlined.CheckCircle, null, tint = PlumMuted, modifier = Modifier.size(30.dp))
                                Spacer(Modifier.height(8.dp))
                                Text(screenResources.getString(R.string.activity_no_matching_activity_26303), color = PlumText, fontWeight = FontWeight.SemiBold)
                                Text(screenResources.getString(R.string.activity_new_live_events_will_appear_here_31fb0), color = PlumMuted, fontSize = 12.sp)
                            }
                        }
                    }
                } else {
                    // One lazy item per row. The list used to be a Column inside
                    // a single item, which composed and measured every session
                    // on screen even when forty of them were below the fold.
                    items(rows, key = { it.session.id }) { row ->
                        GlassPanel(Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.cozy), radius = 18.dp) {
                            ActivityRow(row = row, onClick = { onOpenSession(row.session.id) })
                        }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val (dot, text) = when (connection) {
                            ConnectionState.CONNECTED -> PlumGreen to screenResources.getString(R.string.activity_connected_to_plum_code_webui_82f9f)
                            ConnectionState.CONNECTING -> PlumAmber to screenResources.getString(R.string.activity_connecting_fd3e7)
                            ConnectionState.RECONNECTING -> PlumAmber to screenResources.getString(R.string.activity_reconnecting_8a8b9)
                            ConnectionState.ERROR -> PlumRed to screenResources.getString(R.string.activity_connection_failed_202ca)
                            ConnectionState.DISCONNECTED -> PlumMuted to screenResources.getString(R.string.activity_offline_showing_cached_state_56761)
                        }
                        Box(Modifier.size(8.dp).background(dot, CircleShape))
                        Text("  $text", color = PlumMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        activity.error?.let {
                            Text(screenResources.getString(R.string.activity_history_unavailable_5bcef), color = PlumMuted, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityMetric(
    label: String,
    value: Int,
    icon: ImageVector,
    color: Color,
    modifier: Modifier = Modifier,
    trend: List<Float> = emptyList(),
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(modifier.height(112.dp), radius = 16.dp) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 7.dp, vertical = screenTokens.spacing.md),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Box(Modifier.size(31.dp).background(color.copy(alpha = .16f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = color, modifier = Modifier.size(screenTokens.sizing.iconInline))
            }
            Text(value.toString(), color = color, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(label, color = PlumMuted, fontSize = 9.sp, maxLines = 1)
            // No invented shape: a tile without real history keeps the space and
            // draws nothing.
            if (trend.size >= 2) {
                Sparkline(color, trend, Modifier.fillMaxWidth().height(11.dp))
            } else {
                Spacer(Modifier.height(11.dp))
            }
        }
    }
}

@Composable
private fun ActivityRow(row: SupervisedSession, onClick: () -> Unit) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val session = row.session
    val state: SessionState = row.state
    val accent = accentFor(state)
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(15.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.size(42.dp).background(providerColor(session.cliProvider).copy(alpha = .16f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.PlayCircle, null, tint = providerColor(session.cliProvider), modifier = Modifier.size(23.dp))
        }
        Column(Modifier.weight(1f).padding(horizontal = screenTokens.spacing.md)) {
            Text(session.name, color = PlumText, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            // What the agent is actually doing, falling back to the last thing
            // it said. "Session ready" was shown even for a failed session.
            Text(
                session.activitySummary?.takeIf { it.isNotBlank() }
                    ?: session.lastMessage?.takeIf { it.isNotBlank() }
                    ?: screenResources.getString(R.string.activity_nothing_in_progress_a710d),
                color = PlumMuted,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text("${sessionModel(session)}  •  ${session.workingDirectory.substringAfterLast('/')}", color = PlumMuted, fontSize = 11.sp)
        }
        Column(horizontalAlignment = Alignment.End) {
            // The verdict, which already carries the queue depth, the approval
            // count and how long it has been quiet.
            StatusPill(state.label, accent)
            Spacer(Modifier.height(7.dp))
            Icon(Icons.Outlined.MoreVert, screenResources.getString(R.string.activity_more_4bab2), tint = PlumMuted, modifier = Modifier.size(screenTokens.sizing.iconMd))
        }
    }
}
