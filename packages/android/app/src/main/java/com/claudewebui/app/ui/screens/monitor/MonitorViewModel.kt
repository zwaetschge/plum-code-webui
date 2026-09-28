package com.claudewebui.app.ui.screens.monitor

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.PendingPermissionItem
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.QuestionRequestEvent
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import com.claudewebui.app.data.model.PendingFileAttachment
import com.claudewebui.app.data.model.PersistedOutboxAttachment
import com.claudewebui.app.data.repository.GatewayRepository
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.ui.screens.chat.MAX_ATTACHMENT_COUNT
import com.claudewebui.app.ui.screens.chat.MAX_TOTAL_ATTACHMENT_BYTES
import com.claudewebui.app.ui.screens.chat.OutboxUploader
import com.claudewebui.app.ui.screens.chat.formatBytes
import com.claudewebui.app.widget.WidgetRefreshWorker
import com.claudewebui.app.R
import com.claudewebui.app.data.model.SessionSendAck
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/** How many sessions the grid shows at once. */
const val MONITOR_SLOT_COUNT = 4

/** Tail of streamed text kept per tile; older text scrolls out of the frame anyway. */
private const val STREAM_TAIL_CHARS = 1_500

/** A hooks-based approval waiting on this session, reduced to what the tile needs. */
data class MonitorApproval(
    val requestId: String,
    val toolName: String,
    val description: String = "",
)

/**
 * A pre-hooks approval (`denials` payload). Answered over the socket, not REST,
 * and there is no request id — the tile just needs to offer the buttons.
 */
data class MonitorLegacyApproval(
    val toolNames: List<String>,
    val originalMessage: String,
)

/** Live state for one monitored session, built from socket events. */
data class MonitorTile(
    val sessionId: String,
    val session: Session? = null,
    /** Text of the reply currently streaming; cleared once the message lands. */
    val streamingText: String = "",
    /** Last completed assistant reply seen while this screen was alive. */
    val lastReply: String? = null,
    val isThinking: Boolean = false,
    /** What the agent is doing right now — tool or subagent — or null. */
    val currentTool: String? = null,
    val approval: MonitorApproval? = null,
    val legacyApproval: MonitorLegacyApproval? = null,
    val question: QuestionRequestEvent? = null,
    val error: String? = null,
    val isSending: Boolean = false,
    /** Set briefly after a send is acknowledged, to confirm without a toast. */
    val sentNotice: Boolean = false,
    /** Composer text; lives here so dictation can append to it. */
    val draft: String = "",
    val pendingAttachments: List<PendingFileAttachment> = emptyList(),
    val isPreparingAttachments: Boolean = false,
    val attachmentProgress: Float = 0f,
    val isTranscribing: Boolean = false,
) {
    /** Whether the agent is doing something a supervisor should wait for. */
    val isWorking: Boolean
        get() = isThinking || currentTool != null || streamingText.isNotEmpty() ||
            session?.busy == true

    val needsYou: Boolean
        get() = approval != null || legacyApproval != null || question != null

    /** The text the body shows: the live stream, else the latest reply. */
    val bodyText: String
        get() = streamingText.ifBlank { lastReply ?: session?.lastMessage.orEmpty() }
}

data class MonitorUiState(
    /** Session ids per slot; null is an empty slot. Always [MONITOR_SLOT_COUNT] long. */
    val slots: List<String?> = List(MONITOR_SLOT_COUNT) { null },
    val tiles: Map<String, MonitorTile> = emptyMap(),
    /** Every known session, for the picker. */
    val sessions: List<Session> = emptyList(),
    /** Slot the picker is choosing for, or null when closed. */
    val pickerSlot: Int? = null,
    val isConnected: Boolean = false,
) {
    val activeCount: Int
        get() = slots.filterNotNull().count { tiles[it]?.isWorking == true }

    val filledCount: Int
        get() = slots.count { it != null }
}

/**
 * Pick the sessions worth watching when the user has not chosen any.
 *
 * Whatever moved most recently, and busy ones first: the grid is for
 * supervising work in flight, not for browsing the archive.
 */
internal fun defaultMonitorSlots(sessions: List<Session>, count: Int = MONITOR_SLOT_COUNT): List<String?> {
    val ranked = sessions
        .sortedWith(
            compareByDescending<Session> { it.busy || it.status == SessionStatus.RUNNING }
                .thenByDescending { it.lastActivityAt ?: it.updatedAt }
        )
        .map { it.id }
        .take(count)
    return List(count) { ranked.getOrNull(it) }
}

