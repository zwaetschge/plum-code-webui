package com.claudewebui.app.ui.components.dynamicui

import java.text.Collator
import java.util.Locale

/* Parsed formulas are reused across recompositions; the cache is bounded. */
private val parsedFormulas = HashMap<String, ExprNode>()

private fun ast(source: String): ExprNode = synchronized(parsedFormulas) {
    parsedFormulas[source] ?: parseExpr(source).also {
        if (parsedFormulas.size > 2000) parsedFormulas.clear()
        parsedFormulas[source] = it
    }
}

private const val MAX_GENERATED = 500
private val collator: Collator by lazy { Collator.getInstance(Locale("de", "CH")) }

/**
 * Evaluation context for one message's view at one state snapshot, a port of
 * `UiRuntime` in the WebUI. Computed values and views resolve lazily and are
 * cached; cycles resolve to null instead of recursing forever. Every input
 * change builds a fresh runtime, so all formulas, views, KPIs, tables and
 * charts recompute at once without a network round trip.
 */
class UiRuntime(
    val doc: DynamicUiDoc,
    val state: Map<String, Any?>,
    private val locals: Map<String, Any?> = emptyMap(),
    private val parent: UiRuntime? = null,
) : ExprScope {
    private val computedCache = HashMap<String, Any?>()
    private val viewCache = HashMap<String, List<UiRow>>()
    private val resolving = HashSet<String>()

    /** A child scope with extra names, e.g. the fields of one table row (they shadow state). */
    fun with(locals: Map<String, Any?>): UiRuntime = UiRuntime(doc, state, locals, this)

    override fun lookup(name: String): Any? {
        if (locals.containsKey(name)) return locals[name]
        if (parent != null) return parent.lookup(name)
        if (state.containsKey(name)) return state[name]
        val formula = doc.computed[name] ?: return null
        if (computedCache.containsKey(name)) return computedCache[name]
        if (!resolving.add(name)) return null
        val value = safe(formula)
        resolving.remove(name)
        computedCache[name] = value
        return value
    }

    override fun rows(name: String): List<UiRow> {
        if (parent != null) return parent.rows(name)
        viewCache[name]?.let { return it }
        val key = "view:$name"
        if (!resolving.add(key)) return emptyList()
        val view = doc.views[name]
        val rows = when {
            view != null -> buildView(view)
            else -> doc.data[name] ?: emptyList()
        }
        resolving.remove(key)
        viewCache[name] = rows
        return rows
    }

    /** Rows for a component's `data`: a dataset or view name, or inline rows. */
    fun source(data: Any?): List<UiRow> = when (data) {
        is String -> rows(data)
        is List<*> -> data.filterIsInstance<Map<*, *>>().map { row -> row.entries.associate { it.key.toString() to it.value } }
        else -> emptyList()
    }

    /** Evaluates a formula; anything that fails yields null. */
    fun safe(formula: String): Any? = try {
        val value = evalExpr(ast(formula), this)
        if (value is Double && !value.isFinite()) null else value
    } catch (_: Exception) {
        null
    } catch (_: StackOverflowError) {
        null
    }

    /** Replaces `{{formula|format}}` placeholders in display text. */
    fun template(text: String): String = TEMPLATE_PATTERN.replace(text) { match ->
        formatUiValue(safe(match.groupValues[1]), match.groups[2]?.value)
    }

    private fun buildView(view: UiView): List<UiRow> = when (view) {
        is UiView.Generated -> generate(view)
        is UiView.Derived -> derive(view)
    }

    private fun generate(view: UiView.Generated): List<UiRow> {
        val from = jsNumber(safe(view.from))
        val to = jsNumber(safe(view.to))
        if (!from.isFinite() || !to.isFinite()) return emptyList()
        val rows = ArrayList<UiRow>()
        var value = from
        while (value <= to + 1e-9 && rows.size < MAX_GENERATED) {
            val scope = with(mapOf(view.variable to value))
            val row = LinkedHashMap<String, Any?>()
            for ((field, formula) in view.fields) row[field] = scope.safe(formula)
            rows += row
            value += view.step
        }
        return rows
    }

    private fun derive(view: UiView.Derived): List<UiRow> {
        var rows = rows(view.from)
        view.filter?.let { filter ->
            rows = rows.filter { row ->
                val value = with(row).safe(filter)
                if (value is Double) value != 0.0 else uiTruthy(value)
            }
        }
        if (view.groupBy != null || view.hasAggregate) {
            val groups = LinkedHashMap<String, MutableList<UiRow>>()
            for (row in rows) {
                val key = if (view.groupBy != null) jsString(row[view.groupBy] ?: "") else ""
                groups.getOrPut(key) { ArrayList() } += row
            }
            rows = groups.map { (key, members) ->
                val out = LinkedHashMap<String, Any?>()
                if (view.groupBy != null) out[view.groupBy] = members.firstOrNull()?.get(view.groupBy) ?: key
                for (aggregate in view.aggregate) {
                    val values = members.map { row ->
                        when {
                            aggregate.field == null -> 1.0
                            // Number(undefined) is NaN, Number(null) is 0.
                            !row.containsKey(aggregate.field) -> Double.NaN
                            else -> jsNumber(row[aggregate.field])
                        }
                    }.filter { it.isFinite() }
                    out[aggregate.name] = when {
                        aggregate.op == "count" -> members.size.toDouble()
                        values.isEmpty() -> 0.0
                        aggregate.op == "sum" -> values.sum()
                        aggregate.op == "avg" -> values.sum() / values.size
                        aggregate.op == "min" -> values.min()
                        else -> values.max()
                    }
                }
                out
            }
        }
        view.sortField?.let { field ->
            val sign = if (view.sortDescending) -1 else 1
            rows = rows.sortedWith { a, b ->
                val x = a[field]
                val y = b[field]
                if (x is Double && y is Double) {
                    val difference = (x - y) * sign
                    when { difference > 0 -> 1; difference < 0 -> -1; else -> 0 }
                } else collator.compare(if (x == null) "" else jsString(x), if (y == null) "" else jsString(y)) * sign
            }
        }
        return view.limit?.let { rows.take(it) } ?: rows
    }
}
