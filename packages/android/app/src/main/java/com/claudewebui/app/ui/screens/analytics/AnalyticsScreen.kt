package com.claudewebui.app.ui.screens.analytics

import com.claudewebui.app.R
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.Token
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.LocalPlumSnackbar
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.PlumTrackFill
import com.claudewebui.app.ui.components.common.isTabletWidth
import com.claudewebui.app.ui.components.common.metricColumns
import com.claudewebui.app.ui.theme.LocalPlumPalette
import org.koin.compose.viewmodel.koinViewModel
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
fun AnalyticsScreen(
    onNavigateMain: (MainDestination) -> Unit = {},
    designPreview: Boolean = false,
    initialRange: String? = null,
    viewModel: AnalyticsViewModel = koinViewModel(),
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    // Deep links (widgets, usage alerts) preselect the time range once.
    LaunchedEffect(initialRange) {
        val range = when (initialRange) {
            "24h" -> AnalyticsTimeRange.TODAY
            "7d" -> AnalyticsTimeRange.WEEK
            "30d" -> AnalyticsTimeRange.MONTH
            "all" -> AnalyticsTimeRange.ALL
            else -> null
        }
        range?.let { viewModel.selectTimeRange(it) }
    }
    val liveState by viewModel.uiState.collectAsState()
    val state = if (designPreview && BuildConfig.DEBUG) {
        previewAnalyticsState(chartMetric = liveState.chartMetric)
    } else {
        liveState
    }
    val summary = state.summary
    val promptTokens = summary.inputTokens + summary.cacheReadTokens + summary.cacheCreationTokens
    val cacheRate = if (promptTokens > 0) {
        (summary.cacheReadTokens * 100.0 / promptTokens).roundToInt()
    } else {
        0
    }
    val averageCost = if (summary.totalRequests > 0) summary.totalCostUsd / summary.totalRequests else 0.0
    val averageTokens = if (summary.totalRequests > 0) summary.totalTokens / summary.totalRequests else 0
    val effectiveRate = if (summary.totalTokens > 0) {
        summary.totalCostUsd / summary.totalTokens * 1_000_000.0
    } else {
        0.0
    }

    val wide = isTabletWidth()

    PlumBackdrop {
        PlumNavScaffold(MainDestination.ANALYTICS, onNavigateMain) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
                contentPadding = PaddingValues(
                    start = 14.dp,
                    end = 14.dp,
                    top = 4.dp,
                    bottom = 4.dp + padding.calculateBottomPadding(),
                ),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                item {
                    // The window label is the one thing the old hero panel
                    // carried that wasn't restating the screen's own title, so
                    // it moves into the subtitle and the panel is gone.
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.analytics_analytics_25bc9),
                        subtitle = summary.windowLabel.ifBlank { screenResources.getString(R.string.analytics_one_ledger_across_every_provider_cc847) },
                        live = state.isLoaded && state.error == null,
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, screenResources.getString(R.string.analytics_refresh_56e3b), viewModel::refreshData)
                        },
                    )
                }

                item {
                    ProviderLimitsPanel(state.providerLimits, state.limitsLoading)
                }

                state.dailyCostLimitUsd?.let { limit ->
                    item {
                        SpendAgainstLimitPanel(
                            spent = state.latestBucketCostUsd,
                            limit = limit,
                            onTestAlert = { viewModel.sendTestAlert(it) },
                        )
                    }
                }

                item {
                    TimeRangeSelector(state.timeRange, viewModel::selectTimeRange)
                }

                if (state.isLoading && !state.isLoaded) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth().height(150.dp), radius = 20.dp) {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = PlumAccent, strokeWidth = 3.dp)
                            }
                        }
                    }
                }

                state.error?.let { message ->
                    item {
                        ErrorPanel(message, viewModel::refreshData)
                    }
                }

                if (state.isLoaded) {
                    item {
                        // Six tiles, laid out 2-up on a phone and up to 4-up on a
                        // tablet rather than always stacking in fixed pairs.
                        val metrics = listOf(
                            MetricSpec(
                                screenResources.getString(R.string.analytics_total_tokens_e6dad),
                                compactNumber(summary.totalTokens),
                                screenResources.getString(R.string.analytics_1_s_in_2_s_out_05ea8, compactNumber(summary.inputTokens), compactNumber(summary.outputTokens)),
                                Icons.Outlined.Tag,
                                PlumAccent,
                            ),
                            MetricSpec(
                                screenResources.getString(R.string.analytics_api_spend_449eb),
                                formatCurrency(summary.totalCostUsd),
                                screenResources.getString(R.string.analytics_avg_1_s_request_1e8d8, formatCurrency(averageCost)),
                                Icons.Outlined.AttachMoney,
                                PlumGreen,
                            ),
                            MetricSpec(
                                screenResources.getString(R.string.analytics_effective_rate_ea76b),
                                formatCurrency(effectiveRate),
                                screenResources.getString(R.string.analytics_per_1m_total_tokens_91005),
                                Icons.Outlined.Bolt,
                                PlumAmber,
                            ),
                            MetricSpec(
                                screenResources.getString(R.string.analytics_requests_f7194),
                                compactNumber(summary.totalRequests),
                                screenResources.getString(R.string.analytics_avg_1_s_tokens_8b937, compactNumber(averageTokens)),
                                Icons.Outlined.Token,
                                PlumBlue,
                            ),
                            MetricSpec(
                                screenResources.getString(R.string.analytics_cache_efficiency_e5eb1),
                                "$cacheRate%",
                                screenResources.getString(R.string.analytics_1_s_cache_hits_67de3, compactNumber(summary.cacheReadTokens)),
                                Icons.Outlined.Hub,
                                PlumBlue,
                            ),
                            MetricSpec(
                                screenResources.getString(R.string.analytics_pricing_coverage_f1529),
                                "${summary.pricingCoveragePercent}%",
                                screenResources.getString(R.string.analytics_1_s_unpriced_a81ba, compactNumber(summary.unpricedTokens)),
                                Icons.Outlined.AttachMoney,
                                if (summary.unpricedTokens == 0L) PlumGreen else PlumAmber,
                            ),
                        )
                        val perRow = metricColumns()
                        Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
                            metrics.chunked(perRow).forEach { rowMetrics ->
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                                ) {
                                    rowMetrics.forEach { metric ->
                                        AnalyticsMetric(
                                            metric.label,
                                            metric.value,
                                            metric.detail,
                                            metric.icon,
                                            metric.color,
                                            Modifier.weight(1f),
                                        )
                                    }
                                    repeat(perRow - rowMetrics.size) { Box(Modifier.weight(1f)) }
                                }
                            }
                        }
                    }

                    item {
                        UsageTimelinePanel(
                            points = state.timeline,
                            metric = state.chartMetric,
                            onMetricSelected = viewModel::selectChartMetric,
                        )
                    }

                    // These four are short enough to sit two-up once there is
                    // width; stacking them full-width on a tablet just makes
                    // the page long and the lines over-wide.
                    if (wide) {
                        item {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                            ) {
                                Box(Modifier.weight(1f)) {
                                    ProviderMixPanel(state.providerUsage, summary.totalCostUsd)
                                }
                                Box(Modifier.weight(1f)) {
                                    PricingHealthPanel(summary, state.missingPricing)
                                }
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                            ) {
                                Box(Modifier.weight(1f)) { TopModelsPanel(state.modelUsage) }
                                Box(Modifier.weight(1f)) { TopSessionsPanel(state.topSessions) }
                            }
                        }
                    } else {
                        item {
                            ProviderMixPanel(state.providerUsage, summary.totalCostUsd)
                        }

                        item {
                            PricingHealthPanel(summary, state.missingPricing)
                        }

                        item {
                            TopModelsPanel(state.modelUsage)
                        }

                        item {
                            TopSessionsPanel(state.topSessions)
                        }
                    }
                }

                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}

