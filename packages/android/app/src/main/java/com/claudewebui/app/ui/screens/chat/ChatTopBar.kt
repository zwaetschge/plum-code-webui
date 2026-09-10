package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionChat
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.LocalPlumPalette

/** The slice of [ChatUiState] the header reads. */
@Immutable
internal data class ChatHeaderState(
    val isConnected: Boolean,
    val isWorking: Boolean,
    val chats: List<SessionChat>,
    val activeChatId: String?,
    val isSwitchingChat: Boolean,
    val showUsageBanner: Boolean,
    val hasActiveTools: Boolean,
    val isEditingTitle: Boolean,
) {
    companion object {
        /** [displayState] drives the visible facts; the title edit flag is live state. */
        fun from(displayState: ChatUiState, isEditingTitle: Boolean) = ChatHeaderState(
            isConnected = displayState.isConnected,
            isWorking = displayState.isWorking,
            chats = displayState.chats,
            activeChatId = displayState.activeChatId,
            isSwitchingChat = displayState.isSwitchingChat,
            showUsageBanner = displayState.showUsageBanner,
            hasActiveTools = displayState.activeTools.isNotEmpty(),
            isEditingTitle = isEditingTitle,
        )
    }
}

/** Callbacks the header needs; remembered once per screen. */
@Stable
internal class ChatTopBarActions(
    val onNavigateBack: () -> Unit,
    val onEditTitle: () -> Unit,
    val onTitleSaved: (String) -> Unit,
    val onNavigateToFiles: () -> Unit,
    val onNavigateToGit: () -> Unit,
    val onNavigateToCheckpoints: () -> Unit,
    val onToggleUsage: () -> Unit,
    val onOpenToolLog: () -> Unit,
    val onOpenSessionSettings: () -> Unit,
    val onNavigateToNotes: () -> Unit,
    val onNavigateToMemory: () -> Unit,
    val onNavigateToDevTools: () -> Unit,
    val onSearch: () -> Unit,
    val onSwitchChat: (String) -> Unit,
    val onNewChat: () -> Unit,
    val onDeleteChat: (String) -> Unit,
)

