package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.*
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.claudewebui.app.data.model.AttachmentType
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import com.claudewebui.app.ui.theme.LocalPlumPalette

// ── Message Group Metadata ────────────────────────────────────────────────────

data class MessageGroupInfo(
    val isFirst: Boolean = true,
    val isLast: Boolean = true,
)

// ── Main MessageBubble ────────────────────────────────────────────────────────

@Composable
fun MessageBubble(
    message: Message,
    groupInfo: MessageGroupInfo = MessageGroupInfo(),
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
    onAttachmentClick: (HistoryAttachmentItem) -> Unit = {},
    /** Pull this message into the composer as a Markdown quote. */
    onQuote: (String) -> Unit = {},
) {
    val clipboardManager = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current
    var showTimestamp by remember { mutableStateOf(false) }
    var showActions by remember { mutableStateOf(false) }
    var previewImageUrl by remember { mutableStateOf<String?>(null) }

    // A long press that opens a menu should be felt, not just seen — otherwise
    // it reads as an accidental tap until the dialog appears.
    val openActions = {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        showActions = true
    }

    when (message.role) {
        MessageRole.USER -> UserBubble(
            message = message,
            groupInfo = groupInfo,
            modifier = modifier,
            onLongPress = openActions,
            showTimestamp = showTimestamp,
            onTap = { showTimestamp = !showTimestamp },
            onImageClick = { previewImageUrl = it },
            onAttachmentClick = onAttachmentClick,
        )
        MessageRole.ASSISTANT -> AssistantBubble(
            message = message,
            groupInfo = groupInfo,
            modifier = modifier,
            isStreaming = isStreaming,
            onLongPress = openActions,
            showTimestamp = showTimestamp,
            onTap = { showTimestamp = !showTimestamp },
            onImageClick = { previewImageUrl = it },
            onAttachmentClick = onAttachmentClick,
        )
        MessageRole.SYSTEM -> SystemMessage(
            message = message,
            modifier = modifier,
        )
    }

    // Context menu
    if (showActions) {
        MessageActionsDialog(
            message = message,
            onDismiss = { showActions = false },
            onCopy = {
                clipboardManager.setText(AnnotatedString(message.content))
                showActions = false
            },
            onQuote = {
                onQuote(message.content)
                showActions = false
            },
        )
    }


    previewImageUrl?.let { url ->
        FullScreenImageDialog(url = url, onDismiss = { previewImageUrl = null })
    }
}

// ── User Bubble ───────────────────────────────────────────────────────────────

@Composable
private fun UserBubble(
    message: Message,
    groupInfo: MessageGroupInfo,
    modifier: Modifier = Modifier,
    onLongPress: () -> Unit,
    showTimestamp: Boolean,
    onTap: () -> Unit,
    onImageClick: (String) -> Unit,
    onAttachmentClick: (HistoryAttachmentItem) -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = 48.dp,
                end = componentTokens.spacing.lg,
                top = if (groupInfo.isFirst) componentTokens.spacing.sm else componentTokens.spacing.xxs,
                bottom = if (groupInfo.isLast) componentTokens.spacing.sm else componentTokens.spacing.xxs,
            ),
        horizontalAlignment = Alignment.End,
    ) {
        // Image attachments
        val durableFilenames = message.media.orEmpty().mapTo(mutableSetOf()) { it.filename }
        message.images
            ?.filterNot { it.filename in durableFilenames }
            ?.takeIf { it.isNotEmpty() }
            ?.forEach { image ->
                AttachmentImage(
                    path = image.path,
                    onClick = { onImageClick(image.path) },
                    modifier = Modifier
                        .widthIn(max = 240.dp)
                        .padding(bottom = componentTokens.spacing.xs),
                )
            }
        MessageMediaImages(message, onImageClick)
        MessageFileAttachments(message, onAttachmentClick)

        // Text bubble — accent-tinted frosted glass over the backdrop.
        val bubbleShape = RoundedCornerShape(
            topStart = componentTokens.spacing.lg,
            topEnd = if (groupInfo.isFirst) componentTokens.spacing.xs else componentTokens.spacing.lg,
            bottomEnd = if (groupInfo.isLast) componentTokens.spacing.lg else componentTokens.spacing.xs,
            bottomStart = componentTokens.spacing.lg,
        )
        val palette = LocalPlumPalette.current
        if (message.content.isNotBlank()) {
            Box(
                modifier = Modifier
                    .wrapContentWidth()
                    .clip(bubbleShape)
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                palette.accent.copy(alpha = .30f),
                                palette.accentDeep.copy(alpha = .18f),
                            ),
                        ),
                    )
                    .border(1.dp, palette.accent.copy(alpha = .45f), bubbleShape)
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { onTap() },
                            onLongPress = { onLongPress() },
                        )
                    },
            ) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = PlumText,
                    modifier = Modifier.padding(horizontal = componentTokens.spacing.cozy, vertical = componentTokens.spacing.compact),
                )
            }
        }

        // Timestamp
        AnimatedVisibility(visible = showTimestamp) {
            Text(
                text = formatTimestamp(message.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = componentTokens.spacing.xs, end = componentTokens.spacing.xs),
                fontSize = 11.sp,
            )
        }
    }
}

