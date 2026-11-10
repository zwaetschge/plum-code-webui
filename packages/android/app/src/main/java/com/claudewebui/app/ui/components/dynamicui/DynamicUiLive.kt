package com.claudewebui.app.ui.components.dynamicui

import android.net.Uri
import com.claudewebui.app.core.security.TokenStore
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.text.Normalizer

/**
 * Live widgets of Dynamic UI v2 on Android, a port of
 * `packages/shared/src/utils/dynamicUiLive.ts`. The model only names a widget
 * and its parameters; the server fetches the data and stores one envelope per
 * widget ID with the turn (`turn.uiResults[id]`). Data payloads are snake_case;
 * `*_text` fields arrive pre-formatted for de-CH, raw numbers feed the charts.
 */

@Serializable data class UiLiveSource(val name: String = "", val url: String = "")

@Serializable data class UiWeatherLocation(
    val name: String = "",
    val region: String? = null,
    val country: String? = null,
    @SerialName("country_code") val countryCode: String? = null,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val timezone: String = "",
    val label: String = "",
)

@Serializable data class UiWeatherCurrent(
    val time: String = "",
    @SerialName("temperature_c") val temperatureC: Double = 0.0,
    @SerialName("feels_like_c") val feelsLikeC: Double = 0.0,
    val humidity: Double = 0.0,
    @SerialName("wind_kmh") val windKmh: Double = 0.0,
    @SerialName("wind_direction_deg") val windDirectionDeg: Double? = null,
    @SerialName("wind_direction_text") val windDirectionText: String? = null,
    @SerialName("precipitation_mm") val precipitationMm: Double = 0.0,
    @SerialName("weather_code") val weatherCode: Int = 0,
    val description: String = "",
    val icon: String = "cloudy",
    @SerialName("is_day") val isDay: Boolean = true,
    @SerialName("temperature_text") val temperatureText: String = "",
    @SerialName("feels_like_text") val feelsLikeText: String = "",
    @SerialName("wind_text") val windText: String = "",
    @SerialName("humidity_text") val humidityText: String = "",
)

@Serializable data class UiWeatherHour(
    val time: String = "",
    val label: String = "",
    @SerialName("temperature_c") val temperatureC: Double = 0.0,
    @SerialName("precip_chance") val precipChance: Double? = null,
    @SerialName("precipitation_mm") val precipitationMm: Double = 0.0,
    @SerialName("weather_code") val weatherCode: Int = 0,
    val description: String = "",
    val icon: String = "cloudy",
    @SerialName("is_day") val isDay: Boolean = true,
)

@Serializable data class UiWeatherDay(
    val date: String = "",
    val label: String = "",
    val weekday: String = "",
    @SerialName("date_text") val dateText: String = "",
    @SerialName("high_c") val highC: Double = 0.0,
    @SerialName("low_c") val lowC: Double = 0.0,
    @SerialName("precip_chance") val precipChance: Double? = null,
    @SerialName("precipitation_mm") val precipitationMm: Double = 0.0,
    @SerialName("weather_code") val weatherCode: Int = 0,
    val description: String = "",
    val icon: String = "cloudy",
    val sunrise: String? = null,
    val sunset: String? = null,
)

@Serializable data class UiWeatherData(
    val location: UiWeatherLocation = UiWeatherLocation(),
    val current: UiWeatherCurrent = UiWeatherCurrent(),
    val hourly: List<UiWeatherHour> = emptyList(),
    val daily: List<UiWeatherDay> = emptyList(),
    val source: UiLiveSource = UiLiveSource(),
)

@Serializable data class UiCurrencyPoint(val date: String = "", val rate: Double = 0.0)

@Serializable data class UiCurrencyData(
    val from: String = "",
    val to: String = "",
    @SerialName("from_name") val fromName: String? = null,
    @SerialName("to_name") val toName: String? = null,
    val amount: Double = 1.0,
    val rate: Double = 0.0,
    @SerialName("inverse_rate") val inverseRate: Double = 0.0,
    val converted: Double = 0.0,
    val date: String = "",
    @SerialName("amount_text") val amountText: String = "",
    @SerialName("converted_text") val convertedText: String = "",
    @SerialName("rate_text") val rateText: String = "",
    @SerialName("inverse_rate_text") val inverseRateText: String = "",
    @SerialName("date_text") val dateText: String = "",
    @SerialName("change_percent") val changePercent: Double? = null,
    @SerialName("change_text") val changeText: String = "",
    @SerialName("change_tone") val changeTone: String = "neutral",
    val series: List<UiCurrencyPoint> = emptyList(),
    val source: UiLiveSource = UiLiveSource(),
)