private data class MetricSpec(
    val label: String,
    val value: String,
    val detail: String,
    val icon: ImageVector,
    val color: Color,
)

@Composable
private fun TimeRangeSelector(selected: AnalyticsTimeRange, onSelect: (AnalyticsTimeRange) -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val palette = LocalPlumPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(palette.segmentTrack)
            .border(1.dp, PlumBorder, RoundedCornerShape(18.dp))
            .padding(screenTokens.spacing.xs),
    ) {
        AnalyticsTimeRange.entries.forEach { range ->
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(14.dp))
                    .background(
                        if (selected == range) {
                            Brush.horizontalGradient(listOf(palette.segmentSelected, palette.segmentSelected))
                        } else {
                            Brush.horizontalGradient(listOf(Color.Transparent, Color.Transparent))
                        },
                    )
                    .clickable { onSelect(range) }
                    .padding(vertical = screenTokens.spacing.compact),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    range.label,
                    color = if (selected == range) palette.onSegmentSelected else PlumMuted,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun ErrorPanel(message: String, onRetry: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(screenResources.getString(R.string.analytics_analytics_could_not_be_loaded_44487), color = PlumRed, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text(message, color = PlumMuted, fontSize = 12.sp)
            Text(
                screenResources.getString(R.string.analytics_retry_9f5cd),
                color = PlumText,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(PlumAccent.copy(alpha = .18f))
                    .clickable(onClick = onRetry)
                    .padding(horizontal = screenTokens.spacing.md, vertical = screenTokens.spacing.sm),
            )
        }
    }
}

