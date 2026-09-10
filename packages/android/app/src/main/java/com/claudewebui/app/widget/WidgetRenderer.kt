package com.claudewebui.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import com.claudewebui.app.MainActivity
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.dashboard.IdleThreshold
import com.claudewebui.app.ui.components.dashboard.SessionActivity
import com.claudewebui.app.ui.components.dashboard.SessionFacts
import com.claudewebui.app.ui.components.dashboard.effectiveState
import com.claudewebui.app.ui.components.dashboard.localizedLabel
import com.claudewebui.app.ui.components.dashboard.widgetArgb
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale

/** Which of the ten home-screen widgets a provider instance renders. */
enum class WidgetKind(val titleResource: Int) {
    SESSIONS(R.string.native_sessions),
    APPROVALS(R.string.native_approvals),
    QUICK(R.string.native_app),
    TOKENS(R.string.native_tokens),
    COST(R.string.native_cost),
    PROVIDERS(R.string.native_providers),
    MODELS(R.string.native_models),
    LIMITS(R.string.native_limits),
    CHART(R.string.native_activity_week),
    TOP_SESSIONS(R.string.native_top_week),
}

/**
 * Builds the RemoteViews for every widget kind from one cached snapshot,
 * honouring the per-instance [WidgetConfig]. [compact] renders the reduced
 * variant used for small grid sizes on Android 12+.
 */
object WidgetRenderer {

    // Per row: container, dot, label, value, sub, bar, approve, deny
    private val ROW_IDS = arrayOf(
        intArrayOf(R.id.row1, R.id.row1_dot, R.id.row1_label, R.id.row1_value, R.id.row1_sub, R.id.row1_bar, R.id.row1_approve, R.id.row1_deny),
        intArrayOf(R.id.row2, R.id.row2_dot, R.id.row2_label, R.id.row2_value, R.id.row2_sub, R.id.row2_bar, R.id.row2_approve, R.id.row2_deny),
        intArrayOf(R.id.row3, R.id.row3_dot, R.id.row3_label, R.id.row3_value, R.id.row3_sub, R.id.row3_bar, R.id.row3_approve, R.id.row3_deny),
        intArrayOf(R.id.row4, R.id.row4_dot, R.id.row4_label, R.id.row4_value, R.id.row4_sub, R.id.row4_bar, R.id.row4_approve, R.id.row4_deny),
        intArrayOf(R.id.row5, R.id.row5_dot, R.id.row5_label, R.id.row5_value, R.id.row5_sub, R.id.row5_bar, R.id.row5_approve, R.id.row5_deny),
        intArrayOf(R.id.row6, R.id.row6_dot, R.id.row6_label, R.id.row6_value, R.id.row6_sub, R.id.row6_bar, R.id.row6_approve, R.id.row6_deny),
        intArrayOf(R.id.row7, R.id.row7_dot, R.id.row7_label, R.id.row7_value, R.id.row7_sub, R.id.row7_bar, R.id.row7_approve, R.id.row7_deny),
        intArrayOf(R.id.row8, R.id.row8_dot, R.id.row8_label, R.id.row8_value, R.id.row8_sub, R.id.row8_bar, R.id.row8_approve, R.id.row8_deny),
    )

