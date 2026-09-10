package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * `GET /api/gateway/overview` — one request that answers "what needs me?".
 *
 * The dashboard used to answer that by fanning out: the session list, then a
 * pending-permission call per session. This is the same information in a single
 * round trip, and it is the only endpoint that reports approvals across every
 * session rather than one at a time.
 */
@Serializable
data class GatewayOverview(
    val generatedAt: String? = null,
    val totals: GatewayTotals = GatewayTotals(),
    /** Session ids blocked on a human or errored — what a supervisor opens first. */
    val needsAttention: List<String> = emptyList(),
    val sessions: List<GatewaySession> = emptyList(),
    val pendingApprovals: List<PendingPermissionItem> = emptyList(),
    /**
     * Questions the agents are blocked on. Separate from approvals because the
     * answer is a choice out of a list, not a yes/no, and the endpoint differs.
     */
    val pendingQuestions: List<QuestionRequestEvent> = emptyList(),
)

@Serializable
data class GatewayTotals(
    val sessions: Int = 0,
    val busy: Int = 0,
    val pendingApprovals: Int = 0,
    val pendingQuestions: Int = 0,
)

/**
 * A session row as the gateway sees it. Deliberately not [Session]: the gateway
 * projection is narrower (no mode, no style skills) and merging it into the
 * cache as if it were a full session would blank those columns.
 */
@Serializable
data class GatewaySession(
    val id: String,
    val name: String = "",
    val provider: String? = null,
    val model: String? = null,
    val workingDirectory: String = "",
    val status: String = "stopped",
    val archived: Boolean = false,
    val running: Boolean = false,
    val busy: Boolean = false,
    val queueDepth: Int = 0,
    val activitySummary: String? = null,
    val lastActivityAt: String? = null,
    val pendingApprovals: Int = 0,
    val pendingQuestions: Int = 0,
    val updatedAt: String? = null,
)
