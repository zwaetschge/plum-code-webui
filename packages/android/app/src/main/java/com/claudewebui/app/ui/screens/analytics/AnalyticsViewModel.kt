package com.claudewebui.app.ui.screens.analytics

import com.claudewebui.app.R
import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.UsageLimitProvider
import com.claudewebui.app.data.model.UsageLimitsResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.TimeZone

data class AnalyticsSummary(
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val cacheCreationTokens: Long = 0,
    val totalTokens: Long = 0,
    val totalCostUsd: Double = 0.0,
    val recordedCostUsd: Double = 0.0,
    val costDeltaUsd: Double = 0.0,
    val totalRequests: Long = 0,
    val pricingCoveragePercent: Int = 100,
    val unpricedTokens: Long = 0,
    val contextSnapshots: Long = 0,
    val compactEvents: Long = 0,
    val latestContextPercent: Double = 0.0,
    val windowLabel: String = "",
)

data class ProviderUsageItem(
    val name: String,
    val tokenCount: Long,
    val requestCount: Long,
    val modelCount: Int,
    val costUsd: Double,
    val unpricedTokens: Long,
    val color: Long,
)

data class ModelUsageItem(
    val modelName: String,
    val providerName: String,
    val tokenCount: Long,
    val requestCount: Long,
    val costUsd: Double,
    val pricingKnown: Boolean,
    val percentage: Float,
    val color: Long,
)

data class CostPoint(
    val label: String,
    val inputTokens: Long,
    val outputTokens: Long,
    val cacheReadTokens: Long,
    val cacheCreationTokens: Long,
    val tokenCount: Long,
    val costUsd: Double,
    val requestCount: Long,
)

// Kept for the reusable legacy chart primitives. The production analytics
// screen no longer fabricates either dataset.
data class ActivityDay(
    val dayLabel: String,
    val date: String,
    val messageCount: Int,
    val sessionCount: Int,
    val maxMessages: Int = 0,
)

data class DurationPoint(
    val label: String,
    val avgDurationMin: Double,
)

data class TopSessionItem(
    val id: String,
    val name: String,
    val tokenCount: Long,
    val requestCount: Long,
    val costUsd: Double,
)

data class MissingPricingItem(
    val modelName: String,
    val providerName: String,
    val tokenCount: Long,
)

enum class AnalyticsTimeRange(private val labelRes: Int, val apiPeriod: String) {
    TODAY(R.string.analytics_24h_02779, "24h"),
    WEEK(R.string.analytics_weekly_158f3, "7d"),
    MONTH(R.string.analytics_monthly_d31ed, "30d"),
    ALL(R.string.analytics_all_6a720, "all");

    val label: String
        @androidx.compose.runtime.Composable get() = androidx.compose.ui.res.stringResource(labelRes)

}

/**
 * What the timeline plots.
 *
 * Cache reads are deliberately their own metric rather than a slice of
 * [TOKENS]: with cache hit rates around 98%, putting them in the same absolute
 * stack makes every other series a hairline and the chart unreadable. Split
 * out, both scales are legible — and cache reads are billed at a fraction of
 * the rate anyway, so they are a different kind of number.
 */
enum class AnalyticsChartMetric(private val labelRes: Int) {
    TOKENS(R.string.analytics_tokens_c38c6),
    CACHE(R.string.analytics_cache_50338),
    COST(R.string.analytics_cost_64ae4),
    REQUESTS(R.string.analytics_requests_f7194);

    val label: String
        @androidx.compose.runtime.Composable get() = androidx.compose.ui.res.stringResource(labelRes)

}

/**
 * A provider's live account quota, flattened for display.
 *
 * Providers expose different windows — Codex reports a weekly limit, Claude
 * both a 5-hour session and a weekly one, Z.AI and Kimi add named side quotas
 * like web search — so windows are collected into one list rather than fixed
 * fields. Unsupported providers are kept with [supported] = false so the panel
 * can explain *why* there's no bar instead of silently omitting them.
 */
data class ProviderLimitWindow(
    val label: String,
    val utilizationPercent: Int,
    val resetsAt: String?,
)

data class ProviderLimitItem(
    val providerId: String,
    val providerLabel: String,
    val supported: Boolean,
    val plan: String?,
    val windows: List<ProviderLimitWindow>,
    val color: Long,
    val note: String? = null,
)

