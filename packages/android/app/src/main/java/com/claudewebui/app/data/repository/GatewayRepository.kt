package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.local.dao.SessionDao
import com.claudewebui.app.data.model.GatewayOverview
import com.claudewebui.app.data.model.PendingPermissionItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Cross-session supervision, backed by `GET /api/gateway/overview`.
 *
 * One call reports which sessions are busy, how deep their queues are, and
 * every approval waiting on a human — across all sessions, not just the one on
 * screen. Runtime fields are written through to Room so the dashboard keeps
 * rendering from its single source of truth; the approval list is kept in
 * memory only, because the server drops requests after three minutes and a
 * persisted copy would outlive them.
 */
class GatewayRepository(
    private val api: ApiClient,
    private val sessionDao: SessionDao,
) {

    private val _pendingApprovals = MutableStateFlow<List<PendingPermissionItem>>(emptyList())

    /** Every approval waiting on the user, newest last (server orders by age). */
    val pendingApprovals: StateFlow<List<PendingPermissionItem>> = _pendingApprovals.asStateFlow()

    private val _needsAttention = MutableStateFlow<Set<String>>(emptySet())

    /** Sessions blocked on an approval or sitting in an error state. */
    val needsAttention: StateFlow<Set<String>> = _needsAttention.asStateFlow()

    /**
     * Refresh the overview and write its runtime state into Room.
     *
     * Only sessions the cache already knows are updated — the overview is a
     * projection without mode or style columns, so inserting from it would
     * blank fields the session list owns.
     */
    suspend fun refresh(includeArchived: Boolean = false): Result<GatewayOverview> = apiCall {
        val response = api.getGatewayOverview(includeArchived)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to load session overview")
        }
        val overview = response.data

        for (session in overview.sessions) {
            sessionDao.setRuntime(
                id = session.id,
                busy = session.busy,
                activitySummary = session.activitySummary,
                queueDepth = session.queueDepth,
                lastActivityAt = session.lastActivityAt,
            )
            sessionDao.setStatus(session.id, session.status.uppercase())
        }
        sessionDao.syncPendingApprovals(
            overview.sessions.filter { it.pendingApprovals > 0 }.associate { it.id to it.pendingApprovals }
        )

        _pendingApprovals.value = overview.pendingApprovals
        _needsAttention.value = overview.needsAttention.toSet()
        overview
    }

    /**
     * Drop one approval locally the moment the server confirms it.
     *
     * Callers must only use this after a successful respond call — removing it
     * optimistically would hide a request that is still waiting if the call fails.
     */
    fun forgetApproval(requestId: String) {
        val remaining = _pendingApprovals.value.filterNot { it.requestId == requestId }
        if (remaining.size != _pendingApprovals.value.size) {
            _pendingApprovals.value = remaining
        }
    }
}
