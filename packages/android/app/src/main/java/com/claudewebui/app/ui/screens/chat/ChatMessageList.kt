package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.claudewebui.app.core.network.toAppError
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.ui.components.chat.*
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.fadingEdges
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.theme.LocalReduceMotion
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/**
 * The slice of [ChatUiState] the transcript list reads. Structural equality
 * lets the list skip recomposition when only the composer, header or a sheet
 * changed.
 */
@Immutable
internal data class ChatTranscriptState(
    val isLoadingHistory: Boolean,
    val isLoadingOlderHistory: Boolean,
    val hasMoreHistory: Boolean,
    val hasMoreAfterHistory: Boolean,
    val historyPageVersion: Int,
    val restoreAnchorMessageId: String?,
    val restoreAnchorOffset: Int,
    val jumpTargetMessageId: String?,
    val jumpVersion: Int,
    val unreadCount: Int,
    val isConnected: Boolean,
    val error: String?,
    /**
     * Re-anchoring per 50ms flush re-measured the growing last item every
     * frame; a coarse length bucket keeps the end pinned a few times per reply.
     */
    val streamingAnchorBucket: Int,
) {
    companion object {
        fun from(state: ChatUiState) = ChatTranscriptState(
            isLoadingHistory = state.isLoadingHistory,
            isLoadingOlderHistory = state.isLoadingOlderHistory,
            hasMoreHistory = state.hasMoreHistory,
            hasMoreAfterHistory = state.hasMoreAfterHistory,
            historyPageVersion = state.historyPageVersion,
            restoreAnchorMessageId = state.restoreAnchorMessageId,
            restoreAnchorOffset = state.restoreAnchorOffset,
            jumpTargetMessageId = state.jumpTargetMessageId,
            jumpVersion = state.jumpVersion,
            unreadCount = state.unreadCount,
            isConnected = state.isConnected,
            error = state.error,
            streamingAnchorBucket = (state.streamingText?.length ?: -1) / 128,
        )
    }
}

/** Callbacks the transcript list needs; remembered once per ViewModel. */
@Stable
internal class ChatMessageListActions(
    val onRefresh: () -> Unit,
    val onRetryOffline: () -> Unit,
    val onLoadOlder: () -> Unit,
    val onRestoreLatest: () -> Unit,
    val onQuote: (String) -> Unit,
    val onWorkflow: (String) -> Unit,
    val onAttachmentClick: (HistoryAttachmentItem) -> Unit,
    val onRetryOutbox: (String) -> Unit,
    val onCancelDelivery: (String) -> Unit,
    val onDiscardOutbox: (String) -> Unit,
    val onResendOutboxHere: (String) -> Unit,
    val onViewportState: (atBottom: Boolean, anchorMessageId: String?, anchorOffset: Int) -> Unit,
)

