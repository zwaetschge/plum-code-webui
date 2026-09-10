package com.claudewebui.app.ui.screens.chat

import java.util.concurrent.atomic.AtomicLong
import android.content.Context
import com.claudewebui.app.core.diagnostics.Breadcrumbs

import com.claudewebui.app.data.repository.MessageHistoryPage
import com.claudewebui.app.data.repository.MessageRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Transcript paging: the initial page, older pages, the live tail and the
 * Room reveal window. Owned by [ChatViewModel] and scoped to its
 * `viewModelScope`.
 */
internal class ChatHistoryLoader(
    private val scope: CoroutineScope,
    private val sessionId: String,
    private val appContext: Context,
    private val state: MutableStateFlow<ChatUiState>,
    private val selectedChatId: MutableStateFlow<String?>,
    private val messageRepository: MessageRepository,
    /** Re-targets the composer draft when a page reveals the active chat. */
    private val onChatSelected: (String?) -> Unit,
) {
    private val replacementVersion = AtomicLong()

    fun beginReplacement(): Long = replacementVersion.incrementAndGet()
    fun isCurrentReplacement(version: Long): Boolean = version == replacementVersion.get()

    fun applyInitialHistoryPage(page: MessageHistoryPage) {
        onChatSelected(if (page.snapshot != null) page.chatId else state.value.activeChatId)
        selectedChatId.value = page.chatId
        state.update {
            it.copy(
                activeChatId = if (page.snapshot != null) page.chatId else it.activeChatId,
                hasMoreHistory = page.hasMoreBefore,
                hasMoreAfterHistory = page.hasMoreAfter,
                oldestMessageId = page.oldestId,
                newestMessageId = page.newestId,
                totalMessageCount = page.total,
                lastHistoryPageSize = 0,
                isLoadingOlderHistory = false,
            )
        }
    }

    /**
     * Refetch a chat over REST, replacing the cached window, and apply the
     * page on success. Defaults to the active chat.
     */
    suspend fun refresh(
        chatId: String? = state.value.activeChatId,
        resetReplayCursor: Boolean = false,
    ): Result<MessageHistoryPage> {
        val version = beginReplacement()
        return messageRepository.fetchMessages(
            sessionId,
            clearExisting = true,
            chatId = chatId,
            resetReplayCursor = resetReplayCursor,
            acceptResponse = { isCurrentReplacement(version) && state.value.activeChatId == chatId },
        ).onSuccess { page ->
            if (isCurrentReplacement(version) && state.value.activeChatId == chatId) {
                applyInitialHistoryPage(page)
            }
        }
    }

    /** Fire-and-forget [refresh]; failures are silent (a stale cache stays visible). */
    fun refreshInBackground(chatId: String? = state.value.activeChatId) {
        scope.launch { refresh(chatId) }
    }

    /** Pull-to-refresh / retry: reload the active chat with the loading flag. */
    fun reloadActiveChat() {
        val chatId = state.value.activeChatId
        scope.launch {
            if (state.value.activeChatId != chatId) return@launch
            state.update { it.copy(isLoadingHistory = true) }
            refresh(chatId).onFailure { error ->
                if (state.value.activeChatId == chatId) state.update { it.copy(error = error.userMessage(appContext)) }
            }
            if (state.value.activeChatId == chatId) state.update { it.copy(isLoadingHistory = false) }
        }
    }

    /** Load one older page; Room prepends it without clearing the recent page. */
    fun loadOlderHistory() {
        Breadcrumbs.add("chat.history", "load older")
        // Room Paging reveals cached rows; this loads the next server page.
        val current = state.value
        val version = replacementVersion.get()
        val before = current.oldestMessageId
        if (!current.hasMoreHistory || before == null || current.isLoadingOlderHistory) return

        state.update { it.copy(isLoadingOlderHistory = true) }
        scope.launch {
            messageRepository.fetchMessages(
                sessionId,
                before = before,
                chatId = current.activeChatId,
                acceptResponse = { isCurrentReplacement(version) && state.value.activeChatId == current.activeChatId },
            )
                .onSuccess { page ->
                    state.update {
                        if (!isCurrentReplacement(version) || it.activeChatId != current.activeChatId || it.oldestMessageId != before) return@update it
                        it.copy(
                            isLoadingOlderHistory = false,
                            hasMoreHistory = page.hasMore,
                            oldestMessageId = page.oldestId,
                            totalMessageCount = page.total,
                            historyPageVersion = it.historyPageVersion + 1,
                            lastHistoryPageSize = page.messages.size,
                        )
                    }
                }
                .onFailure { error ->
                    state.update {
                        if (!isCurrentReplacement(version) || it.activeChatId != current.activeChatId || it.oldestMessageId != before) it
                        else it.copy(isLoadingOlderHistory = false, error = error.userMessage(appContext))
                    }
                }
        }
    }

    /** Leave an around/search window and atomically restore the live tail. */
    fun restoreLatestHistory() {
        if (state.value.isLoadingHistory) return
        val version = beginReplacement()
        val chatId = state.value.activeChatId
        scope.launch {
            state.update { it.copy(isLoadingHistory = true) }
            messageRepository.fetchLatestMessages(sessionId, chatId) {
                isCurrentReplacement(version) && state.value.activeChatId == chatId
            }
                .onSuccess { page ->
                    if (!isCurrentReplacement(version) || state.value.activeChatId != chatId) return@onSuccess
                    applyInitialHistoryPage(page)
                    state.update {
                        it.copy(
                            isLoadingHistory = false,
                            jumpTargetMessageId = null,
                            jumpVersion = it.jumpVersion + 1,
                        )
                    }
                }
                .onFailure { error ->
                    if (isCurrentReplacement(version) && state.value.activeChatId == chatId) {
                        state.update { it.copy(isLoadingHistory = false, error = error.userMessage(appContext)) }
                    }
                }
        }
    }

}
