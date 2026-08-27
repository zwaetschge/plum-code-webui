package com.claudewebui.app.ui.screens.dashboard

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AppNotification
import com.claudewebui.app.data.model.BulkSessionInput
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionResponse
import com.claudewebui.app.data.model.CreateSessionTemplateInput
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CreateCategoryInput
import com.claudewebui.app.data.model.CreateSessionInput
import com.claudewebui.app.core.diagnostics.CrashReporter
import com.claudewebui.app.data.model.CrashReportInput
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.data.model.UpdateCategoryInput
import com.claudewebui.app.data.model.UpdateSessionInput
import com.claudewebui.app.core.shortcuts.SessionShortcuts
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.data.repository.SessionLaunchPreferences
import com.claudewebui.app.data.repository.SessionLaunchSetup
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class DashboardViewModel(
    private val apiClient: ApiClient,
    private val sessionRepository: SessionRepository,
    context: Context,
) : ViewModel() {

    private val launchPreferences = SessionLaunchPreferences(context)
    private val appContext = context.applicationContext
    private var lastShortcutSignature: String? = null

    // ── State ─────────────────────────────────────────────────────────────────

    private val _uiState = MutableStateFlow(DashboardUiState(isLoading = true))
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    private val _events = Channel<DashboardEvent>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    // Raw (unfiltered) session cache — search/filter/sort operate on this.
    private val _allSessions = MutableStateFlow<List<Session>>(emptyList())

    private var searchJob: Job? = null

    // ── Init ──────────────────────────────────────────────────────────────────

    init {
        // SharedPreferences pages its file in on first read; doing that in the
        // constructor stalled the first dashboard frame on cold start.
        viewModelScope.launch(Dispatchers.IO) {
            val setup = launchPreferences.load()
            _uiState.update { it.copy(lastSessionSetup = setup) }
        }
        observeCachedSessions()
        loadData()
        loadTemplates()
        loadNotifications()
        uploadPendingCrashReport()
    }

    /**
     * Sends the trace from a previous crash, once. This runs here rather than in
     * the crash handler itself because that handler executes in a dying process
     * where an HTTP request would be cut off. Failure is silent and the file is
     * kept, so the next start tries again.
     */
    private fun uploadPendingCrashReport() {
        viewModelScope.launch(Dispatchers.IO) {
            val trace = CrashReporter.pendingReport(appContext) ?: return@launch
            val sent = runCatching {
                apiClient.reportCrash(
                    CrashReportInput(
                        appVersion = runCatching {
                            appContext.packageManager
                                .getPackageInfo(appContext.packageName, 0)
                                .versionName
                        }.getOrNull(),
                        osVersion = CrashReporter.osDescription(),
                        device = CrashReporter.deviceDescription(),
                        stackTrace = trace,
                    )
                ).success
            }.getOrDefault(false)
            if (sent) CrashReporter.clearPendingReport(appContext)
        }
    }

    // ── Notification centre ─────────────────────────────────────────────────

    fun loadNotifications() {
        viewModelScope.launch {
            val feed = runCatching { apiClient.getNotifications().data }.getOrNull() ?: return@launch
            _uiState.update {
                it.copy(notifications = feed.items, unreadNotifications = feed.unreadCount)
            }
        }
    }

    fun markNotificationsRead(ids: List<String> = emptyList()) {
        viewModelScope.launch {
            runCatching { apiClient.markNotificationsRead(ids) }
            loadNotifications()
        }
    }

    fun clearNotifications() {
        viewModelScope.launch {
            runCatching { apiClient.clearNotifications() }
            loadNotifications()
        }
    }

    /**
     * Answer an approval straight from the feed. The agent is blocked while it
     * waits, so opening the session first costs time exactly when it matters.
     */
    fun respondToApproval(notification: AppNotification, allow: Boolean) {
        val sessionId = notification.sessionId ?: return
        val requestId = notification.data?.requestId ?: return
        viewModelScope.launch {
            runCatching {
                apiClient.respondToPermission(
                    PermissionResponse(
                        sessionId = sessionId,
                        requestId = requestId,
                        action = if (allow) PermissionAction.ALLOW_ONCE else PermissionAction.DENY,
                    )
                )
            }.onFailure {
                _uiState.update { state -> state.copy(error = it.message ?: "Approval failed") }
            }
            runCatching { apiClient.markNotificationsRead(listOf(notification.id)) }
            loadNotifications()
        }
    }

    // ── Discovered projects ─────────────────────────────────────────────────
    // Checkouts the server found on disk. Opening one creates a session bound to
    // that directory, so a phone can start work in an existing repo.

    fun toggleDiscoveredProjects() {
        val next = !_uiState.value.showDiscoveredProjects
        _uiState.update { it.copy(showDiscoveredProjects = next) }
        if (next && _uiState.value.discoveredProjects.isEmpty()) loadDiscoveredProjects()
    }

    fun loadDiscoveredProjects() {
        viewModelScope.launch {
            val projects = runCatching { apiClient.getDiscoveredProjects().data }
                .getOrNull().orEmpty()
            _uiState.update { it.copy(discoveredProjects = projects) }
        }
    }

    // ── Templates ───────────────────────────────────────────────────────────

    private fun loadTemplates() {
        viewModelScope.launch {
            val templates = runCatching { apiClient.getSessionTemplates().data }
                .getOrNull().orEmpty()
            _uiState.update { it.copy(sessionTemplates = templates) }
        }
    }

    /** Save the current new-session setup so it can be reused with one tap. */
    fun saveTemplate(input: CreateSessionTemplateInput) {
        viewModelScope.launch {
            runCatching { apiClient.createSessionTemplate(input) }
            loadTemplates()
        }
    }

    fun deleteTemplate(id: String) {
        viewModelScope.launch {
            runCatching { apiClient.deleteSessionTemplate(id) }
            loadTemplates()
        }
    }

    // ── Archive and bulk actions ────────────────────────────────────────────

    fun toggleArchiveView() {
        _uiState.update { it.copy(showArchived = !it.showArchived, selectedSessionIds = emptySet()) }
        loadData()
    }

    fun toggleSessionSelection(id: String) {
        _uiState.update { state ->
            val next = state.selectedSessionIds.toMutableSet()
            if (!next.add(id)) next.remove(id)
            state.copy(selectedSessionIds = next)
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selectedSessionIds = emptySet()) }
    }

    /** Apply one action to every selected session, then refresh the list. */
    fun bulkAction(action: String, categoryId: String? = null) {
        val ids = _uiState.value.selectedSessionIds.toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            runCatching { apiClient.bulkSessions(BulkSessionInput(ids, action, categoryId)) }
            _uiState.update { it.copy(selectedSessionIds = emptySet()) }
            loadData()
        }
    }

    private fun observeCachedSessions() {
        sessionRepository.sessions
            .onEach { sessions ->
                _allSessions.value = sessions
                // Published here rather than from a screen: the phone and the
                // tablet render different dashboards, and the launcher menu
                // must not depend on which one happens to be on screen. The
                // publish is a binder IPC, so it runs off the main thread and
                // only when the shortcut-relevant slice actually changed.
                val signature = sessions
                    .sortedByDescending { it.updatedAt }
                    .take(5)
                    .joinToString("|") { "${it.id}:${it.name}" }
                if (signature != lastShortcutSignature) {
                    lastShortcutSignature = signature
                    viewModelScope.launch(Dispatchers.IO) {
                        SessionShortcuts.publish(appContext, sessions)
                    }
                }
                _uiState.update { state ->
                    state.copy(
                        sessions = sessions,
                        filteredSessions = applyFilters(
                            sessions = sessions,
                            query = state.searchQuery,
                            categoryId = state.selectedCategoryId,
                            sortOrder = state.sortOrder,
                        ),
                    )
                }
            }
            .launchIn(viewModelScope)
    }

    // ── Data Loading ──────────────────────────────────────────────────────────

    fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            loadSessions()
            loadCategories()
            loadCLIProviders()
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            loadSessions()
            loadCategories()
            loadCLIProviders()
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    private suspend fun loadSessions() {
        sessionRepository.getSessions()
            .onSuccess {
                _uiState.update { state -> state.copy(isOffline = false, error = null) }
            }
            .onFailure { error ->
                val isNetwork = error is java.net.UnknownHostException ||
                        error is java.net.SocketTimeoutException ||
                        error is java.io.IOException
                _uiState.update { state ->
                    state.copy(
                        isOffline = isNetwork,
                        error = if (!isNetwork) error.message else null,
                    )
                }
            }
    }

    private suspend fun loadCategories() {
        runCatching { apiClient.getCategories() }
            .onSuccess { response ->
                _uiState.update { it.copy(categories = response.data ?: emptyList()) }
            }
            .onFailure { /* categories are non-critical */ }
    }

    private suspend fun loadCLIProviders() {
        runCatching { apiClient.getCLIProviders() }
            .onSuccess { response ->
                val providers = response.data
                    .orEmpty()
                    .filter { it.enabled }
                    .mapNotNull { CLIProvider.fromId(it.id) }
                if (providers.isNotEmpty()) {
                    _uiState.update { it.copy(availableProviders = providers) }
                }
            }
            .onFailure { /* retain the complete local fallback registry */ }
    }

    // ── Filtering & Sorting ───────────────────────────────────────────────────

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query, messageSearchError = null) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(200)
            if (_uiState.value.searchScope == DashboardSearchScope.MESSAGES) {
                searchMessages(query)
            } else {
                applyCurrentFilters()
            }
        }
    }

    fun setSearchScope(scope: DashboardSearchScope) {
        searchJob?.cancel()
        _uiState.update {
            it.copy(
                searchScope = scope,
                messageSearchResults = if (scope == DashboardSearchScope.MESSAGES) {
                    it.messageSearchResults
                } else emptyList(),
                messageSearchError = null,
            )
        }
        if (scope == DashboardSearchScope.MESSAGES) {
            viewModelScope.launch { searchMessages(_uiState.value.searchQuery) }
        } else applyCurrentFilters()
    }

    private suspend fun searchMessages(query: String) {
        if (query.trim().length < 2) {
            _uiState.update { it.copy(messageSearchResults = emptyList(), isSearchingMessages = false) }
            return
        }
        _uiState.update { it.copy(isSearchingMessages = true) }
        runCatching { apiClient.searchMessages(query.trim()) }
            .onSuccess { response ->
                _uiState.update {
                    it.copy(
                        isSearchingMessages = false,
                        messageSearchResults = response.data.orEmpty(),
                        messageSearchError = response.error?.message,
                    )
                }
            }
            .onFailure { error ->
                _uiState.update {
                    it.copy(isSearchingMessages = false, messageSearchError = error.message)
                }
            }
    }

    fun toggleSearch() {
        _uiState.update { state ->
            val expanded = !state.isSearchExpanded
            if (!expanded) {
                val filtered = applyFilters(
                    sessions = _allSessions.value,
                    query = "",
                    categoryId = state.selectedCategoryId,
                    sortOrder = state.sortOrder,
                )
                state.copy(isSearchExpanded = expanded, searchQuery = "", filteredSessions = filtered)
            } else {
                state.copy(isSearchExpanded = expanded)
            }
        }
    }

    fun filterByCategory(categoryId: String?) {
        _uiState.update { state ->
            val filtered = applyFilters(
                sessions = _allSessions.value,
                query = state.searchQuery,
                categoryId = categoryId,
                sortOrder = state.sortOrder,
            )
            state.copy(selectedCategoryId = categoryId, filteredSessions = filtered)
        }
    }

    fun updateSort(order: SortOrder) {
        _uiState.update { state ->
            val filtered = applyFilters(
                sessions = _allSessions.value,
                query = state.searchQuery,
                categoryId = state.selectedCategoryId,
                sortOrder = order,
            )
            state.copy(sortOrder = order, filteredSessions = filtered)
        }
    }

    private fun applyCurrentFilters() {
        val state = _uiState.value
        val filtered = applyFilters(
            sessions = _allSessions.value,
            query = state.searchQuery,
            categoryId = state.selectedCategoryId,
            sortOrder = state.sortOrder,
        )
        _uiState.update { it.copy(filteredSessions = filtered) }
    }

    private fun applyFilters(
        sessions: List<Session>,
        query: String,
        categoryId: String?,
        sortOrder: SortOrder,
    ): List<Session> {
        return filterDashboardSessions(sessions, query, categoryId, sortOrder)
    }

    // ── Session CRUD ──────────────────────────────────────────────────────────

    fun createSession(
        name: String,
        workingDirectory: String?,
        provider: CLIProvider,
        mode: SessionMode? = null,
        categoryId: String? = null,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isCreatingSession = true, creationError = null) }
            runCatching {
                val response = apiClient.createSession(
                    CreateSessionInput(
                        name = name.ifBlank { "Session ${System.currentTimeMillis() % 10000}" },
                        workingDirectory = workingDirectory,
                        cliProvider = provider,
                        mode = mode,
                    )
                )
                // A {success:false} body is a failure, not "no session".
                if (!response.success || response.data == null) {
                    error(response.error?.message ?: "Server rejected the session")
                }
                if (categoryId != null) {
                    runCatching { apiClient.updateSessionCategory(response.data.id, categoryId) }
                }
                response
            }.onSuccess { response ->
                response.data?.let { session ->
                    val cached = session.copy(category = categoryId ?: session.category)
                    sessionRepository.cacheSession(cached)
                    val setup = SessionLaunchSetup(provider, mode ?: SessionMode.AUTO_ACCEPT, workingDirectory, categoryId)
                    launchPreferences.save(setup)
                    _uiState.update {
                        it.copy(
                            isCreatingSession = false,
                            creationError = null,
                            lastSessionSetup = setup,
                        )
                    }
                    _events.send(DashboardEvent.SessionCreated(cached))
                    _events.send(DashboardEvent.NavigateToChat(cached.id))
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(
                        isCreatingSession = false,
                        creationError = error.message ?: "Session creation failed",
                    )
                }
                _events.send(DashboardEvent.ShowError("Failed to create session: ${error.message}"))
            }
        }
    }

    fun clearCreationError() {
        _uiState.update { it.copy(creationError = null) }
    }

    fun deleteSession(id: String) {
        viewModelScope.launch {
            sessionRepository.deleteSession(id)
                .onSuccess {
                    _events.send(DashboardEvent.SessionDeleted(id))
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to delete: ${error.message}"))
                }
        }
    }

    fun renameSession(id: String, newName: String) {
        viewModelScope.launch {
            sessionRepository.updateSession(id = id, name = newName)
                .onSuccess { }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to rename: ${error.message}"))
                }
        }
    }

    fun moveSessionToCategory(sessionId: String, categoryId: String?) {
        viewModelScope.launch {
            sessionRepository.updateCategory(sessionId, categoryId)
                .onSuccess { }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to move: ${error.message}"))
                }
        }
    }

    fun toggleStar(id: String) {
        viewModelScope.launch {
            sessionRepository.starSession(id)
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to update favorite: ${error.message}"))
                }
        }
    }

    // ── Category CRUD ─────────────────────────────────────────────────────────

    fun createCategory(name: String, color: String) {
        viewModelScope.launch {
            runCatching { apiClient.createCategory(CreateCategoryInput(name = name, color = color)) }
                .onSuccess { response ->
                    response.data?.let { cat ->
                        _uiState.update { it.copy(categories = it.categories + cat) }
                    }
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to create category: ${error.message}"))
                }
        }
    }

    fun updateCategory(id: String, name: String, color: String) {
        viewModelScope.launch {
            runCatching {
                apiClient.updateCategory(id, UpdateCategoryInput(name = name, color = color))
            }.onSuccess { response ->
                response.data?.let { updated ->
                    _uiState.update { state ->
                        state.copy(categories = state.categories.map { if (it.id == id) updated else it })
                    }
                }
            }.onFailure { error ->
                _events.send(DashboardEvent.ShowError("Failed to update category: ${error.message}"))
            }
        }
    }

    fun deleteCategory(id: String) {
        viewModelScope.launch {
            runCatching { apiClient.deleteCategory(id) }
                .onSuccess {
                    _uiState.update { state ->
                        val newCats = state.categories.filter { it.id != id }
                        val newSelected = if (state.selectedCategoryId == id) null else state.selectedCategoryId
                        state.copy(categories = newCats, selectedCategoryId = newSelected)
                    }
                    applyCurrentFilters()
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to delete category: ${error.message}"))
                }
        }
    }

    fun reorderCategories(categories: List<Category>) {
        _uiState.update { it.copy(categories = categories) }
        viewModelScope.launch {
            categories.forEachIndexed { index, cat ->
                runCatching {
                    apiClient.updateCategory(cat.id, UpdateCategoryInput(sortOrder = index))
                }
            }
        }
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    fun onSessionTapped(sessionId: String) {
        viewModelScope.launch { _events.send(DashboardEvent.NavigateToChat(sessionId)) }
    }

    fun onMessageResultTapped(result: com.claudewebui.app.data.model.MessageSearchResult) {
        viewModelScope.launch {
            _events.send(
                DashboardEvent.NavigateToMessage(
                    result.jump?.sessionId ?: result.sessionId,
                    result.jump?.messageId ?: result.id,
                    result.jump?.chatId,
                )
            )
        }
    }

    fun onNewSessionFabTapped() {
        viewModelScope.launch { _events.send(DashboardEvent.ShowNewSessionDialog) }
    }

    fun onCategoryManagerTapped() {
        viewModelScope.launch { _events.send(DashboardEvent.ShowCategoryManager) }
    }

    fun onSettingsTapped() {
        viewModelScope.launch { _events.send(DashboardEvent.NavigateToSettings) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /** Called by the Socket.IO listener when a session event arrives. */
    fun onSocketSessionEvent() {
        viewModelScope.launch { loadSessions() }
    }
}

internal fun filterDashboardSessions(
    sessions: List<Session>,
    query: String,
    categoryId: String?,
    sortOrder: SortOrder,
): List<Session> {
    var result = sessions
    if (categoryId != null) result = result.filter { it.category == categoryId }

    if (query.isNotBlank()) {
        val lower = query.trim().lowercase()
        result = result.filter { session ->
            session.name.lowercase().contains(lower) ||
                session.lastMessage?.lowercase()?.contains(lower) == true ||
                session.workingDirectory.lowercase().contains(lower) ||
                session.cliProvider.displayName.lowercase().contains(lower) ||
                session.cliProvider.name.lowercase().contains(lower) ||
                session.cliModel?.lowercase()?.contains(lower) == true
        }
    }

    return when (sortOrder) {
        SortOrder.RECENT -> result.sortedByDescending { it.updatedAt }
        SortOrder.NAME -> result.sortedBy { it.name.lowercase() }
        SortOrder.STATUS -> result.sortedWith(
            compareByDescending<Session> {
                it.status == com.claudewebui.app.data.model.SessionStatus.RUNNING
            }.thenByDescending { it.updatedAt }
        )
        SortOrder.PROVIDER -> result.sortedWith(
            compareBy<Session> { it.cliProvider.name }.thenByDescending { it.updatedAt }
        )
    }
}
