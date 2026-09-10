package com.claudewebui.app.ui.screens.dashboard

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Brightness4
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Badge
import androidx.compose.material3.Surface
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalDensity
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.MessageSearchResult
import com.claudewebui.app.data.model.PendingPermissionItem
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.LocalPlumSnackbar
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.SectionHeading
import com.claudewebui.app.ui.components.common.fadingEdges
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.components.common.isShortWindow
import com.claudewebui.app.ui.components.common.listColumns
import com.claudewebui.app.ui.components.common.PlumContentWidth
import com.claudewebui.app.ui.components.common.rememberWindowWidth
import com.claudewebui.app.ui.components.common.WindowWidth
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.components.common.sessionModel
import com.claudewebui.app.ui.components.dashboard.CategoryManager
import com.claudewebui.app.ui.components.dashboard.IdlePrefs
import com.claudewebui.app.ui.components.dashboard.SessionState
import com.claudewebui.app.ui.components.dashboard.accentFor
import com.claudewebui.app.ui.components.dashboard.effectiveState
import com.claudewebui.app.ui.components.dashboard.superviseSessions
import com.claudewebui.app.ui.components.dashboard.NewSessionDialog
import org.koin.compose.viewmodel.koinViewModel
import com.claudewebui.app.ui.components.common.PlumAmber

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onNavigateToChat: (sessionId: String) -> Unit,
    onNavigateToMessage: (sessionId: String, messageId: String, chatId: String?) -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit = {},
    viewModel: DashboardViewModel = koinViewModel(),
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    var showNewSessionDialog by remember { mutableStateOf(false) }
    // Selection mode drives the bulk action bar; archiving replaces deleting as
    // the default way to get a session out of the list.
    val selectionActive = state.selectedSessionIds.isNotEmpty()
    var selectedFilter by remember { mutableStateOf("All") }
    var showNotifications by remember { mutableStateOf(false) }
    var showCategoryManager by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<Session?>(null) }
    var categoryTarget by remember { mutableStateOf<Session?>(null) }
    var deleteTarget by remember { mutableStateOf<Session?>(null) }

    val snackbar = LocalPlumSnackbar.current
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is DashboardEvent.NavigateToChat -> onNavigateToChat(event.sessionId)
                is DashboardEvent.NavigateToMessage -> onNavigateToMessage(
                    event.sessionId,
                    event.messageId,
                    event.chatId,
                )
                is DashboardEvent.SessionCreated -> showNewSessionDialog = false
                DashboardEvent.ShowNewSessionDialog -> showNewSessionDialog = true
                DashboardEvent.ShowCategoryManager -> showCategoryManager = true
                DashboardEvent.NavigateToSettings -> onNavigateToSettings()
                is DashboardEvent.ShowError -> snackbar.showSnackbar(event.message)
                else -> Unit
            }
        }
    }

    // How long a session may claim to be working with nothing to show for it
    // before the dashboard says so instead. Read as a flow so changing it in
    // Settings repaints the open dashboard.
    val idleAfter by IdlePrefs.threshold.collectAsState()

    val visibleSessions = state.filteredSessions.filter { session ->
        when (selectedFilter) {
            "Running" -> session.status == SessionStatus.RUNNING
            "Starred" -> session.starred
            "Recent" -> isRecentlyUpdated(session.updatedAt)
            else -> true
        }
    }
    val runningCount = state.sessions.count { it.status == SessionStatus.RUNNING }
    // From the gateway overview, not derived here: a session blocked on an
    // approval is still "running", so counting ERROR rows missed exactly the
    // sessions that are waiting on the user.
    val attentionCount = state.attentionCount

    // Launcher shortcuts come from the shared ViewModel; this row only mirrors
    // the same ordering on screen.
    val quickSwitchSessions = remember(state.sessions) {
        state.sessions.sortedByDescending { it.updatedAt }.take(5)
    }

    PlumBackdrop {
        PlumNavScaffold(
            selected = MainDestination.SESSIONS,
            onNavigate = onNavigateMain,
            badgeCount = attentionCount,
            floatingActionButton = {
                Box(
                    modifier = Modifier
                        .size(62.dp)
                        .clip(RoundedCornerShape(screenTokens.radius.panel))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFC46DFF), Color(0xFF317CF4)),
                            ),
                        )
                        .clickable { showNewSessionDialog = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Add, screenResources.getString(R.string.dashboard_new_session_5c881), tint = Color.White, modifier = Modifier.size(32.dp))
                }
            },
        ) { padding ->
            // Phones and short windows prioritize the actual session list;
            // expanded windows use two real columns with a capped line length.
            val windowWidth = rememberWindowWidth()
            // The expanded rail already provides hierarchy on wide screens, so
            // keep metrics/search in two compact rows there. Portrait phones
            // retain the richer hero cards where vertical space is plentiful.
            val compactHeader = isShortWindow() || windowWidth != WindowWidth.COMPACT
            val largeText = LocalDensity.current.fontScale >= 1.5f
            val columns = listColumns()
            PlumContentWidth(
                // Only the top inset shrinks the surface; the bottom inset goes
                // into the grid's contentPadding so cards scroll *under* the
                // floating nav bar instead of ending in a hard edge above it.
                modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
                max = 1180.dp,
            ) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                // Cards fade out under the floating nav bar instead of ending
                // in a straight line across the glass.
                modifier = Modifier.fillMaxSize().fadingEdges(bottom = 36.dp),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 12.dp,
                    bottom = 12.dp + padding.calculateBottomPadding(),
                ),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.cozy),
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.cozy),
            ) {
                if (compactHeader) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        CompactSessionsHeader(
                            online = !state.isOffline,
                            runningCount = runningCount,
                            approvals = attentionCount,
                            showMetricPills = windowWidth != WindowWidth.COMPACT,
                            unreadNotifications = state.unreadNotifications,
                            onNotifications = {
                                viewModel.loadNotifications()
                                showNotifications = true
                            },
                            onSettings = onNavigateToSettings,
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        if (windowWidth == WindowWidth.COMPACT || largeText) {
                            DashboardSearchField(
                                value = state.searchQuery,
                                onValueChange = viewModel::setSearchQuery,
                                placeholder = if (state.searchScope == DashboardSearchScope.MESSAGES) {
                                    screenResources.getString(R.string.dashboard_search_every_message_5f424)
                                } else screenResources.getString(R.string.dashboard_search_sessions_folders_or_providers_a7ef1),
                                showShortcutHint = false,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        } else {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                DashboardSearchField(
                                    value = state.searchQuery,
                                    onValueChange = viewModel::setSearchQuery,
                                    placeholder = if (state.searchScope == DashboardSearchScope.MESSAGES) {
                                        screenResources.getString(R.string.dashboard_search_every_message_5f424)
                                    } else screenResources.getString(R.string.dashboard_search_sessions_folders_or_providers_a7ef1),
                                    showShortcutHint = false,
                                    modifier = Modifier.weight(1f),
                                )
                                listOf("All", "Running", "Starred", "Recent").forEach { label ->
                                    FilterPill(
                                        label = if (label == "All") screenResources.getString(R.string.dashboard_all_1_s_a86c9, state.sessions.size) else dashboardFilterLabel(label, screenResources),
                                        selected = selectedFilter == label,
                                        onClick = { selectedFilter = label },
                                    )
                                }
                            }
                        }
                    }
                    if (windowWidth == WindowWidth.COMPACT || largeText) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                                items(listOf("All", "Running", "Starred", "Recent")) { label ->
                                FilterPill(
                                    label = if (label == "All") screenResources.getString(R.string.dashboard_all_1_s_a86c9, state.sessions.size) else dashboardFilterLabel(label, screenResources),
                                    selected = selectedFilter == label,
                                    onClick = { selectedFilter = label },
                                )
                                }
                                item {
                                    FilterPill(
                                        label = if (state.showArchived) screenResources.getString(R.string.dashboard_archive_2621c) else screenResources.getString(R.string.dashboard_archive_2621c),
                                        selected = state.showArchived,
                                        onClick = { viewModel.toggleArchiveView() },
                                    )
                                }
                            }
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        CategoryFilterRow(
                            categories = state.categories,
                            selectedCategoryId = state.selectedCategoryId,
                            onSelect = viewModel::filterByCategory,
                            onManage = viewModel::onCategoryManagerTapped,
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DiscoveredProjectsRow(
                            projects = state.discoveredProjects,
                            expanded = state.showDiscoveredProjects,
                            onToggle = viewModel::toggleDiscoveredProjects,
                            onOpen = { project ->
                                viewModel.createSession(
                                    name = project.name,
                                    workingDirectory = project.path,
                                    provider = state.availableProviders.firstOrNull()
                                        ?: CLIProvider.active.first(),
                                )
                            },
                        )
                    }
                } else {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        SessionsHeader(
                            online = !state.isOffline,
                            unreadNotifications = state.unreadNotifications,
                            onNotifications = {
                                viewModel.loadNotifications()
                                showNotifications = true
                            },
                            onSettings = onNavigateToSettings,
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
                        ) {
                            WorkspaceHero(
                                runningCount = runningCount,
                                sessions = state.sessions,
                                modifier = Modifier.weight(1.45f),
                            )
                            ApprovalHero(
                                count = attentionCount,
                                pendingCount = state.pendingApprovals.size,
                                onClick = { viewModel.setApprovalsVisible(true) },
                                modifier = Modifier.weight(.95f),
                            )
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardSearchField(
                            value = state.searchQuery,
                            onValueChange = viewModel::setSearchQuery,
                            placeholder = if (state.searchScope == DashboardSearchScope.MESSAGES) {
                                screenResources.getString(R.string.dashboard_search_every_message_5f424)
                            } else screenResources.getString(R.string.dashboard_search_sessions_folders_or_providers_a7ef1),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            listOf("All", "Running", "Starred", "Recent").forEach { label ->
                                FilterPill(
                                    label = if (label == "All") screenResources.getString(R.string.dashboard_all_1_s_a86c9, state.sessions.size) else dashboardFilterLabel(label, screenResources),
                                    selected = selectedFilter == label,
                                    onClick = { selectedFilter = label },
                                )
                            }
                        }
                    }
                }
                if (state.isOffline && state.sessions.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.CloudOff,
                            title = screenResources.getString(R.string.dashboard_offline_showing_cached_sessions_6b280),
                            detail = screenResources.getString(R.string.dashboard_changes_from_other_devices_will_appear_after_reconnecting_0c3c1),
                            onRetry = viewModel::refresh,
                            compact = true,
                        )
                    }
                } else if (state.error != null && state.sessions.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.ErrorOutline,
                            title = screenResources.getString(R.string.dashboard_refresh_failed_3d1f4),
                            detail = state.error.orEmpty(),
                            onRetry = viewModel::refresh,
                            compact = true,
                        )
                    }
                }
                // Jumping back into the session you just left should not mean
                // scrolling a grid sorted by everything at once.
                if (quickSwitchSessions.isNotEmpty() && state.searchQuery.isBlank()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        QuickSwitchRow(
                            sessions = quickSwitchSessions,
                            onOpen = { onNavigateToChat(it) },
                        )
                    }
                }
                item(span = { GridItemSpan(maxLineSpan) }) {
                    SectionHeading(
                        title = if (state.searchScope == DashboardSearchScope.MESSAGES) {
                            screenResources.getString(R.string.dashboard_message_results_c5e3f)
                        } else screenResources.getString(R.string.dashboard_recent_sessions_3a63b),
                        // The old label said "Updated now" unconditionally,
                        // which is a claim, not a status. Only a real timestamp
                        // earns a line here — and it sits beside the title,
                        // because the trailing slot is exactly where the
                        // new-session button rests in landscape.
                        caption = state.lastRefreshedAt?.let { screenResources.getString(R.string.dashboard_updated_1_s_66b44, refreshAgeLabel(it)) },
                    )
                }
                if (state.searchScope == DashboardSearchScope.MESSAGES) {
                    when {
                        state.isSearchingMessages -> item(span = { GridItemSpan(maxLineSpan) }) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                        }
                        state.messageSearchError != null -> item(span = { GridItemSpan(maxLineSpan) }) {
                            DashboardStatePanel(
                                icon = Icons.Outlined.ErrorOutline,
                                title = screenResources.getString(R.string.dashboard_search_failed_e2e90),
                                detail = state.messageSearchError.orEmpty(),
                                onRetry = { viewModel.setSearchQuery(state.searchQuery) },
                            )
                        }
                        state.searchQuery.length >= 2 && state.messageSearchResults.isEmpty() -> {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                DashboardStatePanel(
                                    icon = Icons.Outlined.Search,
                                    title = screenResources.getString(R.string.dashboard_no_matching_messages_34e61),
                                    detail = screenResources.getString(R.string.dashboard_try_a_different_phrase_32f91),
                                    onRetry = null,
                                )
                            }
                        }
                        else -> gridItems(
                            state.messageSearchResults,
                            key = { "${it.sessionId}_${it.id}" },
                        ) { result ->
                            MessageSearchResultCard(
                                result = result,
                                query = state.searchQuery,
                                onClick = { viewModel.onMessageResultTapped(result) },
                            )
                        }
                    }
                } else if (state.isInitialLoading) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = PlumAccent)
                        }
                    }
                } else if (visibleSessions.isEmpty() && state.isOffline) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.CloudOff,
                            title = screenResources.getString(R.string.dashboard_you_re_offline_f4d9c),
                            detail = screenResources.getString(R.string.dashboard_no_cached_sessions_are_available_yet_28d92),
                            onRetry = viewModel::refresh,
                        )
                    }
                } else if (visibleSessions.isEmpty() && state.error != null) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.ErrorOutline,
                            title = screenResources.getString(R.string.dashboard_sessions_couldn_t_be_loaded_28c04),
                            detail = state.error.orEmpty(),
                            onRetry = viewModel::refresh,
                        )
                    }
                } else if (visibleSessions.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.ChatBubbleOutline,
                            title = if (state.searchQuery.isBlank() && selectedFilter == "All") {
                                screenResources.getString(R.string.dashboard_no_sessions_yet_9d778)
                            } else {
                                screenResources.getString(R.string.dashboard_no_matching_sessions_0318e)
                            },
                            detail = if (state.searchQuery.isBlank() && selectedFilter == "All") {
                                screenResources.getString(R.string.dashboard_create_one_to_start_working_dee2a)
                            } else {
                                screenResources.getString(R.string.dashboard_try_another_search_or_filter_08a85)
                            },
                            onRetry = null,
                        )
                    }
                } else {
                    // Grouped by what each session wants from you rather than
                    // by name or timestamp: finding the one that is blocked on an
                    // approval is the whole job of this screen, and it used to
                    // sit wherever its update time happened to put it.
                    superviseSessions(
                        visibleSessions,
                        idleAfterMinutes = idleAfter.minutes,
                    ).forEach { section ->
                        item(
                            key = "section_${section.group.name}",
                            span = { GridItemSpan(maxLineSpan) },
                        ) {
                            SectionHeading(
                                section.group.header,
                                modifier = Modifier.padding(top = screenTokens.spacing.xs),
                                caption = section.sessions.size.toString(),
                            )
                        }
                        gridItems(section.sessions, key = { it.session.id }) { row ->
                            PlumSessionCard(
                                session = row.session,
                                state = row.state,
                                onClick = { onNavigateToChat(row.session.id) },
                                onToggleStar = { viewModel.toggleStar(row.session.id) },
                                onRename = { renameTarget = row.session },
                                onMove = { categoryTarget = row.session },
                                onDelete = { deleteTarget = row.session },
                            )
                        }
                    }
                }
                item(span = { GridItemSpan(maxLineSpan) }) { Spacer(Modifier.height(72.dp)) }
            }
            }
        }
    }

    if (showNewSessionDialog) {
        NewSessionDialog(
            categories = state.categories,
            providers = state.availableProviders,
            presets = state.sessionPresets,
            lastSetup = state.lastSessionSetup,
            templates = state.sessionTemplates,
            isCreating = state.isCreatingSession,
            creationError = state.creationError,
            onDismiss = {
                if (!state.isCreatingSession) {
                    showNewSessionDialog = false
                    viewModel.clearCreationError()
                }
            },
            onCreate = { name, provider, directory, mode, categoryId ->
                viewModel.createSession(name, directory, provider, mode, categoryId)
            },
        )
    }

    if (showCategoryManager) {
        CategoryManager(
            categories = state.categories,
            onDismiss = { showCategoryManager = false },
            onCreate = viewModel::createCategory,
            onUpdate = viewModel::updateCategory,
            onDelete = viewModel::deleteCategory,
            onReorder = viewModel::reorderCategories,
        )
    }

    if (state.showApprovals) {
        ModalBottomSheet(
            onDismissRequest = { viewModel.setApprovalsVisible(false) },
            containerColor = PlumSurfaceStrong,
        ) {
            PendingApprovalsSheet(
                approvals = state.pendingApprovals,
                responding = state.respondingApprovals,
                sessionNames = state.sessions.associate { it.id to it.name },
                onRespond = viewModel::respondToPendingApproval,
                onOpenSession = { sessionId ->
                    viewModel.setApprovalsVisible(false)
                    onNavigateToChat(sessionId)
                },
            )
        }
    }

    if (showNotifications) {
        ModalBottomSheet(
            onDismissRequest = { showNotifications = false },
            containerColor = PlumSurfaceStrong,
        ) {
            NotificationFeedContent(
                notifications = state.notifications,
                unreadCount = state.unreadNotifications,
                onOpenSession = { sessionId ->
                    showNotifications = false
                    onNavigateToChat(sessionId)
                },
                onMarkAllRead = { viewModel.markNotificationsRead() },
                onClearAll = { viewModel.clearNotifications() },
                onRespond = { item, allow -> viewModel.respondToApproval(item, allow) },
            )
        }
    }

    renameTarget?.let { target ->
        RenameSessionDialog(
            session = target,
            onDismiss = { renameTarget = null },
            onRename = { name ->
                renameTarget = null
                viewModel.renameSession(target.id, name)
            },
        )
    }
    categoryTarget?.let { target ->
        MoveSessionDialog(
            session = target,
            categories = state.categories,
            onDismiss = { categoryTarget = null },
            onMove = { categoryId ->
                categoryTarget = null
                viewModel.moveSessionToCategory(target.id, categoryId)
            },
        )
    }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(screenResources.getString(R.string.dashboard_delete_session_9ff1a)) },
            text = { Text(screenResources.getString(R.string.dashboard_1_s_and_its_chat_history_will_be_removed_c245e, target.name)) },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget = null
                    viewModel.deleteSession(target.id)
                }) { Text(screenResources.getString(R.string.dashboard_delete_f6fdb), color = PlumRed) }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text(screenResources.getString(R.string.dashboard_cancel_77dfd)) }
            },
        )
    }
}

