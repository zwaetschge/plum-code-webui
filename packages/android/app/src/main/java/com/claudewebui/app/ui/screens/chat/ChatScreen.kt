package com.claudewebui.app.ui.screens.chat

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
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
import com.claudewebui.app.data.model.*
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.ui.components.chat.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import com.claudewebui.app.ui.components.chat.TurnDiffRow
import com.claudewebui.app.ui.components.chat.TurnDiffDetailView
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import androidx.compose.material3.ModalBottomSheet
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.PlumTrackFill
import com.claudewebui.app.ui.components.common.fadingEdges
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.components.common.sessionModel
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.LocalReduceMotion
import com.claudewebui.app.data.model.UsageLimitData
import com.claudewebui.app.data.model.UsageLimitWindow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import java.text.DecimalFormat
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    sessionId: String,
    initialMessageId: String? = null,
    initialChatId: String? = null,
    onNavigateBack: () -> Unit,
    onNavigateToFiles: (String) -> Unit = {},
    onNavigateToGit: (String) -> Unit = {},
    onNavigateToCheckpoints: (String) -> Unit = {},
    onNavigateToNotes: (String) -> Unit = {},
    onNavigateToMemory: (String) -> Unit = {},
    onNavigateToDevTools: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    // Owned in a per-session store that is cleared when the screen switches
    // sessions or leaves composition. Parameters are only read at creation, so
    // an unkeyed lookup would reuse the previous session's instance — while a
    // host-store `key = sessionId` parked one live ViewModel (socket
    // subscriptions, 25s heartbeat and all) per visited session forever.
    val sessionStoreOwner = remember(sessionId) {
        object : ViewModelStoreOwner {
            override val viewModelStore = ViewModelStore()
        }
    }
    DisposableEffect(sessionStoreOwner) {
        onDispose { sessionStoreOwner.viewModelStore.clear() }
    }
    val viewModel: ChatViewModel = koinViewModel(
        viewModelStoreOwner = sessionStoreOwner,
        parameters = { parametersOf(sessionId) },
    )
    val uiState by viewModel.uiState.collectAsState()
    var showSessionSettings by remember { mutableStateOf(false) }
    var showToolLog by remember { mutableStateOf(false) }
    val messages by viewModel.messages.collectAsState()
    val outboxItems by viewModel.outbox.collectAsState()
    val session by viewModel.session.collectAsState()
    val isDesignPreview = BuildConfig.DEBUG && sessionId == "preview"
    val displaySession = session ?: if (isDesignPreview) previewSession() else null
    val displayUiState = if (isDesignPreview) previewChatState() else uiState

    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val pullRefreshState = rememberPullToRefreshState()
    val context = LocalContext.current
    val reduceMotion = LocalReduceMotion.current
    var selectedAttachment by remember { mutableStateOf<HistoryAttachmentItem?>(null) }
    var attachmentActionBusy by remember { mutableStateOf(false) }
    var pendingSaveFile by remember { mutableStateOf<File?>(null) }
    var olderAnchorKey by remember { mutableStateOf<String?>(null) }
    var olderAnchorOffset by remember { mutableIntStateOf(0) }
    var initialHistoryPositioned by remember { mutableStateOf(false) }

    // The export lands in state; only the screen has a Context to share it.
    LaunchedEffect(uiState.pendingShareTranscript) {
        val markdown = uiState.pendingShareTranscript ?: return@LaunchedEffect
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/markdown"
            putExtra(android.content.Intent.EXTRA_TITLE, session?.name ?: "Transcript")
            putExtra(android.content.Intent.EXTRA_TEXT, markdown)
        }
        context.startActivity(android.content.Intent.createChooser(intent, "Share transcript"))
        viewModel.consumePendingShare()
    }

    val saveAttachmentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("*/*"),
    ) { destination ->
        val source = pendingSaveFile
        pendingSaveFile = null
        if (destination != null && source != null) {
            coroutineScope.launch(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openOutputStream(destination)?.use { output ->
                        source.inputStream().use { input -> input.copyTo(output) }
                    } ?: error("The selected destination cannot be written")
                }.onFailure { viewModel.reportError(it.message ?: "Couldn't save attachment") }
            }
        }
    }

    val performAttachmentAction: (AttachmentAction) -> Unit = { action ->
        val attachment = selectedAttachment
        val mediaId = attachment?.mediaId
        if (attachment == null || mediaId == null) {
            selectedAttachment = null
            viewModel.reportError("This legacy attachment is no longer available for download")
        } else {
            coroutineScope.launch {
                attachmentActionBusy = true
                viewModel.fetchAttachment(mediaId)
                    .mapCatching { bytes ->
                        withContext(Dispatchers.IO) {
                            cacheChatAttachment(context, attachment.filename, bytes)
                        }
                    }
                    .onSuccess { file ->
                        selectedAttachment = null
                        runCatching {
                            when (action) {
                                AttachmentAction.OPEN -> openChatAttachment(
                                    context,
                                    file,
                                    attachment.mimeType,
                                )
                                AttachmentAction.SHARE -> shareChatAttachment(
                                    context,
                                    file,
                                    attachment.mimeType,
                                )
                                AttachmentAction.SAVE -> {
                                    pendingSaveFile = file
                                    saveAttachmentLauncher.launch(attachment.filename)
                                }
                            }
                        }.onFailure { failure ->
                            viewModel.reportError(failure.message ?: "No compatible app is installed")
                        }
                    }
                    .onFailure { failure ->
                        viewModel.reportError(failure.message ?: "Couldn't download attachment")
                    }
                attachmentActionBusy = false
            }
        }
    }

    // Refresh when returning from background: events emitted while away are
    // gone and the socket may be a half-open zombie, so the history refetches
    // over REST and the socket layer re-joins the session room.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        var seenFirstResume = false
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                // The first ON_RESUME is the initial entry — initializeChat
                // already loads everything then.
                if (seenFirstResume) viewModel.onResumed() else seenFirstResume = true
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Dictation: one recorder per screen, permission asked at first use.
    val recorder = remember { com.claudewebui.app.core.audio.VoiceRecorder(context) }
    var isRecording by remember { mutableStateOf(false) }
    var hasMicPermission by remember {
        mutableStateOf(
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.RECORD_AUDIO,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        )
    }
    val micPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasMicPermission = granted
        if (granted) isRecording = recorder.start()
    }
    DisposableEffect(Unit) {
        onDispose { recorder.cancel() }
    }

    val pickFilesLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        coroutineScope.launch {
            val attachments = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri ->
                    runCatching {
                        context.contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                    }
                    inspectAttachmentUri(context.contentResolver, uri)
                }
            }
            if (attachments.isNotEmpty()) {
                viewModel.addAttachments(attachments)
            }
            val failed = uris.size - attachments.size
            if (failed > 0) {
                viewModel.reportAttachmentFailure(failed, uris.size)
            }
        }
    }

    // Show FAB when scrolled up more than 2 items from bottom
    val showScrollToBottom by remember {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val total = listState.layoutInfo.totalItemsCount
            total > 0 && lastVisible < total - 2
        }
    }

    // Build display items: messages + streaming + thinking. The stable part is
    // remembered — StreamingState changes every 50ms flush, and rebuilding one
    // wrapper per cached message on each flush dominated streaming jank. The
    // streaming row is appended separately.
    val baseDisplayItems = if (isDesignPreview) {
        previewDisplayItems()
    } else {
        remember(
            messages,
            outboxItems,
            displayUiState.lastReadMessageId,
            displayUiState.unreadCount,
            displayUiState.activeTools,
        ) {
            buildDisplayItems(messages, outboxItems, displayUiState)
        }
    }
    val streamingPartial = if (isDesignPreview) null else {
        (displayUiState.streamingState as? StreamingState.Streaming)
            ?.partialText?.takeIf { it.isNotEmpty() }
    }
    val displayItems = if (streamingPartial != null) {
        baseDisplayItems + DisplayItem.StreamingItem(streamingPartial)
    } else {
        baseDisplayItems
    }

    LaunchedEffect(initialMessageId, initialChatId) {
        initialMessageId?.takeIf { it.isNotBlank() }?.let { messageId ->
            viewModel.jumpToMessage(messageId, initialChatId)
        }
    }

    val revealWindow by viewModel.revealWindow.collectAsState()
    val requestOlderHistory = {
        // Fires when the server has more, or when the local window is full —
        // Room may hold older rows the transcript has not revealed yet.
        if (
            (displayUiState.hasMoreHistory || messages.size >= revealWindow) &&
            !displayUiState.isLoadingOlderHistory &&
            !isDesignPreview
        ) {
            listState.layoutInfo.visibleItemsInfo
                .firstOrNull { it.key != "history_loader" }
                ?.let { visible ->
                    olderAnchorKey = visible.key.toString()
                    olderAnchorOffset = visible.offset
                }
            viewModel.loadOlderHistory()
        }
    }

    // Infinite scroll starts before the user reaches the absolute top.
    LaunchedEffect(listState, displayUiState.hasMoreHistory, displayUiState.isLoadingOlderHistory) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .filter { initialHistoryPositioned && it <= 2 }
            .collect { requestOlderHistory() }
    }

    // Explicitly restore the same visible message after Room prepends a page.
    // Stable LazyColumn keys already handle most cases; this also covers the
    // history-loader row disappearing on the final page.
    LaunchedEffect(displayUiState.historyPageVersion) {
        val anchor = olderAnchorKey ?: return@LaunchedEffect
        val messageIndex = displayItems.indexOfFirst { it.key == anchor }
        if (messageIndex >= 0) {
            val headerCount = if (
                displayUiState.hasMoreHistory || displayUiState.isLoadingOlderHistory
            ) 1 else 0
            listState.scrollToItem(messageIndex + headerCount, olderAnchorOffset)
        }
        olderAnchorKey = null
    }

    // Auto-scroll to bottom when new content arrives. Anchor the END of the
    // last item, not its top — long assistant replies are taller than the
    // viewport and would otherwise sit cut off behind the composer. The IME
    // height is a key so opening the keyboard re-anchors the conversation end.
    val displayItemCount = displayItems.size
    val historyHeaderCount = if (
        displayUiState.hasMoreHistory || displayUiState.isLoadingOlderHistory
    ) 1 else 0
    val streamingText = displayUiState.streamingText
    val imeBottom = WindowInsets.ime.getBottom(LocalDensity.current)
    // Re-anchoring per 50ms flush re-measured the growing last item every
    // frame; a coarse length bucket keeps the end pinned a few times per reply.
    val streamingAnchorBucket = (streamingText?.length ?: -1) / 128
    LaunchedEffect(displayItemCount, streamingAnchorBucket, imeBottom) {
        if (!initialHistoryPositioned && displayItemCount > 0) {
            val anchor = displayUiState.restoreAnchorMessageId
            val anchorIndex = anchor?.let { id ->
                displayItems.indexOfFirst { it is DisplayItem.MessageItem && it.message.id == id }
            } ?: -1
            if (anchorIndex >= 0) {
                listState.scrollToItem(
                    anchorIndex + historyHeaderCount,
                    displayUiState.restoreAnchorOffset,
                )
            } else {
                listState.scrollToItem(
                    displayItemCount - 1 + historyHeaderCount,
                    scrollOffset = 1_000_000,
                )
            }
            initialHistoryPositioned = true
        } else if (!showScrollToBottom && displayItemCount > 0) {
            listState.scrollToItem(
                displayItemCount - 1 + historyHeaderCount,
                scrollOffset = 1_000_000,
            )
        }
    }

    LaunchedEffect(displayUiState.jumpVersion) {
        val messageId = displayUiState.jumpTargetMessageId ?: return@LaunchedEffect
        val index = displayItems.indexOfFirst {
            it is DisplayItem.MessageItem && it.message.id == messageId
        }
        if (index >= 0) listState.scrollToItem(index + historyHeaderCount)
    }

    // Keyed on the size, not the list: the streaming flush replaces the list
    // identity 20x/s and used to cancel/rebuild this snapshotFlow each time.
    val currentDisplayItems by rememberUpdatedState(displayItems)
    LaunchedEffect(listState, displayItems.size, historyHeaderCount) {
        snapshotFlow {
            val visible = listState.layoutInfo.visibleItemsInfo
                .firstOrNull { it.key != "history_loader" }
            val item = visible?.let { info ->
                currentDisplayItems.getOrNull(info.index - historyHeaderCount)
            }
            Triple(!showScrollToBottom, (item as? DisplayItem.MessageItem)?.message?.id, visible?.offset ?: 0)
        }
            .distinctUntilChanged()
            .collect { (atBottom, anchorId, offset) ->
                if (initialHistoryPositioned) viewModel.onViewportState(atBottom, anchorId, offset)
            }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        // Transparent over the app-wide PlumBackdrop — the bars and bubbles
        // are frosted glass, so the atmospheric glow must show through.
        containerColor = Color.Transparent,
        topBar = {
            ChatTopBar(
                session = displaySession,
                uiState = displayUiState,
                onNavigateBack = onNavigateBack,
                onEditTitle = { viewModel.setEditingTitle(true) },
                onTitleSaved = { viewModel.updateTitle(it) },
                onNavigateToFiles = { onNavigateToFiles(displaySession?.workingDirectory ?: "") },
                onNavigateToGit = { onNavigateToGit(displaySession?.workingDirectory ?: "") },
                onNavigateToCheckpoints = { onNavigateToCheckpoints(sessionId) },
                onToggleUsage = { viewModel.toggleUsageBanner() },
                onOpenToolLog = { showToolLog = true },
                onOpenSessionSettings = {
                    viewModel.loadAvailableModels()
                    showSessionSettings = true
                },
                onNavigateToNotes = { onNavigateToNotes(sessionId) },
                // Memory files hang off the working directory, not the session.
                onNavigateToMemory = {
                    onNavigateToMemory(displaySession?.workingDirectory ?: "")
                },
                onNavigateToDevTools = {
                    onNavigateToDevTools(displaySession?.workingDirectory ?: "")
                },
                isEditingTitle = uiState.isEditingTitle,
                onSwitchChat = viewModel::switchChat,
                onNewChat = viewModel::newChat,
                onDeleteChat = viewModel::deleteChat,
                onSearch = { viewModel.setSearchOpen(true) },
            )
        },
        bottomBar = {
            // Soft scrim instead of a solid bar: the chat scrolls in behind
            // the composer and fades out under it.
            val palette = LocalPlumPalette.current
            Column(
                modifier = Modifier
                    // Opaque under the composer itself, not just mostly: the
                    // input pill is translucent glass, so anything less let the
                    // transcript read straight through the text field.
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Transparent,
                            .12f to palette.background.copy(alpha = .97f),
                            1f to palette.background,
                        ),
                    )
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                // Usage stats panel (Stats tab): model, account limits and
                // context/token/cost — shown even before the first turn so the
                // limits are always reachable.
                AnimatedVisibility(
                    visible = displayUiState.showUsageBanner,
                    enter = expandVertically(expandFrom = Alignment.Bottom),
                    exit = shrinkVertically(shrinkTowards = Alignment.Bottom),
                ) {
                    UsageBanner(
                        usage = displayUiState.usageData,
                        session = displaySession,
                        limits = displayUiState.providerLimits,
                    )
                }

                // Interactive prompts must be visible while the app is open,
                // or the session stalls with no way to continue.
                displayUiState.pendingPermission?.let { request ->
                    PermissionRequestCard(
                        request = request,
                        onAction = { viewModel.respondToPermission(it) },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
                displayUiState.pendingLegacyPermission?.let { request ->
                    LegacyPermissionCard(
                        request = request,
                        onApprove = { viewModel.respondToLegacyPermission(true) },
                        onDeny = { viewModel.respondToLegacyPermission(false) },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
                displayUiState.pendingQuestion?.let { question ->
                    QuestionPromptCard(
                        request = question,
                        onRespond = { viewModel.respondToQuestion(it) },
                        onDismiss = { viewModel.dismissQuestion() },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }

                TaskWorkbenchStrip(
                    todos = displayUiState.todos,
                    queuedCount = displayUiState.queuedCount,
                    contextUsedPercent = displayUiState.usageData?.contextUsedPercent ?: 0.0,
                )

                // Most recent working-tree change, so "what did it just do?"
                // is answered without leaving the chat.
                displayUiState.turnDiffs.firstOrNull()?.let { diff ->
                    TurnDiffRow(
                        diff = diff,
                        onOpen = { viewModel.openTurnDiff(it) },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                }

                if (displayUiState.queuedCount > 0) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 2.dp)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (displayUiState.queuedCount == 1) {
                                "1 message queued"
                            } else {
                                "${displayUiState.queuedCount} messages queued"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        // CLI-style steering: abort the running turn so the
                        // queued follow-up runs immediately — the server drains
                        // the queue as soon as the interrupted turn ends.
                        TextButton(
                            onClick = { viewModel.interrupt() },
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.SkipNext,
                                contentDescription = null,
                                tint = PlumAmber,
                                modifier = Modifier.size(15.dp),
                            )
                            Text(
                                text = " Interrupt & run now",
                                style = MaterialTheme.typography.labelSmall,
                                color = PlumAmber,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }

                // Thinking/tool indicator sits just above input
                ThinkingIndicator(
                    isThinking = displayUiState.isThinking,
                    toolName = displayUiState.currentToolName ?: displayUiState.thinkingLabel,
                    thinkingStartTime = displayUiState.thinkingStartTime,
                )

                ChatInput(
                    text = uiState.draftText,
                    onTextChange = { viewModel.onInputChange(it) },
                    onSend = { viewModel.sendMessage(it) },
                    onAttachFile = { pickFilesLauncher.launch(arrayOf("*/*")) },
                    isWorking = uiState.isWorking,
                    onInterrupt = { viewModel.interrupt() },
                    attachments = uiState.pendingAttachments,
                    onRemoveAttachment = { viewModel.removeAttachment(it) },
                    isPreparingAttachments = uiState.isPreparingAttachments,
                    attachmentPreparationProgress = uiState.attachmentPreparationProgress,
                    activeFollowupMode = uiState.activeFollowupMode,
                    onActiveFollowupModeChange = viewModel::setActiveFollowupMode,
                    onCancelDelivery = uiState.activeDeliveryId?.let { id ->
                        { viewModel.cancelDelivery(id) }
                    },
                    slashCommands = uiState.slashCommands,
                    voiceAvailable = uiState.voiceAvailable,
                    isTranscribing = uiState.isTranscribing,
                    isRecording = isRecording,
                    onToggleRecording = {
                        if (isRecording) {
                            recorder.stop()?.let { viewModel.transcribeAndAppend(it) }
                            isRecording = false
                        } else if (hasMicPermission) {
                            isRecording = recorder.start()
                        } else {
                            micPermissionLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
                        }
                    },
                )
            }
        },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        // The list fills the whole screen and scrolls BEHIND the floating
        // glass bars; the scaffold insets become list content padding so no
        // message ever rests hidden under a bar.
        Box(
            modifier = Modifier.fillMaxSize(),
        ) {
            PullToRefreshBox(
                isRefreshing = uiState.isLoadingHistory,
                onRefresh = { viewModel.loadHistory() },
                state = pullRefreshState,
                modifier = Modifier.fillMaxSize(),
                indicator = {
                    PullToRefreshDefaults.Indicator(
                        state = pullRefreshState,
                        isRefreshing = uiState.isLoadingHistory,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = padding.calculateTopPadding()),
                    )
                },
            ) {
                if (displayItems.isEmpty() && displayUiState.isLoadingHistory) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                } else if (displayItems.isEmpty() && !displayUiState.isConnected) {
                    ChatUnavailableState(
                        title = "You're offline",
                        detail = "Cached messages will remain available. Reconnect and retry to refresh this chat.",
                        icon = Icons.Outlined.CloudOff,
                        onRetry = viewModel::onResumed,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else if (displayItems.isEmpty() && displayUiState.error != null) {
                    ChatUnavailableState(
                        title = "Chat couldn't be loaded",
                        detail = displayUiState.error,
                        icon = Icons.Outlined.ErrorOutline,
                        onRetry = viewModel::loadHistory,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else if (displayItems.isEmpty()) {
                    EmptyChat(modifier = Modifier.fillMaxSize())
                } else {
                    LazyColumn(
                        state = listState,
                        // Bubbles dissolve into the header and the composer
                        // rather than disappearing at the scrim's edge.
                        modifier = Modifier
                            .fillMaxSize()
                            .fadingEdges(top = 20.dp, bottom = 20.dp),
                        contentPadding = PaddingValues(
                            top = padding.calculateTopPadding() + 8.dp,
                            bottom = padding.calculateBottomPadding() + 8.dp,
                        ),
                    ) {
                        if (displayUiState.hasMoreHistory || displayUiState.isLoadingOlderHistory) {
                            item(key = "history_loader") {
                                Box(
                                    Modifier.fillMaxWidth().padding(vertical = 8.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (displayUiState.isLoadingOlderHistory) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                            Text("Loading earlier messages…", color = PlumMuted, fontSize = 12.sp)
                                        }
                                    } else {
                                        TextButton(onClick = requestOlderHistory) {
                                            Icon(Icons.Outlined.History, contentDescription = null)
                                            Text("  Load earlier messages")
                                        }
                                    }
                                }
                            }
                        }
                        itemsIndexed(
                            items = displayItems,
                            key = { _, item -> item.key },
                        ) { index, item ->
                            when (item) {
                                is DisplayItem.MessageItem -> if (
                                    item.message.id.startsWith("compact-")
                                ) {
                                    // Context-compaction markers are not chat
                                    // turns; the server flags them by id prefix
                                    // exactly as the WebUI reads them.
                                    CompactBoundaryCard(
                                        content = item.message.content,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    )
                                } else {
                                    val groupInfo = computeGroupInfo(displayItems, index)
                                    MessageBubble(
                                        message = item.message,
                                        groupInfo = groupInfo,
                                        modifier = Modifier
                                            .then(
                                                if (item.message.id == displayUiState.jumpTargetMessageId) {
                                                    Modifier.background(PlumAccent.copy(alpha = .1f))
                                                } else Modifier
                                            )
                                            .then(
                                                if (reduceMotion) Modifier else Modifier.animateItem(
                                                    fadeInSpec = tween(200),
                                                    placementSpec = spring(stiffness = Spring.StiffnessMediumLow),
                                                )
                                            ),
                                        isStreaming = false,
                                        onQuote = { viewModel.quoteIntoDraft(it) },
                                        onAttachmentClick = { selectedAttachment = it },
                                    )
                                }
                                is DisplayItem.StreamingItem -> {
                                    StreamingBubble(
                                        text = item.text,
                                        modifier = if (reduceMotion) Modifier else Modifier.animateItem(),
                                    )
                                }
                                is DisplayItem.ToolItem -> {
                                    ToolExecutionCard(
                                        tool = item.tool,
                                        modifier = Modifier
                                            .padding(horizontal = 16.dp, vertical = 4.dp)
                                            .then(if (reduceMotion) Modifier else Modifier.animateItem()),
                                        initiallyExpanded = item.tool.status == ToolStatus.STARTED,
                                    )
                                }
                                is DisplayItem.OutboxItem -> {
                                    OutboxBubble(
                                        item = item.item,
                                        onRetry = { viewModel.retryOutbox(item.item.clientMessageId) },
                                        onCancel = { viewModel.cancelDelivery(item.item.clientMessageId) },
                                    )
                                }
                                DisplayItem.UnreadDivider -> {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp, vertical = 10.dp)
                                            .semantics {
                                                heading()
                                                liveRegion = LiveRegionMode.Polite
                                            },
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    ) {
                                        HorizontalDivider(Modifier.weight(1f), color = PlumAccent)
                                        Text(
                                            "New messages",
                                            color = PlumAccent,
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                        HorizontalDivider(Modifier.weight(1f), color = PlumAccent)
                                    }
                                }
                            }
                        }
                        if (displayUiState.hasMoreAfterHistory) {
                            item(key = "restore_latest_history") {
                                Box(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    FilledTonalButton(onClick = viewModel::restoreLatestHistory) {
                                        Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null)
                                        Text("  Back to latest messages")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Scroll to bottom FAB — lifted above the floating composer.
            AnimatedVisibility(
                visible = showScrollToBottom,
                enter = if (reduceMotion) EnterTransition.None else scaleIn() + fadeIn(),
                exit = if (reduceMotion) ExitTransition.None else scaleOut() + fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = padding.calculateBottomPadding() + 16.dp),
            ) {
                FloatingActionButton(
                    onClick = {
                        coroutineScope.launch {
                            if (displayItems.isNotEmpty()) {
                                if (reduceMotion) {
                                    listState.scrollToItem(displayItems.size - 1 + historyHeaderCount)
                                } else {
                                    listState.animateScrollToItem(displayItems.size - 1 + historyHeaderCount)
                                }
                            }
                        }
                    },
                    modifier = Modifier.size(40.dp),
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ) {
                    Box(contentAlignment = Alignment.TopEnd) {
                        Icon(
                            imageVector = Icons.Filled.KeyboardArrowDown,
                            contentDescription = if (displayUiState.unreadCount > 0) {
                                "Scroll to ${displayUiState.unreadCount} new messages"
                            } else "Scroll to bottom",
                            modifier = Modifier.size(18.dp),
                        )
                        if (displayUiState.unreadCount > 0) {
                            Badge { Text(displayUiState.unreadCount.coerceAtMost(99).toString()) }
                        }
                    }
                }
            }

            // Session-setting result: provider, model and reasoning only bind on
            // the next process start, so the outcome is stated rather than implied.
            displayUiState.settingsNotice?.let { notice ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(start = 16.dp, end = 16.dp, bottom = padding.calculateBottomPadding() + 16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearSettingsNotice() }) {
                            Text("OK")
                        }
                    },
                ) {
                    Text(notice)
                }
            }

            // Positive confirmations (template saved, transcript shared) share
            // the error snackbar's placement so feedback always appears in one
            // predictable spot.
            displayUiState.notice?.let { notice ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(start = 16.dp, end = 16.dp, bottom = padding.calculateBottomPadding() + 16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearNotice() }) { Text("OK") }
                    },
                ) {
                    Text(notice)
                }
            }

            // Error snackbar
            displayUiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(start = 16.dp, end = 16.dp, bottom = padding.calculateBottomPadding() + 16.dp),
                    action = {
                        TextButton(onClick = { viewModel.dismissError() }) {
                            Text("Dismiss")
                        }
                    },
                ) {
                    Text(error)
                }
            }
        }
    }

    // Full patch for the tapped turn diff.
    uiState.openTurnDiff?.let { detail ->
        ModalBottomSheet(
            onDismissRequest = { viewModel.dismissTurnDiff() },
            containerColor = PlumSurfaceStrong,
        ) {
            TurnDiffDetailView(detail)
        }
    }

    if (showToolLog) {
        ToolLogSheet(
            tools = displayUiState.activeTools.values.sortedByDescending { it.timestamp },
            onDismiss = { showToolLog = false },
        )
    }

    if (showSessionSettings) {
        displaySession?.let { session ->
            SessionSettingsSheet(
                session = session,
                mode = uiState.sessionMode,
                availableModels = uiState.availableModels,
                isApplying = uiState.isApplyingSettings,
                allowedDirectories = uiState.allowedDirectories,
                directoriesLoading = uiState.directoriesLoading,
                onProviderChange = viewModel::switchProvider,
                onModelChange = viewModel::setModel,
                onReasoningChange = viewModel::setReasoning,
                onModeChange = viewModel::setMode,
                onAddAllowedDirectory = viewModel::addAllowedDirectory,
                onRemoveAllowedDirectory = viewModel::removeAllowedDirectory,
                designStyles = uiState.designStyles,
                writingStyles = uiState.writingStyles,
                onStyleChange = viewModel::setStyleSkill,
                meshPeers = uiState.meshPeers,
                onSaveTemplate = { name ->
                    showSessionSettings = false
                    viewModel.saveAsTemplate(name)
                },
                onShareTranscript = { viewModel.shareTranscript() },
                isSharing = uiState.isExportingTranscript,
                onDismiss = { showSessionSettings = false },
            )
        }
    }

    selectedAttachment?.let { attachment ->
        AttachmentActionsSheet(
            attachment = attachment,
            busy = attachmentActionBusy,
            onDismiss = { if (!attachmentActionBusy) selectedAttachment = null },
            onOpen = { performAttachmentAction(AttachmentAction.OPEN) },
            onSave = { performAttachmentAction(AttachmentAction.SAVE) },
            onShare = { performAttachmentAction(AttachmentAction.SHARE) },
        )
    }

    if (displayUiState.isSearchOpen) {
        ChatSearchSheet(
            query = displayUiState.searchQuery,
            results = displayUiState.searchResults,
            isSearching = displayUiState.isSearching,
            error = displayUiState.searchError,
            onQueryChange = viewModel::onSearchQueryChange,
            onResultClick = viewModel::jumpToMessage,
            onDismiss = { viewModel.setSearchOpen(false) },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatSearchSheet(
    query: String,
    results: List<MessageSearchResult>,
    isSearching: Boolean,
    error: String?,
    onQueryChange: (String) -> Unit,
    onResultClick: (MessageSearchResult) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(.82f)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Search this chat", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                trailingIcon = if (query.isNotEmpty()) {
                    {
                        IconButton(onClick = { onQueryChange("") }) {
                            Icon(Icons.Outlined.Close, contentDescription = "Clear search")
                        }
                    }
                } else null,
                placeholder = { Text("Search messages") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
            when {
                isSearching -> LinearProgressIndicator(Modifier.fillMaxWidth())
                error != null -> Text(error, color = MaterialTheme.colorScheme.error)
                query.length >= 2 && results.isEmpty() -> Text(
                    "No matching messages",
                    color = PlumMuted,
                    modifier = Modifier.padding(vertical = 20.dp),
                )
            }
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(bottom = 28.dp),
            ) {
                items(results, key = { it.id }) { result ->
                    Surface(
                        onClick = { onResultClick(result) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surfaceContainer,
                    ) {
                        Column(
                            Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = result.role.replaceFirstChar { it.uppercase() },
                                style = MaterialTheme.typography.labelMedium,
                                color = PlumAccent,
                            )
                            Text(
                                text = searchSnippet(result.content, query),
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── Top Bar ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatTopBar(
    session: Session?,
    uiState: ChatUiState,
    onNavigateBack: () -> Unit,
    onEditTitle: () -> Unit,
    onTitleSaved: (String) -> Unit,
    onNavigateToFiles: () -> Unit,
    onNavigateToGit: () -> Unit,
    onNavigateToCheckpoints: () -> Unit,
    onToggleUsage: () -> Unit,
    onOpenToolLog: () -> Unit,
    onOpenSessionSettings: () -> Unit,
    onNavigateToNotes: () -> Unit,
    onNavigateToMemory: () -> Unit,
    onNavigateToDevTools: () -> Unit,
    onSearch: () -> Unit,
    isEditingTitle: Boolean,
    onSwitchChat: (String) -> Unit = {},
    onNewChat: () -> Unit = {},
    onDeleteChat: (String) -> Unit = {},
) {
    var editTitleText by remember(session?.name) { mutableStateOf(session?.name ?: "") }
    val focusRequester = remember { FocusRequester() }
    var showMenu by remember { mutableStateOf(false) }
    var showChatMenu by remember { mutableStateOf(false) }
    val largeText = LocalDensity.current.fontScale >= 1.5f

    LaunchedEffect(isEditingTitle) {
        if (isEditingTitle) {
            focusRequester.requestFocus()
        }
    }

    // The scrim has to stay opaque for the *whole* bar, including the tab row
    // at its bottom edge: fading out earlier let the scrolling transcript show
    // through the tabs, which read as double-exposed text.
    val palette = LocalPlumPalette.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    0f to palette.background,
                    .88f to palette.background,
                    1f to Color.Transparent,
                ),
            )
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onNavigateBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = PlumText)
            }
            Box(Modifier.weight(1f)) {
            if (isEditingTitle) {
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
                        onDone = { onTitleSaved(editTitleText) }
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        unfocusedBorderColor = PlumBorder,
                    ),
                )
            } else {
                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.clickableNoRipple(onEditTitle),
                ) {
                    Row(
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = session?.name ?: "Loading…",
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
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        val statusColor = when {
                            !uiState.isConnected -> Color(0xFFFF575F)
                            uiState.isWorking -> ClaudeWebUITheme.extendedColors.warning
                            else -> PlumGreen
                        }
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(statusColor)
                        )
                        Text(
                            text = when {
                                !uiState.isConnected -> "Disconnected"
                                uiState.isWorking -> "Working…"
                                else -> session?.status?.name?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "Ready"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumMuted,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
            }

            IconButton(onClick = onSearch) {
                Icon(Icons.Outlined.Search, contentDescription = "Search this chat", tint = PlumText)
            }

            // ── Chat-thread switcher ─────────────────────────────────────────
            Box {
                val activeChat = uiState.chats.firstOrNull { it.id == uiState.activeChatId }
                    ?: uiState.chats.firstOrNull()
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier
                        .glassSurface(RoundedCornerShape(14.dp))
                        .clickable(enabled = !uiState.isSwitchingChat) { showChatMenu = true }
                        .padding(horizontal = 9.dp, vertical = 5.dp),
                ) {
                    Icon(
                        Icons.Outlined.Forum,
                        contentDescription = "Switch chat",
                        tint = if (uiState.isSwitchingChat) PlumMuted else PlumAccent,
                        modifier = Modifier.size(13.dp),
                    )
                    if (!largeText) {
                        Text(
                            text = activeChat?.title ?: "Chat 1",
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
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
                DropdownMenu(
                    expanded = showChatMenu,
                    onDismissRequest = { showChatMenu = false },
                ) {
                    uiState.chats.forEach { chat ->
                        DropdownMenuItem(
                            text = {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(
                                        Icons.Outlined.Check,
                                        contentDescription = null,
                                        modifier = Modifier
                                            .size(15.dp)
                                            .alpha(if (chat.id == uiState.activeChatId) 1f else 0f),
                                    )
                                    Text(chat.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            },
                            trailingIcon = if (uiState.chats.size > 1 && chat.id != "main") {
                                {
                                    IconButton(
                                        onClick = {
                                            showChatMenu = false
                                            onDeleteChat(chat.id)
                                        },
                                        modifier = Modifier.size(26.dp),
                                    ) {
                                        Icon(
                                            Icons.Outlined.Delete,
                                            contentDescription = "Delete chat",
                                            modifier = Modifier.size(15.dp),
                                        )
                                    }
                                }
                            } else null,
                            onClick = {
                                showChatMenu = false
                                onSwitchChat(chat.id)
                            },
                        )
                    }
                    HorizontalDivider()
                    DropdownMenuItem(
                        text = { Text("New chat") },
                        leadingIcon = {
                            Icon(
                                Icons.Outlined.AddComment,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                        },
                        onClick = {
                            showChatMenu = false
                            onNewChat()
                        },
                    )
                }
            }

            // Tapping the provider badge opens session settings, the fastest
            // path to switching provider, model and reasoning effort.
            if (!largeText) {
                session?.cliProvider?.let { ProviderBadge(it, onClick = onOpenSessionSettings) }
            }
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Filled.MoreVert, "More options", tint = PlumText)
                }
                // Only destinations that exist nowhere else — Files/Git/Checks/
                // Stats live in the tab bar, session settings behind the
                // provider badge.
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("Session settings") },
                        leadingIcon = { Icon(Icons.Outlined.Tune, contentDescription = null) },
                        onClick = { showMenu = false; onOpenSessionSettings() },
                    )
                    DropdownMenuItem(
                        text = { Text("Notes") },
                        leadingIcon = { Icon(Icons.Outlined.StickyNote2, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToNotes() },
                    )
                    DropdownMenuItem(
                        text = { Text("Memory") },
                        leadingIcon = { Icon(Icons.Outlined.Psychology, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToMemory() },
                    )
                    DropdownMenuItem(
                        text = { Text("Dev tools") },
                        leadingIcon = { Icon(Icons.Outlined.Dns, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToDevTools() },
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .glassSurface(RoundedCornerShape(18.dp))
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ChatTab("Chat", Icons.Outlined.ChatBubbleOutline, true, Modifier.weight(1f), {})
            ChatTab("Files", Icons.Outlined.FolderOpen, false, Modifier.weight(1f), onNavigateToFiles)
            ChatTab("Git", Icons.Outlined.MergeType, false, Modifier.weight(1f), onNavigateToGit)
            ChatTab("Checks", Icons.Outlined.Security, false, Modifier.weight(1f), onNavigateToCheckpoints)
            // Model, account limits and context/token/cost all live behind
            // this toggle — the header stays as small as possible.
            ChatTab("Stats", Icons.Outlined.BarChart, uiState.showUsageBanner, Modifier.weight(1f), onToggleUsage)
            // Mirrors the WebUI's Tool Log dock: every tool call of this session
            // in one place, instead of only inline in the transcript.
            ChatTab(
                "Tools",
                Icons.Outlined.Terminal,
                uiState.activeTools.isNotEmpty(),
                Modifier.weight(1f),
                onOpenToolLog,
            )
        }
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
    val largeText = LocalDensity.current.fontScale >= 1.5f
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
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

@Composable
private fun ProviderBadge(provider: CLIProvider, onClick: () -> Unit) {
    val label = providerLabel(provider)
    val color = providerColor(provider)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.15f))
            .border(1.dp, color, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Account Limit Stats ───────────────────────────────────────────────────────

@Composable
private fun LimitWindowStat(
    label: String,
    window: UsageLimitWindow,
    modifier: Modifier = Modifier,
) {
    val utilization = window.utilization.coerceIn(0, 100)
    val color = when {
        utilization >= 85 -> PlumRed
        utilization >= 60 -> PlumAmber
        else -> PlumGreen
    }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "$label  $utilization%",
                color = color,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
            formatLimitReset(window.resetsAt)?.let {
                Text(text = it, color = PlumMuted, fontSize = 10.sp)
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(3.dp)
                .clip(RoundedCornerShape(1.5.dp))
                .background(PlumTrackFill),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(utilization / 100f)
                    .background(color),
            )
        }
    }
}

private fun formatLimitReset(resetsAt: String?): String? = runCatching {
    val instant = java.time.Instant.parse(resetsAt ?: return null)
    val minutes = java.time.Duration.between(java.time.Instant.now(), instant).toMinutes()
    when {
        minutes <= 0 -> null
        minutes < 60 -> "resets ${minutes}m"
        minutes < 48 * 60 -> "resets ${minutes / 60}h"
        else -> "resets ${minutes / (24 * 60)}d"
    }
}.getOrNull()

// ── Usage Banner ──────────────────────────────────────────────────────────────

@Composable
private fun UsageBanner(usage: UsageData?, session: Session?, limits: UsageLimitData?) {
    val df = remember { DecimalFormat("#,##0") }
    val costDf = remember { DecimalFormat("$0.0000") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .glassSurface(RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Model + account limits — moved out of the header so the chat keeps
        // its vertical space; the header only carries title and tabs now.
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "✦  ${session?.let { sessionModel(it) } ?: "model"}",
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(0.9f),
            )
            val windows = buildList {
                limits?.fiveHour?.let { add("5h" to it) }
                limits?.sevenDay?.let { add("Week" to it) }
            }
            if (windows.isEmpty()) {
                Text(text = "Limits  —", color = PlumMuted, fontSize = 11.sp)
            } else {
                windows.forEach { (label, window) ->
                    LimitWindowStat(label = label, window = window, modifier = Modifier.weight(1f))
                }
            }
        }

        if (usage != null) {
            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                thickness = 0.5.dp,
            )

            // Context window progress
            if (usage.contextWindow > 0) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Context",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "${usage.contextUsedPercent.toInt()}% used",
                        style = MaterialTheme.typography.labelSmall,
                        color = when {
                            usage.contextUsedPercent >= 90 -> MaterialTheme.colorScheme.error
                            usage.contextUsedPercent >= 70 -> ClaudeWebUITheme.extendedColors.warning
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                LinearProgressIndicator(
                    progress = { (usage.contextUsedPercent / 100.0).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = when {
                        usage.contextUsedPercent >= 90 -> MaterialTheme.colorScheme.error
                        usage.contextUsedPercent >= 70 -> ClaudeWebUITheme.extendedColors.warning
                        else -> MaterialTheme.colorScheme.primary
                    },
                )
            }

            // Token row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                UsageStat(label = "In", value = df.format(usage.inputTokens) + " tk")
                UsageStat(label = "Out", value = df.format(usage.outputTokens) + " tk")
                if (usage.cacheReadTokens > 0) {
                    UsageStat(label = "Cache", value = df.format(usage.cacheReadTokens) + " tk")
                }
                Spacer(modifier = Modifier.weight(1f))
                UsageStat(label = "Cost", value = costDf.format(usage.totalCostUsd))
            }
        }
    }
}

@Composable
private fun UsageStat(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Streaming Bubble ──────────────────────────────────────────────────────────

@Composable
private fun StreamingBubble(
    text: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 48.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Avatar
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.size(28.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(text = "✦", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
            }
        }

        Box(
            modifier = Modifier
                .weight(1f)
                .glassSurface(
                    RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 16.dp),
                ),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (text.isNotEmpty()) {
                    MarkdownContent(
                        text = text,
                        modifier = Modifier.weight(1f, fill = false),
                        isStreaming = true,
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
                StreamingCursorInline()
            }
        }
    }
}

@Composable
private fun StreamingCursorInline() {
    val infiniteTransition = rememberInfiniteTransition(label = "cursor")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )
    Box(
        modifier = Modifier
            .size(width = 2.dp, height = 16.dp)
            .background(
                color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                shape = RoundedCornerShape(1.dp),
            )
    )
}

// ── Empty State ───────────────────────────────────────────────────────────────

@Composable
private fun EmptyChat(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "✦",
                fontSize = 40.sp,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f),
            )
            Text(
                text = "Start a conversation",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "Type a message below",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

@Composable
private fun ChatUnavailableState(
    title: String,
    detail: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null, tint = PlumMuted, modifier = Modifier.size(38.dp))
            Text(title, color = PlumText, style = MaterialTheme.typography.titleMedium)
            Text(
                detail,
                color = PlumMuted,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Text("  Retry")
            }
        }
    }
}

private enum class AttachmentAction { OPEN, SAVE, SHARE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AttachmentActionsSheet(
    attachment: HistoryAttachmentItem,
    busy: Boolean,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onSave: () -> Unit,
    onShare: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                attachment.filename,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            if (busy) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    Text("Downloading securely…")
                }
            } else {
                AttachmentActionRow(Icons.Outlined.OpenInNew, "Open", onOpen)
                AttachmentActionRow(Icons.Outlined.Download, "Save to device", onSave)
                AttachmentActionRow(Icons.Outlined.Share, "Share", onShare)
            }
        }
    }
}

