package com.claudewebui.app.core.diagnostics

import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class BreadcrumbsTest {
    @Before fun reset() = Breadcrumbs.clear()
    @After fun cleanup() = Breadcrumbs.clear()

    @Test fun keepsNewestEventsWithinCrashBudget() {
        repeat(250) { Breadcrumbs.add("socket", "event $it") }
        val lines = Breadcrumbs.snapshot()
        assertEquals(200, lines.size)
        assertTrue(lines.first().endsWith("event 50"))
        assertTrue(lines.last().endsWith("event 249"))
    }

    @Test fun routeAndMessagesStayBoundedAndSingleLine() {
        Breadcrumbs.currentRoute = "chat/{sessionId}"
        Breadcrumbs.add("action", "a\nb\r" + "x".repeat(400))
        assertEquals("chat/{sessionId}", Breadcrumbs.currentRoute)
        assertTrue(Breadcrumbs.snapshot().first().endsWith("[nav] chat/{sessionId}"))
        assertFalse(Breadcrumbs.snapshot().last().contains('\n'))
        assertTrue(Breadcrumbs.snapshot().last().length < 340)
    }
}