@Composable
private fun RenameSessionDialog(
    session: Session,
    onDismiss: () -> Unit,
    onRename: (String) -> Unit,
) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var name by remember(session.id) { mutableStateOf(session.name) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(screenResources.getString(R.string.dashboard_rename_session_25fc9)) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(screenResources.getString(R.string.dashboard_name_709a2)) },
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(onClick = { onRename(name.trim()) }, enabled = name.isNotBlank()) {
                Text(screenResources.getString(R.string.dashboard_save_efc00))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(screenResources.getString(R.string.dashboard_cancel_77dfd)) } },
    )
}

@Composable
private fun MoveSessionDialog(
    session: Session,
    categories: List<Category>,
    onDismiss: () -> Unit,
    onMove: (String?) -> Unit,
) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(screenResources.getString(R.string.dashboard_move_1_s_4b87b, session.name)) },
        text = {
            Column {
                TextButton(
                    onClick = { onMove(null) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(screenResources.getString(R.string.dashboard_no_category_fdc24), modifier = Modifier.weight(1f)) }
                categories.forEach { category ->
                    TextButton(
                        onClick = { onMove(category.id) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text(category.name, modifier = Modifier.weight(1f)) }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(screenResources.getString(R.string.dashboard_cancel_77dfd)) } },
    )
}

@Composable
private fun DashboardStatePanel(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String,
    onRetry: (() -> Unit)?,
    compact: Boolean = false,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth()) {
        if (compact) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.md),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
            ) {
                Icon(icon, null, tint = PlumMuted, modifier = Modifier.size(screenTokens.sizing.iconLg))
                Column(Modifier.weight(1f)) {
                    Text(title, color = PlumText, fontWeight = FontWeight.SemiBold)
                    Text(detail, color = PlumMuted, fontSize = 12.sp)
                }
                onRetry?.let { TextButton(onClick = it) { Text(screenResources.getString(R.string.dashboard_retry_9f5cd)) } }
            }
        } else {
            Column(
                Modifier.fillMaxWidth().padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
            ) {
                Icon(icon, null, tint = PlumMuted, modifier = Modifier.size(32.dp))
                Text(title, color = PlumText, fontWeight = FontWeight.SemiBold)
                Text(detail, color = PlumMuted, fontSize = 13.sp)
                onRetry?.let {
                    Button(onClick = it, modifier = Modifier.heightIn(min = 48.dp)) { Text(screenResources.getString(R.string.dashboard_retry_9f5cd)) }
                }
            }
        }
    }
}

