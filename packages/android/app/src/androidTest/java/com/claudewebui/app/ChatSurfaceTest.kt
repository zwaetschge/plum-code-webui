package com.claudewebui.app

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionRequest
import com.claudewebui.app.ui.components.chat.ChatInput
import com.claudewebui.app.ui.components.chat.PermissionRequestCard
import com.claudewebui.app.ui.screens.dashboard.FilterPill
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.LocalReduceMotion
import com.claudewebui.app.ui.theme.LocalPlumTokens
import com.claudewebui.app.ui.theme.plumTokensFor
import com.claudewebui.app.ui.theme.PlumDarkPalette
import com.claudewebui.app.ui.theme.PlumLightPalette
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Behaviour and rendered-surface regressions; no backend or account required. */
class ChatSurfaceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun composerKeepsFollowupWhileAgentIsWorking() {
        var sent: String? = null
        var interrupts = 0
        compose.setContent {
            var draft by remember { mutableStateOf("") }
            TestTheme {
                ChatInput(draft, { draft = it }, { sent = it }, isWorking = true, onInterrupt = { interrupts++ })
            }
        }
        compose.onNodeWithTag("chat-composer").performTextInput("Continue with the smaller change")
        compose.onNodeWithTag("chat-send").performClick()
        compose.runOnIdle {
            assertEquals("Continue with the smaller change", sent)
            assertEquals(0, interrupts)
        }
    }

    @Test fun emptyComposerCannotSend() {
        compose.setContent { TestTheme { ChatInput("   ", {}, { error("Empty text was sent") }) } }
        compose.onNodeWithTag("chat-send").assertIsNotEnabled()
    }

    @Test fun destructivePermissionAllowsOnlyExplicitOneTimeAnswer() {
        var action: PermissionAction? = null
        compose.setContent {
            TestTheme {
                PermissionRequestCard(
                    PermissionRequest("session", "request", "Bash", buildJsonObject { put("command", "rm -rf build") }),
                    { action = it },
                )
            }
        }
        compose.onNodeWithTag("permission-action-allow_project").assertDoesNotExist()
        compose.onNodeWithTag("permission-action-allow_once").performClick()
        compose.runOnIdle { assertEquals(PermissionAction.ALLOW_ONCE, action) }
    }

    @Test fun permissionDenialIsNotAnApproval() {
        var action: PermissionAction? = null
        compose.setContent {
            TestTheme { PermissionRequestCard(PermissionRequest("session", "request", "Read"), { action = it }) }
        }
        compose.onNodeWithTag("permission-action-deny").performClick()
        compose.runOnIdle { assertEquals(PermissionAction.DENY, action) }
    }

    @Test fun dashboardFilterExposesSelectionAndChangesIt() {
        compose.setContent {
            var selected by remember { mutableStateOf("All") }
            TestTheme {
                Column {
                    listOf("All", "Running", "Needs attention").forEach { label ->
                        FilterPill(label, selected == label) { selected = label }
                    }
                }
            }
        }
        compose.onNodeWithText("All").assertIsSelected()
        compose.onNodeWithText("Needs attention").performClick().assertIsSelected()
        compose.onNodeWithText("All").assertIsNotSelected()
    }

    @Test fun captureLightAndDarkChatSurfaces() {
        var dark by mutableStateOf(false)
        compose.setContent {
            TestTheme(dark) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    PermissionRequestCard(PermissionRequest("session", "request", "Read", description = "Read project notes"), {})
                    ChatInput("Review this change", {}, {})
                }
            }
        }
        val light = screenshot("chat-light.png")
        compose.runOnIdle { dark = true }
        val night = screenshot("chat-dark.png")
        assertEquals(light.width, night.width)
        assertEquals(light.height, night.height)
        assertFalse("Light and dark themes must render distinct surfaces", light.sameAs(night))
        // Compare the empty padding, so a timer/text change cannot satisfy the theme check.
        assertTrue("The light surface must be visibly brighter than the dark surface",
            android.graphics.Color.red(light.getPixel(8, 8)) > android.graphics.Color.red(night.getPixel(8, 8)) + 100)
    }

    private fun screenshot(name: String): Bitmap {
        compose.waitForIdle()
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        assertTrue(bitmap.width > 0 && bitmap.height > 0)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "ui-test-screenshots").apply { mkdirs() }
        File(directory, name).outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        return bitmap
    }
}

@Composable
private fun TestTheme(dark: Boolean = false, content: @Composable () -> Unit) {
    val palette = if (dark) PlumDarkPalette else PlumLightPalette
    CompositionLocalProvider(
        LocalPlumPalette provides palette,
    ) {
        ClaudeWebUITheme(darkTheme = dark) {
            CompositionLocalProvider(LocalReduceMotion provides true, LocalPlumTokens provides plumTokensFor(palette, true)) {
                Surface(content = content)
            }
        }
    }
}
