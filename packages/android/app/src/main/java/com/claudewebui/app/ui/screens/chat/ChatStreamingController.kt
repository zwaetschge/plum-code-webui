package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.core.diagnostics.Breadcrumbs
import com.claudewebui.app.core.network.ThinkingEvent
import com.claudewebui.app.data.model.AgentEvent
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolExecutionEvent
import com.claudewebui.app.data.model.ToolStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Live-turn state: streaming text batching, thinking, tool and agent
 * activity. Owned by [ChatViewModel] and scoped to its `viewModelScope`.
 */
internal class ChatStreamingController(
    private val scope: CoroutineScope,
    private val state: MutableStateFlow<ChatUiState>,
) {
    private val streamingDeltas = StreamingDeltaAccumulator()
    private var streamingFlushJob: Job? = null

    /**
     * Streaming text deltas are flushed at most every 50 ms. Some CLIs emit
     * hundreds of tiny chunks per second; recomposing markdown for every one
     * causes visible jank on phones.
     */
    fun enqueueDelta(delta: String) {
        if (delta.isEmpty()) return
        // The accumulator now holds the whole partial reply; publishing its
        // snapshot per flush copies the text once instead of concatenating
        // current + batch — quadratic over a long answer.
        streamingDeltas.append(delta)
        if (streamingFlushJob?.isActive == true) return
        streamingFlushJob = scope.launch {
            delay(STREAM_FLUSH_MS)
            if (!streamingDeltas.isEmpty()) {
                val text = streamingDeltas.snapshot()
                state.update { current ->
                    current.copy(
                        streamingState = StreamingState.Streaming(text),
                        isThinking = false,
                        isSending = false,
                    )
                }
            }
        }
    }

    fun clearDeltas() {
        streamingFlushJob?.cancel()
        streamingFlushJob = null
        streamingDeltas.reset()
    }

    /**
     * A complete message arrived. Drop the accumulator and the bubble in one
     * go, with no suspension in between. cacheMessage() used to sit between
     * them, and a delta arriving while it was suspended re-armed the 50 ms
     * flush job — whichever write landed last decided whether the user was
     * left staring at a dead streaming block that nothing afterwards cleared.
     */
    fun onMessageCompleted() {
        clearDeltas()
        state.update { current ->
            current.copy(
                streamingState = StreamingState.Idle,
                isSending = false,
            )
        }
    }

    /** Streaming, thinking and sending stop together (stop, error, interrupt). */
    fun resetActivity() {
        clearDeltas()
        state.update { current ->
            current.copy(
                streamingState = StreamingState.Idle,
                isThinking = false,
                isSending = false,
                thinkingLabel = null,
                thinkingStartTime = 0L,
            )
        }
    }

    /** Reconnect supplies the full in-flight reply; subsequent live deltas append to it. */
    fun restoreSnapshot(content: String?) {
        resetActivity()
        if (!content.isNullOrEmpty()) {
            streamingDeltas.append(content)
            state.update { it.copy(streamingState = StreamingState.Streaming(content)) }
        }
    }

    /**
     * Thinking indicator. A mid-turn thinking=true (agent start, Pi
     * compaction) must not discard streaming text already on screen.
     */
    fun onThinking(event: ThinkingEvent) {
        state.update { current ->
            current.copy(
                isThinking = event.isThinking,
                thinkingLabel = if (event.isThinking) event.message else null,
                thinkingStartTime = if (event.isThinking) System.currentTimeMillis() else 0L,
                streamingState = if (event.isThinking && current.streamingState !is StreamingState.Streaming) {
                    StreamingState.Idle
                } else {
                    current.streamingState
                },
            )
        }
    }

    /** Replayed thinking beat from the reconnect buffer; leaves streaming text alone. */
    fun onBufferedThinking(active: Boolean, label: String?) {
        state.update {
            it.copy(
                isThinking = active,
                thinkingLabel = label,
                thinkingStartTime = if (active) System.currentTimeMillis() else 0L,
            )
        }
    }

    fun onAgentEvent(event: AgentEvent) {
        when (event.status) {
            ToolStatus.STARTED -> state.update { current ->
                current.copy(
                    streamingState = StreamingState.AgentRunning(
                        event.agentType,
                        event.description,
                    ),
                    isThinking = false,
                )
            }
            ToolStatus.COMPLETED, ToolStatus.ERROR -> state.update { current ->
                if (current.streamingState is StreamingState.AgentRunning)
                    current.copy(streamingState = StreamingState.Idle)
                else current
            }
        }
    }

    fun onToolEvent(event: ToolExecutionEvent) {
        Breadcrumbs.add("chat.tool", "${event.toolName}: ${event.status}")
        state.update { current ->
            val toolId = event.toolId ?: current.activeTools.values
                .lastOrNull { it.toolName == event.toolName && it.status == ToolStatus.STARTED }
                ?.toolId ?: "${event.toolName}_${System.currentTimeMillis()}"
            val existing = current.activeTools[toolId] ?: current.toolHistory[toolId]
            val tool = ToolExecution(
                toolId = toolId,
                toolName = event.toolName,
                status = event.status,
                input = event.input ?: existing?.input,
                result = event.result ?: existing?.result,
                error = event.error ?: existing?.error,
                timestamp = existing?.timestamp ?: event.timestamp ?: System.currentTimeMillis(),
                completedAt = if (event.status == ToolStatus.STARTED) null else System.currentTimeMillis(),
            )
            val history = (current.toolHistory + (toolId to tool)).values
                .sortedByDescending { it.timestamp }.take(300).associateBy { it.toolId }
            current.copy(
                activeTools = current.activeTools + (toolId to tool),
                toolHistory = history,
                streamingState = if (event.status == ToolStatus.STARTED) {
                    StreamingState.ToolExecuting(event.toolName, toolId)
                } else if ((current.streamingState as? StreamingState.ToolExecuting)?.toolId == toolId) {
                    StreamingState.Idle
                } else current.streamingState,
                isThinking = if (event.status == ToolStatus.STARTED) false else current.isThinking,
            )
        }
    }

}

internal const val STREAM_FLUSH_MS = 50L

/** Small testable buffer used by the 50 ms streaming UI batcher. */
internal class StreamingDeltaAccumulator {
    private val value = StringBuilder()

    fun append(delta: String) {
        value.append(delta)
    }

    fun drain(): String = value.toString().also { value.clear() }

    /** Full text so far without clearing — one copy per flush instead of the
     *  quadratic current+batch concatenation over the whole reply. */
    fun snapshot(): String = value.toString()

    fun reset() {
        value.clear()
    }

    fun isEmpty(): Boolean = value.isEmpty()
}
