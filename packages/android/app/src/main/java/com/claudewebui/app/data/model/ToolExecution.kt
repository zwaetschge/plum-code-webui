package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class ToolStatus {
    @SerialName("started") STARTED,
    @SerialName("completed") COMPLETED,
    @SerialName("error") ERROR
}

@Serializable
data class ToolExecution(
    val toolId: String,
    val toolName: String,
    val status: ToolStatus,
    val input: JsonElement? = null,
    val result: String? = null,
    val error: String? = null,
    val timestamp: Long,
    val completedAt: Long? = null
)

@Serializable
data class ToolExecutionEvent(
    val sessionId: String,
    val toolName: String,
    val status: ToolStatus,
    val toolId: String? = null,
    val input: JsonElement? = null,
    val result: String? = null,
    val error: String? = null,
    /** Server-side clock; use instead of the device clock to keep ordering stable. */
    val timestamp: Long? = null,
    val actionSummary: String? = null
)

typealias AgentEvent = SubagentRun
