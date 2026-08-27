package com.claudewebui.app.ui.screens.dashboard

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

    val visibleSessions = state.filteredSessions.filter { session ->
        when (selectedFilter) {
            "Running" -> session.status == SessionStatus.RUNNING
            "Starred" -> session.starred
            "Recent" -> isRecentlyUpdated(session.updatedAt)
            else -> true
        }
    }
    val runningCount = state.sessions.count { it.status == SessionStatus.RUNNING }
    val attentionCount = state.sessions.count { it.status == SessionStatus.ERROR }

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
                        .clip(RoundedCornerShape(20.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFC46DFF), Color(0xFF317CF4)),
                            ),
                        )
                        .clickable { showNewSessionDialog = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Add, "New session", tint = Color.White, modifier = Modifier.size(32.dp))
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
                verticalArrangement = Arrangement.spacedBy(14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
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
                                    "Search every message"
                                } else "Search sessions, folders or providers",
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
                                        "Search every message"
                                    } else "Search sessions, folders or providers",
                                    showShortcutHint = false,
                                    modifier = Modifier.weight(1f),
                                )
                                listOf("All", "Running", "Starred", "Recent").forEach { label ->
                                    FilterPill(
                                        label = if (label == "All") "All  ${state.sessions.size}" else label,
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
                                    label = if (label == "All") "All  ${state.sessions.size}" else label,
                                    selected = selectedFilter == label,
                                    onClick = { selectedFilter = label },
                                )
                                }
                                item {
                                    FilterPill(
                                        label = if (state.showArchived) "Archive" else "Archive",
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
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            WorkspaceHero(
                                runningCount = runningCount,
                                sessions = state.sessions,
                                modifier = Modifier.weight(1.45f),
                            )
                            ApprovalHero(
                                count = attentionCount,
                                modifier = Modifier.weight(.95f),
                            )
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardSearchField(
                            value = state.searchQuery,
                            onValueChange = viewModel::setSearchQuery,
                            placeholder = if (state.searchScope == DashboardSearchScope.MESSAGES) {
                                "Search every message"
                            } else "Search sessions, folders or providers",
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            listOf("All", "Running", "Starred", "Recent").forEach { label ->
                                FilterPill(
                                    label = if (label == "All") "All  ${state.sessions.size}" else label,
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
                            title = "Offline — showing cached sessions",
                            detail = "Changes from other devices will appear after reconnecting.",
                            onRetry = viewModel::refresh,
                            compact = true,
                        )
                    }
                } else if (state.error != null && state.sessions.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.ErrorOutline,
                            title = "Refresh failed",
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
                            "Message results"
                        } else "Recent sessions",
                        trailing = { Text("Updated now", color = PlumMuted, fontSize = 13.sp) },
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
                                title = "Search failed",
                                detail = state.messageSearchError.orEmpty(),
                                onRetry = { viewModel.setSearchQuery(state.searchQuery) },
                            )
                        }
                        state.searchQuery.length >= 2 && state.messageSearchResults.isEmpty() -> {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                DashboardStatePanel(
                                    icon = Icons.Outlined.Search,
                                    title = "No matching messages",
                                    detail = "Try a different phrase.",
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
                            title = "You're offline",
                            detail = "No cached sessions are available yet.",
                            onRetry = viewModel::refresh,
                        )
                    }
                } else if (visibleSessions.isEmpty() && state.error != null) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.ErrorOutline,
                            title = "Sessions couldn't be loaded",
                            detail = state.error.orEmpty(),
                            onRetry = viewModel::refresh,
                        )
                    }
                } else if (visibleSessions.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        DashboardStatePanel(
                            icon = Icons.Outlined.ChatBubbleOutline,
                            title = if (state.searchQuery.isBlank() && selectedFilter == "All") {
                                "No sessions yet"
                            } else {
                                "No matching sessions"
                            },
                            detail = if (state.searchQuery.isBlank() && selectedFilter == "All") {
                                "Create one to start working."
                            } else {
                                "Try another search or filter."
                            },
                            onRetry = null,
                        )
                    }
                } else {
                    gridItems(visibleSessions, key = { it.id }) { session ->
                        PlumSessionCard(
                            session = session,
                            onClick = { onNavigateToChat(session.id) },
                            onToggleStar = { viewModel.toggleStar(session.id) },
                            onRename = { renameTarget = session },
                            onMove = { categoryTarget = session },
                            onDelete = { deleteTarget = session },
                        )
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
            title = { Text("Delete session?") },
            text = { Text("“${target.name}” and its chat history will be removed.") },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget = null
                    viewModel.deleteSession(target.id)
                }) { Text("Delete", color = PlumRed) }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text("Cancel") }
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
    var name by remember(session.id) { mutableStateOf(session.name) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename session") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name") },
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(onClick = { onRename(name.trim()) }, enabled = name.isNotBlank()) {
                Text("Save")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun MoveSessionDialog(
    session: Session,
    categories: List<Category>,
    onDismiss: () -> Unit,
    onMove: (String?) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move “${session.name}”") },
        text = {
            Column {
                TextButton(
                    onClick = { onMove(null) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text("No category", modifier = Modifier.weight(1f)) }
                categories.forEach { category ->
                    TextButton(
                        onClick = { onMove(category.id) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text(category.name, modifier = Modifier.weight(1f)) }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
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
    GlassPanel(Modifier.fillMaxWidth()) {
        if (compact) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(icon, null, tint = PlumMuted, modifier = Modifier.size(24.dp))
                Column(Modifier.weight(1f)) {
                    Text(title, color = PlumText, fontWeight = FontWeight.SemiBold)
                    Text(detail, color = PlumMuted, fontSize = 12.sp)
                }
                onRetry?.let { TextButton(onClick = it) { Text("Retry") } }
            }
        } else {
            Column(
                Modifier.fillMaxWidth().padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(icon, null, tint = PlumMuted, modifier = Modifier.size(32.dp))
                Text(title, color = PlumText, fontWeight = FontWeight.SemiBold)
                Text(detail, color = PlumMuted, fontSize = 13.sp)
                onRetry?.let {
                    Button(onClick = it, modifier = Modifier.heightIn(min = 48.dp)) { Text("Retry") }
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
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFBF67F5), Color(0xFF2E7AEF)))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
        Column {
            Text("Sessions", color = PlumText, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            if (!showMetricPills) {
                Text(
                    "$runningCount active · $approvals need attention",
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
            }
        }

        if (showMetricPills) Box(
            modifier = Modifier
                .clip(RoundedCornerShape(15.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFBB65EF), Color(0xFF2D7CE8))))
                .padding(horizontal = 12.dp, vertical = 7.dp),
        ) {
            Text(
                text = if (runningCount == 1) "1 active session" else "$runningCount active sessions",
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
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = if (approvals == 1) "1 approval" else "$approvals approvals",
                color = if (approvals > 0) PlumText else PlumMuted,
                fontSize = 12.sp,
            )
        }

        Spacer(Modifier.weight(1f))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(if (online) PlumGreen else PlumRed, CircleShape))
            Spacer(Modifier.width(6.dp))
            Text(
                if (online) "Online" else "Offline",
                color = PlumMuted,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        NotificationBell(unreadNotifications, onNotifications)
        PlumIconButton(Icons.Outlined.Brightness4, "Settings", onSettings)
    }
}

@Composable
internal fun DashboardSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "Search sessions, folders or providers",
    modifier: Modifier = Modifier,
    showShortcutHint: Boolean = true,
) {
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
                        .padding(horizontal = 8.dp, vertical = 5.dp),
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
                    result.sessionName ?: "Session",
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
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFBF67F5), Color(0xFF2E7AEF))))
                .border(1.dp, PlumAccent, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(27.dp))
        }
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Text("PLUM CODE", color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text("Sessions", color = PlumText, fontSize = 31.sp, fontWeight = FontWeight.Bold)
        }
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(24.dp))
                .background(PlumSurfaceStrong)
                .border(1.dp, PlumBorder, RoundedCornerShape(24.dp))
                .padding(horizontal = 13.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(9.dp).background(if (online) PlumGreen else PlumRed, CircleShape))
            Spacer(Modifier.width(7.dp))
            Text(if (online) "Online" else "Offline", color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
        Spacer(Modifier.width(8.dp))
        NotificationBell(unreadNotifications, onNotifications)
        PlumIconButton(Icons.Outlined.Brightness4, "Settings", onSettings)
    }
}