@Composable
private fun AnalyticsMetric(
    label: String,
    value: String,
    detail: String,
    icon: ImageVector,
    color: Color,
    modifier: Modifier,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(modifier.height(106.dp), radius = 17.dp) {
        Column(Modifier.fillMaxSize().padding(screenTokens.spacing.md), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(label.uppercase(), color = PlumMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = .7.sp, modifier = Modifier.weight(1f))
                Icon(icon, null, tint = color, modifier = Modifier.size(17.dp))
            }
            Text(value, color = PlumText, fontSize = 21.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(detail, color = PlumMuted, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * The daily spend threshold made visible. A cost figure on its own says nothing
 * about whether an alert is about to fire.
 */
@Composable
private fun SpendAgainstLimitPanel(
    spent: Double,
    limit: Double,
    onTestAlert: ((Boolean) -> Unit) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val snackbar = LocalPlumSnackbar.current
    val scope = rememberCoroutineScope()
    val ratio = if (limit > 0) (spent / limit).coerceIn(0.0, 1.0).toFloat() else 0f
    val tint = when {
        ratio >= 1f -> PlumRed
        ratio >= .8f -> PlumAmber
        else -> PlumGreen
    }
    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        screenResources.getString(R.string.analytics_spend_vs_alert_limit_c18ac),
                        color = PlumText,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        screenResources.getString(R.string.analytics_latest_period_against_the_account_threshold_03c36),
                        color = PlumMuted,
                        fontSize = 12.sp,
                    )
                }
                Text(
                    "$${"%.2f".format(spent)} / $${"%.2f".format(limit)}",
                    color = tint,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            LinearProgressIndicator(
                progress = { ratio },
                color = tint,
                trackColor = PlumMuted.copy(alpha = .25f),
                modifier = Modifier.fillMaxWidth().height(7.dp).clip(RoundedCornerShape(4.dp)),
            )
            Text(
                screenResources.getString(R.string.analytics_send_test_alert_7a7b9),
                color = PlumAccent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable {
                    onTestAlert { ok ->
                        scope.launch {
                            snackbar.showSnackbar(
                                if (ok) screenResources.getString(R.string.analytics_test_alert_sent_fd0c9) else screenResources.getString(R.string.analytics_test_alert_failed_45fde),
                            )
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun ProviderLimitsPanel(items: List<ProviderLimitItem>, isLoading: Boolean) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(screenResources.getString(R.string.analytics_provider_limits_8e654), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text(screenResources.getString(R.string.analytics_live_account_quota_per_provider_7307b), color = PlumMuted, fontSize = 12.sp)
                }
                Icon(Icons.Outlined.Speed, null, tint = PlumAccent, modifier = Modifier.size(screenTokens.sizing.iconMd))
            }

            val supported = items.filter { it.supported }
            val unsupported = items.filter { !it.supported }

            when {
                isLoading && items.isEmpty() ->
                    Box(Modifier.fillMaxWidth().height(90.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp, modifier = Modifier.size(26.dp))
                    }

                supported.isEmpty() ->
                    EmptyPanelMessage(screenResources.getString(R.string.analytics_no_provider_reports_account_limits_right_now_2c8d8))

                else -> supported.forEach { item -> ProviderLimitCard(item) }
            }

            if (unsupported.isNotEmpty()) {
                Text(
                    screenResources.getString(R.string.analytics_no_account_quota_1_s_1d52c, unsupported.joinToString(", ") { it.providerLabel }),
                    color = PlumMuted,
                    fontSize = 10.sp,
                )
            }
        }
    }
}

@Composable
private fun ProviderLimitCard(item: ProviderLimitItem) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(PlumSubtleFill)
            .border(1.dp, PlumBorder, RoundedCornerShape(14.dp))
            .padding(screenTokens.spacing.md),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).background(Color(item.color), CircleShape))
            Text(
                "  ${item.providerLabel}",
                color = PlumText,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            item.plan?.let {
                Text(
                    it,
                    color = PlumMuted,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(PlumSubtleFill)
                        .padding(horizontal = screenTokens.spacing.sm, vertical = screenTokens.spacing.xs),
                )
            }
        }
        item.windows.forEach { window -> LimitWindowRow(window, item.color) }
    }
}

