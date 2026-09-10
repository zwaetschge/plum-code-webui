package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Test

class ToolLogTest {
    @Test fun filtersRecognizeCallsAcrossProviders() {
        assertTrue(ToolLogFilter.WRITE.matches("apply_patch"))
        assertTrue(ToolLogFilter.AGENT.matches("mcp__subagents__run_subagent"))
        assertTrue(ToolLogFilter.BASH.matches("exec_command"))
        assertFalse(ToolLogFilter.READ.matches("Write"))
        assertTrue(ToolLogFilter.ALL.matches("unrecognized_tool"))
    }

    @Test fun previewUsesCommandAndDurationUsesCompletionTime() {
        val tool = ToolExecution("1", "Bash", ToolStatus.COMPLETED,
            input = buildJsonObject { put("command", "git status"); put("description", "Check tree") },
            timestamp = 1_000, completedAt = 2_500)
        assertEquals("git status", toolInputPreview(tool))
        assertEquals(1_500L, toolDuration(tool, 99_000))
        assertEquals(0L, toolDuration(tool.copy(completedAt = null, timestamp = 100_000), 99_000))
    }
}
