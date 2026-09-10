package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.ui.components.chat.MessageGroupInfo

// ── Display Item Model ────────────────────────────────────────────────────────

/** One row of the transcript. [key] is the stable LazyColumn key. */
internal sealed class DisplayItem {
    abstract val key: String

    data class MessageItem(val message: Message) : DisplayItem() {
        override val key = "msg_${message.id}"
    }
    data class StreamingItem(val text: String) : DisplayItem() {
        override val key = "streaming"
    }
    data class ToolItem(val tool: ToolExecution) : DisplayItem() {
        override val key = "tool_${tool.toolId}"
    }
    data class OutboxItem(val item: OutboxEntity, val chatMissing: Boolean = false) : DisplayItem() {
        override val key = "outbox_${item.clientMessageId}"
    }
    data object UnreadDivider : DisplayItem() {
        override val key = "unread_divider"
    }
}

/**
 * Cached messages, the unread divider, homeless/active outbox rows and the
 * inline tool cards — everything except the streaming row, which the caller
 * appends so this stable part can be remembered across streaming flushes.
 */
internal fun buildDisplayItems(
    messages: List<Message>,
    outbox: List<OutboxEntity>,
    uiState: ChatUiState,
): List<DisplayItem> {
    val items = mutableListOf<DisplayItem>()
    val dividerIndex = unreadDividerIndex(messages, uiState.lastReadMessageId, uiState.unreadCount)
    messages.forEachIndexed { index, msg ->
        if (index == dividerIndex) items.add(DisplayItem.UnreadDivider)
        items.add(DisplayItem.MessageItem(msg))
    }

    val persistedClientIds = messages.mapNotNullTo(hashSetOf()) { it.clientMessageId }
    // The outbox is per session, but a send belongs to one thread. Showing it
    // in every chat of the session made a single failed message haunt all of
    // them. A send whose thread was deleted has no home any more, so it
    // surfaces in whichever chat is open, flagged, with a way to re-target it.
    val knownChats = uiState.chats.mapTo(hashSetOf()) { it.id }
    outbox.asSequence()
        .filterNot { it.clientMessageId in persistedClientIds }
        .forEach { item ->
            val chatMissing = item.chatId != null && knownChats.isNotEmpty() && item.chatId !in knownChats
            val belongsHere = item.chatId == null || uiState.activeChatId == null ||
                item.chatId == uiState.activeChatId
            if (belongsHere || chatMissing) items.add(DisplayItem.OutboxItem(item, chatMissing))
        }

    // Active tools inline
    uiState.activeTools.values
        .sortedBy { it.timestamp }
        .forEach { tool ->
            items.add(DisplayItem.ToolItem(tool))
        }

    return items
}

// ── Group Info ────────────────────────────────────────────────────────────────

internal fun computeGroupInfo(items: List<DisplayItem>, index: Int): MessageGroupInfo {
    val current = items[index] as? DisplayItem.MessageItem ?: return MessageGroupInfo()
    val prev = items.getOrNull(index - 1) as? DisplayItem.MessageItem
    val next = items.getOrNull(index + 1) as? DisplayItem.MessageItem

    return MessageGroupInfo(
        isFirst = prev == null || prev.message.role != current.message.role,
        isLast = next == null || next.message.role != current.message.role,
    )
}
