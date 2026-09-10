package com.claudewebui.app.ui.screens.memory

import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.MemoryFile
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MemoryUiState(
    val workingDirectory: String = "",
    val memoryDir: String = "",
    val files: List<MemoryFile> = emptyList(),
    val isLoading: Boolean = true,
    val openPath: String? = null,
    val openName: String = "",
    val original: String = "",
    val draft: String = "",
    val isSaving: Boolean = false,
    val error: String? = null,
) {
    val hasChanges: Boolean get() = draft != original
}

/**
 * Browse and edit the memory files behind a session's working directory.
 *
 * Every call carries `workingDirectory`: the backend derives the memory folder
 * from it rather than from the session id, and omitting it returns 400.
 */
class MemoryViewModel(
    private val workingDirectory: String,
    private val api: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MemoryUiState(workingDirectory = workingDirectory))
    val uiState: StateFlow<MemoryUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            apiCall {
                val response = api.getMemories(workingDirectory)
                if (!response.success || response.data == null) {
                    error(response.error?.message ?: "Could not load memories")
                }
                response.data
            }
                .onSuccess { listing ->
                    _uiState.update {
                        it.copy(
                            memoryDir = listing.memoryDir,
                            files = listing.files.sortedBy { file -> file.name.lowercase() },
                            isLoading = false,
                        )
                    }
                }
                .onFailure { failure ->
                    _uiState.update { it.copy(isLoading = false, error = failure.screenErrorMessage("memory", "load")) }
                }
        }
    }

    fun open(file: MemoryFile) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(openPath = file.path, openName = file.name, draft = "", original = "")
            }
            apiCall {
                val response = api.getMemoryContent(file.path, workingDirectory)
                if (!response.success || response.data == null) {
                    error(response.error?.message ?: "Could not read memory")
                }
                response.data
            }
                .onSuccess { memory ->
                    _uiState.update {
                        it.copy(original = memory.content, draft = memory.content)
                    }
                }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.screenErrorMessage("memory", "open")) } }
        }
    }

    fun closeEditor() {
        _uiState.update { it.copy(openPath = null, openName = "", draft = "", original = "") }
    }

    fun onDraftChange(value: String) {
        _uiState.update { it.copy(draft = value) }
    }

    fun save() {
        val state = _uiState.value
        val path = state.openPath ?: return
        if (!state.hasChanges || state.isSaving) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }
            // The write itself must survive the screen closing mid-flight;
            // otherwise a half-applied edit is indistinguishable from success.
            val result = withContext(NonCancellable) {
                apiCall {
                    val response = api.saveMemoryContent(path, state.draft, workingDirectory)
                    if (!response.success) {
                        error(response.error?.message ?: "Could not save memory")
                    }
                }
            }
            result
                .onSuccess {
                    _uiState.update { it.copy(original = it.draft, isSaving = false) }
                    load()
                }
                .onFailure { failure ->
                    _uiState.update { it.copy(isSaving = false, error = failure.screenErrorMessage("memory", "save")) }
                }
        }
    }

    fun create(rawName: String) {
        val name = rawName.trim().ifBlank { return }
        val fileName = if (name.endsWith(".md")) name else "$name.md"
        viewModelScope.launch {
            apiCall {
                val response = api.createMemory(fileName, "", workingDirectory)
                if (!response.success) {
                    error(response.error?.message ?: "Could not create memory")
                }
            }
                .onSuccess { load() }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.screenErrorMessage("memory", "create")) } }
        }
    }

    fun delete(file: MemoryFile) {
        viewModelScope.launch {
            apiCall {
                val response = api.deleteMemory(file.path, workingDirectory)
                if (!response.success) {
                    error(response.error?.message ?: "Could not delete memory")
                }
            }
                .onSuccess {
                    if (_uiState.value.openPath == file.path) closeEditor()
                    load()
                }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.screenErrorMessage("memory", "delete")) } }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