@Composable
private fun LimitWindowRow(window: ProviderLimitWindow, providerColor: Long) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val fraction = (window.utilizationPercent / 100f).coerceIn(0f, 1f)
    // Colour by headroom, not by provider: at a glance the user wants to know
    // how close they are to the ceiling, and the provider is already labelled.
    val barColor = when {
        window.utilizationPercent >= 90 -> PlumRed
        window.utilizationPercent >= 70 -> PlumAmber
        else -> Color(providerColor)
    }
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(window.label, color = PlumMuted, fontSize = 11.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            formatResetDelta(window.resetsAt)?.let {
                Text(screenResources.getString(R.string.analytics_resets_1_s_64c5e, it), color = PlumMuted, fontSize = 10.sp)
            }
            Text("${window.utilizationPercent}%", color = barColor, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        Box(Modifier.fillMaxWidth().height(6.dp).background(PlumTrackFill, RoundedCornerShape(6.dp))) {
            Box(Modifier.fillMaxWidth(fraction).height(6.dp).background(barColor, RoundedCornerShape(6.dp)))
        }
    }
}

/**
 * Render an ISO-8601 reset timestamp as a short relative delta ("in 5d 12h").
 *
 * Returns null for missing or unparseable values so callers can just omit the
 * label — a quota bar without a reset time is still useful.
 */
@Composable
private fun formatResetDelta(resetsAt: String?): String? {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    if (resetsAt.isNullOrBlank()) return null
    // Providers are inconsistent: Codex sends `…Z`, Claude sends `…+00:00`.
    // Instant.parse only reliably handles the former, so fall back to the
    // offset-aware parser before giving up.
    val target = runCatching { Instant.parse(resetsAt) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(resetsAt).toInstant() }.getOrNull()
        ?: return null
    val minutes = Duration.between(Instant.now(), target).toMinutes()
    if (minutes <= 0) return screenResources.getString(R.string.analytics_now_c9bc8)
    val days = minutes / (60 * 24)
    val hours = (minutes % (60 * 24)) / 60
    return when {
        days > 0 -> screenResources.getString(R.string.analytics_in_1_sd_2_sh_53cd9, days, hours)
        hours > 0 -> screenResources.getString(R.string.analytics_in_1_sh_2_sm_fc5ff, hours, minutes % 60)
        else -> screenResources.getString(R.string.analytics_in_1_sm_6e9ee, minutes)
    }
}

@Composable
private fun UsageTimelinePanel(
    points: List<CostPoint>,
    metric: AnalyticsChartMetric,
    onMetricSelected: (AnalyticsChartMetric) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val palette = LocalPlumPalette.current
    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
            Text(screenResources.getString(R.string.analytics_usage_over_time_06824), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(
                when (metric) {
                    AnalyticsChartMetric.TOKENS -> screenResources.getString(R.string.analytics_input_output_and_cache_writes_the_tokens_billed_at_full_rate_18393)
                    AnalyticsChartMetric.CACHE -> screenResources.getString(R.string.analytics_cache_reads_charged_at_a_fraction_of_the_input_rate_994ec)
                    AnalyticsChartMetric.COST -> screenResources.getString(R.string.analytics_api_equivalent_spend_per_bucket_f2d10)
                    AnalyticsChartMetric.REQUESTS -> screenResources.getString(R.string.analytics_turns_completed_per_bucket_c7dac)
                },
                color = PlumMuted,
                fontSize = 12.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                AnalyticsChartMetric.entries.forEach { option ->
                    Text(
                        option.label,
                        color = if (metric == option) palette.onSegmentSelected else PlumMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(if (metric == option) palette.segmentSelected else Color.Transparent)
                            .border(1.dp, PlumBorder, RoundedCornerShape(50))
                            .clickable { onMetricSelected(option) }
                            .padding(horizontal = 11.dp, vertical = 7.dp),
                    )
                }
            }
            if (points.isEmpty()) {
                Box(Modifier.fillMaxWidth().height(150.dp), contentAlignment = Alignment.Center) {
                    Text(screenResources.getString(R.string.analytics_no_usage_recorded_for_this_period_f064b), color = PlumMuted, fontSize = 13.sp)
                }
            } else {
                var selected by remember(points, metric) { mutableStateOf<Int?>(null) }
                TimelineChart(
                    points = points,
                    metric = metric,
                    selectedIndex = selected,
                    onSelect = { selected = if (selected == it) null else it },
                    modifier = Modifier.fillMaxWidth().height(200.dp),
                )
                TimelineAxisLabels(points)
                if (metric == AnalyticsChartMetric.TOKENS) {
                    TimelineLegend()
                }
                // Reading a bar off a gridline only gets you an order of
                // magnitude; tapping one gives the actual numbers.
                TimelineReadout(points, selected, metric)
            }
        }
    }
}

/** Segment colours for the stacked token breakdown, in stacking order. */
@Composable
private fun tokenSegmentColors(): List<Pair<String, Color>> = listOf(
    "Input" to PlumBlue,
    "Output" to PlumAccent,
    "Cache write" to PlumAmber,
)