// ── Top Bar ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatTopBar(
    session: Session?,
    header: ChatHeaderState,
    actions: ChatTopBarActions,
) {
    val t = PlumTheme.tokens
    var editTitleText by remember(session?.name) { mutableStateOf(session?.name ?: "") }
    val focusRequester = remember { FocusRequester() }
    var showMenu by remember { mutableStateOf(false) }
    var showChatMenu by remember { mutableStateOf(false) }
    val largeText = LocalDensity.current.fontScale >= 1.5f

    LaunchedEffect(header.isEditingTitle) {
        if (header.isEditingTitle) {
            focusRequester.requestFocus()
        }
    }

    // The bar itself is fully opaque — every pixel of it, tab row included.
    // The fade lives in its own strip *below* the bar, so the transcript
    // dissolves under the tabs instead of showing through them as
    // double-exposed text. Putting the gradient on the padded column meant
    // the last 12% of the bar was translucent, and that is exactly where the
    // tabs sit.
    val palette = LocalPlumPalette.current
    Column(Modifier.fillMaxWidth()) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(palette.background)
            .statusBarsPadding()
            .padding(horizontal = t.spacing.md, vertical = t.spacing.sm),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = actions.onNavigateBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.chat_back), tint = PlumText)
            }
            Box(Modifier.weight(1f)) {
            if (header.isEditingTitle) {
                OutlinedTextField(
                    value = editTitleText,
                    onValueChange = { editTitleText = it },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester),
                    textStyle = MaterialTheme.typography.titleMedium.copy(color = PlumText),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = { actions.onTitleSaved(editTitleText) }
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        unfocusedBorderColor = PlumBorder,
                    ),
                )
            } else {
                Column(
                    verticalArrangement = Arrangement.spacedBy(t.spacing.xxs),
                    modifier = Modifier.clickableNoRipple(actions.onEditTitle),
                ) {
                    Row(
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(t.spacing.inline),
                    ) {
                        Text(
                            text = session?.name ?: stringResource(R.string.chat_loading),
                            style = MaterialTheme.typography.titleLarge,
                            color = PlumText,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }

                    // Connection / status indicator
                    Row(
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(t.spacing.xs),
                    ) {
                        val statusColor = when {
                            !header.isConnected -> Color(0xFFFF575F)
                            header.isWorking -> ClaudeWebUITheme.extendedColors.warning
                            else -> PlumGreen
                        }
                        Box(
                            modifier = Modifier
                                .size(t.spacing.inline)
                                .clip(CircleShape)
                                .background(statusColor)
                        )
                        Text(
                            text = when {
                                !header.isConnected -> stringResource(R.string.chat_disconnected)
                                header.isWorking -> stringResource(R.string.chat_working)
                                else -> stringResource(when (session?.status) {
                                    SessionStatus.RUNNING -> R.string.chat_status_running
                                    SessionStatus.STOPPED -> R.string.chat_status_stopped
                                    SessionStatus.ERROR -> R.string.chat_status_error
                                    null -> R.string.chat_ready
                                })
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumMuted,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
            }

            IconButton(onClick = actions.onSearch) {
                Icon(Icons.Outlined.Search, contentDescription = stringResource(R.string.chat_search_title), tint = PlumText)
            }

            // ── Chat-thread switcher ─────────────────────────────────────────
            Box {
                val activeChat = header.chats.firstOrNull { it.id == (header.activeChatId ?: "main") }
                    ?: header.chats.firstOrNull()
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier
                        .glassSurface(RoundedCornerShape(t.spacing.cozy))
                        .clickable(enabled = !header.isSwitchingChat) { showChatMenu = true }
                        .padding(horizontal = 9.dp, vertical = 5.dp),
                ) {
                    Icon(
                        Icons.Outlined.Forum,
                        contentDescription = stringResource(R.string.chat_switch),
                        tint = if (header.isSwitchingChat) PlumMuted else PlumAccent,
                        modifier = Modifier.size(13.dp),
                    )
                    if (!largeText) {
                        Text(
                            text = activeChat?.title ?: stringResource(R.string.chat_first),
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumText,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 82.dp),
                        )
                        Icon(
                            Icons.Filled.ArrowDropDown,
                            contentDescription = null,
                            tint = PlumMuted,
                            modifier = Modifier.size(t.spacing.cozy),
                        )
                    }
                }
                DropdownMenu(
                    expanded = showChatMenu,
                    onDismissRequest = { showChatMenu = false },
                ) {
                    header.chats.forEach { chat ->
                        DropdownMenuItem(
                            text = {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
                                ) {
                                    Icon(
                                        Icons.Outlined.Check,
                                        contentDescription = null,
                                        modifier = Modifier
                                            .size(15.dp)
                                            .alpha(if (chat.id == (header.activeChatId ?: "main")) 1f else 0f),
                                    )
                                    Text(chat.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            },
                            trailingIcon = if (header.chats.size > 1 && chat.id != "main") {
                                {
                                    IconButton(
                                        onClick = {
                                            showChatMenu = false
                                            actions.onDeleteChat(chat.id)
                                        },
                                        modifier = Modifier.size(26.dp),
                                    ) {
                                        Icon(
                                            Icons.Outlined.Delete,
                                            contentDescription = stringResource(R.string.chat_delete),
                                            modifier = Modifier.size(15.dp),
                                        )
                                    }
                                }
                            } else null,
                            onClick = {
                                showChatMenu = false
                                actions.onSwitchChat(chat.id)
                            },
                        )
                    }
                    HorizontalDivider()
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_new)) },
                        leadingIcon = {
                            Icon(
                                Icons.Outlined.AddComment,
                                contentDescription = null,
                                modifier = Modifier.size(t.spacing.lg),
                            )
                        },
                        onClick = {
                            showChatMenu = false
                            actions.onNewChat()
                        },
                    )
                }
            }

            // Tapping the provider badge opens session settings, the fastest
            // path to switching provider, model and reasoning effort.
            if (!largeText) {
                session?.cliProvider?.let { ChatProviderBadge(it, onClick = actions.onOpenSessionSettings) }
            }
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Filled.MoreVert, stringResource(R.string.chat_more), tint = PlumText)
                }
                // Only destinations that exist nowhere else — Files/Git/Checks/
                // Stats live in the tab bar, session settings behind the
                // provider badge.
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false },
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_settings)) },
                        leadingIcon = { Icon(Icons.Outlined.Tune, contentDescription = null) },
                        onClick = { showMenu = false; actions.onOpenSessionSettings() },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_panel_notes)) },
                        leadingIcon = { Icon(Icons.Outlined.StickyNote2, contentDescription = null) },
                        onClick = { showMenu = false; actions.onNavigateToNotes() },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_memory)) },
                        leadingIcon = { Icon(Icons.Outlined.Psychology, contentDescription = null) },
                        onClick = { showMenu = false; actions.onNavigateToMemory() },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_dev_tools)) },
                        leadingIcon = { Icon(Icons.Outlined.Dns, contentDescription = null) },
                        onClick = { showMenu = false; actions.onNavigateToDevTools() },
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .glassSurface(RoundedCornerShape(18.dp))
                .padding(t.spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(t.spacing.xs),
        ) {
            ChatTab(stringResource(R.string.chat_tab), Icons.Outlined.ChatBubbleOutline, true, Modifier.weight(1f), {})
            ChatTab(stringResource(R.string.chat_files), Icons.Outlined.FolderOpen, false, Modifier.weight(1f), actions.onNavigateToFiles)
            ChatTab(stringResource(R.string.chat_panel_git), Icons.Outlined.MergeType, false, Modifier.weight(1f), actions.onNavigateToGit)
            ChatTab(stringResource(R.string.chat_checks), Icons.Outlined.Security, false, Modifier.weight(1f), actions.onNavigateToCheckpoints)
            // Model, account limits and context/token/cost all live behind
            // this toggle — the header stays as small as possible.
            ChatTab(stringResource(R.string.chat_stats), Icons.Outlined.BarChart, header.showUsageBanner, Modifier.weight(1f), actions.onToggleUsage)
            // Mirrors the WebUI's Tool Log dock: every tool call of this session
            // in one place, instead of only inline in the transcript.
            ChatTab(
                stringResource(R.string.chat_tools),
                Icons.Outlined.Terminal,
                header.hasActiveTools,
                Modifier.weight(1f),
                actions.onOpenToolLog,
            )
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .height(22.dp)
            .background(
                Brush.verticalGradient(
                    0f to palette.background,
                    1f to Color.Transparent,
                ),
            ),
    )
    }
}

