package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.CliSubagentEntry
import com.claudewebui.app.data.model.PiModelRoute
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.WindowWidth
import com.claudewebui.app.ui.components.common.rememberWindowWidth

/**
 * Debug-only render of the CLI subagent page with fixtures
 * (`claudewebui://preview-subagents`, `?routes=0` for the free-text fallback).
 * Expanded windows get the same 360 dp hub column + detail pane as the real
 * two-pane settings, so the panel is checked at the width it really gets.
 */
@Composable
fun SubagentsPreviewScreen(withRoutes: Boolean = true) {
    val routes = remember(withRoutes) {
        if (!withRoutes) emptyList() else listOf(
            PiModelRoute("deepseek/deepseek-v4-pro", "deepseek", "deepseek-v4-pro", "direct"),
            PiModelRoute("deepseek/deepseek-v4-flash", "deepseek", "deepseek-v4-flash", "direct"),
            PiModelRoute("mistral/deepseek-v4-pro", "mistral", "deepseek-v4-pro", "hosted"),
            PiModelRoute("mistral/devstral-medium-latest", "mistral", "devstral-medium-latest", "direct"),
            PiModelRoute("mistral/zai-glm-5-3", "mistral", "zai-glm-5-3", "hosted"),
        )
    }
    var entries by remember {
        mutableStateOf(
            listOf(
                CliSubagentEntry("1", "GLM-Worker", "zai", "glm-5.3", true),
                CliSubagentEntry("2", "DeepSeek direkt", "pi", "deepseek/deepseek-v4-pro", true),
                CliSubagentEntry("3", "DeepSeek über Mistral", "pi", "mistral/deepseek-v4-pro", true),
                CliSubagentEntry("4", "Alter Pi-Eintrag", "pi", "openrouter/qwen-old", false),
                CliSubagentEntry("5", "Vibe", "vibe", "", true),
            )
        )
    }
    var nextId by remember { mutableStateOf(6) }
    val content: @Composable () -> Unit = {
        CliSubagentsContent(
            entries = entries,
            piRoutes = routes,
            busy = false,
            onEnabled = { id, on -> entries = entries.map { if (it.id == id) it.copy(enabled = on) else it } },
            onModel = { id, model -> entries = entries.map { if (it.id == id) it.copy(model = model) else it } },
            onRemove = { id -> entries = entries.filter { it.id != id } },
            onAdd = { provider, label, model ->
                entries = entries + CliSubagentEntry((nextId++).toString(), label.ifBlank { provider }, provider, model, true)
            },
        )
    }
    PlumBackdrop {
        PlumNavScaffold(MainDestination.SETTINGS, {}) { padding ->
            val insets = androidx.compose.foundation.layout.PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding(),
            )
            val detail: @Composable () -> Unit = {
                SettingsPageScaffold(stringResource(R.string.settings_hub_subagents), onBack = {}, contentPadding = insets) {
                    item(key = "subagents") { content() }
                }
            }
            if (rememberWindowWidth() == WindowWidth.EXPANDED) {
                Row(Modifier.fillMaxSize()) {
                    Box(Modifier.width(360.dp).fillMaxHeight()) {
                        SettingsPageScaffold(stringResource(R.string.settings_settings_c7f73), onBack = null, contentPadding = insets) {
                            item(key = "hub") {
                                SettingsGroup(header = null) {
                                    item { SettingsRow(stringResource(R.string.settings_hub_providers), Icons.Outlined.Hub, TileTone.Blue, onClick = {}) }
                                    item { SettingsRow(stringResource(R.string.settings_hub_subagents), Icons.Outlined.AccountTree, TileTone.Teal, value = entries.size.toString(), onClick = {}) }
                                    item { SettingsRow(stringResource(R.string.settings_hub_appearance), Icons.Outlined.Palette, TileTone.Gray, onClick = {}) }
                                }
                            }
                        }
                    }
                    VerticalDivider(color = PlumBorder)
                    Box(Modifier.weight(1f).fillMaxHeight()) { detail() }
                }
            } else {
                detail()
            }
        }
    }
}
