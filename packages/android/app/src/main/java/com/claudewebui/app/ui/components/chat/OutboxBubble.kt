package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAccentDeep
import com.claudewebui.app.ui.components.common.PlumMuted

/**
 * [chatMissing] means the thread this message was written in no longer exists
 * on the server. Retrying into it can only fail again, so the bubble offers
 * to send into the open chat instead.
 *
 * A failed send always gets a Discard. Without one, a message the server will
 * never accept sat in the transcript until the app was reinstalled.
 */
@Composable
fun OutboxBubble(
    item: OutboxEntity,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    chatMissing: Boolean = false,
    onDiscard: () -> Unit = {},
    onResendHere: () -> Unit = {},
) {
    val componentTokens = PlumTheme.tokens
    val status = item.deliveryStatus
    val statusLabel = when (status) {
        OutboxStatus.SENDING -> if (item.attachments.isNotEmpty()) {
            stringResource(R.string.component_upload_percent, (item.progress.coerceIn(0f, 1f) * 100).toInt())
        } else stringResource(R.string.component_waiting_for_server_confirmation)
        OutboxStatus.ACCEPTED -> when (item.disposition) {
            "queued" -> stringResource(R.string.component_queued)
            else -> stringResource(R.string.component_accepted)
        }
        OutboxStatus.FAILED -> when {
            chatMissing -> stringResource(R.string.component_the_chat_this_was_written_in_no_longer_exists)
            else -> item.error ?: stringResource(R.string.component_delivery_failed)
        }
    }
    val outgoingDescription = stringResource(R.string.component_outgoing_message, statusLabel)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = componentTokens.spacing.cozy, vertical = 3.dp),
        contentAlignment = Alignment.CenterEnd,
    ) {
        // Same glass as a delivered user bubble, just quieter — this *is* a
        // user message, one the server has not taken yet. A different flat
        // tint made it read as a system notice instead.
        val shape = RoundedCornerShape(componentTokens.radius.lg)
        Column(
            modifier = Modifier
                .widthIn(max = 520.dp)
                .clip(shape)
                .background(
                    Brush.verticalGradient(
                        listOf(PlumAccent.copy(alpha = .18f), PlumAccentDeep.copy(alpha = .10f)),
                    ),
                )
                .border(
                    1.dp,
                    if (status == OutboxStatus.FAILED) MaterialTheme.colorScheme.error.copy(alpha = .55f)
                    else PlumAccent.copy(alpha = .35f),
                    shape,
                )
                .padding(horizontal = componentTokens.spacing.cozy, vertical = componentTokens.spacing.compact)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = outgoingDescription
                },
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline),
        ) {
            if (item.content.isNotBlank()) {
                Text(item.content, style = MaterialTheme.typography.bodyMedium)
            }
            item.attachments.forEach { attachment ->
                Text(
                    text = stringResource(R.string.component_named_attachment, attachment.filename),
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = PlumMuted,
                )
            }
            if (status == OutboxStatus.SENDING && item.attachments.isNotEmpty()) {
                LinearProgressIndicator(
                    progress = { item.progress.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline),
            ) {
                Icon(
                    imageVector = when (status) {
                        OutboxStatus.SENDING -> Icons.Outlined.CloudUpload
                        OutboxStatus.ACCEPTED -> Icons.Outlined.CheckCircle
                        OutboxStatus.FAILED -> Icons.Outlined.ErrorOutline
                    },
                    contentDescription = null,
                    tint = if (status == OutboxStatus.FAILED) {
                        MaterialTheme.colorScheme.error
                    } else PlumMuted,
                )
                Text(
                    text = statusLabel,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = if (status == OutboxStatus.FAILED) {
                        MaterialTheme.colorScheme.error
                    } else PlumMuted,
                    fontSize = 11.sp,
                    modifier = Modifier.weight(1f),
                )
                if (status == OutboxStatus.SENDING) {
                    TextButton(onClick = onCancel) { Text(stringResource(R.string.component_cancel)) }
                }
            }
            if (status == OutboxStatus.FAILED) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDiscard) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(componentTokens.sizing.iconInline))
                        Text(stringResource(R.string.component_discard), color = PlumMuted)
                    }
                    when {
                        chatMissing -> TextButton(onClick = onResendHere) {
                            Icon(Icons.Outlined.Send, contentDescription = null, modifier = Modifier.size(componentTokens.sizing.iconInline))
                            Text(stringResource(R.string.component_send_here))
                        }
                        item.retryable -> TextButton(onClick = onRetry) {
                            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(componentTokens.sizing.iconInline))
                            Text(stringResource(R.string.component_retry))
                        }
                    }
                }
            }
        }
    }
}
