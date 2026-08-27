package com.claudewebui.app.ui.screens.dashboard

import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.MessageSearchResult
import com.claudewebui.app.data.repository.SessionLaunchSetup
import com.claudewebui.app.data.repository.SessionPreset
import com.claudewebui.app.data.repository.DEFAULT_SESSION_PRESETS

enum class DashboardSearchScope { SESSIONS, MESSAGES }

// ── Sort Order ────────────────────────────────────────────────────────────────

enum class SortOrder(val label: String) {
    RECENT("Recent"),
    NAME("Name"),
    STATUS("Status"),
    PROVIDER("Provider"),
}

// ── UI State ──────────────────────────────────────────────────────────────────

data class DashboardUiState(
    /** Saved session templates offered in the new-session sheet. */
    val sessionTemplates: List<com.claudewebui.app.data.model.SessionTemplate> = emptyList(),
    /** Viewing the archive instead of the active sessions. */
    val showArchived: Boolean = false,
    /** Ids selected for a bulk action; empty means selection mode is off. */
    val selectedSessionIds: Set<String> = emptySet(),
    /** Durable cross-session notification feed. */
    val notifications: List<com.claudewebui.app.data.model.AppNotification> = emptyList(),
    val unreadNotifications: Int = 0,
    /** Checkouts on disk that have no session yet — the WebUI's Discovered Projects. */
    val discoveredProjects: List<com.claudewebui.app.data.model.DiscoveredProject> = emptyList(),
    val showDiscoveredProjects: Boolean = false,
    val sessions: List<Session> = emptyList(),
    val filteredSessions: List<Session> = emptyList(),
    val categories: List<Category> = emptyList(),
    val availableProviders: List<CLIProvider> = CLIProvider.active,
    val selectedCategoryId: String? = null,   // null = "All"
    val searchQuery: String = "",
    val sortOrder: SortOrder = SortOrder.RECENT,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val isOffline: Boolean = false,
    val isSearchExpanded: Boolean = false,
    val searchScope: DashboardSearchScope = DashboardSearchScope.SESSIONS,
    val messageSearchResults: List<MessageSearchResult> = emptyList(),
    val isSearchingMessages: Boolean = false,
    val messageSearchError: String? = null,
    val isCreatingSession: Boolean = false,
    val creationError: String? = null,
    val sessionPresets: List<SessionPreset> = DEFAULT_SESSION_PRESETS,
    val lastSessionSetup: SessionLaunchSetup = SessionLaunchSetup(),
) {
    /** True when initial load is in progress (no data yet). */
    val isInitialLoading: Boolean
        get() = isLoading && sessions.isEmpty()
}

// ── One-shot Events ───────────────────────────────────────────────────────────

sealed class DashboardEvent {
    data class NavigateToChat(val sessionId: String) : DashboardEvent()
    data class NavigateToMessage(
        val sessionId: String,
        val messageId: String,
        val chatId: String? = null,
    ) : DashboardEvent()
    data class ShowError(val message: String) : DashboardEvent()
    data class SessionCreated(val session: Session) : DashboardEvent()
    data class SessionDeleted(val sessionId: String) : DashboardEvent()
    object ShowNewSessionDialog : DashboardEvent()
    object ShowCategoryManager : DashboardEvent()
    object NavigateToSettings : DashboardEvent()
}