/** Serialise slots for SharedPreferences; empty slots stay positional. */
internal fun encodeMonitorSlots(slots: List<String?>): String =
    slots.joinToString("|") { it.orEmpty() }

internal fun decodeMonitorSlots(raw: String?, count: Int = MONITOR_SLOT_COUNT): List<String?> {
    if (raw.isNullOrBlank()) return List(count) { null }
    val parts = raw.split("|").map { it.takeIf { part -> part.isNotBlank() } }
    return List(count) { parts.getOrNull(it) }
}

/**
 * Four sessions at once.
 *
 * The chat screen owns one live ViewModel per open session, and the dashboard
 * only knows the cached verdict. Neither can show what four agents are saying
 * right now. This listens to the shared socket flows for the chosen sessions
 * and keeps a short live tail per tile — enough to see progress, answer an
 * approval and send a follow-up without opening each chat in turn.
 */
class MonitorViewModel(
    private val sessionRepository: SessionRepository,
    private val gatewayRepository: GatewayRepository,
    private val messageRepository: MessageRepository,
    private val socketManager: SocketManager,
    private val api: ApiClient,
    private val appContext: Context,
) : ViewModel() {

    private val uploader = OutboxUploader(appContext, api, messageRepository)

    private val _uiState = MutableStateFlow(
        MonitorUiState(slots = MonitorSlotsStore.load(appContext))
    )
    val uiState: StateFlow<MonitorUiState> = _uiState.asStateFlow()

    /** True until the user has picked slots or a default set was applied. */
    private var slotsAreDefault = MonitorSlotsStore.loadRaw(appContext).isNullOrBlank()

    init {
        // Slots restored from preferences need their tiles built now; until
        // this ran only a fresh choice created them, so a relaunch with saved
        // slots showed four empty places under a header counting four.
        applySlots(_uiState.value.slots, chosenByUser = false)
        observeSessions()
        observeSocket()
        socketManager.connectionState
            .onEach { state ->
                val connected = state == ConnectionState.CONNECTED
                _uiState.update { it.copy(isConnected = connected) }
                if (connected) ensureSubscribed()
            }
            .launchIn(viewModelScope)
        gatewayRepository.pendingApprovals
            .onEach { approvals -> seedApprovals(approvals) }
            .launchIn(viewModelScope)
        refresh()
    }

    /** Pull the overview once — approvals pending before this screen opened. */
    fun refresh() {
        viewModelScope.launch { gatewayRepository.refresh() }
        ensureSubscribed()
    }

    // ── Slots ───────────────────────────────────────────────────────────────

    fun openPicker(slot: Int) = _uiState.update { it.copy(pickerSlot = slot) }

    fun closePicker() = _uiState.update { it.copy(pickerSlot = null) }

    fun assign(slot: Int, sessionId: String) {
        val current = _uiState.value.slots.toMutableList()
        // A session appears once: choosing it for a second slot moves it.
        val previousIndex = current.indexOf(sessionId)
        if (previousIndex >= 0 && previousIndex != slot) current[previousIndex] = null
        current[slot] = sessionId
        applySlots(current, chosenByUser = true)
        _uiState.update { it.copy(pickerSlot = null) }
    }

    fun clear(slot: Int) {
        val current = _uiState.value.slots.toMutableList()
        current[slot] = null
        applySlots(current, chosenByUser = true)
    }

    private fun applySlots(slots: List<String?>, chosenByUser: Boolean) {
        if (chosenByUser) {
            slotsAreDefault = false
            MonitorSlotsStore.save(appContext, slots)
            // The home-screen widget shows the same four; let it catch up.
            WidgetRefreshWorker.refreshNow(appContext)
        }
        _uiState.update { state ->
            val ids = slots.filterNotNull().toSet()
            val tiles = state.tiles.filterKeys { it in ids }.toMutableMap()
            for (id in ids) {
                if (id !in tiles) {
                    tiles[id] = MonitorTile(sessionId = id, session = state.sessions.firstOrNull { it.id == id })
                }
            }
            state.copy(slots = slots, tiles = tiles)
        }
        ensureSubscribed()
    }

    private fun ensureSubscribed() {
        _uiState.value.slots.filterNotNull().forEach { socketManager.ensureSubscribed(it) }
    }

    // ── Sessions from Room ──────────────────────────────────────────────────

    private fun observeSessions() {
        sessionRepository.sessions
            .onEach { sessions ->
                _uiState.update { state ->
                    val byId = sessions.associateBy { it.id }
                    state.copy(
                        sessions = sessions,
                        tiles = state.tiles.mapValues { (id, tile) -> tile.copy(session = byId[id] ?: tile.session) },
                    )
                }
                if (slotsAreDefault && sessions.isNotEmpty()) {
                    // Applied once; the user's choices from then on are theirs.
                    slotsAreDefault = false
                    applySlots(defaultMonitorSlots(sessions), chosenByUser = false)
                }
            }
            .launchIn(viewModelScope)
    }

    private fun seedApprovals(approvals: List<PendingPermissionItem>) {
        _uiState.update { state ->
            val bySession = approvals.groupBy { it.sessionId }
            state.copy(
                tiles = state.tiles.mapValues { (id, tile) ->
                    val pending = bySession[id]?.firstOrNull()
                    when {
                        // The socket already delivered a richer copy.
                        tile.approval != null && pending?.requestId == tile.approval.requestId -> tile
                        pending != null -> tile.copy(
                            approval = MonitorApproval(pending.requestId, pending.toolName, pending.description),
                        )
                        // Answered elsewhere: the overview no longer lists it.
                        tile.approval != null -> tile.copy(approval = null)
                        else -> tile
                    }
                },
            )
        }
    }

    // ── Live events ─────────────────────────────────────────────────────────

    private inline fun updateTile(sessionId: String, crossinline transform: (MonitorTile) -> MonitorTile) {
        _uiState.update { state ->
            val tile = state.tiles[sessionId] ?: return@update state
            state.copy(tiles = state.tiles + (sessionId to transform(tile)))
        }
    }

    private fun observeSocket() {
        socketManager.output
            .onEach { chunk ->
                updateTile(chunk.sessionId) { tile ->
                    val text = (tile.streamingText + chunk.content).takeLast(STREAM_TAIL_CHARS)
                    tile.copy(streamingText = text, isThinking = false, error = null)
                }
            }
            .launchIn(viewModelScope)

        socketManager.messages
            .onEach { message ->
                if (message.role != MessageRole.ASSISTANT) return@onEach
                updateTile(message.sessionId) { tile ->
                    tile.copy(
                        streamingText = "",
                        lastReply = message.content.takeLast(STREAM_TAIL_CHARS),
                        isThinking = false,
                        currentTool = null,
                    )
                }
            }
            .launchIn(viewModelScope)

        socketManager.thinking
            .onEach { event ->
                updateTile(event.sessionId) { it.copy(isThinking = event.isThinking) }
            }
            .launchIn(viewModelScope)

        socketManager.toolUse
            .onEach { event ->
                updateTile(event.sessionId) { tile ->
                    val label = event.actionSummary ?: event.toolName
                    if (event.status == ToolStatus.STARTED) tile.copy(currentTool = label, isThinking = false)
                    else if (tile.currentTool == label) tile.copy(currentTool = null)
                    else tile
                }
            }
            .launchIn(viewModelScope)

        socketManager.agent
            .onEach { event ->
                updateTile(event.sessionId) { tile ->
                    if (event.status == ToolStatus.STARTED) tile.copy(currentTool = event.agentType)
                    else tile.copy(currentTool = null)
                }
            }
            .launchIn(viewModelScope)

        socketManager.status
            .onEach { (sessionId, status) ->
                if (status == SessionStatus.RUNNING) return@onEach
                updateTile(sessionId) { it.copy(isThinking = false, currentTool = null) }
            }
            .launchIn(viewModelScope)

        socketManager.errors
            .onEach { (sessionId, error) ->
                updateTile(sessionId) { it.copy(error = error, isThinking = false, currentTool = null, isSending = false) }
            }
            .launchIn(viewModelScope)

        socketManager.permission
            .onEach { element ->
                val obj = runCatching { JSONObject(element.toString()) }.getOrNull() ?: return@onEach
                val sessionId = obj.optString("sessionId")
                if (sessionId.isBlank()) return@onEach
                val requestId = obj.optString("requestId")
                if (requestId.isNotBlank()) {
                    updateTile(sessionId) {
                        it.copy(
                            approval = MonitorApproval(
                                requestId = requestId,
                                toolName = obj.optString("toolName", "tool"),
                                description = obj.optString("description"),
                            ),
                            isThinking = false,
                        )
                    }
                } else if (obj.has("denials")) {
                    val denials = obj.optJSONArray("denials")
                    val tools = buildList {
                        if (denials != null) for (i in 0 until denials.length()) {
                            denials.optJSONObject(i)?.optString("tool_name")?.takeIf { it.isNotBlank() }?.let(::add)
                        }
                    }
                    updateTile(sessionId) {
                        it.copy(
                            legacyApproval = MonitorLegacyApproval(tools, obj.optString("originalMessage")),
                            isThinking = false,
                        )
                    }
                }
            }
            .launchIn(viewModelScope)

        socketManager.question
            .onEach { event ->
                updateTile(event.sessionId) { it.copy(question = event, isThinking = false) }
            }
            .launchIn(viewModelScope)
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    fun updateDraft(sessionId: String, text: String) = updateTile(sessionId) { it.copy(draft = text) }

    fun addAttachments(sessionId: String, attachments: List<PendingFileAttachment>) {
        if (attachments.isEmpty()) return
        updateTile(sessionId) { tile ->
            val room = (MAX_ATTACHMENT_COUNT - tile.pendingAttachments.size).coerceAtLeast(0)
            val combined = tile.pendingAttachments + attachments.take(room)
            var total = 0L
            val withinTotal = combined.filter { item ->
                val size = item.sizeBytes ?: 0L
                (total + size <= MAX_TOTAL_ATTACHMENT_BYTES).also { fits -> if (fits) total += size }
            }
            tile.copy(
                pendingAttachments = withinTotal,
                error = if (withinTotal.size < tile.pendingAttachments.size + attachments.size) {
                    appContext.getString(R.string.chat_attachment_limit, MAX_ATTACHMENT_COUNT, formatBytes(MAX_TOTAL_ATTACHMENT_BYTES))
                } else tile.error,
            )
        }
    }

    fun removeAttachment(sessionId: String, index: Int) = updateTile(sessionId) { tile ->
        if (index !in tile.pendingAttachments.indices) tile
        else tile.copy(pendingAttachments = tile.pendingAttachments.toMutableList().apply { removeAt(index) })
    }

    fun reportAttachmentFailure(sessionId: String, failed: Int, total: Int) {
        if (failed <= 0) return
        val message = when {
            total == 1 -> appContext.getString(R.string.chat_attach_failed)
            failed == total -> appContext.getString(R.string.chat_attach_many_failed, failed)
            else -> appContext.getString(R.string.chat_attach_partial_failed, failed, total)
        }
        updateTile(sessionId) { it.copy(error = message) }
    }

    /** Dictation: transcribe the clip and append it to the tile's draft. */
    fun transcribe(sessionId: String, audio: ByteArray) {
        updateTile(sessionId) { it.copy(isTranscribing = true) }
        viewModelScope.launch {
            apiCall { api.transcribe(audio).data?.text }
                .onSuccess { text ->
                    updateTile(sessionId) { tile ->
                        if (text.isNullOrBlank()) tile.copy(error = appContext.getString(R.string.chat_voice_empty))
                        else tile.copy(draft = if (tile.draft.isBlank()) text else tile.draft.trimEnd() + " " + text)
                    }
                }
                .onFailure { failure -> updateTile(sessionId) { it.copy(error = failure.message) } }
            updateTile(sessionId) { it.copy(isTranscribing = false) }
        }
    }

    /**
     * Send the tile's draft and attachments.
     *
     * Same durability as the chat: the message goes into the Room outbox
     * first, files are staged through the shared uploader, and the row is
     * marked accepted or failed afterwards — so opening the chat later shows
     * the same delivery state and can retry a failed one.
     */
    fun send(sessionId: String, text: String) {
        val tile = _uiState.value.tiles[sessionId] ?: return
        val message = text.trim()
        val attachments = tile.pendingAttachments
        if (message.isEmpty() && attachments.isEmpty()) return
        if (tile.isSending) return
        val item = OutboxEntity(
            clientMessageId = UUID.randomUUID().toString(),
            sessionId = sessionId,
            content = message,
            attachmentsJson = OutboxEntity.attachmentsJson(
                attachments.map { PersistedOutboxAttachment(uri = it.uri, mimeType = it.mimeType, filename = it.filename, sizeBytes = it.sizeBytes) }
            ),
            status = OutboxStatus.SENDING.name,
        )
        updateTile(sessionId) {
            it.copy(
                isSending = true,
                isPreparingAttachments = attachments.isNotEmpty(),
                attachmentProgress = 0f,
                error = null,
                sentNotice = false,
                draft = "",
                pendingAttachments = emptyList(),
            )
        }
        viewModelScope.launch {
            messageRepository.putOutbox(item)
            try {
                if (socketManager.connectionState.value != ConnectionState.CONNECTED) {
                    fail(item, appContext.getString(R.string.chat_saved_offline))
                    return@launch
                }
                val prepared = uploader.prepare(sessionId, item) { progress ->
                    updateTile(sessionId) { it.copy(attachmentProgress = progress) }
                }
                val latest = messageRepository.getOutboxItem(item.clientMessageId) ?: item
                val ack = socketManager.sendMessage(
                    sessionId = sessionId,
                    chatId = null,
                    message = message,
                    images = prepared.legacyAttachments.takeIf { it.isNotEmpty() },
                    clientMessageId = item.clientMessageId,
                    uploadIds = prepared.uploadIds,
                )
                if (ack.status == SessionSendAck.SendStatus.ACCEPTED) {
                    messageRepository.putOutbox(
                        latest.copy(
                            status = OutboxStatus.ACCEPTED.name,
                            progress = 1f,
                            error = null,
                            retryable = false,
                            acceptedAt = ack.acceptedAt,
                            messageId = ack.messageId,
                            disposition = ack.disposition,
                            highWatermark = ack.highWatermark,
                            uploadIdsJson = OutboxEntity.uploadIdsJson(prepared.uploadIds),
                        )
                    )
                    updateTile(sessionId) { it.copy(sentNotice = true, lastReply = null, streamingText = "") }
                } else {
                    fail(latest, ack.error ?: appContext.getString(R.string.chat_message_rejected))
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                fail(item, failure.message ?: appContext.getString(R.string.chat_delivery_failed))
            } finally {
                updateTile(sessionId) { it.copy(isSending = false, isPreparingAttachments = false, attachmentProgress = 0f) }
            }
        }
    }

    private suspend fun fail(item: OutboxEntity, error: String) {
        val latest = messageRepository.getOutboxItem(item.clientMessageId) ?: item
        messageRepository.putOutbox(latest.copy(status = OutboxStatus.FAILED.name, error = error, retryable = true))
        updateTile(item.sessionId) { it.copy(error = error) }
    }

    fun interrupt(sessionId: String) {
        socketManager.interruptSession(sessionId)
    }

    fun respondToApproval(sessionId: String, allow: Boolean) {
        val tile = _uiState.value.tiles[sessionId] ?: return
        val approval = tile.approval
        val legacy = tile.legacyApproval
        when {
            approval != null -> viewModelScope.launch {
                sessionRepository
                    .respondToPermission(
                        sessionId,
                        approval.requestId,
                        if (allow) PermissionAction.ALLOW_ONCE else PermissionAction.DENY,
                    )
                    .onSuccess {
                        gatewayRepository.forgetApproval(approval.requestId)
                        updateTile(sessionId) { it.copy(approval = null) }
                    }
                    .onFailure { failure -> updateTile(sessionId) { it.copy(error = failure.message) } }
            }
            legacy != null -> {
                if (allow) socketManager.approvePermission(sessionId, legacy.toolNames, legacy.originalMessage)
                else socketManager.denyPermission(sessionId)
                updateTile(sessionId) { it.copy(legacyApproval = null) }
            }
        }
    }

    fun answerQuestion(sessionId: String, answer: String) {
        val question = _uiState.value.tiles[sessionId]?.question ?: return
        viewModelScope.launch {
            sessionRepository
                .respondToQuestion(question.requestId, listOf(listOf(answer)), question.providerSessionId)
                .onSuccess { updateTile(sessionId) { it.copy(question = null) } }
                .onFailure { failure -> updateTile(sessionId) { it.copy(error = failure.message) } }
        }
    }

    fun dismissError(sessionId: String) = updateTile(sessionId) { it.copy(error = null) }

    fun clearSentNotice(sessionId: String) = updateTile(sessionId) { it.copy(sentNotice = false) }

}