@Composable
private fun TimelineChart(
    points: List<CostPoint>,
    metric: AnalyticsChartMetric,
    selectedIndex: Int?,
    onSelect: (Int) -> Unit,
    modifier: Modifier,
) {
    val palette = LocalPlumPalette.current
    val gridLine = palette.trackFill
    val segments = tokenSegmentColors().map { it.second }
    val flatBar = palette.accent
    val axisTextColor = palette.muted
    val textMeasurer = rememberTextMeasurer()

    // Totals decide the scale; the stack decides how each bar is divided.
    val totals = points.map { point ->
        when (metric) {
            AnalyticsChartMetric.TOKENS ->
                (point.inputTokens + point.outputTokens + point.cacheCreationTokens).toDouble()
            AnalyticsChartMetric.CACHE -> point.cacheReadTokens.toDouble()
            AnalyticsChartMetric.COST -> point.costUsd
            AnalyticsChartMetric.REQUESTS -> point.requestCount.toDouble()
        }
    }
    val max = niceCeiling(totals.maxOrNull() ?: 0.0)
    val gridSteps = 4
    val axisLabels = (0..gridSteps).map { step ->
        formatAxisValue(max * step / gridSteps, metric)
    }
    val axisWidthPx = axisLabels.maxOf {
        textMeasurer.measure(it, style = TextStyle(fontSize = 9.sp)).size.width
    }

    Canvas(
        modifier.pointerInput(points, metric) {
            detectTapGestures { offset ->
                val plotLeft = axisWidthPx + 8.dp.toPx()
                val plotWidth = (size.width - plotLeft).coerceAtLeast(1f)
                val step = plotWidth / points.size.coerceAtLeast(1)
                val index = ((offset.x - plotLeft) / step).toInt()
                if (index in points.indices) onSelect(index)
            }
        }
    ) {
        val plotLeft = axisWidthPx + 8.dp.toPx()
        val plotWidth = (size.width - plotLeft).coerceAtLeast(1f)
        val plotHeight = size.height

        // Gridlines with the value they represent, so bar heights are readable.
        for (step in 0..gridSteps) {
            val y = plotHeight - plotHeight * step / gridSteps
            drawLine(gridLine, Offset(plotLeft, y), Offset(size.width, y), strokeWidth = 1f)
            val layout = textMeasurer.measure(
                axisLabels[step],
                style = TextStyle(fontSize = 9.sp, color = axisTextColor),
            )
            drawText(
                layout,
                topLeft = Offset(
                    axisWidthPx - layout.size.width.toFloat(),
                    (y - layout.size.height / 2f).coerceIn(0f, plotHeight - layout.size.height),
                ),
            )
        }

        val step = plotWidth / points.size.coerceAtLeast(1)
        val barWidth = step * .64f
        points.forEachIndexed { index, point ->
            val x = plotLeft + index * step + step * .18f
            val dimmed = selectedIndex != null && selectedIndex != index

            val parts = when (metric) {
                AnalyticsChartMetric.TOKENS -> listOf(
                    point.inputTokens.toDouble(),
                    point.outputTokens.toDouble(),
                    point.cacheCreationTokens.toDouble(),
                )
                AnalyticsChartMetric.CACHE -> listOf(point.cacheReadTokens.toDouble())
                AnalyticsChartMetric.COST -> listOf(point.costUsd)
                AnalyticsChartMetric.REQUESTS -> listOf(point.requestCount.toDouble())
            }
            val colors = if (metric == AnalyticsChartMetric.TOKENS) segments else listOf(flatBar)

            var cursorY = plotHeight
            parts.forEachIndexed { partIndex, value ->
                if (value <= 0.0) return@forEachIndexed
                val h = (value / max).toFloat() * plotHeight
                cursorY -= h
                drawRect(
                    color = colors[partIndex % colors.size].copy(alpha = if (dimmed) .3f else 1f),
                    topLeft = Offset(x, cursorY),
                    size = Size(barWidth, h),
                )
            }
            if (selectedIndex == index) {
                drawRect(
                    color = axisTextColor,
                    topLeft = Offset(x, 0f),
                    size = Size(barWidth, plotHeight),
                    style = Stroke(width = 1.dp.toPx()),
                )
            }
        }
    }
}

