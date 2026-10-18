package com.claudewebui.app.ui.components.dynamicui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Mirrors packages/backend/scripts/dynamic-ui-regression-tests.ts: the Kotlin
 * engine, validator and runtime must behave like the WebUI on the three
 * reference fixtures (DynamicUiFixtures.kt, copied from the frontend's fixtures.ts).
 */
class DynamicUiTest {
    @Test fun editedInputsSurviveRevisionAndResetUsesNewDefaults() {
        val defaults = mapOf<String, Any?>("amount" to 20.0, "newField" to true)
        assertEquals(mapOf("amount" to 42.0, "newField" to true), mergeDynamicUiState(defaults, mapOf("amount" to 42.0, "removed" to 5.0)))
        assertEquals(mapOf("amount" to "changedType"), mergeDynamicUiState(mapOf("amount" to "changedType"), mapOf("amount" to 42.0)))
        val store = DynamicUiStateStore()
        store.set("view-a", "amount", 42.0)
        assertEquals(42.0, mergeDynamicUiState(defaults, store.edits["view-a"].orEmpty())["amount"])
        assertEquals(20.0, mergeDynamicUiState(defaults, store.edits["view-b"].orEmpty())["amount"])
        store.reset("view-a")
        assertEquals(defaults, mergeDynamicUiState(defaults, store.edits["view-a"].orEmpty()))
    }

    private fun fixture(name: String): JsonObject = Json.parseToJsonElement(
        when (name) {
            "compound-interest" -> COMPOUND_INTEREST
            "sales-dashboard" -> SALES_DASHBOARD
            else -> PRODUCT_COMPARISON
        },
    ) as JsonObject

    private fun doc(json: JsonElement): DynamicUiDoc = when (val result = validateDynamicUi(json)) {
        is DynamicUiValidation.Valid -> result.doc
        is DynamicUiValidation.Invalid -> throw AssertionError(result.error)
    }

    private fun scope(values: Map<String, Any?> = emptyMap()) = object : ExprScope {
        override fun lookup(name: String): Any? = values[name]
        override fun rows(name: String): List<UiRow> = emptyList()
    }

    private fun calc(source: String, values: Map<String, Any?> = emptyMap()) = evalExpr(parseExpr(source), scope(values))

    @Test fun formulasFollowPrecedenceAndStayInsideTheWhitelist() {
        assertEquals(7.0, calc("1 + 2 * 3"))
        assertEquals(-4.0, calc("-2 ^ 2"))
        assertEquals(512.0, calc("2 ^ 3 ^ 2"))
        assertEquals("gross", calc("a > 1 ? \"gross\" : \"klein\"", mapOf("a" to 3.0)))
        assertEquals(3.33, calc("round(10 / 3, 2)"))
        assertEquals(1629L, Math.round(calc("start * (1 + rate / 100) ^ years", mapOf("start" to 1000.0, "rate" to 5.0, "years" to 10.0)) as Double))
        assertEquals(2200L, Math.round(calc("fv(0, 12, 100, 1000)") as Double))
        assertEquals("ab5", calc("'a' + 'b' + 5"))
        assertEquals(true, calc("x == 'Nord' && !(y > 2)", mapOf("x" to "Nord", "y" to 1.0)))
        assertEquals(1.0, calc("clamp(5, 0, 1)"))
        assertEquals(3.0, calc("min(3, max(1, 2, 3), 4)"))
        for (bad in listOf("eval(1)", "constructor(1)", "toString()", "a.b", "window[\"x\"]", "1 +", "(1", "x = 1", "`x`", "a..b")) {
            try {
                parseExpr(bad)
                fail("\"$bad\" must not parse")
            } catch (_: ExprException) {
            }
        }
        // Bare names only read declared values; nothing else is reachable.
        assertNull(calc("constructor"))
        try { parseExpr("1 + ".repeat(120) + "1"); fail("too long must not parse") } catch (_: ExprException) {}
    }

    @Test fun theThreeReferenceFixturesValidate() {
        for (name in listOf("compound-interest", "sales-dashboard", "product-comparison")) {
            val result = validateDynamicUi(fixture(name))
            assertTrue("$name: $result", result is DynamicUiValidation.Valid)
        }
    }

    @Test fun invalidDescriptionsAreRejectedWithAReason() {
        val base = """"version":1,"state":{"a":1}"""
        val cases = mapOf(
            "unknown component" to """{$base,"root":{"type":"html","html":"<script>alert(1)</script>"}}""",
            "wrong version" to """{"version":2,"state":{"a":1},"root":{"type":"text","text":"Hallo"}}""",
            "bind to missing state" to """{$base,"root":{"type":"slider","bind":"b","label":"B","min":0,"max":1}}""",
            "bind to computed" to """{$base,"computed":{"c":"a * 2"},"root":{"type":"slider","bind":"c","label":"C","min":0,"max":1}}""",
            "bad formula" to """{$base,"computed":{"x":"eval(\"1\")"},"root":{"type":"divider"}}""",
            "template with bad formula" to """{$base,"root":{"type":"text","text":"{{a..b}}"}}""",
            "duplicate ids" to """{$base,"root":{"type":"stack","children":[{"type":"divider","id":"x"},{"type":"divider","id":"x"}]}}""",
            "unknown data source" to """{$base,"root":{"type":"table","data":"nope","columns":[{"key":"a","label":"A"}]}}""",
            "unknown format" to """{$base,"root":{"type":"kpi","label":"K","value":"a","format":"currency:chf"}}""",
            "slider min >= max" to """{$base,"root":{"type":"slider","bind":"a","label":"A","min":5,"max":5}}""",
            "grid columns" to """{$base,"root":{"type":"grid","columns":5,"children":[]}}""",
            "not an object" to "\"plum\"",
        )
        for ((name, input) in cases) {
            val result = validateDynamicUi(Json.parseToJsonElement(input))
            assertTrue(name, result is DynamicUiValidation.Invalid)
        }
        var deep = """{"type":"divider"}"""
        repeat(12) { deep = """{"type":"stack","children":[$deep]}""" }
        assertTrue("too deep", validateDynamicUi(Json.parseToJsonElement("""{"version":1,"root":$deep}""")) is DynamicUiValidation.Invalid)
        val many = (1..260).joinToString(",") { """{"type":"divider"}""" }
        assertTrue("too many", validateDynamicUi(Json.parseToJsonElement("""{"version":1,"root":{"type":"stack","children":[$many]}}""")) is DynamicUiValidation.Invalid)
    }

    @Test fun oneSharedStateRecomputesFormulasViewsAndAggregates() {
        val compound = doc(fixture("compound-interest"))
        val start = UiRuntime(compound, compound.state)
        val final = start.lookup("final") as Double
        assertTrue(final > 10000)
        assertEquals(16, start.rows("growth").size)
        val later = UiRuntime(compound, compound.state + ("years" to 30.0))
        assertTrue("30 years grow more than 15", (later.lookup("final") as Double) > final)
        assertEquals(31, later.rows("growth").size)
        assertEquals("30 Jahre", later.template("{{years|integer}} Jahre"))
        assertEquals(0.0, later.rows("growth").first()["year"])

        val sales = doc(fixture("sales-dashboard"))
        val all = UiRuntime(sales, mapOf("region" to "Alle", "channel" to "Alle"))
        val north = UiRuntime(sales, mapOf("region" to "Nord", "channel" to "Alle"))
        assertEquals(6, all.rows("monthly").size)
        assertTrue((north.lookup("total") as Double) < (all.lookup("total") as Double))
        val expected = sales.data.getValue("sales").filter { it["region"] == "Nord" }.sumOf { it["revenue"] as Double }
        assertEquals(expected, north.lookup("total") as Double, 0.0)
        val online = UiRuntime(sales, mapOf("region" to "Alle", "channel" to "Online"))
        assertTrue((online.lookup("total") as Double) < (all.lookup("total") as Double))
        assertEquals(listOf("Jan", "Feb", "Mär", "Apr", "Mai", "Jun"), all.rows("monthly").map { it["month"] })
        // Highlight: the best month is found through maxOf on the same view.
        val best = all.rows("monthly").filter { uiTruthy(all.with(it).safe("revenue == maxOf('monthly', 'revenue')")) }
        assertEquals(listOf("Jun"), best.map { it["month"] })
        assertEquals("Umsatz pro Monat · Nord · Alle", north.template("Umsatz pro Monat · {{region}} · {{channel}}"))

        val comparison = doc(fixture("product-comparison"))
        val pro = UiRuntime(comparison, mapOf("pick" to "pro"))
        assertEquals("Auswahl: Pro 16 für CHF 2'499", pro.template("Auswahl: {{pickName}} für {{pickPrice|currency:CHF}}"))

        val cyclic = doc(Json.parseToJsonElement("""{"version":1,"computed":{"a":"b + 1","b":"a + 1"},"root":{"type":"divider"}}"""))
        assertNull("cycles resolve to null", UiRuntime(cyclic, emptyMap()).lookup("a"))
        assertNull("no prototype names", UiRuntime(cyclic, emptyMap()).lookup("constructor"))
        assertTrue("no prototype datasets", UiRuntime(cyclic, emptyMap()).rows("constructor").isEmpty())
    }

    @Test fun derivedViewsSortLimitAndCount() {
        val spec = doc(Json.parseToJsonElement("""
            {"version":1,"state":{"min":2},
             "data":{"items":[{"name":"b","n":3},{"name":"a","n":1},{"name":"c","n":5},{"name":"a","n":2}]},
             "views":{
               "big":{"from":"items","filter":"n >= min","sort":{"field":"n","dir":"desc"},"limit":2},
               "byName":{"from":"items","groupBy":"name","aggregate":{"total":{"field":"n","op":"sum"},"count":{"op":"count"}},"sort":{"field":"name"}}
             },
             "root":{"type":"divider"}}
        """.trimIndent()))
        val rt = UiRuntime(spec, spec.state)
        assertEquals(listOf(5.0, 3.0), rt.rows("big").map { it["n"] })
        assertEquals(listOf("a", "b", "c"), rt.rows("byName").map { it["name"] })
        assertEquals(3.0, rt.rows("byName").first()["total"])
        assertEquals(2.0, rt.rows("byName").first()["count"])
        assertEquals(3.0, rt.safe("countOf('big') + 1"))
        assertEquals(4.0, rt.safe("avgOf('big', 'n')"))
    }

    @Test fun valuesFormatForSwissGerman() {
        assertEquals("5.5 %", formatUiValue(5.5, "percent"))
        assertEquals("Ja", formatUiValue(true))
        assertEquals("–", formatUiValue(null))
        assertTrue(formatUiValue(12500.0, "currency:CHF").contains("CHF"))
        assertEquals("CHF 1'299", formatUiValue(1299.0, "currency:CHF"))
        assertEquals("CHF 12.50", formatUiValue(12.5, "currency:CHF"))
        assertEquals("CHF-1'299", formatUiValue(-1299.0, "currency:CHF"))
        assertEquals("$ 1'300", formatUiValue(1299.5, "currency:USD"))
        assertEquals("-1'234'568", formatUiValue(-1234567.891, "integer"))
        assertEquals("3.46", formatUiValue(3.456))
        assertEquals("1'235", formatUiValue(1234.5))
        assertEquals("0.13", formatUiValue(0.125))
        assertEquals("1.1", formatUiValue(1.1, "decimal:1"))
        assertEquals("16", formatUiValue(16.0, "integer"))
        assertEquals("1.2 Mio.", formatUiValue(1234567.0, "compact"))
        assertEquals("12'500", formatUiValue(12500.0, "compact"))
        assertEquals("1234.6", formatUiValue(1234.56, "compact"))
        assertEquals("1 Mrd.", formatUiValue(999950000.0, "compact"))
        assertEquals("1.5 Mrd.", formatUiValue(1.5e9, "compact"))
        assertEquals("Nord", formatUiValue("Nord", "currency:CHF"))
        assertEquals("–", formatUiValue(Double.NaN))
        assertEquals("5", jsNumberString(5.0))
        assertEquals("0.1", jsNumberString(0.1))
        assertEquals("1e-7", jsNumberString(1e-7))
        assertEquals("1.5e+21", jsNumberString(1.5e21))
    }

    @Test fun stateValuesRoundTripThroughJson() {
        for (value in listOf(null, true, 3.5, "Süd")) assertEquals(value, uiValueOf(uiValueToJson(value)))
        assertEquals(JsonPrimitive(2.0), uiValueToJson(2.0))
        assertFalse(uiTruthy(0.0))
        assertFalse(uiTruthy(""))
    }
}