// ── Assistant Bubble ──────────────────────────────────────────────────────────

@Composable
private fun AssistantBubble(
    message: Message,
    groupInfo: MessageGroupInfo,
    modifier: Modifier = Modifier,
    isStreaming: Boolean,
    onLongPress: () -> Unit,
    showTimestamp: Boolean,
    onTap: () -> Unit,
    onImageClick: (String) -> Unit,
    onAttachmentClick: (HistoryAttachmentItem) -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = componentTokens.spacing.md,
                end = componentTokens.spacing.md,
                top = if (groupInfo.isFirst) componentTokens.spacing.sm else componentTokens.spacing.xxs,
                bottom = if (groupInfo.isLast) componentTokens.spacing.sm else componentTokens.spacing.xxs,
            ),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
    ) {
        // Avatar
        if (groupInfo.isFirst) {
            Surface(
                shape = CircleShape,
                color = PlumGreen.copy(alpha = .15f),
                modifier = Modifier.size(34.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = "✦",
                        fontSize = 14.sp,
                        color = PlumGreen,
                    )
                }
            }
        } else {
            Spacer(modifier = Modifier.width(34.dp))
        }

        Column(
            horizontalAlignment = Alignment.Start,
            modifier = Modifier.weight(1f),
        ) {
            // Bubble — frosted glass over the backdrop.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .glassSurface(
                        RoundedCornerShape(
                            topStart = if (groupInfo.isFirst) componentTokens.spacing.xs else componentTokens.spacing.lg,
                            topEnd = componentTokens.spacing.lg,
                            bottomEnd = componentTokens.spacing.lg,
                            bottomStart = if (groupInfo.isLast) componentTokens.spacing.lg else componentTokens.spacing.xs,
                        ),
                    )
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { onTap() },
                            onLongPress = { onLongPress() },
                        )
                    },
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = componentTokens.spacing.cozy, vertical = componentTokens.spacing.md),
                    verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                ) {
                    MessageMediaImages(message, onImageClick)
                    MessageFileAttachments(message, onAttachmentClick)
                    if (message.content.isNotBlank()) {
                        MarkdownContent(
                            text = message.content,
                            isStreaming = isStreaming,
                        )
                    }

                    // Streaming cursor
                    if (isStreaming) {
                        StreamingCursor()
                    }
                }
            }

            // Timestamp
            AnimatedVisibility(visible = showTimestamp) {
                Text(
                    text = formatTimestamp(message.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = componentTokens.spacing.xs, start = componentTokens.spacing.xs),
                    fontSize = 11.sp,
                )
            }
        }
    }
}

// ── System Message ────────────────────────────────────────────────────────────

@Composable
private fun SystemMessage(
    message: Message,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.xxl, vertical = componentTokens.spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = message.content,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

// ── Streaming Cursor ──────────────────────────────────────────────────────────

@Composable
private fun StreamingCursor() {
    val componentTokens = PlumTheme.tokens
    val infiniteTransition = if (PlumTheme.tokens.motion.reduceMotion) null else rememberInfiniteTransition(label = "cursor")
    val alpha by infiniteTransition?.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "cursor_alpha",
    ) ?: androidx.compose.runtime.rememberUpdatedState(1f)
    Box(
        modifier = Modifier
            .size(width = componentTokens.spacing.xxs, height = componentTokens.spacing.lg)
            .background(
                color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                shape = RoundedCornerShape(1.dp),
            )
    )
}

