package com.claudewebui.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
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
import java.time.ZoneId
import java.util.Date
import java.util.Locale

/** Which of the home-screen widgets a provider instance renders. */
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
    MONITOR(R.string.native_monitor),
}

/** The size a widget variant is laid out for, in dp. */
data class WidgetSize(val widthDp: Int, val heightDp: Int) {
    companion object {
        /** A 2×1/2×2 cell: what `compact = true` stands for. */
        val COMPACT = WidgetSize(150, 110)

        /** A 4×2 phone cell, for launchers that report nothing better. */
        val DEFAULT = WidgetSize(320, 170)
    }
}

/**
 * Builds the RemoteViews for every widget kind from one cached snapshot,
 * honouring the per-instance [WidgetConfig].
 *
 * All widgets share one visual language: a near-black container holding
 * rounded tiles — an accent hero tile, a cream tile, dark tiles — and a
 * footer link. [size] is the smallest size this variant will be shown at;
 * tiles that would not fit are hidden rather than clipped.
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

    // ── Palette ────────────────────────────────────────────────────────────

    private const val TERRACOTTA = 0xFFD97757.toInt()
    private const val VIOLET = 0xFFA78BFA.toInt()
    private const val AMBER = 0xFFF59E0B.toInt()
    private const val COPPER = 0xFFCC785C.toInt()
    private const val GREEN = 0xFF34D399.toInt()
    private const val NEUTRAL = 0xFFC9C2B8.toInt()
    private const val ORANGE = 0xFFF97316.toInt()
    private const val FAINT = 0xFF6B6577.toInt()
    private const val ON_HERO = 0xFFFFF7EE.toInt()
    private const val ON_HERO_MUTED = 0xC7FFF1E6.toInt()
    private const val ON_CREAM = 0xFF1A1A1A.toInt()
    private const val ON_CREAM_MUTED = 0xFF7C746A.toInt()
    private const val CREAM_RED = 0xFFC81E1E.toInt()
    private const val CREAM_AMBER = 0xFFB45309.toInt()

    /** Accent and hero fill per kind; neutral kinds get a cream hero. */
    private class Style(val accent: Int, val hero: Int, val heroOnCream: Boolean = false)

    private fun styleOf(kind: WidgetKind): Style = when (kind) {
        WidgetKind.LIMITS, WidgetKind.COST, WidgetKind.CHART -> Style(TERRACOTTA, R.drawable.widget_tile_hero_terracotta)
        WidgetKind.TOKENS -> Style(VIOLET, R.drawable.widget_tile_hero_violet)
        WidgetKind.APPROVALS -> Style(AMBER, R.drawable.widget_tile_hero_amber)
        WidgetKind.SESSIONS, WidgetKind.MONITOR, WidgetKind.TOP_SESSIONS -> Style(COPPER, R.drawable.widget_tile_hero_copper)
        WidgetKind.QUICK -> Style(GREEN, R.drawable.widget_tile_hero_green)
        WidgetKind.PROVIDERS, WidgetKind.MODELS -> Style(NEUTRAL, R.drawable.widget_tile_cream, heroOnCream = true)
    }

    private fun isDashboard(kind: WidgetKind) =
        kind == WidgetKind.LIMITS || kind == WidgetKind.QUICK || kind == WidgetKind.TOKENS || kind == WidgetKind.COST

    fun render(
        context: Context,
        kind: WidgetKind,
        snapshot: WidgetSnapshot?,
        config: WidgetConfig = WidgetConfig(),
        compact: Boolean = false,
        size: WidgetSize = if (compact) WidgetSize.COMPACT else WidgetSize.DEFAULT,
    ): RemoteViews {
        val layout = when {
            isDashboard(kind) -> R.layout.widget_dashboard
            kind == WidgetKind.CHART -> R.layout.widget_chart
            else -> R.layout.widget_list
        }
        val views = RemoteViews(context.packageName, layout)
        val style = styleOf(kind)

        views.setInt(
            R.id.widget_root,
            "setBackgroundResource",
            if (config.translucent) R.drawable.widget_container_translucent else R.drawable.widget_container,
        )
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context, kind))
        views.setContentDescription(R.id.widget_refresh, context.getString(R.string.native_refresh))
        views.setOnClickPendingIntent(R.id.widget_title, openAppIntent(context, kind, config))
        bindFooter(context, views, kind, snapshot, config, style)

        when {
            isDashboard(kind) -> renderDashboard(context, views, kind, snapshot, config, size, style)
            kind == WidgetKind.CHART -> renderChart(context, views, snapshot, config, size, style)
            else -> renderList(context, views, kind, snapshot, config, size, style)
        }
        return views
    }

    private fun bindFooter(
        context: Context,
        views: RemoteViews,
        kind: WidgetKind,
        snapshot: WidgetSnapshot?,
        config: WidgetConfig,
        style: Style,
    ) {
        // A stale cache says so where the link is, instead of passing old
        // numbers off as current.
        val stale = snapshot != null && System.currentTimeMillis() - snapshot.updatedAtMs > STALE_AFTER_MS
        views.setTextViewText(
            R.id.widget_footer_text,
            when {
                snapshot == null -> context.getString(R.string.native_signin)
                stale -> context.getString(
                    R.string.widget_footer_stale,
                    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(snapshot.updatedAtMs)),
                )
                else -> context.getString(R.string.widget_footer_open)
            },
        )
        views.setTextColor(R.id.widget_footer_arrow, if (style.heroOnCream) TERRACOTTA else style.accent)
        views.setOnClickPendingIntent(R.id.widget_footer, openAppIntent(context, kind, config))
    }

    private fun title(context: Context, kind: WidgetKind, config: WidgetConfig): String {
        // The tiles have no room for "Sessions & Agents".
        val base = if (kind == WidgetKind.SESSIONS) context.getString(R.string.widget_title_sessions)
        else context.getString(kind.titleResource)
        // aapt trims the suffix resources' leading space; put it back.
        val suffix = when (kind) {
            WidgetKind.TOKENS, WidgetKind.COST ->
                if (config.period == "7d") context.getString(R.string.native_suffix_week) else context.getString(R.string.native_suffix_today)
            WidgetKind.PROVIDERS, WidgetKind.MODELS -> context.getString(R.string.native_suffix_week)
            else -> ""
        }.trim().let { if (it.isEmpty()) "" else " $it" }
        val filter = config.provider
            ?.takeIf { kind in setOf(WidgetKind.SESSIONS, WidgetKind.PROVIDERS, WidgetKind.MODELS) }
            ?.let { " · $it" } ?: ""
        return base + suffix + filter
    }

    private fun statPeriod(snapshot: WidgetSnapshot, config: WidgetConfig): WPeriod =
        if (config.period == "7d") snapshot.week else snapshot.today

    private fun periodTitle(context: Context, config: WidgetConfig): String =
        if (config.period == "7d") context.getString(R.string.native_week_title) else context.getString(R.string.native_today_title)

    private fun periodLabel(context: Context, config: WidgetConfig): String =
        if (config.period == "7d") context.getString(R.string.native_this_week) else context.getString(R.string.native_today)

    // ── Dashboard (limits + stat widgets) ──────────────────────────────────

    /** What the four tiles of a dashboard show; tiles left null keep "—". */
    private class Dash(
        val brand: String,
        val glyph: Int = R.drawable.widget_glyph_plum,
        val hero: Int,
        val heroLabel: String,
        val heroValue: String,
        val heroSub: String? = null,
        val heroProgress: Int? = null,
        val creamLabel: String,
        val creamValue: String,
        val creamSub: String? = null,
        val creamValueColor: Int = ON_CREAM,
        val darkLabel: String,
        val darkValue: String,
        val wideLabel: String,
        val wideValue: String,
        val wideDot: Int,
        /** Cream sub line to use when the dark tile is hidden (narrow cells). */
        val creamSubNarrow: String? = null,
        /** Wide tile content when the dark tile is hidden; defaults to merging both. */
        val wideLabelNarrow: String? = null,
        val wideValueNarrow: String? = null,
    )

    private fun renderDashboard(
        context: Context,
        views: RemoteViews,
        kind: WidgetKind,
        snapshot: WidgetSnapshot?,
        config: WidgetConfig,
        size: WidgetSize,
        style: Style,
    ) {
        val dash = when {
            // Signed out, the limits widget still reads as the mockup's
            // "not connected" dashboard; the stat widgets keep just the hero.
            kind == WidgetKind.LIMITS -> limitsDash(context, snapshot ?: WidgetSnapshot(), config)
            snapshot == null -> emptyDash(context, kind, config, style)
            kind == WidgetKind.QUICK -> quickDash(context, snapshot, config, style)
            kind == WidgetKind.TOKENS -> tokensDash(context, snapshot, config, style)
            else -> costDash(context, snapshot, config, style)
        }

        val side = size.widthDp >= SIDE_MIN_WIDTH && (snapshot != null || kind == WidgetKind.LIMITS)
        val dark = size.widthDp >= DARK_MIN_WIDTH
        val footer = if (side) size.heightDp >= FOOTER_MIN_HEIGHT else size.heightDp >= FOOTER_MIN_HEIGHT_NARROW
        // Space budget (dp, at font scale 1): what is left inside the hero and
        // a side tile once container, footer and paddings are taken.
        val fontScale = context.resources.configuration.fontScale.coerceAtLeast(1f)
        val body = size.heightDp - 2 * 10 - (if (footer) FOOTER_HEIGHT else 0)
        val roomy = body >= 90
        val heroContent = body - if (roomy) 22 else 12
        val brandRow = roomy && heroContent >= 18 + 20 + 28 * fontScale
        val heroExtras = roomy && heroContent >= (if (brandRow) 18 else 0) + 20 + 30 * fontScale + 16 * fontScale + 14
        val sideTileContent = (body - 7) / 2 - 17
        val creamSubFits = sideTileContent >= 14 + 22 * fontScale + 15 * fontScale

        val heroPad = dp(context, if (roomy) 11 else 6)
        val heroSidePad = dp(context, 14)
        views.setViewPadding(R.id.dash_hero, heroSidePad, heroPad, heroSidePad, heroPad)
        views.setInt(R.id.dash_hero, "setBackgroundResource", dash.hero)
        views.setImageViewResource(R.id.dash_glyph, dash.glyph)
        views.setTextViewText(R.id.widget_title, dash.brand)
        views.setViewVisibility(R.id.dash_brand_row, if (brandRow) View.VISIBLE else View.GONE)
        // Narrow heroes give the refresh glyph's room to the brand name.
        views.setViewVisibility(R.id.widget_refresh, if (dark || !side) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.dash_hero_label, dash.heroLabel)
        views.setTextViewText(R.id.dash_hero_value, dash.heroValue)
        views.setOnClickPendingIntent(R.id.dash_hero, openAppIntent(context, kind, config))
        views.setViewVisibility(R.id.dash_hero_sub, if (heroExtras && dash.heroSub != null) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.dash_hero_sub, dash.heroSub.orEmpty())
        if (heroExtras && dash.heroProgress != null) {
            views.setViewVisibility(R.id.dash_hero_bar, View.VISIBLE)
            views.setProgressBar(R.id.dash_hero_bar, 100, dash.heroProgress.coerceIn(0, 100), false)
        } else {
            views.setViewVisibility(R.id.dash_hero_bar, View.GONE)
        }

        views.setViewVisibility(R.id.dash_side, if (side) View.VISIBLE else View.GONE)
        views.setViewVisibility(R.id.dash_dark, if (dark) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.dash_cream_label, dash.creamLabel)
        views.setTextViewText(R.id.dash_cream_value, dash.creamValue)
        views.setTextColor(R.id.dash_cream_value, dash.creamValueColor)
        val creamSub = (if (dark) dash.creamSub else dash.creamSubNarrow ?: dash.creamSub)?.takeIf { creamSubFits }
        views.setViewVisibility(R.id.dash_cream_sub, if (creamSub != null) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.dash_cream_sub, creamSub.orEmpty())
        views.setTextViewText(R.id.dash_dark_label, dash.darkLabel)
        views.setTextViewText(R.id.dash_dark_value, dash.darkValue)
        views.setTextViewText(
            R.id.dash_wide_label,
            if (dark) dash.wideLabel else dash.wideLabelNarrow ?: "${dash.darkLabel} · ${dash.wideLabel}",
        )
        views.setTextViewText(
            R.id.dash_wide_value,
            if (dark) dash.wideValue else dash.wideValueNarrow ?: "${dash.darkValue.replace('\n', ' ')} · ${dash.wideValue}",
        )
        views.setInt(R.id.dash_wide_dot, "setColorFilter", dash.wideDot)
        views.setViewVisibility(R.id.widget_footer, if (footer) View.VISIBLE else View.GONE)
    }

    private fun emptyDash(context: Context, kind: WidgetKind, config: WidgetConfig, style: Style) = Dash(
        brand = if (kind == WidgetKind.LIMITS) context.getString(R.string.native_limits) else title(context, kind, config),
        hero = style.hero,
        heroLabel = context.getString(R.string.native_no_data),
        heroValue = "—",
        heroSub = context.getString(R.string.native_signin),
        creamLabel = "",
        creamValue = "—",
        darkLabel = "",
        darkValue = "—",
        wideLabel = context.getString(R.string.widget_limit_status),
        wideValue = context.getString(R.string.widget_limit_not_connected),
        wideDot = ORANGE,
        wideLabelNarrow = context.getString(R.string.widget_limit_status),
        wideValueNarrow = context.getString(R.string.widget_limit_not_connected),
    )

    /**
     * The mockup: the current window of one provider as the hero, weekly use
     * on cream, the next weekly reset on dark, a fourth metric with a status
     * dot across the bottom.
     */
    private fun limitsDash(context: Context, s: WidgetSnapshot, config: WidgetConfig): Dash {
        val provider = WidgetLimits.pickProvider(s.limits, config.provider)
        val now = System.currentTimeMillis()
        if (provider == null) {
            return Dash(
                brand = context.getString(R.string.native_limits),
                hero = R.drawable.widget_tile_hero_terracotta,
                heroLabel = context.getString(R.string.widget_limit_current_window),
                heroValue = "—",
                heroSub = context.getString(R.string.native_no_quota),
                heroProgress = 0,
                creamLabel = context.getString(R.string.widget_limit_weekly_usage),
                creamValue = "—",
                creamSub = context.getString(R.string.widget_limit_no_data),
                darkLabel = context.getString(R.string.widget_limit_next_reset),
                darkValue = "—",
                wideLabel = context.getString(R.string.widget_limit_status),
                wideValue = context.getString(R.string.widget_limit_not_connected),
                wideDot = ORANGE,
                wideLabelNarrow = context.getString(R.string.widget_limit_status),
                wideValueNarrow = context.getString(R.string.widget_limit_not_connected),
            )
        }
        val current = WidgetLimits.current(s.limits, provider)
        val long = WidgetLimits.long(s.limits, provider)
        val secondary = WidgetLimits.secondary(s.limits, provider)
        val zone = ZoneId.systemDefault()
        val locale = Locale.getDefault()
        val is24 = android.text.format.DateFormat.is24HourFormat(context)
        fun reset(at: Long, separator: String) = WidgetLimits.formatReset(at, now, zone, locale, is24, separator)

        val heroLabel = current?.takeIf { it.window != WidgetLimits.WINDOW_CURRENT }?.localizedWindow(context)
            ?: context.getString(R.string.widget_limit_current_window)
        val heroSub = when {
            current == null -> null
            current.resetsAtMs <= 0 -> current.localizedWindow(context)
            current.resetsAtMs <= now -> context.getString(R.string.widget_limit_reset_due)
            else -> context.getString(R.string.widget_limit_left, remaining(context, current.resetsAtMs - now))
        }
        // Weekly reset is the one people plan around; the current window's
        // reset stands in when the provider has no long window.
        val nextReset = (long ?: current)?.resetsAtMs?.takeIf { it > 0 }
        val longLabel = if (long?.window == "Month") R.string.widget_limit_monthly_usage else R.string.widget_limit_weekly_usage
        val secondaryLabel = when {
            secondary == null -> context.getString(R.string.widget_limit_status)
            secondary.provider == provider && secondary.window == WidgetLimits.WINDOW_SECONDARY ->
                context.getString(R.string.widget_limit_sonnet_week)
            else -> "${secondary.provider} · ${secondary.localizedWindow(context)}"
        }
        val secondaryValue = secondary?.let { "${it.percent}%" } ?: context.getString(R.string.widget_limit_connected)
        val secondaryDot = secondary?.let { WidgetLimits.statusColor(it.percent).toInt() } ?: GREEN

        return Dash(
            brand = provider,
            glyph = if (provider.contains("claude", ignoreCase = true)) R.drawable.widget_glyph_spark else R.drawable.widget_glyph_plum,
            hero = if (current != null && WidgetLimits.isCritical(current.percent)) R.drawable.widget_tile_hero_red
            else R.drawable.widget_tile_hero_terracotta,
            heroLabel = heroLabel,
            heroValue = current?.let { "${it.percent}%" } ?: "—",
            heroSub = heroSub,
            heroProgress = current?.percent ?: 0,
            creamLabel = context.getString(longLabel),
            creamValue = long?.let { "${it.percent}%" } ?: "—",
            creamSub = if (long != null) context.getString(R.string.widget_limit_all_models) else context.getString(R.string.widget_limit_no_data),
            creamValueColor = when {
                long == null -> ON_CREAM
                WidgetLimits.isCritical(long.percent) -> CREAM_RED
                long.percent >= 60 -> CREAM_AMBER
                else -> ON_CREAM
            },
            darkLabel = context.getString(R.string.widget_limit_next_reset),
            darkValue = nextReset?.let { reset(it, "\n") } ?: "—",
            wideLabel = secondaryLabel,
            wideValue = secondaryValue,
            wideDot = secondaryDot,
            creamSubNarrow = nextReset?.let { context.getString(R.string.widget_limit_reset_at, reset(it, " ")) },
            wideLabelNarrow = secondaryLabel,
            wideValueNarrow = secondaryValue,
        )
    }

    private fun remaining(context: Context, ms: Long): String = WidgetLimits.formatRemaining(
        ms,
        daysHours = { d, h -> context.getString(R.string.widget_duration_days_hours, d, h) },
        hoursMinutes = { h, m -> context.getString(R.string.widget_duration_hours_minutes, h, m) },
        minutes = { m -> context.getString(R.string.widget_duration_minutes, m) },
    )

    private fun quickDash(context: Context, s: WidgetSnapshot, config: WidgetConfig, style: Style): Dash {
        val period = statPeriod(s, config)
        val waiting = s.approvalTotal + s.questionTotal
        return Dash(
            brand = context.getString(R.string.native_app),
            // Something waiting on you turns the tile amber.
            hero = if (waiting > 0) R.drawable.widget_tile_hero_amber else style.hero,
            heroLabel = context.getString(R.string.widget_quick_working),
            heroValue = s.busyTotal.toString(),
            heroSub = if (waiting == 0) context.getString(R.string.native_nothing_pending)
            else context.getString(R.string.native_need_you, waiting),
            creamLabel = context.getString(R.string.native_tokens_period, periodLabel(context, config)),
            creamValue = fmtTokens(period.totalTokens),
            darkLabel = context.getString(R.string.native_cost_lower),
            darkValue = fmtCost(period.costUsd),
            wideLabel = context.getString(R.string.native_requests),
            wideValue = period.requests.toString(),
            wideDot = style.accent,
        )
    }

    private fun tokensDash(context: Context, s: WidgetSnapshot, config: WidgetConfig, style: Style): Dash {
        val period = statPeriod(s, config)
        return Dash(
            brand = context.getString(R.string.native_tokens),
            hero = style.hero,
            heroLabel = periodTitle(context, config),
            heroValue = fmtTokens(period.totalTokens),
            heroSub = "${period.requests} ${context.getString(R.string.native_requests)}",
            creamLabel = context.getString(R.string.native_input),
            creamValue = fmtTokens(period.inputTokens),
            darkLabel = context.getString(R.string.native_output),
            darkValue = fmtTokens(period.outputTokens),
            wideLabel = context.getString(R.string.native_cache_read),
            wideValue = fmtTokens(period.cacheReadTokens),
            wideDot = style.accent,
        )
    }

    private fun costDash(context: Context, s: WidgetSnapshot, config: WidgetConfig, style: Style): Dash {
        val period = statPeriod(s, config)
        val weekly = config.period == "7d"
        val other = if (weekly) s.today else s.week
        val otherLabel = if (weekly) context.getString(R.string.native_today) else context.getString(R.string.native_this_week)
        // Today's cost against the alert budget, when there is one.
        val budget = if (weekly) 0.0 else UsageAlerts.dailyCostThreshold(context)
        val budgetPercent = if (budget > 0) (period.costUsd / budget * 100).toInt() else null
        return Dash(
            brand = context.getString(R.string.native_cost),
            hero = if (budgetPercent != null && budgetPercent >= 100) R.drawable.widget_tile_hero_red else style.hero,
            heroLabel = periodTitle(context, config),
            heroValue = fmtCost(period.costUsd),
            heroSub = if (budgetPercent != null) context.getString(R.string.widget_cost_budget, fmtCost(budget))
            else "${period.requests} ${context.getString(R.string.native_requests)}",
            heroProgress = budgetPercent,
            creamLabel = otherLabel,
            creamValue = fmtCost(other.costUsd),
            darkLabel = context.getString(R.string.native_requests),
            darkValue = period.requests.toString(),
            wideLabel = context.getString(R.string.native_tokens_lower),
            wideValue = fmtTokens(period.totalTokens),
            wideDot = style.accent,
        )
    }

    // ── Lists ──────────────────────────────────────────────────────────────

    /** The hero tile beside a list on wide cells. */
    private class ListHero(val label: String, val value: String, val sub: String?, val hero: Int? = null)

    private fun renderList(
        context: Context,
        views: RemoteViews,
        kind: WidgetKind,
        snapshot: WidgetSnapshot?,
        config: WidgetConfig,
        size: WidgetSize,
        style: Style,
    ) {
        val wide = size.widthDp >= LIST_HERO_MIN_WIDTH
        val footer = size.heightDp >= LIST_FOOTER_MIN_HEIGHT
        val header = !wide

        views.setViewVisibility(R.id.list_header, if (header) View.VISIBLE else View.GONE)
        views.setViewVisibility(R.id.widget_footer, if (footer) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.widget_title, title(context, kind, config))
        views.setTextColor(R.id.widget_title, style.accent)
        views.setInt(R.id.list_header_dot, "setColorFilter", style.accent)
        views.setTextViewText(R.id.widget_headline, "")
        views.setViewVisibility(
            R.id.widget_headline,
            if (size.widthDp >= LIST_HEADLINE_MIN_WIDTH) View.VISIBLE else View.GONE,
        )

        val maxRows = rowCapacity(context, kind, size, header, footer)
        // Too short for a two-line row: rows drop their sub line and bar.
        val singleLine = rowCapacity(context, kind, size, header, footer, singleLine = false, exact = true) == 0
        // Too narrow for a label and two buttons: the row opens the session instead.
        val buttons = size.widthDp >= LIST_HEADLINE_MIN_WIDTH

        val hero = if (snapshot == null) {
            renderEmptyList(context, views)
            ListHero(context.getString(R.string.native_no_data), "—", context.getString(R.string.native_signin))
        } else when (kind) {
            WidgetKind.SESSIONS -> renderSessions(context, views, snapshot, config, maxRows)
            WidgetKind.APPROVALS -> renderApprovals(context, views, snapshot, maxRows)
            WidgetKind.PROVIDERS -> renderProviders(context, views, snapshot, config, maxRows, narrow = size.widthDp < LIST_HEADLINE_MIN_WIDTH)
            WidgetKind.MODELS -> renderModels(context, views, snapshot, config, maxRows)
            WidgetKind.TOP_SESSIONS -> renderTopSessions(context, views, snapshot, maxRows)
            else -> renderMonitor(context, views, snapshot, maxRows)
        }

        if (singleLine || !buttons) {
            ROW_IDS.forEach { ids ->
                if (singleLine) {
                    views.setViewVisibility(ids[4], View.GONE)
                    views.setViewVisibility(ids[5], View.GONE)
                }
                if (!buttons) {
                    views.setViewVisibility(ids[6], View.GONE)
                    views.setViewVisibility(ids[7], View.GONE)
                }
            }
        }

        views.setViewVisibility(R.id.list_hero, if (wide) View.VISIBLE else View.GONE)
        if (wide) {
            views.setInt(R.id.list_hero, "setBackgroundResource", hero.hero ?: style.hero)
            val text = if (style.heroOnCream) ON_CREAM else ON_HERO
            val muted = if (style.heroOnCream) ON_CREAM_MUTED else ON_HERO_MUTED
            views.setTextViewText(R.id.list_hero_title, title(context, kind, config))
            views.setTextColor(R.id.list_hero_title, text)
            views.setInt(R.id.list_hero_glyph, "setColorFilter", text)
            views.setTextColor(R.id.list_hero_refresh, muted)
            views.setTextViewText(R.id.list_hero_label, hero.label)
            views.setTextColor(R.id.list_hero_label, muted)
            views.setTextViewText(R.id.list_hero_value, hero.value)
            views.setTextColor(R.id.list_hero_value, text)
            views.setViewVisibility(R.id.list_hero_sub, if (hero.sub != null) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.list_hero_sub, hero.sub.orEmpty())
            views.setTextColor(R.id.list_hero_sub, text)
            views.setOnClickPendingIntent(R.id.list_hero, openAppIntent(context, kind, config))
            views.setOnClickPendingIntent(R.id.list_hero_refresh, refreshIntent(context, kind))
            views.setContentDescription(R.id.list_hero_refresh, context.getString(R.string.native_refresh))
        }
    }

    /**
     * How many row tiles fit in [size] without clipping, from the row
     * heights in widget_list.xml at the device's font scale.
     */
    private fun rowCapacity(
        context: Context,
        kind: WidgetKind,
        size: WidgetSize,
        header: Boolean,
        footer: Boolean,
        singleLine: Boolean = false,
        exact: Boolean = false,
    ): Int {
        val fontScale = context.resources.configuration.fontScale.coerceAtLeast(1f)
        val available = size.heightDp - 2 * 10 - (if (header) 20 else 0) - (if (footer) FOOTER_HEIGHT else 0)
        val label = 16.5f * fontScale
        val rowBody = when {
            singleLine -> label
            // Label plus a progress bar.
            kind == WidgetKind.PROVIDERS -> label + 9f
            // Label plus a sub line.
            else -> label + 13.5f * fontScale
        }
        val pitch = ROW_GAP + 8f + maxOf(rowBody, 22f)
        val rows = (available / pitch).toInt()
        if (exact) return rows.coerceAtMost(ROW_IDS.size)
        // Below one two-line row, count single-line rows instead.
        if (rows == 0 && !singleLine) return rowCapacity(context, kind, size, header, footer, singleLine = true)
        return rows.coerceIn(1, ROW_IDS.size)
    }

    private fun renderEmptyList(context: Context, views: RemoteViews) {
        ROW_IDS.forEach { views.setViewVisibility(it[0], View.GONE) }
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        views.setTextViewText(R.id.widget_empty, context.getString(R.string.native_open_once))
    }

    /**
     * The same four sessions the Monitor tab shows, with the dashboard's
     * verdict per row. Tapping a row opens that chat; the title opens the tab.
     */
    private fun renderMonitor(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int): ListHero {
        val now = Instant.now()
        val rows = s.monitorSessions.map { it to effectiveState(it.facts(), now, IdleThreshold.DEFAULT.minutes) }
        val working = rows.count { it.second.activity == SessionActivity.WORKING }
        val needsYou = rows.count { it.second.activity == SessionActivity.NEEDS_YOU }
        val headline =
            if (needsYou > 0) context.getString(R.string.native_needs_working, needsYou, working)
            else context.getString(R.string.native_working, working)
        views.setTextViewText(R.id.widget_headline, headline)
        bindRows(views, rows.size, maxRows, emptyMessage = context.getString(R.string.native_monitor_empty)) { i, ids ->
            val (session, state) = rows[i]
            dot(views, ids[1], widgetArgb(state))
            views.setTextViewText(ids[2], session.name)
            views.setTextViewText(ids[3], "")
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], subLine(session.provider, state.localizedLabel(context, session.facts())))
            views.setOnClickPendingIntent(ids[0], sessionIntent(context, session.id, i))
        }
        return if (needsYou > 0) {
            ListHero(context.getString(R.string.widget_hero_need_you), needsYou.toString(), context.getString(R.string.native_working, working), R.drawable.widget_tile_hero_amber)
        } else {
            ListHero(context.getString(R.string.widget_hero_working), working.toString(), context.getString(R.string.widget_hero_of_sessions, rows.size))
        }
    }

    private fun renderSessions(
        context: Context,
        views: RemoteViews,
        s: WidgetSnapshot,
        config: WidgetConfig,
        maxRows: Int,
    ): ListHero {
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
        val headline =
            if (needsYou > 0) context.getString(R.string.native_needs_working, needsYou, working)
            else context.getString(R.string.native_working_waiting, working, s.approvalTotal + s.questionTotal)
        views.setTextViewText(R.id.widget_headline, headline)

        // The fetcher caps its list at the widest layout, so sessions beyond
        // that never reach the cache; both kinds of omission are counted here so
        // the last row can say how many the widget is not showing.
        val capacity = maxRows.coerceAtMost(ROW_IDS.size)
        val uncached =
            if (config.provider == null) (s.sessionTotal - s.sessions.size).coerceAtLeast(0) else 0
        // A single row is better spent on the first session than on "+N more".
        val fits = rows.size + uncached <= capacity || capacity == 1
        val shown = if (fits) rows.size.coerceAtMost(capacity) else capacity - 1
        val hidden = if (fits) 0 else rows.size - shown + uncached

        bindRows(views, shown + if (hidden > 0) 1 else 0, capacity, emptyMessage = context.getString(R.string.native_no_sessions)) { i, ids ->
            if (i == shown) {
                bindOverflowRow(context, views, ids, hidden)
                return@bindRows
            }
            val (session, state) = rows[i]
            dot(views, ids[1], widgetArgb(state))
            views.setTextViewText(ids[2], session.name)
            views.setTextViewText(ids[3], "")
            views.setViewVisibility(ids[4], View.VISIBLE)
            // The verdict, not the raw status — "running" is what a session
            // stuck on an approval prompt also calls itself. The provider
            // shares the line so the name keeps the row's full width.
            views.setTextViewText(ids[4], subLine(session.provider, state.localizedLabel(context, session.facts())))
            views.setOnClickPendingIntent(ids[0], sessionIntent(context, session.id, i))
        }
        return if (needsYou > 0) {
            ListHero(context.getString(R.string.widget_hero_need_you), needsYou.toString(), context.getString(R.string.native_working, working), R.drawable.widget_tile_hero_amber)
        } else {
            ListHero(context.getString(R.string.widget_hero_working), working.toString(), context.getString(R.string.widget_hero_of_sessions, s.sessionTotal))
        }
    }

    private fun subLine(provider: String, verdict: String): String =
        if (provider.isBlank()) verdict else "$provider · $verdict"

    private fun bindOverflowRow(context: Context, views: RemoteViews, ids: IntArray, hidden: Int) {
        dot(views, ids[1], FAINT)
        views.setTextViewText(ids[2], context.getString(R.string.native_more, hidden))
        views.setTextViewText(ids[3], "")
        views.setOnClickPendingIntent(ids[0], dashboardIntent(context))
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
    private fun renderApprovals(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int): ListHero {
        val total = s.approvalTotal + s.questionTotal
        views.setTextViewText(
            R.id.widget_headline,
            if (total == 0) context.getString(R.string.native_all_clear) else context.getString(R.string.native_pending, total),
        )
        // Same arithmetic as the session list: the fetcher caps what it caches, so
        // the last row is spent saying how many are out of sight rather than
        // letting the widget imply there are none.
        val capacity = maxRows.coerceAtMost(ROW_IDS.size)
        val fits = total <= capacity || capacity == 1
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
                bindOverflowRow(context, views, ids, hidden)
                return@bindRows
            }
            if (i < s.approvals.size) {
                bindApprovalRow(context, views, ids, s.approvals[i], i)
            } else {
                bindQuestionRow(context, views, ids, s.questions[i - s.approvals.size], i)
            }
        }
        return ListHero(
            context.getString(R.string.widget_hero_waiting),
            total.toString(),
            if (total == 0) context.getString(R.string.native_all_clear)
            else context.getString(R.string.widget_hero_waiting_split, s.approvalTotal, s.questionTotal),
            if (total == 0) R.drawable.widget_tile_hero_green else null,
        )
    }

    private fun bindApprovalRow(
        context: Context,
        views: RemoteViews,
        ids: IntArray,
        approval: WApproval,
        row: Int,
    ) {
        dot(views, ids[1], AMBER)
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
        dot(views, ids[1], VIOLET)
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

    private fun renderProviders(
        context: Context,
        views: RemoteViews,
        s: WidgetSnapshot,
        config: WidgetConfig,
        maxRows: Int,
        narrow: Boolean,
    ): ListHero {
        val providers = s.providers.filter { config.provider == null || it.name.equals(config.provider, true) }
        views.setTextViewText(R.id.widget_headline, fmtCost(s.week.costUsd))
        val maxTokens = providers.maxOfOrNull { it.tokens }?.coerceAtLeast(1) ?: 1
        bindRows(views, providers.size, maxRows, emptyMessage = context.getString(R.string.native_no_week_usage)) { i, ids ->
            val entry = providers[i]
            dot(views, ids[1], entry.colorArgb.toInt())
            views.setTextViewText(ids[2], entry.name)
            // Narrow rows keep the name readable and show only the cost.
            views.setTextViewText(ids[3], if (narrow) fmtCost(entry.costUsd) else "${fmtTokens(entry.tokens)} · ${fmtCost(entry.costUsd)}")
            views.setViewVisibility(ids[5], View.VISIBLE)
            views.setProgressBar(ids[5], 100, (entry.tokens * 100 / maxTokens).toInt(), false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                views.setColorStateList(ids[5], "setProgressTintList", ColorStateList.valueOf(entry.colorArgb.toInt()))
            }
        }
        return ListHero(
            context.getString(R.string.native_week_title),
            fmtCost(providers.sumOf { it.costUsd }.takeIf { config.provider != null } ?: s.week.costUsd),
            context.getString(R.string.native_token_count, fmtTokens(providers.sumOf { it.tokens })),
        )
    }

    private fun renderModels(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, maxRows: Int): ListHero {
        val models = s.models.filter { config.provider == null || it.sub.equals(config.provider, true) }
        views.setTextViewText(R.id.widget_headline, fmtCost(models.sumOf { it.costUsd }))
        bindRows(views, models.size, maxRows, emptyMessage = context.getString(R.string.native_no_week_usage)) { i, ids ->
            val entry = models[i]
            dot(views, ids[1], entry.colorArgb.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], fmtCost(entry.costUsd))
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], context.getString(R.string.native_provider_tokens, entry.sub, fmtTokens(entry.tokens)))
        }
        return ListHero(
            context.getString(R.string.native_week_title),
            fmtCost(models.sumOf { it.costUsd }),
            models.firstOrNull()?.let { context.getString(R.string.widget_hero_top_model, it.name) },
        )
    }

    private fun renderTopSessions(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int): ListHero {
        bindRows(views, s.topSessions.size, maxRows, emptyMessage = context.getString(R.string.native_no_week_usage)) { i, ids ->
            val entry = s.topSessions[i]
            dot(views, ids[1], COPPER)
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], fmtCost(entry.costUsd))
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], context.getString(R.string.native_token_count, fmtTokens(entry.tokens)))
            if (entry.id.isNotBlank()) {
                views.setOnClickPendingIntent(ids[0], sessionIntent(context, entry.id, i))
            }
        }
        val top = s.topSessions.firstOrNull()
        return ListHero(
            context.getString(R.string.widget_hero_top_session),
            top?.let { fmtCost(it.costUsd) } ?: "—",
            top?.name,
        )
    }

    // ── Chart ──────────────────────────────────────────────────────────────

    private fun renderChart(
        context: Context,
        views: RemoteViews,
        s: WidgetSnapshot?,
        config: WidgetConfig,
        size: WidgetSize,
        style: Style,
    ) {
        val headline = size.heightDp >= CHART_HEADLINE_MIN_HEIGHT
        val footer = size.heightDp >= CHART_FOOTER_MIN_HEIGHT && size.widthDp >= SIDE_MIN_WIDTH
        views.setTextViewText(R.id.widget_title, title(context, WidgetKind.CHART, config))
        views.setTextColor(R.id.widget_title, style.accent)
        views.setInt(R.id.list_header_dot, "setColorFilter", style.accent)
        views.setViewVisibility(R.id.chart_headline_row, if (headline) View.VISIBLE else View.GONE)
        views.setViewVisibility(R.id.widget_footer, if (footer) View.VISIBLE else View.GONE)
        if (s == null) {
            views.setTextViewText(R.id.widget_headline, "—")
            views.setTextViewText(R.id.chart_headline_sub, context.getString(R.string.native_signin))
            views.setImageViewBitmap(R.id.widget_chart, chartBitmap(context, emptyList()))
            views.setViewVisibility(R.id.chart_days, View.GONE)
            return
        }
        views.setTextViewText(R.id.widget_headline, fmtTokens(s.week.totalTokens))
        views.setTextViewText(
            R.id.chart_headline_sub,
            "${context.getString(R.string.native_tokens_lower)} · ${fmtCost(s.week.costUsd)}",
        )
        views.setImageViewBitmap(R.id.widget_chart, chartBitmap(context, s.days))
        views.setOnClickPendingIntent(R.id.widget_chart, openAppIntent(context, WidgetKind.CHART, config))
        CHART_DAY_IDS.forEachIndexed { i, id ->
            val day = s.days.getOrNull(i)
            views.setViewVisibility(id, if (day != null) View.VISIBLE else View.GONE)
            views.setTextViewText(id, day?.let { dayLabel(it.label) }.orEmpty())
            if (day != null && i == s.days.lastIndex) views.setTextColor(id, 0xFFF3ECE1.toInt())
        }
    }

    private val CHART_DAY_IDS = intArrayOf(
        R.id.chart_day1, R.id.chart_day2, R.id.chart_day3, R.id.chart_day4,
        R.id.chart_day5, R.id.chart_day6, R.id.chart_day7,
    )

    // One bitmap per data set: every size variant of a chart widget refers to
    // the same Bitmap object, which RemoteViews stores only once.
    private var chartMemo: Pair<Pair<List<WDay>, Locale>, Bitmap>? = null

    @Synchronized
    private fun chartBitmap(context: Context, days: List<WDay>): Bitmap {
        val key = days to Locale.getDefault()
        chartMemo?.takeIf { it.first == key }?.let { return it.second }
        return drawChart(context, days).also { chartMemo = key to it }
    }

    private fun drawChart(context: Context, days: List<WDay>): Bitmap {
        val width = 560
        val height = 220
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TERRACOTTA }
        val todayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFF3ECE1.toInt() }
        val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x10FFFFFF }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFA39CA6.toInt()
            textSize = 22f
            textAlign = Paint.Align.CENTER
        }

        val chartHeight = height.toFloat()

        if (days.isEmpty()) {
            textPaint.textSize = 26f
            canvas.drawText(context.getString(R.string.native_no_activity), width / 2f, chartHeight / 2f, textPaint)
            return bitmap
        }

        val max = days.maxOf { it.tokens }.coerceAtLeast(1)
        val slot = width.toFloat() / days.size
        val barWidth = slot * 0.56f
        val radius = barWidth / 2.6f
        days.forEachIndexed { i, day ->
            val left = i * slot + (slot - barWidth) / 2f
            val top = 8f
            // A faint full-height track so short days still read as a column.
            canvas.drawRoundRect(RectF(left, top, left + barWidth, chartHeight - 6f), radius, radius, trackPaint)
            val barHeight = ((day.tokens.toFloat() / max) * (chartHeight - top - 6f)).coerceAtLeast(if (day.tokens > 0) radius * 2 else 0f)
            if (barHeight > 0f) {
                canvas.drawRoundRect(
                    RectF(left, chartHeight - 6f - barHeight, left + barWidth, chartHeight - 6f),
                    radius, radius,
                    if (i == days.lastIndex) todayPaint else barPaint,
                )
            }
        }
        return bitmap
    }

    /** "2026-08-10" → "Su"; hourly labels pass through shortened. */
    private fun dayLabel(raw: String): String = runCatching {
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(raw)
        SimpleDateFormat("EE", Locale.getDefault()).format(date!!).take(2)
    }.getOrDefault(raw.takeLast(2))

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density + 0.5f).toInt()

    private fun dot(views: RemoteViews, id: Int, color: Int) {
        views.setInt(id, "setColorFilter", color)
    }

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

    private fun fmtTokens(value: Long): String = when {
        value >= 1_000_000_000 -> "%.1fB".format(value / 1_000_000_000.0)
        value >= 1_000_000 -> "%.1fM".format(value / 1_000_000.0)
        value >= 1_000 -> "%.1fk".format(value / 1_000.0)
        else -> value.toString()
    }

    private fun fmtCost(value: Double): String =
        if (value >= 100) "$%.0f".format(value) else "$%.2f".format(value)

    // ── Layout thresholds (dp) ─────────────────────────────────────────────

    private const val STALE_AFTER_MS = 60 * 60 * 1000L
    private const val SIDE_MIN_WIDTH = 220
    private const val DARK_MIN_WIDTH = 300
    private const val FOOTER_MIN_HEIGHT = 170
    private const val FOOTER_MIN_HEIGHT_NARROW = 230
    private const val FOOTER_HEIGHT = 26
    private const val LIST_HERO_MIN_WIDTH = 300
    private const val LIST_HEADLINE_MIN_WIDTH = 220
    private const val LIST_FOOTER_MIN_HEIGHT = 190
    private const val CHART_HEADLINE_MIN_HEIGHT = 150
    private const val CHART_FOOTER_MIN_HEIGHT = 210
    private const val ROW_GAP = 4f

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
            WidgetKind.MONITOR -> "claudewebui://monitor"
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
