package com.claudewebui.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.SizeF
import android.widget.RemoteViews

const val ACTION_WIDGET_REFRESH = "com.claudewebui.app.widget.REFRESH"

/** Maps each widget kind to its manifest-registered receiver class. */
fun WidgetKind.providerClass(): Class<out AppWidgetProvider> = when (this) {
    WidgetKind.SESSIONS -> SessionWidgetReceiver::class.java
    WidgetKind.APPROVALS -> ApprovalsWidgetReceiver::class.java
    WidgetKind.QUICK -> QuickGlanceWidgetReceiver::class.java
    WidgetKind.TOKENS -> TokensTodayWidgetReceiver::class.java
    WidgetKind.COST -> CostTodayWidgetReceiver::class.java
    WidgetKind.PROVIDERS -> ProvidersWidgetReceiver::class.java
    WidgetKind.MODELS -> ModelsWidgetReceiver::class.java
    WidgetKind.LIMITS -> LimitsWidgetReceiver::class.java
    WidgetKind.CHART -> WeekChartWidgetReceiver::class.java
    WidgetKind.TOP_SESSIONS -> TopSessionsWidgetReceiver::class.java
    WidgetKind.MONITOR -> MonitorWidgetReceiver::class.java
}

/**
 * Pushes rendered RemoteViews to every placed Plum widget. Rendering always
 * happens from the cached snapshot; fetching fresh data is the
 * [WidgetRefreshWorker]'s job so widget broadcasts stay within their budget.
 */
object WidgetHub {

    fun pushAll(context: Context, snapshot: WidgetSnapshot? = WidgetStore.load(context)) {
        val manager = AppWidgetManager.getInstance(context)
        WidgetKind.entries.forEach { kind ->
            val ids = manager.getAppWidgetIds(ComponentName(context, kind.providerClass()))
            ids.forEach { id -> manager.updateAppWidget(id, buildViews(context, kind, id, snapshot)) }
        }
    }

    /**
     * One variant per size bucket on Android 12+: the launcher shows the
     * largest bucket that fits, and each variant is laid out for its bucket's
     * lower bound, so tiles and rows never clip — a bigger cell only adds
     * slack, the next bucket up adds tiles or rows. Older releases get one
     * variant for the size the launcher reported.
     */
    private fun buildViews(
        context: Context,
        kind: WidgetKind,
        appWidgetId: Int,
        snapshot: WidgetSnapshot?,
    ): RemoteViews {
        val config = WidgetConfigStore.load(context, appWidgetId)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(appWidgetId)
            // Portrait: the narrow width and the tall height.
            val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
            val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
            val size = if (width > 0 && height > 0) bucketFor(kind, width, height) else WidgetSize.DEFAULT
            return WidgetRenderer.render(context, kind, snapshot, config, size = size)
        }
        return RemoteViews(
            buckets(kind).associate { size ->
                SizeF(size.widthDp.toFloat(), size.heightDp.toFloat()) to
                    WidgetRenderer.render(context, kind, snapshot, config, size = size)
            }
        )
    }

    // At most 16 variants per widget (the RemoteViews limit). Dashboards
    // spend them where their tiles change: narrow cells only show the hero.
    private val DASHBOARD_NARROW_HEIGHTS = intArrayOf(60, 110, 145, 170, 230)
    private val DASHBOARD_WIDTHS = intArrayOf(220, 300)
    private val DASHBOARD_HEIGHTS = intArrayOf(60, 110, 145, 170, 190)
    private val LIST_WIDTHS = intArrayOf(100, 300)
    private val LIST_HEIGHTS = intArrayOf(60, 110, 140, 165, 190, 220, 260, 330)
    private val CHART_WIDTHS = intArrayOf(100, 220)
    private val CHART_HEIGHTS = intArrayOf(60, 150, 210)

    /** The sizes a widget kind is laid out for. */
    fun buckets(kind: WidgetKind): List<WidgetSize> {
        fun grid(widths: IntArray, heights: IntArray) = widths.flatMap { w -> heights.map { h -> WidgetSize(w, h) } }
        return when (kind) {
            WidgetKind.LIMITS, WidgetKind.QUICK, WidgetKind.TOKENS, WidgetKind.COST ->
                grid(intArrayOf(100), DASHBOARD_NARROW_HEIGHTS) + grid(DASHBOARD_WIDTHS, DASHBOARD_HEIGHTS)
            WidgetKind.CHART -> grid(CHART_WIDTHS, CHART_HEIGHTS)
            else -> grid(LIST_WIDTHS, LIST_HEIGHTS)
        }
    }

    /**
     * The variant a launcher shows at [widthDp]×[heightDp]: the largest bucket
     * that fits, or the smallest when none does.
     */
    fun bucketFor(kind: WidgetKind, widthDp: Int, heightDp: Int): WidgetSize {
        val all = buckets(kind)
        return all.filter { it.widthDp <= widthDp && it.heightDp <= heightDp }
            .maxByOrNull { it.widthDp * it.heightDp }
            ?: all.minBy { it.widthDp * it.heightDp }
    }

    fun hasAnyWidgets(context: Context): Boolean {
        val manager = AppWidgetManager.getInstance(context)
        return WidgetKind.entries.any { kind ->
            manager.getAppWidgetIds(ComponentName(context, kind.providerClass())).isNotEmpty()
        }
    }
}

/**
 * Shared behaviour for all ten widgets: render instantly from cache, then
 * hand the network refresh to WorkManager. The manual "↻" tap forces a fetch.
 */
abstract class BaseWidgetProvider : AppWidgetProvider() {

    abstract val kind: WidgetKind

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        WidgetHub.pushAll(context)
        WidgetRefreshWorker.refreshNow(context)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle?,
    ) {
        // Resize picks a different SizeF variant automatically on S+, but a
        // re-push keeps pre-S devices coherent too.
        WidgetHub.pushAll(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_WIDGET_REFRESH) {
            WidgetRefreshWorker.refreshNow(context)
            return
        }
        super.onReceive(context, intent)
    }

    override fun onEnabled(context: Context) {
        WidgetRefreshWorker.ensurePeriodic(context)
    }
}

class ApprovalsWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.APPROVALS
}

class QuickGlanceWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.QUICK
}

class TokensTodayWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.TOKENS
}

class CostTodayWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.COST
}

class ProvidersWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.PROVIDERS
}

class ModelsWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.MODELS
}

class LimitsWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.LIMITS
}

class WeekChartWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.CHART
}

class TopSessionsWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.TOP_SESSIONS
}

class MonitorWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.MONITOR
}
