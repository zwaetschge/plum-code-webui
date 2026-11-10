package com.claudewebui.app.ui.components.dynamicui

import com.claudewebui.app.ui.theme.PlumDarkPalette
import com.claudewebui.app.ui.theme.PlumLightPalette
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Custom tiles (Dynamic UI v2.1): the Kotlin validator must accept and reject
 * the same `widget` nodes as packages/shared (cases of
 * packages/backend/scripts/dynamic-ui-v2-tests.ts), and the WebView host must
 * validate every frame message like the WebUI host.
 */
class DynamicUiWidgetTest {
    private val tile = """{"type":"widget","id":"tile","title":"Würfel","height":240,"html":"<button id=\"roll\">Würfeln</button><script>roll.onclick=()=>plum.setState({n:1})</script>","props":{"sides":6},"live":{"zrh":{"type":"weather","location":"Zürich","days":3}},"state":{"n":0}}"""

    private fun spec(root: String) = Json.parseToJsonElement("""{"version":2,"root":$root}""")
    private fun valid(root: String) = validateDynamicUi(spec(root)) is DynamicUiValidation.Valid
    private fun error(root: String) = (validateDynamicUi(spec(root)) as? DynamicUiValidation.Invalid)?.error.orEmpty()
    private fun tiles(count: Int) = (0 until count).joinToString(",") { """{"type":"widget","id":"t$it","html":"<p>$it</p>"}""" }

    @Test fun aValidTileAndItsLiveInputsPass() {
        assertTrue(valid(tile))
        assertTrue(valid("""{"type":"stack","children":[${tiles(4)}]}"""))
        // Tiles may stand next to catalog components.
        assertTrue(valid("""{"type":"stack","children":[$tile,{"type":"text","text":"Darunter"}]}"""))
    }

