package com.claudewebui.app.ui.screens.activity

import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.ui.screens.analytics.AnalyticsParser
import com.claudewebui.app.data.repository.MessageRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.util.TimeZone

/**
 * The last 24 hours of real request volume.
 *
 * The Activity screen used to draw `listOf(1f, 1f, 2f, 1f, 3f, 2f, …)` under
 * every tile — a shape that moved but meant nothing. This holds the actual
 * hourly series so the curve either shows what happened or shows nothing.
 */
data class ActivityUiState(
    /** Requests per hour, oldest first; empty until the first load succeeds. */
    val requestsPerHour: List<Float> = emptyList(),
    val requestsToday: Long = 0,
    val tokensToday: Long = 0,
    val isLoading: Boolean = false,
    val error: String? = null,
)

class ActivityViewModel(private val api: ApiClient, private val messages: MessageRepository) : ViewModel() {
    val outbox = messages.observePendingOutbox()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun discardFailed(clientMessageId: String) {
        viewModelScope.launch { messages.discardFailedOutbox(clientMessageId) }
    }


    private val _uiState = MutableStateFlow(ActivityUiState())
    val uiState: StateFlow<ActivityUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        if (_uiState.value.isLoading) return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val tz = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
            apiCall {
                val summary = api.getAnalyticsSummary("24h", tz).data as? JsonObject
                    ?: error("analytics unavailable")
                val timeline = api.getAnalyticsTimeline("24h", tz).data as? JsonArray
                    ?: JsonArray(emptyList())
                AnalyticsParser.parse(summary, timeline)
            }.onSuccess { parsed ->
                _uiState.value = ActivityUiState(
                    requestsPerHour = parsed.timeline.map { it.requestCount.toFloat() },
                    requestsToday = parsed.summary.totalRequests,
                    tokensToday = parsed.summary.totalTokens,
                    isLoading = false,
                )
            }.onFailure { error ->
                // A dead analytics query must not blank the screen; the tiles
                // above it come from the session list and are still true.
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = error.screenErrorMessage("activity", "refresh"),
                )
            }
        }
    }
}