// ── Attachment Image ──────────────────────────────────────────────────────────

@Composable
private fun AttachmentImage(
    path: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    AsyncImage(
        model = path,
        contentDescription = stringResource(R.string.component_attachment),
        contentScale = ContentScale.Crop,
        modifier = modifier
            .clip(RoundedCornerShape(componentTokens.radius.md))
            .clickable(onClick = onClick)
            .aspectRatio(1f),
    )
}

/**
 * Renders the durable `media` list the REST layer hydrates onto messages.
 * Auth comes from the app-wide Coil ImageLoader (see ClaudeWebUIApp).
 */
@Composable
private fun MessageMediaImages(message: Message, onImageClick: (String) -> Unit) {
    val componentTokens = PlumTheme.tokens
    val serverUrl = com.claudewebui.app.core.security.TokenStore.getServerUrl()?.trimEnd('/')
        ?: return
    message.media?.filter { it.mimeType.startsWith("image/") }?.forEach { media ->
        val url = "$serverUrl/api/sessions/${message.sessionId}/media/${media.id}"
        AsyncImage(
            model = url,
            contentDescription = media.altText ?: media.filename,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .widthIn(max = 240.dp)
                .padding(bottom = componentTokens.spacing.xs)
                .clip(RoundedCornerShape(componentTokens.radius.md))
                .clickable { onImageClick(url) }
                .aspectRatio(1f),
        )
    }
}

enum class HistoryAttachmentKind {
    IMAGE,
    PDF,
    TEXT,
    DOCUMENT,
}

data class HistoryAttachmentItem(
    val key: String,
    val mediaId: String? = null,
    val legacyPath: String? = null,
    val filename: String,
    val mimeType: String,
    val byteSize: Long?,
    val kind: HistoryAttachmentKind,
)

internal fun historyFileAttachments(message: Message): List<HistoryAttachmentItem> {
    val durableKeys = message.media.orEmpty().mapTo(mutableSetOf()) {
        it.filename to it.mimeType
    }
    val durable = message.media.orEmpty()
        .filterNot { it.mimeType.startsWith("image/") }
        .map { media ->
            HistoryAttachmentItem(
                key = "media:${media.id}",
                mediaId = media.id,
                filename = media.filename.ifBlank { "attachment" },
                mimeType = media.mimeType,
                byteSize = media.byteSize.takeIf { it > 0 },
                kind = attachmentKind(media.mimeType, null),
            )
        }
    val legacy = message.attachments.orEmpty()
        .filterNot { (it.filename to it.mimeType) in durableKeys }
        .mapIndexed { index, attachment ->
            HistoryAttachmentItem(
                key = "legacy:$index:${attachment.filename}",
                legacyPath = attachment.path,
                filename = attachment.filename.ifBlank { "attachment" },
                mimeType = attachment.mimeType,
                byteSize = null,
                kind = attachmentKind(attachment.mimeType, attachment.type),
            )
        }
    return durable + legacy
}

internal fun attachmentKind(
    mimeType: String,
    legacyType: AttachmentType?,
): HistoryAttachmentKind = when {
    mimeType.startsWith("image/") || legacyType == AttachmentType.IMAGE -> HistoryAttachmentKind.IMAGE
    mimeType == "application/pdf" || legacyType == AttachmentType.PDF -> HistoryAttachmentKind.PDF
    mimeType.startsWith("text/") ||
        mimeType in HISTORY_TEXT_MIME_TYPES ||
        legacyType == AttachmentType.TEXT -> HistoryAttachmentKind.TEXT
    else -> HistoryAttachmentKind.DOCUMENT
}

