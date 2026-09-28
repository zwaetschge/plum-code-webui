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
     * Full and compact variants on Android 12+ so a widget squeezed to 2×1
     * still reads; older releases get the full layout only.
     */
    private fun buildViews(
        context: Context,
        kind: WidgetKind,
        appWidgetId: Int,
        snapshot: WidgetSnapshot?,
    ): RemoteViews {
        val config = WidgetConfigStore.load(context, appWidgetId)
        val full = WidgetRenderer.render(context, kind, snapshot, config, compact = false)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return full
        // The chart scales itself; a second variant would only re-draw the
        // same bitmap at extra cost.
        if (kind == WidgetKind.CHART) return full
        val compact = WidgetRenderer.render(context, kind, snapshot, config, compact = true)
        return RemoteViews(
            mapOf(
                SizeF(100f, 60f) to compact,
                SizeF(220f, 130f) to full,
            )
        )
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
