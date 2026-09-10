package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.R
import com.claudewebui.app.ui.components.common.localizedLabel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.cachedIn
import com.claudewebui.app.core.network.AppError
import com.claudewebui.app.core.network.toAppError
import com.claudewebui.app.core.diagnostics.Breadcrumbs
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.model.*
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.UUID

/**
 * One live ViewModel per open chat. [ChatScreen] owns it in a per-session
 * store, so switching sessions clears it — socket subscriptions, heartbeat,
 * deliveries and all. The heavy lifting is split across collaborators that
 * share `viewModelScope` and the single [uiState] flow:
 *
 * - [ChatStreamingController] — live-turn text/thinking/tool/agent state
 * - [ChatHistoryLoader] — transcript paging and the Room reveal window
 * - [ChatDraftController] — composer drafts and pending attachments
 * - [ChatSendController] — outbox, uploads, acknowledgements, retries
 * - [ChatPermissionController] — permission and question prompts
 * - [ChatSearchController] — search, jump-to-message, read position
 * - [ChatSocketBinder] — room membership, event routing, presence
 */
class ChatViewModel(
    private val sessionId: String,
    private val messageRepository: MessageRepository,
    private val sessionRepository: SessionRepository,
    private val settingsRepository: com.claudewebui.app.data.repository.SettingsRepository,
    private val socketManager: SocketManager,
    private val api: com.claudewebui.app.core.network.ApiClient,
    private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val selectedChatId = MutableStateFlow<String?>(null)

    /** Small live tail for delivery reconciliation; the UI uses [pagedMessages]. */
    val messages: StateFlow<List<Message>> = selectedChatId
        .flatMapLatest { chatId -> messageRepository.getMessages(sessionId, chatId, limit = 150) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** The transcript uses Paging; [messages] is a small tail for delivery/read bookkeeping. */
    val pagedMessages = selectedChatId
        .flatMapLatest { chatId -> messageRepository.pagedMessages(sessionId, chatId) }
        .cachedIn(viewModelScope)

    /** Pending/accepted/failed sends survive process death and reconnects. */
    val outbox: StateFlow<List<OutboxEntity>> = messageRepository.getOutbox(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val readState: StateFlow<SessionReadStateEntity?> = messageRepository.getReadState(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Room-backed session info */
    val session: StateFlow<Session?> = sessionRepository.observeSession(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val deviceId: String by lazy {
        val preferences = appContext.getSharedPreferences("chat_device", Context.MODE_PRIVATE)
        preferences.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("device_id", it).apply()
        }
    }

    private var initializationJob: Job? = null
    private var limitsJob: Job? = null
    private var isSessionReady = false
    private var hasLoadedChatList = false
    private var chatListVersion = 0L

    // ── Collaborators (construction order follows their dependencies) ───────

    private val streaming = ChatStreamingController(viewModelScope, _uiState)
    private val drafts = ChatDraftController(
        appContext = appContext,
        scope = viewModelScope,
        sessionId = sessionId,
        state = _uiState,
        messageRepository = messageRepository,
        api = api,
        isSessionReady = { isSessionReady },
    )
    private val history = ChatHistoryLoader(
        appContext = appContext,
        scope = viewModelScope,
        sessionId = sessionId,
        state = _uiState,
        selectedChatId = selectedChatId,
        messageRepository = messageRepository,
        onChatSelected = drafts::selectChat,
    )
    private val search = ChatSearchController(
        appContext = appContext,
        scope = viewModelScope,
        sessionId = sessionId,
        state = _uiState,
        api = api,
        messageRepository = messageRepository,
        sessionRepository = sessionRepository,
        socketManager = socketManager,
        messages = messages,
        history = history,
        drafts = drafts,
        deviceId = { deviceId },
    )
    private val permissions = ChatPermissionController(
        appContext = appContext,
        scope = viewModelScope,
        sessionId = sessionId,
        state = _uiState,
        sessionRepository = sessionRepository,
        socketManager = socketManager,
    )
    private val send = ChatSendController(
        scope = viewModelScope,
        sessionId = sessionId,
        state = _uiState,
        messageRepository = messageRepository,
        socketManager = socketManager,
        api = api,
        appContext = appContext,
        messages = messages,
        drafts = drafts,
        isSessionReady = { isSessionReady },
    )
    private val socket = ChatSocketBinder(
        appContext = appContext,
        scope = viewModelScope,
        sessionId = sessionId,
        state = _uiState,
        socketManager = socketManager,
        messageRepository = messageRepository,
        sessionRepository = sessionRepository,
        readState = readState,
        streaming = streaming,
        history = history,
        search = search,
        permissions = permissions,
        send = send,
        belongsToActiveChat = ::belongsToActiveChat,
        adoptIncomingChat = ::adoptIncomingChat,
        deviceId = { deviceId },
        isSessionReady = { isSessionReady },
        onChatsChanged = { list -> applyChatList(list, null) },
        refreshChats = { refreshChatList(refreshHistory = false) },
    )

    init {
        Breadcrumbs.add("chat", "created")
        socket.observeConnectionState()
        observeSessionMode()
        observeReadState()
        reconcileOutboxWithMessages()
        observeProviderLimits()
        socket.observeTodos()
        loadSlashCommands()
        loadStyleLibrary()
        loadTurnDiffs()
        loadMeshPeers()
        probeVoiceInput()
        initializeChat()
    }

    // ── Room-backed observers ───────────────────────────────────────────────

    private fun observeSessionMode() {
        session
            .mapNotNull { it?.mode }
            .distinctUntilChanged()
            .onEach { mode -> _uiState.update { it.copy(sessionMode = mode) } }
            .launchIn(viewModelScope)
    }

    private fun observeReadState() {
        readState
            .filterNotNull()
            .onEach { state ->
                _uiState.update {
                    it.copy(
                        lastReadMessageId = state.lastReadMessageId,
                        unreadCount = state.unreadCount,
                        restoreAnchorMessageId = state.scrollAnchorMessageId,
                        restoreAnchorOffset = state.scrollOffset,
                    )
                }
            }
            .launchIn(viewModelScope)
    }

    private fun reconcileOutboxWithMessages() {
        combine(messages, outbox) { cached, queued -> cached to queued }
            .onEach { (cached, queued) ->
                val clientIds = cached.mapNotNullTo(hashSetOf()) { it.clientMessageId }
                val messageIds = cached.mapTo(hashSetOf()) { it.id }
                queued.asSequence()
                    .filter { item ->
                        item.clientMessageId in clientIds ||
                            (item.messageId != null && item.messageId in messageIds)
                    }
                    .forEach { messageRepository.removeOutbox(it.clientMessageId) }
            }
            .launchIn(viewModelScope)
    }

    /** Backs the composer's `/` picker; a failure just leaves it empty. */
    private fun loadSlashCommands() {
        viewModelScope.launch {
            settingsRepository.getCommands().onSuccess { commands ->
                _uiState.update { it.copy(slashCommands = commands) }
            }
        }
    }

    /** Presentation presets for the session settings sheet. */
    private fun loadStyleLibrary() {
        viewModelScope.launch {
            settingsRepository.getStyleLibrary().onSuccess { library ->
                _uiState.update {
                    it.copy(
                        designStyles = library.designStyles,
                        writingStyles = library.writingStyles,
                    )
                }
            }
        }
    }

    /** Apply or clear a presentation preset for this session. */
    fun setStyleSkill(kind: StyleKind, skill: String?) {
        applySessionChange(appContext.getString(R.string.chat_style_updated)) {
            sessionRepository.setStyleSkill(sessionId, kind, skill)
        }
    }

    // ========================================================================
    // Initial Load
    // ========================================================================

    private fun initializeChat() {
        if (initializationJob?.isActive == true) return
        initializationJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoadingHistory = true) }
            try {
                loadSessionThenMessages(
                    loadSession = { sessionRepository.getSessionOrCached(sessionId).map { } },
                    onSessionLoaded = {
                        isSessionReady = true
                        val cachedChatId = messageRepository.cachedReadState(sessionId)?.chatId
                        if (_uiState.value.activeChatId == null && cachedChatId != null) {
                            selectedChatId.value = cachedChatId
                            _uiState.update { it.copy(activeChatId = cachedChatId) }
                        }
                        drafts.selectChat(_uiState.value.activeChatId)
                        socket.bindSessionEvents()
                        loadAllowedDirectories()
                        loadChats()
                        socket.startPresenceHeartbeat()
                        socket.joinIfConnected()
                    },
                    loadMessages = {
                        val version = history.beginReplacement()
                        messageRepository.fetchMessages(
                            sessionId, clearExisting = true, useServerActiveChat = true,
                            acceptResponse = { history.isCurrentReplacement(version) },
                        )
                            .onSuccess { page ->
                                if (history.isCurrentReplacement(version)) history.applyInitialHistoryPage(page)
                            }
                            .map { }
                    },
                )
                    .onFailure { e -> _uiState.update { it.copy(error = e.userMessage(appContext)) } }
            } finally {
                _uiState.update { it.copy(isLoadingHistory = false) }
            }
        }
    }

    private fun loadMessages() {
        if (!isSessionReady) {
            initializeChat()
            return
        }
        history.reloadActiveChat()
    }

    // ========================================================================
    // Provider account limits
    // ========================================================================

    /** Reload the quota whenever the session's provider appears or changes. */
    private fun observeProviderLimits() {
        session
            .mapNotNull { it?.cliProvider }
            .distinctUntilChanged()
            .onEach { loadProviderLimits() }
            .launchIn(viewModelScope)
    }

    /**
     * Live account quota (5h/weekly windows) of the active provider. Providers
     * without an account of their own (OpenCode, Pi) answer `supported: false`
     * and the row simply stays hidden.
     */
    fun loadProviderLimits() {
        val provider = session.value?.cliProvider ?: return
        limitsJob?.cancel()
        limitsJob = viewModelScope.launch {
            val response = runCatching { api.getUsageLimits(provider.name.lowercase()) }.getOrNull()
            // An unreachable endpoint says nothing about the account — keep
            // whatever was shown rather than blanking the row.
            if (response != null) {
                _uiState.update {
                    it.copy(providerLimits = response.data.takeIf { _ -> response.supported })
                }
            }
        }
    }

    /**
     * App returned to the foreground. A socket revived from Doze can be a
     * zombie — still claiming connected while the server dropped it — so the
     * message history refreshes over REST unconditionally and the socket layer
     * re-joins the session room.
     */
    fun onResumed() {
        Breadcrumbs.add("chat", "resumed")
        if (!isSessionReady) return
        socketManager.ensureConnected()
        // Marks this session as the one on screen, so the dashboard-wide
        // monitoring window cannot unsubscribe it while the user is reading.
        LocalNotificationManager.setOpenSession(sessionId)
        history.refreshInBackground()
        socket.joinIfConnected()
        loadChats()
        loadProviderLimits()
    }

    // ========================================================================
    // Chat threads
    // ========================================================================

    private fun belongsToActiveChat(chatId: String?): Boolean {
        val active = _uiState.value.activeChatId
        return !hasLoadedChatList || chatId == active
    }

    private fun adoptIncomingChat(chatId: String?): String? {
        val active = _uiState.value.activeChatId
        if (!hasLoadedChatList && active == null && chatId != null) {
            selectedChatId.value = chatId
            _uiState.update { it.copy(activeChatId = chatId) }
            drafts.selectChat(chatId)
            return chatId
        }
        return active
    }

    fun loadChats() {
        viewModelScope.launch { refreshChatList() }
    }

    private suspend fun refreshChatList(refreshHistory: Boolean = true): Boolean {
        val version = ++chatListVersion
        val list = sessionRepository.getChats(sessionId).getOrNull() ?: return false
        if (version != chatListVersion) return false
        return applyChatList(list, null, refreshHistory)
    }

    /** REST and other devices use the same thread transition, including history and draft. */
    private fun applyChatList(
        list: SessionChatList,
        notice: String?,
        refreshHistory: Boolean = true,
    ): Boolean {
        ++chatListVersion // Invalidates an older REST list still in flight.
        val changed = _uiState.value.activeChatId != list.activeChatId
        hasLoadedChatList = true
        if (changed) {
            history.beginReplacement()
            streaming.resetActivity()
            drafts.selectChat(list.activeChatId)
            selectedChatId.value = list.activeChatId
        }
        _uiState.update {
            it.copy(
                chats = list.chats,
                activeChatId = list.activeChatId,
                isSwitchingChat = false,
                activeTools = if (changed) emptyMap() else it.activeTools,
                queuedCount = if (changed) 0 else it.queuedCount,
                settingsNotice = notice ?: it.settingsNotice,
                hasMoreHistory = if (changed) false else it.hasMoreHistory,
                hasMoreAfterHistory = if (changed) false else it.hasMoreAfterHistory,
                isLoadingOlderHistory = if (changed) false else it.isLoadingOlderHistory,
                oldestMessageId = if (changed) null else it.oldestMessageId,
                newestMessageId = if (changed) null else it.newestMessageId,
            )
        }
        if (changed && refreshHistory) history.refreshInBackground(list.activeChatId)
        return changed
    }

    fun switchChat(chatId: String) {
        Breadcrumbs.add("chat", "switch thread")
        if (chatId.takeUnless { it == "main" } == _uiState.value.activeChatId) return
        history.beginReplacement()
        _uiState.update { it.copy(isSwitchingChat = true) }
        val requestVersion = ++chatListVersion
        viewModelScope.launch {
            sessionRepository.activateChat(sessionId, chatId)
                .onSuccess { list -> if (requestVersion == chatListVersion) applyChatList(list, null) }
                .onFailure { e ->
                    if (requestVersion != chatListVersion) return@onFailure
                    _uiState.update { it.copy(isSwitchingChat = false, error = e.userMessage(appContext)) }
                }
        }
    }

    fun newChat() {
        history.beginReplacement()
        _uiState.update { it.copy(isSwitchingChat = true) }
        val requestVersion = ++chatListVersion
        viewModelScope.launch {
            sessionRepository.createChat(sessionId)
                .onSuccess { list -> if (requestVersion == chatListVersion) applyChatList(list, appContext.getString(R.string.chat_new_started)) }
                .onFailure { e ->
                    if (requestVersion != chatListVersion) return@onFailure
                    _uiState.update { it.copy(isSwitchingChat = false, error = e.userMessage(appContext)) }
                }
        }
    }

    fun deleteChat(chatId: String) {
        val requestVersion = ++chatListVersion
        viewModelScope.launch {
            sessionRepository.deleteChat(sessionId, chatId)
                .onSuccess { list -> if (requestVersion == chatListVersion) applyChatList(list, appContext.getString(R.string.chat_deleted_notice)) }
                .onFailure { e ->
                    if (requestVersion != chatListVersion) return@onFailure
                    _uiState.update { it.copy(error = e.userMessage(appContext)) }
                }
        }
    }

    // ========================================================================
    // History
    // ========================================================================

    fun loadHistory() {
        loadMessages()
    }

    fun loadOlderHistory() = history.loadOlderHistory()

    fun restoreLatestHistory() = history.restoreLatestHistory()

    // ========================================================================
    // Search and read position
    // ========================================================================

    fun setSearchOpen(open: Boolean) = search.setSearchOpen(open)

    fun onSearchQueryChange(query: String) = search.onSearchQueryChange(query)

    fun jumpToMessage(result: MessageSearchResult) = search.jumpToMessage(result)

    fun jumpToMessage(messageId: String, chatId: String? = null) =
        search.jumpToMessage(messageId, chatId)

    fun onViewportState(
        atBottom: Boolean,
        anchorMessageId: String?,
        anchorOffset: Int,
    ) = search.onViewportState(atBottom, anchorMessageId, anchorOffset)

    // ========================================================================
    // Sending
    // ========================================================================

    fun sendMessage(content: String) = send.sendMessage(content)

    fun setActiveFollowupMode(mode: ActiveFollowupMode) {
        _uiState.update { it.copy(activeFollowupMode = mode) }
    }

    fun retryOutbox(clientMessageId: String) = send.retryOutbox(clientMessageId)

    /** Drops a failed send for good — the only exit for a message the server will never take. */
    fun discardOutbox(clientMessageId: String) = send.discardOutbox(clientMessageId)

    /** Re-targets a send whose original chat is gone at the chat that is open now. */
    fun resendOutboxInActiveChat(clientMessageId: String) =
        send.resendOutboxInActiveChat(clientMessageId)

    fun cancelDelivery(clientMessageId: String) = send.cancelDelivery(clientMessageId)

    fun interrupt() {
        socketManager.interruptSession(sessionId)
        streaming.resetActivity()
    }

    // ========================================================================
    // Input, drafts & attachments
    // ========================================================================

    fun addAttachments(attachments: List<PendingFileAttachment>) = drafts.addAttachments(attachments)

    fun removeAttachment(index: Int) = drafts.removeAttachment(index)

    fun reportAttachmentFailure(failed: Int, total: Int) = drafts.reportAttachmentFailure(failed, total)

    suspend fun fetchAttachment(mediaId: String): Result<ByteArray> = runCatching {
        api.getSessionMedia(sessionId, mediaId)
    }

    /** Append a message as a Markdown quote to whatever is already typed. */
    fun quoteIntoDraft(content: String) = drafts.quoteIntoDraft(content)

    fun onInputChange(text: String) = drafts.onInputChange(text)

    /** Send the recorded clip for transcription and append the text. */
    fun transcribeAndAppend(audio: ByteArray) = drafts.transcribeAndAppend(audio)

    // ========================================================================
    // Title, notices, sharing
    // ========================================================================

    fun updateTitle(newTitle: String) {
        if (newTitle.isBlank()) return
        viewModelScope.launch {
            sessionRepository.updateSession(id = sessionId, name = newTitle)
                .onFailure { _uiState.update { it.copy(error = appContext.getString(R.string.chat_title_failed)) } }
            _uiState.update { it.copy(isEditingTitle = false) }
        }
    }

    fun setEditingTitle(editing: Boolean) {
        _uiState.update { it.copy(isEditingTitle = editing) }
    }

    fun toggleUsageBanner() {
        _uiState.update { it.copy(showUsageBanner = !it.showUsageBanner) }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    fun reportError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    fun clearNotice() {
        _uiState.update { it.copy(notice = null) }
    }

    /** Freeze this session's setup so the same start is one tap away next time. */
    fun saveAsTemplate(name: String) {
        val session = this.session.value ?: return
        viewModelScope.launch {
            runCatching {
                api.createSessionTemplate(
                    CreateSessionTemplateInput(
                        name = name,
                        // The wire format is lowercase with dashes; the enum
                        // names use underscores (AUTO_ACCEPT ↔ auto-accept).
                        cliProvider = session.cliProvider.name.lowercase(),
                        cliModel = session.cliModel,
                        cliReasoning = session.cliReasoning,
                        mode = session.mode.name.lowercase().replace('_', '-'),
                        workingDirectory = session.workingDirectory,
                        designStyleSkill = session.designStyleSkill,
                        writingStyleSkill = session.writingStyleSkill,
                    )
                )
            }.onSuccess {
                _uiState.update { it.copy(notice = appContext.getString(R.string.chat_template_saved, name)) }
            }.onFailure {
                _uiState.update { s -> s.copy(error = it.userMessage(appContext)) }
            }
        }
    }

    /**
     * Fetch the Markdown transcript and park it in state; the screen owns the
     * actual Intent because only it has a Context.
     */
    fun shareTranscript() {
        val id = session.value?.id ?: sessionId
        viewModelScope.launch {
            _uiState.update { it.copy(isExportingTranscript = true) }
            runCatching { api.exportSessionTranscript(id) }
                .onSuccess { markdown ->
                    _uiState.update {
                        it.copy(isExportingTranscript = false, pendingShareTranscript = markdown)
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isExportingTranscript = false,
                            error = error.userMessage(appContext),
                        )
                    }
                }
        }
    }

    fun consumePendingShare() {
        _uiState.update { it.copy(pendingShareTranscript = null) }
    }

    // ========================================================================
    // Turn diffs, mesh peers, voice
    // ========================================================================

    /** Working-tree changes recorded for the finished turns of this session. */
    private fun loadTurnDiffs() {
        viewModelScope.launch {
            val diffs = runCatching { api.getTurnDiffs(sessionId).data }.getOrNull().orEmpty()
            _uiState.update { it.copy(turnDiffs = diffs) }
        }
    }

    fun openTurnDiff(diffId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(openTurnDiff = null) }
            val detail = runCatching { api.getTurnDiff(diffId).data }.getOrNull()
            _uiState.update { it.copy(openTurnDiff = detail) }
        }
    }

    fun dismissTurnDiff() {
        _uiState.update { it.copy(openTurnDiff = null) }
    }

    /** Peer sessions this one can delegate to; empty when the mesh is unused. */
    private fun loadMeshPeers() {
        viewModelScope.launch {
            val peers = runCatching { api.getSessionPeers(sessionId).data }.getOrNull().orEmpty()
            _uiState.update { it.copy(meshPeers = peers) }
        }
    }

    /** Whether the server can transcribe; hides the mic button when it cannot. */
    private fun probeVoiceInput() {
        viewModelScope.launch {
            val available = runCatching {
                val payload = api.transcriptionAvailable().data
                (payload as? kotlinx.serialization.json.JsonObject)
                    ?.get("available")
                    ?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content == "true" }
                    ?: false
            }.getOrDefault(false)
            _uiState.update { it.copy(voiceAvailable = available) }
        }
    }

    // ========================================================================
    // Session settings
    // ========================================================================

    /**
     * Load the model list the active provider offers.
     *
     * The session carries only the chosen model, so the candidate list comes
     * from the CLI provider registry.
     */
    fun loadAvailableModels(providerOverride: CLIProvider? = null) {
        viewModelScope.launch {
            val provider = providerOverride ?: session.value?.cliProvider ?: return@launch
            settingsRepository.getCLIProviders()
                .onSuccess { configs ->
                    val offered = configs
                        .firstOrNull { it.id.equals(provider.name, ignoreCase = true) }
                        ?.models
                        .orEmpty()
                    // The session may run a model the registry no longer lists;
                    // without this it would be invisible and unselectable.
                    val current = session.value?.cliModel
                    val models = if (current.isNullOrBlank() || current in offered) {
                        offered
                    } else {
                        offered + current
                    }
                    _uiState.update { it.copy(availableModels = models) }
                }
                .onFailure { failure ->
                    _uiState.update {
                        it.copy(settingsNotice = appContext.getString(R.string.chat_models_unavailable, failure.userMessage(appContext)))
                    }
                }
        }
    }

    fun setModel(model: String?) {
        applySessionChange(appContext.getString(R.string.chat_model_updated)) { sessionRepository.setModel(sessionId, model) }
    }

    fun setReasoning(level: String?) {
        applySessionChange(appContext.getString(R.string.chat_reasoning_updated)) { sessionRepository.setReasoning(sessionId, level) }
    }

    fun switchProvider(provider: CLIProvider) {
        // The old list would offer models the new provider can't run; it
        // refills once the PATCH has come back.
        _uiState.update { it.copy(availableModels = emptyList()) }
        applySessionChange(
            appContext.getString(R.string.chat_provider_switched, provider.displayName),
            onApplied = { updated -> loadAvailableModels(updated.cliProvider) },
        ) {
            sessionRepository.switchProvider(sessionId, provider)
        }
    }

    /**
     * Mode is a live setting on the running process, so it goes over the socket
     * rather than through a REST write.
     */
    fun setMode(mode: SessionMode) {
        socketManager.setMode(sessionId, mode)
        _uiState.update { it.copy(sessionMode = mode, settingsNotice = appContext.getString(R.string.chat_mode_set, mode.localizedLabel(appContext))) }
    }

    fun loadAllowedDirectories() {
        viewModelScope.launch {
            _uiState.update { it.copy(directoriesLoading = true) }
            sessionRepository.getAllowedDirectories(sessionId)
                .onSuccess { directories ->
                    _uiState.update { it.copy(allowedDirectories = directories, directoriesLoading = false) }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(directoriesLoading = false, error = error.userMessage(appContext)) }
                }
        }
    }

    fun addAllowedDirectory(directory: String) {
        if (directory.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(directoriesLoading = true) }
            sessionRepository.addAllowedDirectory(sessionId, directory.trim())
                .onSuccess { directories ->
                    _uiState.update {
                        it.copy(
                            allowedDirectories = directories,
                            directoriesLoading = false,
                            settingsNotice = appContext.getString(R.string.chat_directory_allowed),
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(directoriesLoading = false, error = error.userMessage(appContext)) }
                }
        }
    }

    fun removeAllowedDirectory(directory: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(directoriesLoading = true) }
            sessionRepository.removeAllowedDirectory(sessionId, directory)
                .onSuccess { directories ->
                    _uiState.update {
                        it.copy(
                            allowedDirectories = directories,
                            directoriesLoading = false,
                            settingsNotice = appContext.getString(R.string.chat_directory_removed),
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(directoriesLoading = false, error = error.userMessage(appContext)) }
                }
        }
    }

    private fun applySessionChange(
        notice: String,
        onApplied: ((Session) -> Unit)? = null,
        block: suspend () -> Result<Session>,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isApplyingSettings = true) }
            block()
                .onSuccess { updated ->
                    onApplied?.invoke(updated)
                    _uiState.update {
                        it.copy(
                            isApplyingSettings = false,
                            // The backend reloads an active provider process as
                            // part of the setting write, preserving its context.
                            settingsNotice = if (updated.status == SessionStatus.RUNNING) {
                                appContext.getString(R.string.chat_session_reloaded, notice)
                            } else {
                                notice
                            },
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isApplyingSettings = false, error = error.userMessage(appContext))
                    }
                }
        }
    }

    fun clearSettingsNotice() {
        _uiState.update { it.copy(settingsNotice = null) }
    }

    // ========================================================================
    // Interactive prompts
    // ========================================================================

    /** Answer a hooks-based permission request over REST (the working path). */
    fun respondToPermission(action: PermissionAction) = permissions.respondToPermission(action)

    /** Answer a legacy (denials-based) permission request over the socket. */
    fun respondToLegacyPermission(approve: Boolean) = permissions.respondToLegacyPermission(approve)

    /** Answer an OpenCode question prompt; answers[i] holds question i's picks. */
    fun respondToQuestion(answers: List<List<String>>) = permissions.respondToQuestion(answers)

    fun dismissQuestion() = permissions.dismissQuestion()

    // ========================================================================
    // Lifecycle
    // ========================================================================

    override fun onCleared() {
        socket.stopPresence()
        send.cancelAll()
        LocalNotificationManager.setOpenSession(null)
        socket.unsubscribe()
        super.onCleared()
    }
}

/**
 * What the banner says when a request fails. Transport errors used to surface
 * as the raw exception text ("Failed to connect to /127.0.0.1:1"), which tells
 * the user nothing they can act on.
 */
internal fun Throwable.userMessage(context: Context? = null): String? =
    when (val error = toAppError()) {
        is AppError.Cancelled -> throw (error.cause as? CancellationException ?: CancellationException())
        else -> if (context != null) error.userMessage(context) else error.userMessage()
    }