@Composable
private fun MessageFileAttachments(
    message: Message,
    onAttachmentClick: (HistoryAttachmentItem) -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    val attachments = remember(message.media, message.attachments) {
        historyFileAttachments(message)
    }
    if (attachments.isEmpty()) return

    Column(
        modifier = Modifier.widthIn(max = 280.dp),
        verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
    ) {
        attachments.forEach { attachment ->
            Surface(
                onClick = { onAttachmentClick(attachment) },
                shape = RoundedCornerShape(componentTokens.radius.chip),
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = componentTokens.spacing.compact, vertical = componentTokens.spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                ) {
                    Icon(
                        imageVector = when (attachment.kind) {
                            HistoryAttachmentKind.IMAGE -> Icons.Outlined.Image
                            HistoryAttachmentKind.PDF -> Icons.Outlined.PictureAsPdf
                            HistoryAttachmentKind.TEXT -> Icons.Outlined.Description
                            HistoryAttachmentKind.DOCUMENT -> Icons.Outlined.InsertDriveFile
                        },
                        contentDescription = null,
                        tint = if (attachment.kind == HistoryAttachmentKind.PDF) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                        modifier = Modifier.size(componentTokens.sizing.iconMd),
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = attachment.filename,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = attachmentSubtitle(attachment),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable

private fun attachmentSubtitle(attachment: HistoryAttachmentItem): String {
    val type = when (attachment.kind) {
        HistoryAttachmentKind.IMAGE -> stringResource(R.string.component_image)
        HistoryAttachmentKind.PDF -> stringResource(R.string.component_pdf)
        HistoryAttachmentKind.TEXT -> stringResource(R.string.component_text)
        HistoryAttachmentKind.DOCUMENT -> stringResource(R.string.component_file)
    }
    val size = attachment.byteSize?.let(::formatAttachmentSize)
    return if (size == null) type else "$type · $size"
}

internal fun formatAttachmentSize(bytes: Long): String = when {
    bytes < 1_024 -> "$bytes B"
    bytes < 1_048_576 -> "%.1f KB".format(bytes / 1_024.0)
    else -> "%.1f MB".format(bytes / 1_048_576.0)
}

private val HISTORY_TEXT_MIME_TYPES = setOf(
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/yaml",
    "application/x-sh",
)

// ── Message Actions Dialog ────────────────────────────────────────────────────

@Composable
private fun MessageActionsDialog(
    message: Message,
    onDismiss: () -> Unit,
    onCopy: () -> Unit,
    onQuote: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.component_message_actions)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs)) {
                TextButton(
                    onClick = onCopy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                    Spacer(Modifier.width(componentTokens.spacing.compact))
                    Text(stringResource(R.string.component_copy_text), modifier = Modifier.weight(1f))
                }
                TextButton(
                    onClick = onQuote,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.FormatQuote, contentDescription = null)
                    Spacer(Modifier.width(componentTokens.spacing.compact))
                    Text(stringResource(R.string.component_quote_in_composer), modifier = Modifier.weight(1f))
                }
                TextButton(
                    onClick = {
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, message.content)
                        }
                        context.startActivity(Intent.createChooser(intent, context.getString(R.string.component_share_message)))
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.Share, contentDescription = null)
                    Spacer(Modifier.width(componentTokens.spacing.compact))
                    Text(stringResource(R.string.component_share), modifier = Modifier.weight(1f))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.component_close)) }
        },
    )
}

@Composable
private fun FullScreenImageDialog(url: String, onDismiss: () -> Unit) {
    val componentTokens = PlumTheme.tokens
    var scale by remember(url) { mutableFloatStateOf(1f) }
    var offset by remember(url) { mutableStateOf(Offset.Zero) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(url) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(1f, 5f)
                        offset = if (scale <= 1f) Offset.Zero else offset + pan
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            AsyncImage(
                model = url,
                contentDescription = stringResource(R.string.component_attachment_preview),
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y
                    },
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(componentTokens.spacing.md)
                    .background(Color.Black.copy(alpha = .55f), CircleShape),
            ) {
                Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.component_close_image), tint = Color.White)
            }
        }
    }
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────

