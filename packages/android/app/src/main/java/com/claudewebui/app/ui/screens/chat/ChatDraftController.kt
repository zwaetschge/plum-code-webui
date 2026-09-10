package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.R
import android.content.Context
import com.claudewebui.app.core.diagnostics.Breadcrumbs
import com.claudewebui.app.core.network.apiCall

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.PendingFileAttachment
import com.claudewebui.app.data.repository.MessageRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Composer contents per chat thread: the typed draft (local + mirrored to the
 * server) and the files waiting to be sent. Owned by [ChatViewModel] and
 * scoped to its `viewModelScope`.
 */
internal class ChatDraftController(
    private val scope: CoroutineScope,
    private val sessionId: String,
    private val appContext: Context,
    private val state: MutableStateFlow<ChatUiState>,
    private val messageRepository: MessageRepository,
    private val api: ApiClient,
    private val isSessionReady: () -> Boolean,
) {
    private val draftBuffer = ChatDraftBuffer()
    private val draftSaveJobs = mutableMapOf<String?, Job>()
    private val draftLocks = mutableMapOf<String?, Mutex>()
    private val draftRemoteLocks = mutableMapOf<String?, Mutex>()
    private var draftChatId: String? = null
    private var draftChatInitialized = false
    private val draftAttachments = mutableMapOf<String?, List<PendingFileAttachment>>()

    /** Show the draft that belongs to [chatId]; parks the previous chat's attachments. */
    fun selectChat(chatId: String?) {
        if (draftChatInitialized && draftChatId == chatId) return
        if (draftChatInitialized) draftAttachments[draftChatId] = state.value.pendingAttachments
        draftChatInitialized = true
        draftChatId = chatId
        val cached = draftBuffer.get(chatId)
        state.update { it.copy(draftText = cached?.text.orEmpty(), pendingAttachments = draftAttachments[chatId].orEmpty()) }
        if (cached != null) { persistDraft(cached); return }
        scope.launch {
            val local = messageRepository.getDraft(sessionId, chatId)
            val restored = draftBuffer.restore(chatId, local.orEmpty(), cached) ?: return@launch
            if (draftChatId == chatId) state.update { it.copy(draftText = restored.text) }
            // Never replace local work, nor apply a late load to a different chat.
            if (local == null) {
                val remote = runCatching { api.getSessionDraft(sessionId, chatId).data?.content }.getOrNull()
                if (!remote.isNullOrBlank()) {
                    val adopted = draftBuffer.restore(chatId, remote, restored) ?: return@launch
                    if (draftChatId == chatId) state.update { it.copy(draftText = adopted.text) }
                    persistDraft(adopted)
                }
            }
        }
    }

    /**
     * Append a message as a Markdown quote to whatever is already typed — the
     * usual way to say "about this part" without retyping it.
     */
    fun quoteIntoDraft(content: String) {
        val quoted = content.trim().lines().joinToString("\n") { "> $it" }
        if (quoted.isBlank()) return
        val current = state.value.draftText
        onInputChange(if (current.isBlank()) "$quoted\n\n" else "${current.trimEnd()}\n\n$quoted\n\n")
    }

    fun onInputChange(text: String) {
        val snapshot = draftBuffer.edit(state.value.activeChatId, text)
        state.update { it.copy(draftText = text) }
        persistDraft(snapshot)
    }

    /** The draft a send is about to consume; captured before the outbox write. */
    fun snapshotForSend(chatId: String?): ChatDraftBuffer.Snapshot =
        draftBuffer.get(chatId) ?: draftBuffer.edit(chatId, state.value.draftText)

    /**
     * Clear the composer after the outbox row is durable, unless the user
     * typed on in the meantime. Returns null when the draft moved on.
     */
    fun clearAfterSend(sent: ChatDraftBuffer.Snapshot): ChatDraftBuffer.Snapshot? {
        val cleared = draftBuffer.clearIfUnchanged(sent) ?: return null
        draftAttachments[sent.chatId] = emptyList()
        persistDraft(cleared)
        return cleared
    }

    private fun persistDraft(snapshot: ChatDraftBuffer.Snapshot) {
        val chatId = snapshot.chatId
        val lock = draftLocks.getOrPut(chatId) { Mutex() }
        // Store locally immediately. Only network mirroring is debounced.
        scope.launch {
            withContext(NonCancellable) {
                lock.withLock {
                    if (draftBuffer.get(chatId) == snapshot && isSessionReady()) {
                        // Keep empty tombstones: an older remote draft must not resurrect.
                        messageRepository.saveDraft(sessionId, snapshot.text, chatId)
                    }
                }
            }
        }
        draftSaveJobs.remove(chatId)?.cancel()
        draftSaveJobs[chatId] = scope.launch {
            delay(500)
            // Cancel only the debounce, never an already issued write. Writes
            // to one chat complete in order without blocking local persistence.
            scope.launch {
                draftRemoteLocks.getOrPut(chatId) { Mutex() }.withLock {
                    if (draftBuffer.get(chatId) == snapshot && isSessionReady()) {
                        runCatching { api.putSessionDraft(sessionId, snapshot.text, chatId) }
                    }
                }
            }
        }
    }

    /** Send the recorded clip for transcription and append the text. */
    fun transcribeAndAppend(audio: ByteArray) {
        val targetChatId = state.value.activeChatId
        Breadcrumbs.add("chat.voice", "transcribe")
        scope.launch {
            state.update { it.copy(isTranscribing = true) }
            apiCall { api.transcribe(audio).data?.text }
                .onSuccess { text ->
                    if (text.isNullOrBlank()) {
                        state.update { it.copy(error = appContext.getString(R.string.chat_voice_empty)) }
                    } else {
                        val previous = draftBuffer.get(targetChatId)?.text.orEmpty()
                        val merged = if (previous.isBlank()) text else previous.trimEnd() + " " + text
                        val snapshot = draftBuffer.edit(targetChatId, merged)
                        persistDraft(snapshot)
                        state.update { current ->
                            if (current.activeChatId == targetChatId) current.copy(draftText = merged)
                            else current
                        }
                    }
                }
                .onFailure { error -> state.update { it.copy(error = error.userMessage(appContext)) } }
            state.update { it.copy(isTranscribing = false) }
        }
    }

    // ── Attachments ─────────────────────────────────────────────────────────

    fun addAttachments(attachments: List<PendingFileAttachment>) {
        if (attachments.isEmpty()) return
        state.update { current ->
            val availableSlots = (MAX_ATTACHMENT_COUNT - current.pendingAttachments.size).coerceAtLeast(0)
            val accepted = attachments.take(availableSlots)
            val combined = current.pendingAttachments + accepted
            val withinTotal = mutableListOf<PendingFileAttachment>()
            var total = 0L
            combined.forEach { item ->
                val size = item.sizeBytes ?: 0L
                if (total + size <= MAX_TOTAL_ATTACHMENT_BYTES) {
                    withinTotal += item
                    total += size
                }
            }
            current.copy(
                pendingAttachments = withinTotal,
                error = if (withinTotal.size < combined.size || accepted.size < attachments.size) {
                    appContext.getString(R.string.chat_attachment_limit, MAX_ATTACHMENT_COUNT, formatBytes(MAX_TOTAL_ATTACHMENT_BYTES))
                } else current.error,
            )
        }
    }

    fun removeAttachment(index: Int) {
        state.update { current ->
            if (index !in current.pendingAttachments.indices) return@update current
            current.copy(
                pendingAttachments = current.pendingAttachments
                    .toMutableList()
                    .apply { removeAt(index) },
            )
        }
    }

    fun reportAttachmentFailure(failed: Int, total: Int) {
        if (failed <= 0) return
        val message = when {
            total == 1 -> appContext.getString(R.string.chat_attach_failed)
            failed == total -> appContext.getString(R.string.chat_attach_many_failed, failed)
            else -> appContext.getString(R.string.chat_attach_partial_failed, failed, total)
        }
        state.update { it.copy(error = message) }
    }
}
