package com.claudewebui.app.ui.screens.dashboard

import android.content.Context
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.PendingPermissionItem
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.plainTextPreview
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.components.dashboard.SessionActivity
import com.claudewebui.app.ui.components.dashboard.SessionGroup
import com.claudewebui.app.ui.components.dashboard.SessionState
import com.claudewebui.app.ui.components.dashboard.SupervisedSession
import com.claudewebui.app.ui.components.dashboard.accentFor
import com.claudewebui.app.ui.components.dashboard.facts
import com.claudewebui.app.ui.components.dashboard.localizedLabel
import com.claudewebui.app.ui.components.dashboard.superviseSessions
import com.claudewebui.app.ui.motion.reducedMotion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * How Task and Code sessions are laid out. Chosen in the header menu (≡) and
 * remembered per area.
 *
 * - [SITUATION] "Lagebild": what needs you (with approvals right on the card),
 *   a carousel of sessions working right now, then everything else as tiles.
 * - [PROJECTS]: sessions grouped by working directory into folding cards.
 * - [BOARD]: four columns, Braucht dich / Arbeitet / Wartet / Erledigt.
 */
enum class SessionView { SITUATION, PROJECTS, BOARD }

object SessionViewPrefs {
    private val state = MutableStateFlow<Map<String, SessionView>>(emptyMap())
    private var loaded = false

    fun flow(context: Context): StateFlow<Map<String, SessionView>> {
        if (!loaded) {
            loaded = true
            val prefs = context.applicationContext.getSharedPreferences("plum_session_view", Context.MODE_PRIVATE)
            state.value = listOf("task", "code").associateWith { area ->
                runCatching { SessionView.valueOf(prefs.getString(area, null) ?: "") }.getOrDefault(SessionView.SITUATION)
            }
        }
        return state
    }

    fun set(context: Context, area: String, view: SessionView) {
        flow(context)
        state.value = state.value + (area to view)
        context.applicationContext.getSharedPreferences("plum_session_view", Context.MODE_PRIVATE).edit().putString(area, view.name).apply()
    }
}

/** What a tile or card can do with its session; the list screen owns the dialogs. */
internal class SessionTileActions(
    val open: (Session) -> Unit,
    val toggleSelect: (Session) -> Unit,
    val respond: (PendingPermissionItem, Boolean) -> Unit,
    val star: (Session) -> Unit,
    val archive: (Session) -> Unit,
    val preview: (Session) -> Unit,
)

/** "vor 12 Min.", "gestern" … for any ISO timestamp; empty when unreadable. */
internal fun ageLabel(iso: String?, context: Context): String {
    val instant = runCatching { Instant.parse(iso.orEmpty()) }.getOrNull() ?: return ""
    val minutes = ChronoUnit.MINUTES.between(instant, Instant.now()).coerceAtLeast(0)
    val hours = minutes / 60
    val days = hours / 24
    return when {
        minutes < 1 -> context.getString(R.string.component_just_now)
        minutes < 60 -> context.getString(R.string.component_minutes_ago, minutes)
        hours < 24 -> context.getString(R.string.component_hours_ago, hours)
        days == 1L -> context.getString(R.string.component_yesterday)
        else -> context.getString(R.string.component_days_ago, days)
    }
}

/** Last segment of the working directory: the project a session belongs to. */
internal fun projectName(session: Session): String =
    session.workingDirectory.trimEnd('/').substringAfterLast('/').ifBlank { session.workingDirectory }

private fun Session.lastTouched(): String = lastActivityAt?.takeIf { it.isNotBlank() } ?: updatedAt

/**
 * Lays the visible sessions out in [view] as items of the list screen's grid.
 * Full-width items span the whole line; tiles take one cell each, so the grid
 * decides how many tiles fit side by side.
 */