@Serializable data class UiStockPoint(val date: String = "", val close: Double = 0.0)

@Serializable data class UiStockRangeData(
    val points: List<UiStockPoint> = emptyList(),
    val start: Double? = null,
    val end: Double? = null,
    val change: Double? = null,
    @SerialName("change_percent") val changePercent: Double? = null,
    @SerialName("change_text") val changeText: String = "–",
    @SerialName("change_tone") val changeTone: String = "neutral",
    val high: Double? = null,
    val low: Double? = null,
)

@Serializable data class UiStockMetric(
    val key: String = "",
    val label: String = "",
    val value: Double? = null,
    @SerialName("value_text") val valueText: String = "–",
)

@Serializable data class UiStockData(
    val symbol: String = "",
    val name: String? = null,
    val exchange: String? = null,
    val currency: String? = null,
    val price: Double = 0.0,
    @SerialName("price_text") val priceText: String = "",
    @SerialName("previous_close") val previousClose: Double? = null,
    val change: Double? = null,
    @SerialName("change_percent") val changePercent: Double? = null,
    @SerialName("change_text") val changeText: String = "–",
    @SerialName("change_tone") val changeTone: String = "neutral",
    @SerialName("trade_date") val tradeDate: String = "",
    @SerialName("trade_date_text") val tradeDateText: String = "",
    val metrics: List<UiStockMetric> = emptyList(),
    val ranges: Map<String, UiStockRangeData> = emptyMap(),
    @SerialName("default_range") val defaultRange: String = "1M",
    val source: UiLiveSource = UiLiveSource(),
)

@Serializable data class UiEntityImage(val src: String = "", val width: Double? = null, val height: Double? = null, val alt: String = "")

@Serializable data class UiEntityData(
    val title: String = "",
    @SerialName("display_title") val displayTitle: String = "",
    val description: String? = null,
    val extract: String = "",
    val lang: String = "de",
    val url: String = "",
    val image: UiEntityImage? = null,
    @SerialName("original_image") val originalImage: String? = null,
    val kind: String = "standard",
    val source: UiLiveSource = UiLiveSource(),
)

@Serializable data class UiNewsArticle(
    val title: String = "",
    val url: String = "",
    val source: String = "",
    @SerialName("published_at") val publishedAt: String? = null,
    @SerialName("date_text") val dateText: String? = null,
    val excerpt: String? = null,
    val image: String? = null,
)

@Serializable data class UiNewsData(val query: String = "", val articles: List<UiNewsArticle> = emptyList(), val source: UiLiveSource = UiLiveSource())

@Serializable data class UiGalleryImage(
    val src: String = "",
    val thumbnail: String? = null,
    val title: String = "",
    @SerialName("page_url") val pageUrl: String = "",
    val source: String = "",
    val width: Double? = null,
    val height: Double? = null,
)

@Serializable data class UiGalleryData(val query: String = "", val images: List<UiGalleryImage> = emptyList(), val source: UiLiveSource = UiLiveSource())

internal val liveJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    isLenient = true
}

/** One live widget's envelope (`turn.uiResults[nodeId]`). */
internal class UiLiveResult(val json: JsonObject) {
    val type: String? = json.string("type")
    val key: String? = json.string("key")
    val status: String = json.string("status") ?: "pending"
    val data: JsonElement? = json["data"]
    val error: String? = json.string("error")
    val retryable: Boolean = json.bool("retryable") == true
}

internal inline fun <reified T> decodeLive(data: JsonElement?): T? =
    if (data !is JsonObject) null else runCatching { liveJson.decodeFromJsonElement(kotlinx.serialization.serializer<T>(), data) }.getOrNull()

// ── Keys ────────────────────────────────────────────────────────────────────

/** JS `\s`: ASCII and Unicode spaces, so keys match the server's exactly. */
private val JS_SPACE = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

private fun norm(value: String): String = JS_SPACE.replace(Normalizer.normalize(value, Normalizer.Form.NFC), " ").trim().lowercase()

/** Identity of a live widget's parameters; a stored result applies while keys match. */
fun uiLiveKey(node: JsonObject): String? {
    fun numberText(key: String, default: Double) = jsNumberString(node.number(key) ?: default)
    return when (node.string("type")) {
        "weather" -> "weather:${norm(node.string("location").orEmpty())}:${numberText("days", 7.0)}"
        "currency" -> "currency:${node.string("from")}:${node.string("to")}:${numberText("amount", 1.0)}"
        "stock" -> "stock:${node.string("symbol").orEmpty().uppercase()}:${node.string("range") ?: "1M"}"
        "entity" -> "entity:${node.string("lang") ?: "de"}:${norm(node.string("title").orEmpty()).replace(' ', '_')}"
        "news", "gallery" -> "${node.string("type")}:${norm(node.string("query").orEmpty())}"
        else -> null
    }
}

