package com.claudewebui.app.ui.components.dynamicui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Dynamic UI schema v1/v2 on Android: the client-side gate that mirrors
 * `validateDynamicUi` and `recoverDynamicUi` in
 * `packages/shared/src/utils/dynamicUi.ts`. The server already validated the
 * description, but stored history and fixtures pass the same checks before
 * anything renders: known components only, bindings to declared state,
 * parseable formulas, bounded sizes. A broken component falls back to a
 * short muted note; it never takes the whole answer with it.
 */

/** Version a model writes; both 1 and 2 are accepted (v2 is a superset). */
const val DYNAMIC_UI_VERSION = 2
private val VERSIONS = setOf(1.0, 2.0)

private object Limits {
    const val NODES = 250
    const val DEPTH = 10
    const val ROWS = 500
    const val DATASETS = 12
    const val VIEWS = 20
    const val STATE = 40
    const val COMPUTED = 60
    const val TEXT = 4000
    const val LONG_TEXT = 2000
    const val LIVE = 6
    const val FOLLOWUPS = 3
    const val FOLLOWUP_LENGTH = 80
    val TABS = 2..6
    val ACCORDION = 1..12
    val CAROUSEL = 2..10
    const val CAROUSEL_META = 3
    val LIST = 1..30
    val TIMELINE = 1..20
    val CHECKLIST = 1..40
    val QUIZ = 1..20
    val QUIZ_OPTIONS = 2..6
    val FLASHCARDS = 1..50
    val CHART_SERIES = 1..6
    val CHART_RANGES = 2..6
    const val CARD_ACTIONS = 2
    val FORM_CHILDREN = 1..20
    val WEATHER_DAYS = 1..10
    /** Custom tiles per view, their code size, JSON payloads and live inputs. */
    const val WIDGETS = 4
    const val WIDGET_HTML = 60000
    const val WIDGET_JSON = 16000
    const val WIDGET_LIVE = 4
    val WIDGET_HEIGHT = 80..1200
}

private val NAME = Regex("^[A-Za-z_][A-Za-z0-9_]{0,39}$")
/** Component and entry IDs never appear in formulas, so they may also use '-' (same as shared ID). */
private val ID = Regex("^[A-Za-z_][A-Za-z0-9_-]{0,39}$")
private val FORMAT = Regex("^(number|integer|percent|compact|text|decimal:\\d|currency:[A-Z]{3})$")
private val DATE = Regex("^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$")
/** Public https host name (no IP literal, credentials or port other than 443). */
private val HTTPS_URL = Regex("""^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::443)?(?:[/?#][^\s<>"'`\\]*)?$""", RegexOption.IGNORE_CASE)
private val LANG = Regex("^[a-z]{2,3}$")
private val VIEW_ID = Regex("^[A-Za-z0-9_-]{1,80}$")
private val CODE_LANGUAGE = Regex("^[A-Za-z0-9+#._-]{1,24}$")
private val CURRENCY_CODE = Regex("^[A-Z]{3}$")
private val STOCK_SYMBOL = Regex("^[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,19}$")

val UI_ASPECTS = listOf("16:9", "4:3", "1:1", "3:4")
val UI_STOCK_RANGES = listOf("1M", "6M", "1Y", "5Y")

/** The muted text a broken component is replaced with (same wording as the server). */
internal const val UI_FALLBACK_TEXT = "Dieser Teil der Ansicht ist nicht verfügbar."

/** A derived row set: filter, grouping and aggregation over a source, or generated rows. */
sealed interface UiView {
    data class Derived(
        val from: String,
        val filter: String?,
        val groupBy: String?,
        val aggregate: List<Aggregate>,
        val hasAggregate: Boolean,
        val sortField: String?,
        val sortDescending: Boolean,
        val limit: Int?,
    ) : UiView

    data class Generated(val variable: String, val from: String, val to: String, val step: Double, val fields: List<Pair<String, String>>) : UiView

    data class Aggregate(val name: String, val field: String?, val op: String)
}

/** A validated description, parsed into what the runtime needs. */
class DynamicUiDoc(val json: JsonObject) {
    val version: Int = json.number("version")?.toInt() ?: DYNAMIC_UI_VERSION
    val title: String? = json.string("title")
    val dashboard: Boolean = json.string("layout") == "dashboard"
    val state: Map<String, Any?> = (json["state"] as? JsonObject)?.mapValues { uiValueOf(it.value) } ?: emptyMap()
    val computed: Map<String, String> = (json["computed"] as? JsonObject)?.mapValues { (it.value as JsonPrimitive).content } ?: emptyMap()
    val data: Map<String, List<UiRow>> = (json["data"] as? JsonObject)?.mapValues { rowsOf(it.value) } ?: emptyMap()
    val views: Map<String, UiView> = (json["views"] as? JsonObject)?.mapValues { viewOf(it.value as JsonObject) } ?: emptyMap()
    val root: JsonObject = json["root"] as JsonObject
}

sealed interface DynamicUiValidation {
    /** [warnings] lists components that were replaced by a fallback note. */
    data class Valid(val doc: DynamicUiDoc, val warnings: List<String> = emptyList()) : DynamicUiValidation
    data class Invalid(val error: String) : DynamicUiValidation
}

// ── JSON helpers ────────────────────────────────────────────────────────────

internal fun JsonElement?.isStr() = this is JsonPrimitive && this !is JsonNull && isString
internal fun JsonElement?.isNum() = this is JsonPrimitive && this !is JsonNull && !isString && booleanOrNull == null && doubleOrNull != null
internal fun JsonElement?.isBool() = this is JsonPrimitive && this !is JsonNull && !isString && booleanOrNull != null
internal fun JsonElement?.str(): String? = if (isStr()) (this as JsonPrimitive).content else null
internal fun JsonElement?.num(): Double? = if (isNum()) (this as JsonPrimitive).doubleOrNull else null
internal fun JsonObject.string(key: String): String? = this[key].str()
internal fun JsonObject.number(key: String): Double? = this[key].num()
internal fun JsonObject.bool(key: String): Boolean? = this[key]?.takeIf { it.isBool() }?.let { (it as JsonPrimitive).booleanOrNull }
internal fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()
internal fun JsonObject.strings(key: String): List<String> = (this[key] as? JsonArray)?.mapNotNull { it.str() } ?: emptyList()