@Composable
private fun AttachmentActionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null)
        Text(label, modifier = Modifier.weight(1f))
        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = PlumMuted)
    }
}

// ── Display Item Model ────────────────────────────────────────────────────────

private sealed class DisplayItem {
    abstract val key: String

    data class MessageItem(val message: Message) : DisplayItem() {
        override val key = "msg_${message.id}"
    }
    data class StreamingItem(val text: String) : DisplayItem() {
        override val key = "streaming"
    }
    data class ToolItem(val tool: ToolExecution) : DisplayItem() {
        override val key = "tool_${tool.toolId}"
    }
    data class OutboxItem(val item: OutboxEntity) : DisplayItem() {
        override val key = "outbox_${item.clientMessageId}"
    }
    data object UnreadDivider : DisplayItem() {
        override val key = "unread_divider"
    }
}

private fun previewSession() = Session(
    id = "preview",
    userId = "preview",
    name = "Frontend Refactor",
    workingDirectory = "/workspace/plum-code-webui",
    status = SessionStatus.RUNNING,
    cliProvider = CLIProvider.CODEX,
    createdAt = "2026-08-01T13:33:00Z",
    updatedAt = "2026-08-01T13:36:00Z",
)

private fun previewChatState() = ChatUiState(
    isConnected = true,
    usageData = UsageData(
        sessionId = "preview",
        inputTokens = 154_200,
        outputTokens = 29_800,
        totalTokens = 184_000,
        contextWindow = 296_000,
        contextUsedPercent = 62.0,
        totalCostUsd = 2.84,
        model = "gpt-5.5",
    ),
)

