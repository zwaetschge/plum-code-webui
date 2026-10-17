package com.claudewebui.app.core.devicecontrol

import android.content.Context
import android.content.SharedPreferences

/**
 * Device-control preferences. The actual gate is the accessibility service:
 * enabling it in Android's settings is the consent moment. [enabled] only
 * allows the user to pause the bridge without turning the service off.
 */
object DeviceControlPrefs {
    private const val PREFS = "device_control_prefs"
    private const val KEY_ENABLED = "enabled"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** True unless the user switched control off in the app. Default: on. */
    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }
}
