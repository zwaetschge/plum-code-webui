package com.claudewebui.app.ui.screens.dashboard

import com.claudewebui.app.R
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
import androidx.compose.material.icons.automirrored.outlined.MenuOpen
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var selectedSessionId by rememberSaveable { mutableStateOf(initialSessionId) }
    var selectedMessageId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedChatId by rememberSaveable { mutableStateOf<String?>(null) }
    var listVisible by rememberSaveable { mutableStateOf(true) }
    // Two thirds of the screen used to say "select a session" on every
    // launch. Open the most recent one once; clearing the selection later
    // (e.g. after deleting it) still shows the empty state.
    var autoSelected by rememberSaveable { mutableStateOf(initialSessionId != null) }
    LaunchedEffect(state.sessions, autoSelected) {
        if (!autoSelected && selectedSessionId == null && state.sessions.isNotEmpty()) {
            selectedSessionId = state.sessions.maxByOrNull { it.updatedAt }?.id
            autoSelected = true
        }
    }

    val configuration = androidx.compose.ui.platform.LocalConfiguration.current
    // Keep the chat readable on unfolded phones; the embedded list has its
    // own compact controls and does not need dashboard-card width.
    val listWidth = (configuration.screenWidthDp * .30f).coerceIn(270f, 320f).dp

    PlumBackdrop {
        // The rail is what makes Activity, Analytics and Library reachable at
        // all here: this layout replaces the phone dashboard wholesale, and
        // without it the tablet was stuck on the session list.
        PlumNavScaffold(
            selected = MainDestination.SESSIONS,
            onNavigate = onNavigateMain,
            badgeCount = state.attentionCount,
        ) { padding ->
        // The chat composer owns the system navigation inset. Applying it to
        // the whole row as well leaves an empty footer beneath the detail pane.
        Row(Modifier.fillMaxSize()) {
            // The workspace paints behind the transparent status bar, but the
            // scrolling master list must begin below it. The chat pane manages
            // its own header inset independently.
            if (listVisible || selectedSessionId == null) Box(
                Modifier.width(listWidth).fillMaxHeight()
                    .padding(top = padding.calculateTopPadding()),
            ) {
                DashboardScreen(
                    onNavigateToChat = { selectedSessionId = it; selectedMessageId = null; selectedChatId = null },
                    onNavigateToMessage = { sessionId, messageId, chatId -> selectedSessionId = sessionId; selectedMessageId = messageId; selectedChatId = chatId },
                    onNavigateToSettings = onNavigateToSettings,
                    viewModel = viewModel, embedded = true, selectedSessionId = selectedSessionId,
                )
            }
            if (listVisible || selectedSessionId == null) VerticalDivider(
                modifier = Modifier.fillMaxHeight(),
                color = PlumBorder,
            )
            Box(Modifier.weight(1f).fillMaxHeight()) {
                val selected = selectedSessionId
                if (selected == null) {
                    Column(
                        Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    ) {
                        Icon(
                            Icons.Outlined.ChatBubbleOutline,
                            contentDescription = null,
                            tint = PlumMuted,
                            modifier = Modifier.size(34.dp),
                        )
                        Text(screenResources.getString(R.string.dashboard_select_a_session_2f0b7), color = PlumText, fontSize = 15.sp)
                        androidx.compose.material3.TextButton(onClick = { viewModel.requestNewSession() }) {
                            Text(screenResources.getString(R.string.dashboard_new_session_5c881))
                        }
                        state.sessions.maxByOrNull { it.updatedAt }?.let { latest ->
                            androidx.compose.material3.TextButton(onClick = { selectedSessionId = latest.id }) {
                                Text(screenResources.getString(R.string.continue_latest))
                            }
                        }
                        Text(
                            screenResources.getString(R.string.dashboard_pick_one_on_the_left_or_start_a_new_session_e1876),
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
                            // The header's leading button collapses the list so
                            // the chat gets the full width, and brings it back.
                            showBackButton = true,
                            navigationIcon = if (listVisible) Icons.AutoMirrored.Outlined.MenuOpen else Icons.Outlined.Menu,
                            navigationLabel = screenResources.getString(
                                if (listVisible) R.string.workspace_hide_session_list else R.string.workspace_show_session_list,
                            ),
                            initialMessageId = selectedMessageId,
                            initialChatId = selectedChatId,
                            onNavigateBack = { listVisible = !listVisible },
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

}
