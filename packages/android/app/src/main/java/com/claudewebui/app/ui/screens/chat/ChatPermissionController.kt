package com.claudewebui.app.ui.screens.chat

import android.content.Context
import com.claudewebui.app.core.diagnostics.Breadcrumbs

import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionRequest
import com.claudewebui.app.data.model.PermissionRequestData
import com.claudewebui.app.data.model.QuestionRequestEvent
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Interactive prompts that block a turn: permission requests (both wire
 * formats) and OpenCode questions. Owned by [ChatViewModel] and scoped to
 * its `viewModelScope`.
 */
internal class ChatPermissionController(
    private val scope: CoroutineScope,
    private val sessionId: String,
    private val appContext: Context,
    private val state: MutableStateFlow<ChatUiState>,
    private val sessionRepository: SessionRepository,
    private val socketManager: SocketManager,
) {
    /**
     * Decode a permission payload for this session. Returns whether it was
     * applied and, if so, the event sequence to commit.
     */
    fun applyPermissionElement(element: JsonElement): Pair<Boolean, Long?> {
        val obj = element as? JsonObject ?: return false to null
        val sid = (obj["sessionId"] as? JsonPrimitive)?.content
        if (sid != sessionId) return false to null
        if (obj.containsKey("requestId")) {
            val request = runCatching {
                chatSocketJson.decodeFromJsonElement(PermissionRequest.serializer(), obj)
            }.getOrNull() ?: return false to null
            state.update { it.copy(pendingPermission = request, isThinking = false) }
            return true to request.eventSequence
        }
        if (obj.containsKey("denials")) {
            val request = runCatching {
                chatSocketJson.decodeFromJsonElement(PermissionRequestData.serializer(), obj)
            }.getOrNull() ?: return false to null
            state.update { it.copy(pendingLegacyPermission = request, isThinking = false) }
            return true to request.eventSequence
        }
        return false to null
    }

    /** OpenCode question prompts — without this the session stalls silently. */
    fun onQuestion(event: QuestionRequestEvent) {
        state.update { it.copy(pendingQuestion = event, isThinking = false) }
    }

    /** Answer a hooks-based permission request over REST (the working path). */
    fun respondToPermission(action: PermissionAction) {
        Breadcrumbs.add("chat.permission", "respond")
        val request = state.value.pendingPermission ?: return
        state.update { it.copy(pendingPermission = null) }
        scope.launch {
            sessionRepository.respondToPermission(
                sessionId = sessionId,
                requestId = request.requestId,
                action = action,
                pattern = request.suggestedPattern.takeIf { it.isNotBlank() },
            ).onFailure { e ->
                state.update { it.copy(pendingPermission = it.pendingPermission ?: request, error = e.userMessage(appContext)) }
            }
        }
    }

    /** Answer a legacy (denials-based) permission request over the socket. */
    fun respondToLegacyPermission(approve: Boolean) {
        val request = state.value.pendingLegacyPermission ?: return
        state.update { it.copy(pendingLegacyPermission = null) }
        if (approve) {
            socketManager.approvePermission(
                sessionId = sessionId,
                toolNames = request.denials.map { it.toolName },
                originalMessage = request.originalMessage,
            )
        } else {
            socketManager.denyPermission(sessionId)
        }
    }

    /** Answer an OpenCode question prompt; answers[i] holds question i's picks. */
    fun respondToQuestion(answers: List<List<String>>) {
        Breadcrumbs.add("chat.question", "respond")
        val question = state.value.pendingQuestion ?: return
        state.update { it.copy(pendingQuestion = null) }
        scope.launch {
            sessionRepository.respondToQuestion(
                requestId = question.requestId,
                answers = answers,
                providerSessionId = question.providerSessionId,
            ).onFailure { e ->
                state.update { it.copy(pendingQuestion = it.pendingQuestion ?: question, error = e.userMessage(appContext)) }
            }
        }
    }

    fun dismissQuestion() {
        val question = state.value.pendingQuestion ?: return
        state.update { it.copy(pendingQuestion = null) }
        scope.launch {
            sessionRepository.rejectQuestion(question.requestId, question.providerSessionId)
        }
    }
}
