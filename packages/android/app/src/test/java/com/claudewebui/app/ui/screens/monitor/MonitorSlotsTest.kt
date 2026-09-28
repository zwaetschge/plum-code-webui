package com.claudewebui.app.ui.screens.monitor

import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class MonitorSlotsTest {
    private fun session(id: String, busy: Boolean = false, updatedAt: String, lastActivityAt: String? = null) = Session(
        id = id, userId = "u", name = id, workingDirectory = "/w",
        status = if (busy) SessionStatus.RUNNING else SessionStatus.STOPPED,
        createdAt = updatedAt, updatedAt = updatedAt, busy = busy, lastActivityAt = lastActivityAt,
    )

    @Test
    fun `defaults prefer busy sessions then recency and pad with empty slots`() {
        val slots = defaultMonitorSlots(
            listOf(
                session("old", updatedAt = "2026-09-01T00:00:00Z"),
                session("busy", busy = true, updatedAt = "2026-08-01T00:00:00Z"),
                session("recent", updatedAt = "2026-09-10T00:00:00Z", lastActivityAt = "2026-09-14T00:00:00Z"),
            ),
        )
        assertEquals(listOf("busy", "recent", "old", null), slots)
    }

    @Test
    fun `slots round-trip through the preference string with gaps intact`() {
        val slots = listOf("a", null, "c", null)
        assertEquals(slots, decodeMonitorSlots(encodeMonitorSlots(slots)))
        assertEquals(List(4) { null }, decodeMonitorSlots(null))
        assertEquals(listOf("x", null, null, null), decodeMonitorSlots("x"))
    }
}
