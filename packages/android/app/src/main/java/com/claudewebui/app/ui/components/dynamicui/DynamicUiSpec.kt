package com.claudewebui.app.ui.components.dynamicui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Dynamic UI schema v1 on Android: the client-side gate that mirrors
 * `validateDynamicUi` in `packages/shared/src/utils/dynamicUi.ts`. The server
 * already validated the description, but stored history and fixtures pass the
 * same checks before anything renders: known components only, bindings to
 * declared state, parseable formulas, bounded sizes.
 */

const val DYNAMIC_UI_VERSION = 1


private object Limits {
    const val NODES = 250
    const val DEPTH = 10
    const val ROWS = 500
    const val DATASETS = 12
    const val VIEWS = 20
    const val STATE = 40
    const val COMPUTED = 60
    const val TEXT = 4000
}

private val NAME = Regex("^[A-Za-z_][A-Za-z0-9_]{0,39}$")
private val FORMAT = Regex("^(number|integer|percent|compact|text|decimal:\\d|currency:[A-Z]{3})$")

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
    val title: String? = json.string("title")
    val dashboard: Boolean = json.string("layout") == "dashboard"
    val state: Map<String, Any?> = (json["state"] as? JsonObject)?.mapValues { uiValueOf(it.value) } ?: emptyMap()
    val computed: Map<String, String> = (json["computed"] as? JsonObject)?.mapValues { (it.value as JsonPrimitive).content } ?: emptyMap()
    val data: Map<String, List<UiRow>> = (json["data"] as? JsonObject)?.mapValues { rowsOf(it.value) } ?: emptyMap()
    val views: Map<String, UiView> = (json["views"] as? JsonObject)?.mapValues { viewOf(it.value as JsonObject) } ?: emptyMap()
    val root: JsonObject = json["root"] as JsonObject
}

sealed interface DynamicUiValidation {
    data class Valid(val doc: DynamicUiDoc) : DynamicUiValidation
    data class Invalid(val error: String) : DynamicUiValidation
}

// ── JSON helpers ────────────────────────────────────────────────────────────

internal fun JsonElement?.isStr() = this is JsonPrimitive && this !is JsonNull && isString
internal fun JsonElement?.isNum() = this is JsonPrimitive && this !is JsonNull && !isString && booleanOrNull == null && doubleOrNull != null
internal fun JsonElement?.isBool() = this is JsonPrimitive && this !is JsonNull && !isString && booleanOrNull != null
internal fun JsonObject.string(key: String): String? = this[key]?.takeIf { it.isStr() }?.let { (it as JsonPrimitive).content }
internal fun JsonObject.number(key: String): Double? = this[key]?.takeIf { it.isNum() }?.let { (it as JsonPrimitive).doubleOrNull }
internal fun JsonObject.bool(key: String): Boolean? = this[key]?.takeIf { it.isBool() }?.let { (it as JsonPrimitive).booleanOrNull }
internal fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()

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

// ── Validation ──────────────────────────────────────────────────────────────

private class Invalid(message: String) : Exception(message)

private fun fail(path: String, message: String): Nothing = throw Invalid("$path: $message")

/**
 * Checks a model-produced description against schema v1: known components and
 * props only, bounded sizes, parseable formulas, bindings to declared state.
 */