/** JSON scalar to engine value: Double, String, Boolean or null. */
fun uiValueOf(element: JsonElement?): Any? = when {
    element == null || element is JsonNull -> null
    element.isStr() -> (element as JsonPrimitive).content
    element.isBool() -> (element as JsonPrimitive).booleanOrNull
    element.isNum() -> (element as JsonPrimitive).doubleOrNull
    else -> null
}

/** Engine value back to JSON, for saving view state. */
fun uiValueToJson(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value.toDouble())
    else -> JsonPrimitive(value.toString())
}

fun rowsOf(element: JsonElement?): List<UiRow> =
    (element as? JsonArray)?.filterIsInstance<JsonObject>()?.map { row -> row.mapValues { uiValueOf(it.value) } } ?: emptyList()

private fun viewOf(view: JsonObject): UiView {
    val generate = view["generate"] as? JsonObject
    if (generate != null) {
        return UiView.Generated(
            variable = generate.string("var").orEmpty(),
            from = exprSource(generate["from"]),
            to = exprSource(generate["to"]),
            step = generate.number("step") ?: 1.0,
            fields = (view["fields"] as? JsonObject)?.map { it.key to (it.value as JsonPrimitive).content } ?: emptyList(),
        )
    }
    val aggregate = view["aggregate"] as? JsonObject
    val sort = view["sort"] as? JsonObject
    return UiView.Derived(
        from = view.string("from").orEmpty(),
        filter = view.string("filter"),
        groupBy = view.string("groupBy"),
        aggregate = aggregate?.map { (name, spec) -> UiView.Aggregate(name, (spec as JsonObject).string("field"), spec.string("op").orEmpty()) } ?: emptyList(),
        hasAggregate = aggregate != null,
        sortField = sort?.string("field"),
        sortDescending = sort?.string("dir") == "desc",
        limit = view.number("limit")?.toInt(),
    )
}

/** `String(value)` of a generate bound: formulas may be given as numbers. */
private fun exprSource(element: JsonElement?): String = when {
    element == null -> "undefined"
    element is JsonNull -> "null"
    element.isStr() -> (element as JsonPrimitive).content
    element.isNum() -> jsNumberString((element as JsonPrimitive).doubleOrNull ?: Double.NaN)
    element is JsonPrimitive -> element.content
    else -> "undefined"
}

// ── Shared predicates (ports of the TS helpers) ─────────────────────────────

/** True for an https URL the image proxy and openUrl accept (checked again server-side). */
fun isUiHttpsUrl(value: String?): Boolean = value != null && value.length <= 2000 && HTTPS_URL.matches(value)

/** Whether a node is a live widget whose data the server resolves. */
fun isUiLiveNode(node: JsonObject?): Boolean = node?.string("type") in UI_LIVE_NODE_TYPES

/** Result key of a custom tile's live input (also its synthetic live-node id), as `uiWidgetLiveId` in shared. */
fun uiWidgetLiveId(widgetId: String, name: String): String = "${widgetId}__$name"

/**
 * A tile's live inputs as live nodes (`{...input, id: "<tile>__<name>"}`), in
 * declaration order; the server resolves them into `turn.uiResults` like widgets.
 */
fun uiWidgetLiveNodes(node: JsonObject): List<Pair<String, JsonObject>> {
    val id = node.string("id") ?: return emptyList()
    val live = node["live"] as? JsonObject ?: return emptyList()
    return live.mapNotNull { (name, input) -> (input as? JsonObject)?.let { name to JsonObject(it + ("id" to JsonPrimitive(uiWidgetLiveId(id, name)))) } }
}

/** Effective kind of a quiz question: explicit, else choice with options, else text. */
fun quizQuestionKind(question: JsonObject): String = question.string("kind") ?: if (question["options"] is JsonArray) "choice" else "text"

/** Tables sort by default above five rows unless `sortable` says otherwise. */
fun tableSortable(node: JsonObject, rowCount: Int): Boolean = node.bool("sortable") ?: (rowCount > 5)

/**
 * A single emoji at the start (`\p{Extended_Pictographic}` in the TS check).
 * Android's regex engine differs between releases, so the ranges are explicit.
 */
private fun startsWithEmoji(value: String): Boolean {
    if (value.isEmpty()) return false
    val cp = value.codePointAt(0)
    return cp == 0x00A9 || cp == 0x00AE || cp == 0x203C || cp == 0x2049 || cp == 0x2122 || cp == 0x2139 ||
        cp in 0x2194..0x21AA || cp in 0x231A..0x23FF || cp == 0x24C2 || cp in 0x25AA..0x25FE ||
        cp in 0x2600..0x27BF || cp in 0x2934..0x2935 || cp in 0x2B05..0x2B55 || cp == 0x3030 || cp == 0x303D ||
        cp == 0x3297 || cp == 0x3299 || cp in 0x1F000..0x1FAFF || cp in 0x1FC00..0x1FFFD
}

// ── Validation ──────────────────────────────────────────────────────────────

private class Invalid(message: String) : Exception(message)

private fun fail(path: String, message: String): Nothing = throw Invalid("$path: $message")

/** What every component check needs from the top level of a description. */
private class Globals(val state: JsonObject, val sources: Set<String>)

private class Walk(val g: Globals) {
    var nodes = 0
    val ids = HashSet<String>()
    var live = 0
    var widgets = 0
}

private fun num(value: Double) = jsNumberString(value)

