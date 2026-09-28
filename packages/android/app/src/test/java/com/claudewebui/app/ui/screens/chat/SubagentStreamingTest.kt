package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.model.SubagentRun
import com.claudewebui.app.data.model.ToolStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Test

class SubagentStreamingTest {
    @Test fun endingOneAgentKeepsOthersAndParentStream() {
        val initial = StreamingState.Streaming("parent is still writing")
        val state = MutableStateFlow(ChatUiState(streamingState = initial))
        val controller = ChatStreamingController(CoroutineScope(Dispatchers.Unconfined), state)
        controller.onAgentEvent(SubagentRun(agentId = "a", revision = 1))
        controller.onAgentEvent(SubagentRun(agentId = "b", revision = 1))
        controller.onAgentEvent(SubagentRun(agentId = "a", revision = 2, status = ToolStatus.COMPLETED))
        assertEquals(initial, state.value.streamingState)
        assertEquals(1, state.value.agentRuns.count { it.isActive })
        controller.onAgentEvent(SubagentRun(agentId = "other", chatId = "other"))
        assertEquals(2, state.value.agentRuns.size)
    }
}
