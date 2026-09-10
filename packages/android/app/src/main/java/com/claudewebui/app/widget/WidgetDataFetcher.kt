package com.claudewebui.app.widget

import android.content.Context
import com.claudewebui.app.core.network.BackgroundApi
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.GatewaySession
import com.claudewebui.app.data.model.QuestionRequestEvent
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.UsageLimitProvider
import com.claudewebui.app.ui.components.dashboard.IdleThreshold
import com.claudewebui.app.ui.components.dashboard.SessionFacts
import com.claudewebui.app.ui.components.dashboard.SessionState
import com.claudewebui.app.ui.components.dashboard.effectiveState
import com.claudewebui.app.ui.screens.analytics.AnalyticsParser
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.util.TimeZone

/**
 * Pulls one [WidgetSnapshot] over REST. Every section is fetched
 * independently and tolerated on failure — a dead analytics query must not
 * blank the sessions widget, and vice versa. Failed sections fall back to the
 * previously cached values.
 */
object WidgetDataFetcher {

    // Widgets run outside Koin's UI graph; they share one process-wide client.
    private val api get() = BackgroundApi.client

    /** As many rows as the widest widget layout can show. */
    private const val MAX_ROWS = 8

    fun isSignedIn(): Boolean =
        runCatching { TokenStore.getToken() != null && TokenStore.getServerUrl() != null }
            .getOrDefault(false)

    /** Fetch a fresh snapshot; null when signed out or everything failed. */
    suspend fun fetch(context: Context): WidgetSnapshot? {
        if (!isSignedIn()) return null
        val previous = WidgetStore.load(context) ?: WidgetSnapshot()
        val tz = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000

        val snapshot = withTimeoutOrNull(25_000) {
            coroutineScope {
                val today = async { runCatching { parsePeriod("24h", tz) }.getOrNull() }
                val weekly = async { runCatching { parseWeek(tz) }.getOrNull() }
                val limits = async { runCatching { fetchLimits() }.getOrNull() }
                val live = async { runCatching { fetchLive() }.getOrNull() }

                val weekParsed = weekly.await()
                val liveParsed = live.await()
                WidgetSnapshot(
                    updatedAtMs = System.currentTimeMillis(),
                    today = today.await() ?: previous.today,
                    week = weekParsed?.week ?: previous.week,
                    providers = weekParsed?.providers ?: previous.providers,
                    models = weekParsed?.models ?: previous.models,
                    topSessions = weekParsed?.topSessions ?: previous.topSessions,
                    days = weekParsed?.days ?: previous.days,
                    limits = limits.await() ?: previous.limits,
                    sessions = liveParsed?.sessions ?: previous.sessions,
                    approvals = liveParsed?.approvals ?: previous.approvals,
                    questions = liveParsed?.questions ?: previous.questions,
                    sessionTotal = liveParsed?.sessionTotal ?: previous.sessionTotal,
                    approvalTotal = liveParsed?.approvalTotal ?: previous.approvalTotal,
                    questionTotal = liveParsed?.questionTotal ?: previous.questionTotal,
                    busyTotal = liveParsed?.busyTotal ?: previous.busyTotal,
                    needsYouTotal = liveParsed?.needsYouTotal ?: previous.needsYouTotal,
                )
            }
        } ?: return null

        WidgetStore.save(context, snapshot)
        return snapshot
    }

    private suspend fun parsePeriod(period: String, tz: Int): WPeriod {
        val response = api.getAnalyticsSummary(period, tz)
        val root = response.data as? JsonObject ?: error("invalid summary")
        val parsed = AnalyticsParser.parse(root, JsonArray(emptyList()))
        return parsed.summary.let {
            WPeriod(
                inputTokens = it.inputTokens,
                outputTokens = it.outputTokens,
                cacheReadTokens = it.cacheReadTokens,
                totalTokens = it.totalTokens,
                costUsd = it.totalCostUsd,
                requests = it.totalRequests,
            )
        }
    }

