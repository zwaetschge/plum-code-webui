package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/analytics` and `/api/usage` — the unified usage ledger and live quota. */
interface AnalyticsApi {
    /** GET /api/analytics/summary — the same unified ledger used by the WebUI. */
    suspend fun getAnalyticsSummary(
        period: String,
        timezoneOffsetMinutes: Int,
        offset: Int = 0,
    ): ApiResponse<JsonElement>

    /** GET /api/analytics/timeline — real token, cost and request history. */
    suspend fun getAnalyticsTimeline(
        period: String,
        timezoneOffsetMinutes: Int,
        offset: Int = 0,
        granularity: String = if (period == "24h") "hour" else "day",
    ): ApiResponse<JsonElement>

    /** GET /api/analytics/sessions/:sessionId — per-session token totals + history. */
    suspend fun getSessionUsage(sessionId: String): ApiResponse<JsonElement>

    /**
     * GET /api/usage/limits?provider=:provider — live account quota.
     *
     * Answers `supported = false` (with an explanatory error, still HTTP 200)
     * for harnesses that have no account of their own, so callers should check
     * [UsageLimitsResponse.supported] rather than treating it as a failure.
     */
    suspend fun getUsageLimits(provider: String): UsageLimitsResponse
}

class AnalyticsApiImpl(private val http: ApiHttp) : AnalyticsApi {

    override suspend fun getAnalyticsSummary(
        period: String,
        timezoneOffsetMinutes: Int,
        offset: Int,
    ): ApiResponse<JsonElement> =
        http.get("/api/analytics/summary") {
            parameter("period", period)
            parameter("tz", timezoneOffsetMinutes)
            parameter("offset", offset)
        }

    override suspend fun getAnalyticsTimeline(
        period: String,
        timezoneOffsetMinutes: Int,
        offset: Int,
        granularity: String,
    ): ApiResponse<JsonElement> =
        http.get("/api/analytics/timeline") {
            parameter("period", period)
            parameter("tz", timezoneOffsetMinutes)
            parameter("offset", offset)
            parameter("granularity", granularity)
        }

    override suspend fun getSessionUsage(sessionId: String): ApiResponse<JsonElement> =
        http.get("/api/analytics/sessions/$sessionId")

    override suspend fun getUsageLimits(provider: String): UsageLimitsResponse =
        http.get("/api/usage/limits") { parameter("provider", provider) }
}