@Composable
private fun ChatTab(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val t = PlumTheme.tokens
    val largeText = LocalDensity.current.fontScale >= 1.5f
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(t.spacing.cozy))
            .background(if (selected) Color(0xFF8044C5) else Color.Transparent)
            .semantics {
                this.selected = selected
                role = Role.Button
            }
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (selected) Color.White else PlumMuted, modifier = Modifier.size(18.dp))
        if (!largeText) {
            Text("  $label", color = if (selected) Color.White else PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ── Provider Badge ────────────────────────────────────────────────────────────

/** Chat-header variant; distinct from the shared `ui.components.common.ProviderBadge`. */
@Composable
private fun ChatProviderBadge(provider: CLIProvider, onClick: () -> Unit) {
    val t = PlumTheme.tokens
    val label = providerLabel(provider)
    val color = providerColor(provider)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(t.radius.chip))
            .background(color.copy(alpha = 0.15f))
            .border(1.dp, color, RoundedCornerShape(t.radius.chip))
            .clickable(onClick = onClick),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = t.spacing.md, vertical = 7.dp),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Clickable helper ──────────────────────────────────────────────────────────

@Composable
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier {
    val interactionSource = remember { MutableInteractionSource() }
    return this.clickable(
        interactionSource = interactionSource,
        indication = null,
        onClickLabel = stringResource(R.string.chat_edit_title),
        role = Role.Button,
        onClick = onClick,
    )
}
