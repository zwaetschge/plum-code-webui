package com.claudewebui.app.ui.components.dynamicui

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Display formatting for Dynamic UI values, a port of `formatUiValue` in
 * `packages/shared/src/utils/dynamicUi.ts`. It reproduces the WebUI's
 * `Intl.NumberFormat('de-CH')` output deterministically, independent of the
 * device locale data: apostrophe grouping, decimal point, "CHF 1'299",
 * "5.5 %" and compact "1.2 Mio.".
 */

private const val NBSP = ' '

/** Formats a value for display; locale de-CH, currency codes like CHF or EUR. */
fun formatUiValue(value: Any?, format: String? = null): String {
    if (value == null) return "–"
    if (value is Boolean) return if (value) "Ja" else "Nein"
    if (value is String) return value
    if (format == "text") return jsString(value)
    val number = uiNum(value)
    if (!number.isFinite()) return "–"
    return when {
        format == null || format == "number" -> decimal(number, 0, if (Math.abs(number) < 10) 2 else 0)
        format == "integer" -> decimal(number, 0, 0)
        format == "percent" -> decimal(number, 0, 1) + " %"
        format == "compact" -> compact(number)
        format.startsWith("decimal:") -> {
            val digits = format.substring(8).toIntOrNull()?.coerceIn(0, 20) ?: 0
            decimal(number, digits, digits)
        }
        format.startsWith("currency:") -> currency(number, format.substring(9))
        else -> jsString(value)
    }
}

private fun isNegative(value: Double) = value < 0 || (value == 0.0 && 1 / value < 0)

/** Rounds half away from zero on the shortest decimal form, like ICU. */
private fun rounded(value: Double, maxFraction: Int): BigDecimal =
    BigDecimal(Math.abs(value).toString()).setScale(maxFraction, RoundingMode.HALF_UP)

private fun digits(abs: BigDecimal, minFraction: Int, minGrouping: Int): String {
    var plain = abs.toPlainString()
    if (plain.contains('.')) {
        plain = plain.trimEnd('0')
        val fraction = plain.substringAfter('.')
        if (fraction.length < minFraction) plain += "0".repeat(minFraction - fraction.length)
        plain = plain.trimEnd('.')
    } else if (minFraction > 0) plain += "." + "0".repeat(minFraction)
    val integer = plain.substringBefore('.')
    val rest = plain.substring(integer.length)
    val grouped = if (integer.length >= 3 + minGrouping) {
        integer.reversed().chunked(3).joinToString("'").reversed()
    } else integer
    return grouped + rest
}

private fun decimal(value: Double, minFraction: Int, maxFraction: Int, minGrouping: Int = 1): String {
    val text = digits(rounded(value, maxFraction), minFraction, minGrouping)
    return if (isNegative(value)) "-$text" else text
}

private val COMPACT_UNITS = listOf(1e12 to "Bio.", 1e9 to "Mrd.", 1e6 to "Mio.")

private fun compact(value: Double): String {
    val abs = Math.abs(value)
    val sign = if (isNegative(value)) "-" else ""
    // Thousands have no short form in de-CH; compact numbers group from five digits.
    var unitIndex = COMPACT_UNITS.indexOfFirst { abs >= it.first }
    if (unitIndex < 0) {
        val plain = rounded(value, 1)
        if (plain >= BigDecimal(1_000_000)) unitIndex = COMPACT_UNITS.lastIndex
        else return sign + digits(plain, 0, 2)
    }
    var scaled = rounded(abs / COMPACT_UNITS[unitIndex].first, 1)
    // 999.95 Mio. rounds up to the next unit, as ICU does.
    if (unitIndex > 0 && scaled >= BigDecimal(1000)) {
        unitIndex--
        scaled = rounded(abs / COMPACT_UNITS[unitIndex].first, 1)
    }
    return sign + digits(scaled, 0, 2) + NBSP + COMPACT_UNITS[unitIndex].second
}

private val CURRENCY_SYMBOLS = mapOf("USD" to "$", "GBP" to "£", "JPY" to "¥")

private fun currency(value: Double, code: String): String {
    val maxFraction = if (Math.abs(value) >= 1000) 0 else 2
    val defaultFraction = runCatching { java.util.Currency.getInstance(code).defaultFractionDigits }.getOrNull()?.takeIf { it >= 0 } ?: 2
    val text = digits(rounded(value, maxFraction), minOf(defaultFraction, maxFraction), 1)
    val symbol = CURRENCY_SYMBOLS[code] ?: code
    // de-CH puts the minus between the symbol and the amount: "CHF-1'299".
    return if (isNegative(value)) "$symbol-$text" else "$symbol$NBSP$text"
}