fun validateDynamicUi(input: JsonElement?): DynamicUiValidation = try {
    if (input !is JsonObject) fail("ui", "Objekt erwartet")
    val version = input["version"]
    if (!version.isNum() || (version as JsonPrimitive).doubleOrNull != DYNAMIC_UI_VERSION.toDouble()) fail("version", "nur Version $DYNAMIC_UI_VERSION")
    val known = HashSet<String>()
    val state = input["state"] ?: JsonObject(emptyMap())
    if (state !is JsonObject) fail("state", "Objekt erwartet")
    if (state.size > Limits.STATE) fail("state", "zu viele Werte")
    for ((key, value) in state) {
        if (!NAME.matches(key)) fail("state.$key", "ungültiger Name")
        if (!(value.isNum() || value.isStr() || value.isBool() || value is JsonNull)) fail("state.$key", "Zahl, Text oder Wahrheitswert erwartet")
        if (value.isStr() && (value as JsonPrimitive).content.length > 200) fail("state.$key", "zu lang")
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
    input["layout"]?.let { if (!(it.isStr() && (it as JsonPrimitive).content in listOf("inline", "dashboard"))) fail("layout", "inline oder dashboard") }
    input["viewId"]?.let { if (!it.isStr() || !Regex("^[A-Za-z0-9_-]{1,80}$").matches((it as JsonPrimitive).content)) fail("viewId", "ungültige Ansichtskennung") }
    val counter = Counter()
    checkNode("root", input["root"], 0, counter, state.keys, sources)
    DynamicUiValidation.Valid(DynamicUiDoc(input))
} catch (error: Invalid) {
    DynamicUiValidation.Invalid(error.message ?: "Ungültige Beschreibung")
} catch (error: Exception) {
    DynamicUiValidation.Invalid(error.message ?: "Ungültige Beschreibung")
}

private class Counter { var nodes = 0; val ids = HashSet<String>() }

private fun checkText(path: String, value: JsonElement?, max: Int = 300) {
    if (!value.isStr()) fail(path, "Text erwartet")
    if ((value as JsonPrimitive).content.length > max) fail(path, "zu lang")
}

private fun checkExprSource(path: String, source: String) {
    try { parseExpr(source) } catch (error: ExprException) { fail(path, error.message ?: "Ungültige Formel") }
}

private fun checkExpr(path: String, value: JsonElement?) {
    if (!value.isStr()) fail(path, "Formel erwartet")
    checkExprSource(path, (value as JsonPrimitive).content)
}

private fun checkTemplate(path: String, value: JsonElement?, max: Int = 600) {
    checkText(path, value, max)
    for (match in TEMPLATE_PATTERN.findAll((value as JsonPrimitive).content)) {
        checkExprSource(path, match.groupValues[1])
        val format = match.groups[2]?.value
        if (format != null && !FORMAT.matches(format)) fail(path, "unbekanntes Format $format")
    }
}

private fun checkFormat(path: String, value: JsonElement?) {
    if (value != null && !(value.isStr() && FORMAT.matches((value as JsonPrimitive).content))) fail(path, "unbekanntes Format")
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
            if (value.isStr() && (value as JsonPrimitive).content.length > 300) fail("$path[$index].$key", "zu lang")
        }
    }
}

private fun checkView(path: String, view: JsonElement?, sources: Set<String>) {
    if (view !is JsonObject) fail(path, "Objekt erwartet")
    val generate = view["generate"]
    if (generate != null) {
        if (generate !is JsonObject) fail("$path.generate", "Objekt erwartet")
        val variable = generate["var"]
        if (!(variable.isStr() && NAME.matches((variable as JsonPrimitive).content))) fail("$path.generate.var", "Name erwartet")
        checkExprSource("$path.generate.from", exprSource(generate["from"]))
        checkExprSource("$path.generate.to", exprSource(generate["to"]))
        generate["step"]?.let { step -> if (!(step.isNum() && (step as JsonPrimitive).doubleOrNull!! > 0)) fail("$path.generate.step", "positive Zahl erwartet") }
        val fields = view["fields"]
        if (fields !is JsonObject) fail("$path.fields", "Objekt erwartet")
        for ((key, expr) in fields) {
            if (!NAME.matches(key)) fail("$path.fields.$key", "ungültiger Name")
            checkExpr("$path.fields.$key", expr)
        }
        return
    }
    val from = view["from"]
    if (!(from.isStr() && (from as JsonPrimitive).content in sources)) fail("$path.from", "unbekannte Datenquelle")
    view["filter"]?.let { checkExpr("$path.filter", it) }
    view["groupBy"]?.let { if (!(it.isStr() && NAME.matches((it as JsonPrimitive).content))) fail("$path.groupBy", "Feldname erwartet") }
    view["aggregate"]?.let { aggregate ->
        if (aggregate !is JsonObject) fail("$path.aggregate", "Objekt erwartet")
        for ((key, spec) in aggregate) {
            if (!NAME.matches(key) || spec !is JsonObject) fail("$path.aggregate.$key", "ungültig")
            val op = spec["op"]
            if (!(op.isStr() && (op as JsonPrimitive).content in listOf("sum", "avg", "min", "max", "count"))) fail("$path.aggregate.$key.op", "sum, avg, min, max oder count")
        }
    }
    view["sort"]?.let { sort -> if (!(sort is JsonObject && sort["field"].isStr())) fail("$path.sort", "Feld erwartet") }
    view["limit"]?.let { limit ->
        val value = if (limit.isNum()) (limit as JsonPrimitive).doubleOrNull!! else Double.NaN
        if (!(value >= 1 && value <= Limits.ROWS)) fail("$path.limit", "ungültig")
    }
}

