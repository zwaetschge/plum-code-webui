package com.claudewebui.app.ui.screens.monitor

import android.content.Context

/**
 * Which sessions sit in the monitor's four slots, shared between the screen
 * and the home-screen widget so both show the same four.
 */
object MonitorSlotsStore {
    private const val PREFS = "monitor_prefs"
    private const val KEY_SLOTS = "slots_v1"

    /** Null when the user never chose; the screen then applies its defaults. */
    fun loadRaw(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SLOTS, null)

    fun load(context: Context): List<String?> = decodeMonitorSlots(loadRaw(context))

    fun save(context: Context, slots: List<String?>) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SLOTS, encodeMonitorSlots(slots))
            .apply()
    }
}
