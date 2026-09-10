package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.R

import android.content.Context
import com.claudewebui.app.core.diagnostics.Breadcrumbs
import com.claudewebui.app.core.network.apiCall

import android.os.Build
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.MessageSearchResult
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * In-chat search, jump-to-message and the durable read position (unread
 * divider, restore anchor, cross-device cursor). Owned by [ChatViewModel]
 * and scoped to its `viewModelScope`.
 */
internal class ChatSearchController(
    private val scope: CoroutineScope,
    private val sessionId: String,
    private val appContext: Context,
    private val state: MutableStateFlow<ChatUiState>,
    private val api: ApiClient,
    private val messageRepository: MessageRepository,
    private val sessionRepository: SessionRepository,
    private val socketManager: SocketManager,
    private val messages: StateFlow<List<Message>>,
    private val history: ChatHistoryLoader,
    private val drafts: ChatDraftController,
    private val deviceId: () -> String,
) {
    private var searchJob: Job? = null
    private var readSaveJob: Job? = null
    private var viewportAtBottom = true

    // ── Search ──────────────────────────────────────────────────────────────

    fun setSearchOpen(open: Boolean) {
        state.update {
            it.copy(
                isSearchOpen = open,
                searchQuery = if (open) it.searchQuery else "",
                searchResults = if (open) it.searchResults else emptyList(),
                searchError = null,
                isSearching = if (open) it.isSearching else false,
            )
        }
        if (!open) searchJob?.cancel()
    }

    fun onSearchQueryChange(query: String) {
        state.update { it.copy(searchQuery = query, searchError = null) }
        searchJob?.cancel()
        if (query.trim().length < 2) {
            state.update { it.copy(searchResults = emptyList(), isSearching = false) }
            return
        }
        searchJob = scope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            state.update { it.copy(isSearching = true) }
            apiCall { api.searchSessionMessages(sessionId, query.trim()) }
                .onSuccess { response ->
                    state.update {
                        it.copy(
                            isSearching = false,
                            searchResults = response.data.orEmpty(),
                            searchError = response.error?.message,
                        )
                    }
                }
                .onFailure { error ->
                    state.update {
                        it.copy(isSearching = false, searchError = error.userMessage(appContext))
                    }
                }
        }
    }

    fun jumpToMessage(result: MessageSearchResult) {
        jumpToMessage(result.jump?.messageId ?: result.id, result.jump?.chatId)
    }

    fun jumpToMessage(messageId: String, chatId: String? = null) {
        Breadcrumbs.add("chat.history", "jump to message")
        var version = history.beginReplacement()
        val previousChatId = state.value.activeChatId
        scope.launch {
            state.update { it.copy(isLoadingHistory = true) }
            // Always re-activate an explicit target: another device may have
            // switched the session-wide active chat since our local snapshot.
            if (chatId != null) {
                val switched = sessionRepository.activateChat(sessionId, chatId)
                if (!history.isCurrentReplacement(version)) {
                    // The activation echo can arrive before its REST response.
                    // Continue this jump only when that expected thread won.
                    if (previousChatId == chatId || state.value.activeChatId != chatId) return@launch
                    version = history.beginReplacement()
                }
                if (switched.isFailure) {
                    state.update {
                        it.copy(
                            isLoadingHistory = false,
                            searchError = switched.exceptionOrNull()?.message ?: appContext.getString(R.string.chat_open_chat_failed),
                        )
                    }
                    return@launch
                }
                val list = switched.getOrThrow()
                drafts.selectChat(list.activeChatId)
                state.update { current ->
                    current.copy(chats = list.chats, activeChatId = list.activeChatId)
                }
            }
            val targetChatId = chatId ?: state.value.activeChatId
            messageRepository.fetchAroundMessage(sessionId, messageId, targetChatId) {
                history.isCurrentReplacement(version) && state.value.activeChatId == targetChatId
            }
                .onSuccess { page ->
                    if (!history.isCurrentReplacement(version) || state.value.activeChatId != targetChatId) return@onSuccess
                    history.applyInitialHistoryPage(page)
                    state.update {
                        it.copy(
                            isLoadingHistory = false,
                            isSearchOpen = false,
                            jumpTargetMessageId = messageId,
                            jumpVersion = it.jumpVersion + 1,
                        )
                    }
                }
                .onFailure { error ->
                    if (history.isCurrentReplacement(version) && state.value.activeChatId == targetChatId) {
                        state.update { it.copy(isLoadingHistory = false, searchError = error.userMessage(appContext)) }
                    }
                }
        }
    }

    // ── Read position ───────────────────────────────────────────────────────

    fun onViewportState(
        atBottom: Boolean,
        anchorMessageId: String?,
        anchorOffset: Int,
    ) {
        val chatId = state.value.activeChatId
        val atLiveTail = atBottom && !state.value.hasMoreAfterHistory
        viewportAtBottom = atLiveTail
        readSaveJob?.cancel()
        readSaveJob = scope.launch {
            delay(READ_POSITION_DEBOUNCE_MS)
            if (state.value.activeChatId != chatId) return@launch
            val current = messageRepository.cachedReadState(sessionId)
                ?: SessionReadStateEntity(sessionId)
            val newest = messageRepository.getCachedMessages(sessionId, chatId, limit = 1).firstOrNull()?.id
            val local = current.copy(
                scrollAnchorMessageId = anchorMessageId,
                scrollOffset = anchorOffset,
                lastReadMessageId = if (atLiveTail) newest ?: current.lastReadMessageId
                    else current.lastReadMessageId,
                unreadCount = if (atLiveTail) 0 else current.unreadCount,
            )
            messageRepository.saveReadState(local)
            if (atLiveTail && newest != null) {
                messageRepository.markRead(sessionId, chatId, newest)
            }
            socketManager.updatePresence(
                sessionId = sessionId,
                deviceId = deviceId(),
                label = Build.MODEL.takeIf { it.isNotBlank() },
                state = "active",
                lastReadMessageId = null,
            )
        }
    }

    /** A persisted message landed: read if the user is at the bottom, else unread. */
    suspend fun handleIncomingMessageReadState(message: Message) {
        val current = messageRepository.cachedReadState(sessionId)
            ?: SessionReadStateEntity(sessionId)
        if (viewportAtBottom) {
            messageRepository.markRead(sessionId, message.chatId, message.id)
                .onFailure {
                    messageRepository.saveReadState(
                        current.copy(lastReadMessageId = message.id, unreadCount = 0)
                    )
                }
        } else if (message.role == MessageRole.ASSISTANT) {
            messageRepository.saveReadState(current.copy(unreadCount = current.unreadCount + 1))
        }
    }

    /** Advance the durable cursor after the event/snapshot has been applied. */
    suspend fun commitAppliedSequence(sequence: Long?, snapshotRevision: Long? = null) {
        messageRepository.advanceAppliedSequence(sessionId, sequence, snapshotRevision)
    }
}

internal const val SEARCH_DEBOUNCE_MS = 250L
internal const val READ_POSITION_DEBOUNCE_MS = 400L

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
