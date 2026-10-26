package com.claudewebui.app.ui.screens.dashboard

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.screens.settings.AssistantSettingsPage
import com.claudewebui.app.ui.screens.settings.SettingsStack
import com.claudewebui.app.ui.screens.settings.rememberAssistantSettingsController
import com.claudewebui.app.ui.screens.settings.toStack
import com.claudewebui.app.ui.screens.settings.toStackString
import org.koin.compose.koinInject

/**
 * The assistant part of the settings, opened from the work areas (the tune
 * button in Task/Code, the web workspace header). Same pages as Settings ›
 * Assistent: every change is saved immediately, there is no draft to lose.
 * Back on the first page closes it.
 */
@Composable
fun AssistantPersonalizationScreen(
    onClose: () -> Unit,
    onOpenFeature: (String) -> Unit,
    api: ApiClient = koinInject(),
    startPage: String = "assistant",
) {
    val controller = rememberAssistantSettingsController(api)
    var stackRaw by rememberSaveable { mutableStateOf(startPage) }
    var showTopics by rememberSaveable { mutableStateOf(false) }
    if (showTopics) {
        MemoryTopicsScreen(api, onClose = { showTopics = false }, onOpenFeature = onOpenFeature)
        return
    }
    val stack = stackRaw.toStack("assistant")
    fun push(id: String) { stackRaw = (stack + id).toStackString() }
    fun pop() {
        if (stack.size > 1) stackRaw = stack.dropLast(1).toStackString()
        else { controller?.flush(); onClose() }
    }
    BackHandler(enabled = stack.size == 1) { pop() }
    PlumBackdrop {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            SettingsStack(stack = stack, onPop = ::pop) { id ->
                AssistantSettingsPage(
                    id = id,
                    controller = controller,
                    api = api,
                    contentPadding = PaddingValues(0.dp),
                    onBack = ::pop,
                    push = ::push,
                    openFeature = { path -> controller?.flush(); if (path == "/assistant/memory-topics") showTopics = true else onOpenFeature(path) },
                )
            }
        }
    }
}

internal fun java.io.InputStream.readBytesLimited(max: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val n = read(buffer); if (n < 0) break; require(out.size() + n <= max) { "Datei ist zu gross" }; out.write(buffer, 0, n) }
    return out.toByteArray()
}
