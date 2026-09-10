package com.claudewebui.app.widget

import android.content.Context
import com.claudewebui.app.R

/** Keep stored quota identifiers stable and resolve their labels when displayed. */
fun WLimit.localizedWindow(context: Context): String = when (window) {
    "5h" -> context.getString(R.string.native_window_five_hours)
    "Weekly" -> context.getString(R.string.native_window_week)
    "Weekly Sonnet" -> context.getString(R.string.native_window_week_sonnet)
    else -> window
}