/** Keys equal, or equal once spacing and case are ignored (a stale-cache safety net). */
internal fun uiLiveKeysMatch(stored: String?, expected: String?): Boolean {
    if (stored == null || expected == null) return false
    if (stored == expected) return true
    val loose = { value: String -> value.lowercase().replace(Regex("[\\s_]+"), "") }
    return loose(stored) == loose(expected)
}

/** `entity:Albert_Einstein` link targets in answer Markdown → article title. */
fun parseUiEntityHref(href: String): String? {
    if (!href.startsWith("entity:")) return null
    val raw = href.substring(7)
    val decoded = runCatching { Uri.decode(raw) }.getOrDefault(raw)
    val title = decoded.replace('_', ' ').trim()
    return if (title.isNotEmpty() && title.length <= 200) title else null
}

// ── Server paths ────────────────────────────────────────────────────────────

const val UI_IMAGE_PROXY_PATH = "/api/assistant/ui/image"

/** Absolute URL of an external image through the authenticated same-origin proxy. */
fun uiImageProxyUrl(src: String): String? {
    if (!isUiHttpsUrl(src)) return null
    val server = TokenStore.getServerUrl()?.trimEnd('/') ?: return null
    return "$server$UI_IMAGE_PROXY_PATH?url=${Uri.encode(src)}"
}

// ── Formatting shared with the server ───────────────────────────────────────

internal const val MINUS = "−"

/** de-CH number with fixed decimals; negative values use a true minus sign. */
fun formatUiNumber(value: Double, digits: Int = 2, signed: Boolean = false): String {
    val text = formatUiValue(Math.abs(value), "decimal:$digits")
    val zero = java.math.BigDecimal(Math.abs(value).toString()).setScale(digits, java.math.RoundingMode.HALF_UP).signum() == 0
    if (value < 0 && !zero) return MINUS + text
    return if (signed && !zero) "+$text" else text
}

/** "+1.5 %" */
fun formatUiPercentChange(percent: Double, digits: Int = 1): String = "${formatUiNumber(percent, digits, true)} %"

/** "+1.23 (+1.5 %)"; "–" without values. */
fun formatUiChange(change: Double?, percent: Double?): String {
    if (change == null || !change.isFinite()) return "–"
    val absolute = formatUiNumber(change, if (Math.abs(change) < 1) 4 else 2, true)
    return if (percent == null || !percent.isFinite()) absolute else "$absolute (${formatUiPercentChange(percent)})"
}

fun celsiusToFahrenheit(celsius: Double): Double = celsius * 9 / 5 + 32

/** "8 °C" / "46 °F", rounded; `bare` gives "8°". */
fun formatUiTemperature(celsius: Double, unit: String = "c", bare: Boolean = false): String {
    val value = Math.round(if (unit == "f") celsiusToFahrenheit(celsius) else celsius)
    val text = (if (value < 0) MINUS else "") + Math.abs(value)
    return if (bare) "$text°" else "$text °${if (unit == "f") "F" else "C"}"
}

private val PRICE_PARTS = Regex("^(\\D*?)([−\\-]?[\\d'’.,]+)(\\D*)$")

/**
 * A price in the same shape as a server-formatted one ("CHF 85.85",
 * "85.85 p"): the currency prefix/suffix and decimals of [template] around [value].
 */
fun formatUiPriceLike(value: Double, template: String): String {
    val match = PRICE_PARTS.find(template.trim()) ?: return formatUiNumber(value)
    val number = match.groupValues[2]
    val digits = number.substringAfterLast('.', "").takeIf { number.contains('.') }?.length ?: 0
    return match.groupValues[1] + formatUiNumber(value, digits) + match.groupValues[3]
}

/** "2026-11-06" → "6. Nov. 2026" (de-CH short month, as the server writes it). */
fun formatUiDate(iso: String, withYear: Boolean = true): String {
    val parts = iso.take(10).split('-')
    if (parts.size != 3) return iso
    val month = parts[1].toIntOrNull() ?: return iso
    val day = parts[2].toIntOrNull() ?: return iso
    val names = listOf("Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez.")
    val name = names.getOrNull(month - 1) ?: return iso
    return if (withYear) "$day. $name ${parts[0]}" else "$day. $name"
}
