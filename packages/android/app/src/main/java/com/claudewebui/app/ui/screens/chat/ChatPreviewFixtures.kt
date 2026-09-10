package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.data.model.UsageData

/*
 * Design-preview fixtures: a debug build opening session id "preview" renders
 * these instead of live data so the chat can be styled without a backend.
 */

internal fun previewSession() = Session(
    id = "preview",
    userId = "preview",
    name = "Frontend Refactor",
    workingDirectory = "/workspace/plum-code-webui",
    status = SessionStatus.RUNNING,
    cliProvider = CLIProvider.CODEX,
    createdAt = "2026-08-01T13:33:00Z",
    updatedAt = "2026-08-01T13:36:00Z",
)

internal fun previewChatState() = ChatUiState(
    isConnected = true,
    usageData = UsageData(
        sessionId = "preview",
        inputTokens = 154_200,
        outputTokens = 29_800,
        totalTokens = 184_000,
        contextWindow = 296_000,
        contextUsedPercent = 62.0,
        totalCostUsd = 2.84,
        model = "gpt-5.5",
    ),
)

internal fun previewDisplayItems(): List<DisplayItem> = listOf(
    DisplayItem.MessageItem(
        Message(
            id = "preview-plan",
            sessionId = "preview",
            role = MessageRole.ASSISTANT,
            content = "Here's my plan to simplify the provider selector while maintaining flexibility:\n\n• Create a unified provider config\n• Replace scattered usage with ProviderRegistry\n• Update settings UI to render from registry\n• Migrate existing references and clean up",
            createdAt = "2026-08-01T13:33:00Z",
        )
    ),
    DisplayItem.MessageItem(
        Message(
            id = "preview-user",
            sessionId = "preview",
            role = MessageRole.USER,
            content = "Great! Please simplify the provider selector in Settings and use a compact chip style instead of full rows.",
            createdAt = "2026-08-01T13:35:00Z",
        )
    ),
    DisplayItem.ToolItem(
        ToolExecution(
            toolId = "preview-read",
            toolName = "read_file",
            status = ToolStatus.COMPLETED,
            result = "Read src/ui/settings/ProviderSection.kt",
            timestamp = 1L,
            completedAt = 2L,
        )
    ),
    DisplayItem.ToolItem(
        ToolExecution(
            toolId = "preview-edit",
            toolName = "edit_file",
            status = ToolStatus.STARTED,
            result = "Editing src/ui/settings/ProviderSection.kt",
            timestamp = 3L,
        )
    ),
    DisplayItem.MessageItem(
        Message(
            id = "preview-result",
            sessionId = "preview",
            role = MessageRole.ASSISTANT,
            content = "Provider selector is now simplified to compact chips. Two files updated and tests are ready to run.",
            createdAt = "2026-08-01T13:36:00Z",
        )
    ),
)
