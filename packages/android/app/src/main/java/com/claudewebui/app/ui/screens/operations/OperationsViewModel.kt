package com.claudewebui.app.ui.screens.operations

import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.AppError
import com.claudewebui.app.core.network.toAppError
import com.claudewebui.app.ui.screens.screenErrorMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AdminStats
import com.claudewebui.app.data.model.AdminUser
import com.claudewebui.app.data.model.AuditLogEntry
import com.claudewebui.app.data.model.DockerContainer
import com.claudewebui.app.data.model.DockerStatus
import com.claudewebui.app.data.model.Watchdog
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class OperationsTab { CONTAINERS, WATCHDOGS, USERS, AUDIT }

data class OperationsUiState(
    val tab: OperationsTab = OperationsTab.CONTAINERS,
    val dockerStatus: DockerStatus? = null,
    val containers: List<DockerContainer> = emptyList(),
    val watchdogs: List<Watchdog> = emptyList(),
    val stats: AdminStats? = null,
    val users: List<AdminUser> = emptyList(),
    val audit: List<AuditLogEntry> = emptyList(),
    val isLoading: Boolean = true,
    /**
     * Admin-only sections answer 403 for a normal user. That is a legitimate
     * state, not a failure, so it is tracked separately from [error].
     */
    val adminDenied: Boolean = false,
    val error: String? = null,
)

/**
 * Container, watchdog, user and audit overview.
 *
 * Sections load in parallel and each one degrades on its own: a Docker socket
 * that is down must not blank out the audit log.
 */
class OperationsViewModel(private val api: ApiClient) : ViewModel() {

    private val _uiState = MutableStateFlow(OperationsUiState())
    val uiState: StateFlow<OperationsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        load()
    }

    fun selectTab(tab: OperationsTab) {
        _uiState.update { it.copy(tab = tab) }
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            var denied = false
            var failureMessage: String? = null
            fun recordFailure(failure: Throwable) {
                val error = failure.toAppError()
                if (error is AppError.Server && error.status == 403) {
                    denied = true
                } else if (failureMessage == null) {
                    failureMessage = failure.screenErrorMessage("operations", "load")
                }
            }
            coroutineScope {
                val status = async { apiCall { api.getDockerStatus().data }.onFailure(::recordFailure).getOrNull() }
                val containers =
                    async { apiCall { api.getDockerContainers().data }.onFailure(::recordFailure).getOrNull() }
                val watchdogs = async {
                    apiCall { api.getWatchdogs().data }
                        .onFailure(::recordFailure)
                        .getOrNull()
                }
                val stats = async {
                    apiCall { api.getAdminStats().data }
                        .onFailure(::recordFailure)
                        .getOrNull()
                }
                val users = async { apiCall { api.getAdminUsers().data }.onFailure(::recordFailure).getOrNull() }
                val audit = async { apiCall { api.getAuditLog(60).data }.onFailure(::recordFailure).getOrNull() }

                val resolvedStatus = status.await()
                val resolvedContainers = containers.await().orEmpty()
                val resolvedWatchdogs = watchdogs.await().orEmpty()
                val resolvedStats = stats.await()
                val resolvedUsers = users.await().orEmpty()
                val resolvedAudit = audit.await()?.entries.orEmpty()

                _uiState.update {
                    it.copy(
                        dockerStatus = resolvedStatus,
                        containers = resolvedContainers.sortedWith(
                            compareByDescending<DockerContainer> { c -> c.isRunning }
                                .thenBy { c -> c.name.lowercase() },
                        ),
                        watchdogs = resolvedWatchdogs,
                        stats = resolvedStats,
                        users = resolvedUsers,
                        audit = resolvedAudit,
                        isLoading = false,
                        adminDenied = denied && resolvedStats == null,
                        error = failureMessage,
                    )
                }
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