private fun previewDisplayItems(): List<DisplayItem> = listOf(
    DisplayItem.MessageItem(
        Message(
            id = "preview-plan",
            sessionId = "preview",
            role = MessageRole.ASSISTANT,
            content = "Here's my plan to simplify the provider selector while maintaining flexibility:\n\n• Create a unified provider config\n• Replace scattered usage with ProviderRegistry\n• Update settings UI to render from registry\n• Migrate existing references and clean up",
            createdAt = "2026-08-01T13:33:00Z",
        )
    ),
    DisplayItem.MessageItem(
        Message(
            id = "preview-user",
            sessionId = "preview",
            role = MessageRole.USER,
            content = "Great! Please simplify the provider selector in Settings and use a compact chip style instead of full rows.",
            createdAt = "2026-08-01T13:35:00Z",
        )
    ),
    DisplayItem.ToolItem(
        ToolExecution(
            toolId = "preview-read",
            toolName = "read_file",
            status = ToolStatus.COMPLETED,
            result = "Read src/ui/settings/ProviderSection.kt",
            timestamp = 1L,
            completedAt = 2L,
        )
    ),
    DisplayItem.ToolItem(
        ToolExecution(
            toolId = "preview-edit",
            toolName = "edit_file",
            status = ToolStatus.STARTED,
            result = "Editing src/ui/settings/ProviderSection.kt",
            timestamp = 3L,
        )
    ),
    DisplayItem.MessageItem(
        Message(
            id = "preview-result",
            sessionId = "preview",
            role = MessageRole.ASSISTANT,
            content = "Provider selector is now simplified to compact chips. Two files updated and tests are ready to run.",
            createdAt = "2026-08-01T13:36:00Z",
        )
    ),
)

