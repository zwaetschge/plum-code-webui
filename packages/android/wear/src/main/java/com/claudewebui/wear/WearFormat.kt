package com.claudewebui.wear

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** German wording shared by app, tile and complications (same phrases as the extension). */
object WearFormat {

    private val clock = DateTimeFormatter.ofPattern("HH:mm", Locale.GERMAN)
    private val dayClock = DateTimeFormatter.ofPattern("EE HH:mm", Locale.GERMAN)

    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE
    private const val DAY = 24 * HOUR

    fun percent(value: Int, estimate: Boolean = false): String =
        (if (estimate) "≈" else "") + "$value %"

    /** „voll in ca. 40 Min.“ / „voll ca. 18:20“ / „reicht bis Reset“, or null when unknown. */
    fun forecast(forecast: UsageForecast, now: Long = System.currentTimeMillis()): String? =
        when (forecast.state) {
            "exhausts" -> forecast.at?.let { at ->
                val left = at - now
                when {
                    left < HOUR -> "voll in ca. ${(left / MINUTE).coerceAtLeast(1)} Min."
                    left < DAY -> "voll ca. ${time(at)}"
                    else -> "voll ca. ${dayTime(at)}"
                }
            }
            "lasts" -> "reicht bis Reset"
            else -> null
        }

    /** „Reset in 25 Min.“ / „Reset 18:00“ / „Reset Mo. 09:00“. */
    fun reset(at: Long?, now: Long = System.currentTimeMillis()): String? {
        if (at == null || at <= now) return null
        val left = at - now
        return when {
            left < HOUR -> "Reset in ${(left / MINUTE).coerceAtLeast(1)} Min."
            left < DAY && sameDay(at, now) -> "Reset ${time(at)}"
            else -> "Reset ${dayTime(at)}"
        }
    }

    /** „gerade eben“ / „vor 5 Min.“ / „vor 2 Std.“ / „vor 3 Tagen“. */
    fun ago(at: Long, now: Long = System.currentTimeMillis()): String {
        val diff = (now - at).coerceAtLeast(0)
        return when {
            diff < MINUTE -> "gerade eben"
            diff < HOUR -> "vor ${diff / MINUTE} Min."
            diff < DAY -> "vor ${diff / HOUR} Std."
            diff < 2 * DAY -> "vor 1 Tag"
            else -> "vor ${diff / DAY} Tagen"
        }
    }

    fun time(at: Long): String = clock.format(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()))

    private fun dayTime(at: Long): String =
        dayClock.format(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()))

    private fun sameDay(a: Long, b: Long): Boolean {
        val zone = ZoneId.systemDefault()
        return Instant.ofEpochMilli(a).atZone(zone).toLocalDate() ==
            Instant.ofEpochMilli(b).atZone(zone).toLocalDate()
    }

    fun tokens(value: Long): String = when {
        value >= 1_000_000 -> String.format(Locale.GERMAN, "%.1f Mio.", value / 1_000_000.0)
        value >= 1_000 -> String.format(Locale.GERMAN, "%.1fk", value / 1_000.0)
        else -> value.toString()
    }
}

/** „arbeitet“ / „wartet“ / „bereit“ for a session, given the sessions with an open approval. */
enum class SessionState(val label: String, val color: Int) {
    WORKING("arbeitet", 0xFF3B82F6.toInt()),
    WAITING("wartet", 0xFFF59E0B.toInt()),
    READY("bereit", 0xFF22C55E.toInt());

    companion object {
        fun of(session: SessionRow, waitingSessionIds: Set<String>): SessionState = when {
            session.id in waitingSessionIds -> WAITING
            session.busy -> WORKING
            else -> READY
        }
    }
}