private fun checkData(path: String, value: JsonElement?, sources: Set<String>) {
    if (value.isStr()) { if ((value as JsonPrimitive).content !in sources) fail(path, "unbekannte Datenquelle") }
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

private fun checkNode(path: String, value: JsonElement?, depth: Int, counter: Counter, state: Set<String>, sources: Set<String>) {
    if (value !is JsonObject) fail(path, "Komponente erwartet")
    if (depth > Limits.DEPTH) fail(path, "zu tief verschachtelt")
    if (++counter.nodes > Limits.NODES) fail(path, "zu viele Komponenten")
    val node = value
    val typeElement = node["type"]
    val type = if (typeElement.isStr()) (typeElement as JsonPrimitive).content else null
    if (type == null || type !in UI_NODE_TYPES) fail(path, "unbekannte Komponente \"${(typeElement as? JsonPrimitive)?.content ?: "undefined"}\"")
    val at = "$path<$type>"
    for (field in UI_REQUIRED_FIELDS[type].orEmpty()) if (node[field] == null) fail("$at.$field", "Pflichtfeld fehlt")
    node["id"]?.let { id ->
        if (!(id.isStr() && NAME.matches((id as JsonPrimitive).content))) fail("$at.id", "ungültige ID")
        if (!counter.ids.add((id as JsonPrimitive).content)) fail("$at.id", "ID doppelt")
    }
    fun children(key: String) {
        val list = node[key]
        if (list !is JsonArray) fail("$at.$key", "Liste erwartet")
        list.forEachIndexed { index, child -> checkNode("$at.$key[$index]", child, depth + 1, counter, state, sources) }
    }
    fun bind() {
        val bind = node["bind"]
        if (!(bind.isStr() && (bind as JsonPrimitive).content in state)) fail("$at.bind", "muss auf einen State-Wert zeigen")
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
            children("children")
        }
        "calculator" -> {
            node["title"]?.let { checkText("$at.title", it, 160) }
            children("inputs")
            children("outputs")
            node["chart"]?.let { checkNode("$at.chart", it, depth + 1, counter, state, sources) }
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
        }
        "slider" -> {
            bind()
            checkText("$at.label", node["label"], 80)
            val min = node.number("min"); val max = node.number("max")
            if (min == null || max == null || min >= max) fail(at, "min < max erwartet")
            node["step"]?.let { step -> if (!(step.isNum() && (step as JsonPrimitive).doubleOrNull!! > 0)) fail("$at.step", "positiv") }
            checkFormat("$at.format", node["format"])
        }
        "input" -> {
            bind()
            checkText("$at.label", node["label"], 80)
            node["kind"]?.let { kind -> if (!(kind.isStr() && (kind as JsonPrimitive).content in listOf("number", "text"))) fail("$at.kind", "number oder text") }
        }
        "select", "segmented" -> {
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
            val action = node["action"]
            if (action !is JsonObject) fail("$at.action", "Aktion erwartet")
            when (action.string("type")) {
                "sendMessage" -> checkTemplate("$at.action.text", action["text"], 1000)
                "set" -> {
                    val key = action["key"]
                    if (!(key.isStr() && (key as JsonPrimitive).content in state)) fail("$at.action.key", "State-Wert erwartet")
                    checkExpr("$at.action.value", action["value"])
                }
                "reset" -> Unit
                else -> fail("$at.action.type", "sendMessage, set oder reset")
            }
        }
        "table" -> {
            checkData("$at.data", node["data"], sources)
            val columns = node["columns"]
            if (columns !is JsonArray || columns.isEmpty() || columns.size > 12) fail("$at.columns", "1–12 Spalten")
            columns.forEachIndexed { index, column ->
                if (column !is JsonObject || !column["key"].isStr()) fail("$at.columns[$index]", "Spalte erwartet")
                checkText("$at.columns[$index].label", column["label"], 60)
                checkFormat("$at.columns[$index].format", column["format"])
            }
            node["highlight"]?.let { checkExpr("$at.highlight", it) }
        }
        "chart" -> {
            if (node.string("kind") !in listOf("bar", "line", "area", "pie")) fail("$at.kind", "bar, line, area oder pie")
            checkData("$at.data", node["data"], sources)
            if (!node["x"].isStr()) fail("$at.x", "Feldname erwartet")
            val series = node["series"]
            if (series !is JsonArray || series.isEmpty() || series.size > 6) fail("$at.series", "1–6 Reihen")
            series.forEachIndexed { index, entry ->
                if (entry !is JsonObject || !entry["key"].isStr()) fail("$at.series[$index]", "Reihe erwartet")
                checkText("$at.series[$index].label", entry["label"], 60)
            }
            checkFormat("$at.format", node["format"])
            node["height"]?.let { height ->
                val h = if (height.isNum()) (height as JsonPrimitive).doubleOrNull!! else Double.NaN
                if (!(h >= 120 && h <= 480)) fail("$at.height", "120–480")
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
    }
}
