package com.claudewebui.app.ui.theme

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AppThemeOption(private val labelRes: Int, private val descriptionRes: Int) {
    SYSTEM(com.claudewebui.app.R.string.settings_theme_system, com.claudewebui.app.R.string.settings_theme_system_description),
    DARK(com.claudewebui.app.R.string.settings_theme_dark, com.claudewebui.app.R.string.settings_theme_dark_description),
    LIGHT(com.claudewebui.app.R.string.settings_theme_light, com.claudewebui.app.R.string.settings_theme_light_description),
    EINK(com.claudewebui.app.R.string.settings_theme_eink, com.claudewebui.app.R.string.settings_theme_eink_description);

    fun localizedLabel(resources: android.content.res.Resources): String = resources.getString(labelRes)
    fun localizedDescription(resources: android.content.res.Resources): String = resources.getString(descriptionRes)
}

/**
 * Holds the selected theme for the whole app.
 *
 * The activity has to observe this — it sits above the navigation graph and
 * owns the system bar colours, so a preference kept only inside the settings
 * ViewModel could never repaint anything. Backed by the same SharedPreferences
 * file the rest of the local settings use, so the choice survives restarts and
 * is readable before Compose starts.
 */
object AppThemeStore {

    private const val PREFS_NAME = "settings_prefs"
    private const val KEY_THEME = "theme"

    private val _theme = MutableStateFlow(AppThemeOption.SYSTEM)
    val theme: StateFlow<AppThemeOption> = _theme.asStateFlow()

    fun initialize(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = prefs.getString(KEY_THEME, AppThemeOption.SYSTEM.name)
        _theme.value = AppThemeOption.entries.firstOrNull { it.name == stored }
            ?: AppThemeOption.SYSTEM
    }

    fun set(context: Context, option: AppThemeOption) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, option.name)
            .apply()
        _theme.value = option
    }

    /**
     * Adopt the account theme, but only when the user turned on appearance sync
     * in the WebUI. Without that guard the server default would silently
     * override whatever was chosen on this phone.
     */
    fun applyServerTheme(context: Context, serverTheme: String?, syncEnabled: Boolean) {
        if (!syncEnabled || serverTheme.isNullOrBlank()) return
        val option = when (serverTheme.lowercase()) {
            "dark" -> AppThemeOption.DARK
            "light" -> AppThemeOption.LIGHT
            "eink" -> AppThemeOption.EINK
            "system" -> AppThemeOption.SYSTEM
            else -> return
        }
        if (option != _theme.value) set(context, option)
    }
}
