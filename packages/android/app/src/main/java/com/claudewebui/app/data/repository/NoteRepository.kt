package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.CreateNoteInput
import com.claudewebui.app.data.model.Note
import com.claudewebui.app.data.model.UpdateNoteInput

/**
 * Session-scoped scratch notes.
 *
 * Not cached locally: notes are small, edited from several clients, and stale
 * copies would be worse than a short load.
 */
class NoteRepository(private val api: ApiClient) {

    suspend fun getForSession(sessionId: String): Result<List<Note>> = apiCall {
        val response = api.getSessionNotes(sessionId)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to load notes")
        }
        response.data
    }

    suspend fun create(sessionId: String, title: String, content: String): Result<Note> = apiCall {
        val response = api.createNote(
            CreateNoteInput(title = title, content = content, sessionId = sessionId)
        )
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create note")
        }
        response.data
    }

    suspend fun update(
        id: String,
        title: String? = null,
        content: String? = null,
        pinned: Boolean? = null,
    ): Result<Note> = apiCall {
        val response = api.updateNote(id, UpdateNoteInput(title, content, pinned))
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update note")
        }
        response.data
    }

    suspend fun delete(id: String): Result<Unit> = apiCall {
        val response = api.deleteNote(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete note")
        }
    }
}
