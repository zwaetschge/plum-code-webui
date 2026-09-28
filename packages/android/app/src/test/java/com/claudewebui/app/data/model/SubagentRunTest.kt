package com.claudewebui.app.data.model

import org.junit.Assert.*
import org.junit.Test

class SubagentRunTest {
    private fun run(id: String, revision: Long = 10, lifecycle: String = "running") = SubagentRun(id = id, startedAt = 5, updatedAt = revision, revision = revision, lifecycle = lifecycle)
    @Test fun parallelRunsAreNotCapped() {
        val runs = mergeSubagentRuns(emptyList(), (1..40).map { run("$it") })
        assertEquals(40, runs.count { it.isActive })
        assertEquals(39, mergeSubagentRuns(runs, listOf(run("3", 20, "completed"))).count { it.isActive })
    }
    @Test fun replayCannotResurrectCompletedRun() {
        assertEquals("completed", mergeSubagentRuns(listOf(run("a", 20, "completed")), listOf(run("a", 30))).single().state)
        assertEquals(20L, mergeSubagentRuns(listOf(run("a", 20)), listOf(run("a", 10))).single().revision)
    }
    @Test fun emptySnapshotReconcilesOnlyItsChatAndKeepsNewEvents() {
        val state = listOf(run("old"), run("new", 30), run("other").copy(chatId = "other"))
        val merged = reconcileSubagents(state, SubagentSnapshot(capturedAt = 20))
        assertEquals(setOf("new", "other"), merged.map { it.runId }.toSet())
    }
    @Test fun identityComesFromServerNeverType() {
        assertEquals(2, mergeSubagentRuns(emptyList(), listOf(run("a"), run("b"))).size)
        assertTrue(mergeSubagentRuns(emptyList(), listOf(SubagentRun())).isEmpty())
    }
}