private fun buildDisplayItems(
    messages: List<Message>,
    outbox: List<OutboxEntity>,
    uiState: ChatUiState,
): List<DisplayItem> {
    val items = mutableListOf<DisplayItem>()
    val dividerIndex = unreadDividerIndex(messages, uiState.lastReadMessageId, uiState.unreadCount)
    messages.forEachIndexed { index, msg ->
        if (index == dividerIndex) items.add(DisplayItem.UnreadDivider)
        items.add(DisplayItem.MessageItem(msg))
    }

    val persistedClientIds = messages.mapNotNullTo(hashSetOf()) { it.clientMessageId }
    outbox.asSequence()
        .filterNot { it.clientMessageId in persistedClientIds }
        .forEach { items.add(DisplayItem.OutboxItem(it)) }

    // Active tools inline
    uiState.activeTools.values
        .sortedBy { it.timestamp }
        .forEach { tool ->
            items.add(DisplayItem.ToolItem(tool))
        }

    // The streaming row is appended by the caller so this stable part can be
    // remembered across streaming flushes.
    return items
}

internal fun unreadDividerIndex(
    messages: List<Message>,
    lastReadMessageId: String?,
    unreadCount: Int,
): Int? {
    if (unreadCount <= 0 || messages.isEmpty()) return null
    val markerIndex = lastReadMessageId?.let { id -> messages.indexOfFirst { it.id == id } } ?: -1
    val index = if (markerIndex >= 0) markerIndex + 1 else (messages.size - unreadCount).coerceAtLeast(0)
    return index.takeIf { it in messages.indices }
}