/** Checks everything except the component tree; returns what the tree checks need. */
private fun checkGlobals(input: JsonObject): Globals {
    val version = input["version"]
    if (!version.isNum() || (version as JsonPrimitive).doubleOrNull !in VERSIONS) fail("version", "nur Version 1 oder 2")
    input["viewId"]?.let { if (!(it.isStr() && VIEW_ID.matches(it.str()!!))) fail("viewId", "ungültige Ansichtskennung") }
    val known = HashSet<String>()
    val state = input["state"] ?: JsonObject(emptyMap())
    if (state !is JsonObject) fail("state", "Objekt erwartet")
    if (state.size > Limits.STATE) fail("state", "zu viele Werte")
    for ((key, value) in state) {
        if (!NAME.matches(key)) fail("state.$key", "ungültiger Name")
        if (!(value.isNum() || value.isStr() || value.isBool() || value is JsonNull)) fail("state.$key", "Zahl, Text oder Wahrheitswert erwartet")
        if (value.isStr() && value.str()!!.length > 200) fail("state.$key", "zu lang")
        known += key
    }
    val data = input["data"] ?: JsonObject(emptyMap())
    if (data !is JsonObject) fail("data", "Objekt erwartet")
    if (data.size > Limits.DATASETS) fail("data", "zu viele Datensätze")
    for ((name, rows) in data) {
        if (!NAME.matches(name)) fail("data.$name", "ungültiger Name")
        checkRows("data.$name", rows)
    }
    val views = input["views"] ?: JsonObject(emptyMap())
    if (views !is JsonObject) fail("views", "Objekt erwartet")
    if (views.size > Limits.VIEWS) fail("views", "zu viele Sichten")
    val sources = data.keys + views.keys
    for ((name, view) in views) {
        if (!NAME.matches(name)) fail("views.$name", "ungültiger Name")
        checkView("views.$name", view, sources)
    }
    val computed = input["computed"] ?: JsonObject(emptyMap())
    if (computed !is JsonObject) fail("computed", "Objekt erwartet")
    if (computed.size > Limits.COMPUTED) fail("computed", "zu viele Formeln")
    for ((key, expr) in computed) {
        if (!NAME.matches(key)) fail("computed.$key", "ungültiger Name")
        if (key in known) fail("computed.$key", "Name bereits als State vergeben")
        checkExpr("computed.$key", expr)
        known += key
    }
    input["title"]?.let { checkText("title", it, 120) }
    input["layout"]?.let { if (!(it.isStr() && it.str() in listOf("inline", "dashboard"))) fail("layout", "inline oder dashboard") }
    input["followups"]?.let { checkFollowups("followups", it) }
    return Globals(state, sources)
}

/**
 * Checks a model-produced description against schema v1/v2: known components
 * and props only, bounded sizes, parseable formulas, bindings to declared state.
 */
fun validateDynamicUi(input: JsonElement?): DynamicUiValidation = try {
    if (input !is JsonObject) fail("ui", "Objekt erwartet")
    val globals = checkGlobals(input)
    checkNode("root", input["root"], 0, Walk(globals), false)
    DynamicUiValidation.Valid(DynamicUiDoc(input))
} catch (error: Invalid) {
    DynamicUiValidation.Invalid(error.message ?: "Ungültige Beschreibung")
} catch (error: Exception) {
    DynamicUiValidation.Invalid(error.message ?: "Ungültige Beschreibung")
}

/**
 * What the renderer uses: the strict check first, then the local recovery
 * (a broken component becomes a muted note, the rest stays usable). Global
 * data, state and formulas stay strict, as on the server.
 */
fun prepareDynamicUi(input: JsonElement?): DynamicUiValidation {
    val strict = validateDynamicUi(input)
    if (strict is DynamicUiValidation.Valid) return strict
    val recovered = recoverDynamicUi(input)
    return if (recovered is DynamicUiValidation.Valid) recovered else strict
}

/** Formula fields that a model sometimes writes as plain numbers. */
private val FORMULA_FIELDS = mapOf("kpi" to listOf("value", "trend", "delta"), "progress" to listOf("value", "max"))

/** Structural errors stay local to a component; port of `recoverDynamicUi`. */
fun recoverDynamicUi(input: JsonElement?): DynamicUiValidation = try {
    if (input !is JsonObject) fail("ui", "Objekt erwartet")
    val recovery = Recovery(checkGlobals(input))
    val root = recovery.walk(input["root"], "root", 0) ?: fail("root", recovery.warnings.firstOrNull() ?: "Ansicht unvollständig")
    when (val result = validateDynamicUi(JsonObject(input + ("root" to root)))) {
        is DynamicUiValidation.Valid -> result.copy(warnings = recovery.warnings)
        is DynamicUiValidation.Invalid -> result
    }
} catch (error: Invalid) {
    DynamicUiValidation.Invalid(error.message ?: "Ungültige Beschreibung")
} catch (error: Exception) {
    DynamicUiValidation.Invalid(error.message ?: "Ungültige Beschreibung")
}

private class Recovery(private val globals: Globals) {
    val warnings = ArrayList<String>()
    private var count = 0
    private val ids = HashSet<String>()

    private fun uniqueId(owner: MutableMap<String, JsonElement>, path: String) {
        val id = owner["id"].str() ?: return
        if (!ids.add(id)) {
            warnings += "$path: ID doppelt"
            owner.remove("id")
        }
    }

    private fun walkList(list: JsonArray, path: String, depth: Int) =
        JsonArray(list.mapIndexedNotNull { index, child -> walk(child, "$path[$index]", depth + 1) })

    private fun check(node: JsonObject): String? = try {
        checkNode("root", node, 0, Walk(globals), false)
        null
    } catch (error: Invalid) {
        error.message ?: "ungültig"
    }

    fun walk(value: JsonElement?, path: String, depth: Int): JsonObject? {
        if (++count > Limits.NODES || depth > Limits.DEPTH) throw Invalid("Komponentengrenze überschritten")
        if (value !is JsonObject) return null
        val type = value.string("type")
        val node = LinkedHashMap<String, JsonElement>(value)
        uniqueId(node, path)
        FORMULA_FIELDS[type]?.forEach { key ->
            val number = node[key].num()
            if (number != null && number.isFinite()) node[key] = JsonPrimitive(jsNumberString(number))
        }
        for (key in listOf("children", "inputs", "outputs")) (node[key] as? JsonArray)?.let { node[key] = walkList(it, "$path.$key", depth) }
        val entries = when (type) { "tabs" -> "tabs"; "accordion" -> "items"; else -> null }
        if (entries != null) (node[entries] as? JsonArray)?.let { list ->
            node[entries] = JsonArray(list.mapIndexed { index, entry ->
                val children = (entry as? JsonObject)?.get("children") as? JsonArray
                if (entry !is JsonObject || children == null) entry else {
                    val copy = LinkedHashMap<String, JsonElement>(entry)
                    uniqueId(copy, "$path.$entries[$index]")
                    copy["children"] = walkList(children, "$path.$entries[$index].children", depth)
                    JsonObject(copy)
                }
            })
        }
        if (type == "calculator" && node["chart"] != null) {
            val chart = walk(node["chart"], "$path.chart", depth + 1)
            if (chart != null) node["chart"] = chart else node.remove("chart")
        }
        val candidate = JsonObject(node)
        val error = check(candidate) ?: return candidate
        if (warnings.size < 10) warnings += "$path: $error"
        if (depth == 0) return null
        return JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive(UI_FALLBACK_TEXT), "tone" to JsonPrimitive("muted")))
    }
}