@Composable
private fun TimelineAxisLabels(points: List<CostPoint>) {
    // Three marks — start, middle, end — instead of only the two endpoints.
    val marks = listOfNotNull(
        points.firstOrNull(),
        points.getOrNull(points.size / 2).takeIf { points.size > 2 },
        points.lastOrNull().takeIf { points.size > 1 },
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        marks.forEach { point ->
            Text(shortTimelineLabel(point.label), color = PlumMuted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun TimelineLegend() {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
        tokenSegmentColors().forEach { (label, color) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(color, RoundedCornerShape(2.dp)))
                Text("  $label", color = PlumMuted, fontSize = 10.sp)
            }
        }
    }
}

@Composable
private fun TimelineReadout(
    points: List<CostPoint>,
    selectedIndex: Int?,
    metric: AnalyticsChartMetric,
) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val point = selectedIndex?.let { points.getOrNull(it) }
    if (point == null) {
        Text(screenResources.getString(R.string.analytics_tap_a_bar_for_exact_figures_f75e6), color = PlumMuted, fontSize = 11.sp)
        return
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(13.dp))
            .background(PlumSubtleFill)
            .border(1.dp, PlumBorder, RoundedCornerShape(13.dp))
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(point.label, color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Text(
            screenResources.getString(R.string.analytics_1_s_tokens_2_s_3_s_req_f096d, compactNumber(point.tokenCount), formatCurrency(point.costUsd), point.requestCount),
            color = PlumMuted,
            fontSize = 11.sp,
        )
        if (metric == AnalyticsChartMetric.TOKENS) {
            Text(
                screenResources.getString(R.string.analytics_1_s_in_2_s_out_65307, compactNumber(point.inputTokens), compactNumber(point.outputTokens)) +
                    screenResources.getString(R.string.analytics_1_s_cache_read_2_s_cache_write_f5fb1, compactNumber(point.cacheReadTokens), compactNumber(point.cacheCreationTokens)),
                color = PlumMuted,
                fontSize = 10.sp,
            )
        }
    }
}

/** Round an axis maximum up to a readable 1/2/5 × 10^n step. */
private fun niceCeiling(value: Double): Double {
    if (value <= 0.0) return 1.0
    val magnitude = Math.pow(10.0, floor(log10(value)))
    val normalized = value / magnitude
    val stepped = when {
        normalized <= 1.0 -> 1.0
        normalized <= 2.0 -> 2.0
        normalized <= 5.0 -> 5.0
        else -> 10.0
    }
    return stepped * magnitude
}

private fun formatAxisValue(value: Double, metric: AnalyticsChartMetric): String = when (metric) {
    AnalyticsChartMetric.COST -> if (value >= 1) String.format(Locale.US, "$%.0f", value)
    else String.format(Locale.US, "$%.2f", value)
    else -> compactNumber(value.toLong())
}

@Composable
private fun ProviderMixPanel(items: List<ProviderUsageItem>, totalCost: Double) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Text(screenResources.getString(R.string.analytics_provider_mix_d28e5), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(screenResources.getString(R.string.analytics_share_of_api_equivalent_spend_22cde), color = PlumMuted, fontSize = 12.sp)
            if (items.isEmpty()) {
                EmptyPanelMessage(screenResources.getString(R.string.analytics_no_provider_data_available_44ec8))
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ProviderDonut(items, Modifier.size(116.dp))
                    Column(Modifier.weight(1f).padding(start = 18.dp), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
                        items.take(6).forEach { provider ->
                            val share = providerShare(provider, items, totalCost)
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(8.dp).background(Color(provider.color), CircleShape))
                                Text("  ${provider.name}", color = PlumText, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1)
                                Text("${String.format(Locale.US, "%.1f", share)}%", color = PlumMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }
                Text(screenResources.getString(R.string.analytics_1_s_total_spend_a6b7b, formatCurrency(totalCost)), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                items.forEach { provider ->
                    ProviderDetailRow(provider)
                }
            }
        }
    }
}

@Composable
private fun ProviderDonut(items: List<ProviderUsageItem>, modifier: Modifier) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val totalCost = items.sumOf { it.costUsd }
    val totalTokens = items.sumOf { it.tokenCount }.coerceAtLeast(1)
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            var start = -90f
            items.forEach { item ->
                val share = if (totalCost > 0.0) item.costUsd / totalCost else item.tokenCount.toDouble() / totalTokens
                val sweep = (share * 360.0).toFloat()
                drawArc(Color(item.color), start, sweep, false, style = Stroke(15.dp.toPx()))
                start += sweep
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(compactCurrency(totalCost), color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text(screenResources.getString(R.string.analytics_spend_109e5), color = PlumMuted, fontSize = 8.sp, letterSpacing = .6.sp)
        }
    }
}

