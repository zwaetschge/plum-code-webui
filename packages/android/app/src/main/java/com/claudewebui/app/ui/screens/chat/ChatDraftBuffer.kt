package com.claudewebui.app.ui.screens.chat

/** Captures ownership before asynchronous saves, loads and sends begin. */
internal class ChatDraftBuffer {
    data class Snapshot(val chatId: String?, val text: String, val revision: Long)
    private val drafts = mutableMapOf<String?, Snapshot>()
    private var revision = 0L

    fun get(chatId: String?): Snapshot? = drafts[chatId]
    fun edit(chatId: String?, text: String): Snapshot =
        Snapshot(chatId, text, ++revision).also { drafts[chatId] = it }

    fun restore(chatId: String?, text: String, expected: Snapshot?): Snapshot? {
        if (drafts[chatId] != expected) return null
        return edit(chatId, text)
    }

    fun clearIfUnchanged(sent: Snapshot): Snapshot? {
        if (drafts[sent.chatId] != sent) return null
        return edit(sent.chatId, "")
    }
}
