package com.claudewebui.app.widget

import com.claudewebui.app.R
import android.content.Context
import com.claudewebui.app.core.notifications.NotificationService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Threshold alerts computed from the widget snapshot each refresh: provider
 * quota crossing [LIMIT_THRESHOLD_PERCENT] and daily API-equivalent cost
 * crossing the configured budget. Each alert fires once per day/window via
 * dedup keys in the widget prefs.
 */
object UsageAlerts {

    const val LIMIT_THRESHOLD_PERCENT = 80
    const val DEFAULT_DAILY_COST_USD = 5.0

    private const val PREFS = "plum_widget_cache"
    private const val KEY_ENABLED = "usage_alerts_enabled"
    private const val KEY_DAILY_COST = "usage_alerts_daily_cost"
    private const val KEY_QUOTA_PERCENT = "usage_alerts_quota_percent"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun dailyCostThreshold(context: Context): Double =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getFloat(KEY_DAILY_COST, DEFAULT_DAILY_COST_USD.toFloat()).toDouble()

    /**
     * Cache the account-wide thresholds so the worker can apply them without a
     * settings round-trip. Written by the settings screen after a save.
     */
    fun cacheServerSettings(context: Context, settings: com.claudewebui.app.data.model.UsageAlertSettings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ENABLED, settings.enabled)
            .putInt(KEY_QUOTA_PERCENT, settings.quotaPercent)
            .putFloat(KEY_DAILY_COST, settings.dailyCostUsd.toFloat())
            .apply()
    }

    fun quotaThreshold(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_QUOTA_PERCENT, LIMIT_THRESHOLD_PERCENT)

    fun check(context: Context, snapshot: WidgetSnapshot) {
        if (!isEnabled(context)) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

        // Dedup keys are date-stamped and never read again once the day rolls
        // over; drop the stale ones so the prefs file stays small.
        prefs.all.keys
            .filter { it.startsWith("alert_") && !it.endsWith(today) }
            .takeIf { it.isNotEmpty() }
            ?.let { stale -> prefs.edit().apply { stale.forEach { remove(it) } }.apply() }

        snapshot.limits
            .filter { it.percent >= quotaThreshold(context) }
            .forEach { limit ->
                val key = "alert_limit_${limit.provider}_${limit.window}_$today"
                if (prefs.getBoolean(key, false)) return@forEach
                prefs.edit().putBoolean(key, true).apply()
                NotificationService.notifyUsageAlert(
                    context,
                    tag = key,
                    title = context.getString(R.string.native_quota_title, limit.provider, limit.localizedWindow(context), limit.percent),
                    message = context.getString(R.string.native_quota_body, limit.percent, limit.provider, limit.localizedWindow(context)),
                )
            }

        val budget = dailyCostThreshold(context)
        if (budget > 0 && snapshot.today.costUsd >= budget) {
            val key = "alert_cost_$today"
            if (!prefs.getBoolean(key, false)) {
                prefs.edit().putBoolean(key, true).apply()
                NotificationService.notifyUsageAlert(
                    context,
                    tag = key,
                    title = context.getString(R.string.native_cost_alert_title, budget),
                    message = context.getString(R.string.native_cost_alert_body, snapshot.today.costUsd),
                )
            }
        }
    }
}