@Composable
private fun ProviderDetailRow(provider: ProviderUsageItem) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(PlumSubtleFill).border(1.dp, PlumBorder, RoundedCornerShape(13.dp)).padding(11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).background(Color(provider.color), CircleShape))
        Column(Modifier.weight(1f).padding(start = screenTokens.spacing.compact)) {
            Text(provider.name, color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(screenResources.getString(R.string.analytics_1_s_tokens_2_s_req_3_s_models_ec9e1, compactNumber(provider.tokenCount), provider.requestCount, provider.modelCount), color = PlumMuted, fontSize = 10.sp)
        }
        Text(formatCurrency(provider.costUsd), color = PlumText, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PricingHealthPanel(summary: AnalyticsSummary, missing: List<MissingPricingItem>) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(screenResources.getString(R.string.analytics_pricing_health_f2332), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text(screenResources.getString(R.string.analytics_current_api_rate_card_check_35ee1), color = PlumMuted, fontSize = 12.sp)
                }
                Text(
                    screenResources.getString(R.string.analytics_1_s_priced_3c53a, summary.pricingCoveragePercent),
                    color = if (missing.isEmpty()) PlumGreen else PlumAmber,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
                PricingValue(screenResources.getString(R.string.analytics_stored_api_1bc60), summary.recordedCostUsd, Modifier.weight(1f))
                PricingValue(screenResources.getString(R.string.analytics_recalculated_09a58), summary.totalCostUsd, Modifier.weight(1f))
                PricingValue(screenResources.getString(R.string.analytics_delta_a4cbd), summary.costDeltaUsd, Modifier.weight(1f), signed = true)
            }
            if (missing.isEmpty()) {
                Text(screenResources.getString(R.string.analytics_every_model_in_this_period_matched_a_known_api_price_12681), color = PlumGreen, fontSize = 12.sp)
            } else {
                Text(screenResources.getString(R.string.analytics_missing_model_prices_e2a55), color = PlumAmber, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                missing.take(5).forEach { item ->
                    Text(screenResources.getString(R.string.analytics_1_s_2_s_tokens_02fd7, item.modelName, compactNumber(item.tokenCount)), color = PlumMuted, fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun PricingValue(label: String, value: Double, modifier: Modifier, signed: Boolean = false) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Column(modifier.clip(RoundedCornerShape(screenTokens.radius.md)).background(PlumSubtleFill).padding(screenTokens.spacing.compact)) {
        Text(label.uppercase(), color = PlumMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
        Text(if (signed) formatSignedCurrency(value) else formatCurrency(value), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun TopModelsPanel(models: List<ModelUsageItem>) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Text(screenResources.getString(R.string.analytics_top_models_35f53), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(screenResources.getString(R.string.analytics_highest_api_equivalent_spend_by_model_498c7), color = PlumMuted, fontSize = 12.sp)
            if (models.isEmpty()) {
                EmptyPanelMessage(screenResources.getString(R.string.analytics_no_model_data_available_f18a1))
            } else {
                models.take(8).forEach { model -> ModelRow(model) }
            }
        }
    }
}

@Composable
private fun ModelRow(model: ModelUsageItem) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(PlumSubtleFill).border(1.dp, PlumBorder, RoundedCornerShape(13.dp)).padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(model.modelName, color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(screenResources.getString(R.string.analytics_1_s_2_s_tokens_3_s_req_978ac, model.providerName, compactNumber(model.tokenCount), model.requestCount), color = PlumMuted, fontSize = 10.sp, maxLines = 1)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(formatCurrency(model.costUsd), color = PlumText, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                if (!model.pricingKnown) Text(screenResources.getString(R.string.analytics_missing_price_6a432), color = PlumAmber, fontSize = 9.sp)
            }
        }
        Box(Modifier.fillMaxWidth().height(5.dp).background(PlumTrackFill, RoundedCornerShape(5.dp))) {
            Box(Modifier.fillMaxWidth((model.percentage / 100f).coerceIn(0f, 1f)).height(5.dp).background(Color(model.color), RoundedCornerShape(5.dp)))
        }
    }
}

@Composable
private fun TopSessionsPanel(sessions: List<TopSessionItem>) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {
            Text(screenResources.getString(R.string.analytics_top_sessions_2beaa), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(screenResources.getString(R.string.analytics_sessions_with_the_most_combined_activity_dc59b), color = PlumMuted, fontSize = 12.sp)
            if (sessions.isEmpty()) {
                EmptyPanelMessage(screenResources.getString(R.string.analytics_no_session_usage_available_689f8))
            } else {
                sessions.take(6).forEachIndexed { index, session ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(PlumSubtleFill).border(1.dp, PlumBorder, RoundedCornerShape(13.dp)).padding(11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(28.dp).background(PlumTrackFill, CircleShape), contentAlignment = Alignment.Center) {
                            Text("${index + 1}", color = PlumText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                        Column(Modifier.weight(1f).padding(start = screenTokens.spacing.compact)) {
                            Text(session.name, color = PlumText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(screenResources.getString(R.string.analytics_1_s_tokens_2_s_req_db341, compactNumber(session.tokenCount), session.requestCount), color = PlumMuted, fontSize = 10.sp)
                        }
                        Text(formatCurrency(session.costUsd), color = PlumText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyPanelMessage(message: String) {
    Box(Modifier.fillMaxWidth().height(90.dp), contentAlignment = Alignment.Center) {
        Text(message, color = PlumMuted, fontSize = 12.sp)
    }
}

private fun providerShare(provider: ProviderUsageItem, items: List<ProviderUsageItem>, totalCost: Double): Double {
    if (totalCost > 0.0) return provider.costUsd / totalCost * 100.0
    val totalTokens = items.sumOf { it.tokenCount }.coerceAtLeast(1)
    return provider.tokenCount.toDouble() / totalTokens * 100.0
}

private fun compactNumber(value: Long): String = when {
    value >= 1_000_000_000 -> String.format(Locale.US, "%.1fB", value / 1_000_000_000.0)
    value >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1fk", value / 1_000.0)
    else -> value.toString()
}

private fun formatCurrency(value: Double): String = if (abs(value) >= 100) {
    String.format(Locale.US, "$%,.2f", value)
} else {
    String.format(Locale.US, "$%,.4f", value)
}

private fun formatSignedCurrency(value: Double): String = when {
    abs(value) < .00005 -> formatCurrency(0.0)
    value > 0 -> "+${formatCurrency(value)}"
    else -> "-${formatCurrency(abs(value))}"
}

private fun compactCurrency(value: Double): String = when {
    value >= 1_000_000 -> String.format(Locale.US, "$%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "$%.1fk", value / 1_000.0)
    else -> formatCurrency(value)
}

private fun shortTimelineLabel(value: String): String = when {
    ' ' in value -> value.substringAfter(' ')
    value.length >= 10 -> value.substring(5)
    else -> value
}

private fun previewAnalyticsState(chartMetric: AnalyticsChartMetric): AnalyticsUiState {
    val providers = listOf(
        ProviderUsageItem("Claude", 620_000_000, 96, 2, 1_940.22, 0, 0xFFF97316L),
        ProviderUsageItem("Codex", 410_000_000, 132, 2, 1_105.74, 0, 0xFF22C55EL),
        ProviderUsageItem("Kimi", 92_000_000, 41, 1, 88.14, 0, 0xFF2582EDL),
        ProviderUsageItem("Z.AI", 55_000_000, 38, 1, 71.30, 0, 0xFF14B8A6L),
        ProviderUsageItem("Pi", 16_000_000, 12, 1, 22.95, 0, 0xFFA855F7L),
    )
    val models = listOf(
        ModelUsageItem("claude-opus-5", "Claude", 620_000_000, 96, 1_940.22, true, 60f, 0xFFF97316L),
        ModelUsageItem("gpt-5.6-sol", "Codex", 330_000_000, 101, 890.70, true, 27f, 0xFF22C55EL),
        ModelUsageItem("kimi-code/k3", "Kimi", 92_000_000, 41, 88.14, true, 4f, 0xFF2582EDL),
        ModelUsageItem("gpt-5.6-luna", "Codex", 80_000_000, 31, 215.04, true, 6f, 0xFF22C55EL),
        ModelUsageItem("z-ai/glm-5.2", "Z.AI", 55_000_000, 38, 71.30, true, 2f, 0xFF14B8A6L),
        ModelUsageItem("pi-build", "Pi", 16_000_000, 12, 22.95, true, 1f, 0xFFA855F7L),
    )
    val timeline = listOf(250L, 390L, 350L, 920L, 410L, 530L, 90L).mapIndexed { index, tokens ->
        CostPoint(
            label = "2026-07-${(27 + index).toString().padStart(2, '0')}",
            inputTokens = tokens * 700_000,
            outputTokens = tokens * 100_000,
            cacheReadTokens = tokens * 1_200_000,
            cacheCreationTokens = 0,
            tokenCount = tokens * 2_000_000,
            costUsd = tokens * .86,
            requestCount = 30 + index.toLong() * 4,
        )
    }
    return AnalyticsUiState(
        isLoaded = true,
        chartMetric = chartMetric,
        summary = AnalyticsSummary(
            inputTokens = 59_100_000,
            outputTokens = 11_900_000,
            cacheReadTokens = 5_000_000_000,
            totalTokens = 5_071_000_000,
            totalCostUsd = 3_228.35,
            recordedCostUsd = 3_228.35,
            totalRequests = 319,
            pricingCoveragePercent = 100,
            contextSnapshots = 7_910,
            compactEvents = 37,
            latestContextPercent = 68.0,
            windowLabel = "This week · Jul 27 – Aug 3",
        ),
        providerUsage = providers,
        modelUsage = models,
        timeline = timeline,
        topSessions = listOf(
            TopSessionItem("preview-1", "Plum Code Android analytics", 1_240_000_000, 83, 744.16),
            TopSessionItem("preview-2", "Kimi analytics backfill", 940_000_000, 64, 512.72),
            TopSessionItem("preview-3", "Mobile gateway integration", 710_000_000, 49, 418.05),
        ),
    )
}
