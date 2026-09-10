package com.claudewebui.app.ui.components.dashboard

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * How patient the dashboard is before it stops believing a session's own
 * "working" claim.
 *
 * Stored beside the theme and the layout choice so it is readable before
 * Compose starts, and exposed as a flow so changing it in Settings repaints the
 * open dashboard rather than waiting for the next refresh.
 */
object IdlePrefs {

    private const val PREFS_NAME = "settings_prefs"
    private const val KEY_IDLE_AFTER = "dashboard_idle_after"

    private val _threshold = MutableStateFlow(IdleThreshold.DEFAULT)
    val threshold: StateFlow<IdleThreshold> = _threshold.asStateFlow()

    fun initialize(context: Context) {
        val stored = context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_IDLE_AFTER, IdleThreshold.DEFAULT.name)
        _threshold.value = IdleThreshold.entries.firstOrNull { it.name == stored }
            ?: IdleThreshold.DEFAULT
    }

    fun set(context: Context, option: IdleThreshold) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_IDLE_AFTER, option.name)
            .apply()
        _threshold.value = option
    }
}