@Composable
private fun WorkspaceHero(runningCount: Int, sessions: List<Session>, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .height(126.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Brush.linearGradient(listOf(Color(0xFFBB65EF), Color(0xFF2D7CE8))))
            .padding(18.dp),
    ) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Text("Live workspace", color = Color.White.copy(alpha = .74f), fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.Bottom) {
                Text(runningCount.toString(), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                Text("  active sessions", color = Color.White.copy(alpha = .85f), modifier = Modifier.padding(bottom = 7.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row {
                    sessions.filter { it.status == SessionStatus.RUNNING }.take(4).forEachIndexed { index, session ->
                        Box(
                            Modifier
                                .padding(start = if (index == 0) 0.dp else 2.dp)
                                .size(20.dp)
                                .background(providerColor(session.cliProvider), CircleShape)
                                .border(2.dp, Color(0xFF5937A7), CircleShape),
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                Text("Providers are working", color = Color.White.copy(alpha = .72f), fontSize = 11.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun ApprovalHero(count: Int, modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier.height(126.dp), radius = 22.dp) {
        Column(
            Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Box(
                Modifier.size(36.dp).background(Color(0x3DFFAA14), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.WarningAmber, null, tint = if (count > 0) PlumAmber else PlumMuted)
            }
            Text(
                if (count == 1) "1 approval" else "$count approvals",
                color = PlumText,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            Text(
                if (count > 0) "A session needs your attention." else "Nothing is waiting.",
                color = PlumMuted,
                fontSize = 12.sp,
                maxLines = 2,
            )
        }
    }
}

@Composable
internal fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(24.dp))
            .background(if (selected) Color(0x2EB56BFF) else PlumSurfaceStrong)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(24.dp))
            .semantics {
                this.selected = selected
                role = Role.Button
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
    ) {
        Text(label, color = if (selected) PlumText else PlumMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PlumSessionCard(
    session: Session,
    onClick: () -> Unit,
    onToggleStar: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onDelete: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }
    val accent = when (session.status) {
        SessionStatus.RUNNING -> PlumGreen
        SessionStatus.ERROR -> Color(0xFFFFB536)
        SessionStatus.STOPPED -> PlumBorder
    }
    Box {
        GlassPanel(
            modifier = Modifier
                .fillMaxWidth()
                .semantics {
                    role = Role.Button
                    contentDescription = buildString {
                        append(session.name)
                        append(", ")
                        append(session.status.name.lowercase())
                        if (session.unreadCount > 0) append(", ${session.unreadCount} unread")
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
                        modifier = Modifier.padding(end = 8.dp),
                    ) {
                        Text(session.unreadCount.coerceAtMost(99).toString())
                    }
                }
                Box(
                    Modifier
                        .clip(RoundedCornerShape(11.dp))
                        .background(providerColor(session.cliProvider).copy(alpha = .16f))
                        .border(1.dp, providerColor(session.cliProvider), RoundedCornerShape(11.dp))
                        .padding(horizontal = 13.dp, vertical = 6.dp),
                ) {
                    Text(providerLabel(session.cliProvider), color = providerColor(session.cliProvider), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                IconButton(onClick = onToggleStar, modifier = Modifier.size(48.dp)) {
                    Icon(
                        if (session.starred) Icons.Filled.Star else Icons.Outlined.StarBorder,
                        contentDescription = if (session.starred) "Remove favorite" else "Add favorite",
                        tint = if (session.starred) PlumAmber else PlumMuted,
                    )
                }
                IconButton(onClick = { showMenu = true }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "Session actions", tint = PlumMuted)
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
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            session.lastMessage?.takeIf { it.isNotBlank() }?.let { message ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (session.status == SessionStatus.ERROR) Icons.Outlined.WarningAmber else Icons.Outlined.ChatBubbleOutline,
                        null,
                        tint = if (session.status == SessionStatus.ERROR) Color(0xFFFFC052) else PlumMuted,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        message,
                        color = if (session.status == SessionStatus.ERROR) Color(0xFFFFC96B) else PlumMuted,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (session.status) {
                        SessionStatus.RUNNING -> "now  •  working"
                        SessionStatus.ERROR -> "Needs attention"
                        SessionStatus.STOPPED -> "Idle"
                    },
                    color = PlumMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF232629))
                        .border(1.dp, PlumBorder, RoundedCornerShape(14.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(sessionModel(session), color = PlumMuted, fontSize = 11.sp)
                }
            }
        }
        }

        DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
            DropdownMenuItem(
                text = { Text(if (session.starred) "Remove favorite" else "Add favorite") },
                leadingIcon = {
                    Icon(if (session.starred) Icons.Filled.Star else Icons.Outlined.StarBorder, null)
                },
                onClick = { showMenu = false; onToggleStar() },
            )
            DropdownMenuItem(
                text = { Text("Rename") },
                leadingIcon = { Icon(Icons.Outlined.Edit, null) },
                onClick = { showMenu = false; onRename() },
            )
            DropdownMenuItem(
                text = { Text("Move to category") },
                leadingIcon = { Icon(Icons.Outlined.FolderOpen, null) },
                onClick = { showMenu = false; onMove() },
            )
            DropdownMenuItem(
                text = { Text("Delete", color = PlumRed) },
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
    LazyRow(
        modifier = modifier.fadingEdges(start = 16.dp, end = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(end = 12.dp),
    ) {
        item {
            FilterPill(
                label = "All categories",
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
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(
                    Icons.Outlined.Edit,
                    contentDescription = null,
                    tint = PlumMuted,
                    modifier = Modifier.size(14.dp),
                )
                Text("Manage", color = PlumMuted, fontSize = 12.sp)
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
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "Recently active",
            color = PlumMuted,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
        LazyRow(
            // Chips scroll past both edges, so both edges fade: a chip cut
            // mid-word at a hard boundary reads as a rendering fault.
            modifier = Modifier.fadingEdges(start = 16.dp, end = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(end = 12.dp),
        ) {
            items(sessions, key = { it.id }) { session ->
                val accent = when (session.status) {
                    SessionStatus.RUNNING -> PlumGreen
                    SessionStatus.ERROR -> Color(0xFFFFB536)
                    SessionStatus.STOPPED -> PlumBorder
                }
                Row(
                    modifier = Modifier
                        .glassSurface(RoundedCornerShape(14.dp))
                        .clickable { onOpen(session.id) }
                        .padding(horizontal = 12.dp, vertical = 9.dp)
                        .semantics { role = Role.Button },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(accent))
                    Text(
                        session.name.ifBlank { "Session" },
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
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Discovered projects",
                color = PlumText,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (expanded) "Hide" else "Show",
                color = PlumAccent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (expanded) {
            if (projects.isEmpty()) {
                Text("Nothing found on disk", color = PlumMuted, fontSize = 12.sp)
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
                            if (project.hasSession) "open" else "new session",
                            color = PlumAccent,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
}
