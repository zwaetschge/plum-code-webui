package com.claudewebui.app.ui.components.dashboard

import com.claudewebui.app.data.model.SessionStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStateTest {
    private val now = Instant.parse("2026-09-22T20:00:00Z")

    @Test
    fun `resident process with a completed turn is idle and never flagged as stuck`() {
        val state = effectiveState(SessionFacts(
            status = SessionStatus.RUNNING,
            busy = false,
            lastActivityAt = "2026-09-22T19:00:00Z",
        ), now)

        assertEquals(SessionActivity.IDLE, state.activity)
        assertEquals(SessionGroup.SETTLED, state.group)
        assertFalse(state.flagged)
    }

    @Test
    fun `busy turn and pending approval remain distinct`() {
        val busy = effectiveState(SessionFacts(status = SessionStatus.RUNNING, busy = true), now)
        val approval = effectiveState(SessionFacts(
            status = SessionStatus.RUNNING, busy = true, pendingApprovals = 1,
        ), now)

        assertEquals(SessionActivity.WORKING, busy.activity)
        assertEquals(SessionActivity.NEEDS_YOU, approval.activity)
        assertTrue(approval.flagged)
    }
}
