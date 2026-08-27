package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.MessageSearchResult
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.fadingEdges
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.components.dashboard.CategoryManager
import com.claudewebui.app.ui.components.dashboard.NewSessionDialog
import com.claudewebui.app.ui.screens.chat.ChatScreen
import org.koin.compose.viewmodel.koinViewModel

/**
 * Expanded-window master/detail workspace. Phones keep push navigation; large
 * tablets and unfolded devices keep the session list visible beside the chat.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AdaptiveSessionWorkspace(
    onNavigateToSettings: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit = {},
    onNavigateToFiles: (String, String) -> Unit,
    onNavigateToGit: (String) -> Unit,
    onNavigateToCheckpoints: (String) -> Unit,
    onNavigateToNotes: (String) -> Unit,
    onNavigateToMemory: (String) -> Unit,
    onNavigateToDevTools: (String, String) -> Unit,
    initialSessionId: String? = null,
    viewModel: DashboardViewModel = koinViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var selectedSessionId by rememberSaveable { mutableStateOf(initialSessionId) }
    var selectedMessageId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedChatId by rememberSaveable { mutableStateOf<String?>(null) }
    var showCreate by rememberSaveable { mutableStateOf(false) }
    var showNotifications by rememberSaveable { mutableStateOf(false) }
    var showCategoryManager by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is DashboardEvent.NavigateToChat -> {
                    selectedSessionId = event.sessionId
                    selectedMessageId = null
                    selectedChatId = null
                }
                is DashboardEvent.NavigateToMessage -> {
                    selectedSessionId = event.sessionId
                    selectedMessageId = event.messageId
                    selectedChatId = event.chatId
                }
                is DashboardEvent.SessionCreated -> showCreate = false
                DashboardEvent.ShowNewSessionDialog -> showCreate = true
                DashboardEvent.ShowCategoryManager -> showCategoryManager = true
                DashboardEvent.NavigateToSettings -> onNavigateToSettings()
                else -> Unit
            }
        }
    }

    PlumBackdrop {
        // The rail is what makes Activity, Analytics and Library reachable at
        // all here: this layout replaces the phone dashboard wholesale, and
        // without it the tablet was stuck on the session list.
        PlumNavScaffold(
            selected = MainDestination.SESSIONS,
            onNavigate = onNavigateMain,
            badgeCount = state.sessions.count { it.status == SessionStatus.ERROR },
        ) { padding ->
        Row(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            Column(
                // No opaque panel here: a filled rectangle cuts a hard edge into
                // the backdrop at the top and bottom of the pane. The list floats
                // on the same atmosphere as every other Plum surface.
                modifier = Modifier
                    .width(380.dp)
                    .fillMaxHeight()
                    // The pane has no background of its own, so it takes the
                    // status bar inset here; the chat pane handles its own.
                    .padding(top = padding.calculateTopPadding())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Title row. The actions used to share a row with the search field,
                // which squeezed it to about 150dp and wrapped its placeholder onto
                // a second line. They get their own row; the search gets the pane.
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Sessions",
                        color = PlumText,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.size(9.dp))
                    Text(
                        "${state.sessions.size}",
                        color = PlumMuted,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.weight(1f),
                    )
                    // Approvals block the agent, so the feed has to be one tap
                    // away on the tablet too, not only in the phone header.
                    NotificationBell(
                        unreadCount = state.unreadNotifications,
                        onClick = {
                            viewModel.loadNotifications()
                            showNotifications = true
                        },
                        modifier = Modifier.size(38.dp),
                    )
                    Spacer(Modifier.size(4.dp))
                    PlumIconButton(Icons.Outlined.Add, "New session", onClick = { showCreate = true })
                    Spacer(Modifier.size(4.dp))
                    PlumIconButton(Icons.Outlined.Settings, "Settings", onClick = onNavigateToSettings)
                }
                DashboardSearchField(
                    value = state.searchQuery,
                    onValueChange = viewModel::setSearchQuery,
                    placeholder = if (state.searchScope == DashboardSearchScope.MESSAGES) {
                        "Search messages"
                    } else "Search sessions",
                    showShortcutHint = false,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterPill(
                        label = "Sessions",
                        selected = state.searchScope == DashboardSearchScope.SESSIONS,
                        onClick = { viewModel.setSearchScope(DashboardSearchScope.SESSIONS) },
                    )
                    FilterPill(
                        label = "Messages",
                        selected = state.searchScope == DashboardSearchScope.MESSAGES,
                        onClick = { viewModel.setSearchScope(DashboardSearchScope.MESSAGES) },
                    )
                }
                CategoryFilterRow(
                    categories = state.categories,
                    selectedCategoryId = state.selectedCategoryId,
                    onSelect = viewModel::filterByCategory,
                    onManage = { showCategoryManager = true },
                )
                if (state.searchQuery.isBlank() && state.sessions.isNotEmpty()) {
                    QuickSwitchRow(
                        sessions = remember(state.sessions) {
                            state.sessions.sortedByDescending { it.updatedAt }.take(5)
                        },
                        onOpen = { viewModel.onSessionTapped(it) },
                    )
                }
                HorizontalDivider(color = PlumBorder)
                LazyColumn(
                    // Cards dissolve at both ends instead of being sliced by
                    // the divider above and the screen edge below.
                    modifier = Modifier.fillMaxSize().fadingEdges(top = 14.dp, bottom = 40.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    if (state.searchScope == DashboardSearchScope.MESSAGES) {
                        items(state.messageSearchResults, key = { "${it.sessionId}_${it.id}" }) { result ->
                            SplitMessageRow(result, state.searchQuery) {
                                viewModel.onMessageResultTapped(result)
                            }
                        }
                    } else {
                        items(state.filteredSessions, key = { it.id }) { session ->
                            SplitSessionRow(
                                session = session,
                                selected = session.id == selectedSessionId,
                                onClick = { viewModel.onSessionTapped(session.id) },
                            )
                        }
                    }
                }
            }
            VerticalDivider(
                modifier = Modifier.fillMaxHeight(),
                color = PlumBorder,
            )
            Box(Modifier.weight(1f).fillMaxHeight()) {
                val selected = selectedSessionId
                if (selected == null) {
                    Column(
                        Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.ChatBubbleOutline,
                            contentDescription = null,
                            tint = PlumMuted,
                            modifier = Modifier.size(34.dp),
                        )
                        Text("Select a session", color = PlumText, fontSize = 15.sp)
                        Text(
                            "Pick one on the left, or start a new session.",
                            color = PlumMuted,
                            fontSize = 12.sp,
                        )
                    }
                } else {
                    // Without the key the subtree keeps every remembered value
                    // from the previous session — open sheets, scroll position,
                    // composer text — while only the id changes underneath.
                    key(selected) {
                        ChatScreen(
                            sessionId = selected,
                            initialMessageId = selectedMessageId,
                            initialChatId = selectedChatId,
                            onNavigateBack = {
                                selectedSessionId = null
                                selectedMessageId = null
                                selectedChatId = null
                            },
                            onNavigateToFiles = { directory ->
                                onNavigateToFiles(selected, directory)
                            },
                            onNavigateToGit = { onNavigateToGit(selected) },
                            onNavigateToCheckpoints = onNavigateToCheckpoints,
                            onNavigateToNotes = onNavigateToNotes,
                            onNavigateToMemory = onNavigateToMemory,
                            onNavigateToDevTools = { directory ->
                                onNavigateToDevTools(selected, directory)
                            },
                        )
                    }
                }
            }
        }
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
                    selectedSessionId = sessionId
                    selectedMessageId = null
                    selectedChatId = null
                },
                onMarkAllRead = { viewModel.markNotificationsRead() },
                onClearAll = { viewModel.clearNotifications() },
                onRespond = { item, allow -> viewModel.respondToApproval(item, allow) },
            )
        }
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

    if (showCreate) {
        NewSessionDialog(
            categories = state.categories,
            providers = state.availableProviders,
            presets = state.sessionPresets,
            lastSetup = state.lastSessionSetup,
            isCreating = state.isCreatingSession,
            creationError = state.creationError,
            onDismiss = { if (!state.isCreatingSession) showCreate = false },
            onCreate = { name, provider, directory, mode, categoryId ->
                viewModel.createSession(name, directory, provider, mode, categoryId)
            },
        )
    }
}

@Composable
private fun SplitSessionRow(session: Session, selected: Boolean, onClick: () -> Unit) {
    val statusColor = when (session.status) {
        SessionStatus.RUNNING -> PlumGreen
        SessionStatus.ERROR -> PlumAmber
        SessionStatus.STOPPED -> PlumBorder
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .glassSurface(
                RoundedCornerShape(14.dp),
                borderColor = if (selected) PlumAccent.copy(alpha = .55f) else null,
            )
            .background(if (selected) PlumAccent.copy(alpha = .14f) else Color.Transparent)
            .clickable(onClick = onClick)
            .semantics {
                role = Role.Button
                this.selected = selected
            }
            .padding(12.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(statusColor))
                Spacer(Modifier.size(7.dp))
                Text(
                    session.name,
                    color = PlumText,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (session.unreadCount > 0) {
                    Text("${session.unreadCount} new", color = PlumAccent, fontSize = 11.sp)
                }
            }
            Text(
                session.lastMessage ?: session.workingDirectory,
                color = PlumMuted,
                fontSize = 12.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SplitMessageRow(result: MessageSearchResult, query: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .glassSurface(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .semantics { role = Role.Button }
            .padding(12.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                result.sessionName ?: "Session",
                color = PlumText,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                dashboardSearchSnippet(result.content, query),
                color = PlumMuted,
                fontSize = 12.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
