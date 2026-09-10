package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.*
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.ui.components.chat.*
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import com.claudewebui.app.ui.components.chat.TurnDiffRow
import com.claudewebui.app.ui.components.chat.TurnDiffDetailView
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.isShortWindow
import androidx.compose.material3.ModalBottomSheet
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.theme.LocalPlumPalette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.filter
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import java.io.File

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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
    val t = PlumTheme.tokens
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
    BoxWithConstraints(modifier.fillMaxSize()) {
    val isWideLayout = maxWidth >= 840.dp
    var sidePanel by remember(sessionId) { mutableStateOf(ChatSidePanel.GIT) }
    var showSidePanel by remember(sessionId) { mutableStateOf(true) }
    var showSessionSettings by remember { mutableStateOf(false) }
    var showToolLog by remember { mutableStateOf(false) }
    var showChatDetails by remember(sessionId) { mutableStateOf(false) }
    var showAttention by remember(sessionId) { mutableStateOf(false) }
    var showOutbox by remember(sessionId) { mutableStateOf(false) }
    val pagedMessages = viewModel.pagedMessages.collectAsLazyPagingItems()
    val messages = pagedMessages.itemSnapshotList.items.asReversed()
    val outboxItems by viewModel.outbox.collectAsState()
    val session by viewModel.session.collectAsState()
    val isDesignPreview = BuildConfig.DEBUG && sessionId == "preview"
    val displaySession = session ?: if (isDesignPreview) previewSession() else null
    val displayUiState = if (isDesignPreview) previewChatState() else uiState

    val needsAttention = displayUiState.pendingPermission != null || displayUiState.pendingLegacyPermission != null || displayUiState.pendingQuestion != null
    LaunchedEffect(needsAttention) { if (!needsAttention) showAttention = false }

    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    var selectedAttachment by remember { mutableStateOf<HistoryAttachmentItem?>(null) }
    var attachmentActionBusy by remember { mutableStateOf(false) }
    var pendingSaveFile by remember { mutableStateOf<File?>(null) }

    // The export lands in state; only the screen has a Context to share it.
    LaunchedEffect(uiState.pendingShareTranscript) {
        val markdown = uiState.pendingShareTranscript ?: return@LaunchedEffect
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/markdown"
            putExtra(android.content.Intent.EXTRA_TITLE, session?.name ?: context.getString(R.string.chat_transcript))
            putExtra(android.content.Intent.EXTRA_TEXT, markdown)
        }
        context.startActivity(android.content.Intent.createChooser(intent, context.getString(R.string.chat_share_transcript)))
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
                    } ?: error(context.getString(R.string.chat_unwritable))
                }.onFailure { viewModel.reportError(it.message ?: context.getString(R.string.chat_save_failed)) }
            }
        }
    }

    val performAttachmentAction: (AttachmentAction) -> Unit = { action ->
        val attachment = selectedAttachment
        val mediaId = attachment?.mediaId
        if (attachment == null || mediaId == null) {
            selectedAttachment = null
            viewModel.reportError(context.getString(R.string.chat_attachment_legacy))
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
                            viewModel.reportError(failure.message ?: context.getString(R.string.chat_no_app))
                        }
                    }
                    .onFailure { failure ->
                        viewModel.reportError(failure.message ?: context.getString(R.string.chat_download_failed))
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

    val dictation = rememberVoiceDictation(viewModel::transcribeAndAppend)
    val pickAttachments = rememberAttachmentPicker(
        onPicked = viewModel::addAttachments,
        onFailure = viewModel::reportAttachmentFailure,
    )
    val composerActions = remember(viewModel, dictation, pickAttachments) {
        ChatComposerActions(
            onTextChange = viewModel::onInputChange,
            onSend = viewModel::sendMessage,
            onInterrupt = viewModel::interrupt,
            onRemoveAttachment = viewModel::removeAttachment,
            onActiveFollowupModeChange = viewModel::setActiveFollowupMode,
            onCancelDelivery = viewModel::cancelDelivery,
            onAttachFile = pickAttachments,
            onToggleRecording = dictation::toggle,
        )
    }
    val transcriptActions = remember(viewModel) {
        ChatMessageListActions(
            onRefresh = viewModel::loadHistory,
            onRetryOffline = viewModel::onResumed,
            onLoadOlder = viewModel::loadOlderHistory,
            onRestoreLatest = viewModel::restoreLatestHistory,
            onQuote = viewModel::quoteIntoDraft,
            onWorkflow = viewModel::sendMessage,
            onAttachmentClick = { selectedAttachment = it },
            onRetryOutbox = viewModel::retryOutbox,
            onCancelDelivery = viewModel::cancelDelivery,
            onDiscardOutbox = viewModel::discardOutbox,
            onResendOutboxHere = viewModel::resendOutboxInActiveChat,
            onViewportState = viewModel::onViewportState,
        )
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
            displayUiState.activeChatId,
            displayUiState.chats,
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

    Row(Modifier.fillMaxSize()) {
    Scaffold(
        modifier = Modifier.weight(1f).fillMaxHeight(),
        // Transparent over the app-wide PlumBackdrop — the bars and bubbles
        // are frosted glass, so the atmospheric glow must show through.
        containerColor = Color.Transparent,
        topBar = {
            // Landscape with the keyboard up leaves about 150dp of window:
            // the composer rode up over the title and the tab row and both
            // showed through its glass. Nothing in the header is needed
            // while typing, so it yields the space.
            val keyboardOwnsTheScreen = WindowInsets.isImeVisible && isShortWindow()
            if (!keyboardOwnsTheScreen) ChatTopBar(
                session = displaySession,
                header = ChatHeaderState.from(displayUiState, uiState.isEditingTitle),
                actions = remember(
                    viewModel, displaySession?.workingDirectory, isWideLayout, onNavigateBack,
                    onNavigateToFiles, onNavigateToGit, onNavigateToCheckpoints,
                    onNavigateToNotes, onNavigateToMemory, onNavigateToDevTools,
                ) {
                    ChatTopBarActions(
                onNavigateBack = onNavigateBack,
                onEditTitle = { viewModel.setEditingTitle(true) },
                onTitleSaved = { viewModel.updateTitle(it) },
                onNavigateToFiles = { onNavigateToFiles(displaySession?.workingDirectory ?: "") },
                onNavigateToGit = {
                    if (isWideLayout) { sidePanel = ChatSidePanel.GIT; showSidePanel = true }
                    else onNavigateToGit(displaySession?.workingDirectory ?: "")
                },
                onNavigateToCheckpoints = {
                    if (isWideLayout) { sidePanel = ChatSidePanel.CHECKPOINTS; showSidePanel = true }
                    else onNavigateToCheckpoints(sessionId)
                },
                onToggleUsage = { showChatDetails = true },
                onOpenToolLog = { showToolLog = true },
                onOpenSessionSettings = {
                    viewModel.loadAvailableModels()
                    showSessionSettings = true
                },
                onNavigateToNotes = {
                    if (isWideLayout) { sidePanel = ChatSidePanel.NOTES; showSidePanel = true }
                    else onNavigateToNotes(sessionId)
                },
                // Memory files hang off the working directory, not the session.
                onNavigateToMemory = {
                    onNavigateToMemory(displaySession?.workingDirectory ?: "")
                },
                onNavigateToDevTools = {
                    onNavigateToDevTools(displaySession?.workingDirectory ?: "")
                },
                onSwitchChat = viewModel::switchChat,
                onNewChat = viewModel::newChat,
                onDeleteChat = viewModel::deleteChat,
                onSearch = { viewModel.setSearchOpen(true) },
                    )
                },
            )
        },
        bottomBar = {
            ChatComposerBar(
                composer = ChatComposerState.from(uiState),
                activity = ChatActivityState.from(displayUiState),
                outboxPendingCount = outboxItems.count {
                    it.deliveryStatus != com.claudewebui.app.data.local.entity.OutboxStatus.ACCEPTED
                },
                isRecording = dictation.isRecording,
                actions = composerActions,
                onShowAttention = { showAttention = true },
                onShowDetails = { showChatDetails = true },
                onShowOutbox = { showOutbox = true },
            )
        },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        // The list fills the whole screen and scrolls BEHIND the floating
        // glass bars; the scaffold insets become list content padding so no
        // message ever rests hidden under a bar.
        Box(
            modifier = Modifier.fillMaxSize(),
        ) {
            key(sessionId, displayUiState.activeChatId) {
                ChatMessageList(
                    displayItems = displayItems,
                    pagedMessages = if (isDesignPreview) null else pagedMessages,
                    transcript = ChatTranscriptState.from(displayUiState),
                    isRefreshing = uiState.isLoadingHistory,
                    isDesignPreview = isDesignPreview,
                    contentPadding = padding,
                    actions = transcriptActions,
                )
            }

            // Session-setting result: provider, model and reasoning only bind on
            // the next process start, so the outcome is stated rather than implied.
            displayUiState.settingsNotice?.let { notice ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(start = t.spacing.lg, end = t.spacing.lg, bottom = padding.calculateBottomPadding() + t.spacing.lg),
                    action = {
                        TextButton(onClick = { viewModel.clearSettingsNotice() }) {
                            Text(stringResource(R.string.chat_ok))
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
                        .padding(start = t.spacing.lg, end = t.spacing.lg, bottom = padding.calculateBottomPadding() + t.spacing.lg),
                    action = {
                        TextButton(onClick = { viewModel.clearNotice() }) { Text(stringResource(R.string.chat_ok)) }
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
                        .padding(start = t.spacing.lg, end = t.spacing.lg, bottom = padding.calculateBottomPadding() + t.spacing.lg),
                    action = {
                        TextButton(onClick = { viewModel.dismissError() }) {
                            Text(stringResource(R.string.chat_dismiss))
                        }
                    },
                ) {
                    Text(error)
                }
            }
        }
    }

    if (isWideLayout && showSidePanel) {
        VerticalDivider(Modifier.fillMaxHeight())
        ChatSessionSidePanel(
            sessionId = sessionId,
            panel = sidePanel,
            onPanelChange = { sidePanel = it },
            onClose = { showSidePanel = false },
            storeOwner = sessionStoreOwner,
            modifier = Modifier.width(360.dp).fillMaxHeight(),
        )
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
            tools = displayUiState.toolHistory.values.sortedByDescending { it.timestamp },
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

    if (showAttention) {
        ModalBottomSheet(onDismissRequest = { showAttention = false }, containerColor = LocalPlumPalette.current.background) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.8f).verticalScroll(rememberScrollState()).padding(bottom = t.spacing.xl)) {
                // Interactive prompts must be visible while the app is open,
                // or the session stalls with no way to continue.
                displayUiState.pendingPermission?.let { request ->
                    PermissionRequestCard(
                        request = request,
                        onAction = { viewModel.respondToPermission(it) },
                        modifier = Modifier.padding(horizontal = t.spacing.md, vertical = t.spacing.inline),
                    )
                }
                displayUiState.pendingLegacyPermission?.let { request ->
                    LegacyPermissionCard(
                        request = request,
                        onApprove = { viewModel.respondToLegacyPermission(true) },
                        onDeny = { viewModel.respondToLegacyPermission(false) },
                        modifier = Modifier.padding(horizontal = t.spacing.md, vertical = t.spacing.inline),
                    )
                }
                displayUiState.pendingQuestion?.let { question ->
                    QuestionPromptCard(
                        request = question,
                        onRespond = { viewModel.respondToQuestion(it) },
                        onDismiss = { viewModel.dismissQuestion() },
                        modifier = Modifier.padding(horizontal = t.spacing.md, vertical = t.spacing.inline),
                    )
                }

            }
        }
    }
    if (showChatDetails) {
        ModalBottomSheet(onDismissRequest = { showChatDetails = false }, containerColor = LocalPlumPalette.current.background) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.7f).verticalScroll(rememberScrollState()).padding(t.spacing.lg)) {
                Text(stringResource(R.string.chat_session_details), style = MaterialTheme.typography.titleLarge)
                // Usage stats panel (Stats tab): model, account limits and
                // context/token/cost — shown even before the first turn so the
                // limits are always reachable.
                UsageBanner(
                    usage = displayUiState.usageData,
                    session = displaySession,
                    limits = displayUiState.providerLimits,
                )

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
                        onOpen = { showChatDetails = false; viewModel.openTurnDiff(it) },
                        modifier = Modifier.padding(horizontal = t.spacing.md, vertical = t.spacing.xs),
                    )
                }

                if (displayUiState.queuedCount > 0) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = t.spacing.section, vertical = t.spacing.xxs)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = stringResource(R.string.chat_queue_count, displayUiState.queuedCount),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        // CLI-style steering: abort the running turn so the
                        // queued follow-up runs immediately — the server drains
                        // the queue as soon as the interrupted turn ends.
                        TextButton(
                            onClick = { viewModel.interrupt() },
                            contentPadding = PaddingValues(horizontal = t.spacing.compact, vertical = 0.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.SkipNext,
                                contentDescription = null,
                                tint = PlumAmber,
                                modifier = Modifier.size(15.dp),
                            )
                            Text(
                                text = stringResource(R.string.chat_interrupt_run),
                                style = MaterialTheme.typography.labelSmall,
                                color = PlumAmber,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }

            }
        }
    }
    if (showOutbox) {
        ModalBottomSheet(onDismissRequest = { showOutbox = false }, containerColor = LocalPlumPalette.current.background) {
            LazyColumn(Modifier.fillMaxWidth().fillMaxHeight(0.75f), contentPadding = PaddingValues(bottom = t.spacing.xl)) {
                item { Text(stringResource(R.string.chat_outbox_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(t.spacing.lg)) }
                val pending = outboxItems.filter { it.deliveryStatus != com.claudewebui.app.data.local.entity.OutboxStatus.ACCEPTED }
                if (pending.isEmpty()) item { Text(stringResource(R.string.chat_outbox_empty), modifier = Modifier.padding(t.spacing.lg)) }
                items(pending, key = { it.clientMessageId }) { entry ->
                    Text(
                        stringResource(
                            R.string.chat_outbox_meta,
                            displayUiState.chats.find { it.id == entry.chatId }?.title
                                ?: entry.chatId ?: stringResource(R.string.chat_original),
                            java.text.DateFormat.getDateTimeInstance(
                                java.text.DateFormat.SHORT, java.text.DateFormat.SHORT,
                            ).format(java.util.Date(entry.createdAt)),
                        ),
                        modifier = Modifier.padding(horizontal = t.spacing.lg), color = PlumMuted,
                    )
                    OutboxBubble(
                        item = entry,
                        onRetry = { viewModel.retryOutbox(entry.clientMessageId) },
                        onCancel = { viewModel.cancelDelivery(entry.clientMessageId) },
                        onDiscard = { viewModel.discardOutbox(entry.clientMessageId) },
                        chatMissing = entry.chatId != null && displayUiState.chats.isNotEmpty() && displayUiState.chats.none { it.id == entry.chatId },
                        onResendHere = { viewModel.resendOutboxInActiveChat(entry.clientMessageId) },
                    )
                }
            }
        }
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
    val t = PlumTheme.tokens
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(start = t.spacing.section, end = t.spacing.section, bottom = t.spacing.xl),
            verticalArrangement = Arrangement.spacedBy(t.spacing.xs),
        ) {
            Text(
                attachment.filename,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(bottom = t.spacing.sm),
            )
            if (busy) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(t.spacing.md),
                ) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = t.spacing.xxs)
                    Text(stringResource(R.string.chat_download_secure))
                }
            } else {
                AttachmentActionRow(Icons.Outlined.OpenInNew, stringResource(R.string.chat_open), onOpen)
                AttachmentActionRow(Icons.Outlined.Download, stringResource(R.string.chat_save), onSave)
                AttachmentActionRow(Icons.Outlined.Share, stringResource(R.string.chat_share), onShare)
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
    val t = PlumTheme.tokens
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(t.radius.md))
            .clickable(onClick = onClick)
            .padding(horizontal = t.spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(t.spacing.md),
    ) {
        Icon(icon, contentDescription = null)
        Text(label, modifier = Modifier.weight(1f))
        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = PlumMuted)
    }
}

// ── Display Item Model ────────────────────────────────────────────────────────

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
    context.startActivity(Intent.createChooser(intent, context.getString(R.string.chat_open_attachment)))
}

private fun shareChatAttachment(context: Context, file: File, mimeType: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType.ifBlank { "application/octet-stream" }
        putExtra(Intent.EXTRA_STREAM, chatAttachmentUri(context, file))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, context.getString(R.string.chat_share_attachment)))
}
