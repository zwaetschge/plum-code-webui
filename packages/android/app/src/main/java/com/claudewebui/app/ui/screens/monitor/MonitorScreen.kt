package com.claudewebui.app.ui.screens.monitor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.claudewebui.app.R
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.components.dashboard.accentFor
import com.claudewebui.app.ui.components.dashboard.effectiveState
import com.claudewebui.app.ui.components.dashboard.facts
import com.claudewebui.app.ui.components.dashboard.localizedLabel
import com.claudewebui.app.ui.theme.PlumTheme
import com.claudewebui.app.ui.components.chat.ChatInput
import com.claudewebui.app.ui.screens.chat.rememberAttachmentPicker
import com.claudewebui.app.ui.screens.chat.rememberVoiceDictation
import androidx.compose.material.icons.outlined.ArrowDropDown
import kotlinx.coroutines.delay
import org.koin.compose.viewmodel.koinViewModel

/**
 * Four sessions, live, on one screen.
 *
 * Portrait phones stack the tiles; anything 600dp wide or more gets a 2×2
 * grid. Every tile shows what its agent is doing this second, offers the
 * approval or question that is blocking it, and takes a follow-up without
 * leaving the screen. Tapping the header opens the full chat.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitorScreen(
    onNavigateMain: (MainDestination) -> Unit,
    onOpenSession: (String) -> Unit,
    /** Debug-only fixture state; when set, no ViewModel is created and actions are inert. */
    previewState: MonitorUiState? = null,
) {
    val viewModel: MonitorViewModel? = if (previewState == null) koinViewModel<MonitorViewModel>() else null
    val liveState = viewModel?.uiState?.collectAsStateWithLifecycle()
    val state = previewState ?: liveState?.value ?: MonitorUiState()
    val tokens = PlumTheme.tokens

    // Approvals answered elsewhere while the screen was in the background
    // would otherwise keep offering their buttons.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel?.refresh()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val attention = state.sessions.count { it.pendingApprovals > 0 || it.status == SessionStatus.ERROR }

    PlumBackdrop {
        PlumNavScaffold(
            selected = MainDestination.MONITOR,
            onNavigate = onNavigateMain,
            badgeCount = attention,
        ) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding())
                    .padding(horizontal = tokens.spacing.md),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = tokens.spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.monitor_title),
                            color = PlumText,
                            fontSize = 21.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            stringResource(R.string.monitor_subtitle, state.filledCount, MONITOR_SLOT_COUNT, state.activeCount),
                            color = PlumMuted,
                            fontSize = 11.sp,
                        )
                    }
                    Box(Modifier.size(8.dp).background(if (state.isConnected) PlumGreen else PlumRed, CircleShape))
                    Spacer(Modifier.width(tokens.spacing.sm))
                    PlumIconButton(Icons.Outlined.Refresh, stringResource(R.string.monitor_refresh), onClick = { viewModel?.refresh() })
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val columns = if (maxWidth >= 600.dp) 2 else 1
                    val rows = (MONITOR_SLOT_COUNT + columns - 1) / columns
                    // Two 350dp columns (a 7-inch tablet in landscape) leave the
                    // full composer no room: with mic, clip and send the text
                    // field shrank to a few characters. Below ~400dp per tile
                    // the dictation button steps aside; the chat keeps it.
                    val narrowTiles = (maxWidth - tokens.spacing.sm * (columns - 1)) / columns < 400.dp
                    // A tile needs room for its header, a status line, a few
                    // lines of live text, a prompt strip and the composer.
                    // Dividing a phone screen into four equal rows left about
                    // 200dp each, which clipped the prompt buttons and squeezed
                    // the live text out entirely. Rows keep a floor and the
                    // grid scrolls instead; on a tablet the floor never bites.
                    // Side-by-side tiles are wide enough that the composer and
                    // prompt strip need less height: a landscape tablet (~250dp
                    // per row) now shows all four instead of cutting the
                    // second row in half.
                    val rowHeight = maxOf(
                        if (columns > 1) MIN_WIDE_TILE_HEIGHT else MIN_TILE_HEIGHT,
                        (maxHeight - tokens.spacing.sm * (rows - 1)) / rows,
                    )
                    Column(
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(tokens.spacing.sm),
                    ) {
                        for (row in 0 until rows) {
                            Row(
                                Modifier.height(rowHeight).fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(tokens.spacing.sm),
                            ) {
                                for (column in 0 until columns) {
                                    val slot = row * columns + column
                                    if (slot >= MONITOR_SLOT_COUNT) {
                                        Spacer(Modifier.weight(1f))
                                        continue
                                    }
                                    val sessionId = state.slots[slot]
                                    val tile = sessionId?.let { state.tiles[it] }
                                    if (tile == null) {
                                        EmptySlot(
                                            index = slot,
                                            onPick = { viewModel?.openPicker(slot) },
                                            modifier = Modifier.weight(1f).fillMaxHeight(),
                                        )
                                    } else {
                                        MonitorTileCard(
                                            tile = tile,
                                            modifier = Modifier.weight(1f).fillMaxHeight(),
                                            narrow = narrowTiles,
                                            onOpen = { onOpenSession(tile.sessionId) },
                                            onSwap = { viewModel?.openPicker(slot) },
                                            onClear = { viewModel?.clear(slot) },
                                            onSend = { viewModel?.send(tile.sessionId, it) },
                                            onDraftChange = { viewModel?.updateDraft(tile.sessionId, it) },
                                            onAttachments = { viewModel?.addAttachments(tile.sessionId, it) },
                                            onAttachmentFailure = { failed, total -> viewModel?.reportAttachmentFailure(tile.sessionId, failed, total) },
                                            onRemoveAttachment = { viewModel?.removeAttachment(tile.sessionId, it) },
                                            onAudio = { viewModel?.transcribe(tile.sessionId, it) },
                                            onInterrupt = { viewModel?.interrupt(tile.sessionId) },
                                            onApprove = { viewModel?.respondToApproval(tile.sessionId, true) },
                                            onDeny = { viewModel?.respondToApproval(tile.sessionId, false) },
                                            onAnswer = { viewModel?.answerQuestion(tile.sessionId, it) },
                                            onDismissError = { viewModel?.dismissError(tile.sessionId) },
                                            onSentShown = { viewModel?.clearSentNotice(tile.sessionId) },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(tokens.spacing.sm))
            }
        }
    }

    state.pickerSlot?.let { slot ->
        ModalBottomSheet(
            onDismissRequest = { viewModel?.closePicker() },
            containerColor = PlumSurfaceStrong,
        ) {
            SessionPicker(
                slot = slot,
                sessions = state.sessions,
                chosen = state.slots.filterNotNull().toSet(),
                onPick = { viewModel?.assign(slot, it) },
                onClear = if (state.slots[slot] != null) ({ viewModel?.clear(slot); viewModel?.closePicker() }) else null,
            )
        }
    }
}

/** Floor for one grid row; below this the prompt strip and composer collide. */
private val MIN_TILE_HEIGHT = 340.dp
private val MIN_WIDE_TILE_HEIGHT = 230.dp

@Composable
private fun EmptySlot(index: Int, onPick: () -> Unit, modifier: Modifier = Modifier) {
    val tokens = PlumTheme.tokens
    Box(
        modifier
            .glassSurface(RoundedCornerShape(tokens.radius.panel))
            .clickable(onClick = onPick)
            .semantics { role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Add, contentDescription = null, tint = PlumMuted, modifier = Modifier.size(28.dp))
            Text(
                stringResource(R.string.monitor_empty_slot, index + 1),
                color = PlumText,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(stringResource(R.string.monitor_empty_hint), color = PlumMuted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MonitorTileCard(
    tile: MonitorTile,
    modifier: Modifier,
    narrow: Boolean,
    onOpen: () -> Unit,
    onSwap: () -> Unit,
    onClear: () -> Unit,
    onSend: (String) -> Unit,
    onDraftChange: (String) -> Unit,
    onAttachments: (List<com.claudewebui.app.data.model.PendingFileAttachment>) -> Unit,
    onAttachmentFailure: (Int, Int) -> Unit,
    onRemoveAttachment: (Int) -> Unit,
    onAudio: (ByteArray) -> Unit,
    onInterrupt: () -> Unit,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onAnswer: (String) -> Unit,
    onDismissError: () -> Unit,
    onSentShown: () -> Unit,
) {
    val tokens = PlumTheme.tokens
    val context = LocalContext.current
    val session = tile.session
    val verdict = session?.let { effectiveState(it) }
    val accent = when {
        tile.needsYou -> PlumAmber
        tile.error != null -> PlumRed
        tile.isWorking -> PlumGreen
        verdict != null -> accentFor(verdict)
        else -> PlumBorder
    }
    val name = session?.name ?: stringResource(R.string.native_session)
    val dictation = rememberVoiceDictation(onAudio)
    val pickAttachments = rememberAttachmentPicker(onPicked = onAttachments, onFailure = onAttachmentFailure)

    LaunchedEffect(tile.sentNotice) {
        if (tile.sentNotice) {
            delay(2_500)
            onSentShown()
        }
    }

    GlassPanel(modifier = modifier, radius = tokens.radius.panel, borderColor = accent) {
        Column(Modifier.fillMaxSize().padding(tokens.spacing.compact)) {
            // Header — tap to open the full chat.
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onOpen)
                    .semantics {
                        role = Role.Button
                        contentDescription = context.getString(R.string.monitor_open_chat, name)
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(9.dp).background(accent, CircleShape))
                Spacer(Modifier.width(tokens.spacing.sm))
                // The name is the session chooser: tap it to put another
                // session into this slot. The header's remaining width opens
                // the chat.
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(tokens.radius.sm))
                        .clickable(onClick = onSwap)
                        .semantics {
                            role = Role.Button
                            contentDescription = context.getString(R.string.monitor_choose_session)
                        }
                        .padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        name,
                        color = PlumText,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Icon(
                        Icons.Outlined.ArrowDropDown,
                        contentDescription = null,
                        tint = PlumMuted,
                        modifier = Modifier.size(20.dp),
                    )
                }
                session?.let {
                    Text(
                        providerLabel(it.cliProvider),
                        color = providerColor(it.cliProvider),
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(end = tokens.spacing.xs),
                    )
                }
                SmallAction(Icons.Outlined.SwapHoriz, stringResource(R.string.monitor_swap), onSwap)
                SmallAction(Icons.Outlined.OpenInNew, stringResource(R.string.monitor_open), onOpen)
            }

            // Status line — the verdict, then the live detail.
            val statusText = when {
                tile.isThinking -> stringResource(R.string.monitor_thinking)
                tile.currentTool != null -> tile.currentTool
                tile.isSending -> stringResource(R.string.monitor_sending)
                tile.sentNotice -> stringResource(R.string.monitor_sent)
                verdict != null && session != null -> verdict.localizedLabel(context, session.facts())
                else -> ""
            }
            Text(
                statusText,
                color = if (tile.needsYou || tile.error != null) accent else PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )

            // Body — the live tail, kept scrolled to the newest text.
            val scroll = rememberScrollState()
            val body = tile.bodyText
            LaunchedEffect(body.length) { scroll.scrollTo(scroll.maxValue) }
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(vertical = tokens.spacing.xs)
                    .verticalScroll(scroll),
            ) {
                if (body.isBlank()) {
                    Text(
                        if (tile.isWorking) stringResource(R.string.monitor_waiting_reply) else stringResource(R.string.monitor_no_output),
                        color = PlumMuted,
                        fontSize = 12.sp,
                    )
                } else {
                    // Rendered, not raw: tiles showed `**…**` and `##` verbatim.
                    val rendered = remember(body) { compactMarkdown(body) }
                    Text(
                        rendered,
                        color = if (tile.streamingText.isNotEmpty()) PlumText else PlumText.copy(alpha = .82f),
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }

            tile.error?.let { error ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .glassSurface(RoundedCornerShape(tokens.radius.md), borderColor = PlumRed.copy(alpha = .5f))
                        .padding(horizontal = tokens.spacing.sm, vertical = tokens.spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(error, color = PlumRed, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    SmallAction(Icons.Outlined.Close, stringResource(R.string.native_dismiss), onDismissError, tint = PlumRed)
                }
                Spacer(Modifier.height(tokens.spacing.xs))
            }

            // Blocking prompts — answerable right here.
            val approvalLabel = tile.approval?.toolName ?: tile.legacyApproval?.toolNames?.joinToString()
            if (approvalLabel != null) {
                PromptStrip(
                    text = stringResource(R.string.monitor_approval, approvalLabel),
                    actions = listOf(
                        stringResource(R.string.native_approve) to onApprove,
                        stringResource(R.string.native_deny) to onDeny,
                    ),
                )
            } else if (tile.question != null) {
                val question = tile.question.questions.firstOrNull()
                val options = question?.options?.map { it.label }?.filter { it.isNotBlank() }.orEmpty().take(3)
                PromptStrip(
                    text = question?.question?.takeIf { it.isNotBlank() } ?: stringResource(R.string.native_question_asked),
                    actions = if (options.isNotEmpty() && tile.question.questions.size == 1) {
                        options.map { option -> option to { onAnswer(option) } }
                    } else {
                        listOf(stringResource(R.string.monitor_answer_in_chat) to onOpen)
                    },
                )
            }

            // The real chat composer: attachments, dictation, interrupt and
            // the same limits as the full screen — four sessions, one path.
            ChatInput(
                text = tile.draft,
                onTextChange = onDraftChange,
                onSend = onSend,
                onAttachFile = pickAttachments,
                isWorking = tile.isWorking,
                onInterrupt = onInterrupt,
                attachments = tile.pendingAttachments,
                onRemoveAttachment = onRemoveAttachment,
                isPreparingAttachments = tile.isPreparingAttachments,
                attachmentPreparationProgress = tile.attachmentProgress,
                voiceAvailable = !narrow,
                isTranscribing = tile.isTranscribing,
                isRecording = dictation.isRecording,
                onToggleRecording = dictation::toggle,
            )
        }
    }
}

@Composable
private fun SmallAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    tint: Color = PlumMuted,
) {
    IconButton(onClick = onClick, modifier = Modifier.size(32.dp)) {
        Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(18.dp))
    }
}

/** An amber strip with the blocking prompt and its answers. */
@Composable
private fun PromptStrip(text: String, actions: List<Pair<String, () -> Unit>>) {
    val tokens = PlumTheme.tokens
    Column(
        Modifier
            .fillMaxWidth()
            .glassSurface(RoundedCornerShape(tokens.radius.md), borderColor = PlumAmber.copy(alpha = .6f))
            .padding(horizontal = tokens.spacing.sm, vertical = tokens.spacing.xs),
    ) {
        Text(text, color = PlumText, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(
            Modifier.fillMaxWidth().padding(top = tokens.spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(tokens.spacing.xs),
        ) {
            actions.forEachIndexed { index, (label, action) ->
                val primary = index == 0
                Text(
                    label,
                    color = if (primary) Color.White else PlumText,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .background(
                            if (primary) PlumAccent else Color.Transparent,
                            RoundedCornerShape(50),
                        )
                        .then(
                            if (primary) Modifier
                            else Modifier.background(PlumBorder.copy(alpha = .35f), RoundedCornerShape(50))
                        )
                        .clickable(onClick = action)
                        .semantics { role = Role.Button }
                        .padding(horizontal = tokens.spacing.md, vertical = 5.dp),
                )
            }
        }
    }
    Spacer(Modifier.height(tokens.spacing.xs))
}

@Composable
private fun SessionPicker(
    slot: Int,
    sessions: List<Session>,
    chosen: Set<String>,
    onPick: (String) -> Unit,
    onClear: (() -> Unit)?,
) {
    val tokens = PlumTheme.tokens
    var query by remember { mutableStateOf("") }
    val ordered = remember(sessions, query) {
        sessions
            .filter { query.isBlank() || it.name.contains(query, ignoreCase = true) || it.workingDirectory.contains(query, ignoreCase = true) }
            .sortedWith(
                compareByDescending<Session> { it.busy || it.status == SessionStatus.RUNNING }
                    .thenByDescending { it.lastActivityAt ?: it.updatedAt }
            )
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = tokens.spacing.lg).padding(bottom = tokens.spacing.xl)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.monitor_picker_title, slot + 1),
                color = PlumText,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            onClear?.let {
                Text(
                    stringResource(R.string.monitor_clear),
                    color = PlumRed,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clickable(onClick = it)
                        .semantics { role = Role.Button }
                        .padding(tokens.spacing.sm),
                )
            }
        }
        Spacer(Modifier.height(tokens.spacing.sm))
        Box(
            Modifier
                .fillMaxWidth()
                .glassSurface(RoundedCornerShape(50))
                .padding(horizontal = tokens.spacing.md, vertical = tokens.spacing.compact),
        ) {
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                textStyle = TextStyle(color = PlumText, fontSize = 14.sp),
                cursorBrush = SolidColor(PlumAccent),
                singleLine = true,
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) Text(stringResource(R.string.monitor_picker_search), color = PlumMuted, fontSize = 14.sp)
                        inner()
                    }
                },
            )
        }
        Spacer(Modifier.height(tokens.spacing.sm))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(tokens.spacing.xs)) {
            items(ordered, key = { it.id }) { session ->
                val verdict = effectiveState(session)
                val selected = session.id in chosen
                Row(
                    Modifier
                        .fillMaxWidth()
                        .glassSurface(
                            RoundedCornerShape(tokens.radius.md),
                            borderColor = if (selected) PlumAccent.copy(alpha = .6f) else null,
                        )
                        .clickable { onPick(session.id) }
                        .semantics { role = Role.Button }
                        .padding(horizontal = tokens.spacing.md, vertical = tokens.spacing.compact),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(9.dp).background(accentFor(verdict), CircleShape))
                    Spacer(Modifier.width(tokens.spacing.sm))
                    Column(Modifier.weight(1f)) {
                        Text(session.name, color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            verdict.localizedLabel(LocalContext.current, session.facts()),
                            color = PlumMuted,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(providerLabel(session.cliProvider), color = providerColor(session.cliProvider), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/**
 * Markdown flattened to one styled text for the small tile body. The chat's
 * block renderer uses 22sp lines and card-sized code blocks, which a tile of
 * a few hundred dp cannot afford.
 */
private fun compactMarkdown(text: String): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        val blocks = com.claudewebui.app.ui.components.chat.parseMarkdown(text)
        blocks.forEachIndexed { index, block ->
            if (index > 0) append('\n')
            when (block) {
                is com.claudewebui.app.ui.components.chat.MarkdownBlock.Paragraph -> append(block.annotated)
                is com.claudewebui.app.ui.components.chat.MarkdownBlock.Heading -> {
                    pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold))
                    append(block.annotated)
                    pop()
                }
                is com.claudewebui.app.ui.components.chat.MarkdownBlock.Blockquote -> { append("▎ "); append(block.annotated) }
                is com.claudewebui.app.ui.components.chat.MarkdownBlock.ListItem -> {
                    append("  ".repeat(block.indent.coerceIn(0, 4)))
                    append(if (block.ordered) "${block.number}. " else "• ")
                    append(block.annotated)
                }
                is com.claudewebui.app.ui.components.chat.MarkdownBlock.Code -> {
                    pushStyle(androidx.compose.ui.text.SpanStyle(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace))
                    append(block.code.trimEnd())
                    pop()
                }
                is com.claudewebui.app.ui.components.chat.MarkdownBlock.Table -> {
                    (listOf(block.header) + block.rows).forEachIndexed { rowIndex, row ->
                        if (rowIndex > 0) append('\n')
                        row.forEachIndexed { cell, value -> if (cell > 0) append(" · "); append(value) }
                    }
                }
                com.claudewebui.app.ui.components.chat.MarkdownBlock.HorizontalRule -> append("———")
            }
        }
    }