/** Lenient followups for display: the first three non-empty strings of at most 80 characters. */
fun sanitizeDynamicUiFollowups(values: List<String>): List<String> {
    val out = ArrayList<String>()
    for (item in values) {
        val text = item.replace(Regex("\\s+"), " ").trim()
        if (text.isEmpty() || text.length > Limits.FOLLOWUP_LENGTH || text in out) continue
        out += text
        if (out.size >= Limits.FOLLOWUPS) break
    }
    return out
}

private fun checkFollowups(path: String, value: JsonElement) {
    if (value !is JsonArray || value.size > Limits.FOLLOWUPS) fail(path, "höchstens ${Limits.FOLLOWUPS} Folgefragen")
    value.forEachIndexed { index, item ->
        val text = item.str()
        if (text == null || text.isBlank()) fail("$path[$index]", "Text erwartet")
        if (text.length > Limits.FOLLOWUP_LENGTH) fail("$path[$index]", "zu lang")
    }
}

private fun checkText(path: String, value: JsonElement?, max: Int = 300) {
    if (!value.isStr()) fail(path, "Text erwartet")
    if (value.str()!!.length > max) fail(path, "zu lang")
}

/** Required, non-empty text. */
private fun checkLabel(path: String, value: JsonElement?, max: Int = 300) {
    checkText(path, value, max)
    if (value.str()!!.isBlank()) fail(path, "Text fehlt")
}

private fun checkExprSource(path: String, source: String) {
    try { parseExpr(source) } catch (error: ExprException) { fail(path, error.message ?: "Ungültige Formel") }
}

private fun checkExpr(path: String, value: JsonElement?) {
    if (!value.isStr()) fail(path, "Formel erwartet")
    checkExprSource(path, value.str()!!)
}

private fun checkTemplate(path: String, value: JsonElement?, max: Int = 600) {
    checkText(path, value, max)
    for (match in TEMPLATE_PATTERN.findAll(value.str()!!)) {
        checkExprSource(path, match.groupValues[1])
        val format = match.groups[2]?.value
        if (format != null && !FORMAT.matches(format)) fail(path, "unbekanntes Format $format")
    }
}

private fun checkFormat(path: String, value: JsonElement?) {
    if (value != null && !(value.isStr() && FORMAT.matches(value.str()!!))) fail(path, "unbekanntes Format")
}

private fun checkBool(path: String, value: JsonElement?) {
    if (value != null && !value.isBool()) fail(path, "true oder false")
}

/** Optional (or required) string out of a fixed set. */
private fun checkEnum(path: String, value: JsonElement?, allowed: List<String>, optional: Boolean = true) {
    if (value == null && optional) return
    if (value.str() !in allowed) fail(path, allowed.joinToString(", "))
}

private fun checkNumber(path: String, value: JsonElement?, min: Double, max: Double, integer: Boolean = false) {
    val number = value.num()
    if (number == null || !number.isFinite() || number < min || number > max) fail(path, "Zahl ${num(min)}–${num(max)}")
    if (integer && number != Math.floor(number)) fail(path, "ganze Zahl erwartet")
}

private fun checkList(path: String, value: JsonElement?, range: IntRange): JsonArray {
    if (value !is JsonArray || value.size !in range) fail(path, "${range.first}–${range.last} Einträge")
    return value
}

private fun checkEntry(path: String, value: JsonElement?): JsonObject {
    if (value !is JsonObject) fail(path, "Objekt erwartet")
    return value
}

private fun checkImage(path: String, value: JsonElement?) {
    val image = checkEntry(path, value)
    if (!isUiHttpsUrl(image.string("src"))) fail("$path.src", "öffentliche https-Adresse erwartet")
    checkLabel("$path.alt", image["alt"], 300)
}

private fun checkDate(path: String, value: JsonElement?) {
    if (!(value.isStr() && DATE.matches(value.str()!!))) fail(path, "Datum YYYY-MM-DD erwartet")
}

private fun checkRows(path: String, rows: JsonElement?) {
    if (rows !is JsonArray) fail(path, "Liste erwartet")
    if (rows.size > Limits.ROWS) fail(path, "zu viele Zeilen")
    rows.forEachIndexed { index, row ->
        if (row !is JsonObject) fail("$path[$index]", "Objekt erwartet")
        if (row.size > 24) fail("$path[$index]", "zu viele Felder")
        for ((key, value) in row) {
            if (!NAME.matches(key)) fail("$path[$index].$key", "ungültiger Name")
            if (!(value.isNum() || value.isStr() || value.isBool() || value is JsonNull)) fail("$path[$index].$key", "einfacher Wert erwartet")
            if (value.isStr() && value.str()!!.length > 300) fail("$path[$index].$key", "zu lang")
        }
    }
}