internal fun searchSnippet(content: String, query: String, radius: Int = 70): String {
    val normalized = content.replace(Regex("\\s+"), " ").trim()
    if (normalized.isEmpty()) return ""
    val match = normalized.indexOf(query.trim(), ignoreCase = true)
    if (match < 0) return normalized.take(radius * 2)
    val start = (match - radius).coerceAtLeast(0)
    val end = (match + query.length + radius).coerceAtMost(normalized.length)
    return buildString {
        if (start > 0) append("…")
        append(normalized.substring(start, end))
        if (end < normalized.length) append("…")
    }
}

// ── Group Info ────────────────────────────────────────────────────────────────

private fun computeGroupInfo(items: List<DisplayItem>, index: Int): MessageGroupInfo {
    val current = items[index] as? DisplayItem.MessageItem ?: return MessageGroupInfo()
    val prev = items.getOrNull(index - 1) as? DisplayItem.MessageItem
    val next = items.getOrNull(index + 1) as? DisplayItem.MessageItem

    return MessageGroupInfo(
        isFirst = prev == null || prev.message.role != current.message.role,
        isLast = next == null || next.message.role != current.message.role,
    )
}

// ── Clickable helper ──────────────────────────────────────────────────────────

@Composable
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier {
    val interactionSource = remember { MutableInteractionSource() }
    return this.clickable(
        interactionSource = interactionSource,
        indication = null,
        onClick = onClick,
    )
}

