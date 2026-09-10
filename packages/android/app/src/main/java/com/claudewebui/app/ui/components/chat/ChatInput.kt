package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.claudewebui.app.data.model.PendingFileAttachment
import com.claudewebui.app.data.model.SlashCommand
import com.claudewebui.app.data.model.ActiveFollowupMode
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.glassSurface
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.LocalReduceMotion

@Composable
fun ChatInput(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: (String) -> Unit,
    onAttachFile: (() -> Unit)? = null,
    isWorking: Boolean = false,
    onInterrupt: (() -> Unit)? = null,
    attachments: List<PendingFileAttachment> = emptyList(),
    onRemoveAttachment: ((Int) -> Unit)? = null,
    isPreparingAttachments: Boolean = false,
    attachmentPreparationProgress: Float = 0f,
    activeFollowupMode: ActiveFollowupMode = ActiveFollowupMode.QUEUE,
    onActiveFollowupModeChange: (ActiveFollowupMode) -> Unit = {},
    onCancelDelivery: (() -> Unit)? = null,
    slashCommands: List<SlashCommand> = emptyList(),
    voiceAvailable: Boolean = false,
    isTranscribing: Boolean = false,
    isRecording: Boolean = false,
    onToggleRecording: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    val haptic = LocalHapticFeedback.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val reduceMotion = LocalReduceMotion.current

    // Sending while the agent works is allowed — the server queues the turn.
    val canSend = text.isNotBlank() || attachments.isNotEmpty()
    val charCount = text.length
    val showCharCount = charCount > 800

    // Transparent over the app-wide backdrop; the field itself carries the
    // frosted-glass fill, so no solid bar sits behind the composer.
    // A leading "/" opens the command picker and filters as you type. Only the
    // first word counts — once a space follows, the user is writing arguments.
    val commandQuery = text.takeIf { it.startsWith("/") && !it.contains(' ') && !it.contains('\n') }
    val commandMatches = remember(commandQuery, slashCommands) {
        val prefix = commandQuery?.removePrefix("/")?.lowercase()
        if (prefix == null) {
            emptyList()
        } else {
            slashCommands
                .filter { prefix.isEmpty() || it.name.lowercase().startsWith(prefix) }
                .take(6)
        }
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.Transparent,
    ) {
        Column {
            AnimatedVisibility(
                visible = commandMatches.isNotEmpty(),
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.inline)
                        .clip(RoundedCornerShape(componentTokens.radius.lg))
                        .background(PlumSurfaceStrong)
                        .border(1.dp, PlumBorder, RoundedCornerShape(componentTokens.radius.lg)),
                ) {
                    commandMatches.forEach { command ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    // Trailing space so arguments can follow straight away.
                                    onTextChange("/${command.name} ")
                                }
                                .padding(horizontal = componentTokens.spacing.cozy, vertical = componentTokens.spacing.compact),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "/${command.name}",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = PlumAccent,
                                )
                                if (command.description.isNotBlank()) {
                                    Text(
                                        command.description,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = PlumMuted,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                            Text(
                                command.scope,
                                style = MaterialTheme.typography.labelSmall,
                                color = PlumMuted,
                            )
                        }
                    }
                }
            }

            AnimatedVisibility(visible = isPreparingAttachments) {
                Column(
                    Modifier
                        .padding(horizontal = componentTokens.spacing.lg, vertical = componentTokens.spacing.inline)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                    verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs),
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            stringResource(R.string.component_uploading_attachments),
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumMuted,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "${(attachmentPreparationProgress.coerceIn(0f, 1f) * 100).toInt()}%",
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumMuted,
                        )
                        if (onCancelDelivery != null) {
                            TextButton(
                                onClick = onCancelDelivery,
                                contentPadding = PaddingValues(horizontal = componentTokens.spacing.sm),
                            ) {
                                Text(stringResource(R.string.component_cancel))
                            }
                        }
                    }
                    LinearProgressIndicator(
                        progress = { attachmentPreparationProgress.coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            // Pending attachments
            AnimatedVisibility(
                visible = attachments.isNotEmpty(),
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                    horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                ) {
                    attachments.forEachIndexed { index, attachment ->
                        AttachmentChip(
                            attachment = attachment,
                            onRemove = { onRemoveAttachment?.invoke(index) },
                        )
                    }
                }
            }

            // Character count warning
            AnimatedVisibility(
                visible = showCharCount,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Text(
                    text = stringResource(R.string.component_character_count, charCount),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (charCount > 2000)
                        MaterialTheme.colorScheme.error
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = componentTokens.spacing.lg, top = componentTokens.spacing.inline),
                    fontSize = 11.sp,
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = componentTokens.spacing.compact, vertical = componentTokens.spacing.compact),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            ) {
                // Dictation — same glass circle as the attachment button.
                // Hidden entirely when the server cannot transcribe.
                if (voiceAvailable && onToggleRecording != null) {
                    Box(
                        modifier = Modifier
                            .padding(bottom = componentTokens.spacing.xxs)
                            .size(componentTokens.sizing.touchTarget)
                            .glassSurface(CircleShape)
                            .clickable(enabled = !isTranscribing, onClick = onToggleRecording),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isTranscribing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(componentTokens.sizing.iconInline),
                                strokeWidth = componentTokens.spacing.xxs,
                                color = PlumAccent,
                            )
                        } else {
                            Icon(
                                imageVector = if (isRecording) Icons.Outlined.Stop else Icons.Outlined.Mic,
                                contentDescription = if (isRecording) stringResource(R.string.component_stop_dictation) else stringResource(R.string.component_dictate),
                                tint = if (isRecording) Color(0xFFEF4444) else PlumMuted,
                                modifier = Modifier.size(componentTokens.sizing.iconMd),
                            )
                        }
                    }
                }

                // Attachment button — glass circle flanking the field, base-
                // aligned with it so the row reads as one composed unit.
                if (onAttachFile != null) {
                    Box(
                        modifier = Modifier
                            .padding(bottom = componentTokens.spacing.xxs)
                            .size(componentTokens.sizing.touchTarget)
                            .glassSurface(CircleShape)
                            .clickable(onClick = onAttachFile),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.AttachFile,
                            contentDescription = stringResource(R.string.component_attach_file),
                            tint = PlumMuted,
                            modifier = Modifier.size(componentTokens.sizing.iconMd),
                        )
                    }
                }

                // Text field
                OutlinedTextField(
                    value = text,
                    onValueChange = onTextChange,
                    placeholder = {
                        Text(
                            text = when {
                                !isWorking -> stringResource(R.string.component_message_agent)
                                activeFollowupMode == ActiveFollowupMode.STEER -> stringResource(R.string.component_steer_the_active_turn)
                                else -> stringResource(R.string.component_queue_after_the_active_turn)
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = PlumMuted,
                        )
                    },
                    modifier = Modifier
                        .testTag("chat-composer")
                        .weight(1f)
                        .heightIn(min = componentTokens.sizing.touchTarget, max = 160.dp), // ~6 lines
                    shape = RoundedCornerShape(componentTokens.radius.xl),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        keyboardType = KeyboardType.Text,
                        imeAction = ImeAction.Default, // Allow multiline
                    ),
                    keyboardActions = KeyboardActions.Default,
                    maxLines = 6,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        unfocusedBorderColor = PlumBorder,
                        focusedContainerColor = LocalPlumPalette.current.glassFillTop,
                        unfocusedContainerColor = LocalPlumPalette.current.glassFill,
                        focusedTextColor = PlumText,
                        unfocusedTextColor = PlumText,
                    ),
                )

                // Send / Interrupt button
                val buttonScale by animateFloatAsState(
                    targetValue = if (canSend || isWorking) 1f else 0.85f,
                    animationSpec = if (reduceMotion) snap() else spring(stiffness = Spring.StiffnessMedium),
                    label = "send_scale",
                )

                Box(
                    modifier = Modifier
                        .padding(bottom = componentTokens.spacing.xxs)
                        .size(componentTokens.sizing.touchTarget)
                        .graphicsLayer { scaleX = buttonScale; scaleY = buttonScale }
                        .clip(CircleShape)
                        .background(
                            color = when {
                                canSend -> PlumAccent
                                isWorking -> MaterialTheme.colorScheme.error
                                else -> PlumSurfaceStrong
                            }
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    IconButton(
                        onClick = {
                            if (canSend) {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSend(text)
                                keyboardController?.hide()
                            } else if (isWorking) {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onInterrupt?.invoke()
                            }
                        },
                        modifier = Modifier.fillMaxSize().testTag("chat-send"),
                        enabled = canSend || isWorking,
                    ) {
                        AnimatedContent(
                            targetState = isWorking && !canSend,
                            transitionSpec = {
                                if (reduceMotion) {
                                    fadeIn(animationSpec = snap()) togetherWith fadeOut(animationSpec = snap())
                                } else {
                                    scaleIn(animationSpec = tween(componentTokens.motion.fast)) togetherWith
                                        scaleOut(animationSpec = tween(componentTokens.motion.fast))
                                }
                            },
                            label = "send_icon",
                        ) { working ->
                            Icon(
                                imageVector = if (working) Icons.Outlined.Stop else Icons.Filled.Send,
                                contentDescription = when {
                                    working -> stringResource(R.string.component_stop_active_turn)
                                    isWorking && activeFollowupMode == ActiveFollowupMode.STEER -> stringResource(R.string.component_steer_agent_now)
                                    isWorking -> stringResource(R.string.component_queue_message)
                                    else -> stringResource(R.string.component_send_message)
                                },
                                tint = when {
                                    working -> MaterialTheme.colorScheme.onError
                                    canSend -> Color.White
                                    else -> PlumMuted.copy(alpha = 0.38f)
                                },
                                modifier = Modifier.size(componentTokens.sizing.iconInline),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttachmentChip(
    attachment: PendingFileAttachment,
    onRemove: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    val isImage = attachment.mimeType.startsWith("image/")
    val fallbackIcon = when {
        attachment.mimeType == "application/pdf" -> Icons.Outlined.PictureAsPdf
        attachment.mimeType.startsWith("text/") ||
            attachment.mimeType in TEXT_MIME_TYPES -> Icons.Outlined.Description
        else -> Icons.Outlined.InsertDriveFile
    }

    Surface(
        shape = RoundedCornerShape(componentTokens.radius.chip),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        tonalElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(start = componentTokens.spacing.xs, end = componentTokens.spacing.xs, top = componentTokens.spacing.xs, bottom = componentTokens.spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        ) {
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(RoundedCornerShape(componentTokens.spacing.inline))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow),
                contentAlignment = Alignment.Center,
            ) {
                if (isImage) {
                    AsyncImage(
                        model = attachment.uri,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Icon(
                        imageVector = if (isImage) Icons.Outlined.Image else fallbackIcon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(componentTokens.sizing.iconSm),
                    )
                }
            }
            Text(
                text = attachment.filename,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 140.dp),
            )
            IconButton(
                onClick = onRemove,
                modifier = Modifier.size(componentTokens.sizing.touchTarget),
            ) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = stringResource(R.string.component_remove_attachment),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(componentTokens.sizing.iconXs),
                )
            }
        }
    }
}

private val TEXT_MIME_TYPES = setOf(
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/yaml",
    "application/x-sh",
)