data class AnalyticsUiState(
    val isLoading: Boolean = false,
    val isLoaded: Boolean = false,
    val timeRange: AnalyticsTimeRange = AnalyticsTimeRange.WEEK,
    val chartMetric: AnalyticsChartMetric = AnalyticsChartMetric.TOKENS,
    val summary: AnalyticsSummary = AnalyticsSummary(),
    val providerUsage: List<ProviderUsageItem> = emptyList(),
    val modelUsage: List<ModelUsageItem> = emptyList(),
    val timeline: List<CostPoint> = emptyList(),
    val topSessions: List<TopSessionItem> = emptyList(),
    val missingPricing: List<MissingPricingItem> = emptyList(),
    val providerLimits: List<ProviderLimitItem> = emptyList(),
    val limitsLoading: Boolean = false,
    /** Account-wide daily spend limit; numbers alone say nothing without it. */
    val dailyCostLimitUsd: Double? = null,
    /** Spend inside the most recent timeline bucket, compared to that limit. */
    val latestBucketCostUsd: Double = 0.0,
    val error: String? = null,
)

internal data class ParsedAnalytics(
    val summary: AnalyticsSummary,
    val providerUsage: List<ProviderUsageItem>,
    val modelUsage: List<ModelUsageItem>,
    val timeline: List<CostPoint>,
    val topSessions: List<TopSessionItem>,
    val missingPricing: List<MissingPricingItem>,
)

class AnalyticsViewModel(
    private val api: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AnalyticsUiState())
    val uiState: StateFlow<AnalyticsUiState> = _uiState.asStateFlow()
    private var loadJob: Job? = null
    private var limitsJob: Job? = null

    init {
        loadAnalytics(AnalyticsTimeRange.WEEK)
        loadProviderLimits()
    }

    /**
     * Fetch live account quota for every provider that has one.
     *
     * Runs independently of the ledger query: quota comes from upstream APIs
     * that can be slow or unreachable, and a failing one must not take the rest
     * of the analytics screen down with it.
     */
    fun loadProviderLimits() {
        limitsJob?.cancel()
        limitsJob = viewModelScope.launch {
            _uiState.value = _uiState.value.copy(limitsLoading = true)
            val items = coroutineScope {
                UsageLimitProvider.entries
                    .map { provider ->
                        async {
                            val response = apiCall { api.getUsageLimits(provider.id) }.getOrNull()
                            toLimitItem(provider, response)
                        }
                    }
                    .awaitAll()
            }
            _uiState.value = _uiState.value.copy(
                providerLimits = items.filterNotNull(),
                limitsLoading = false,
            )
        }
    }

    private fun toLimitItem(
        provider: UsageLimitProvider,
        response: UsageLimitsResponse?,
    ): ProviderLimitItem? {
        val color = limitColor(provider)
        // A provider we couldn't reach at all is dropped — an unreachable
        // endpoint says nothing about the account, unlike an explicit
        // `supported: false`, which is a real answer worth showing.
        if (response == null) return null

        val data = response.data
        if (!response.supported || data == null) {
            return ProviderLimitItem(
                providerId = provider.id,
                providerLabel = provider.label,
                supported = false,
                plan = null,
                windows = emptyList(),
                color = color,
                note = response.error?.message,
            )
        }

        val windows = buildList {
            data.fiveHour?.let { add(ProviderLimitWindow("5-hour", it.utilization, it.resetsAt)) }
            data.sevenDay?.let { add(ProviderLimitWindow("Weekly", it.utilization, it.resetsAt)) }
            data.sevenDaySonnet?.let {
                add(ProviderLimitWindow("Weekly (Sonnet)", it.utilization, it.resetsAt))
            }
            data.additional.forEach { extra ->
                add(ProviderLimitWindow(extra.name, extra.utilization, extra.resetsAt))
            }
        }
        if (windows.isEmpty()) return null

        return ProviderLimitItem(
            providerId = provider.id,
            providerLabel = provider.label,
            supported = true,
            plan = data.subscriptionType?.takeIf { it.isNotBlank() },
            windows = windows,
            color = color,
        )
    }

    private fun limitColor(provider: UsageLimitProvider): Long = when (provider) {
        UsageLimitProvider.CODEX -> 0xFF22C55EL
        UsageLimitProvider.CLAUDE -> 0xFFF97316L
        UsageLimitProvider.ZAI -> 0xFF14B8A6L
        UsageLimitProvider.KIMI -> 0xFF2582EDL
        UsageLimitProvider.ALIBABA -> 0xFFFF8A3DL
    }

    fun selectTimeRange(range: AnalyticsTimeRange) {
        if (_uiState.value.timeRange == range && _uiState.value.isLoaded) return
        loadAnalytics(range)
    }

    fun selectChartMetric(metric: AnalyticsChartMetric) {
        _uiState.value = _uiState.value.copy(chartMetric = metric)
    }

    fun refreshData() {
        loadAnalytics(_uiState.value.timeRange)
        loadProviderLimits()
    }

    /**
     * The account's daily spend threshold. Kept out of the main try/catch: a
     * missing limit only removes a comparison, it must not fail the screen.
     */
    private fun loadSpendLimit() {
        viewModelScope.launch {
            val alerts = apiCall { api.getSettings().data?.usageAlerts }.getOrNull() ?: return@launch
            if (!alerts.enabled) return@launch
            _uiState.value = _uiState.value.copy(dailyCostLimitUsd = alerts.dailyCostUsd)
        }
    }

    /** Fire one sample alert to prove the whole delivery chain works. */
    fun sendTestAlert(onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            val ok = apiCall { api.sendTestNotification() }.isSuccess
            onResult(ok)
        }
    }

    fun loadAnalytics(timeRange: AnalyticsTimeRange) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                error = null,
                timeRange = timeRange,
            )

            try {
                val timezoneOffsetMinutes = TimeZone.getDefault()
                    .getOffset(System.currentTimeMillis()) / 60_000
                val parsed = coroutineScope {
                    val summaryRequest = async {
                        api.getAnalyticsSummary(timeRange.apiPeriod, timezoneOffsetMinutes)
                    }
                    val timelineRequest = async {
                        api.getAnalyticsTimeline(timeRange.apiPeriod, timezoneOffsetMinutes)
                    }
                    val summaryResponse = summaryRequest.await()
                    val timelineResponse = timelineRequest.await()

                    if (!summaryResponse.success) {
                        error(summaryResponse.error?.message ?: "Analytics summary failed to load")
                    }
                    if (!timelineResponse.success) {
                        error(timelineResponse.error?.message ?: "Analytics timeline failed to load")
                    }

                    val summaryRoot = summaryResponse.data as? JsonObject
                        ?: error("Analytics summary returned an invalid response")
                    val timelineRoot = timelineResponse.data as? JsonArray
                        ?: error("Analytics timeline returned an invalid response")
                    AnalyticsParser.parse(summaryRoot, timelineRoot)
                }

                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    isLoaded = true,
                    summary = parsed.summary,
                    providerUsage = parsed.providerUsage,
                    modelUsage = parsed.modelUsage,
                    timeline = parsed.timeline,
                    topSessions = parsed.topSessions,
                    missingPricing = parsed.missingPricing,
                    latestBucketCostUsd = parsed.timeline.lastOrNull()?.costUsd ?: 0.0,
                )
                loadSpendLimit()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = error.screenErrorMessage("analytics", "loadAnalytics"),
                )
            }
        }
    }
}