/**
 * The transcript: pull-to-refresh, the LazyColumn with its stable keys
 * (`msg_`, `streaming`, `tool_`, `outbox_`, `unread_divider`), the history
 * loader / restore-latest rows, auto-scroll, read-position reporting and the
 * scroll-to-bottom FAB. [contentPadding] is the scaffold's bar insets: the
 * list scrolls behind the floating glass bars, so they become list padding.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatMessageList(
    displayItems: List<DisplayItem>,
    pagedMessages: LazyPagingItems<Message>?,
    transcript: ChatTranscriptState,
    isRefreshing: Boolean,
    isDesignPreview: Boolean,
    contentPadding: PaddingValues,
    actions: ChatMessageListActions,
    modifier: Modifier = Modifier,
) {
    val t = PlumTheme.tokens
    val context = LocalContext.current
    val pagingFailure = (pagedMessages?.loadState?.refresh as? LoadState.Error)?.error
    val boundaryFailure = (pagedMessages?.loadState?.append as? LoadState.Error)?.error
        ?: (pagedMessages?.loadState?.prepend as? LoadState.Error)?.error
        ?: pagingFailure
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val pullRefreshState = rememberPullToRefreshState()
    val reduceMotion = LocalReduceMotion.current
    var olderAnchorKey by remember { mutableStateOf<String?>(null) }
    var olderAnchorOffset by remember { mutableIntStateOf(0) }
    var initialHistoryPositioned by remember { mutableStateOf(false) }
    var handledJumpVersion by remember { mutableIntStateOf(0) }

    // Show FAB when scrolled up more than 2 items from bottom
    val showScrollToBottom by remember {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val total = listState.layoutInfo.totalItemsCount
            total > 0 && lastVisible < total - 2
        }
    }

    // maxSize can evict newer cached pages while reading far back. Reaching
    // the loaded slice's end must not mark the unseen live tail as read.
    val hasUnloadedNewer = pagedMessages != null && !pagedMessages.loadState.prepend.endOfPaginationReached
    val hasLiveTail = !transcript.hasMoreAfterHistory && !hasUnloadedNewer
    val showReturnToLatest = showScrollToBottom || !hasLiveTail

    val requestOlderHistory = {
        // Fires when the server has more, or when the local window is full —
        // Room may hold older rows the transcript has not revealed yet.
        if (
            transcript.hasMoreHistory &&
            (pagedMessages == null || pagedMessages.loadState.append.endOfPaginationReached) &&
            !transcript.isLoadingOlderHistory &&
            !isDesignPreview
        ) {
            listState.layoutInfo.visibleItemsInfo
                .firstOrNull { it.key != "history_loader" && it.key != "paging_error" }
                ?.let { visible ->
                    olderAnchorKey = visible.key.toString()
                    olderAnchorOffset = (-visible.offset).coerceAtLeast(0)
                }
            actions.onLoadOlder()
        }
    }

    val latestOlderRequest by rememberUpdatedState(requestOlderHistory)
    val pagingIndexById = pagedMessages?.itemSnapshotList?.items
        ?.mapIndexed { index, message -> message.id to index }?.toMap().orEmpty()

    // At the cached boundary, load the next server page; Room invalidates Paging.
    LaunchedEffect(
        listState, transcript.hasMoreHistory, transcript.isLoadingOlderHistory,
        pagedMessages?.loadState?.append,
    ) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .filter { initialHistoryPositioned && it <= 2 }
            .collect { latestOlderRequest() }
    }

    val historyHeaderCount = (if (
        transcript.hasMoreHistory || transcript.isLoadingOlderHistory
    ) 1 else 0) + (if (boundaryFailure != null) 1 else 0)

    // Explicitly restore the same visible message after Room prepends a page.
    // Stable LazyColumn keys already handle most cases; this also covers the
    // history-loader row disappearing on the final page.
    LaunchedEffect(transcript.historyPageVersion) {
        val anchor = olderAnchorKey ?: return@LaunchedEffect
        val messageIndex = displayItems.indexOfFirst { it.key == anchor }
        if (messageIndex >= 0) {
            listState.scrollToItem(messageIndex + historyHeaderCount, olderAnchorOffset)
        }
        olderAnchorKey = null
    }

    // Auto-scroll to bottom when new content arrives. Anchor the END of the
    // last item, not its top — long assistant replies are taller than the
    // viewport and would otherwise sit cut off behind the composer. The IME
    // height is a key so opening the keyboard re-anchors the conversation end.
    val displayItemCount = displayItems.size
    val imeBottom = WindowInsets.ime.getBottom(LocalDensity.current)
    LaunchedEffect(displayItemCount, transcript.streamingAnchorBucket, imeBottom) {
        if (!initialHistoryPositioned && displayItemCount > 0) {
            val anchor = transcript.restoreAnchorMessageId
            val anchorIndex = anchor?.let { id ->
                displayItems.indexOfFirst { it is DisplayItem.MessageItem && it.message.id == id }
            } ?: -1
            if (anchorIndex >= 0) {
                listState.scrollToItem(
                    anchorIndex + historyHeaderCount,
                    transcript.restoreAnchorOffset,
                )
            } else {
                listState.scrollToItem(
                    displayItemCount - 1 + historyHeaderCount,
                    scrollOffset = 1_000_000,
                )
            }
            initialHistoryPositioned = true
        } else if (!showScrollToBottom && hasLiveTail && displayItemCount > 0) {
            listState.scrollToItem(
                displayItemCount - 1 + historyHeaderCount,
                scrollOffset = 1_000_000,
            )
        }
    }

    // Room publishes asynchronously after the REST result. Retry the target when
    // the Paging snapshot arrives, then leave the user's scroll position alone.
    LaunchedEffect(
        transcript.jumpVersion, displayItems.size, displayItems.firstOrNull()?.key,
        pagedMessages?.loadState?.refresh,
    ) {
        if (transcript.jumpVersion == handledJumpVersion) return@LaunchedEffect
        if (transcript.isLoadingHistory || pagedMessages?.loadState?.refresh is LoadState.Loading) return@LaunchedEffect
        val messageId = transcript.jumpTargetMessageId
        if (messageId == null) {
            if (displayItems.isNotEmpty()) {
                listState.scrollToItem(displayItems.lastIndex + historyHeaderCount, 1_000_000)
                handledJumpVersion = transcript.jumpVersion
            }
            return@LaunchedEffect
        }
        val index = displayItems.indexOfFirst {
            it is DisplayItem.MessageItem && it.message.id == messageId
        }
        if (index >= 0) {
            listState.scrollToItem(index + historyHeaderCount)
            handledJumpVersion = transcript.jumpVersion
        }
    }

    // Keyed on the size, not the list: the streaming flush replaces the list
    // identity 20x/s and used to cancel/rebuild this snapshotFlow each time.
    val currentDisplayItems by rememberUpdatedState(displayItems)
    LaunchedEffect(listState, displayItems.size, historyHeaderCount, hasLiveTail) {
        snapshotFlow {
            val visible = listState.layoutInfo.visibleItemsInfo
                .firstOrNull { it.key != "history_loader" && it.key != "paging_error" }
            val item = visible?.let { info ->
                currentDisplayItems.getOrNull(info.index - historyHeaderCount)
            }
            Triple(!showScrollToBottom && hasLiveTail, (item as? DisplayItem.MessageItem)?.message?.id, (-(visible?.offset ?: 0)).coerceAtLeast(0))
        }
            .distinctUntilChanged()
            .collect { (atBottom, anchorId, offset) ->
                if (initialHistoryPositioned) actions.onViewportState(atBottom, anchorId, offset)
            }
    }

    Box(modifier = modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = actions.onRefresh,
            state = pullRefreshState,
            modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = pullRefreshState,
                    isRefreshing = isRefreshing,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = contentPadding.calculateTopPadding()),
                )
            },
        ) {
            if (displayItems.isEmpty() && (transcript.isLoadingHistory || pagedMessages?.loadState?.refresh is LoadState.Loading)) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (displayItems.isEmpty() && pagingFailure != null) {
                ChatUnavailableState(
                    title = stringResource(R.string.chat_load_failed),
                    detail = pagingFailure.toAppError().userMessage(context),
                    icon = Icons.Outlined.ErrorOutline,
                    onRetry = { pagedMessages?.retry() },
                    modifier = Modifier.fillMaxSize(),
                )
            } else if (displayItems.isEmpty() && !transcript.isConnected) {
                ChatUnavailableState(
                    title = stringResource(R.string.chat_offline),
                    detail = stringResource(R.string.chat_offline_detail),
                    icon = Icons.Outlined.CloudOff,
                    onRetry = actions.onRetryOffline,
                    modifier = Modifier.fillMaxSize(),
                )
            } else if (displayItems.isEmpty() && transcript.error != null) {
                ChatUnavailableState(
                    title = stringResource(R.string.chat_load_failed),
                    detail = transcript.error,
                    icon = Icons.Outlined.ErrorOutline,
                    onRetry = actions.onRefresh,
                    modifier = Modifier.fillMaxSize(),
                )
            } else if (displayItems.isEmpty()) {
                EmptyChat(onWorkflow = actions.onWorkflow, modifier = Modifier.fillMaxSize().padding(contentPadding))
            } else {
                LazyColumn(
                    state = listState,
                    // Bubbles dissolve into the header and the composer
                    // rather than disappearing at the scrim's edge.
                    modifier = Modifier
                        .fillMaxSize()
                        .fadingEdges(top = t.spacing.section, bottom = t.spacing.section),
                    contentPadding = PaddingValues(
                        top = contentPadding.calculateTopPadding() + t.spacing.sm,
                        bottom = contentPadding.calculateBottomPadding() + t.spacing.sm,
                    ),
                ) {
                    if (boundaryFailure != null) {
                        item(key = "paging_error") {
                            Column(Modifier.fillMaxWidth().padding(t.spacing.lg)) {
                                Text(boundaryFailure.toAppError().userMessage(context), color = MaterialTheme.colorScheme.error)
                                TextButton(onClick = { pagedMessages?.retry() }) {
                                    Text(stringResource(R.string.chat_retry))
                                }
                            }
                        }
                    }
                    if (transcript.hasMoreHistory || transcript.isLoadingOlderHistory) {
                        item(key = "history_loader") {
                            HistoryLoaderRow(
                                isLoading = transcript.isLoadingOlderHistory,
                                onLoadEarlier = requestOlderHistory,
                            )
                        }
                    }
                    itemsIndexed(
                        items = displayItems,
                        key = { _, item -> item.key },
                    ) { index, item ->
                        // Touch Paging to drive prefetch as older rows enter the viewport.
                        if (item is DisplayItem.MessageItem && pagedMessages != null) {
                            pagingIndexById[item.message.id]?.takeIf { it < pagedMessages.itemCount }?.let { pagedMessages[it] }
                        }
                        when (item) {
                            is DisplayItem.MessageItem -> if (
                                item.message.id.startsWith("compact-")
                            ) {
                                // Context-compaction markers are not chat
                                // turns; the server flags them by id prefix
                                // exactly as the WebUI reads them.
                                CompactBoundaryCard(
                                    content = item.message.content,
                                    modifier = Modifier.padding(horizontal = t.spacing.md, vertical = t.spacing.sm),
                                )
                            } else {
                                val groupInfo = computeGroupInfo(displayItems, index)
                                MessageBubble(
                                    message = item.message,
                                    groupInfo = groupInfo,
                                    modifier = Modifier
                                        .then(
                                            if (item.message.id == transcript.jumpTargetMessageId) {
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
                                    onQuote = actions.onQuote,
                                    onAttachmentClick = actions.onAttachmentClick,
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
                                        .padding(horizontal = t.spacing.lg, vertical = t.spacing.xs)
                                        .then(if (reduceMotion) Modifier else Modifier.animateItem()),
                                    initiallyExpanded = item.tool.status == ToolStatus.STARTED,
                                )
                            }
                            is DisplayItem.OutboxItem -> {
                                OutboxBubble(
                                    item = item.item,
                                    onRetry = { actions.onRetryOutbox(item.item.clientMessageId) },
                                    onCancel = { actions.onCancelDelivery(item.item.clientMessageId) },
                                    chatMissing = item.chatMissing,
                                    onDiscard = { actions.onDiscardOutbox(item.item.clientMessageId) },
                                    onResendHere = { actions.onResendOutboxHere(item.item.clientMessageId) },
                                )
                            }
                            DisplayItem.UnreadDivider -> UnreadDividerRow()
                        }
                    }
                    if (transcript.hasMoreAfterHistory) {
                        item(key = "restore_latest_history") {
                            Box(
                                Modifier.fillMaxWidth().padding(horizontal = t.spacing.lg, vertical = t.spacing.md),
                                contentAlignment = Alignment.Center,
                            ) {
                                FilledTonalButton(onClick = actions.onRestoreLatest) {
                                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null)
                                    Text(stringResource(R.string.chat_latest))
                                }
                            }
                        }
                    }
                }
            }
        }

        // Scroll to bottom FAB — lifted above the floating composer.
        AnimatedVisibility(
            visible = showReturnToLatest,
            enter = if (reduceMotion) EnterTransition.None else scaleIn() + fadeIn(),
            exit = if (reduceMotion) ExitTransition.None else scaleOut() + fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = t.spacing.lg, bottom = contentPadding.calculateBottomPadding() + t.spacing.lg),
        ) {
            FloatingActionButton(
                onClick = {
                    if (!hasLiveTail) {
                        actions.onRestoreLatest()
                    } else coroutineScope.launch {
                        if (displayItems.isNotEmpty()) {
                            if (reduceMotion) {
                                listState.scrollToItem(displayItems.size - 1 + historyHeaderCount)
                            } else {
                                listState.animateScrollToItem(displayItems.size - 1 + historyHeaderCount)
                            }
                        }
                    }
                },
                modifier = Modifier.size(t.sizing.touchTarget),
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ) {
                Box(contentAlignment = Alignment.TopEnd) {
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowDown,
                        contentDescription = if (transcript.unreadCount > 0) {
                            stringResource(R.string.chat_scroll_unread, transcript.unreadCount)
                        } else stringResource(R.string.chat_scroll_bottom),
                        modifier = Modifier.size(18.dp),
                    )
                    if (transcript.unreadCount > 0) {
                        Badge { Text(transcript.unreadCount.coerceAtMost(99).toString()) }
                    }
                }
            }
        }
    }
}

// ── Rows ──────────────────────────────────────────────────────────────────────

@Composable
private fun HistoryLoaderRow(isLoading: Boolean, onLoadEarlier: () -> Unit) {
    val t = PlumTheme.tokens
    Box(
        Modifier.fillMaxWidth().padding(vertical = t.spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        if (isLoading) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = t.spacing.xxs)
                Text(stringResource(R.string.chat_loading_earlier), color = PlumMuted, fontSize = 12.sp)
            }
        } else {
            TextButton(onClick = onLoadEarlier) {
                Icon(Icons.Outlined.History, contentDescription = null)
                Text(stringResource(R.string.chat_load_earlier))
            }
        }
    }
}

@Composable
private fun UnreadDividerRow() {
    val t = PlumTheme.tokens
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = t.spacing.lg, vertical = t.spacing.compact)
            .semantics {
                heading()
                liveRegion = LiveRegionMode.Polite
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(t.spacing.compact),
    ) {
        HorizontalDivider(Modifier.weight(1f), color = PlumAccent)
        Text(
            stringResource(R.string.chat_unread),
            color = PlumAccent,
            style = MaterialTheme.typography.labelMedium,
        )
        HorizontalDivider(Modifier.weight(1f), color = PlumAccent)
    }
}

// ── Streaming Bubble ──────────────────────────────────────────────────────────

@Composable
private fun StreamingBubble(
    text: String,
    modifier: Modifier = Modifier,
) {
    val t = PlumTheme.tokens
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = t.spacing.lg, end = 48.dp, top = t.spacing.sm, bottom = t.spacing.sm),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
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
                    RoundedCornerShape(topStart = t.spacing.xs, topEnd = t.spacing.lg, bottomEnd = t.spacing.lg, bottomStart = t.spacing.lg),
                ),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = t.spacing.cozy, vertical = t.spacing.md),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (text.isNotEmpty()) {
                    MarkdownContent(
                        text = text,
                        modifier = Modifier.weight(1f, fill = false),
                        isStreaming = true,
                    )
                    Spacer(modifier = Modifier.width(t.spacing.xs))
                }
                StreamingCursorInline()
            }
        }
    }
}

@Composable
private fun StreamingCursorInline() {
    val t = PlumTheme.tokens
    if (LocalReduceMotion.current) {
        Box(Modifier.size(width = 3.dp, height = 14.dp).background(MaterialTheme.colorScheme.primary))
        return
    }
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
            .size(width = t.spacing.xxs, height = t.spacing.lg)
            .background(
                color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                shape = RoundedCornerShape(1.dp),
            )
    )
}

// ── Empty / unavailable states ────────────────────────────────────────────────

@Composable
private fun EmptyChat(onWorkflow: (String) -> Unit, modifier: Modifier = Modifier) {
    val t = PlumTheme.tokens
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(t.spacing.md),
        ) {
            Text(
                text = "✦",
                fontSize = 40.sp,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f),
            )
            Text(
                text = stringResource(R.string.chat_start),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = stringResource(R.string.chat_type_message),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
            TaskWorkflowGrid(onSelect = onWorkflow, modifier = Modifier.fillMaxWidth())
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
    val t = PlumTheme.tokens
    Box(modifier, contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(t.spacing.compact),
        ) {
            Icon(icon, contentDescription = null, tint = PlumMuted, modifier = Modifier.size(38.dp))
            Text(title, color = PlumText, style = MaterialTheme.typography.titleMedium)
            Text(
                detail,
                color = PlumMuted,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onRetry, modifier = Modifier.heightIn(min = t.sizing.touchTarget)) {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Text(stringResource(R.string.chat_retry))
            }
        }
    }
}
