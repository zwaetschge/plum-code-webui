package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import android.Manifest
import android.content.ContentResolver
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.claudewebui.app.core.audio.VoiceRecorder
import com.claudewebui.app.data.model.ActiveFollowupMode
import com.claudewebui.app.data.model.PendingFileAttachment
import com.claudewebui.app.data.model.SlashCommand
import com.claudewebui.app.ui.components.chat.ChatInput
import com.claudewebui.app.ui.components.chat.ThinkingIndicator
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.isShortWindow
import com.claudewebui.app.ui.theme.LocalPlumPalette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The slice of [ChatUiState] the composer reads. */
@Immutable
internal data class ChatComposerState(
    val draftText: String,
    val isWorking: Boolean,
    val pendingAttachments: List<PendingFileAttachment>,
    val isPreparingAttachments: Boolean,
    val attachmentPreparationProgress: Float,
    val activeFollowupMode: ActiveFollowupMode,
    val activeDeliveryId: String?,
    val slashCommands: List<SlashCommand>,
    val voiceAvailable: Boolean,
    val isTranscribing: Boolean,
) {
    companion object {
        fun from(state: ChatUiState) = ChatComposerState(
            draftText = state.draftText,
            isWorking = state.isWorking,
            pendingAttachments = state.pendingAttachments,
            isPreparingAttachments = state.isPreparingAttachments,
            attachmentPreparationProgress = state.attachmentPreparationProgress,
            activeFollowupMode = state.activeFollowupMode,
            activeDeliveryId = state.activeDeliveryId,
            slashCommands = state.slashCommands,
            voiceAvailable = state.voiceAvailable,
            isTranscribing = state.isTranscribing,
        )
    }
}

/** Live-turn facts shown in the strip above the composer. */
@Immutable
internal data class ChatActivityState(
    val needsAttention: Boolean,
    val queuedCount: Int,
    val isThinking: Boolean,
    /** Tool name while one runs, else the server's activity label. */
    val indicatorLabel: String?,
    val thinkingStartTime: Long,
) {
    companion object {
        fun from(state: ChatUiState) = ChatActivityState(
            needsAttention = state.pendingPermission != null ||
                state.pendingLegacyPermission != null ||
                state.pendingQuestion != null,
            queuedCount = state.queuedCount,
            isThinking = state.isThinking,
            indicatorLabel = state.currentToolName ?: state.thinkingLabel,
            thinkingStartTime = state.thinkingStartTime,
        )
    }
}

/** Callbacks the composer needs; remembered once per ViewModel. */
@Stable
internal class ChatComposerActions(
    val onTextChange: (String) -> Unit,
    val onSend: (String) -> Unit,
    val onInterrupt: () -> Unit,
    val onRestart: () -> Unit,
    val onRemoveAttachment: (Int) -> Unit,
    val onActiveFollowupModeChange: (ActiveFollowupMode) -> Unit,
    val onCancelDelivery: (String) -> Unit,
    val onAttachFile: () -> Unit,
    val onToggleRecording: () -> Unit,
)

