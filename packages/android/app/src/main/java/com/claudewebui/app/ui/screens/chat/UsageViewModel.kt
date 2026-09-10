package com.claudewebui.app.ui.screens.chat

import android.content.Context
import com.claudewebui.app.R
import com.claudewebui.app.core.network.apiCall

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.UsageData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class UsageUiState(
    val usageData: UsageData? = null,
    // List of (messageIndex, cumulativeTokens) pairs for chart
    val usageHistory: List<Pair<Int, Long>> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class UsageViewModel(
    private val sessionId: String,
    private val apiClient: ApiClient,
    private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(UsageUiState())
    val uiState: StateFlow<UsageUiState> = _uiState.asStateFlow()

    init {
        refreshUsage()
    }

    fun refreshUsage() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            apiCall {
                val response = apiClient.getSessionUsage(sessionId)
                if (response.success && response.data != null) {
                    // /api/analytics/sessions/:id shape: {session, totals{...},
                    // history[{total_tokens, model, ...}], events}
                    val root = response.data.jsonObject
                    val totals = root["totals"]?.jsonObject
                    val historyArray = root["history"]?.jsonArray
                    val latestModel = historyArray?.firstOrNull()
                        ?.jsonObject?.get("model")?.jsonPrimitive?.content
                    val usageData = totals?.let { t ->
                        UsageData(
                            sessionId = sessionId,
                            inputTokens = t["inputTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            outputTokens = t["outputTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            cacheReadTokens = t["cacheReadTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            cacheCreationTokens = t["cacheCreationTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            totalTokens = t["totalTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            contextWindow = 0L,
                            contextUsedPercent = 0.0,
                            totalCostUsd = t["recordedCost"]?.jsonPrimitive?.doubleOrNull
                                ?: t["totalCost"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                            model = latestModel ?: ""
                        )
                    }
                    // History rows arrive newest-first in snake_case
                    val history = historyArray?.reversed()?.mapIndexed { idx, el ->
                        val tokens = el.jsonObject["total_tokens"]?.jsonPrimitive?.longOrNull ?: 0L
                        Pair(idx, tokens)
                    } ?: emptyList()

                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        usageData = usageData,
                        usageHistory = history
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = response.error?.message ?: appContext.getString(R.string.chat_usage_load_failed)
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
}