private fun checkView(path: String, view: JsonElement?, sources: Set<String>) {
    if (view !is JsonObject) fail(path, "Objekt erwartet")
    val generate = view["generate"]
    if (generate != null) {
        if (generate !is JsonObject) fail("$path.generate", "Objekt erwartet")
        val variable = generate["var"]
        if (!(variable.isStr() && NAME.matches(variable.str()!!))) fail("$path.generate.var", "Name erwartet")
        checkExprSource("$path.generate.from", exprSource(generate["from"]))
        checkExprSource("$path.generate.to", exprSource(generate["to"]))
        generate["step"]?.let { step -> if (!(step.isNum() && step.num()!! > 0)) fail("$path.generate.step", "positive Zahl erwartet") }
        val fields = view["fields"]
        if (fields !is JsonObject) fail("$path.fields", "Objekt erwartet")
        for ((key, expr) in fields) {
            if (!NAME.matches(key)) fail("$path.fields.$key", "ungültiger Name")
            checkExpr("$path.fields.$key", expr)
        }
        return
    }
    val from = view["from"]
    if (!(from.isStr() && from.str() in sources)) fail("$path.from", "unbekannte Datenquelle")
    view["filter"]?.let { checkExpr("$path.filter", it) }
    view["groupBy"]?.let { if (!(it.isStr() && NAME.matches(it.str()!!))) fail("$path.groupBy", "Feldname erwartet") }
    view["aggregate"]?.let { aggregate ->
        if (aggregate !is JsonObject) fail("$path.aggregate", "Objekt erwartet")
        for ((key, spec) in aggregate) {
            if (!NAME.matches(key) || spec !is JsonObject) fail("$path.aggregate.$key", "ungültig")
            if (spec.string("op") !in listOf("sum", "avg", "min", "max", "count")) fail("$path.aggregate.$key.op", "sum, avg, min, max oder count")
        }
    }
    view["sort"]?.let { sort -> if (!(sort is JsonObject && sort["field"].isStr())) fail("$path.sort", "Feld erwartet") }
    view["limit"]?.let { limit ->
        val value = limit.num() ?: Double.NaN
        if (!(value >= 1 && value <= Limits.ROWS)) fail("$path.limit", "ungültig")
    }
}

private fun checkData(path: String, value: JsonElement?, sources: Set<String>) {
    if (value.isStr()) { if (value.str() !in sources) fail(path, "unbekannte Datenquelle") }
    else checkRows(path, value)
}

private fun checkOptions(path: String, options: JsonElement?) {
    if (options !is JsonArray || options.isEmpty() || options.size > 30) fail(path, "1–30 Optionen erwartet")
    options.forEachIndexed { index, option ->
        if (option !is JsonObject) fail("$path[$index]", "Objekt erwartet")
        val value = option["value"]
        if (!(value.isStr() || value.isNum())) fail("$path[$index].value", "Wert erwartet")
        checkText("$path[$index].label", option["label"], 80)
    }
}

private fun checkAction(path: String, value: JsonElement?, walk: Walk) {
    if (value !is JsonObject) fail(path, "Aktion erwartet")
    when (value.string("type")) {
        "sendMessage" -> checkTemplate("$path.text", value["text"], 1000)
        "set" -> {
            val key = value.string("key")
            if (key == null || !walk.g.state.containsKey(key)) fail("$path.key", "State-Wert erwartet")
            checkExpr("$path.value", value["value"])
        }
        "reset" -> Unit
        "copy", "prefill" -> checkTemplate("$path.text", value["text"], Limits.LONG_TEXT)
        "openUrl" -> if (!isUiHttpsUrl(value.string("url"))) fail("$path.url", "öffentliche https-Adresse erwartet")
        "openEntity" -> {
            checkLabel("$path.title", value["title"], 200)
            value["lang"]?.let { if (!(it.isStr() && LANG.matches(it.str()!!))) fail("$path.lang", "Sprachcode wie de oder en") }
        }
        else -> fail("$path.type", "sendMessage, set, reset, copy, openUrl, prefill oder openEntity")
    }
}

/** Registers a component or entry ID in the view-wide namespace. */
private fun claimId(path: String, id: JsonElement?, walk: Walk) {
    if (id == null) return
    val value = id.str()
    if (value == null || !ID.matches(value)) fail(path, "ungültige ID")
    if (!walk.ids.add(value)) fail(path, "ID doppelt")
}