    @Test fun brokenTilesAreRejectedLikeInShared() {
        assertTrue(error("""{"type":"widget","id":"empty","html":"  "}""").contains("Code fehlt"))
        assertTrue(error("""{"type":"widget","id":"big","html":"${"x".repeat(60001)}"}""").contains("60000"))
        assertTrue(valid("""{"type":"widget","id":"big","html":"${"x".repeat(60000)}"}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","height":20}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","height":1201}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","height":240.5}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","live":{"a":{"type":"map"}}}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","live":{"a":{"type":"currency","from":"EUR","to":"EUR"}}}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","props":[1,2]}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","state":"x"}"""))
        assertFalse(valid("""{"type":"widget","html":"<p>"}"""))
        assertFalse(valid("""{"type":"widget","id":"w"}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","title":""}"""))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","title":"${"t".repeat(81)}"}"""))
    }

    @Test fun payloadsAndLiveInputsAreBounded() {
        val big = "\"k\":\"${"v".repeat(16000)}\""
        assertTrue(error("""{"type":"widget","id":"w","html":"<p>","props":{$big}}""").contains("16000"))
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","state":{$big}}"""))
        val five = (0 until 5).joinToString(",") { """"n$it":{"type":"news","query":"x"}""" }
        assertTrue(error("""{"type":"widget","id":"w","html":"<p>","live":{$five}}""").contains("Live-Daten"))
        // NAME keys only; the namespaced id must still be a valid ID (≤ 40 characters).
        assertFalse(valid("""{"type":"widget","id":"w","html":"<p>","live":{"bad-name":{"type":"news","query":"x"}}}"""))
        val longId = "a".repeat(30)
        assertTrue(error("""{"type":"widget","id":"$longId","html":"<p>","live":{"wetter_morgen":{"type":"weather","location":"Bern"}}}""").contains("zu lang"))
    }

    @Test fun moreThanFourTilesAreRejected() {
        assertTrue(error("""{"type":"stack","children":[${tiles(5)}]}""").contains("eigene Kacheln"))
    }

    @Test fun liveInputsShareTheIdNamespaceAndTheLiveLimit() {
        // tile__zrh is taken by the tile's input.
        assertTrue(error("""{"type":"stack","children":[$tile,{"type":"divider","id":"tile__zrh"}]}""").contains("ID doppelt"))
        // 4 stand-alone live widgets + 3 tile inputs = 7 > 6.
        val news = (0 until 4).joinToString(",") { """{"type":"news","id":"n$it","query":"x"}""" }
        val inputs = (0 until 3).joinToString(",") { """"i$it":{"type":"news","query":"x"}""" }
        assertTrue(error("""{"type":"stack","children":[$news,{"type":"widget","id":"w","html":"<p>","live":{$inputs}}]}""").contains("Live-Bausteine"))
        val nodes = uiWidgetLiveNodes(Json.parseToJsonElement(tile) as JsonObject)
        assertEquals(listOf("zrh"), nodes.map { it.first })
        assertEquals("tile__zrh", nodes.single().second.string("id"))
        assertEquals("weather", nodes.single().second.string("type"))
        assertEquals(uiLiveKey(Json.parseToJsonElement("""{"type":"weather","id":"x","location":"Zürich","days":3}""") as JsonObject), uiLiveKey(nodes.single().second))
    }

    @Test fun aBrokenTileBecomesTheMutedFallback() {
        val result = prepareDynamicUi(spec("""{"type":"stack","children":[{"type":"text","text":"ok"},{"type":"widget","id":"w","html":" "}]}"""))
        assertTrue(result is DynamicUiValidation.Valid)
        val children = (result as DynamicUiValidation.Valid).doc.root.objects("children")
        assertEquals("ok", children[0].string("text"))
        assertEquals(UI_FALLBACK_TEXT, children[1].string("text"))
    }

    // ── Frame messages ──────────────────────────────────────────────────────

    private val names = setOf("wetter")
    private fun msg(json: String) = parseWidgetMessage(json, names)


    @Test fun frameMessagesAreValidated() {
        assertEquals(WidgetMessage.Ready, msg("""{"plum":"ready"}"""))
        assertEquals(WidgetMessage.Rendered, msg("""{"plum":"rendered"}"""))
        assertEquals(WidgetMessage.Height(321), msg("""{"plum":"height","value":320.2}"""))
        assertNull(msg("""{"plum":"height","value":"320"}"""))
        assertNull(msg("""{"plum":"height","value":-1}"""))
        assertEquals(WidgetMessage.SendMessage("Hallo"), msg("""{"plum":"sendMessage","text":"  Hallo "}"""))
        assertNull(msg("""{"plum":"sendMessage","text":"   "}"""))
        assertNull(msg("""{"plum":"sendMessage","text":"${"x".repeat(2001)}"}"""))
        assertNull(msg("""{"plum":"sendMessage","text":42}"""))
        assertEquals(WidgetMessage.Copy("a"), msg("""{"plum":"copy","text":"a"}"""))
        assertNull(msg("""{"plum":"copy","text":"${"x".repeat(20001)}"}"""))
        assertEquals(WidgetMessage.OpenUrl("https://open-meteo.com/"), msg("""{"plum":"openUrl","url":"https://open-meteo.com/"}"""))
        assertNull(msg("""{"plum":"openUrl","url":"http://open-meteo.com/"}"""))
        assertNull(msg("""{"plum":"openUrl","url":"https://127.0.0.1/"}"""))
        assertNull(msg("""{"plum":"openUrl","url":"javascript:alert(1)"}"""))
        assertEquals(WidgetMessage.OpenEntity("Matterhorn", null), msg("""{"plum":"openEntity","title":"Matterhorn"}"""))
        assertEquals(WidgetMessage.OpenEntity("Matterhorn", "en"), msg("""{"plum":"openEntity","title":"Matterhorn","lang":"en"}"""))
        assertNull(msg("""{"plum":"openEntity","title":"Matterhorn","lang":"evil.example/"}"""))
        assertEquals(WidgetMessage.Refresh("wetter"), msg("""{"plum":"refresh","name":"wetter"}"""))
        assertNull(msg("""{"plum":"refresh","name":"other"}"""))
        assertEquals(WidgetMessage.Display(true), msg("""{"plum":"display","value":"fullscreen"}"""))
        assertEquals(WidgetMessage.Display(false), msg("""{"plum":"display","value":"inline"}"""))
        assertNull(msg("""{"plum":"display","value":"pip"}"""))
        assertEquals(WidgetMessage.Image(3, "https://upload.wikimedia.org/a.jpg"), msg("""{"plum":"image","id":3,"url":"https://upload.wikimedia.org/a.jpg"}"""))
        assertNull(msg("""{"plum":"image","id":1.5,"url":"https://upload.wikimedia.org/a.jpg"}"""))
        assertNull(msg("""{"plum":"image","id":1,"url":"https://localhost/a.jpg"}"""))
        assertEquals(WidgetMessage.Error("x".repeat(300)), msg("""{"plum":"error","message":"${"x".repeat(400)}"}"""))
        // Unknown, malformed or oversized messages are ignored.
        assertNull(msg("""{"plum":"eval","code":"1"}"""))
        assertNull(msg("""["ready"]"""))
        assertNull(msg("""not json"""))
        assertNull(msg("""{"type":"ready"}"""))
        assertNull(msg("""{"plum":"ready","pad":"${"x".repeat(80_000)}"}"""))
    }

    @Test fun stateIsAnObjectOfAtMost32Kb() {
        val ok = msg("""{"plum":"state","value":{"n":1,"deck":[1,2,3]}}""")
        assertTrue(ok is WidgetMessage.State)
        assertEquals(1, (ok as WidgetMessage.State).value["n"]!!.jsonPrimitive.content.toInt())
        assertNull(msg("""{"plum":"state","value":[1]}"""))
        assertNull(msg("""{"plum":"state","value":{"k":"${"x".repeat(33_000)}"}}"""))
    }

    // ── Host side ───────────────────────────────────────────────────────────

    @Test fun inlineHeightUsesTheTileHeightOrClampsTheReportedOne() {
        assertEquals(240, widgetInlineHeight(240, 900))
        assertEquals(60, widgetInlineHeight(null, 12))
        assertEquals(412, widgetInlineHeight(null, 412))
        assertEquals(900, widgetInlineHeight(null, 2400))
        assertNull(widgetInlineHeight(null, null))
    }

    @Test fun messagesAreRateLimitedToOneEveryThreeSeconds() {
        assertTrue(widgetSendAllowed(1_000, 0))
        assertFalse(widgetSendAllowed(3_999, 1_000))
        assertTrue(widgetSendAllowed(4_000, 1_000))
    }

    @Test fun liveInputsReadTheNamespacedResults() {
        val node = Json.parseToJsonElement(tile) as JsonObject
        val key = uiLiveKey(uiWidgetLiveNodes(node).single().second)!!
        assertEquals("""{"zrh":{"status":"pending"}}""", widgetLive(node, emptyMap()).toString())
        val resolved = Json.parseToJsonElement("""{"type":"weather","key":"$key","status":"resolved","data":{"current":{"temperature_c":8}}}""") as JsonObject
        val live = widgetLive(node, mapOf("tile__zrh" to resolved))["zrh"] as JsonObject
        assertEquals("resolved", live.string("status"))
        assertEquals("8", ((live["data"] as JsonObject)["current"] as JsonObject)["temperature_c"]!!.jsonPrimitive.content)
        // A result for other parameters (stale key) does not apply.
        val stale = JsonObject(resolved + ("key" to JsonPrimitive("weather:bern:3")))
        assertEquals("pending", (widgetLive(node, mapOf("tile__zrh" to stale))["zrh"] as JsonObject).string("status"))
        val failed = Json.parseToJsonElement("""{"type":"weather","key":"$key","status":"failed","error":"Keine Daten","retryable":true}""") as JsonObject
        assertEquals("""{"status":"failed","error":"Keine Daten","retryable":true}""", widgetLive(node, mapOf("tile__zrh" to failed))["zrh"].toString())
    }

    @Test fun hostMessagesTravelAsOneJsonStringLiteral() {
        val message = Json.parseToJsonElement("""{"plum":"render","html":"<p class=\"x\">'Grüezi' \\ </script> </p>"}""") as JsonObject
        val script = widgetHostScript(message)
        assertTrue(script.startsWith("window.__plumHost&&window.__plumHost(\""))
        assertFalse(script.contains(" "))
        val literal = script.substringAfter("window.__plumHost(").removeSuffix(")")
        val decoded = Json.parseToJsonElement(literal).jsonPrimitive.content
        assertEquals(message, Json.parseToJsonElement(decoded))
    }

    @Test fun themeVariablesComeFromThePaletteWithDotDecimals() {
        val previous = Locale.getDefault()
        Locale.setDefault(Locale.GERMANY)
        try {
            val dark = widgetTheme(PlumDarkPalette)
            val light = widgetTheme(PlumLightPalette)
            assertEquals("dark", dark.string("mode"))
            assertEquals("light", light.string("mode"))
            val vars = dark["vars"] as JsonObject
            for (name in listOf("text", "muted", "surface", "surface-2", "border", "accent", "accent-text", "good", "bad", "warn", "chart-1", "chart-6", "radius", "font"))
                assertTrue("--plum-$name", vars.containsKey("--plum-$name"))
            assertEquals(widgetCssColor(PlumDarkPalette.accent), vars.string("--plum-accent"))
            assertTrue(vars.values.all { it.jsonPrimitive.content.length < 200 })
            assertTrue(vars.string("--plum-border")!!.matches(Regex("""rgba\(\d+, \d+, \d+, 0\.\d{3}\)""")))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test fun renderCarriesSavedStatePropsLiveAndDisplay() {
        val node = Json.parseToJsonElement(tile) as JsonObject
        val render = widgetRenderMessage(node, Json.parseToJsonElement("""{"n":3}""") as JsonObject, widgetLive(node, emptyMap()), widgetTheme(PlumDarkPalette), fullscreen = true)
        assertEquals("render", render.string("plum"))
        assertEquals(node.string("html"), render.string("html"))
        assertEquals("""{"sides":6}""", render["props"].toString())
        assertEquals("""{"n":3}""", render["state"].toString())
        assertEquals("fullscreen", render.string("display"))
    }
}
