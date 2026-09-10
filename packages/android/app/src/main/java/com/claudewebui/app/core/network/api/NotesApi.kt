package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** `/api/notes` — notes attached to sessions. */
interface NotesApi {
    /** GET /api/notes/session/:sessionId — notes attached to one session. */
    suspend fun getSessionNotes(sessionId: String): ApiResponse<List<Note>>

    /** POST /api/notes */
    suspend fun createNote(input: CreateNoteInput): ApiResponse<Note>

    /** PATCH /api/notes/:id */
    suspend fun updateNote(id: String, input: UpdateNoteInput): ApiResponse<Note>

    /** DELETE /api/notes/:id */
    suspend fun deleteNote(id: String): ApiResponse<Unit>
}

class NotesApiImpl(private val http: ApiHttp) : NotesApi {

    override suspend fun getSessionNotes(sessionId: String): ApiResponse<List<Note>> =
        http.get("/api/notes/session/$sessionId")

    override suspend fun createNote(input: CreateNoteInput): ApiResponse<Note> =
        http.post("/api/notes") { setBody(input) }

    override suspend fun updateNote(id: String, input: UpdateNoteInput): ApiResponse<Note> =
        http.patch("/api/notes/$id") { setBody(input) }

    override suspend fun deleteNote(id: String): ApiResponse<Unit> =
        http.delete("/api/notes/$id")
}