    fun render(
        context: Context,
        kind: WidgetKind,
        snapshot: WidgetSnapshot?,
        config: WidgetConfig = WidgetConfig(),
        compact: Boolean = false,
    ): RemoteViews {
        val views = when (kind) {
            WidgetKind.QUICK, WidgetKind.TOKENS, WidgetKind.COST ->
                RemoteViews(context.packageName, R.layout.widget_stat)
            WidgetKind.CHART ->
                RemoteViews(context.packageName, R.layout.widget_chart)
            else ->
                RemoteViews(context.packageName, R.layout.widget_list)
        }

        if (config.translucent) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_translucent)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Material You: follow the device accent instead of fixed plum.
            views.setTextColor(R.id.widget_title, context.getColor(android.R.color.system_accent1_200))
        }

        views.setTextViewText(R.id.widget_title, title(context, kind, config))
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context, kind))
        views.setContentDescription(R.id.widget_refresh, context.getString(R.string.native_refresh))
        views.setOnClickPendingIntent(R.id.widget_title, openAppIntent(context, kind, config))
        views.setViewVisibility(R.id.widget_updated, if (compact) View.GONE else View.VISIBLE)
        views.setTextViewText(
            R.id.widget_updated,
            snapshot?.let {
                context.getString(R.string.native_updated, SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it.updatedAtMs)))
            } ?: context.getString(R.string.native_signin),
        )

        if (snapshot == null) {
            renderEmpty(context, kind, views)
            return views
        }

        val maxRows = if (compact) 3 else ROW_IDS.size
        when (kind) {
            WidgetKind.SESSIONS -> renderSessions(context, views, snapshot, config, maxRows)
            WidgetKind.APPROVALS -> renderApprovals(context, views, snapshot, maxRows)
            WidgetKind.QUICK -> renderQuick(context, views, snapshot, config, compact)
            WidgetKind.TOKENS -> renderTokens(context, views, snapshot, config, compact)
            WidgetKind.COST -> renderCost(context, views, snapshot, config, compact)
            WidgetKind.PROVIDERS -> renderProviders(context, views, snapshot, config, maxRows)
            WidgetKind.MODELS -> renderModels(context, views, snapshot, config, maxRows)
            WidgetKind.LIMITS -> renderLimits(context, views, snapshot, maxRows)
            WidgetKind.CHART -> renderChart(context, views, snapshot, config)
            WidgetKind.TOP_SESSIONS -> renderTopSessions(context, views, snapshot, maxRows)
        }
        return views
    }

    private fun title(context: Context, kind: WidgetKind, config: WidgetConfig): String {
        val base = context.getString(kind.titleResource)
        val suffix = when (kind) {
            WidgetKind.TOKENS, WidgetKind.COST ->
                if (config.period == "7d") context.getString(R.string.native_suffix_week) else context.getString(R.string.native_suffix_today)
            WidgetKind.PROVIDERS, WidgetKind.MODELS -> context.getString(R.string.native_suffix_week)
            else -> ""
        }
        val filter = config.provider
            ?.takeIf { kind in setOf(WidgetKind.SESSIONS, WidgetKind.PROVIDERS, WidgetKind.MODELS) }
            ?.let { " · $it" } ?: ""
        return base + suffix + filter
    }

    private fun statPeriod(snapshot: WidgetSnapshot, config: WidgetConfig): WPeriod =
        if (config.period == "7d") snapshot.week else snapshot.today

    private fun periodLabel(context: Context, config: WidgetConfig): String =
        if (config.period == "7d") context.getString(R.string.native_this_week) else context.getString(R.string.native_today)

    // ── Kind renderers ─────────────────────────────────────────────────────

    private fun renderSessions(
        context: Context,
        views: RemoteViews,
        s: WidgetSnapshot,
        config: WidgetConfig,
        maxRows: Int,
    ) {
        val sessions = s.sessions.filter { config.provider == null || it.provider == config.provider }
        val now = Instant.now()
        val rows = sessions.map { it to effectiveState(it.facts(), now, IdleThreshold.DEFAULT.minutes) }

        // Lead with what is blocked, not with a running count: a supervisor
        // glancing at the home screen wants to know whether anything is waiting.
        // Counted server-wide unless a provider filter narrows the widget, in
        // which case only the cached rows can answer.
        val needsYou =
            if (config.provider == null) s.needsYouTotal
            else rows.count { it.second.activity == SessionActivity.NEEDS_YOU }
        val working =
            if (config.provider == null) s.busyTotal
            else rows.count { it.second.activity == SessionActivity.WORKING }
        views.setTextViewText(
            R.id.widget_headline,
            if (needsYou > 0) context.getString(R.string.native_needs_working, needsYou, working)
            else context.getString(R.string.native_working_waiting, working, s.approvalTotal + s.questionTotal),
        )

        // The fetcher caps its list at the widest layout, so sessions beyond
        // that never reach the cache; both kinds of omission are counted here so
        // the last row can say how many the widget is not showing.
        val capacity = maxRows.coerceAtMost(ROW_IDS.size)
        val uncached =
            if (config.provider == null) (s.sessionTotal - s.sessions.size).coerceAtLeast(0) else 0
        val fits = rows.size + uncached <= capacity
        val shown = if (fits) rows.size.coerceAtMost(capacity) else capacity - 1
        val hidden = if (fits) 0 else rows.size - shown + uncached

        bindRows(views, shown + if (hidden > 0) 1 else 0, capacity, emptyMessage = context.getString(R.string.native_no_sessions)) { i, ids ->
            if (i == shown) {
                views.setTextColor(ids[1], 0xFF6B6577.toInt())
                views.setTextViewText(ids[2], context.getString(R.string.native_more, hidden))
                views.setTextViewText(ids[3], "")
                views.setOnClickPendingIntent(ids[0], dashboardIntent(context))
                return@bindRows
            }
            val (session, state) = rows[i]
            views.setTextColor(ids[1], widgetArgb(state))
            views.setTextViewText(ids[2], session.name)
            views.setTextViewText(ids[3], session.provider)
            views.setViewVisibility(ids[4], View.VISIBLE)
            // The verdict, not the raw status — "running" is what a session
            // stuck on an approval prompt also calls itself.
            views.setTextViewText(ids[4], state.localizedLabel(context, session.facts()))
            views.setOnClickPendingIntent(ids[0], sessionIntent(context, session.id, i))
        }
    }

    /** The cached row, reduced to the facts [effectiveState] decides from. */
    private fun WSession.facts(): SessionFacts = SessionFacts(
        status = runCatching {
            com.claudewebui.app.data.model.SessionStatus.valueOf(status.uppercase())
        }.getOrDefault(com.claudewebui.app.data.model.SessionStatus.STOPPED),
        busy = busy,
        queueDepth = queueDepth,
        pendingApprovals = pendingApprovals,
        activitySummary = activitySummary,
        lastActivityAt = lastActivityAt,
        updatedAt = updatedAt,
    )

    /**
     * Approvals and questions in one list — both are the agent standing still
     * until this person acts, and a widget that showed only one of them let a
     * blocked session look idle.
     */
    private fun renderApprovals(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int) {
        val total = s.approvalTotal + s.questionTotal
        views.setTextViewText(
            R.id.widget_headline,
            if (total == 0) context.getString(R.string.native_all_clear) else context.getString(R.string.native_pending, total),
        )
        // Same arithmetic as the session list: the fetcher caps what it caches, so
        // the last row is spent saying how many are out of sight rather than
        // letting the widget imply there are none.
        val capacity = maxRows.coerceAtMost(ROW_IDS.size)
        val fits = total <= capacity
        val cached = s.approvals.size + s.questions.size
        val shown = if (fits) cached.coerceAtMost(capacity) else capacity - 1
        val hidden = if (fits) 0 else total - shown

        bindRows(
            views,
            shown + if (hidden > 0) 1 else 0,
            capacity,
            emptyMessage = context.getString(R.string.native_nothing_waiting),
        ) { i, ids ->
            if (i == shown) {
                views.setTextColor(ids[1], 0xFF6B6577.toInt())
                views.setTextViewText(ids[2], context.getString(R.string.native_more, hidden))
                views.setTextViewText(ids[3], "")
                views.setOnClickPendingIntent(ids[0], dashboardIntent(context))
                return@bindRows
            }
            if (i < s.approvals.size) {
                bindApprovalRow(context, views, ids, s.approvals[i], i)
            } else {
                bindQuestionRow(context, views, ids, s.questions[i - s.approvals.size], i)
            }
        }
    }

    private fun bindApprovalRow(
        context: Context,
        views: RemoteViews,
        ids: IntArray,
        approval: WApproval,
        row: Int,
    ) {
        views.setTextColor(ids[1], 0xFFF59E0B.toInt())
        views.setTextViewText(ids[2], approval.toolName)
        views.setTextViewText(ids[3], "")
        views.setViewVisibility(ids[4], View.VISIBLE)
        views.setTextViewText(ids[4], approval.sessionName)
        views.setViewVisibility(ids[6], View.VISIBLE)
        views.setViewVisibility(ids[7], View.VISIBLE)
        views.setTextViewText(ids[6], "✓")
        views.setContentDescription(ids[6], context.getString(R.string.native_approve))
        views.setTextViewText(ids[7], "✕")
        views.setContentDescription(ids[7], context.getString(R.string.native_deny))
        views.setOnClickPendingIntent(
            ids[6],
            approvalIntent(context, ACTION_WIDGET_APPROVE, approval, row),
        )
        views.setOnClickPendingIntent(
            ids[7],
            approvalIntent(context, ACTION_WIDGET_DENY, approval, row),
        )
        views.setOnClickPendingIntent(ids[0], sessionIntent(context, approval.sessionId, row))
    }

    /**
     * A question row answers in place only when the choice genuinely fits two
     * buttons: exactly two short options. Anything else would mean picking one
     * option out of many at random or truncating it past recognition, so the
     * row offers only "dismiss" and opens the session for the real picker.
     */
    private fun bindQuestionRow(
        context: Context,
        views: RemoteViews,
        ids: IntArray,
        question: WQuestion,
        row: Int,
    ) {
        // Violet, not the approvals amber: a different kind of block.
        views.setTextColor(ids[1], 0xFFA78BFA.toInt())
        views.setTextViewText(ids[2], question.prompt.ifBlank { context.getString(R.string.native_question) })
        views.setTextViewText(ids[3], "")
        views.setViewVisibility(ids[4], View.VISIBLE)
        views.setTextViewText(ids[4], question.sessionName)
        views.setViewVisibility(ids[7], View.VISIBLE)

        val inline = question.options.takeIf {
            question.answerable && it.size == 2 && it.all { label -> label.length <= 10 }
        }
        if (inline != null) {
            views.setViewVisibility(ids[6], View.VISIBLE)
            views.setTextViewText(ids[6], inline[0])
            views.setContentDescription(ids[6], inline[0])
            views.setOnClickPendingIntent(
                ids[6],
                questionIntent(context, ACTION_WIDGET_ANSWER, question, inline[0], row),
            )
            views.setTextViewText(ids[7], inline[1])
            views.setContentDescription(ids[7], inline[1])
            views.setOnClickPendingIntent(
                ids[7],
                questionIntent(context, ACTION_WIDGET_ANSWER, question, inline[1], row),
            )
        } else {
            views.setViewVisibility(ids[6], View.GONE)
            views.setTextViewText(ids[7], "✕")
            views.setContentDescription(ids[7], context.getString(R.string.native_dismiss))
            views.setOnClickPendingIntent(
                ids[7],
                questionIntent(context, ACTION_WIDGET_DISMISS_QUESTION, question, null, row),
            )
        }
        views.setOnClickPendingIntent(ids[0], sessionIntent(context, question.sessionId, row))
    }

    private fun renderQuick(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, compact: Boolean) {
        val period = statPeriod(s, config)
        views.setTextViewText(R.id.widget_big_value, context.getString(R.string.native_working, s.busyTotal))
        views.setTextViewText(
            R.id.widget_big_caption,
            (s.approvalTotal + s.questionTotal).let { waiting ->
                if (waiting == 0) context.getString(R.string.native_nothing_pending)
                else context.getString(R.string.native_need_you, waiting)
            },
        )
        setSub(views, 1, fmtTokens(period.totalTokens), context.getString(R.string.native_tokens_period, periodLabel(context, config)), compact)
        setSub(views, 2, fmtCost(period.costUsd), context.getString(R.string.native_cost_lower), compact)
        setSub(views, 3, period.requests.toString(), context.getString(R.string.native_requests), compact)
    }

    private fun renderTokens(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, compact: Boolean) {
        val period = statPeriod(s, config)
        views.setTextViewText(R.id.widget_big_value, fmtTokens(period.totalTokens))
        views.setTextViewText(R.id.widget_big_caption, context.getString(R.string.native_tokens_period, periodLabel(context, config)))
        setSub(views, 1, fmtTokens(period.inputTokens), context.getString(R.string.native_input), compact)
        setSub(views, 2, fmtTokens(period.outputTokens), context.getString(R.string.native_output), compact)
        setSub(views, 3, fmtTokens(period.cacheReadTokens), context.getString(R.string.native_cache_read), compact)
    }

    private fun renderCost(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, compact: Boolean) {
        val period = statPeriod(s, config)
        val other = if (config.period == "7d") s.today else s.week
        val otherLabel = if (config.period == "7d") context.getString(R.string.native_today) else context.getString(R.string.native_this_week)
        views.setTextViewText(R.id.widget_big_value, fmtCost(period.costUsd))
        views.setTextViewText(R.id.widget_big_caption, context.getString(R.string.native_cost_period, periodLabel(context, config)))
        setSub(views, 1, fmtCost(other.costUsd), otherLabel, compact)
        setSub(views, 2, period.requests.toString(), context.getString(R.string.native_requests), compact)
        setSub(views, 3, fmtTokens(period.totalTokens), context.getString(R.string.native_tokens_lower), compact)
    }

    private fun renderProviders(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, maxRows: Int) {
        val providers = s.providers.filter { config.provider == null || it.name.equals(config.provider, true) }
        views.setTextViewText(R.id.widget_headline, fmtCost(s.week.costUsd))
        val maxTokens = providers.maxOfOrNull { it.tokens }?.coerceAtLeast(1) ?: 1
        bindRows(views, providers.size, maxRows, emptyMessage = context.getString(R.string.native_no_week_usage)) { i, ids ->
            val entry = providers[i]
            views.setTextColor(ids[1], entry.colorArgb.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], "${fmtTokens(entry.tokens)} · ${fmtCost(entry.costUsd)}")
            views.setViewVisibility(ids[5], View.VISIBLE)
            views.setProgressBar(ids[5], 100, (entry.tokens * 100 / maxTokens).toInt(), false)
        }
    }

    private fun renderModels(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, maxRows: Int) {
        val models = s.models.filter { config.provider == null || it.sub.equals(config.provider, true) }
        bindRows(views, models.size, maxRows, emptyMessage = context.getString(R.string.native_no_week_usage)) { i, ids ->
            val entry = models[i]
            views.setTextColor(ids[1], entry.colorArgb.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], fmtCost(entry.costUsd))
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], context.getString(R.string.native_provider_tokens, entry.sub, fmtTokens(entry.tokens)))
        }
    }

    private fun renderLimits(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int) {
        bindRows(views, s.limits.size, maxRows, emptyMessage = context.getString(R.string.native_no_quota)) { i, ids ->
            val limit = s.limits[i]
            views.setTextColor(ids[1], limit.colorArgb.toInt())
            views.setTextViewText(ids[2], "${limit.provider} · ${limit.localizedWindow(context)}")
            views.setTextViewText(ids[3], "${limit.percent}%")
            views.setTextColor(
                ids[3],
                when {
                    limit.percent >= UsageAlerts.LIMIT_THRESHOLD_PERCENT -> 0xFFEF4444.toInt()
                    limit.percent >= 60 -> 0xFFF59E0B.toInt()
                    else -> 0xFFFFFFFF.toInt()
                },
            )
            views.setViewVisibility(ids[5], View.VISIBLE)
            views.setProgressBar(ids[5], 100, limit.percent.coerceIn(0, 100), false)
        }
    }

    private fun renderTopSessions(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int) {
        bindRows(views, s.topSessions.size, maxRows, emptyMessage = context.getString(R.string.native_no_week_usage)) { i, ids ->
            val entry = s.topSessions[i]
            views.setTextColor(ids[1], 0xFFCC785C.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], fmtCost(entry.costUsd))
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], context.getString(R.string.native_token_count, fmtTokens(entry.tokens)))
            if (entry.id.isNotBlank()) {
                views.setOnClickPendingIntent(ids[0], sessionIntent(context, entry.id, i))
            }
        }
    }

    private fun renderChart(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig) {
        views.setTextViewText(
            R.id.widget_headline,
            "${fmtTokens(s.week.totalTokens)} · ${fmtCost(s.week.costUsd)}",
        )
        views.setImageViewBitmap(R.id.widget_chart, drawChart(context, s.days))
        views.setOnClickPendingIntent(R.id.widget_chart, openAppIntent(context, WidgetKind.CHART, config))
    }

    private fun renderEmpty(context: Context, kind: WidgetKind, views: RemoteViews) {
        when (kind) {
            WidgetKind.QUICK, WidgetKind.TOKENS, WidgetKind.COST -> {
                views.setTextViewText(R.id.widget_big_value, "—")
                views.setTextViewText(R.id.widget_big_caption, context.getString(R.string.native_no_data))
            }
            WidgetKind.CHART -> Unit
            else -> {
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.native_open_once))
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun bindRows(
        views: RemoteViews,
        count: Int,
        maxRows: Int,
        emptyMessage: String,
        bind: (index: Int, ids: IntArray) -> Unit,
    ) {
        val visible = count.coerceAtMost(maxRows.coerceAtMost(ROW_IDS.size))
        if (visible == 0) {
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
            views.setTextViewText(R.id.widget_empty, emptyMessage)
        } else {
            views.setViewVisibility(R.id.widget_empty, View.GONE)
        }
        ROW_IDS.forEachIndexed { i, ids ->
            if (i < visible) {
                views.setViewVisibility(ids[0], View.VISIBLE)
                views.setViewVisibility(ids[4], View.GONE)
                views.setViewVisibility(ids[5], View.GONE)
                views.setViewVisibility(ids[6], View.GONE)
                views.setViewVisibility(ids[7], View.GONE)
                bind(i, ids)
            } else {
                views.setViewVisibility(ids[0], View.GONE)
            }
        }
    }

    private fun setSub(views: RemoteViews, slot: Int, value: String, label: String, compact: Boolean) {
        val (valueId, labelId) = when (slot) {
            1 -> R.id.widget_sub1_value to R.id.widget_sub1_label
            2 -> R.id.widget_sub2_value to R.id.widget_sub2_label
            else -> R.id.widget_sub3_value to R.id.widget_sub3_label
        }
        views.setViewVisibility(valueId, if (compact) View.GONE else View.VISIBLE)
        views.setViewVisibility(labelId, if (compact) View.GONE else View.VISIBLE)
        views.setTextViewText(valueId, value)
        views.setTextViewText(labelId, label)
    }

    private fun drawChart(context: Context, days: List<WDay>): Bitmap {
        val width = 640
        val height = 280
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFCC785C.toInt() }
        val faintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x33FFFFFF }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF8A8494.toInt()
            textSize = 22f
            textAlign = Paint.Align.CENTER
        }

        val labelSpace = 34f
        val chartHeight = height - labelSpace
        canvas.drawLine(0f, chartHeight, width.toFloat(), chartHeight, faintPaint)

        if (days.isEmpty()) {
            textPaint.textSize = 26f
            canvas.drawText(context.getString(R.string.native_no_activity), width / 2f, chartHeight / 2f, textPaint)
            return bitmap
        }

        val max = days.maxOf { it.tokens }.coerceAtLeast(1)
        val slot = width.toFloat() / days.size
        val barWidth = slot * 0.55f
        days.forEachIndexed { i, day ->
            val barHeight = (day.tokens.toFloat() / max) * (chartHeight - 30f)
            val left = i * slot + (slot - barWidth) / 2f
            canvas.drawRoundRect(
                RectF(left, chartHeight - barHeight, left + barWidth, chartHeight),
                10f, 10f, barPaint,
            )
            canvas.drawText(dayLabel(day.label), i * slot + slot / 2f, height - 8f, textPaint)
        }
        return bitmap
    }

    /** "2026-08-10" → "Su"; hourly labels pass through shortened. */
    private fun dayLabel(raw: String): String = runCatching {
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(raw)
        SimpleDateFormat("EE", Locale.getDefault()).format(date!!).take(2)
    }.getOrDefault(raw.takeLast(2))

    private fun fmtTokens(value: Long): String = when {
        value >= 1_000_000_000 -> "%.1fB".format(value / 1_000_000_000.0)
        value >= 1_000_000 -> "%.1fM".format(value / 1_000_000.0)
        value >= 1_000 -> "%.1fk".format(value / 1_000.0)
        else -> value.toString()
    }

    private fun fmtCost(value: Double): String =
        if (value >= 100) "$%.0f".format(value) else "$%.2f".format(value)

    // ── PendingIntents ─────────────────────────────────────────────────────

    private fun refreshIntent(context: Context, kind: WidgetKind): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            9000 + kind.ordinal,
            Intent(context, kind.providerClass()).apply { action = ACTION_WIDGET_REFRESH },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** Analytics widgets deep-link into the analytics screen with their range. */
    private fun openAppIntent(context: Context, kind: WidgetKind, config: WidgetConfig): PendingIntent {
        val uri = when (kind) {
            WidgetKind.TOKENS, WidgetKind.COST ->
                "claudewebui://analytics?range=${config.period}"
            WidgetKind.PROVIDERS, WidgetKind.MODELS, WidgetKind.LIMITS,
            WidgetKind.CHART, WidgetKind.TOP_SESSIONS ->
                "claudewebui://analytics?range=7d"
            else -> null
        }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            if (uri != null) {
                action = Intent.ACTION_VIEW
                data = Uri.parse(uri)
            }
        }
        return PendingIntent.getActivity(
            context,
            9100 + kind.ordinal,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** The overflow row means "there are more" — plain launch to the dashboard. */
    private fun dashboardIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(
            context,
            9300,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun sessionIntent(context: Context, sessionId: String, row: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            // The session id lives in the intent data, so identity is already
            // unique per session; the row only keeps concurrent rows apart.
            9200 + row,
            Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("claudewebui://session/$sessionId")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /**
     * Extras are NOT part of PendingIntent identity — two rows whose intents
     * differ only by their extras are `filterEquals`, so a requestCode clash
     * would let FLAG_UPDATE_CURRENT rewrite one row's target and approve the
     * wrong request. The requestId therefore goes into the intent data too,
     * which does count towards identity.
     */
    private fun approvalIntent(
        context: Context,
        action: String,
        approval: WApproval,
        row: Int,
    ): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            9600 + row * 2 + if (action == ACTION_WIDGET_APPROVE) 0 else 1,
            Intent(context, WidgetActionReceiver::class.java).apply {
                this.action = action
                data = Uri.parse("plum://approval/${Uri.encode(approval.requestId)}")
                putExtra(EXTRA_WIDGET_SESSION_ID, approval.sessionId)
                putExtra(EXTRA_WIDGET_REQUEST_ID, approval.requestId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /**
     * Same identity rules as [approvalIntent]. The chosen answer is part of the
     * data URI as well as an extra, so the two option buttons of one row cannot
     * collapse into each other under FLAG_UPDATE_CURRENT.
     */
    private fun questionIntent(
        context: Context,
        action: String,
        question: WQuestion,
        answer: String?,
        row: Int,
    ): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            9800 + row * 3 + when {
                action == ACTION_WIDGET_DISMISS_QUESTION -> 0
                answer == question.options.firstOrNull() -> 1
                else -> 2
            },
            Intent(context, WidgetActionReceiver::class.java).apply {
                this.action = action
                data = Uri.parse(
                    "plum://question/${Uri.encode(question.requestId)}/${Uri.encode(answer ?: "-")}"
                )
                putExtra(EXTRA_WIDGET_SESSION_ID, question.sessionId)
                putExtra(EXTRA_WIDGET_REQUEST_ID, question.requestId)
                putExtra(EXTRA_WIDGET_PROVIDER_SESSION_ID, question.providerSessionId)
                answer?.let { putExtra(EXTRA_WIDGET_ANSWER, it) }
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}