    private data class WeekParsed(
        val week: WPeriod,
        val providers: List<WEntry>,
        val models: List<WEntry>,
        val topSessions: List<WEntry>,
        val days: List<WDay>,
    )

    private suspend fun parseWeek(tz: Int): WeekParsed = coroutineScope {
        val summaryReq = async { api.getAnalyticsSummary("7d", tz) }
        val timelineReq = async { api.getAnalyticsTimeline("7d", tz) }
        val summaryRoot = summaryReq.await().data as? JsonObject ?: error("invalid summary")
        val timelineRoot = timelineReq.await().data as? JsonArray ?: JsonArray(emptyList())
        val parsed = AnalyticsParser.parse(summaryRoot, timelineRoot)

        WeekParsed(
            week = parsed.summary.let {
                WPeriod(
                    inputTokens = it.inputTokens,
                    outputTokens = it.outputTokens,
                    cacheReadTokens = it.cacheReadTokens,
                    totalTokens = it.totalTokens,
                    costUsd = it.totalCostUsd,
                    requests = it.totalRequests,
                )
            },
            providers = parsed.providerUsage
                .sortedByDescending { it.tokenCount }
                .take(5)
                .map { WEntry(name = it.name, tokens = it.tokenCount, costUsd = it.costUsd, colorArgb = it.color) },
            models = parsed.modelUsage
                .sortedByDescending { it.costUsd }
                .take(5)
                .map {
                    WEntry(
                        name = it.modelName,
                        sub = it.providerName,
                        tokens = it.tokenCount,
                        costUsd = it.costUsd,
                        colorArgb = it.color,
                    )
                },
            topSessions = parsed.topSessions
                .sortedByDescending { it.costUsd }
                .take(5)
                .map { WEntry(id = it.id, name = it.name, tokens = it.tokenCount, costUsd = it.costUsd) },
            days = parsed.timeline.takeLast(7).map {
                WDay(label = it.label, tokens = it.tokenCount, costUsd = it.costUsd)
            },
        )
    }

    private suspend fun fetchLimits(): List<WLimit> = coroutineScope {
        UsageLimitProvider.entries.map { provider ->
            async {
                val response = runCatching { api.getUsageLimits(provider.id) }.getOrNull()
                val data = response?.takeIf { it.supported }?.data ?: return@async emptyList<WLimit>()
                val color = when (provider) {
                    UsageLimitProvider.CODEX -> 0xFF22C55EL
                    UsageLimitProvider.CLAUDE -> 0xFFF97316L
                    UsageLimitProvider.ZAI -> 0xFF14B8A6L
                    UsageLimitProvider.KIMI -> 0xFF2582EDL
                    UsageLimitProvider.ALIBABA -> 0xFFFF8A3DL
                }
                buildList {
                    data.fiveHour?.let { add(WLimit(provider.label, "5h", it.utilization, color)) }
                    data.sevenDay?.let { add(WLimit(provider.label, "Weekly", it.utilization, color)) }
                    data.sevenDaySonnet?.let { add(WLimit(provider.label, "Weekly Sonnet", it.utilization, color)) }
                }
            }
        }.awaitAll().flatten()
    }

    /** What one gateway round trip yields, before it is capped to the layout. */
    private data class Live(
        val sessions: List<WSession>,
        val approvals: List<WApproval>,
        val questions: List<WQuestion>,
        val sessionTotal: Int,
        val approvalTotal: Int,
        val questionTotal: Int,
        val busyTotal: Int,
        val needsYouTotal: Int,
    )