internal fun LazyGridScope.sessionOverview(
    view: SessionView,
    sessions: List<Session>,
    idleAfterMinutes: Long,
    approvals: List<PendingPermissionItem>,
    responding: Set<String>,
    selection: Set<String>,
    openSessionId: String?,
    archived: Boolean,
    expandedProjects: Set<String>,
    onToggleProject: (String) -> Unit,
    actions: SessionTileActions,
) {
    val sections = superviseSessions(sessions, idleAfterMinutes = idleAfterMinutes)
    val byGroup = sections.associate { it.group to it.sessions }
    when (view) {
        SessionView.SITUATION -> {
            byGroup[SessionGroup.NEEDS_YOU]?.let { rows ->
                item(key = "needs_header", span = { GridItemSpan(maxLineSpan) }) { OverviewHeading(stringResource(R.string.overview_needs_you), rows.size, PlumRed) }
                items(rows, key = { "needs_${it.session.id}" }, span = { GridItemSpan(maxLineSpan) }) { row ->
                    NeedsYouCard(row, approvals.filter { it.sessionId == row.session.id }, responding, row.session.id in selection || row.session.id == openSessionId, actions)
                }
            }
            byGroup[SessionGroup.WORKING]?.let { rows ->
                item(key = "working_header", span = { GridItemSpan(maxLineSpan) }) { OverviewHeading(stringResource(R.string.overview_working_now), rows.size, PlumGreen) }
                item(key = "working_row", span = { GridItemSpan(maxLineSpan) }) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(end = 4.dp)) {
                        items(rows, key = { it.session.id }) { row -> LiveTile(row, row.session.id in selection || row.session.id == openSessionId, actions) }
                    }
                }
            }
            val rest = (byGroup[SessionGroup.QUEUED].orEmpty() + byGroup[SessionGroup.SETTLED].orEmpty()).sortedByDescending { it.session.lastTouched() }
            if (rest.isNotEmpty()) {
                item(key = "recent_header", span = { GridItemSpan(maxLineSpan) }) { OverviewHeading(stringResource(R.string.overview_recent), rest.size, PlumMuted) }
                items(rest, key = { "recent_${it.session.id}" }) { row ->
                    SessionTile(row, row.session.id in selection || row.session.id == openSessionId, actions)
                }
            }
        }
        SessionView.PROJECTS -> {
            val supervised = sections.flatMap { it.sessions }
            val projects = supervised.groupBy { it.session.workingDirectory.trimEnd('/') }
                .entries.sortedByDescending { entry -> entry.value.maxOf { it.session.lastTouched() } }
            projects.forEach { (path, rows) ->
                item(key = "project_$path", span = { GridItemSpan(maxLineSpan) }) {
                    ProjectCard(path, rows, path in expandedProjects) { onToggleProject(path) }
                }
                if (path in expandedProjects) items(rows.sortedByDescending { it.session.lastTouched() }, key = { "project_${path}_${it.session.id}" }) { row ->
                    SessionTile(row, row.session.id in selection || row.session.id == openSessionId, actions, showProject = false)
                }
            }
        }
        SessionView.BOARD -> item(key = "board", span = { GridItemSpan(maxLineSpan) }) {
            SessionBoard(byGroup, selection, openSessionId, actions)
        }
    }
}

@Composable
private fun OverviewHeading(title: String, count: Int, tint: Color) {
    Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(8.dp).background(tint, CircleShape))
        Text(title, color = PlumText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Text(count.toString(), color = PlumMuted, fontSize = 13.sp)
    }
}

/** A status dot that breathes while its session works. */
@Composable
private fun StatusRing(state: SessionState, size: androidx.compose.ui.unit.Dp = 10.dp) {
    val tint = accentFor(state)
    val live = state.activity == SessionActivity.WORKING && !reducedMotion()
    val pulse = if (live) rememberInfiniteTransition(label = "ring").animateFloat(0f, 1f, infiniteRepeatable(tween(1400), RepeatMode.Restart), label = "ring_pulse").value else 0f
    Box(
        Modifier.size(size * 2).drawBehind {
            val radius = this.size.minDimension / 4
            if (live) drawCircle(tint.copy(alpha = (1f - pulse) * .45f), radius * (1f + pulse * 1.6f))
            drawCircle(tint, radius)
        },
    )
}

