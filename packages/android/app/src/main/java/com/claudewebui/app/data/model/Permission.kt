package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class PermissionAction {
    @SerialName("allow_once") ALLOW_ONCE,
    @SerialName("allow_project") ALLOW_PROJECT,
    @SerialName("allow_global") ALLOW_GLOBAL,
    @SerialName("deny") DENY
}

@Serializable
data class PermissionRequest(
    val sessionId: String,
    val requestId: String,
    val toolName: String = "tool",
    val toolInput: JsonElement? = null,
    // Not every emitter includes these (ACP vs hook payloads differ);
    // a missing field must not kill the whole prompt.
    val description: String = "",
    val suggestedPattern: String = "",
    val eventSequence: Long? = null,
)

@Serializable
data class PermissionResponse(
    val sessionId: String,
    val requestId: String,
    val action: PermissionAction,
    val pattern: String? = null
)

@Serializable
data class PermissionDenial(
    @SerialName("tool_name") val toolName: String,
    @SerialName("tool_use_id") val toolUseId: String,
    @SerialName("tool_input") val toolInput: JsonElement? = null
)

@Serializable
data class PermissionRequestData(
    val sessionId: String,
    val denials: List<PermissionDenial>,
    val originalMessage: String,
    val eventSequence: Long? = null,
)

/** One entry from `GET /api/permissions/pending/:sessionId`. */
@Serializable
data class PendingPermissionItem(
    val sessionId: String = "",
    val requestId: String = "",
    val toolName: String = "tool",
    val description: String = "",
)

/** `POST /api/permissions/respond` result — flat, no data envelope. */
@Serializable
data class PermissionRespondResult(
    val success: Boolean = false,
    val action: String? = null,
    val pattern: String? = null
)

// ── Agent question prompts (session:question_request) ────────────────────────

@Serializable
data class QuestionOption(
    val label: String = "",
    val description: String? = null
)

@Serializable
data class QuestionItem(
    val question: String = "",
    val header: String? = null,
    val options: List<QuestionOption> = emptyList(),
    val multiple: Boolean = false,
    val custom: Boolean = false
)

@Serializable
data class QuestionRequestEvent(
    val sessionId: String,
    val requestId: String,
    val providerSessionId: String? = null,
    val questions: List<QuestionItem> = emptyList(),
    val eventSequence: Long? = null,
)

@Serializable
data class QuestionRespondInput(
    val requestId: String,
    val answers: List<List<String>>,
    val providerSessionId: String? = null
)

@Serializable
data class QuestionRejectInput(
    val requestId: String,
    val providerSessionId: String? = null
)
