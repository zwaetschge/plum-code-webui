package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuOpen
import androidx.compose.material.icons.automirrored.outlined.ViewList
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.ViewColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import kotlinx.coroutines.flow.MutableSharedFlow

/** Header-menu commands for the screen that owns the state; HISTORY goes the other way (start page → history). */
enum class DashboardMenuCommand { VOICE_MODE, VOICE, WRITING_STYLE, SELECT_SESSIONS, HISTORY, PROJECTS, ASSISTANTS, CHAT }

/** Carries header-menu commands to the screen that owns the state (chat sheets, list selection). */
object DashboardMenuBus {
    val events = MutableSharedFlow<DashboardMenuCommand>(extraBufferCapacity = 4)
    fun send(command: DashboardMenuCommand) { events.tryEmit(command) }
}

/**
 * The ≡ button at the top right of every area, and its dropdown.
 *
 * It replaced the bottom bar, the Tune button and the area's single round
 * button: what belongs to the area comes first (new chat, history, voice,
 * writing style · new session, view, archive, selection · emergency), then the
 * same global entries everywhere: notifications, Analyse, Bibliothek,
 * Einstellungen. Notifications open as a sheet right here.
 */
@Composable
internal fun AreaHeaderMenu(
    area: String,
    viewModel: DashboardViewModel,
    onNavigateMain: (MainDestination) -> Unit,
    onOpenSession: (String) -> Unit,
    onNewChat: () -> Unit = {},
    onHistory: (() -> Unit)? = null,
    onHideList: (() -> Unit)? = null,
    onEmergency: () -> Unit = {},
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val views by SessionViewPrefs.flow(context).collectAsStateWithLifecycle()
    var open by remember { mutableStateOf(false) }
    var notifications by remember { mutableStateOf(false) }
    val sessions = area == "task" || area == "code"
    val attention = state.unreadNotifications + if (sessions) 0 else state.attentionCount
    Box {
        BadgedBox(badge = { if (attention > 0) Badge { Text(attention.coerceAtMost(99).toString()) } }) {
            PlumRoundButton(Icons.Outlined.Menu, stringResource(R.string.menu_open), { open = true })
        }
        DropdownMenu(open, { open = false }) {
            fun item(label: String, icon: ImageVector, trailing: (@Composable () -> Unit)? = null, action: () -> Unit): @Composable () -> Unit = {
                DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, trailingIcon = trailing, onClick = { open = false; action() })
            }
            when (area) {
                "chat" -> {
                    item(stringResource(R.string.menu_new_chat), Icons.Outlined.EditNote, action = onNewChat)()
                    if (onHistory != null) item(stringResource(R.string.assistant_history), Icons.Outlined.History, action = onHistory)()
                    if (onHideList != null) item(stringResource(R.string.workspace_hide_list), Icons.AutoMirrored.Outlined.MenuOpen, action = onHideList)()
                    item(stringResource(R.string.voice_mode_title), Icons.Outlined.GraphicEq) { DashboardMenuBus.send(DashboardMenuCommand.VOICE_MODE) }()
                    item(stringResource(R.string.voice_mode_change_voice), Icons.Outlined.RecordVoiceOver) { DashboardMenuBus.send(DashboardMenuCommand.VOICE) }()
                    item(stringResource(R.string.menu_writing_style), Icons.Outlined.EditNote) { DashboardMenuBus.send(DashboardMenuCommand.WRITING_STYLE) }()
                }
                "task", "code" -> {
                    item(stringResource(R.string.dashboard_new_session_5c881), Icons.Outlined.Add) { viewModel.requestNewSession() }()
                    val current = views[area] ?: SessionView.SITUATION
                    listOf(
                        Triple(SessionView.SITUATION, R.string.session_view_situation, Icons.Outlined.Dashboard),
                        Triple(SessionView.PROJECTS, R.string.session_view_projects, Icons.Outlined.AccountTree),
                        Triple(SessionView.BOARD, R.string.session_view_board, Icons.Outlined.ViewColumn),
                    ).forEach { (view, label, icon) ->
                        item(stringResource(label), icon, trailing = if (view == current) ({ Icon(Icons.Outlined.Check, null, tint = PlumAccent, modifier = Modifier.size(18.dp)) }) else null) {
                            SessionViewPrefs.set(context, area, view)
                        }()
                    }
                    item(
                        stringResource(R.string.dashboard_archive_2621c), Icons.Outlined.Archive,
                        trailing = if (state.showArchived) ({ Icon(Icons.Outlined.Check, null, tint = PlumAccent, modifier = Modifier.size(18.dp)) }) else null,
                    ) { viewModel.toggleArchiveView() }()
                    item(stringResource(R.string.menu_select_sessions), Icons.Outlined.Checklist) { DashboardMenuBus.send(DashboardMenuCommand.SELECT_SESSIONS) }()
                }
                "hermes" -> item(stringResource(R.string.assistant_emergency), Icons.Outlined.Shield, action = onEmergency)()
            }
            HorizontalDivider()
            item(
                stringResource(R.string.menu_notifications), Icons.Outlined.Notifications,
                trailing = if (state.unreadNotifications > 0) ({ Badge { Text(state.unreadNotifications.coerceAtMost(99).toString()) } }) else null,
            ) { viewModel.loadNotifications(); notifications = true }()
            item(stringResource(R.string.component_analytics), Icons.Outlined.Analytics) { onNavigateMain(MainDestination.ANALYTICS) }()
            item(stringResource(R.string.component_library), Icons.Outlined.FolderOpen) { onNavigateMain(MainDestination.LIBRARY) }()
            item(stringResource(R.string.component_settings), Icons.Outlined.Settings) { onNavigateMain(MainDestination.SETTINGS) }()
        }
    }
    if (notifications) NotificationsSheet(viewModel, onDismiss = { notifications = false }, onOpenSession = { notifications = false; onOpenSession(it) })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NotificationsSheet(viewModel: DashboardViewModel, onDismiss: () -> Unit, onOpenSession: (String) -> Unit) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PlumSurfaceStrong) {
        NotificationFeedContent(
            notifications = state.notifications,
            pendingRequestIds = state.pendingApprovals.map { it.requestId }.toSet(),
            respondingRequestIds = state.respondingApprovals,
            unreadCount = state.unreadNotifications,
            onOpenSession = onOpenSession,
            onMarkAllRead = { viewModel.markNotificationsRead() },
            onClearAll = { viewModel.clearNotifications() },
            onRespond = { item, allow -> viewModel.respondToApproval(item, allow) },
        )
    }
}
