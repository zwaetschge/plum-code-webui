package com.claudewebui.app.ui.theme

import android.content.Context
import android.content.res.Resources
import com.claudewebui.app.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The same background ids used by the WebUI and /api/settings. */
enum class AppBackgroundStyle(
    val id: String,
    private val labelRes: Int,
    private val descriptionRes: Int,
) {
    AURORA("aurora", R.string.settings_background_plum_waves, R.string.settings_background_plum_waves_description),
    GLASS("glass", R.string.settings_background_misty_waterdrops, R.string.settings_background_misty_waterdrops_description),
    RIBBONS("ribbons", R.string.settings_background_neon_glow, R.string.settings_background_neon_glow_description),
    STILL("still", R.string.settings_background_aurora_galaxy, R.string.settings_background_aurora_galaxy_description);

    fun localizedLabel(resources: Resources): String = resources.getString(labelRes)
    fun localizedDescription(resources: Resources): String = resources.getString(descriptionRes)

    companion object {
        fun fromId(id: String?): AppBackgroundStyle? = entries.firstOrNull { it.id == id }
    }
}

/** Device-local unless appearance sync is enabled for the account. */
object AppBackgroundStore {
    private const val PREFS_NAME = "settings_prefs"
    private const val KEY_BACKGROUND = "background_animation"

    private val _style = MutableStateFlow(AppBackgroundStyle.AURORA)
    val style: StateFlow<AppBackgroundStyle> = _style.asStateFlow()

    fun initialize(context: Context) {
        val saved = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_BACKGROUND, AppBackgroundStyle.AURORA.id)
        _style.value = AppBackgroundStyle.fromId(saved) ?: AppBackgroundStyle.AURORA
    }

    fun set(context: Context, style: AppBackgroundStyle) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_BACKGROUND, style.id).apply()
        _style.value = style
    }

    fun applyServerBackground(context: Context, id: String?, syncEnabled: Boolean) {
        if (!syncEnabled) return
        val serverStyle = AppBackgroundStyle.fromId(id) ?: return
        if (serverStyle != _style.value) set(context, serverStyle)
    }
}