internal object AnalyticsParser {
    fun parse(summaryRoot: JsonObject, timelineRoot: JsonArray): ParsedAnalytics {
        val totals = summaryRoot.objectValue("totals")
        val events = summaryRoot.objectValue("events")
        val latestContext = events.objectValue("latestContext")
        val pricingAudit = summaryRoot.objectValue("pricingAudit")
        val window = summaryRoot.objectValue("window")

        val summary = AnalyticsSummary(
            inputTokens = totals.longValue("inputTokens"),
            outputTokens = totals.longValue("outputTokens"),
            cacheReadTokens = totals.longValue("cacheReadTokens"),
            cacheCreationTokens = totals.longValue("cacheCreationTokens"),
            totalTokens = totals.longValue("totalTokens"),
            totalCostUsd = totals.doubleValue("apiEquivalentCost", totals.doubleValue("totalCost")),
            recordedCostUsd = totals.doubleValue("recordedCost"),
            costDeltaUsd = totals.doubleValue("costDelta"),
            totalRequests = totals.longValue("totalRequests"),
            pricingCoveragePercent = totals.longValue("pricingCoveragePercent", 100).toInt(),
            unpricedTokens = totals.longValue("unpricedTokens"),
            contextSnapshots = events.longValue("contextSnapshots"),
            compactEvents = events.longValue("compactEvents"),
            latestContextPercent = latestContext.doubleValue("contextUsedPercent"),
            windowLabel = window.stringValue("label") ?: summaryRoot.stringValue("period").orEmpty(),
        )

        val providerUsage = summaryRoot.arrayValue("byProvider").mapNotNull { element ->
            val item = element as? JsonObject ?: return@mapNotNull null
            val name = item.stringValue("provider") ?: return@mapNotNull null
            ProviderUsageItem(
                name = name,
                tokenCount = item.longValue("total_tokens"),
                requestCount = item.longValue("requests"),
                modelCount = item.longValue("models").toInt(),
                costUsd = item.doubleValue("api_equivalent_cost", item.doubleValue("cost")),
                unpricedTokens = item.longValue("unpriced_tokens"),
                color = providerColor(name),
            )
        }

        val rawModels = summaryRoot.arrayValue("byModel").mapNotNull { element ->
            val item = element as? JsonObject ?: return@mapNotNull null
            val model = item.stringValue("model") ?: "Unknown"
            val provider = item.stringValue("provider") ?: "Other"
            RawModelUsage(
                modelName = model,
                providerName = provider,
                tokenCount = item.longValue("total_tokens"),
                requestCount = item.longValue("requests"),
                costUsd = item.doubleValue("api_equivalent_cost", item.doubleValue("cost")),
                pricingKnown = item.booleanValue("pricing_known", false),
            )
        }
        val totalModelCost = rawModels.sumOf { it.costUsd }
        val totalModelTokens = rawModels.sumOf { it.tokenCount }.coerceAtLeast(1)
        val modelUsage = rawModels.map { model ->
            val share = if (totalModelCost > 0.0) {
                model.costUsd / totalModelCost
            } else {
                model.tokenCount.toDouble() / totalModelTokens
            }
            ModelUsageItem(
                modelName = model.modelName,
                providerName = model.providerName,
                tokenCount = model.tokenCount,
                requestCount = model.requestCount,
                costUsd = model.costUsd,
                pricingKnown = model.pricingKnown,
                percentage = (share * 100.0).toFloat(),
                color = providerColor(model.providerName),
            )
        }

        val timeline = timelineRoot.mapNotNull { element ->
            val item = element as? JsonObject ?: return@mapNotNull null
            CostPoint(
                label = item.stringValue("date") ?: return@mapNotNull null,
                inputTokens = item.longValue("input_tokens"),
                outputTokens = item.longValue("output_tokens"),
                cacheReadTokens = item.longValue("cache_read_tokens"),
                cacheCreationTokens = item.longValue("cache_creation_tokens"),
                tokenCount = item.longValue("total_tokens"),
                costUsd = item.doubleValue("cost"),
                requestCount = item.longValue("requests"),
            )
        }

        val topSessions = summaryRoot.arrayValue("bySession").mapNotNull { element ->
            val item = element as? JsonObject ?: return@mapNotNull null
            TopSessionItem(
                id = item.stringValue("session_id") ?: return@mapNotNull null,
                name = item.stringValue("session_name")?.takeIf { it.isNotBlank() } ?: "Unnamed Session",
                tokenCount = item.longValue("total_tokens"),
                requestCount = item.longValue("requests"),
                costUsd = item.doubleValue("api_equivalent_cost", item.doubleValue("cost")),
            )
        }

        val missingPricing = pricingAudit.arrayValue("missingPricingModels").mapNotNull { element ->
            val item = element as? JsonObject ?: return@mapNotNull null
            MissingPricingItem(
                modelName = item.stringValue("model") ?: return@mapNotNull null,
                providerName = item.stringValue("provider") ?: "Other",
                tokenCount = item.longValue("tokens"),
            )
        }

        return ParsedAnalytics(
            summary = summary,
            providerUsage = providerUsage,
            modelUsage = modelUsage,
            timeline = timeline,
            topSessions = topSessions,
            missingPricing = missingPricing,
        )
    }

