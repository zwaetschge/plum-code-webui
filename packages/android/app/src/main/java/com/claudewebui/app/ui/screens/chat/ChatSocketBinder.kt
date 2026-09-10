package com.claudewebui.app.ui.screens.chat

import android.content.Context

import android.os.Build
import com.claudewebui.app.core.network.ChatSyncEvent
import com.claudewebui.app.core.network.ReconnectedEvent
import com.claudewebui.app.core.network.BufferedMessage
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.SessionChatList
import com.claudewebui.app.data.model.QuestionRequestEvent
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.StreamingMessage
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.data.repository.ignoreSupersededHistory
import com.claudewebui.app.data.repository.normalizedChatIdentity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal val chatSocketJson = Json { ignoreUnknownKeys = true; coerceInputValues = true }

/**
 * Binds the socket to the one session this ViewModel shows: room
 * subscription, per-session event routing, reconnect replay and the presence
 * heartbeat. Everything here is scoped to the ViewModel's `viewModelScope`,
 * so switching sessions tears it all down with the ViewModel — one live
 * subscription set per open chat, never one per visited session.
 */
internal class ChatSocketBinder(
    private val scope: CoroutineScope,
    private val sessionId: String,
    private val appContext: Context,
    private val state: MutableStateFlow<ChatUiState>,
    private val socketManager: SocketManager,
    private val messageRepository: MessageRepository,
    private val sessionRepository: SessionRepository,
    private val readState: StateFlow<SessionReadStateEntity?>,
    private val streaming: ChatStreamingController,
    private val history: ChatHistoryLoader,
    private val search: ChatSearchController,
    private val permissions: ChatPermissionController,
    private val send: ChatSendController,
    /** Whether an event's chat thread is the one on screen (null = any). */
    private val belongsToActiveChat: (String?) -> Boolean,
    /** Adopt the first thread id seen when none is active; returns the effective thread. */
    private val adoptIncomingChat: (String?) -> String?,
    private val deviceId: () -> String,
    private val isSessionReady: () -> Boolean,
    private val onChatsChanged: (SessionChatList) -> Unit,
    private val refreshChats: suspend () -> Boolean,
) {
    private var presenceJob: Job? = null
    private var sessionEventsBound = false
    private val cursorPreferences by lazy { appContext.getSharedPreferences("chat_device", Context.MODE_PRIVATE) }
    private val cursorProtocolKey = "chat-sync-protocol2:$sessionId"
    private fun hasVerifiedCursor(): Boolean = cursorPreferences.getBoolean(cursorProtocolKey, false)

    // ── Room membership ─────────────────────────────────────────────────────

    fun requestReconnect() {
        scope.launch {
            // Read Room directly: StateFlow may still expose the pre-upgrade cursor 102
            // in the instant after the cursor-99 transaction committed.
            val sequence = if (hasVerifiedCursor()) {
                messageRepository.cachedReadState(sessionId)?.lastSeenSequence?.takeIf { it > 0 }
            } else null
            socketManager.reconnectSession(sessionId, lastSequence = sequence)
        }
    }

    /**
     * Join the room, replay what was missed and re-drive the outbox — the
     * shared path for first load, foreground resume and reconnect.
     */
    fun joinIfConnected() {
        if (socketManager.connectionState.value == ConnectionState.CONNECTED) {
            socketManager.subscribeToSession(sessionId)
            requestReconnect()
            send.retryPendingOutbox()
        }
    }

    /** Tell the room this device left and stop the heartbeat. */
    fun stopPresence() {
        emitPresence(presenceState = "leave")
        presenceJob?.cancel()
    }

    /** Leave the room; the ViewModel is going away. */
    fun unsubscribe() {
        // A no-op while the dashboard is monitoring this session — leaving a
        // chat must not stop its approvals and errors from reaching the phone.
        socketManager.unsubscribeFromSession(sessionId)
    }

    // ── Presence ────────────────────────────────────────────────────────────

    fun startPresenceHeartbeat() {
        presenceJob?.cancel()
        // IO on purpose: the first tick materialises deviceId from
        // SharedPreferences, and socket emits are thread-safe.
        presenceJob = scope.launch(Dispatchers.IO) {
            // Foreground-gated. The loop used to run for as long as the process
            // did, so an open chat kept the radio and the socket alive for hours
            // after the user had put the phone away — and told everyone else in
            // the session that they were still watching.
            LocalNotificationManager.foreground.collectLatest { inForeground ->
                if (!inForeground) {
                    emitPresence(presenceState = "idle")
                    return@collectLatest
                }
                while (isActive) {
                    emitPresence(presenceState = "active")
                    delay(PRESENCE_HEARTBEAT_MS)
                }
            }
        }
    }

    private fun emitPresence(presenceState: String) {
        socketManager.updatePresence(
            sessionId = sessionId,
            deviceId = deviceId(),
            label = Build.MODEL.takeIf { it.isNotBlank() },
            state = presenceState,
            lastReadMessageId = null,
        )
    }

    // ── Connection lifecycle ────────────────────────────────────────────────

    fun observeConnectionState() {
        var wasConnected = socketManager.connectionState.value == ConnectionState.CONNECTED
        socketManager.connectionState
            .onEach { connection ->
                val isConnected = connection == ConnectionState.CONNECTED
                if (!isConnected) {
                    streaming.resetActivity()
                    // Without this the composer stays locked on "Agent is
                    // working…" forever after a network drop.
                    state.update {
                        it.copy(
                            isConnected = false,
                            isSending = false,
                            isThinking = false,
                            streamingState = StreamingState.Idle,
                        )
                    }
                } else {
                    state.update { it.copy(isConnected = true) }
                    if (isSessionReady()) {
                        socketManager.subscribeToSession(sessionId)
                        // session:reconnect re-joins the room and reports the
                        // running state; the REST refetch recovers messages
                        // produced while the app was offline.
                        requestReconnect()
                        send.retryPendingOutbox()
                        if (wasConnected.not()) {
                            history.refreshInBackground()
                        }
                    }
                }
                wasConnected = isConnected
            }
            .launchIn(scope)
    }

    /** Agent task list for this session; other sessions' todos are ignored. */
    fun observeTodos() {
        socketManager.todos
            .onEach { (eventSessionId, todos) ->
                if (eventSessionId != sessionId) return@onEach
                state.update { it.copy(todos = todos) }
            }
            .launchIn(scope)
    }

    // ── Session events ──────────────────────────────────────────────────────

    /** Route every per-session socket event; called once the session row exists. */
    fun bindSessionEvents() {
        if (sessionEventsBound) return
        sessionEventsBound = true
        // A single collector applies each Room write before advancing any later
        // event's cursor. Separate SharedFlows only guaranteed emission order.
        socketManager.chatSyncEvents
            .onEach { event ->
                ignoreSupersededHistory { applySyncEvent(event) }
            }
            .launchIn(scope)

        socketManager.presence
            .filter { it.sessionId == sessionId }
            .onEach { snapshot -> state.update { it.copy(presenceViewers = snapshot.viewers) } }
            .launchIn(scope)
        socketManager.usage
            .filter { it.sessionId == sessionId }
            .onEach { usage -> state.update { it.copy(usageData = usage) } }
            .launchIn(scope)
        socketManager.mode
            .filter { (id, _) -> id == sessionId }
            .onEach { (_, mode) -> state.update { it.copy(sessionMode = mode) } }
            .launchIn(scope)
        socketManager.queue
            .filter { it.sessionId == sessionId }
            .onEach { event -> state.update { it.copy(queuedCount = event.depth, isSending = false) } }
            .launchIn(scope)
    }

    private suspend fun applySyncEvent(event: ChatSyncEvent) {
        when (event) {
            is ChatSyncEvent.Output -> if (event.value.sessionId == sessionId && belongsToActiveChat(event.value.chatId)) {
                adoptIncomingChat(event.value.chatId)
                streaming.enqueueDelta(event.value.content)
            }
            is ChatSyncEvent.PersistedMessage -> if (event.value.sessionId == sessionId) {
                applyMessage(event.value)
            }
            is ChatSyncEvent.Reconnected -> if (event.value.sessionId == sessionId) applyReconnect(event.value)
            is ChatSyncEvent.Chats -> if (event.value.sessionId == sessionId) {
                onChatsChanged(SessionChatList(event.value.chats, event.value.activeChatId).normalizedChatIdentity())
            }
            is ChatSyncEvent.Status -> if (event.sessionId == sessionId) {
                if (event.value == SessionStatus.STOPPED || event.value == SessionStatus.ERROR) streaming.resetActivity()
                // Session metadata need not hold up transcript deltas.
                scope.launch { sessionRepository.getSession(sessionId) }
            }
            is ChatSyncEvent.Cursor -> if (event.sessionId == sessionId) {
                // The server announces only the contiguous published prefix,
                // after its domain event. A newer message alone proves no gap-free cursor.
                search.commitAppliedSequence(event.sequence)
            }
            is ChatSyncEvent.Failure -> if (event.sessionId == sessionId) {
                streaming.resetActivity()
                state.update { it.copy(error = event.message) }
            }
            is ChatSyncEvent.Thinking -> if (event.value.sessionId == sessionId) streaming.onThinking(event.value)
            is ChatSyncEvent.Tool -> if (event.value.sessionId == sessionId) streaming.onToolEvent(event.value)
            is ChatSyncEvent.Agent -> if (event.value.sessionId == sessionId) streaming.onAgentEvent(event.value)
            is ChatSyncEvent.Compact -> if (event.value.sessionId == sessionId) {
                if (event.value.clear == true) {
                    streaming.resetActivity()
                    history.refresh()
                }
                state.update { it.copy(settingsNotice = event.value.message) }
            }
            is ChatSyncEvent.Question -> if (event.value.sessionId == sessionId) {
                permissions.onQuestion(event.value)
            }
            is ChatSyncEvent.Permission -> {
                permissions.applyPermissionElement(event.value)
            }
        }
    }

    /** Cache all threads before committing a session-wide sequence, even off screen. */
    private suspend fun applyMessage(message: Message) {
        val visible = belongsToActiveChat(message.chatId)
        val incomingChatId = if (visible) adoptIncomingChat(message.chatId) else message.chatId
        // A user follow-up during an active reply must not clear the assistant's prefix.
        if (visible && message.role == MessageRole.ASSISTANT) streaming.onMessageCompleted()
        val alreadyApplied = message.eventSequence?.let {
            it <= (messageRepository.cachedReadState(sessionId)?.lastSeenSequence ?: 0L)
        } == true
        messageRepository.cacheMessage(message, incomingChatId)
        if (visible && !alreadyApplied) {
            // HTTP read receipts must not pause the transcript event queue.
            scope.launch {
                if (belongsToActiveChat(message.chatId)) search.handleIncomingMessageReadState(message)
            }
        }
    }

    private suspend fun applyReconnect(event: ReconnectedEvent) {
        val previousChatId = state.value.activeChatId
        if (event.hasActiveChatId) {
            onChatsChanged(SessionChatList(state.value.chats, event.activeChatId).normalizedChatIdentity())
        }
        val refreshedChatChanged = refreshChats()
        val chatChanged = refreshedChatChanged || previousChatId != state.value.activeChatId
        streaming.resetActivity()
        ignoreSupersededHistory {
            if (event.needsFullResync || chatChanged || !hasVerifiedCursor()) {
                resyncFromRest()
            } else {
                val currentSequence = messageRepository.cachedReadState(sessionId)?.lastSeenSequence ?: 0L
                var replayComplete = true
                for (item in event.bufferedMessages.sortedWith(
                    compareBy<BufferedMessage> { it.sequence ?: Long.MAX_VALUE }.thenBy { it.timestamp },
                ).filter { (it.sequence ?: Long.MAX_VALUE) > currentSequence }) {
                    if (!handleBufferedMessage(item)) {
                        replayComplete = false
                        break
                    }
                }
                if (replayComplete) search.commitAppliedSequence(event.highWatermark, event.snapshotRevision)
                else resyncFromRest()
            }
        }
        // isRunning denotes a live CLI process, which can be idle. Only an actual
        // snapshot can restore a partial reply; null authoritatively clears it.
        val snapshot = event.streamingSnapshot?.takeIf {
            event.isRunning && event.isBusy != false && it.sessionId == sessionId && belongsToActiveChat(it.chatId)
        }
        streaming.restoreSnapshot(snapshot?.content)
    }

    /** The buffer rolled over or replay broke: the REST page is the truth. */
    private suspend fun resyncFromRest() {
        history.refresh(resetReplayCursor = !hasVerifiedCursor())
            .onSuccess { page ->
                if (page.replayCursorReset) {
                    // The Room transaction already committed. A crash before
                    // this preference is flushed simply repeats the safe sync.
                    cursorPreferences.edit().putBoolean(cursorProtocolKey, true).apply()
                }
                search.commitAppliedSequence(
                    page.snapshot?.highWatermark,
                    page.snapshot?.revision,
                )
            }
            .onFailure { error ->
                state.update { it.copy(error = error.userMessage(appContext)) }
            }
    }

    private suspend fun handleBufferedMessage(item: BufferedMessage): Boolean = when (item.type) {
        "message" -> runCatching {
            chatSocketJson.decodeFromJsonElement(Message.serializer(), item.data)
        }.getOrNull()?.let { message ->
            if (message.sessionId != sessionId) return@let false
            applyMessage(message)
            true
        } ?: false
        "output" -> runCatching {
            chatSocketJson.decodeFromJsonElement(StreamingMessage.serializer(), item.data)
        }.getOrNull()?.let {
            if (it.sessionId != sessionId) return@let false
            if (!belongsToActiveChat(it.chatId)) return@let true
            adoptIncomingChat(it.chatId)
            streaming.enqueueDelta(it.content)
            true
        } ?: false
        "thinking" -> runCatching {
            val obj = item.data.jsonObject
            val active = obj["isThinking"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            val label = obj["message"]?.jsonPrimitive?.content
            streaming.onBufferedThinking(active, label)
            true
        }.getOrDefault(false)
        "question", "question_request", "session:question_request" -> runCatching {
            chatSocketJson.decodeFromJsonElement(QuestionRequestEvent.serializer(), item.data)
        }.getOrNull()?.takeIf { it.sessionId == sessionId }?.let { request ->
            permissions.onQuestion(request)
            true
        } ?: false
        "permission_request", "permission", "session:permission_request" ->
            permissions.applyPermissionElement(item.data).first
        // These event types are already represented by newer REST/session
        // state or are non-durable UI hints; consuming them is idempotent.
        "status", "tool_use", "agent", "mode", "compact", "todos", "usage" -> true
        else -> false
    }
}

internal const val PRESENCE_HEARTBEAT_MS = 25_000L