private fun checkNode(path: String, value: JsonElement?, depth: Int, walk: Walk, inForm: Boolean) {
    if (value !is JsonObject) fail(path, "Komponente erwartet")
    if (depth > Limits.DEPTH) fail(path, "zu tief verschachtelt")
    if (++walk.nodes > Limits.NODES) fail(path, "zu viele Komponenten")
    val node = value
    val typeElement = node["type"]
    val type = typeElement.str()
    if (type == null || type !in UI_NODE_TYPES) fail(path, "unbekannte Komponente \"${(typeElement as? JsonPrimitive)?.content ?: "undefined"}\"")
    val at = "$path<$type>"
    for (field in UI_REQUIRED_FIELDS[type].orEmpty()) if (node[field] == null) fail("$at.$field", "Pflichtfeld fehlt")
    claimId("$at.id", node["id"], walk)
    val childInForm = inForm || type == "form"
    fun nested(childPath: String, list: JsonElement?) {
        if (list !is JsonArray) fail(childPath, "Liste erwartet")
        list.forEachIndexed { index, child -> checkNode("$childPath[$index]", child, depth + 1, walk, childInForm) }
    }
    fun children(key: String) = nested("$at.$key", node[key])
    /** Binding to declared state; `kind` also requires that type unless the default is null. */
    fun bind(key: String = "bind", kind: String? = null) {
        val name = node.string(key)
        if (name == null || !walk.g.state.containsKey(name)) fail("$at.$key", "muss auf einen State-Wert zeigen")
        val current = walk.g.state[name]
        if (kind != null && current !is JsonNull) {
            val matches = if (kind == "number") current.isNum() else current.isStr()
            if (!matches) fail("$at.$key", if (kind == "number") "Zahl-State erwartet" else "Text-State erwartet")
        }
    }
    when (type) {
        "stack", "row" -> children("children")
        "grid" -> {
            val columns = node.number("columns")
            if (columns == null || columns < 1 || columns > 4) fail("$at.columns", "1–4")
            children("children")
        }
        "card" -> {
            node["title"]?.let { checkTemplate("$at.title", it, 160) }
            node["subtitle"]?.let { checkTemplate("$at.subtitle", it, 240) }
            node["highlight"]?.let { checkExpr("$at.highlight", it) }
            node["image"]?.let { checkImage("$at.image", it) }
            checkBool("$at.expandable", node["expandable"])
            node["actions"]?.let { actions ->
                checkList("$at.actions", actions, 1..Limits.CARD_ACTIONS).forEachIndexed { i, item ->
                    val button = checkEntry("$at.actions[$i]", item)
                    checkLabel("$at.actions[$i].label", button["label"], 40)
                    checkAction("$at.actions[$i].action", button["action"], walk)
                    checkEnum("$at.actions[$i].variant", button["variant"], listOf("primary", "secondary"))
                }
            }
            children("children")
        }
        "calculator" -> {
            node["title"]?.let { checkText("$at.title", it, 160) }
            children("inputs")
            children("outputs")
            node["chart"]?.let { checkNode("$at.chart", it, depth + 1, walk, inForm) }
        }
        "heading" -> checkTemplate("$at.text", node["text"], 200)
        "text", "badge" -> checkTemplate("$at.text", node["text"], if (type == "badge") 80 else Limits.TEXT)
        "markdown" -> checkTemplate("$at.text", node["text"], Limits.TEXT)
        "divider" -> Unit
        "kpi" -> {
            checkText("$at.label", node["label"], 80)
            checkExpr("$at.value", node["value"])
            checkFormat("$at.format", node["format"])
            node["hint"]?.let { checkTemplate("$at.hint", it, 200) }
            node["trend"]?.let { checkExpr("$at.trend", it) }
            node["delta"]?.let { checkExpr("$at.delta", it) }
            checkFormat("$at.deltaFormat", node["deltaFormat"])
            node["spark"]?.let { spark -> checkData("$at.spark", JsonPrimitive(spark.str() ?: (spark as? JsonPrimitive)?.content ?: spark.toString()), walk.g.sources) }
            node["sparkKey"]?.let { if (!(it.isStr() && NAME.matches(it.str()!!))) fail("$at.sparkKey", "Feldname erwartet") }
        }
        "slider" -> {
            bind()
            checkText("$at.label", node["label"], 80)
            val min = node.number("min")
            val max = node.number("max")
            if (min == null || max == null || min >= max) fail(at, "min < max erwartet")
            node["step"]?.let { step -> if (!(step.isNum() && step.num()!! > 0)) fail("$at.step", "positiv") }
            checkFormat("$at.format", node["format"])
        }
        "input" -> {
            bind()
            checkText("$at.label", node["label"], 80)
            node["kind"]?.let { kind -> if (kind.str() !in listOf("number", "text")) fail("$at.kind", "number oder text") }
        }
        "select", "segmented", "radio" -> {
            bind()
            checkText("$at.label", node["label"], 80)
            checkOptions("$at.options", node["options"])
        }
        "checkbox" -> {
            bind()
            checkText("$at.label", node["label"], 120)
        }
        "button" -> {
            checkText("$at.label", node["label"], 60)
            checkAction("$at.action", node["action"], walk)
            checkEnum("$at.variant", node["variant"], listOf("primary", "secondary"))
        }
        "table" -> {
            checkData("$at.data", node["data"], walk.g.sources)
            val columns = node["columns"]
            if (columns !is JsonArray || columns.isEmpty() || columns.size > 12) fail("$at.columns", "1–12 Spalten")
            columns.forEachIndexed { index, column ->
                if (column !is JsonObject || !column["key"].isStr()) fail("$at.columns[$index]", "Spalte erwartet")
                checkText("$at.columns[$index].label", column["label"], 60)
                checkFormat("$at.columns[$index].format", column["format"])
            }
            node["highlight"]?.let { checkExpr("$at.highlight", it) }
            checkBool("$at.sortable", node["sortable"])
        }
        "chart" -> {
            if (node.string("kind") !in listOf("bar", "line", "area", "pie", "scatter")) fail("$at.kind", "bar, line, area, pie oder scatter")
            checkData("$at.data", node["data"], walk.g.sources)
            if (!node["x"].isStr()) fail("$at.x", "Feldname erwartet")
            checkList("$at.series", node["series"], Limits.CHART_SERIES).forEachIndexed { index, entry ->
                if (entry !is JsonObject || !entry["key"].isStr()) fail("$at.series[$index]", "Reihe erwartet")
                checkText("$at.series[$index].label", entry["label"], 60)
            }
            checkFormat("$at.format", node["format"])
            node["height"]?.let { height ->
                val h = height.num() ?: Double.NaN
                if (!(h >= 120 && h <= 480)) fail("$at.height", "120–480")
            }
            checkBool("$at.stacked", node["stacked"])
            if (node["ranges"] != null || node["rangeBind"] != null) {
                if (node["ranges"] == null || node["rangeBind"] == null) fail("$at.ranges", "ranges und rangeBind gehören zusammen")
                bind("rangeBind")
                checkList("$at.ranges", node["ranges"], Limits.CHART_RANGES).forEachIndexed { i, item ->
                    val range = checkEntry("$at.ranges[$i]", item)
                    checkLabel("$at.ranges[$i].label", range["label"], 30)
                    if (!(range["value"].isStr() || range["value"].isNum())) fail("$at.ranges[$i].value", "Wert erwartet")
                }
            }
        }
        "compare" -> {
            if (node["bind"] != null) bind()
            val items = node["items"]
            if (items !is JsonArray || items.size < 2 || items.size > 6) fail("$at.items", "2–6 Einträge")
            items.forEachIndexed { index, item ->
                if (item !is JsonObject || !item["id"].isStr()) fail("$at.items[$index]", "Eintrag mit id erwartet")
                checkText("$at.items[$index].title", item["title"], 80)
                val values = item["values"]
                if (values !is JsonObject) fail("$at.items[$index].values", "Objekt erwartet")
                checkRows("$at.items[$index].values", JsonArray(listOf(values)))
            }
            val specs = node["specs"]
            if (specs !is JsonArray || specs.isEmpty() || specs.size > 16) fail("$at.specs", "1–16 Merkmale")
            specs.forEachIndexed { index, spec ->
                if (spec !is JsonObject || !spec["key"].isStr()) fail("$at.specs[$index]", "Merkmal erwartet")
                checkText("$at.specs[$index].label", spec["label"], 60)
                checkFormat("$at.specs[$index].format", spec["format"])
            }
        }
        // v2 layout
        "tabs" -> {
            if (node["bind"] != null) bind("bind", "number")
            checkList("$at.tabs", node["tabs"], Limits.TABS).forEachIndexed { i, item ->
                val tab = checkEntry("$at.tabs[$i]", item)
                claimId("$at.tabs[$i].id", tab["id"], walk)
                checkLabel("$at.tabs[$i].label", tab["label"], 40)
                nested("$at.tabs[$i].children", tab["children"])
            }
        }
        "accordion" -> {
            checkList("$at.items", node["items"], Limits.ACCORDION).forEachIndexed { i, item ->
                val section = checkEntry("$at.items[$i]", item)
                claimId("$at.items[$i].id", section["id"], walk)
                checkLabel("$at.items[$i].title", section["title"], 160)
                checkBool("$at.items[$i].open", section["open"])
                nested("$at.items[$i].children", section["children"])
            }
        }
        // v2 content
        "carousel" -> {
            checkEnum("$at.aspect", node["aspect"], UI_ASPECTS)
            checkList("$at.items", node["items"], Limits.CAROUSEL).forEachIndexed { i, item ->
                val entry = checkEntry("$at.items[$i]", item)
                val p = "$at.items[$i]"
                checkLabel("$p.title", entry["title"], 120)
                entry["subtitle"]?.let { checkText("$p.subtitle", it, 200) }
                entry["meta"]?.let { meta -> checkList("$p.meta", meta, 0..Limits.CAROUSEL_META).forEachIndexed { m, text -> checkLabel("$p.meta[$m]", text, 60) } }
                entry["badge"]?.let { checkText("$p.badge", it, 40) }
                entry["image"]?.let { checkImage("$p.image", it) }
                entry["action"]?.let { checkAction("$p.action", it, walk) }
            }
        }
        "list" -> {
            checkList("$at.items", node["items"], Limits.LIST).forEachIndexed { i, item ->
                val entry = checkEntry("$at.items[$i]", item)
                val p = "$at.items[$i]"
                checkTemplate("$p.title", entry["title"], 160)
                if (entry.string("title")!!.isBlank()) fail("$p.title", "Text fehlt")
                entry["subtitle"]?.let { checkTemplate("$p.subtitle", it, 300) }
                entry["trailing"]?.let { checkTemplate("$p.trailing", it, 80) }
                entry["icon"]?.let { icon ->
                    val name = icon.str()
                    if (!(name != null && (name in UI_ICON_NAMES || (name.length <= 16 && startsWithEmoji(name))))) fail("$p.icon", "bekanntes Symbol oder ein Emoji")
                }
                entry["image"]?.let { checkImage("$p.image", it) }
                entry["action"]?.let { checkAction("$p.action", it, walk) }
            }
        }
        "timeline" -> {
            checkList("$at.items", node["items"], Limits.TIMELINE).forEachIndexed { i, item ->
                val entry = checkEntry("$at.items[$i]", item)
                val p = "$at.items[$i]"
                entry["time"]?.let { checkText("$p.time", it, 60) }
                checkLabel("$p.title", entry["title"], 160)
                entry["text"]?.let { checkText("$p.text", it, 600) }
                checkEnum("$p.status", entry["status"], listOf("done", "current", "upcoming"))
            }
        }
        "callout" -> {
            checkEnum("$at.tone", node["tone"], listOf("info", "success", "warning", "danger", "tip"), optional = false)
            node["title"]?.let { checkTemplate("$at.title", it, 160) }
            checkTemplate("$at.text", node["text"], Limits.LONG_TEXT)
        }
        "progress" -> {
            checkExpr("$at.value", node["value"])
            node["max"]?.let { checkExpr("$at.max", it) }
            node["label"]?.let { checkTemplate("$at.label", it, 120) }
            checkFormat("$at.format", node["format"])
            checkEnum("$at.kind", node["kind"], listOf("bar", "ring"))
        }
        "rating" -> {
            checkNumber("$at.value", node["value"], 0.0, 5.0)
            val rating = node.number("value")!!
            if (rating * 2 != Math.floor(rating * 2)) fail("$at.value", "halbe Schritte")
            node["count"]?.let { checkNumber("$at.count", it, 0.0, 1e9, integer = true) }
            node["label"]?.let { checkText("$at.label", it, 80) }
        }
        "image" -> {
            if (!isUiHttpsUrl(node.string("src"))) fail("$at.src", "öffentliche https-Adresse erwartet")
            checkLabel("$at.alt", node["alt"], 300)
            node["caption"]?.let { checkText("$at.caption", it, 300) }
            checkEnum("$at.aspect", node["aspect"], UI_ASPECTS)
        }
        "code" -> {
            val language = node.string("language")
            if (language == null || !CODE_LANGUAGE.matches(language)) fail("$at.language", "Sprachname erwartet")
            checkLabel("$at.code", node["code"], Limits.TEXT)
            node["title"]?.let { checkText("$at.title", it, 120) }
        }
        "math" -> {
            checkLabel("$at.tex", node["tex"], 1000)
            checkBool("$at.display", node["display"])
        }
        // v2 inputs
        "stepper" -> {
            bind("bind", "number")
            checkText("$at.label", node["label"], 80)
            for (key in listOf("min", "max")) node[key]?.let { checkNumber("$at.$key", it, -1e12, 1e12) }
            val min = node.number("min")
            val max = node.number("max")
            if (min != null && max != null && min >= max) fail(at, "min < max erwartet")
            node["step"]?.let { step -> if (!(step.isNum() && step.num()!! > 0)) fail("$at.step", "positiv") }
            checkFormat("$at.format", node["format"])
        }
        "textarea" -> {
            bind("bind", "string")
            checkText("$at.label", node["label"], 80)
            node["rows"]?.let { checkNumber("$at.rows", it, 2.0, 8.0, integer = true) }
            node["placeholder"]?.let { checkText("$at.placeholder", it, 120) }
        }
        "date" -> {
            bind("bind", "string")
            checkText("$at.label", node["label"], 80)
            val bound = node.string("bind").orEmpty()
            val current = walk.g.state[bound]
            if (current.isStr() && current.str() != "") checkDate("state.$bound", current)
            node["min"]?.let { checkDate("$at.min", it) }
            node["max"]?.let { checkDate("$at.max", it) }
            val min = node.string("min")
            val max = node.string("max")
            if (min != null && max != null && min > max) fail(at, "min ≤ max erwartet")
        }
        "form" -> {
            if (inForm) fail(at, "Formulare lassen sich nicht verschachteln")
            node["title"]?.let { checkText("$at.title", it, 160) }
            checkList("$at.children", node["children"], Limits.FORM_CHILDREN)
            children("children")
            val submit = checkEntry("$at.submit", node["submit"])
            checkLabel("$at.submit.label", submit["label"], 60)
            checkTemplate("$at.submit.message", submit["message"], 1000)
            if (submit.string("message")!!.isBlank()) fail("$at.submit.message", "Text fehlt")
        }
        // v2 learning
        "checklist" -> {
            node["title"]?.let { checkText("$at.title", it, 160) }
            val seen = HashSet<String>()
            checkList("$at.items", node["items"], Limits.CHECKLIST).forEachIndexed { i, item ->
                val entry = checkEntry("$at.items[$i]", item)
                val p = "$at.items[$i]"
                val id = entry.string("id")
                if (id == null || !ID.matches(id)) fail("$p.id", "ungültige ID")
                if (!seen.add(id)) fail("$p.id", "ID doppelt")
                checkTemplate("$p.label", entry["label"], 200)
                if (entry.string("label")!!.isBlank()) fail("$p.label", "Text fehlt")
                entry["detail"]?.let { checkTemplate("$p.detail", it, 300) }
            }
            checkBool("$at.copyable", node["copyable"])
        }
        "quiz" -> {
            node["title"]?.let { checkText("$at.title", it, 160) }
            checkList("$at.questions", node["questions"], Limits.QUIZ).forEachIndexed { i, item ->
                val question = checkEntry("$at.questions[$i]", item)
                val p = "$at.questions[$i]"
                checkLabel("$p.q", question["q"], 300)
                checkEnum("$p.kind", question["kind"], listOf("choice", "text"))
                if (quizQuestionKind(question) == "choice") {
                    val options = checkList("$p.options", question["options"], Limits.QUIZ_OPTIONS)
                    options.forEachIndexed { o, option -> checkLabel("$p.options[$o]", option, 200) }
                    val answer = question["answer"].num()
                    if (answer == null || answer != Math.floor(answer) || answer < 0 || answer >= options.size) fail("$p.answer", "Index einer Option erwartet")
                } else {
                    if (question["options"] != null) fail("$p.options", "nur bei Auswahlfragen")
                    checkLabel("$p.answer", question["answer"], 200)
                }
                question["hint"]?.let { checkText("$p.hint", it, 300) }
                question["explanation"]?.let { checkText("$p.explanation", it, 600) }
            }
        }
        "flashcards" -> {
            checkList("$at.cards", node["cards"], Limits.FLASHCARDS).forEachIndexed { i, item ->
                val card = checkEntry("$at.cards[$i]", item)
                checkLabel("$at.cards[$i].front", card["front"], 300)
                checkLabel("$at.cards[$i].back", card["back"], 600)
            }
        }
        // v2 live widgets
        "weather" -> {
            checkLabel("$at.location", node["location"], 120)
            node["days"]?.let { checkNumber("$at.days", it, Limits.WEATHER_DAYS.first.toDouble(), Limits.WEATHER_DAYS.last.toDouble(), integer = true) }
        }
        "currency" -> {
            for (key in listOf("from", "to")) {
                val code = node.string(key)
                if (code == null || !CURRENCY_CODE.matches(code)) fail("$at.$key", "ISO-Währungscode wie EUR")
            }
            if (node.string("from") == node.string("to")) fail("$at.to", "zwei verschiedene Währungen")
            node["amount"]?.let { checkNumber("$at.amount", it, 0.0, 1e12) }
        }
        "stock" -> {
            val symbol = node.string("symbol")
            if (symbol == null || !STOCK_SYMBOL.matches(symbol)) fail("$at.symbol", "Börsenkürzel erwartet")
            checkEnum("$at.range", node["range"], UI_STOCK_RANGES)
        }
        "entity" -> {
            checkLabel("$at.title", node["title"], 200)
            node["lang"]?.let { if (!(it.isStr() && LANG.matches(it.str()!!))) fail("$at.lang", "Sprachcode wie de oder en") }
        }
        "news", "gallery" -> checkLabel("$at.query", node["query"], 200)
        // v2.1 custom tile: the code only runs in the sandbox, so it is size-checked, not parsed.
        "widget" -> {
            if (++walk.widgets > Limits.WIDGETS) fail(at, "höchstens ${Limits.WIDGETS} eigene Kacheln")
            val id = node.string("id") ?: fail("$at.id", "Pflichtfeld fehlt")
            val html = node.string("html")
            if (html == null || html.isBlank()) fail("$at.html", "Code fehlt")
            if (html.length > Limits.WIDGET_HTML) fail("$at.html", "Code länger als ${Limits.WIDGET_HTML} Zeichen")
            node["title"]?.let { checkLabel("$at.title", it, 80) }
            node["height"]?.let { checkNumber("$at.height", it, Limits.WIDGET_HEIGHT.first.toDouble(), Limits.WIDGET_HEIGHT.last.toDouble(), integer = true) }
            for (key in listOf("props", "state")) {
                val value = node[key] ?: continue
                if (value !is JsonObject) fail("$at.$key", "Objekt erwartet")
                if (value.toString().length > Limits.WIDGET_JSON) fail("$at.$key", "grösser als ${Limits.WIDGET_JSON} Zeichen")
            }
            node["live"]?.let { live ->
                if (live !is JsonObject) fail("$at.live", "Objekt erwartet")
                if (live.size > Limits.WIDGET_LIVE) fail("$at.live", "höchstens ${Limits.WIDGET_LIVE} Live-Daten")
                for ((name, input) in live) {
                    if (!NAME.matches(name)) fail("$at.live.$name", "ungültiger Name")
                    if (input !is JsonObject || input.string("type") !in UI_LIVE_NODE_TYPES) fail("$at.live.$name", "weather, currency, stock, entity, news oder gallery")
                    val liveId = uiWidgetLiveId(id, name)
                    if (!ID.matches(liveId)) fail("$at.live.$name", "Kachel-ID und Name zu lang")
                    // Same checks, id namespace and live-widget limit as a stand-alone widget.
                    checkNode("$at.live.$name", JsonObject(input + ("id" to JsonPrimitive(liveId))), depth + 1, walk, inForm)
                }
            }
        }
    }
    if (type in UI_LIVE_NODE_TYPES) {
        if (node["id"] == null) fail("$at.id", "Pflichtfeld fehlt")
        if (++walk.live > Limits.LIVE) fail(at, "höchstens ${Limits.LIVE} Live-Bausteine")
    }
}