@Composable
private fun TileMeta(session: Session, showProject: Boolean) {
    val context = LocalContext.current
    val parts = listOfNotNull(projectName(session).takeIf { showProject && it.isNotBlank() }, ageLabel(session.lastTouched(), context).ifBlank { null })
    Text(parts.joinToString(" · "), color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.sessionClicks(session: Session, selecting: Boolean, actions: SessionTileActions) = combinedClickable(
    onClick = { if (selecting) actions.toggleSelect(session) else actions.open(session) },
    onLongClick = { actions.preview(session) },
)

/**
 * "Braucht dich": what the session is waiting for, and its approvals with
 * Erlauben / Ablehnen right on the card. A question opens the chat.
 */
@Composable
private fun NeedsYouCard(row: SupervisedSession, approvals: List<PendingPermissionItem>, responding: Set<String>, selected: Boolean, actions: SessionTileActions) {
    val context = LocalContext.current
    val session = row.session
    val label = row.state.localizedLabel(context, session.facts())
    GlassPanel(
        Modifier.fillMaxWidth().semantics { role = Role.Button; this.selected = selected; contentDescription = "${session.name}, $label" }.sessionClicks(session, false, actions).animateContentSize(),
        radius = 22.dp, borderColor = if (selected) PlumAccent else accentFor(row.state),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusRing(row.state)
                Text(session.name, color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                ProviderTag(session)
            }
            TileMeta(session, showProject = true)
            Text(label, color = PlumText, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            approvals.take(3).forEach { item ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(accentFor(row.state).copy(alpha = .10f)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(item.toolName, color = PlumText, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                    if (item.description.isNotBlank()) Text(plainTextPreview(item.description, 220), color = PlumMuted, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    val busy = item.requestId in responding
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !busy, onClick = { actions.respond(item, true) }) { Text(stringResource(R.string.overview_allow)) }
                        OutlinedButton(enabled = !busy, onClick = { actions.respond(item, false) }) { Text(stringResource(R.string.overview_deny)) }
                    }
                }
            }
            if (approvals.isEmpty()) TextButton(onClick = { actions.open(session) }, contentPadding = PaddingValues(horizontal = 0.dp)) { Text(stringResource(R.string.overview_answer)) }
        }
    }
}

/** A session at work: live ring, what it is doing, for how long. */
@Composable
private fun LiveTile(row: SupervisedSession, selected: Boolean, actions: SessionTileActions) {
    val context = LocalContext.current
    val session = row.session
    GlassPanel(
        Modifier.width(232.dp).heightIn(min = 132.dp).semantics { role = Role.Button; this.selected = selected }.sessionClicks(session, false, actions),
        radius = 20.dp, borderColor = if (selected) PlumAccent else providerColor(session.cliProvider).copy(alpha = .55f),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusRing(row.state)
                Text(session.name, color = PlumText, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            }
            Text(
                (session.activitySummary?.takeIf { it.isNotBlank() } ?: row.state.localizedLabel(context, session.facts())).replace(Regex("\\s+"), " "),
                color = PlumText, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.weight(1f, fill = false))
            val running = row.state.quietForMinutes?.let { stringResource(R.string.overview_quiet_for, it) }
            Text(listOfNotNull(projectName(session).ifBlank { null }, running).joinToString(" · "), color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ProviderTag(session: Session) {
    val tint = providerColor(session.cliProvider)
    Text(
        providerLabel(session.cliProvider), color = tint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(tint.copy(alpha = .14f)).padding(horizontal = 7.dp, vertical = 3.dp),
    )
}

/** Compact tile: provider stripe, status, name, project and age, the last message. */
@Composable
internal fun SessionTile(row: SupervisedSession, selected: Boolean, actions: SessionTileActions, showProject: Boolean = true, selecting: Boolean = false, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val session = row.session
    val stripe = providerColor(session.cliProvider)
    val label = row.state.localizedLabel(context, session.facts())
    GlassPanel(
        modifier.fillMaxWidth().semantics { role = Role.Button; this.selected = selected; contentDescription = "${session.name}, $label" }.sessionClicks(session, selecting, actions),
        radius = 18.dp, borderColor = if (selected) PlumAccent else com.claudewebui.app.ui.components.common.PlumBorder,
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(4.dp).fillMaxHeight().background(stripe.copy(alpha = .8f)))
            Column(Modifier.padding(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 10.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    StatusRing(row.state, 8.dp)
                    Text(session.name, color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (session.starred) androidx.compose.material3.Icon(Icons.Outlined.Star, null, tint = PlumAccent, modifier = Modifier.size(14.dp))
                    if (session.unreadCount > 0) Badge { Text(session.unreadCount.coerceAtMost(99).toString()) }
                }
                TileMeta(session, showProject)
                val preview = when {
                    row.state.activity != SessionActivity.IDLE -> label
                    !session.lastMessage.isNullOrBlank() -> plainTextPreview(session.lastMessage!!, 160)
                    else -> label
                }
                Text(preview.replace(Regex("\\s+"), " "), color = PlumMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** A working directory with its sessions: count, one dot per session, latest activity. */
@Composable
private fun ProjectCard(path: String, rows: List<SupervisedSession>, expanded: Boolean, onToggle: () -> Unit) {
    val context = LocalContext.current
    val name = path.substringAfterLast('/').ifBlank { stringResource(R.string.overview_no_project) }
    val latest = rows.maxOf { it.session.lastTouched() }
    val needsYou = rows.count { it.state.group == SessionGroup.NEEDS_YOU }
    GlassPanel(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button, onClick = onToggle).animateContentSize(),
        radius = 20.dp, borderColor = if (needsYou > 0) PlumRed.copy(alpha = .6f) else com.claudewebui.app.ui.components.common.PlumBorder,
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(PlumAccent.copy(alpha = .14f)), contentAlignment = Alignment.Center) {
                androidx.compose.material3.Icon(Icons.Outlined.Folder, null, tint = PlumAccent)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(name, color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    rows.take(12).forEach { row -> Box(Modifier.size(7.dp).background(accentFor(row.state), CircleShape)) }
                    Text(
                        listOfNotNull(pluralStringResourceCompat(rows.size), ageLabel(latest, context).ifBlank { null }).joinToString(" · "),
                        color = PlumMuted, fontSize = 12.sp, maxLines = 1, modifier = Modifier.padding(start = 4.dp),
                    )
                }
                if (path.isNotBlank()) Text(path, color = PlumMuted.copy(alpha = .7f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            androidx.compose.material3.Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = PlumMuted)
        }
    }
}

@Composable
private fun pluralStringResourceCompat(count: Int): String = stringResource(R.string.overview_sessions_count, count)

/** Four columns side by side when they fit, otherwise scrolled sideways. */
@Composable
private fun SessionBoard(byGroup: Map<SessionGroup, List<SupervisedSession>>, selection: Set<String>, openSessionId: String?, actions: SessionTileActions) {
    val columns = listOf(
        SessionGroup.NEEDS_YOU to R.string.overview_board_needs_you,
        SessionGroup.WORKING to R.string.overview_board_working,
        SessionGroup.QUEUED to R.string.overview_board_waiting,
        SessionGroup.SETTLED to R.string.overview_board_done,
    )
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val fits = maxWidth >= 230.dp * 4
        val width = if (fits) (maxWidth - 30.dp) / 4 else 260.dp
        Row(
            Modifier.fillMaxWidth().then(if (fits) Modifier else Modifier.horizontalScroll(rememberScrollState())),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            columns.forEach { (group, title) ->
                val rows = byGroup[group].orEmpty().sortedByDescending { it.session.lastTouched() }
                Column(
                    Modifier.width(width).clip(RoundedCornerShape(20.dp)).background(com.claudewebui.app.ui.theme.PlumTheme.palette.subtleFill).padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(Modifier.padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.size(8.dp).background(groupTint(group), CircleShape))
                        Text(stringResource(title), color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Text(rows.size.toString(), color = PlumMuted, fontSize = 12.sp)
                    }
                    rows.take(30).forEach { row -> SessionTile(row, row.session.id in selection || row.session.id == openSessionId, actions) }
                    if (rows.size > 30) Text(stringResource(R.string.overview_more, rows.size - 30), color = PlumMuted, fontSize = 12.sp, modifier = Modifier.padding(6.dp))
                    if (rows.isEmpty()) Text("—", color = PlumMuted, modifier = Modifier.padding(horizontal = 6.dp, vertical = 10.dp))
                }
            }
        }
    }
}

@Composable
private fun groupTint(group: SessionGroup): Color = when (group) {
    SessionGroup.NEEDS_YOU -> PlumRed
    SessionGroup.WORKING -> PlumGreen
    SessionGroup.QUEUED -> com.claudewebui.app.ui.components.common.PlumAmber
    SessionGroup.SETTLED -> PlumMuted
}

/**
 * Long press on a tile: the last messages of the session and its actions,
 * without leaving the overview.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun SessionPreviewSheet(
    session: Session,
    state: SessionState,
    archived: Boolean,
    api: com.claudewebui.app.core.network.ApiClient,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onStar: () -> Unit,
    onArchive: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onMoveSurface: () -> Unit,
    onSelect: () -> Unit,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    var messages by remember(session.id) { mutableStateOf<List<com.claudewebui.app.data.model.Message>?>(null) }
    LaunchedEffect(session.id) {
        messages = runCatching { api.getMessages(session.id, limit = 12).data.orEmpty() }.getOrDefault(emptyList())
            .filter { it.role != MessageRole.SYSTEM && it.content.isNotBlank() }.takeLast(4)
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusRing(state)
                Text(session.name, style = MaterialTheme.typography.titleLarge, color = PlumText, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                ProviderTag(session)
            }
            Text(listOfNotNull(projectName(session).ifBlank { null }, session.cliModel, ageLabel(session.lastTouched(), context).ifBlank { null }).joinToString(" · "), color = PlumMuted, fontSize = 13.sp)
            Text(state.localizedLabel(context, session.facts()), color = PlumText, fontSize = 14.sp)
            when (val list = messages) {
                null -> LinearProgressIndicator(Modifier.fillMaxWidth())
                else -> list.forEach { message ->
                    val mine = message.role == MessageRole.USER
                    Text(
                        plainTextPreview(message.content, 360), fontSize = 13.sp, maxLines = 6, overflow = TextOverflow.Ellipsis,
                        color = PlumText,
                        modifier = Modifier.fillMaxWidth(if (mine) .85f else 1f).align(if (mine) Alignment.End else Alignment.Start)
                            .clip(RoundedCornerShape(14.dp)).background(if (mine) PlumAccent.copy(alpha = .14f) else com.claudewebui.app.ui.theme.PlumTheme.palette.subtleFill)
                            .padding(10.dp),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpen, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.overview_open)) }
                OutlinedButton(onClick = onStar) { Text(stringResource(if (session.starred) R.string.dashboard_remove_favorite_8b9da else R.string.dashboard_add_favorite_4914d)) }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onArchive) { Text(stringResource(if (archived) R.string.action_restore else R.string.action_archive)) }
                TextButton(onClick = onRename) { Text(stringResource(R.string.dashboard_rename_d3f4c)) }
                TextButton(onClick = onMove) { Text(stringResource(R.string.dashboard_move_to_category_8999f)) }
                TextButton(onClick = onMoveSurface) { Text(stringResource(if (session.surface == "task") R.string.assistant_move_to_code else R.string.assistant_move_to_task)) }
                TextButton(onClick = onSelect) { Text(stringResource(R.string.action_select)) }
                TextButton(onClick = onDelete) { Text(stringResource(R.string.dashboard_delete_f6fdb), color = PlumRed) }
            }
        }
    }
}
