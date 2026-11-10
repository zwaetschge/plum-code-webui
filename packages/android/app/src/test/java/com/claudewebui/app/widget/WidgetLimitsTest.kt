package com.claudewebui.app.widget

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

/**
 * The limits dashboard: which provider it shows, which window lands in which
 * tile, how reset times read, and that snapshots cached before reset times
 * existed still load.
 */
class WidgetLimitsTest {

    private val limits = listOf(
        WLimit("Claude", "5h", 68, resetsAtMs = 1),
        WLimit("Claude", "Weekly", 42, resetsAtMs = 2),
        WLimit("Claude", "Weekly Sonnet", 23),
        WLimit("Codex", "5h", 12),
        WLimit("Z.AI", "5h", 87),
        WLimit("Vibe", "Month", 18),
        WLimit("Mistral", "Month", 5),
    )

    @Test
    fun `without a filter the fullest current window wins`() {
        assertEquals("Z.AI", WidgetLimits.pickProvider(limits, null))
    }

    @Test
    fun `the CLI display name selects the account label`() {
        assertEquals("Claude", WidgetLimits.pickProvider(limits, "Claude Code"))
        assertEquals("Codex", WidgetLimits.pickProvider(limits, "codex"))
        // Both "Mistral" and "Vibe" occur in the name; the harness is Vibe's ledger.
        assertEquals("Vibe", WidgetLimits.pickProvider(limits, "Mistral Vibe"))
    }

    @Test
    fun `a filter without quota data falls back to the fullest provider`() {
        assertEquals("Z.AI", WidgetLimits.pickProvider(limits, "Pi"))
        assertNull(WidgetLimits.pickProvider(emptyList(), "Claude Code"))
    }

    @Test
    fun `windows map onto the tiles`() {
        assertEquals("5h", WidgetLimits.current(limits, "Claude")?.window)
        assertEquals("Weekly", WidgetLimits.long(limits, "Claude")?.window)
        assertEquals("Weekly Sonnet", WidgetLimits.secondary(limits, "Claude")?.window)
        // No Sonnet window: the fourth tile shows the fullest other provider.
        assertEquals("Z.AI", WidgetLimits.secondary(limits, "Codex")?.provider)
        // A monthly ledger is its own hero and has no separate long tile.
        assertEquals("Month", WidgetLimits.current(limits, "Vibe")?.window)
        assertNull(WidgetLimits.long(limits, "Vibe"))
    }

    @Test
    fun `status colours follow the alert thresholds`() {
        assertEquals(0xFFEF4444, WidgetLimits.statusColor(UsageAlerts.LIMIT_THRESHOLD_PERCENT))
        assertEquals(0xFFF59E0B, WidgetLimits.statusColor(60))
        assertEquals(0xFF34D399, WidgetLimits.statusColor(59))
    }

    @Test
    fun `remaining time uses the two largest units`() {
        fun fmt(ms: Long) = WidgetLimits.formatRemaining(
            ms,
            daysHours = { d, h -> "${d}d ${h}h" },
            hoursMinutes = { h, m -> "${h}h ${m}m" },
            minutes = { m -> "${m}m" },
        )
        val minute = 60_000L
        assertEquals("1h 36m", fmt(96 * minute))
        assertEquals("2d 4h", fmt((2 * 24 + 4) * 60 * minute + 5 * minute))
        assertEquals("12m", fmt(12 * minute - 1_000))
        assertEquals("1m", fmt(5_000))
    }

    @Test
    fun `reset reads as weekday and time within a week, as a date beyond`() {
        val zone = ZoneId.of("Europe/Zurich")
        val now = ZonedDateTime.of(2026, 11, 10, 9, 0, 0, 0, zone)
        val sunday = now.withDayOfMonth(15).withHour(11).toInstant().toEpochMilli()
        val nowMs = now.toInstant().toEpochMilli()

        assertEquals("Sun 11:00", WidgetLimits.formatReset(sunday, nowMs, zone, Locale.US, is24Hour = true))
        assertEquals("Sun\n11:00", WidgetLimits.formatReset(sunday, nowMs, zone, Locale.US, is24Hour = true, separator = "\n"))
        assertEquals("So 11:00", WidgetLimits.formatReset(sunday, nowMs, zone, Locale.GERMANY, is24Hour = true))

        val later = now.plusDays(20).withHour(0).toInstant().toEpochMilli()
        assertEquals("30. Nov 00:00", WidgetLimits.formatReset(later, nowMs, zone, Locale.GERMANY, is24Hour = true))
        assertEquals("Nov 30 00:00", WidgetLimits.formatReset(later, nowMs, zone, Locale.US, is24Hour = true))
    }

    @Test
    fun `reset stamps parse from the API`() {
        assertEquals(1_794_302_400_000, WidgetLimits.parseResetMs("2026-11-10T09:20:00Z"))
        assertEquals(1_794_302_400_000, WidgetLimits.parseResetMs("2026-11-10T10:20:00+01:00"))
        assertEquals(0L, WidgetLimits.parseResetMs(null))
        assertEquals(0L, WidgetLimits.parseResetMs("soon"))
    }

    @Test
    fun `snapshots cached before reset times still decode`() {
        val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
        val old = """{"updatedAtMs":5,"limits":[{"provider":"Claude","window":"5h","percent":68,"colorArgb":4294538006}]}"""
        val snapshot = json.decodeFromString(WidgetSnapshot.serializer(), old)
        assertEquals(68, snapshot.limits.single().percent)
        assertEquals(0L, snapshot.limits.single().resetsAtMs)

        val roundTrip = json.decodeFromString(
            WidgetSnapshot.serializer(),
            json.encodeToString(WidgetSnapshot.serializer(), snapshot.copy(limits = listOf(WLimit("Claude", "5h", 68, resetsAtMs = 42)))),
        )
        assertEquals(42L, roundTrip.limits.single().resetsAtMs)
    }
}
