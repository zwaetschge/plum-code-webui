package com.claudewebui.app.ui.screens.filemanager

import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FileEditorUiState(
    val path: String = "",
    val original: String = "",
    val draft: String = "",
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val error: String? = null,
    val savedAt: String? = null,
) {
    val hasChanges: Boolean get() = draft != original
    val fileName: String get() = path.substringAfterLast('/')
}

/**
 * View and edit one workspace file.
 *
 * Saving is explicit rather than debounced: unlike a scratch note, writing a
 * source file mid-keystroke could hand a half-typed line to a running harness.
 */
class FileEditorViewModel(
    private val path: String,
    private val api: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FileEditorUiState(path = path))
    val uiState: StateFlow<FileEditorUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = apiCall {
                val response = api.getFileContent(path)
                if (!response.success || response.data == null) {
                    error(response.error?.message ?: "Could not read file")
                }
                response.data
            }
            result
                .onSuccess { file ->
                    _uiState.update {
                        it.copy(
                            original = file.content,
                            draft = file.content,
                            isLoading = false,
                        )
                    }
                }
                .onFailure { failure ->
                    _uiState.update { it.copy(isLoading = false, error = failure.screenErrorMessage("filemanager", "load")) }
                }
        }
    }

    fun onDraftChange(value: String) {
        _uiState.update { it.copy(draft = value) }
    }

    fun save() {
        val state = _uiState.value
        if (!state.hasChanges || state.isSaving) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }
            val result = apiCall {
                val response = api.saveFileContent(path, state.draft)
                if (!response.success) {
                    error(response.error?.message ?: "Could not save file")
                }
            }
            result
                .onSuccess {
                    _uiState.update {
                        // The saved text becomes the new baseline so the
                        // unsaved-changes marker clears.
                        it.copy(original = it.draft, isSaving = false, savedAt = "Saved")
                    }
                }
                .onFailure { failure ->
                    _uiState.update { it.copy(isSaving = false, error = failure.screenErrorMessage("filemanager", "save")) }
                }
        }
    }

    fun revert() {
        _uiState.update { it.copy(draft = it.original) }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
