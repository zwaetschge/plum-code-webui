package com.claudewebui.app.core.notifications

import com.claudewebui.app.data.model.AppNotification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FeedAnnouncementsTest {
    private fun row(id: String, kind: String = "reply", read: Boolean = false, session: String? = "s1") =
        AppNotification(id = id, sessionId = session, kind = kind, title = id, readAt = if (read) "now" else null)

    @Test
    fun `first pass only records what exists`() {
        val diff = diffFeed(listOf(row("a"), row("b")), seen = emptySet(), initialized = false)
        assertTrue(diff.announce.isEmpty())
        assertEquals(setOf("a", "b"), diff.seen)
    }

    @Test
    fun `unread unseen replies are announced oldest first`() {
        val diff = diffFeed(listOf(row("new2"), row("new1"), row("old")), seen = setOf("old"), initialized = true)
        assertEquals(listOf("new1", "new2"), diff.announce.map { it.id })
        assertEquals(setOf("old", "new1", "new2"), diff.seen)
    }

    @Test
    fun `read rows approvals and sessionless rows stay quiet`() {
        val diff = diffFeed(
            listOf(row("read", read = true), row("approval", kind = "approval"), row("nosession", session = null), row("usage", kind = "usage_alert")),
            seen = emptySet(),
            initialized = true,
        )
        assertTrue(diff.announce.isEmpty())
    }

    @Test
    fun `goals questions and errors count as news`() {
        val diff = diffFeed(listOf(row("g", "goal"), row("q", "question"), row("e", "error")), seen = emptySet(), initialized = true)
        assertEquals(setOf("g", "q", "e"), diff.announce.map { it.id }.toSet())
    }
}