    /**
     * The whole live picture in one request.
     *
     * This used to be `GET /api/sessions` followed by a pending-permission call
     * per running session — up to nine round trips on a widget refresh, and it
     * still could not tell a session that was thinking from one blocked on an
     * approval, because the session row only reports that a process exists. The
     * gateway overview carries busy, queue depth, activity and approvals for
     * every session at once, so the widget can reach the same verdict the
     * dashboard reaches.
     */
    private suspend fun fetchLive(): Live {
        val overview = api.getGatewayOverview().data
            ?: return Live(emptyList(), emptyList(), emptyList(), 0, 0, 0, 0, 0)
        val now = Instant.now()
        val live = overview.sessions.filterNot { it.archived }

        // Ordered the way the dashboard orders its sections: whatever wants
        // something from you first, resting sessions last. A widget shows five
        // to eight rows, so which five is the entire question.
        val ranked = live
            .map { it to effectiveState(it.facts(), now, IdleThreshold.DEFAULT.minutes) }
            .sortedWith(
                compareBy<Pair<GatewaySession, SessionState>> { it.second.group.ordinal }
                    .thenByDescending { it.second.flagged }
                    .thenByDescending { it.first.lastActivityAt ?: it.first.updatedAt ?: "" }
            )

        val names = live.associate { it.id to it.name }
        val approvals = overview.pendingApprovals.map {
            WApproval(
                sessionId = it.sessionId,
                sessionName = names[it.sessionId] ?: it.sessionId.take(8),
                toolName = it.toolName,
                requestId = it.requestId,
            )
        }

        val questions = overview.pendingQuestions.map { it.toWidget(names) }

        return Live(
            sessions = ranked.take(MAX_ROWS).map { (session, _) -> session.toWidget() },
            approvals = approvals.take(MAX_ROWS),
            questions = questions.take(MAX_ROWS),
            sessionTotal = live.size,
            approvalTotal = approvals.size,
            questionTotal = questions.size,
            busyTotal = ranked.count {
                it.second.activity == com.claudewebui.app.ui.components.dashboard.SessionActivity.WORKING
            },
            needsYouTotal = ranked.count {
                it.second.activity == com.claudewebui.app.ui.components.dashboard.SessionActivity.NEEDS_YOU
            },
        )
    }

    /**
     * Flatten a question request to one answerable row.
     *
     * The API takes an answer per question; a widget button can only supply
     * one. So a request with a single option-list question is answerable in
     * place, and anything else — several questions, multi-select, free text —
     * is shown but routed into the app.
     */
    private fun QuestionRequestEvent.toWidget(names: Map<String, String>): WQuestion {
        val first = questions.firstOrNull()
        return WQuestion(
            sessionId = sessionId,
            sessionName = names[sessionId] ?: sessionId.take(8),
            requestId = requestId,
            providerSessionId = providerSessionId.orEmpty(),
            prompt = first?.question?.ifBlank { first.header }.orEmpty(),
            options = first?.options?.map { it.label }.orEmpty(),
            answerable = questions.size == 1 &&
                first != null &&
                first.options.isNotEmpty() &&
                first.multiple != true &&
                first.custom != true,
        )
    }

    /** The gateway projection, reduced to the facts a verdict needs. */
    private fun GatewaySession.facts(): SessionFacts = SessionFacts(
        status = runCatching { SessionStatus.valueOf(status.uppercase()) }
            .getOrDefault(SessionStatus.STOPPED),
        busy = busy,
        queueDepth = queueDepth,
        // A question blocks the session exactly as an approval does, and the
        // verdict has one slot for "waiting on a human".
        pendingApprovals = pendingApprovals + pendingQuestions,
        activitySummary = activitySummary,
        lastActivityAt = lastActivityAt,
        updatedAt = updatedAt.orEmpty(),
    )

    private fun GatewaySession.toWidget(): WSession = WSession(
        id = id,
        name = name,
        // The gateway sends the provider id; the widget filter and the row both
        // want the label the rest of the app shows.
        provider = provider?.let { CLIProvider.fromId(it)?.displayName ?: it }.orEmpty(),
        status = status.lowercase(),
        busy = busy,
        activitySummary = activitySummary,
        queueDepth = queueDepth,
        pendingApprovals = pendingApprovals + pendingQuestions,
        lastActivityAt = lastActivityAt,
        updatedAt = updatedAt.orEmpty(),
    )
}