    private data class RawModelUsage(
        val modelName: String,
        val providerName: String,
        val tokenCount: Long,
        val requestCount: Long,
        val costUsd: Double,
        val pricingKnown: Boolean,
    )

    private fun providerColor(provider: String): Long = when (provider.lowercase()) {
        "codex" -> 0xFF22C55EL
        "kimi" -> 0xFF2582EDL
        "opencode" -> 0xFF3B82F6L
        "pi" -> 0xFFA855F7L
        "z.ai", "zai", "z.ai code" -> 0xFF14B8A6L
        "claude", "claude code" -> 0xFFF97316L
        else -> 0xFF94A3B8L
    }

    private fun JsonObject.objectValue(key: String): JsonObject = this[key] as? JsonObject ?: JsonObject(emptyMap())
    private fun JsonObject.arrayValue(key: String): JsonArray = this[key] as? JsonArray ?: JsonArray(emptyList())
    private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.longValue(key: String, fallback: Long = 0): Long =
        (this[key] as? JsonPrimitive)?.longOrNull ?: fallback
    private fun JsonObject.doubleValue(key: String, fallback: Double = 0.0): Double =
        (this[key] as? JsonPrimitive)?.doubleOrNull ?: fallback
    private fun JsonObject.booleanValue(key: String, fallback: Boolean): Boolean =
        (this[key] as? JsonPrimitive)?.booleanOrNull ?: fallback
}