/**
 * The bottom bar: quick-access row (attention / details / outbox), the
 * thinking indicator and the composer itself in a floating glass dock.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ChatComposerBar(
    composer: ChatComposerState,
    activity: ChatActivityState,
    outboxPendingCount: Int,
    isRecording: Boolean,
    actions: ChatComposerActions,
    onShowAttention: () -> Unit,
    onShowDetails: () -> Unit,
    onShowOutbox: () -> Unit,
    modelLabel: String? = null,
    effortLabel: String? = null,
    onModelEffort: (() -> Unit)? = null,
    /** Task: writing style shown in the `+` menu; null onOpenPreset keeps the plain attach button. */
    presetLabel: String? = null,
    onOpenPreset: (() -> Unit)? = null,
    /** Subagents of the open chat as a bubble beside the model chip; opens Fortschritt. */
    agents: List<com.claudewebui.app.data.model.SubagentRun> = emptyList(),
    onAgents: () -> Unit = {},
    /** Restart icon chip right of the run settings (Task/Code); null hides it. */
    onRestart: (() -> Unit)? = null,
) {
    val t = PlumTheme.tokens
    val palette = LocalPlumPalette.current
    val composerShape = RoundedCornerShape(28.dp)
    // The transcript scrolls behind the dock; at .72 (and still at .92) its
    // text showed through and overlapped the action row and the input hint.
    // Opaque: the glass look stays in the border, shadow and gradient.
    val composerTopAlpha = 1f
    val composerBottomAlpha = 1f
    // Landscape: the action row is squeezed to button height so the
    // transcript keeps more of the ~600dp window.
    val short = isShortWindow()
    val actionPadding = if (short) PaddingValues(horizontal = t.spacing.sm, vertical = 0.dp) else ButtonDefaults.TextButtonContentPadding
    // TextButton enforces a 40dp minimum height; only a fixed height shrinks it.
    val actionModifier = if (short) Modifier.height(32.dp) else Modifier
    Box(
        Modifier.fillMaxWidth().navigationBarsPadding().imePadding(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 960.dp)
                .fillMaxWidth()
                .padding(horizontal = t.spacing.sm, vertical = t.spacing.xs)
                .shadow(8.dp, composerShape, ambientColor = palette.glassShadow, spotColor = palette.glassShadow)
                .clip(composerShape)
                .background(palette.controlSurface.copy(alpha = 1f))
                .border(1.dp, palette.border.copy(alpha = .85f), composerShape),
        ) {
            val showActions = activity.needsAttention || activity.queuedCount > 0 ||
                outboxPendingCount > 0 || composer.isWorking
            // Model and thinking depth live in the chat bar;
            // run state (attention, queue, interrupt) sits beside them, as in the WebUI.
            if (showActions || onModelEffort != null) FlowRow(
                Modifier.fillMaxWidth().padding(start = t.spacing.md, end = t.spacing.md, top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(t.spacing.xs),
                verticalArrangement = Arrangement.Center,
            ) {
                if (activity.needsAttention) {
                    TextButton(onClick = onShowAttention, modifier = actionModifier, contentPadding = actionPadding) { Text(stringResource(R.string.chat_attention), color = PlumAmber) }
                }
                if (activity.queuedCount > 0) TextButton(onClick = onShowDetails, modifier = actionModifier, contentPadding = actionPadding) {
                    Text(stringResource(R.string.chat_details_queue, activity.queuedCount), color = PlumMuted)
                }
                if (outboxPendingCount > 0) TextButton(onClick = onShowOutbox, modifier = actionModifier, contentPadding = actionPadding) {
                    Text(stringResource(R.string.chat_outbox_count, outboxPendingCount), color = PlumMuted)
                }
                if (composer.isWorking) {
                    TextButton(onClick = actions.onInterrupt, modifier = actionModifier, contentPadding = actionPadding) {
                        Text(stringResource(R.string.chat_interrupt), color = MaterialTheme.colorScheme.error)
                    }
                }
                if (agents.isNotEmpty()) AgentsChip(agents, onAgents)
                if (onModelEffort != null) com.claudewebui.app.ui.screens.dashboard.ModelEffortChip(
                    model = modelLabel.orEmpty(), effortLabel = effortLabel, enabled = true, onClick = onModelEffort,
                )
                if (onRestart != null) RestartChip(onRestart)
            }

            // Thinking/tool indicator sits just above input
            ThinkingIndicator(
                isThinking = activity.isThinking,
                toolName = activity.indicatorLabel,
                thinkingStartTime = activity.thinkingStartTime,
            )

            ChatInput(
                text = composer.draftText,
                onTextChange = actions.onTextChange,
                onSend = actions.onSend,
                onAttachFile = actions.onAttachFile,
                isWorking = composer.isWorking,
                onInterrupt = actions.onInterrupt,
                attachments = composer.pendingAttachments,
                onRemoveAttachment = actions.onRemoveAttachment,
                isPreparingAttachments = composer.isPreparingAttachments,
                attachmentPreparationProgress = composer.attachmentPreparationProgress,
                activeFollowupMode = composer.activeFollowupMode,
                onActiveFollowupModeChange = actions.onActiveFollowupModeChange,
                onCancelDelivery = composer.activeDeliveryId?.let { id ->
                    { actions.onCancelDelivery(id) }
                },
                slashCommands = composer.slashCommands,
                voiceAvailable = composer.voiceAvailable,
                isTranscribing = composer.isTranscribing,
                isRecording = isRecording,
                onToggleRecording = actions.onToggleRecording,
                presetLabel = presetLabel,
                onOpenPreset = onOpenPreset,
            )
        }
    }
}

// ── Dictation ─────────────────────────────────────────────────────────────────

/** One recorder per screen, permission asked at first use. */
@Stable
internal class VoiceDictationState internal constructor(
    private val recorder: VoiceRecorder,
    initialPermission: Boolean,
) {
    var isRecording by mutableStateOf(false)
        private set
    private var hasMicPermission by mutableStateOf(initialPermission)
    internal var onAudio: (ByteArray) -> Unit = {}
    internal var requestPermission: () -> Unit = {}

    internal fun onPermissionResult(granted: Boolean) {
        hasMicPermission = granted
        if (granted) isRecording = recorder.start()
    }

    fun toggle() {
        if (isRecording) {
            recorder.stop()?.let { onAudio(it) }
            isRecording = false
        } else if (hasMicPermission) {
            isRecording = recorder.start()
        } else {
            requestPermission()
        }
    }

    internal fun cancel() {
        recorder.cancel()
    }
}

