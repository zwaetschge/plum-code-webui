package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import com.claudewebui.app.data.model.PersistedOutboxAttachment
import org.junit.Assert.*
import org.junit.Test

class ChatDraftBufferTest {
    @Test fun retargetUsesNewDeliveryAndUploadsWithoutLosingTheText() {
        val original = OutboxEntity(
            clientMessageId = "old-delivery", sessionId = "session", chatId = "deleted-chat",
            content = "Keep this task", status = OutboxStatus.FAILED.name,
            uploadIdsJson = OutboxEntity.uploadIdsJson(listOf("old-upload")),
            attachmentsJson = OutboxEntity.attachmentsJson(listOf(PersistedOutboxAttachment(
                uri = "content://local/file", mimeType = "text/plain", filename = "notes.txt",
                uploadId = "old-upload", progress = 1f, uploadedChunks = listOf(0), totalChunks = 1,
            ))),
        )
        val moved = original.retarget("new-chat", "new-delivery")
        assertEquals("new-delivery", moved.clientMessageId)
        assertEquals("new-chat", moved.chatId)
        assertEquals(original.content, moved.content)
        assertTrue(moved.uploadIds.isEmpty())
        assertNull(moved.attachments.single().uploadId)
        assertEquals("content://local/file", moved.attachments.single().uri)
    }

    @Test fun draftsRemainOwnedByTheirChatDuringSendAndSwitch() {
        val buffer = ChatDraftBuffer()
        val sent = buffer.edit("first", "First task")
        buffer.edit("second", "Second task")
        assertEquals("", buffer.clearIfUnchanged(sent)?.text)
        assertEquals("Second task", buffer.get("second")?.text)
    }

    @Test fun delayedAcknowledgementDoesNotEraseNewTyping() {
        val buffer = ChatDraftBuffer()
        val sent = buffer.edit("first", "First task")
        buffer.edit("first", "Follow-up")
        assertNull(buffer.clearIfUnchanged(sent))
        assertEquals("Follow-up", buffer.get("first")?.text)
    }

    @Test fun lateRemoteLoadCannotOverwriteAnEditOrClearedDraft() {
        val buffer = ChatDraftBuffer()
        val local = buffer.restore("first", "", null)!!
        buffer.edit("first", "")
        assertNull(buffer.restore("first", "Stale remote text", local))
        assertEquals("", buffer.get("first")?.text)
    }

    @Test fun loadingAnotherChatDoesNotReuseTheCurrentDraft() {
        val buffer = ChatDraftBuffer()
        buffer.edit("first", "Private to first chat")
        assertNull(buffer.get("second"))
        buffer.restore("second", "Second chat text", null)
        assertEquals("Private to first chat", buffer.get("first")?.text)
    }
}
