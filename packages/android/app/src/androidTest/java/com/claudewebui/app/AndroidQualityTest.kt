package com.claudewebui.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.claudewebui.app.data.local.EditorDraft
import com.claudewebui.app.data.local.EditorDraftStore
import com.claudewebui.app.data.model.*
import com.claudewebui.app.ui.screens.dashboard.NotificationFeedContent
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class AndroidQualityTest {
    @get:Rule val compose = createComposeRule()

    @Test fun narrowHeaderKeepsActionsReachableAtDoubleTextSize() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var opened = false
        compose.setContent {
            val density = androidx.compose.ui.platform.LocalDensity.current.density
            CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density, 2f)) {
                ClaudeWebUITheme(darkTheme = true) {
                    Box(Modifier.width(360.dp)) {
                        com.claudewebui.app.ui.screens.dashboard.CompactSessionsHeader(true, 40, 2, false, 9, {}, { opened = true })
                    }
                }
            }
        }
        compose.onNodeWithContentDescription(context.getString(R.string.dashboard_settings_c7f73)).assertIsDisplayed().performClick()
        compose.runOnIdle { assertTrue(opened) }
    }

    @Test fun normalChatTaskSummaryShowsProgressAndOpensDetails() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var opened = false
        compose.setContent { ClaudeWebUITheme(darkTheme = true) {
            com.claudewebui.app.ui.components.chat.TaskProgressSummary(listOf(
                TodoItem("Inspect", TodoStatus.COMPLETED),
                TodoItem("Implement", TodoStatus.IN_PROGRESS, "Implementing"),
                TodoItem("Verify", TodoStatus.PENDING),
            )) { opened = true }
        } }
        compose.onNodeWithText("Implementing").assertIsDisplayed().performClick()
        compose.onNodeWithText(context.getString(R.string.component_tasks_count, 1, 3)).assertIsDisplayed()
        compose.runOnIdle { assertTrue(opened) }
    }

    @Test fun sessionToolsKeepWorkVisibleAndConfigurationReachable() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var destination = ""
        compose.setContent { ClaudeWebUITheme(darkTheme = true) {
            com.claudewebui.app.ui.screens.chat.SessionToolsMenu(
                "Codex · GPT · High", "Default", 3, 1,
                { destination = "tasks" }, { destination = "agents" }, {}, {}, {}, {}, {}, {}, {},
                { destination = "runtime" }, { destination = "appearance" },
            )
        } }
        compose.onNodeWithText(context.getString(R.string.session_menu_agent_activity, 3, 1)).assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals("agents", destination) }
        compose.onNodeWithText(context.getString(R.string.session_menu_tasks)).performClick()
        compose.runOnIdle { assertEquals("tasks", destination) }
        compose.onNodeWithText(context.getString(R.string.session_menu_runtime)).performScrollTo().performClick()
        compose.runOnIdle { assertEquals("runtime", destination) }
    }

    @Test fun readButPendingApprovalCanStillBeAnswered() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var accepted = false
        val item = AppNotification("event", "session", "approval", "Permission", data = NotificationPayload(requestId = "request"), readAt = "read")
        compose.setContent { ClaudeWebUITheme(darkTheme = true) {
            NotificationFeedContent(listOf(item), 0, {}, {}, {}, { _, allow -> accepted = allow }, setOf("request"))
        } }
        compose.onNodeWithText(context.getString(R.string.dashboard_allow_3ad0e)).performClick()
        compose.runOnIdle { assertTrue(accepted) }
    }

    @Test fun draftRecoversAcrossStoreRecreation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val key = "test-recovery-${System.nanoTime()}"
        val draft = EditorDraft("note", "Title", "Keep my work", "old")
        val store = EditorDraftStore(context)
        try {
            store.write(key, draft)
            assertEquals(draft, EditorDraftStore(context).read(key))
        } finally { store.clear(key) }
    }
}