@Composable
fun MarkdownContent(
    text: String,
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
) {
    val componentTokens = PlumTheme.tokens
    val parsed = remember(text) { parseMarkdown(text) }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline),
    ) {
        for (block in parsed) {
            when (block) {
                is MarkdownBlock.Paragraph -> {
                    LinkedText(
                        text = block.annotated,
                        style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                is MarkdownBlock.Heading -> {
                    LinkedText(
                        text = block.annotated,
                        style = when (block.level) {
                            1 -> MaterialTheme.typography.titleLarge
                            2 -> MaterialTheme.typography.titleMedium
                            else -> MaterialTheme.typography.titleSmall
                        },
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(top = componentTokens.spacing.xs, bottom = componentTokens.spacing.xxs),
                    )
                }
                is MarkdownBlock.Code -> {
                    CodeBlock(
                        code = block.code,
                        language = block.language,
                    )
                }
                is MarkdownBlock.Blockquote -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = componentTokens.spacing.xxs),
                        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                    ) {
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .background(
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                                    RoundedCornerShape(componentTokens.radius.xxs),
                                )
                        )
                        LinkedText(
                            text = block.annotated,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontStyle = FontStyle.Italic,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                is MarkdownBlock.ListItem -> {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                        modifier = Modifier.padding(start = block.indent.dp),
                    ) {
                        Text(
                            text = if (block.ordered) "${block.number}." else "•",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.width(componentTokens.spacing.section),
                        )
                        LinkedText(
                            text = block.annotated,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                is MarkdownBlock.HorizontalRule -> {
                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = componentTokens.spacing.xs),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                }
                is MarkdownBlock.Table -> MarkdownTable(block)
            }
        }
    }
}

/**
 * Column-major, one line per cell. Laid out as a Row of Columns so every
 * column takes the width of its widest cell and rows stay aligned; a wide
 * table scrolls sideways rather than wrapping cells to different heights,
 * which is what broke row alignment in a row-major attempt.
 */
@Composable
private fun MarkdownTable(table: MarkdownBlock.Table) {
    val componentTokens = PlumTheme.tokens
    val border = MaterialTheme.colorScheme.outlineVariant
    val columnCount = maxOf(table.header.size, table.rows.maxOfOrNull { it.size } ?: 0)
    if (columnCount == 0) return
    val headerFill = MaterialTheme.colorScheme.primary.copy(alpha = .10f)
    val zebra = MaterialTheme.colorScheme.onSurface.copy(alpha = .035f)
    val shape = RoundedCornerShape(componentTokens.radius.chip)
    Row(
        modifier = Modifier
            .padding(vertical = componentTokens.spacing.xs)
            .clip(shape)
            .border(1.dp, border, shape)
            .horizontalScroll(rememberScrollState())
            .height(IntrinsicSize.Min),
    ) {
        for (column in 0 until columnCount) {
            if (column > 0) {
                Box(Modifier.width(1.dp).fillMaxHeight().background(border))
            }
            // IntrinsicSize.Max: inside a horizontal scroller the column has
            // no max width, so a plain fillMaxWidth cell only wrapped its own
            // text and the zebra fill stopped mid-column.
            Column(Modifier.width(IntrinsicSize.Max)) {
                MarkdownTableCell(
                    text = table.header.getOrNull(column) ?: AnnotatedString(""),
                    bold = true,
                    background = headerFill,
                )
                HorizontalDivider(color = border)
                table.rows.forEachIndexed { index, row ->
                    MarkdownTableCell(
                        text = row.getOrNull(column) ?: AnnotatedString(""),
                        bold = false,
                        background = if (index % 2 == 1) zebra else Color.Transparent,
                    )
                }
            }
        }
    }
}

/**
 * Every cell is the same fixed height. The columns are laid out independently,
 * so a cell that measures taller than its neighbours — an inline-code span at
 * a different size, say — would otherwise push its column out of step and the
 * rows drift apart.
 */
@Composable
private fun MarkdownTableCell(text: AnnotatedString, bold: Boolean, background: Color) {
    val componentTokens = PlumTheme.tokens
    val uriHandler = LocalUriHandler.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(componentTokens.spacing.xxl)
            .background(background)
            .padding(horizontal = componentTokens.spacing.compact),
        contentAlignment = Alignment.CenterStart,
    ) {
        ClickableText(
            text = text,
            softWrap = false,
            maxLines = 1,
            style = MaterialTheme.typography.bodySmall.copy(
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
            ),
            onClick = { offset ->
                text.getStringAnnotations(tag = "URL", start = offset, end = offset)
                    .firstOrNull()?.item?.let { url -> runCatching { uriHandler.openUri(url) } }
            },
        )
    }
}

@Composable
private fun LinkedText(
    text: AnnotatedString,
    style: androidx.compose.ui.text.TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val uriHandler = LocalUriHandler.current
    ClickableText(
        text = text,
        style = style.copy(color = color),
        modifier = modifier,
        onClick = { offset ->
            text.getStringAnnotations(tag = "URL", start = offset, end = offset)
                .firstOrNull()
                ?.item
                ?.let { url -> runCatching { uriHandler.openUri(url) } }
        },
    )
}

