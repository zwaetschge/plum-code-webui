package com.claudewebui.app.ui.theme

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class TwoPaneOption(val label: String, val description: String) {
    AUTO("Automatic", "Two panes from 840dp of width"),
    ALWAYS("Always", "Two panes even on a narrower window"),
    NEVER("Never", "Always the single-column list"),
}

/**
 * Whether the dashboard shows the session list and chat side by side.
 *
 * The width threshold alone was not enough. It measures dp, not pixels, so a
 * device with the display zoom turned up reports far less width than it has:
 * the iPlay tablet is 1920px across but runs at density 420 instead of its
 * native 320, which works out to 731dp — below the 840dp Material breakpoint.
 * It therefore fell back to the phone layout on a screen with obvious room for
 * two panes, and nothing in the UI could override that.
 *
 * Kept in the same SharedPreferences file as the theme so it is readable before
 * Compose starts and survives restarts.
 */
object LayoutPrefs {

    private const val PREFS_NAME = "settings_prefs"
    private const val KEY_TWO_PANE = "two_pane_layout"

    private val _twoPane = MutableStateFlow(TwoPaneOption.AUTO)
    val twoPane: StateFlow<TwoPaneOption> = _twoPane.asStateFlow()

    fun initialize(context: Context) {
        val stored = context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_TWO_PANE, TwoPaneOption.AUTO.name)
        _twoPane.value = TwoPaneOption.entries.firstOrNull { it.name == stored } ?: TwoPaneOption.AUTO
    }

    fun set(context: Context, option: TwoPaneOption) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_TWO_PANE, option.name)
            .apply()
        _twoPane.value = option
    }

    /**
     * @param widthIsExpanded what the automatic breakpoint decided.
     */
    fun shouldUseTwoPane(option: TwoPaneOption, widthIsExpanded: Boolean): Boolean = when (option) {
        TwoPaneOption.AUTO -> widthIsExpanded
        TwoPaneOption.ALWAYS -> true
        TwoPaneOption.NEVER -> false
    }
}
