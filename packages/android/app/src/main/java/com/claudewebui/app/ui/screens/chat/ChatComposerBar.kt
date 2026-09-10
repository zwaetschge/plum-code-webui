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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
    val onRemoveAttachment: (Int) -> Unit,
    val onActiveFollowupModeChange: (ActiveFollowupMode) -> Unit,
    val onCancelDelivery: (String) -> Unit,
    val onAttachFile: () -> Unit,
    val onToggleRecording: () -> Unit,
)

/**
 * The bottom bar: quick-access row (attention / details / outbox), the
 * thinking indicator and the composer itself, over a fade so the transcript
 * scrolls in behind it.
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
) {
    val t = PlumTheme.tokens
    // Soft scrim instead of a solid bar: the chat scrolls in behind
    // the composer and fades out under it.
    val palette = LocalPlumPalette.current
    // The fade is a fixed 24dp at the top edge, then solid. Stops
    // expressed as fractions were stretched over the whole node, and
    // the node includes the keyboard and navigation-bar padding — so
    // with the keyboard up the entire visible bar fell inside the
    // transparent start and the transcript read straight through the
    // text field. Clamp keeps the last stop solid past endY.
    Column(Modifier.fillMaxWidth()) {
        // The fade is its own strip *above* the bar, so nothing inside the
        // bar — the diff row, the queue line, the composer — ever sits on
        // a half-transparent scrim. The bar itself is solid.
        Box(
            Modifier
                .fillMaxWidth()
                .height(t.spacing.section)
                .background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        1f to palette.background,
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .background(palette.background)
                .navigationBarsPadding()
                .imePadding(),
        ) {
            FlowRow(
                modifier = Modifier.fillMaxWidth().padding(horizontal = t.spacing.md),
                horizontalArrangement = Arrangement.spacedBy(t.spacing.xs),
            ) {
                if (activity.needsAttention) {
                    TextButton(onClick = onShowAttention) { Text(stringResource(R.string.chat_attention), color = PlumAmber) }
                }
                TextButton(onClick = onShowDetails) {
                    Text(if (activity.queuedCount > 0) stringResource(R.string.chat_details_queue, activity.queuedCount) else stringResource(R.string.chat_details), color = PlumMuted)
                }
                TextButton(onClick = onShowOutbox) {
                    Text(stringResource(R.string.chat_outbox_count, outboxPendingCount), color = PlumMuted)
                }
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
