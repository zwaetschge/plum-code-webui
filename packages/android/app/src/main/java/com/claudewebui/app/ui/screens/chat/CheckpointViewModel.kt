package com.claudewebui.app.ui.screens.chat

import android.content.Context
import com.claudewebui.app.R
import com.claudewebui.app.core.network.apiCall

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.Checkpoint
import com.claudewebui.app.data.model.CreateCheckpointInput
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CheckpointUiState(
    val checkpoints: List<Checkpoint> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class CheckpointViewModel(
    private val sessionId: String,
    private val apiClient: ApiClient,
    private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CheckpointUiState())
    val uiState: StateFlow<CheckpointUiState> = _uiState.asStateFlow()

    init {
        loadCheckpoints()
    }

    fun loadCheckpoints() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            apiCall {
                val response = apiClient.getCheckpoints(sessionId)
                if (response.success && response.data != null) {
                    _uiState.value = _uiState.value.copy(
                        checkpoints = response.data,
                        isLoading = false
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = response.error?.message ?: appContext.getString(R.string.chat_checkpoints_load_failed)
                    )
                }
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.userMessage(appContext)
                )
            }
        }
    }

    fun createCheckpoint(name: String, description: String?) {
        viewModelScope.launch {
            apiCall {
                apiClient.createCheckpoint(sessionId, CreateCheckpointInput(name, description))
                loadCheckpoints()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.userMessage(appContext))
            }
        }
    }

    fun restoreCheckpoint(checkpoint: Checkpoint) {
        viewModelScope.launch {
            apiCall {
                apiClient.restoreCheckpoint(checkpoint.id)
                loadCheckpoints()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.userMessage(appContext))
            }
        }
    }

    fun deleteCheckpoint(checkpoint: Checkpoint) {
        viewModelScope.launch {
            apiCall {
                apiClient.deleteCheckpoint(checkpoint.id)
                loadCheckpoints()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.userMessage(appContext))
            }
        }
    }
}
