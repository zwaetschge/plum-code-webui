package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class SubagentActivity(val at: Long, val text: String, val toolName: String? = null)

@Serializable
data class SubagentRun(
    val id: String = "",
    val agentId: String? = null,
    val sessionId: String = "",
    val agentType: String = "subagent",
    val description: String? = null,
    val status: ToolStatus = ToolStatus.STARTED,
    val lifecycle: String? = null,
    val activity: String? = null,
    val activitySummary: String? = null,
    val waitingReason: String? = null,
    val provider: String? = null,
    val model: String? = null,
    val chatId: String? = null,
    val turnId: String? = null,
    val parentRunId: String? = null,
    val background: Boolean = false,
    val startedAt: Long = 0,
    val completedAt: Long? = null,
    val updatedAt: Long? = null,
    val revision: Long? = null,
    val timestamp: Long? = null,
    val result: String? = null,
    val error: String? = null,
    val activities: List<SubagentActivity> = emptyList(),
) {
    val runId: String get() = id.ifBlank { agentId.orEmpty() }
    val state: String get() = lifecycle ?: when (status) {
        ToolStatus.STARTED -> "running"
        ToolStatus.COMPLETED -> "completed"
        ToolStatus.ERROR -> "failed"
    }
    val isActive: Boolean get() = state == "running"
    val version: Long get() = revision ?: updatedAt ?: completedAt ?: timestamp ?: startedAt
}

@Serializable
data class SubagentTotals(val completed: Int = 0, val failed: Int = 0, val interrupted: Int = 0)

@Serializable
data class SubagentSnapshot(
    val runs: List<SubagentRun> = emptyList(),
    val capturedAt: Long,
    val totals: SubagentTotals? = null,
    val chatId: String? = null,
    val hasMore: Boolean = false,
    val nextOffset: Int = 0,
)

/** Run identity, never agent type, controls lifecycle. Late starts cannot revive a terminal run. */
fun mergeSubagentRuns(existing: List<SubagentRun>, incoming: List<SubagentRun>): List<SubagentRun> {
    val result = existing.associateBy { it.runId }.toMutableMap()
    incoming.filter { it.runId.isNotBlank() }.forEach { run ->
        val previous = result[run.runId]
        if (previous == null || (previous.version <= run.version &&
            !(!previous.isActive && previous.state != "queued" && run.isActive))) {
            result[run.runId] = run.copy(startedAt = previous?.startedAt?.takeIf { it > 0 } ?: run.startedAt.takeIf { it > 0 } ?: run.timestamp ?: 0)
        }
    }
    return result.values.sortedWith(compareByDescending<SubagentRun> { it.isActive }
        .thenBy { if (it.isActive) it.startedAt else -(it.completedAt ?: it.startedAt) })
}

fun reconcileSubagents(existing: List<SubagentRun>, snapshot: SubagentSnapshot): List<SubagentRun> {
    val ids = snapshot.runs.map { it.runId }.toSet()
    return mergeSubagentRuns(existing.filter { it.chatId != snapshot.chatId || it.runId in ids ||
        (it.updatedAt ?: it.startedAt) > snapshot.capturedAt || !it.isActive }, snapshot.runs)
}