// ── Markdown Parser ───────────────────────────────────────────────────────────

sealed class MarkdownBlock {
    data class Paragraph(val annotated: AnnotatedString) : MarkdownBlock()
    data class Heading(val level: Int, val annotated: AnnotatedString) : MarkdownBlock()
    data class Code(val code: String, val language: String) : MarkdownBlock()
    data class Blockquote(val annotated: AnnotatedString) : MarkdownBlock()
    data class ListItem(
        val annotated: AnnotatedString,
        val ordered: Boolean,
        val number: Int,
        val indent: Int,
    ) : MarkdownBlock()
    object HorizontalRule : MarkdownBlock()
    data class Table(
        val header: List<AnnotatedString>,
        val rows: List<List<AnnotatedString>>,
    ) : MarkdownBlock()
}

// Compiled once: parseMarkdown runs per bubble per recomposition, and Regex()
// inside the line loop re-compiled these for every single line of every message.
private val MD_HEADING = Regex("^(#{1,6})\\s+(.+)$")
private val MD_HRULE = Regex("[-*_]{3,}")
private val MD_ORDERED_ITEM = Regex("^(\\s*)(\\d+)\\.\\s+(.+)$")
private val MD_UNORDERED_ITEM = Regex("^(\\s*)[-*+]\\s+(.+)$")
private val MD_UNORDERED_LINE = Regex("^\\s*[-*+]\\s+.+")
private val MD_ORDERED_LINE = Regex("^\\s*\\d+\\.\\s+.+")
// `|---|:--:|---:|` and the variants without the outer pipes.
private val MD_TABLE_SEPARATOR = Regex("^\\|?\\s*:?-+:?\\s*(\\|\\s*:?-+:?\\s*)*\\|?\\s*$")

private fun splitTableRow(line: String): List<AnnotatedString> {
    val inner = line.trim().removePrefix("|").removeSuffix("|")
    val cells = mutableListOf<String>()
    val current = StringBuilder()
    var inCode = false
    for (ch in inner) {
        when {
            ch == '`' -> { inCode = !inCode; current.append(ch) }
            ch == '|' && !inCode -> { cells.add(current.toString()); current.setLength(0) }
            else -> current.append(ch)
        }
    }
    cells.add(current.toString())
    return cells.map { parseInline(it.trim()) }
}

fun parseMarkdown(text: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val lines = text.lines()
    var i = 0
    var orderedCounter = 0

    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()

        // Fenced code block ```
        if (trimmed.startsWith("```")) {
            val lang = trimmed.removePrefix("```").trim()
            val codeLines = mutableListOf<String>()
            i++
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                codeLines.add(lines[i])
                i++
            }
            blocks.add(MarkdownBlock.Code(codeLines.joinToString("\n"), lang))
            i++ // skip closing ```
            continue
        }

        // Heading
        val headingMatch = MD_HEADING.matchEntire(trimmed)
        if (headingMatch != null) {
            val level = headingMatch.groupValues[1].length
            val content = headingMatch.groupValues[2]
            blocks.add(MarkdownBlock.Heading(level, parseInline(content)))
            i++
            continue
        }

        // Horizontal rule
        if (trimmed.matches(MD_HRULE)) {
            blocks.add(MarkdownBlock.HorizontalRule)
            i++
            continue
        }

        // Blockquote
        if (trimmed.startsWith("> ")) {
            val content = trimmed.removePrefix("> ")
            blocks.add(MarkdownBlock.Blockquote(parseInline(content)))
            i++
            continue
        }

        // Ordered list item
        val orderedMatch = MD_ORDERED_ITEM.matchEntire(line)
        if (orderedMatch != null) {
            val indent = orderedMatch.groupValues[1].length * 4
            val num = orderedMatch.groupValues[2].toIntOrNull() ?: 1
            val content = orderedMatch.groupValues[3]
            blocks.add(MarkdownBlock.ListItem(parseInline(content), ordered = true, number = num, indent = indent))
            i++
            continue
        }

        // Unordered list item
        val unorderedMatch = MD_UNORDERED_ITEM.matchEntire(line)
        if (unorderedMatch != null) {
            val indent = unorderedMatch.groupValues[1].length * 4
            val content = unorderedMatch.groupValues[2]
            blocks.add(MarkdownBlock.ListItem(parseInline(content), ordered = false, number = 0, indent = indent))
            i++
            continue
        }

        // Blank line
        if (trimmed.isEmpty()) {
            i++
            continue
        }

        // Table: a header row followed by a separator row. Without this the
        // rows collapsed into one paragraph of raw pipes.
        if (trimmed.startsWith("|") && i + 1 < lines.size &&
            MD_TABLE_SEPARATOR.matches(lines[i + 1].trim())
        ) {
            val header = splitTableRow(trimmed)
            i += 2
            val rows = mutableListOf<List<AnnotatedString>>()
            while (i < lines.size && lines[i].trim().startsWith("|")) {
                rows.add(splitTableRow(lines[i]))
                i++
            }
            blocks.add(MarkdownBlock.Table(header, rows))
            continue
        }

        // Paragraph — accumulate consecutive non-special lines
        val paragraphLines = mutableListOf<String>()
        while (i < lines.size) {
            val l = lines[i].trim()
            if (l.isEmpty() || l.startsWith("#") || l.startsWith("```") ||
                l.startsWith("> ") || l.startsWith("|") || l.matches(MD_HRULE) ||
                MD_UNORDERED_LINE.matches(lines[i]) ||
                MD_ORDERED_LINE.matches(lines[i])) break
            paragraphLines.add(lines[i])
            i++
        }
        if (paragraphLines.isNotEmpty()) {
            blocks.add(MarkdownBlock.Paragraph(parseInline(paragraphLines.joinToString(" "))))
        }
    }

    return blocks
}

