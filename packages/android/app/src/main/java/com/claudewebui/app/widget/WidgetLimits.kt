package com.claudewebui.app.widget

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * The limits dashboard's decisions, kept free of Android so they can be unit
 * tested: which provider the widget shows, which of its windows go into which
 * tile, and how reset times read.
 */
internal object WidgetLimits {

    const val WINDOW_CURRENT = "5h"
    private val LONG_WINDOWS = setOf("Weekly", "Month")
    const val WINDOW_SECONDARY = "Weekly Sonnet"

    /**
     * The provider the dashboard is about. A configured filter wins when it
     * names a provider with quota data — the filter holds CLI display names
     * ("Claude Code", "Mistral Vibe"), the limits carry account labels
     * ("Claude", "Vibe"), so the match is on normalised names, preferring an
     * exact match, then a suffix ("Mistral Vibe" → "Vibe"), then containment.
     * Otherwise the provider whose current window is fullest.
     */
    fun pickProvider(limits: List<WLimit>, configured: String?): String? {
        val providers = limits.map { it.provider }.distinct()
        if (providers.isEmpty()) return null
        configured?.let { filter ->
            val wanted = normalise(filter)
            if (wanted.isNotEmpty()) {
                val match = providers.firstOrNull { normalise(it) == wanted }
                    ?: providers.filter { wanted.endsWith(normalise(it)) }.maxByOrNull { it.length }
                    ?: providers.filter {
                        val name = normalise(it)
                        name.isNotEmpty() && (wanted.contains(name) || name.contains(wanted))
                    }.maxByOrNull { it.length }
                if (match != null) return match
            }
        }
        return providers.maxByOrNull { provider -> current(limits, provider)?.percent ?: -1 }
    }

    /** The short rolling window, or the provider's first window when it has none. */
    fun current(limits: List<WLimit>, provider: String): WLimit? {
        val own = limits.filter { it.provider == provider }
        return own.firstOrNull { it.window == WINDOW_CURRENT } ?: own.firstOrNull()
    }

    /** The weekly (or, for the Mistral ledgers, monthly) window, if it is not already the hero. */
    fun long(limits: List<WLimit>, provider: String): WLimit? {
        val hero = current(limits, provider)
        return limits.firstOrNull { it.provider == provider && it.window in LONG_WINDOWS && it != hero }
    }

    /**
     * The fourth tile: the provider's secondary weekly window when it has one,
     * else the fullest current window of any other provider.
     */
    fun secondary(limits: List<WLimit>, provider: String): WLimit? =
        limits.firstOrNull { it.provider == provider && it.window == WINDOW_SECONDARY }
            ?: limits.map { it.provider }.distinct()
                .filter { it != provider }
                .mapNotNull { current(limits, it) }
                .maxByOrNull { it.percent }

    /** Status colour for a utilisation: red at the alert threshold, amber from 60 %. */
    fun statusColor(percent: Int): Long = when {
        percent >= UsageAlerts.LIMIT_THRESHOLD_PERCENT -> 0xFFEF4444
        percent >= 60 -> 0xFFF59E0B
        else -> 0xFF34D399
    }

    fun isCritical(percent: Int): Boolean = percent >= UsageAlerts.LIMIT_THRESHOLD_PERCENT

    /**
     * Time left as the two largest units: "2d 4h", "1h 36m", "12m". Formatting
     * of the units is the caller's (string resources), so this only splits.
     */
    fun formatRemaining(
        remainingMs: Long,
        daysHours: (Int, Int) -> String,
        hoursMinutes: (Int, Int) -> String,
        minutes: (Int) -> String,
    ): String {
        val totalMinutes = ((remainingMs + 59_999) / 60_000).coerceAtLeast(1)
        val days = (totalMinutes / (24 * 60)).toInt()
        val hours = ((totalMinutes / 60) % 24).toInt()
        val mins = (totalMinutes % 60).toInt()
        return when {
            days > 0 -> daysHours(days, hours)
            hours > 0 -> hoursMinutes(hours, mins)
            else -> minutes(mins)
        }
    }

    /**
     * A reset moment as the widget prints it: weekday and time within the
     * coming week ("Sun 11:00", "So 11:00"), a short date beyond that. The
     * weekday and time are joined by [separator] so the dark tile can break
     * them onto two lines.
     */
    fun formatReset(
        atMs: Long,
        nowMs: Long,
        zone: ZoneId,
        locale: Locale,
        is24Hour: Boolean,
        separator: String = " ",
    ): String {
        val at = Instant.ofEpochMilli(atMs).atZone(zone)
        val time = at.format(DateTimeFormatter.ofPattern(if (is24Hour) "HH:mm" else "h:mm a", locale))
        val withinWeek = atMs - nowMs < 6L * 24 * 60 * 60 * 1000
        val day = if (withinWeek) {
            at.dayOfWeek.getDisplayName(TextStyle.SHORT, locale).trimEnd('.')
        } else {
            at.format(DateTimeFormatter.ofPattern(if (locale.language == "de") "d. MMM" else "MMM d", locale)).trimEnd('.')
        }
        return day + separator + time
    }

    /** Parse the API's ISO-8601 reset stamp; 0 when absent or unreadable. */
    fun parseResetMs(iso: String?): Long =
        iso?.takeIf { it.isNotBlank() }
            ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
                ?: runCatching { java.time.OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull()
                ?: runCatching {
                    java.time.LocalDate.parse(it).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
                }.getOrNull() }
            ?: 0L

    private fun normalise(name: String): String = name.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }
}