/**
 * One-line header for short (landscape/fold-wide) windows: title, live and
 * approval counts as slim pills, connectivity and settings — replaces the
 * 126dp hero cards that would otherwise push the session list off screen.
 */
@Composable
private fun CompactSessionsHeader(
    online: Boolean,
    runningCount: Int,
    approvals: Int,
    showMetricPills: Boolean,
    unreadNotifications: Int,
    onNotifications: () -> Unit,
    onSettings: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFBF67F5), Color(0xFF2E7AEF)))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(screenTokens.sizing.iconInline))
        }
        Column {
            Text(screenResources.getString(R.string.dashboard_sessions_e11e3), color = PlumText, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            if (!showMetricPills) {
                Text(
                    screenResources.getString(R.string.dashboard_1_s_active_2_s_need_attention_29ba9, runningCount, approvals),
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
            }
        }

        if (showMetricPills) Box(
            modifier = Modifier
                .clip(RoundedCornerShape(15.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFBB65EF), Color(0xFF2D7CE8))))
                .padding(horizontal = screenTokens.spacing.md, vertical = 7.dp),
        ) {
            Text(
                text = if (runningCount == 1) screenResources.getString(R.string.dashboard_1_active_session_050e7) else screenResources.getString(R.string.dashboard_1_s_active_sessions_9b1f6, runningCount),
                color = Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (showMetricPills) Row(
            modifier = Modifier
                .glassSurface(RoundedCornerShape(15.dp))
                .padding(horizontal = 11.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Icon(
                Icons.Outlined.WarningAmber,
                contentDescription = null,
                tint = if (approvals > 0) PlumAmber else PlumMuted,
                modifier = Modifier.size(screenTokens.sizing.iconXs),
            )
            Text(
                text = if (approvals == 1) screenResources.getString(R.string.dashboard_1_approval_b75cb) else screenResources.getString(R.string.dashboard_1_s_approvals_8eef1, approvals),
                color = if (approvals > 0) PlumText else PlumMuted,
                fontSize = 12.sp,
            )
        }

        Spacer(Modifier.weight(1f))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(if (online) PlumGreen else PlumRed, CircleShape))
            Spacer(Modifier.width(6.dp))
            Text(
                if (online) screenResources.getString(R.string.dashboard_online_c3e83) else screenResources.getString(R.string.dashboard_offline_e01fa),
                color = PlumMuted,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        NotificationBell(unreadNotifications, onNotifications)
        PlumIconButton(Icons.Outlined.Brightness4, screenResources.getString(R.string.dashboard_settings_c7f73), onSettings)
    }
}

@Composable
internal fun DashboardSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = androidx.compose.ui.res.stringResource(R.string.dashboard_search_sessions_folders_or_providers_a7ef1),
    modifier: Modifier = Modifier,
    showShortcutHint: Boolean = true,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    TextField(
        value = value,
        onValueChange = onValueChange,
        // singleLine only constrains the value; the placeholder is a composable of
        // its own and wrapped to two lines in the narrow tablet pane.
        placeholder = {
            Text(placeholder, color = PlumMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        leadingIcon = { Icon(Icons.Outlined.Search, null, tint = PlumMuted) },
        trailingIcon = if (showShortcutHint) {
            {
                Box(
                    Modifier
                        .border(1.dp, PlumBorder, RoundedCornerShape(9.dp))
                        .padding(horizontal = screenTokens.spacing.sm, vertical = 5.dp),
                ) {
                    Text("⌘ K", color = PlumMuted, fontSize = 11.sp)
                }
            }
        } else {
            null
        },
        singleLine = true,
        shape = RoundedCornerShape(18.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = PlumSurfaceStrong,
            unfocusedContainerColor = PlumSurfaceStrong,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = PlumAccent,
            focusedTextColor = PlumText,
            unfocusedTextColor = PlumText,
        ),
        modifier = modifier.border(1.dp, PlumBorder, RoundedCornerShape(18.dp)),
    )
}

@Composable
private fun MessageSearchResultCard(
    result: MessageSearchResult,
    query: String,
    onClick: () -> Unit,
) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = PlumSurfaceStrong,
        border = androidx.compose.foundation.BorderStroke(1.dp, PlumBorder),
    ) {
        Column(
            Modifier.padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    result.sessionName ?: screenResources.getString(R.string.dashboard_session_f7f19),
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    result.role.replaceFirstChar { it.uppercase() },
                    color = PlumAccent,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Text(
                dashboardSearchSnippet(result.content, query),
                color = PlumMuted,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

internal fun dashboardSearchSnippet(content: String, query: String, radius: Int = 70): String {
    val text = content.replace(Regex("\\s+"), " ").trim()
    val index = text.indexOf(query.trim(), ignoreCase = true)
    if (index < 0) return text.take(radius * 2)
    val start = (index - radius).coerceAtLeast(0)
    val end = (index + query.length + radius).coerceAtMost(text.length)
    return (if (start > 0) "…" else "") + text.substring(start, end) +
        (if (end < text.length) "…" else "")
}

@Composable
private fun SessionsHeader(
    online: Boolean,
    unreadNotifications: Int,
    onNotifications: () -> Unit,
    onSettings: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(screenTokens.sizing.touchTarget)
                .clip(RoundedCornerShape(screenTokens.radius.lg))
                .background(Brush.linearGradient(listOf(Color(0xFFBF67F5), Color(0xFF2E7AEF))))
                .border(1.dp, PlumAccent, RoundedCornerShape(screenTokens.radius.lg)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(27.dp))
        }
        Column(Modifier.padding(start = screenTokens.spacing.md).weight(1f)) {
            Text(screenResources.getString(R.string.dashboard_plum_code_134e1), color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text(screenResources.getString(R.string.dashboard_sessions_e11e3), color = PlumText, fontSize = 31.sp, fontWeight = FontWeight.Bold)
        }
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(screenTokens.radius.xl))
                .background(PlumSurfaceStrong)
                .border(1.dp, PlumBorder, RoundedCornerShape(screenTokens.radius.xl))
                .padding(horizontal = 13.dp, vertical = screenTokens.spacing.compact),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(9.dp).background(if (online) PlumGreen else PlumRed, CircleShape))
            Spacer(Modifier.width(7.dp))
            Text(if (online) screenResources.getString(R.string.dashboard_online_c3e83) else screenResources.getString(R.string.dashboard_offline_e01fa), color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
        Spacer(Modifier.width(8.dp))
        NotificationBell(unreadNotifications, onNotifications)
        PlumIconButton(Icons.Outlined.Brightness4, screenResources.getString(R.string.dashboard_settings_c7f73), onSettings)
    }
}

@Composable
private fun WorkspaceHero(runningCount: Int, sessions: List<Session>, modifier: Modifier = Modifier) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Box(
        modifier = modifier
            .height(126.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Brush.linearGradient(listOf(Color(0xFFBB65EF), Color(0xFF2D7CE8))))
            .padding(18.dp),
    ) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Text(screenResources.getString(R.string.dashboard_live_workspace_81a60), color = Color.White.copy(alpha = .74f), fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.Bottom) {
                Text(runningCount.toString(), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                Text(screenResources.getString(R.string.dashboard_active_sessions_4573b), color = Color.White.copy(alpha = .85f), modifier = Modifier.padding(bottom = 7.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row {
                    sessions.filter { it.status == SessionStatus.RUNNING }.take(4).forEachIndexed { index, session ->
                        Box(
                            Modifier
                                .padding(start = if (index == 0) 0.dp else 2.dp)
                                .size(screenTokens.sizing.iconMd)
                                .background(providerColor(session.cliProvider), CircleShape)
                                .border(2.dp, Color(0xFF5937A7), CircleShape),
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                Text(screenResources.getString(R.string.dashboard_providers_are_working_6aad9), color = Color.White.copy(alpha = .72f), fontSize = 11.sp, maxLines = 1)
            }
        }
    }
}

/**
 * @param count sessions the server flags as needing a human.
 * @param pendingCount individual approvals waiting, which can exceed [count]
 *   when one session asks several times.
 */
@Composable
private fun ApprovalHero(
    count: Int,
    pendingCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(
        modifier = modifier
            .height(126.dp)
            .clip(RoundedCornerShape(22.dp))
            .semantics { role = Role.Button }
            .clickable(onClick = onClick),
        radius = 22.dp,
    ) {
        Column(
            Modifier.fillMaxSize().padding(screenTokens.spacing.lg),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Box(
                Modifier.size(36.dp).background(Color(0x3DFFAA14), RoundedCornerShape(screenTokens.radius.md)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.WarningAmber, null, tint = if (count > 0) PlumAmber else PlumMuted)
            }
            Text(
                if (count == 1) screenResources.getString(R.string.dashboard_1_session_waiting_2ac02) else screenResources.getString(R.string.dashboard_1_s_sessions_waiting_48939, count),
                color = PlumText,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            Text(
                when {
                    pendingCount == 1 -> screenResources.getString(R.string.dashboard_1_approval_tap_to_answer_642d9)
                    pendingCount > 1 -> screenResources.getString(R.string.dashboard_1_s_approvals_tap_to_answer_fe3f9, pendingCount)
                    count > 0 -> screenResources.getString(R.string.dashboard_a_session_needs_your_attention_39d44)
                    else -> screenResources.getString(R.string.dashboard_nothing_is_waiting_95091)
                },
                color = PlumMuted,
                fontSize = 12.sp,
                maxLines = 2,
            )
        }
    }
}

/**
 * Every approval waiting on this user, from any session, answerable in place.
 *
 * The agent is blocked while it waits, so making the user open the session
 * first costs time exactly when it is most expensive. Only allow-once and deny
 * are offered here: the broader "allow for project/globally" choices edit a
 * settings file and deserve the full dialog in the session.
 */
@Composable
private fun PendingApprovalsSheet(
    approvals: List<PendingPermissionItem>,
    responding: Set<String>,
    sessionNames: Map<String, String>,
    onRespond: (PendingPermissionItem, Boolean) -> Unit,
    onOpenSession: (String) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = screenTokens.spacing.section)
            .padding(bottom = screenTokens.spacing.xl),
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
    ) {
        SectionHeading(screenResources.getString(R.string.dashboard_waiting_for_you_e235e))
        if (approvals.isEmpty()) {
            Text(
                screenResources.getString(R.string.dashboard_nothing_is_waiting_approvals_appear_here_the_moment_an_agent_asks_b5d3e),
                color = PlumMuted,
                fontSize = 13.sp,
            )
            return@Column
        }
        LazyColumn(
            modifier = Modifier.heightIn(max = 420.dp),
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
        ) {
            items(approvals, key = { it.requestId }) { item ->
                val busy = item.requestId in responding
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(screenTokens.radius.lg))
                        .background(PlumSurfaceStrong)
                        .border(1.dp, PlumBorder, RoundedCornerShape(screenTokens.radius.lg))
                        .padding(screenTokens.spacing.cozy),
                    verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                ) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(screenTokens.radius.sm))
                            .semantics { role = Role.Button }
                            .clickable { onOpenSession(item.sessionId) },
                        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.WarningAmber,
                            contentDescription = null,
                            tint = PlumAmber,
                            modifier = Modifier.size(screenTokens.sizing.iconInline),
                        )
                        Text(
                            sessionNames[item.sessionId] ?: screenResources.getString(R.string.dashboard_unknown_session_8766e),
                            color = PlumText,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        item.description.ifBlank { screenResources.getString(R.string.dashboard_1_s_tool_c11b3, item.toolName) },
                        color = PlumMuted,
                        fontSize = 13.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
                        ApprovalButton(
                            label = screenResources.getString(R.string.dashboard_allow_once_c551e),
                            tint = PlumGreen,
                            enabled = !busy,
                            modifier = Modifier.weight(1f),
                        ) { onRespond(item, true) }
                        ApprovalButton(
                            label = screenResources.getString(R.string.dashboard_deny_53577),
                            tint = PlumRed,
                            enabled = !busy,
                            modifier = Modifier.weight(1f),
                        ) { onRespond(item, false) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ApprovalButton(
    label: String,
    tint: Color,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(screenTokens.radius.md))
            .background(tint.copy(alpha = if (enabled) .18f else .07f))
            .border(1.dp, tint.copy(alpha = if (enabled) .6f else .2f), RoundedCornerShape(screenTokens.radius.md))
            .semantics { role = Role.Button }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) tint else PlumMuted,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
internal fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(screenTokens.radius.xl))
            .background(if (selected) Color(0x2EB56BFF) else PlumSurfaceStrong)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(screenTokens.radius.xl))
            .semantics {
                this.selected = selected
                role = Role.Button
            }
            .clickable(onClick = onClick)
            .padding(horizontal = screenTokens.spacing.cozy, vertical = 9.dp),
    ) {
        Text(label, color = if (selected) PlumText else PlumMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * One session, as the supervisor sees it.
 *
 * Everything the card says about state — dot colour, warning icon, the line
 * under the name — comes from the [SessionState] it is handed, so the card
 * cannot reach a different verdict than the section it was filed under.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PlumSessionCard(
    session: Session,
    state: SessionState,
    onClick: () -> Unit,
    onToggleStar: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onDelete: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var showMenu by remember { mutableStateOf(false) }
    val accent = accentFor(state)
    Box {
        GlassPanel(
            modifier = Modifier
                .fillMaxWidth()
                .semantics {
                    role = Role.Button
                    contentDescription = buildString {
                        append(session.name)
                        append(", ")
                        // The verdict, not the raw status: a screen reader
                        // announcing "running" for a session stuck waiting on
                        // an approval is the same lie the dot used to tell.
                        append(state.label)
                        if (session.unreadCount > 0) append(screenResources.getString(R.string.dashboard_1_s_unread_4be87, session.unreadCount))
                    }
                }
                .combinedClickable(onClick = onClick, onLongClick = { showMenu = true }),
            radius = 22.dp,
            borderColor = accent,
        ) {
        Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(11.dp).background(accent, CircleShape))
                Text(
                    session.name,
                    color = PlumText,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 11.dp).weight(1f),
                )
                if (session.unreadCount > 0) {
                    Badge(
                        containerColor = PlumAccent,
                        modifier = Modifier.padding(end = screenTokens.spacing.sm),
                    ) {
                        Text(session.unreadCount.coerceAtMost(99).toString())
                    }
                }
                Box(
                    Modifier
                        .clip(RoundedCornerShape(11.dp))
                        .background(providerColor(session.cliProvider).copy(alpha = .16f))
                        .border(1.dp, providerColor(session.cliProvider), RoundedCornerShape(11.dp))
                        .padding(horizontal = 13.dp, vertical = screenTokens.spacing.inline),
                ) {
                    Text(providerLabel(session.cliProvider), color = providerColor(session.cliProvider), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                IconButton(onClick = onToggleStar, modifier = Modifier.size(screenTokens.sizing.touchTarget)) {
                    Icon(
                        if (session.starred) Icons.Filled.Star else Icons.Outlined.StarBorder,
                        contentDescription = if (session.starred) screenResources.getString(R.string.dashboard_remove_favorite_8b9da) else screenResources.getString(R.string.dashboard_add_favorite_4914d),
                        tint = if (session.starred) PlumAmber else PlumMuted,
                    )
                }
                IconButton(onClick = { showMenu = true }, modifier = Modifier.size(screenTokens.sizing.touchTarget)) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = screenResources.getString(R.string.dashboard_session_actions_b086c), tint = PlumMuted)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.FolderOpen, null, tint = PlumMuted, modifier = Modifier.size(17.dp))
                Text(
                    session.workingDirectory,
                    color = PlumMuted,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = screenTokens.spacing.sm),
                )
            }
            session.lastMessage?.takeIf { it.isNotBlank() }?.let { message ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val flagged = state.flagged
                    Icon(
                        if (flagged) Icons.Outlined.WarningAmber else Icons.Outlined.ChatBubbleOutline,
                        null,
                        tint = if (flagged) accent else PlumMuted,
                        modifier = Modifier.size(screenTokens.sizing.iconInline),
                    )
                    Text(
                        message,
                        color = if (flagged) accent else PlumMuted,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(start = screenTokens.spacing.sm),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    state.label,
                    color = if (state.flagged) accent else PlumMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF232629))
                        .border(1.dp, PlumBorder, RoundedCornerShape(14.dp))
                        .padding(horizontal = screenTokens.spacing.md, vertical = screenTokens.spacing.inline),
                ) {
                    Text(sessionModel(session), color = PlumMuted, fontSize = 11.sp)
                }
            }
        }
        }

        DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
            DropdownMenuItem(
                text = { Text(if (session.starred) screenResources.getString(R.string.dashboard_remove_favorite_8b9da) else screenResources.getString(R.string.dashboard_add_favorite_4914d)) },
                leadingIcon = {
                    Icon(if (session.starred) Icons.Filled.Star else Icons.Outlined.StarBorder, null)
                },
                onClick = { showMenu = false; onToggleStar() },
            )
            DropdownMenuItem(
                text = { Text(screenResources.getString(R.string.dashboard_rename_d3f4c)) },
                leadingIcon = { Icon(Icons.Outlined.Edit, null) },
                onClick = { showMenu = false; onRename() },
            )
            DropdownMenuItem(
                text = { Text(screenResources.getString(R.string.dashboard_move_to_category_8999f)) },
                leadingIcon = { Icon(Icons.Outlined.FolderOpen, null) },
                onClick = { showMenu = false; onMove() },
            )
            DropdownMenuItem(
                text = { Text(screenResources.getString(R.string.dashboard_delete_f6fdb), color = PlumRed) },
                leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = PlumRed) },
                onClick = { showMenu = false; onDelete() },
            )
        }
    }
}