@Composable
internal fun rememberVoiceDictation(onAudio: (ByteArray) -> Unit): VoiceDictationState {
    val context = LocalContext.current
    val state = remember {
        VoiceDictationState(
            recorder = VoiceRecorder(context),
            initialPermission = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO,
            ) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val micPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted -> state.onPermissionResult(granted) }
    state.onAudio = onAudio
    state.requestPermission = { micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }
    DisposableEffect(Unit) {
        onDispose { state.cancel() }
    }
    return state
}

// ── File picker ───────────────────────────────────────────────────────────────

/**
 * System document picker for attachments. Returns the launcher; picked files
 * are inspected off the main thread and reported through the callbacks.
 */
@Composable
internal fun rememberAttachmentPicker(
    onPicked: (List<PendingFileAttachment>) -> Unit,
    onFailure: (failed: Int, total: Int) -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val currentOnPicked by rememberUpdatedState(onPicked)
    val currentOnFailure by rememberUpdatedState(onFailure)
    val pickFilesLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        coroutineScope.launch {
            val attachments = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri ->
                    runCatching {
                        context.contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                    }
                    inspectAttachmentUri(context.contentResolver, uri)
                }
            }
            if (attachments.isNotEmpty()) {
                currentOnPicked(attachments)
            }
            val failed = uris.size - attachments.size
            if (failed > 0) {
                currentOnFailure(failed, uris.size)
            }
        }
    }
    return remember(pickFilesLauncher) { { pickFilesLauncher.launch(arrayOf("*/*")) } }
}

// ── Attachment URI reader ─────────────────────────────────────────────────────

internal fun inspectAttachmentUri(
    resolver: ContentResolver,
    uri: Uri,
): PendingFileAttachment? = runCatching {
    var filename: String? = null
    var byteSize: Long? = null
    // Read metadata before opening the stream. This avoids allocating a 50+ MB
    // array just to discover that the provider already reported it as too big.
    resolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null,
    )?.use { cursor ->
        if (cursor.moveToFirst()) {
            cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                .takeIf { it >= 0 && !cursor.isNull(it) }
                ?.let { filename = cursor.getString(it) }
            cursor.getColumnIndex(OpenableColumns.SIZE)
                .takeIf { it >= 0 && !cursor.isNull(it) }
                ?.let { byteSize = cursor.getLong(it).takeIf { size -> size >= 0 } }
        }
    }
    if (byteSize != null && byteSize!! > MAX_ATTACHMENT_BYTES) return null
    PendingFileAttachment(
        uri = uri.toString(),
        mimeType = resolver.getType(uri) ?: "application/octet-stream",
        filename = filename?.takeIf { it.isNotBlank() } ?: "attachment",
        sizeBytes = byteSize,
    )
}.getOrNull()

@Composable
private fun AgentsChip(runs: List<com.claudewebui.app.data.model.SubagentRun>, onClick: () -> Unit) {
    val palette = LocalPlumPalette.current
    val active = runs.count { it.isActive && it.activity != "waiting" }
    val waiting = runs.count { it.isActive && it.activity == "waiting" }
    val done = runs.count { it.state == "completed" }
    val label = when {
        active > 0 -> stringResource(R.string.agents_chip_active, active)
        waiting > 0 -> stringResource(R.string.agents_chip_waiting, waiting)
        else -> stringResource(R.string.agents_chip_done, done)
    }
    val pulse = if (active > 0) {
        rememberInfiniteTransition(label = "agents").animateFloat(
            initialValue = 1f, targetValue = .45f,
            animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "agentsPulse",
        ).value
    } else 1f
    Surface(
        onClick = onClick,
        shape = androidx.compose.foundation.shape.CircleShape,
        color = palette.segmentTrack,
        border = androidx.compose.foundation.BorderStroke(
            1.dp, if (active > 0) palette.accent.copy(alpha = .5f) else palette.border.copy(alpha = .6f),
        ),
        modifier = Modifier.heightIn(min = 36.dp),
    ) {
        Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.Groups,
                contentDescription = null,
                tint = if (active > 0) palette.accent.copy(alpha = pulse) else palette.muted,
                modifier = Modifier.size(15.dp),
            )
            Spacer(Modifier.width(5.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, color = if (active > 0) palette.text else palette.muted, maxLines = 1)
        }
    }
}

@Composable
private fun RestartChip(onClick: () -> Unit) {
    val palette = LocalPlumPalette.current
    Surface(
        onClick = onClick,
        shape = androidx.compose.foundation.shape.CircleShape,
        color = androidx.compose.ui.graphics.Color.Transparent,
        border = androidx.compose.foundation.BorderStroke(1.dp, palette.border.copy(alpha = .6f)),
        modifier = Modifier.size(36.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.Outlined.RestartAlt,
                contentDescription = stringResource(R.string.chat_restart_session),
                tint = palette.muted,
                modifier = Modifier.size(17.dp),
            )
        }
    }
}
