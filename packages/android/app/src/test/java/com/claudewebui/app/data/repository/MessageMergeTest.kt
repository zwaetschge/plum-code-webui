package com.claudewebui.app.data.repository

import com.claudewebui.app.data.model.ChatMedia
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageMergeTest {
    private fun message(
        id: String,
        clientId: String? = null,
        sequence: Long? = null,
        media: List<ChatMedia>? = null,
    ) = Message(
        id = id,
        sessionId = "s1",
        chatId = "chat-a",
        role = MessageRole.USER,
        content = "hello",
        createdAt = "2026-08-09T00:00:00Z",
        clientMessageId = clientId,
        eventSequence = sequence,
        media = media,
    )

    @Test
    fun `REST and live copies dedupe by client id and retain richer durable row`() {
        val optimistic = message("optimistic", clientId = "client-1")
        val durable = message(
            "server-1",
            clientId = "client-1",
            sequence = 44,
            media = listOf(ChatMedia(id = "media-1")),
        )

        val merged = mergeMessagesByIdentity(listOf(optimistic, durable))

        assertEquals(1, merged.size)
        assertEquals("server-1", merged.single().id)
        assertEquals(44L, merged.single().eventSequence)
        assertTrue(merged.single().media?.isNotEmpty() == true)
    }

    @Test
    fun `event sequence dedupes different server ids`() {
        val merged = mergeMessagesByIdentity(
            listOf(message("old", sequence = 91), message("new", sequence = 91)),
        )

        assertEquals(listOf("new"), merged.map { it.id })
    }
}
