package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.model.PendingFileAttachment
import com.claudewebui.app.data.model.ActiveFollowupMode
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.data.model.MessageSearchResult
import com.claudewebui.app.data.model.PresenceViewer
import com.claudewebui.app.data.model.PermissionRequest
import com.claudewebui.app.data.model.PermissionRequestData
import com.claudewebui.app.data.model.QuestionRequestEvent
import com.claudewebui.app.data.model.SessionChat
import com.claudewebui.app.data.model.SessionPeerLink
import com.claudewebui.app.data.model.SlashCommand
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.data.model.TodoItem
import com.claudewebui.app.data.model.TurnDiffDetail
import com.claudewebui.app.data.model.TurnDiffSummary
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.UsageData
import com.claudewebui.app.data.model.UsageLimitData

// ── Streaming State ───────────────────────────────────────────────────────────

sealed class StreamingState {
    object Idle : StreamingState()
    data class Streaming(val partialText: String, val messageId: String = "streaming") : StreamingState()
    data class ToolExecuting(val toolName: String, val toolId: String = "") : StreamingState()
    data class AgentRunning(val agentType: String, val description: String? = null) : StreamingState()
    object Complete : StreamingState()
}

// ── Chat UI State ─────────────────────────────────────────────────────────────

data class ChatUiState(
    // Messages
    val isLoadingHistory: Boolean = false,
    val isLoadingOlderHistory: Boolean = false,
    val hasMoreHistory: Boolean = false,
    val hasMoreAfterHistory: Boolean = false,
    val oldestMessageId: String? = null,
    val newestMessageId: String? = null,
    val totalMessageCount: Int = 0,
    /** Increments after an older page is prepended; used to retain scroll. */
    val historyPageVersion: Int = 0,
    val lastHistoryPageSize: Int = 0,

    // Real-time state
    val streamingState: StreamingState = StreamingState.Idle,
    val isThinking: Boolean = false,
    val thinkingStartTime: Long = 0L,
    /** Server-provided activity label ("Writing response", tool name, …). */
    val thinkingLabel: String? = null,
    val activeTools: Map<String, ToolExecution> = emptyMap(),
    /** Retained across turn resets, bounded to the latest 300 tool calls. */
    val toolHistory: Map<String, ToolExecution> = emptyMap(),

    /** Agent task list (`session:todos`) shown in the workbench strip. */
    val todos: List<TodoItem> = emptyList(),

    // Server-side message queue (messages sent while the CLI is busy)
    val queuedCount: Int = 0,
    /** Explicit action for a follow-up submitted while the agent is active. */
    val activeFollowupMode: ActiveFollowupMode = ActiveFollowupMode.QUEUE,

    // Chat threads inside this session
    val chats: List<SessionChat> = emptyList(),
    val activeChatId: String? = null,
    val isSwitchingChat: Boolean = false,

    // Pending interactive prompts
    val pendingPermission: PermissionRequest? = null,
    val pendingLegacyPermission: PermissionRequestData? = null,
    val pendingQuestion: QuestionRequestEvent? = null,

    // Connection
    val isConnected: Boolean = false,

    // Usage
    val usageData: UsageData? = null,
    val showUsageBanner: Boolean = false,
    /** Live account quota (5h/weekly windows) of the session's provider. */
    val providerLimits: UsageLimitData? = null,

    // Input
    val draftText: String = "",
    val isSending: Boolean = false,
    val pendingAttachments: List<PendingFileAttachment> = emptyList(),
    val isPreparingAttachments: Boolean = false,
    val attachmentPreparationProgress: Float = 0f,
    val activeDeliveryId: String? = null,

    // Search and durable jump target
    val isSearchOpen: Boolean = false,
    val searchQuery: String = "",
    val searchResults: List<MessageSearchResult> = emptyList(),
    val isSearching: Boolean = false,
    val searchError: String? = null,
    val jumpTargetMessageId: String? = null,
    val jumpVersion: Int = 0,

    // Cross-device read position / presence
    val lastReadMessageId: String? = null,
    val unreadCount: Int = 0,
    val restoreAnchorMessageId: String? = null,
    val restoreAnchorOffset: Int = 0,
    val presenceViewers: List<PresenceViewer> = emptyList(),

    // Session settings (provider / model / reasoning / mode)
    val sessionMode: SessionMode = SessionMode.AUTO_ACCEPT,
    val availableModels: List<String> = emptyList(),
    /** Slash commands offered by the composer's `/` picker. */
    val slashCommands: List<SlashCommand> = emptyList(),
    /** Working-tree changes per finished turn, newest first. */
    val turnDiffs: List<TurnDiffSummary> = emptyList(),
    val openTurnDiff: TurnDiffDetail? = null,
    /** Sessions linked to this one through the session mesh. */
    val meshPeers: List<SessionPeerLink> = emptyList(),
    /** Server-side transcription available; drives the composer mic button. */
    val voiceAvailable: Boolean = false,
    val isTranscribing: Boolean = false,

    /** Presentation presets selectable per session. */
    val designStyles: List<ConfigSkill> = emptyList(),
    val writingStyles: List<ConfigSkill> = emptyList(),
    val isApplyingSettings: Boolean = false,
    val settingsNotice: String? = null,
    val allowedDirectories: List<String> = emptyList(),
    val directoriesLoading: Boolean = false,

    // UI state
    val error: String? = null,
    val isEditingTitle: Boolean = false,
    /** A transcript export is being fetched for the share sheet. */
    val isExportingTranscript: Boolean = false,
    /** Markdown transcript waiting to be handed to the system share sheet. */
    val pendingShareTranscript: String? = null,
    /** Confirmation text for the transient snackbar. */
    val notice: String? = null,
) {
    val isWorking: Boolean
        get() = isThinking ||
                streamingState is StreamingState.Streaming ||
                streamingState is StreamingState.ToolExecuting ||
                streamingState is StreamingState.AgentRunning ||
                isSending

    val currentToolName: String?
        get() = (streamingState as? StreamingState.ToolExecuting)?.toolName

    val streamingText: String?
        get() = (streamingState as? StreamingState.Streaming)?.partialText
}
