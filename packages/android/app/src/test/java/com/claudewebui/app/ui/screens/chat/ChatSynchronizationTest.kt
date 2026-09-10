package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.core.network.ReconnectedEvent
import com.claudewebui.app.data.model.SessionChat
import com.claudewebui.app.data.model.SessionChatList
import com.claudewebui.app.data.repository.SupersededHistoryResponse
import com.claudewebui.app.data.repository.ignoreSupersededHistory
import com.claudewebui.app.data.repository.normalizedChatIdentity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatSynchronizationTest {
    @Test fun `disconnect cancels pending flush and next turn starts without old prefix`() = runTest {
        val state = MutableStateFlow(ChatUiState())
        val stream = ChatStreamingController(this, state)
        stream.enqueueDelta("Old interrupted reply")
        stream.resetActivity()
        advanceUntilIdle()
        assertEquals(StreamingState.Idle, state.value.streamingState)
        stream.enqueueDelta("New reply")
        advanceUntilIdle()
        assertEquals(StreamingState.Streaming("New reply"), state.value.streamingState)
    }

    @Test fun `reconnect snapshot replaces prefix once and subsequent delta appends`() = runTest {
        val state = MutableStateFlow(ChatUiState())
        val stream = ChatStreamingController(this, state)
        stream.enqueueDelta("Old prefix")
        val event = Json.decodeFromString<ReconnectedEvent>(
            """{"sessionId":"s","isRunning":true,"streamingSnapshot":{"sessionId":"s","chatId":"c","content":"Recovered prefix","isComplete":false}}""",
        )
        stream.restoreSnapshot(event.streamingSnapshot?.content)
        assertEquals(StreamingState.Streaming("Recovered prefix"), state.value.streamingState)
        stream.enqueueDelta(" + live delta")
        advanceUntilIdle()
        assertEquals(StreamingState.Streaming("Recovered prefix + live delta"), state.value.streamingState)
        stream.onMessageCompleted()
        advanceUntilIdle()
        assertEquals(StreamingState.Idle, state.value.streamingState)
    }

    @Test fun `idle reconnect clears reply even when CLI process is still alive`() = runTest {
        val state = MutableStateFlow(ChatUiState())
        val stream = ChatStreamingController(this, state)
        stream.enqueueDelta("Already persisted")
        val event = Json.decodeFromString<ReconnectedEvent>(
            """{"sessionId":"s","isRunning":true,"streamingSnapshot":null}""",
        )
        stream.restoreSnapshot(event.streamingSnapshot?.content)
        advanceUntilIdle()
        assertEquals(StreamingState.Idle, state.value.streamingState)
        assertFalse(state.value.isThinking)
        assertFalse(state.value.isSending)
    }

    @Test fun `superseded REST replacement leaves event collector alive for later events`() = runTest {
        val applied = mutableListOf<Int>()
        flowOf(1, 2, 3).onEach { event ->
            ignoreSupersededHistory {
                if (event == 2) throw SupersededHistoryResponse()
                applied += event
            }
        }.collect()
        assertEquals(listOf(1, 3), applied)
    }

    @Test fun `real coroutine cancellation is never swallowed as obsolete history`() = runTest {
        val cancelled = CancellationException("screen destroyed")
        try {
            ignoreSupersededHistory { throw cancelled }
            fail("Cancellation must propagate")
        } catch (actual: CancellationException) {
            assertSame(cancelled, actual)
        }
    }

    @Test fun `synthetic main menu entry maps to null history identity only`() {
        val main = SessionChatList(listOf(SessionChat("main", "Chat 1")), "main")
        assertNull(main.normalizedChatIdentity().activeChatId)
        assertEquals("main", main.normalizedChatIdentity().chats.single().id)
        val real = SessionChatList(listOf(SessionChat("thread-1", "Chat 1")), "thread-1")
        assertEquals(real, real.normalizedChatIdentity())
    }
}