// ── Attachment URI reader ─────────────────────────────────────────────────────

internal fun inspectAttachmentUri(
    resolver: ContentResolver,
    uri: Uri,
): PendingFileAttachment? = runCatching {
    var filename: String? = null
    var byteSize: Long? = null
    // Read metadata before opening the stream. This avoids allocating a 50+ MB
    // array just to discover that the provider already reported it as too big.
    resolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null,
    )?.use { cursor ->
        if (cursor.moveToFirst()) {
            cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                .takeIf { it >= 0 && !cursor.isNull(it) }
                ?.let { filename = cursor.getString(it) }
            cursor.getColumnIndex(OpenableColumns.SIZE)
                .takeIf { it >= 0 && !cursor.isNull(it) }
                ?.let { byteSize = cursor.getLong(it).takeIf { size -> size >= 0 } }
        }
    }
    if (byteSize != null && byteSize!! > MAX_ATTACHMENT_BYTES) return null
    PendingFileAttachment(
        uri = uri.toString(),
        mimeType = resolver.getType(uri) ?: "application/octet-stream",
        filename = filename?.takeIf { it.isNotBlank() } ?: "attachment",
        sizeBytes = byteSize,
    )
}.getOrNull()

private fun cacheChatAttachment(context: Context, filename: String, bytes: ByteArray): File {
    val directory = File(context.cacheDir, "chat-attachments").apply { mkdirs() }
    val safeName = filename
        .substringAfterLast('/')
        .substringAfterLast('\\')
        .replace(Regex("[\\p{Cc}\\p{Cf}]"), "")
        .take(120)
        .ifBlank { "attachment" }
    return File(directory, "${System.currentTimeMillis()}-$safeName").apply {
        outputStream().use { it.write(bytes) }
    }
}

private fun chatAttachmentUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.provider", file)

private fun openChatAttachment(context: Context, file: File, mimeType: String) {
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(chatAttachmentUri(context, file), mimeType.ifBlank { "application/octet-stream" })
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Open attachment"))
}

private fun shareChatAttachment(context: Context, file: File, mimeType: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType.ifBlank { "application/octet-stream" }
        putExtra(Intent.EXTRA_STREAM, chatAttachmentUri(context, file))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Share attachment"))
}

/**
 * Every tool call of this session in one list — the Android counterpart of the
 * WebUI's Tool Log dock. Inline cards in the transcript answer "what is running
 * now"; this answers "what has this session actually done".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ToolLogSheet(
    tools: List<com.claudewebui.app.data.model.ToolExecution>,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "Tool log",
                color = PlumText,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
            )
            if (tools.isEmpty()) {
                Text("No tool calls yet", color = PlumMuted, fontSize = 13.sp)
            } else {
                LazyColumn(
                    Modifier.fillMaxWidth().heightIn(max = 480.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(tools, key = { it.toolId }) { tool ->
                        ToolExecutionCard(tool = tool)
                    }
                }
            }
        }
    }
}
