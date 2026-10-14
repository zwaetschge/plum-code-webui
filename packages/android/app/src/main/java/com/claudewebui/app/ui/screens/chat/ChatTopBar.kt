package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.shadow
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
    val onToggleUsage: () -> Unit,
    /** Opens the session tools (Dateien, Versionen, Vorschau, Verbindungen). */
    val onOpenTools: () -> Unit,
    val onOpenToolLog: () -> Unit,
    val onOpenSessionSettings: () -> Unit,
    val onNavigateToNotes: () -> Unit,
    val onNavigateToMemory: () -> Unit,
    val onSearch: () -> Unit,
    val onSwitchChat: (String) -> Unit,
    val onNewChat: () -> Unit,
    val onDeleteChat: (String) -> Unit,
    val onRestart: () -> Unit = {},
    val onArchive: () -> Unit = {},
)

// ── Top Bar ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatTopBar(
    session: Session?,
    header: ChatHeaderState,
    actions: ChatTopBarActions,
    compact: Boolean = false,
    showBackButton: Boolean = true,
    navigationIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    navigationLabel: String? = null,
) {
    val t = PlumTheme.tokens
    var editTitleText by remember(session?.name) { mutableStateOf(session?.name ?: "") }
    val focusRequester = remember { FocusRequester() }
    var showMenu by remember { mutableStateOf(false) }
    val isChatSurface = session?.surface == "chat"
    val largeText = LocalDensity.current.fontScale >= 1.5f

    LaunchedEffect(header.isEditingTitle) {
        if (header.isEditingTitle) {
            focusRequester.requestFocus()
        }
    }

    val palette = LocalPlumPalette.current
    // ChatGPT-style header: no card, just floating round controls and a title
    // capsule over the backdrop. Everything else lives under the menu.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = t.spacing.sm, vertical = t.spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
    ) {
        if (showBackButton) HeaderRoundButton(
            icon = navigationIcon ?: Icons.AutoMirrored.Filled.ArrowBack,
            description = navigationLabel ?: stringResource(R.string.chat_back),
            onClick = actions.onNavigateBack,
        )
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            androidx.compose.animation.Crossfade(
                targetState = header.isEditingTitle,
                animationSpec = tween(160),
                label = "header_title_mode",
            ) { editing ->
            if (editing) {
                OutlinedTextField(
                    value = editTitleText,
                    onValueChange = { editTitleText = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                    textStyle = MaterialTheme.typography.titleMedium.copy(color = PlumText),
                    shape = CircleShape,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { actions.onTitleSaved(editTitleText) }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        unfocusedBorderColor = PlumBorder,
                    ),
                )
            } else {
                val statusTarget = when {
                    !header.isConnected -> Color(0xFFFF575F)
                    header.isWorking -> ClaudeWebUITheme.extendedColors.warning
                    else -> PlumGreen
                }
                val statusColor by animateColorAsState(statusTarget, tween(300), label = "header_status")
                val activeChat = header.chats.firstOrNull { it.id == (header.activeChatId ?: "main") }
                    ?: header.chats.firstOrNull()
                Row(
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clip(CircleShape)
                        .background(palette.controlSurface)
                        .border(1.dp, palette.border.copy(alpha = .7f), CircleShape)
                        .clickableNoRipple(actions.onEditTitle)
                        .padding(horizontal = 16.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(statusColor))
                    Text(
                        text = session?.name ?: stringResource(R.string.chat_loading),
                        style = MaterialTheme.typography.titleMedium,
                        color = PlumText,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (header.chats.size > 1 && activeChat != null && !largeText) {
                        Text(
                            text = activeChat.title,
                            style = MaterialTheme.typography.labelMedium,
                            color = PlumMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 72.dp),
                        )
                    }
                }
            }
            }
        }

        HeaderRoundButton(Icons.Outlined.Search, stringResource(R.string.chat_search_title), actions.onSearch)

        Box {
            HeaderRoundButton(Icons.Filled.MoreVert, stringResource(R.string.chat_more)) { showMenu = true }
            DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                @Composable
                fun item(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) =
                    DropdownMenuItem(
                        text = { Text(label) },
                        leadingIcon = { Icon(icon, contentDescription = null) },
                        onClick = { showMenu = false; onClick() },
                    )
                item(stringResource(R.string.chat_new), Icons.Outlined.AddComment, actions.onNewChat)
                if (header.chats.size > 1) {
                    header.chats.forEach { chat ->
                        DropdownMenuItem(
                            text = { Text(chat.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            leadingIcon = {
                                Icon(
                                    Icons.Outlined.Check, null,
                                    modifier = Modifier.alpha(if (chat.id == (header.activeChatId ?: "main")) 1f else 0f),
                                )
                            },
                            trailingIcon = if (chat.id != "main") {
                                {
                                    IconButton(
                                        onClick = { showMenu = false; actions.onDeleteChat(chat.id) },
                                        modifier = Modifier.size(26.dp),
                                    ) { Icon(Icons.Outlined.Delete, stringResource(R.string.chat_delete), modifier = Modifier.size(15.dp)) }
                                }
                            } else null,
                            enabled = !header.isSwitchingChat,
                            onClick = { showMenu = false; actions.onSwitchChat(chat.id) },
                        )
                    }
                }
                HorizontalDivider()
                // Chat sessions (agent chats) have no session tools; task and
                // code sessions reach theirs here, the rest stays in this menu.
                if (!isChatSurface) item(stringResource(R.string.chat_tools), Icons.Outlined.Handyman, actions.onOpenTools)
                item(stringResource(R.string.chat_stats), Icons.Outlined.BarChart, actions.onToggleUsage)
                HorizontalDivider()
                if (!isChatSurface) {
                    item(stringResource(R.string.chat_panel_notes), Icons.Outlined.StickyNote2, actions.onNavigateToNotes)
                    item(stringResource(R.string.session_menu_tool_log), Icons.Outlined.Terminal, actions.onOpenToolLog)
                    item(stringResource(R.string.session_menu_mesh), Icons.Outlined.Hub, actions.onOpenSessionSettings)
                    item(stringResource(R.string.session_menu_appearance), Icons.Outlined.Palette, actions.onOpenSessionSettings)
                    item(stringResource(R.string.chat_memory), Icons.Outlined.Psychology, actions.onNavigateToMemory)
                }
                item(stringResource(R.string.chat_settings), Icons.Outlined.Tune, actions.onOpenSessionSettings)
                HorizontalDivider()
                item(stringResource(R.string.session_menu_rename), Icons.Outlined.Edit, actions.onEditTitle)
                item(stringResource(R.string.chat_restart_session), Icons.Outlined.Refresh, actions.onRestart)
                item(stringResource(R.string.action_archive), Icons.Outlined.Archive, actions.onArchive)
            }
        }
    }
}

/** Round floating header control with a spring press response. */
@Composable
private fun HeaderRoundButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    val palette = LocalPlumPalette.current
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.9f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "header_button_press",
    )
    Box(
        modifier = Modifier
            .size(44.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .shadow(2.dp, CircleShape, ambientColor = palette.glassShadow, spotColor = palette.glassShadow)
            .clip(CircleShape)
            .background(palette.controlSurface)
            .border(1.dp, palette.border.copy(alpha = .7f), CircleShape)
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = PlumText, modifier = Modifier.size(22.dp))
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
