package com.claudewebui.app.ui.screens.notes

import com.claudewebui.app.ui.screens.screenErrorMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.data.model.Note
import com.claudewebui.app.data.repository.NoteRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class NotesUiState(
    val notes: List<Note> = emptyList(),
    val isLoading: Boolean = true,
    val editingId: String? = null,
    val draftTitle: String = "",
    val draftContent: String = "",
    val isSaving: Boolean = false,
    val error: String? = null,
)

/**
 * Notes attached to one session.
 *
 * Editing writes back on a debounce rather than on every keystroke — the note
 * body is a free-text field and a request per character would be pointless
 * traffic — and once more when the editor closes so nothing is lost.
 */
class NotesViewModel(
    private val sessionId: String,
    private val repository: NoteRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NotesUiState())
    val uiState: StateFlow<NotesUiState> = _uiState.asStateFlow()

    /** Only the debounce delay is cancellable; see [persistSafely]. */
    private var debounceJob: Job? = null
    private val saveMutex = Mutex()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            repository.getForSession(sessionId)
                .onSuccess { notes -> _uiState.update { it.copy(notes = notes, isLoading = false) } }
                .onFailure { error ->
                    _uiState.update { it.copy(isLoading = false, error = error.screenErrorMessage("notes", "load")) }
                }
        }
    }

    fun startNew() {
        _uiState.update { it.copy(editingId = NEW_NOTE, draftTitle = "", draftContent = "") }
    }

    fun startEditing(note: Note) {
        _uiState.update {
            it.copy(editingId = note.id, draftTitle = note.title, draftContent = note.content)
        }
    }

    fun onTitleChange(value: String) {
        _uiState.update { it.copy(draftTitle = value) }
        scheduleSave()
    }

    fun onContentChange(value: String) {
        _uiState.update { it.copy(draftContent = value) }
        scheduleSave()
    }

    private fun scheduleSave() {
        debounceJob?.cancel()
        debounceJob = viewModelScope.launch {
            delay(900)
            persistSafely()
        }
    }

    /**
     * Run a save so that a later keystroke cannot abort it.
     *
     * Cancelling a job that is suspended inside the create request does not
     * stop the server from creating the note — it only stops the response from
     * being handled, so the new id is lost and the next save creates a second
     * note. NonCancellable keeps the write and its state update together; the
     * mutex stops two saves from both seeing "no id yet".
     */
    private suspend fun persistSafely() = withContext(NonCancellable) {
        saveMutex.withLock { persist() }
    }

    /** Write the draft. Creates on first save, updates afterwards. */
    private suspend fun persist() {
        val state = _uiState.value
        val id = state.editingId ?: return
        if (state.draftTitle.isBlank() && state.draftContent.isBlank()) return

        _uiState.update { it.copy(isSaving = true) }
        val result = if (id == NEW_NOTE) {
            repository.create(sessionId, state.draftTitle, state.draftContent)
        } else {
            repository.update(id, title = state.draftTitle, content = state.draftContent)
        }
        result
            .onSuccess { saved ->
                _uiState.update { current ->
                    val others = current.notes.filterNot { it.id == saved.id }
                    current.copy(
                        notes = listOf(saved) + others,
                        // A freshly created note gets a server id; keep editing it
                        // rather than creating a second note on the next keystroke.
                        editingId = if (current.editingId == NEW_NOTE) saved.id else current.editingId,
                        isSaving = false,
                    )
                }
            }
            .onFailure { error ->
                _uiState.update { it.copy(isSaving = false, error = error.screenErrorMessage("notes", "persist")) }
            }
    }

    fun closeEditor() {
        debounceJob?.cancel()
        viewModelScope.launch {
            persistSafely()
            _uiState.update { it.copy(editingId = null, draftTitle = "", draftContent = "") }
        }
    }

    fun togglePinned(note: Note) {
        viewModelScope.launch {
            repository.update(note.id, pinned = !note.isPinned)
                .onSuccess { load() }
                .onFailure { error -> _uiState.update { it.copy(error = error.screenErrorMessage("notes", "togglePinned")) } }
        }
    }

    fun delete(note: Note) {
        viewModelScope.launch {
            repository.delete(note.id)
                .onSuccess {
                    _uiState.update { current ->
                        current.copy(notes = current.notes.filterNot { it.id == note.id })
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(error = error.screenErrorMessage("notes", "delete")) } }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    private companion object {
        /** Sentinel for a note that has no server id yet. */
        const val NEW_NOTE = "__new__"
    }
}