// ── Inline Markdown Parser ────────────────────────────────────────────────────

fun parseInline(text: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    val len = text.length

    while (i < len) {
        // Bold **text** or __text__
        if (i + 1 < len && ((text[i] == '*' && text[i + 1] == '*') || (text[i] == '_' && text[i + 1] == '_'))) {
            val marker = text.substring(i, i + 2)
            val end = text.indexOf(marker, i + 2)
            if (end > i + 2) {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                    append(text.substring(i + 2, end))
                }
                i = end + 2
                continue
            }
        }

        // Italic *text* or _text_
        if ((text[i] == '*' || text[i] == '_') && (i == 0 || text[i - 1] != text[i])) {
            val marker = text[i]
            val end = text.indexOf(marker, i + 1)
            if (end > i + 1) {
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                    append(text.substring(i + 1, end))
                }
                i = end + 1
                continue
            }
        }

        // Inline code `code`
        if (text[i] == '`') {
            val end = text.indexOf('`', i + 1)
            if (end > i + 1) {
                withStyle(
                    SpanStyle(
                        fontFamily = JetBrainsMonoFamily,
                        fontSize = 13.sp,
                        background = Color(0xFF2D2D2B),
                        color = Color(0xFFCE9178),
                    )
                ) {
                    append(text.substring(i + 1, end))
                }
                i = end + 1
                continue
            }
        }

        // Link [text](url)
        if (text[i] == '[') {
            val closeBracket = text.indexOf(']', i + 1)
            if (closeBracket > i && closeBracket + 1 < len && text[closeBracket + 1] == '(') {
                val closeParen = text.indexOf(')', closeBracket + 2)
                if (closeParen > closeBracket + 2) {
                    val linkText = text.substring(i + 1, closeBracket)
                    val linkUrl = text.substring(closeBracket + 2, closeParen)
                    pushStringAnnotation(tag = "URL", annotation = linkUrl)
                    withStyle(
                        SpanStyle(
                            color = Color(0xFF3B82F6),
                            textDecoration = TextDecoration.Underline,
                        )
                    ) {
                        append(linkText)
                    }
                    pop()
                    i = closeParen + 1
                    continue
                }
            }
        }

        // Strikethrough ~~text~~
        if (i + 1 < len && text[i] == '~' && text[i + 1] == '~') {
            val end = text.indexOf("~~", i + 2)
            if (end > i + 2) {
                withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                    append(text.substring(i + 2, end))
                }
                i = end + 2
                continue
            }
        }

        append(text[i])
        i++
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun formatTimestamp(createdAt: String): String {
    return try {
        // Simplified — in production parse ISO 8601 with DateTimeFormatter
        createdAt.take(16).replace("T", " ")
    } catch (_: Exception) {
        createdAt
    }
}
