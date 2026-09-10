package com.claudewebui.app.ui.screens.dashboard

import com.claudewebui.app.core.network.toAppError
import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AppNotification
import com.claudewebui.app.data.model.BulkSessionInput
import com.claudewebui.app.data.model.PendingPermissionItem
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
import com.claudewebui.app.data.repository.GatewayRepository
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
    private val gatewayRepository: GatewayRepository,
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
        observeGateway()
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
            val sent = apiCall {
                apiClient.reportCrash(
                    CrashReportInput(
                        appVersion = apiCall {
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

    // ── Cross-session supervision ───────────────────────────────────────────

    /**
     * The gateway overview is the only view that spans sessions: it knows which
     * ones are blocked on a human and which errored. Mirroring it into UI state
     * keeps the dashboard hero honest instead of guessing from row status.
     */
    private fun observeGateway() {
        gatewayRepository.pendingApprovals
            .onEach { approvals -> _uiState.update { it.copy(pendingApprovals = approvals) } }
            .launchIn(viewModelScope)
        gatewayRepository.needsAttention
            .onEach { ids -> _uiState.update { it.copy(needsAttention = ids) } }
            .launchIn(viewModelScope)
    }

    fun setApprovalsVisible(visible: Boolean) {
        _uiState.update { it.copy(showApprovals = visible) }
        if (visible) viewModelScope.launch { refreshOverview() }
    }

    private suspend fun refreshOverview() {
        // Not fatal — the session list still renders. Reported anyway, because
        // a silently empty approvals sheet looks like "nothing is waiting".
        gatewayRepository.refresh(_uiState.value.showArchived)
            .onFailure { reportBackground(it, "Could not load pending approvals") }
    }

    /**
     * Answer an approval from the dashboard sheet. The optimistic removal only
     * happens after the server confirms, so a failed call leaves the request
     * visible instead of hiding an agent that is still blocked.
     */
    fun respondToPendingApproval(item: PendingPermissionItem, allow: Boolean) {
        if (item.requestId.isBlank()) return
        _uiState.update { it.copy(respondingApprovals = it.respondingApprovals + item.requestId) }
        viewModelScope.launch {
            apiCall {
                apiClient.respondToPermission(
                    PermissionResponse(
                        sessionId = item.sessionId,
                        requestId = item.requestId,
                        action = if (allow) PermissionAction.ALLOW_ONCE else PermissionAction.DENY,
                    )
                )
            }.onSuccess {
                gatewayRepository.forgetApproval(item.requestId)
            }.onFailure { error ->
                _uiState.update { it.copy(error = error.screenErrorMessage("dashboard", "respondToPendingApproval", appContext)) }
            }
            _uiState.update {
                it.copy(respondingApprovals = it.respondingApprovals - item.requestId)
            }
            refreshOverview()
        }
    }

    // ── Notification centre ─────────────────────────────────────────────────

    fun loadNotifications() {
        viewModelScope.launch {
            apiCall { apiClient.getNotifications().data }
                .onSuccess { feed ->
                    if (feed == null) return@onSuccess
                    _uiState.update {
                        it.copy(notifications = feed.items, unreadNotifications = feed.unreadCount)
                    }
                }
                .onFailure { reportBackground(it, "Could not load notifications") }
        }
    }

    fun markNotificationsRead(ids: List<String> = emptyList()) {
        viewModelScope.launch {
            apiCall { apiClient.markNotificationsRead(ids) }
                .onFailure { reportBackground(it, "Could not mark notifications read") }
            loadNotifications()
        }
    }

    fun clearNotifications() {
        viewModelScope.launch {
            apiCall { apiClient.clearNotifications() }
                .onFailure { reportBackground(it, "Could not clear notifications") }
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
            apiCall {
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
            apiCall { apiClient.markNotificationsRead(listOf(notification.id)) }
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
            apiCall { apiClient.getDiscoveredProjects().data }
                .onSuccess { projects ->
                    _uiState.update { it.copy(discoveredProjects = projects.orEmpty()) }
                }
                .onFailure { reportBackground(it, "Could not load discovered projects") }
        }
    }

    // ── Templates ───────────────────────────────────────────────────────────

    private fun loadTemplates() {
        viewModelScope.launch {
            apiCall { apiClient.getSessionTemplates().data }
                .onSuccess { templates ->
                    _uiState.update { it.copy(sessionTemplates = templates.orEmpty()) }
                }
                .onFailure { reportBackground(it, "Could not load templates") }
        }
    }

    /** Save the current new-session setup so it can be reused with one tap. */
    fun saveTemplate(input: CreateSessionTemplateInput) {
        viewModelScope.launch {
            apiCall { apiClient.createSessionTemplate(input) }
                .onFailure { reportBackground(it, "Could not save template") }
            loadTemplates()
        }
    }

    fun deleteTemplate(id: String) {
        viewModelScope.launch {
            apiCall { apiClient.deleteSessionTemplate(id) }
                .onFailure { reportBackground(it, "Could not delete template") }
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
            apiCall { apiClient.bulkSessions(BulkSessionInput(ids, action, categoryId)) }
                .onFailure { reportBackground(it, "Bulk action failed") }
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
            refreshOverview()
            loadCategories()
            loadCLIProviders()
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            loadSessions()
            refreshOverview()
            loadCategories()
            loadCLIProviders()
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    private suspend fun loadSessions() {
        sessionRepository.getSessions()
            .onSuccess {
                _uiState.update { state ->
                    state.copy(
                        isOffline = false,
                        error = null,
                        lastRefreshedAt = System.currentTimeMillis(),
                    )
                }
            }
            .onFailure { error ->
                val isNetwork = error.toAppError() is com.claudewebui.app.core.network.AppError.Network
                _uiState.update { state ->
                    state.copy(
                        isOffline = isNetwork,
                        error = if (!isNetwork) error.screenErrorMessage("dashboard", "loadSessions", appContext) else null,
                    )
                }
            }
    }

    private suspend fun loadCategories() {
        apiCall { apiClient.getCategories() }
            .onSuccess { response ->
                _uiState.update { it.copy(categories = response.data ?: emptyList()) }
            }
            .onFailure { /* categories are non-critical */ }
    }

    private suspend fun loadCLIProviders() {
        apiCall { apiClient.getCLIProviders() }
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
        apiCall { apiClient.searchMessages(query.trim()) }
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
                    it.copy(isSearchingMessages = false, messageSearchError = error.screenErrorMessage("dashboard", "searchMessages", appContext))
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
            )
            state.copy(selectedCategoryId = categoryId, filteredSessions = filtered)
        }
    }

    private fun applyCurrentFilters() {
        val state = _uiState.value
        val filtered = applyFilters(
            sessions = _allSessions.value,
            query = state.searchQuery,
            categoryId = state.selectedCategoryId,
        )
        _uiState.update { it.copy(filteredSessions = filtered) }
    }

    private fun applyFilters(
        sessions: List<Session>,
        query: String,
        categoryId: String?,
    ): List<Session> {
        return filterDashboardSessions(sessions, query, categoryId)
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
            apiCall {
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
                    apiCall { apiClient.updateSessionCategory(response.data.id, categoryId) }
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
                        creationError = error.screenErrorMessage("dashboard", "createSession", appContext),
                    )
                }
                _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "createSession", appContext)))
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
                    _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "deleteSession", appContext)))
                }
        }
    }

    fun renameSession(id: String, newName: String) {
        viewModelScope.launch {
            sessionRepository.updateSession(id = id, name = newName)
                .onSuccess { }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "renameSession", appContext)))
                }
        }
    }

    fun moveSessionToCategory(sessionId: String, categoryId: String?) {
        viewModelScope.launch {
            sessionRepository.updateCategory(sessionId, categoryId)
                .onSuccess { }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "moveSessionToCategory", appContext)))
                }
        }
    }

    fun toggleStar(id: String) {
        viewModelScope.launch {
            sessionRepository.starSession(id)
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "toggleStar", appContext)))
                }
        }
    }

    // ── Category CRUD ─────────────────────────────────────────────────────────

    fun createCategory(name: String, color: String) {
        viewModelScope.launch {
            apiCall { apiClient.createCategory(CreateCategoryInput(name = name, color = color)) }
                .onSuccess { response ->
                    response.data?.let { cat ->
                        _uiState.update { it.copy(categories = it.categories + cat) }
                    }
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "createCategory", appContext)))
                }
        }
    }

    fun updateCategory(id: String, name: String, color: String) {
        viewModelScope.launch {
            apiCall {
                apiClient.updateCategory(id, UpdateCategoryInput(name = name, color = color))
            }.onSuccess { response ->
                response.data?.let { updated ->
                    _uiState.update { state ->
                        state.copy(categories = state.categories.map { if (it.id == id) updated else it })
                    }
                }
            }.onFailure { error ->
                _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "updateCategory", appContext)))
            }
        }
    }

    fun deleteCategory(id: String) {
        viewModelScope.launch {
            apiCall { apiClient.deleteCategory(id) }
                .onSuccess {
                    _uiState.update { state ->
                        val newCats = state.categories.filter { it.id != id }
                        val newSelected = if (state.selectedCategoryId == id) null else state.selectedCategoryId
                        state.copy(categories = newCats, selectedCategoryId = newSelected)
                    }
                    applyCurrentFilters()
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError(error.screenErrorMessage("dashboard", "deleteCategory", appContext)))
                }
        }
    }

    fun reorderCategories(categories: List<Category>) {
        _uiState.update { it.copy(categories = categories) }
        viewModelScope.launch {
            categories.forEachIndexed { index, cat ->
                apiCall {
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
        viewModelScope.launch {
            loadSessions()
            refreshOverview()
        }
    }

    /**
     * Report a failure from a non-blocking background load.
     *
     * These used to be dropped on the floor, which made a logged-out phone look
     * like an account with no templates and no notifications. Connectivity
     * failures stay silent — the offline banner already says that, and every
     * background load would repeat it. An existing error is never overwritten:
     * the first failure is usually the cause of the rest.
     */
    private fun reportBackground(error: Throwable, fallback: String) {
        if (error.isConnectivityFailure()) return
        _uiState.update { state ->
            if (state.error != null) state else state.copy(error = error.screenErrorMessage("dashboard", "reportBackground", appContext) ?: fallback)
        }
    }

    private fun Throwable.isConnectivityFailure(): Boolean =
        toAppError() is com.claudewebui.app.core.network.AppError.Network || _uiState.value.isOffline
}

/**
 * Narrow the session list to what the dashboard should show.
 *
 * Ordering is deliberately no longer a parameter: the dashboard groups by what
 * each session needs (see `superviseSessions`), and a second, competing sort
 * order — whose picker was never wired to anything — could only fight it.
 */
internal fun filterDashboardSessions(
    sessions: List<Session>,
    query: String,
    categoryId: String?,
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

    // Most recently touched first; the grouping downstream decides the rest.
    return result.sortedByDescending { it.updatedAt }
}