/**
 * Category filter row, shared by the phone dashboard and the tablet workspace.
 * The trailing chip opens the manager: categories were assignable but could
 * never be created or renamed anywhere in the app.
 */
@Composable
internal fun CategoryFilterRow(
    categories: List<Category>,
    selectedCategoryId: String?,
    onSelect: (String?) -> Unit,
    onManage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    LazyRow(
        modifier = modifier.fadingEdges(start = 16.dp, end = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
        contentPadding = PaddingValues(end = 12.dp),
    ) {
        item {
            FilterPill(
                label = screenResources.getString(R.string.dashboard_all_categories_060be),
                selected = selectedCategoryId == null,
                onClick = { onSelect(null) },
            )
        }
        items(categories, key = { it.id }) { category ->
            FilterPill(
                label = category.name,
                selected = selectedCategoryId == category.id,
                onClick = { onSelect(category.id) },
            )
        }
        item {
            Row(
                modifier = Modifier
                    .glassSurface(RoundedCornerShape(15.dp))
                    .clickable(onClick = onManage)
                    .semantics { role = Role.Button }
                    .padding(horizontal = screenTokens.spacing.md, vertical = screenTokens.spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(
                    Icons.Outlined.Edit,
                    contentDescription = null,
                    tint = PlumMuted,
                    modifier = Modifier.size(screenTokens.sizing.iconXs),
                )
                Text(screenResources.getString(R.string.dashboard_manage_bf58d), color = PlumMuted, fontSize = 12.sp)
            }
        }
    }
}

/**
 * Horizontal jump-back row. Mirrors the launcher shortcuts published from the
 * same list, so both routes back into a session stay in sync.
 */
@Composable
internal fun QuickSwitchRow(sessions: List<Session>, onOpen: (String) -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
        Text(
            screenResources.getString(R.string.dashboard_recently_active_f9f7a),
            color = PlumMuted,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
        LazyRow(
            // Chips scroll past both edges, so both edges fade: a chip cut
            // mid-word at a hard boundary reads as a rendering fault.
            modifier = Modifier.fadingEdges(start = 16.dp, end = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
            contentPadding = PaddingValues(end = 12.dp),
        ) {
            items(sessions, key = { it.id }) { session ->
                val accent = accentFor(effectiveState(session))
                Row(
                    modifier = Modifier
                        .glassSurface(RoundedCornerShape(14.dp))
                        .clickable { onOpen(session.id) }
                        .padding(horizontal = screenTokens.spacing.md, vertical = 9.dp)
                        .semantics { role = Role.Button },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(accent))
                    Text(
                        session.name.ifBlank { screenResources.getString(R.string.dashboard_session_f7f19) },
                        color = PlumText,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 110.dp),
                    )
                }
            }
        }
    }
}

/** "Recent" pill: sessions touched within the last 24 hours. */
@Composable
private fun refreshAgeLabel(refreshedAtMs: Long): String {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val minutes = (System.currentTimeMillis() - refreshedAtMs) / 60_000
    return when {
        minutes < 1 -> screenResources.getString(R.string.dashboard_just_now_a7f8e)
        minutes < 60 -> screenResources.getString(R.string.dashboard_1_sm_ago_aa589, minutes)
        else -> screenResources.getString(R.string.dashboard_1_sh_ago_ea18c, minutes / 60)
    }
}

private fun isRecentlyUpdated(updatedAt: String): Boolean = runCatching {
    val instant = java.time.Instant.parse(updatedAt)
    java.time.Duration.between(instant, java.time.Instant.now()).toHours() < 24
}.getOrDefault(true)

/**
 * Checkouts the server found on disk that have no session yet. Collapsed by
 * default: the list is only interesting when starting work in an existing repo,
 * and loading it costs a directory walk on the server.
 */
@Composable
private fun DiscoveredProjectsRow(
    projects: List<com.claudewebui.app.data.model.DiscoveredProject>,
    expanded: Boolean,
    onToggle: () -> Unit,
    onOpen: (com.claudewebui.app.data.model.DiscoveredProject) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Column(
        Modifier.fillMaxWidth().padding(horizontal = screenTokens.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                screenResources.getString(R.string.dashboard_discovered_projects_451e1),
                color = PlumText,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (expanded) screenResources.getString(R.string.dashboard_hide_34d8b) else screenResources.getString(R.string.dashboard_show_d97d1),
                color = PlumAccent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (expanded) {
            if (projects.isEmpty()) {
                Text(screenResources.getString(R.string.dashboard_nothing_found_on_disk_72f2a), color = PlumMuted, fontSize = 12.sp)
            } else {
                projects.forEach { project ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onOpen(project) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                project.name,
                                color = PlumText,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                project.path,
                                color = PlumMuted,
                                fontSize = 11.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text(
                            if (project.hasSession) "open" else screenResources.getString(R.string.dashboard_new_session_e2df0),
                            color = PlumAccent,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
}

private fun dashboardFilterLabel(value: String, resources: android.content.res.Resources): String =
    resources.getString(when (value) {
        "All" -> R.string.dashboard_all_6a720
        "Running" -> R.string.dashboard_running_73989
        "Starred" -> R.string.dashboard_starred_e6156
        "Recent" -> R.string.dashboard_recent_76eec
        else -> R.string.dashboard_all_6a720
    })
