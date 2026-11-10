package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.chat.MarkdownContent
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.PlumDarkPalette
import com.claudewebui.app.ui.theme.PlumLightPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.cos
import kotlin.math.sin

/**
 * Debug preview of every Dynamic UI v2 element with fixtures, including live
 * widgets with sample data, pending and failed states — the Android
 * counterpart of the WebUI's `/chat/ui-demo`. Reached without a login via
 * `claudewebui://preview-dynui` (`?theme=light|dark&section=<id>`).
 */
@Composable
fun DynamicUiDemoScreen(initialTheme: String? = null, initialSection: String? = null) {
    var dark by rememberSaveable { mutableStateOf(initialTheme != "light") }
    var section by rememberSaveable { mutableStateOf(initialSection?.takeIf { id -> DEMO_SECTIONS.any { it.id == id } } ?: "all") }
    val palette = if (dark) PlumDarkPalette else PlumLightPalette
    // The preview switches its own theme: system bar icons follow it while it is open.
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.DisposableEffect(dark) {
        val window = (view.context as? android.app.Activity)?.window
        val controller = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, view) }
        val status = controller?.isAppearanceLightStatusBars
        val navigation = controller?.isAppearanceLightNavigationBars
        controller?.isAppearanceLightStatusBars = !dark
        controller?.isAppearanceLightNavigationBars = !dark
        onDispose {
            if (controller != null && status != null && navigation != null) {
                controller.isAppearanceLightStatusBars = status
                controller.isAppearanceLightNavigationBars = navigation
            }
        }
    }
    CompositionLocalProvider(LocalPlumPalette provides palette, LocalDuiDemoImages provides true) {
        ClaudeWebUITheme(darkTheme = dark) {
            Box(Modifier.fillMaxSize().background(palette.background)) {
                DemoContent(dark, { dark = it }, section, { section = it })
                // Content scrolls under the status bar; a scrim keeps the clock readable.
                Box(
                    Modifier
                        .fillMaxWidth()
                        .windowInsetsTopHeight(WindowInsets.statusBars)
                        .background(palette.background.copy(alpha = .94f)),
                )
            }
        }
    }
}

private class DemoSection(val id: String, val title: String, val intro: String, val spec: String?, val followups: List<String> = emptyList())

private val DEMO_SECTIONS = listOf(
    DemoSection("layout", "Layout", "Tabs, Akkordeon, Karte mit Bild, Aktionen und Vollbild, KPI mit Veränderung und Mini-Linie.", LAYOUT_SPEC, listOf("Welches E-Bike passt für 30 km Arbeitsweg?", "Zeig mir günstigere Modelle")),
    DemoSection("content", "Inhalte", "Karussell, Zeitleiste, Fortschritt, Bild mit Lightbox, Hinweise, Code, Formel und [Ada Lovelace](entity:Ada_Lovelace) als Entitätslink.", CONTENT_SPEC),
    DemoSection("inputs", "Eingaben", "Formular mit Datum, Stepper, Auswahl, Häkchen und Freitext; Senden schickt eine Folgenachricht.", INPUTS_SPEC),
    DemoSection("learning", "Lernen und Pläne", "Rezept mit Portionen-Stepper, Checkliste (bleibt pro Nachricht gespeichert), Quiz und Lernkarten.", LEARNING_SPEC, listOf("Quiz mich zu den Monden", "Mach daraus ein vegetarisches Rezept")),
    DemoSection("charts", "Diagramme und Tabellen", "Zeitraum-Segment, Tooltip beim Tippen, Legende blendet Serien aus, Streudiagramm, Torte, sortierbare Tabelle mit Suche.", CHARTS_SPEC),
    DemoSection("live", "Live-Widgets", "Wetter, Wechselkurs, Aktie, Entität, Nachrichten und Bilder mit Beispieldaten.", LIVE_SPEC, listOf("Und morgen in Bern?", "Wie stand der Kurs vor einem Jahr?", "100 Franken in Euro")),
    DemoSection("states", "Zustände", "Platzhalter in Endgrösse, Fehler mit „Erneut versuchen“, lokal ersetzter defekter Baustein.", STATES_SPEC),
    DemoSection("widgets", "Eigene Kacheln", "Vom Modell geschriebene Kacheln (HTML, CSS, JS) in einer abgeschotteten WebView ohne Netz: Fokus-Timer, Regen-Würfel mit Live-Wetter, Hypothek-Rechner mit SVG-Diagramm und Memory. Der Zustand bleibt pro Nachricht gespeichert.", null, listOf("Wie lange sollten Pausen sein?", "Mach das Memory schwieriger")),
    DemoSection("selftest", "Selbsttest", "Validierung und Schlüssel gegen die Regeln aus packages/shared.", null),
)

@Composable
private fun DemoContent(dark: Boolean, setDark: (Boolean) -> Unit, section: String, setSection: (String) -> Unit) {
    val palette = LocalPlumPalette.current
    var lastEvent by remember { mutableStateOf<String?>(null) }
    var eventCount by remember { mutableIntStateOf(0) }
    var entity by remember { mutableStateOf<UiEntityRequest?>(null) }
    val scope = rememberCoroutineScope()
    var results by remember { mutableStateOf(demoResults()) }
    val store = remember { DynamicUiStateStore() }
    val host = DynamicUiHost(
        onPrefill = { eventCount++; lastEvent = "Eingabefeld: $it" },
        onOpenEntity = { title, lang -> entity = UiEntityRequest(title, lang) },
        onRefresh = { nodeId ->
            scope.launch {
                val type = results[nodeId]?.string("type") ?: return@launch
                results = results + (nodeId to JsonObject(results[nodeId]!! + ("status" to JsonPrimitive("pending"))))
                delay(1400)
                val resolved = demoResolved(type, results[nodeId]?.string("key").orEmpty())
                if (resolved != null) results = results + (nodeId to resolved)
            }
        },
    )
    val parentUri = LocalUriHandler.current
    val links = remember(parentUri) { DynamicUiUriHandler(parentUri) { entity = UiEntityRequest(it) } }
    // The rain tile's live input arrives later, like the server's socket push; long
    // enough after a cold WebView start that the tile shows pending first.
    LaunchedEffect(Unit) {
        delay(14_000)
        results = results + (WIDGET_RAIN_LIVE to envelope("weather", WIDGET_RAIN_KEY, "resolved", weatherFixture()))
    }
    val context = LocalContext.current
    Box(Modifier.fillMaxSize()) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        item(key = "header") {
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.dynamic_ui_demo_title), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = palette.text)
                    DuiSegmentBar(listOf(stringResource(R.string.dynamic_ui_demo_light), stringResource(R.string.dynamic_ui_demo_dark)), if (dark) 1 else 0, { setDark(it == 1) }, fill = false, small = true)
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (listOf("all" to stringResource(R.string.dynamic_ui_demo_all)) + DEMO_SECTIONS.map { it.id to it.title }).forEach { (id, title) ->
                        val active = id == section
                        Text(
                            title,
                            Modifier
                                .clip(CircleShape)
                                .background(if (active) palette.accent.copy(alpha = .22f) else palette.text.copy(alpha = .06f))
                                .border(1.dp, if (active) palette.accent.copy(alpha = .5f) else palette.duiEdge, CircleShape)
                                .clickable { setSection(id) }
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                            color = if (active) palette.text else palette.muted,
                        )
                    }
                }
                lastEvent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = palette.accent, maxLines = 2) }
            }
        }
        DEMO_SECTIONS.filter { section == "all" || it.id == section }.forEach { demo ->
            item(key = demo.id) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(demo.title.uppercase(), style = MaterialTheme.typography.labelMedium.copy(letterSpacing = .8.sp), fontWeight = FontWeight.SemiBold, color = palette.muted)
                    CompositionLocalProvider(LocalUriHandler provides links) { MarkdownContent(demo.intro, Modifier.fillMaxWidth()) }
                    if (demo.id == "widgets") {
                        val spec = remember { widgetDemoSpec(context) }
                        DynamicUi(
                            spec,
                            busy = false,
                            onSendMessage = { eventCount++; lastEvent = "Gesendet: $it" },
                            stateStore = store,
                            stateKey = "demo-${demo.id}",
                            results = results,
                            host = host,
                            memoryKey = "demo-${demo.id}",
                            animate = true,
                        )
                    } else if (demo.spec != null) {
                        val spec = remember(demo.id) { Json.parseToJsonElement(demo.spec) as JsonObject }
                        DynamicUi(
                            spec,
                            busy = false,
                            onSendMessage = { eventCount++; lastEvent = "Gesendet: $it" },
                            stateStore = store,
                            stateKey = "demo-${demo.id}",
                            results = results,
                            host = host,
                            memoryKey = "demo-${demo.id}",
                            animate = true,
                        )
                    } else DemoSelfTest()
                    if (demo.followups.isNotEmpty()) DynamicUiFollowups(demo.followups, enabled = true, onSelect = { eventCount++; lastEvent = "Folgefrage: $it" })
                }
                }
            }
        }
        item(key = "bottom") { Box(Modifier.navigationBarsPadding()) }
    }
    // The latest event also shows near the content, so actions far down the list stay visible.
    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(eventCount) { lastEvent?.let { toast = it; delay(4000); toast = null } }
    toast?.let { text ->
        Text(
            text,
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(16.dp)
                .clip(CircleShape)
                .background(palette.surfaceStrong)
                .border(1.dp, palette.accent.copy(alpha = .45f), CircleShape)
                .padding(horizontal = 14.dp, vertical = 9.dp),
            style = MaterialTheme.typography.bodySmall,
            color = palette.text,
            maxLines = 2,
        )
    }
    }
    entity?.let { request ->
        DynamicUiEntitySheet(request, load = { delay(700); demoEntityEnvelope(it.title) }) { entity = null }
    }
}

// ── Self-test ───────────────────────────────────────────────────────────────

@Composable
private fun DemoSelfTest() {
    val palette = LocalPlumPalette.current
    val checks = remember { runSelfTest() }
    val passed = checks.count { it.second }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).border(1.dp, palette.duiEdge, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            stringResource(R.string.dynamic_ui_demo_selftest, passed, checks.size),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = if (passed == checks.size) palette.duiPositive else palette.duiNegative,
        )
        checks.forEach { (name, ok) ->
            Text((if (ok) "✓ " else "✗ ") + name, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = if (ok) palette.muted else palette.duiNegative)
        }
    }
}

private fun parse(json: String): JsonElement = Json.parseToJsonElement(json)
private fun valid(json: String) = validateDynamicUi(parse(json)) is DynamicUiValidation.Valid
private fun root(node: String, extra: String = "") = """{"version":2,"state":{"n":1,"note":"","day":"","choice":"a","flag":false}$extra,"data":{"rows":[{"a":1}]},"root":$node}"""

/** Mirrors cases of packages/backend/scripts/dynamic-ui-v2-tests.ts. */
private fun runSelfTest(): List<Pair<String, Boolean>> {
    val out = ArrayList<Pair<String, Boolean>>()
    fun check(name: String, ok: Boolean) { out += name to ok }
    listOf("layout" to LAYOUT_SPEC, "content" to CONTENT_SPEC, "inputs" to INPUTS_SPEC, "learning" to LEARNING_SPEC, "charts" to CHARTS_SPEC, "live" to LIVE_SPEC).forEach { (name, spec) ->
        check("Fixture $name gültig", valid(spec))
    }
    check("Version 1 bleibt gültig", valid("""{"version":1,"root":{"type":"text","text":"Hallo"}}"""))
    check("Version 3 abgelehnt", !valid("""{"version":3,"root":{"type":"text","text":"Hallo"}}"""))
    check("Folgefragen erlaubt", valid("""{"version":2,"followups":["A?","B?"],"root":{"type":"divider"}}"""))
    check("Vier Folgefragen abgelehnt", !valid("""{"version":2,"followups":["a","b","c","d"],"root":{"type":"divider"}}"""))
    val invalid = listOf(
        "tabs: ein Tab" to """{"type":"tabs","tabs":[{"label":"A","children":[]}]}""",
        "tabs: Bindung an Text" to """{"type":"tabs","bind":"note","tabs":[{"label":"A","children":[]},{"label":"B","children":[]}]}""",
        "tabs: Eintrags-ID doppelt" to """{"type":"tabs","tabs":[{"id":"dup","label":"A","children":[{"type":"divider","id":"dup"}]},{"label":"B","children":[]}]}""",
        "accordion: leer" to """{"type":"accordion","items":[]}""",
        "carousel: ein Eintrag" to """{"type":"carousel","items":[{"title":"A"}]}""",
        "carousel: vier Meta" to """{"type":"carousel","items":[{"title":"A","meta":["1","2","3","4"]},{"title":"B"}]}""",
        "image: http" to """{"type":"image","src":"http://example.com/a.png","alt":"A"}""",
        "image: IP-Adresse" to """{"type":"image","src":"https://127.0.0.1/a.png","alt":"A"}""",
        "rating: 4.3" to """{"type":"rating","value":4.3}""",
        "list: unbekanntes Symbol" to """{"type":"list","items":[{"title":"A","icon":"rocketship"}]}""",
        "stepper: Text-State" to """{"type":"stepper","bind":"note","label":"S"}""",
        "date: Format" to """{"type":"date","bind":"day","label":"D","min":"2026-1-1"}""",
        "form: verschachtelt" to """{"type":"form","children":[{"type":"form","children":[{"type":"divider"}],"submit":{"label":"x","message":"y"}}],"submit":{"label":"x","message":"y"}}""",
        "checklist: ID doppelt" to """{"type":"checklist","id":"c","items":[{"id":"a","label":"A"},{"id":"a","label":"B"}]}""",
        "quiz: Antwortindex" to """{"type":"quiz","id":"q","questions":[{"q":"?","options":["a","b"],"answer":2}]}""",
        "quiz: Text mit Optionen" to """{"type":"quiz","id":"q","questions":[{"q":"?","kind":"text","options":["a","b"],"answer":"a"}]}""",
        "weather: ohne ID" to """{"type":"weather","location":"Bern"}""",
        "weather: 11 Tage" to """{"type":"weather","id":"w","location":"Bern","days":11}""",
        "currency: gleiche Währung" to """{"type":"currency","id":"c","from":"CHF","to":"CHF"}""",
        "stock: Zeitraum 3M" to """{"type":"stock","id":"s","symbol":"AAPL","range":"3M"}""",
        "entity: Sprachcode" to """{"type":"entity","id":"e","title":"A","lang":"evil.example/"}""",
        "button: openUrl http" to """{"type":"button","label":"x","action":{"type":"openUrl","url":"http://example.com"}}""",
        "card: drei Aktionen" to """{"type":"card","actions":[{"label":"a","action":{"type":"reset"}},{"label":"b","action":{"type":"reset"}},{"label":"c","action":{"type":"reset"}}],"children":[]}""",
        "chart: ranges ohne rangeBind" to """{"type":"chart","kind":"line","data":"rows","x":"a","series":[{"key":"a","label":"A"}],"ranges":[{"label":"1","value":1},{"label":"2","value":2}]}""",
    )
    invalid.forEach { (name, node) -> check("abgelehnt: $name", !valid(root(node))) }
    // v2.1 custom tiles (cases of packages/backend/scripts/dynamic-ui-v2-tests.ts)
    check("Kachel gültig", valid(root(WIDGET_TILE)))
    check("Kachel-Live-Eingabe belegt ihre ID", !valid(root("""{"type":"stack","children":[$WIDGET_TILE,{"type":"divider","id":"tile__zrh"}]}""")))
    val tiles = { n: Int -> (0 until n).joinToString(",") { """{"type":"widget","id":"t$it","html":"<p>$it</p>"}""" } }
    check("vier Kacheln erlaubt", valid(root("""{"type":"stack","children":[${tiles(4)}]}""")))
    check("fünf Kacheln abgelehnt", !valid(root("""{"type":"stack","children":[${tiles(5)}]}""")))
    listOf(
        "Kachel ohne Code" to """{"type":"widget","id":"empty","html":"  "}""",
        "Kachel-Code zu lang" to """{"type":"widget","id":"big","html":"${"x".repeat(60001)}"}""",
        "Kachel zu niedrig" to """{"type":"widget","id":"w","html":"<p>","height":20}""",
        "Kachel-Live unbekannt" to """{"type":"widget","id":"w","html":"<p>","live":{"a":{"type":"map"}}}""",
        "Kachel-Live ungültig" to """{"type":"widget","id":"w","html":"<p>","live":{"a":{"type":"currency","from":"EUR","to":"EUR"}}}""",
        "Kachel-Props als Liste" to """{"type":"widget","id":"w","html":"<p>","props":[1,2]}""",
    ).forEach { (name, node) -> check("abgelehnt: $name", !valid(root(node))) }
    val seven = (0 until 7).joinToString(",") { """{"type":"news","id":"n$it","query":"x"}""" }
    check("abgelehnt: sieben Live-Bausteine", !valid(root("""{"type":"stack","children":[$seven]}""")))
    // Recovery: a broken child becomes a muted note, the rest stays.
    val recovered = prepareDynamicUi(parse(root("""{"type":"stack","children":[{"type":"text","text":"ok"},{"type":"rating","value":9}]}""")))
    check("defekter Baustein lokal ersetzt", recovered is DynamicUiValidation.Valid && recovered.doc.root.objects("children").getOrNull(1)?.string("text") == UI_FALLBACK_TEXT)
    // Keys and helpers match the TypeScript ports.
    val a = uiLiveKey(parse("""{"type":"weather","id":"a","location":"  zürich,  Schweiz "}""") as JsonObject)
    val b = uiLiveKey(parse("""{"type":"weather","id":"b","location":"Zürich, Schweiz","days":7}""") as JsonObject)
    check("uiLiveKey Wetter normalisiert ($a)", a == b && a == "weather:zürich, schweiz:7")
    check("uiLiveKey Aktie", uiLiveKey(parse("""{"type":"stock","id":"a","symbol":"aapl"}""") as JsonObject) == "stock:AAPL:1M")
    check("uiLiveKey Entität", uiLiveKey(parse("""{"type":"entity","id":"e","title":"Ada  Lovelace"}""") as JsonObject) == "entity:de:ada_lovelace")
    check("uiLiveKey Währung", uiLiveKey(parse("""{"type":"currency","id":"c","from":"EUR","to":"CHF","amount":100}""") as JsonObject) == "currency:EUR:CHF:100")
    check("entity:-Link", parseUiEntityHref("entity:Albert_Einstein") == "Albert Einstein")
    check("Temperatur −3 °C / 26 °F", formatUiTemperature(-3.2) == "${MINUS}3 °C" && formatUiTemperature(-3.2, "f") == "26 °F")
    check("Veränderung +1.23 (+1.5 %)", formatUiChange(1.234, 1.5) == "+1.23 (+1.5 %)")
    check("Preis wie Vorlage", formatUiPriceLike(85.8, "CHF 85.85") == "CHF 85.80")
    return out
}

// ── Custom tiles ────────────────────────────────────────────────────────────

/** The validator fixture of the shared tests (`VALID.widget`). */
private const val WIDGET_TILE = """{"type":"widget","id":"tile","title":"Würfel","height":240,"html":"<button id=\"roll\">Würfeln</button><script>roll.onclick=()=>plum.setState({n:1})</script>","props":{"sides":6},"live":{"zrh":{"type":"weather","location":"Zürich","days":3}},"state":{"n":0}}"""

private val WIDGET_RAIN_LIVE = uiWidgetLiveId("regen", "wetter")
private const val WIDGET_RAIN_KEY = "weather:zürich:7"

/**
 * The four reference tiles of the WebUI demo, copied verbatim from
 * `packages/frontend/src/components/assistant/dynamic-ui/fixtures-widgets.ts`
 * into `assets/dynamic-ui/demo/`, with the prompts that asked for them.
 */
private fun widgetDemoSpec(context: android.content.Context): JsonObject {
    fun html(name: String) = context.assets.open("dynamic-ui/demo/$name.html").bufferedReader(Charsets.UTF_8).use { it.readText() }
    fun prompt(text: String) = buildJsonObject { put("type", "text"); put("text", "„$text“"); put("tone", "muted") }
    fun tile(id: String, title: String, extra: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}) = buildJsonObject {
        put("type", "widget"); put("id", id); put("title", title); put("html", html(id)); extra()
    }
    return buildJsonObject {
        put("version", 2)
        put("root", buildJsonObject {
            put("type", "stack")
            put("children", buildJsonArray {
                add(prompt("Bau mir einen Pomodoro-Timer mit 25/5-Rhythmus."))
                add(tile("pomodoro", "Fokus-Timer"))
                add(prompt("Werde ich bei meinem Spaziergang in Zürich nass?"))
                add(tile("regen", "Regen-Würfel") { put("live", buildJsonObject { put("wetter", buildJsonObject { put("type", "weather"); put("location", "Zürich") }) }) })
                add(prompt("Wie entwickelt sich eine Hypothek über 600 000 Franken?"))
                add(tile("hypothek", "Hypothek-Rechner") { put("props", buildJsonObject { put("amount", 600000); put("rate", 2.4); put("years", 25) }) })
                add(prompt("Ein Memory-Spiel mit Schweizer Sehenswürdigkeiten."))
                add(tile("memory", "Schweizer Memory"))
            })
        })
    }
}

// ── Live fixtures ───────────────────────────────────────────────────────────

private const val SOURCE_WEATHER = """{"name":"Open-Meteo","url":"https://open-meteo.com/"}"""

private fun envelope(type: String, key: String, status: String, data: JsonElement? = null, error: String? = null, retryable: Boolean? = null) = buildJsonObject {
    put("type", type)
    put("key", key)
    put("status", status)
    data?.let { put("data", it) }
    error?.let { put("error", it) }
    retryable?.let { put("retryable", it) }
    put("fetchedAt", "2026-11-07T14:15:00Z")
}

/** Envelopes for every live node of LIVE_SPEC and STATES_SPEC, keyed by node ID. */
private fun demoResults(): Map<String, JsonObject> {
    val out = HashMap<String, JsonObject>()
    out[WIDGET_RAIN_LIVE] = envelope("weather", WIDGET_RAIN_KEY, "pending")
    for (spec in listOf(LIVE_SPEC, STATES_SPEC)) {
        val root = (Json.parseToJsonElement(spec) as JsonObject)["root"] as JsonObject
        for (node in root.objects("children")) {
            val id = node.string("id") ?: continue
            val type = node.string("type") ?: continue
            val key = uiLiveKey(node) ?: continue
            out[id] = when (id) {
                "w_pending", "g_pending" -> envelope(type, key, "pending")
                "s_failed" -> envelope(type, key, "failed", error = "Kursdaten für XYZ.SW sind gerade nicht erreichbar.", retryable = true)
                "e_failed" -> envelope(type, key, "failed", error = "Kein Wikipedia-Artikel gefunden.", retryable = false)
                else -> demoResolved(type, key) ?: continue
            }
        }
    }
    return out
}

private fun demoResolved(type: String, key: String): JsonObject? = when (type) {
    "weather" -> envelope(type, key, "resolved", weatherFixture())
    "currency" -> envelope(type, key, "resolved", currencyFixture())
    "stock" -> envelope(type, key, "resolved", stockFixture())
    "entity" -> envelope(type, key, "resolved", entityFixture())
    "news" -> envelope(type, key, "resolved", newsFixture())
    "gallery" -> envelope(type, key, "resolved", galleryFixture())
    else -> null
}

private fun demoEntityEnvelope(title: String): JsonObject = envelope("entity", "entity:de:${title.lowercase().replace(' ', '_')}", "resolved", entityFixture())

private val HOUR_ICONS = listOf("partly-cloudy-day", "partly-cloudy-day", "cloudy", "showers", "rain", "rain", "cloudy", "partly-cloudy-night", "clear-night", "clear-night")

private fun weatherFixture(): JsonObject = buildJsonObject {
    put("location", buildJsonObject {
        put("name", "Zürich"); put("region", "Kanton Zürich"); put("country", "Schweiz"); put("country_code", "CH")
        put("latitude", 47.37); put("longitude", 8.55); put("timezone", "Europe/Zurich"); put("label", "Zürich, Schweiz")
    })
    put("current", buildJsonObject {
        put("time", "2026-11-07T14:15"); put("temperature_c", 8.4); put("feels_like_c", 6.1); put("humidity", 78); put("wind_kmh", 12)
        put("wind_direction_deg", 225); put("wind_direction_text", "SW"); put("precipitation_mm", 0); put("weather_code", 2)
        put("description", "Teilweise bewölkt"); put("icon", "partly-cloudy-day"); put("is_day", true)
        put("temperature_text", "8 °C"); put("feels_like_text", "Gefühlt 6 °C"); put("wind_text", "12 km/h SW"); put("humidity_text", "78 %")
    })
    put("hourly", buildJsonArray {
        for (h in 0 until 24) {
            val hour = (14 + h) % 24
            val temp = 6.0 + 3.2 * cos((hour - 15) / 24.0 * 2 * Math.PI) + if (h in 4..7) -0.8 else 0.0
            val chance = when (h) { in 3..7 -> 40 + h * 8; in 8..10 -> 25; else -> 5 }
            val night = hour >= 18 || hour < 7
            add(buildJsonObject {
                put("time", "2026-11-0${if (14 + h < 24) 7 else 8}T${hour.toString().padStart(2, '0')}:00")
                put("label", if (h == 0) "Jetzt" else "$hour Uhr")
                put("temperature_c", Math.round(temp * 10) / 10.0)
                put("precip_chance", chance)
                put("precipitation_mm", if (chance > 40) 0.6 else 0.0)
                put("weather_code", 2)
                put("description", "Teilweise bewölkt")
                put("icon", when { h in 3..6 -> HOUR_ICONS[3 + (h % 3)]; night -> if (h % 3 == 0) "partly-cloudy-night" else "clear-night"; else -> HOUR_ICONS[h % 3] })
                put("is_day", !night)
            })
        }
    })
    put("daily", buildJsonArray {
        val days = listOf(
            listOf("Heute", "Samstag", "7. Nov.", 9.6, 3.1, 60, "showers"),
            listOf("Morgen", "Sonntag", "8. Nov.", 7.2, 2.4, 85, "rain"),
            listOf("Mo", "Montag", "9. Nov.", 5.4, -0.6, 30, "snow-showers"),
            listOf("Di", "Dienstag", "10. Nov.", 6.8, -1.2, 5, "clear-day"),
            listOf("Mi", "Mittwoch", "11. Nov.", 8.9, 1.5, 10, "partly-cloudy-day"),
            listOf("Do", "Donnerstag", "12. Nov.", 10.4, 3.9, 20, "cloudy"),
            listOf("Fr", "Freitag", "13. Nov.", 11.8, 5.2, 70, "thunderstorm"),
        )
        days.forEachIndexed { index, d ->
            add(buildJsonObject {
                put("date", "2026-11-${(7 + index).toString().padStart(2, '0')}")
                put("label", d[0] as String); put("weekday", d[1] as String); put("date_text", d[2] as String)
                put("high_c", d[3] as Double); put("low_c", d[4] as Double); put("precip_chance", d[5] as Int)
                put("precipitation_mm", 1.2); put("weather_code", 3); put("description", "Wechselhaft"); put("icon", d[6] as String)
                put("sunrise", "07:21"); put("sunset", "16:57")
            })
        }
    })
    put("units", buildJsonObject { put("temperature", "°C"); put("wind", "km/h"); put("precipitation", "mm") })
    put("source", Json.parseToJsonElement(SOURCE_WEATHER))
}

private fun currencyFixture(): JsonObject = buildJsonObject {
    val rates = (0 until 22).map { i -> 0.9338 - i * 0.0009 + 0.0016 * sin(i * 0.9) }
    val rate = rates.last()
    put("from", "EUR"); put("to", "CHF"); put("from_name", "Euro"); put("to_name", "Schweizer Franken")
    put("amount", 100); put("rate", rate); put("inverse_rate", 1 / rate); put("converted", 100 * rate)
    put("date", "2026-11-06"); put("amount_text", "EUR 100.00"); put("converted_text", "CHF ${formatUiNumber(100 * rate)}")
    put("rate_text", "1 EUR = ${formatUiNumber(rate, 4)} CHF"); put("inverse_rate_text", "1 CHF = ${formatUiNumber(1 / rate, 4)} EUR")
    put("date_text", "Referenzkurs der EZB vom 6. Nov. 2026")
    val change = (rate - rates.first()) / rates.first() * 100
    put("change_percent", change); put("change_text", "${formatUiPercentChange(change)} in 30 Tagen"); put("change_tone", if (change < 0) "negative" else "positive")
    put("series", buildJsonArray { rates.forEachIndexed { i, r -> add(buildJsonObject { put("date", "2026-10-${(8 + i).coerceAtMost(31).toString().padStart(2, '0')}"); put("rate", r) }) } })
    put("source", buildJsonObject { put("name", "Frankfurter (EZB)"); put("url", "https://www.frankfurter.app/") })
}

private fun walk(count: Int, start: Double, drift: Double, seed: Int): List<Double> {
    val random = java.util.Random(seed.toLong())
    var value = start
    return (0 until count).map { value *= 1 + drift + random.nextGaussian() * 0.011; value }
}

private fun stockRange(points: List<Double>, label: (Int) -> String): JsonObject = buildJsonObject {
    val start = points.first()
    val end = points.last()
    val change = end - start
    put("points", buildJsonArray { points.forEachIndexed { i, close -> add(buildJsonObject { put("date", label(i)); put("close", Math.round(close * 100) / 100.0) }) } })
    put("start", start); put("end", end); put("change", change); put("change_percent", change / start * 100)
    put("change_text", formatUiChange(change, change / start * 100)); put("change_tone", if (change >= 0) "positive" else "negative")
    put("high", points.max()); put("low", points.min())
}

private fun day(offset: Int): String = java.time.LocalDate.of(2026, 11, 6).minusDays(offset.toLong()).toString()

private fun stockFixture(): JsonObject = buildJsonObject {
    val year = walk(252, 79.5, 0.00032, 7)
    val five = walk(260, 98.0, -0.0006, 11)
    val price = year.last()
    put("symbol", "NESN.SW"); put("name", "Nestlé"); put("exchange", "SIX"); put("currency", "CHF")
    put("price", price); put("price_text", "CHF ${formatUiNumber(price)}"); put("previous_close", price + 1.12)
    put("change", -1.12); put("change_percent", -1.12 / (price + 1.12) * 100); put("change_text", formatUiChange(-1.12, -1.12 / (price + 1.12) * 100)); put("change_tone", "negative")
    put("trade_date", "2026-11-06"); put("trade_date_text", "Schlusskurs vom 6. Nov. 2026")
    put("metrics", buildJsonArray {
        listOf("open" to "Eröffnung", "high" to "Tageshoch", "low" to "Tagestief", "previous_close" to "Vortag", "volume" to "Volumen", "year_high" to "52W-Hoch").forEachIndexed { i, (k, l) ->
            add(buildJsonObject { put("key", k); put("label", l); put("value", price + i - 2); put("value_text", if (k == "volume") "4.2 Mio." else formatUiNumber(price + i - 2.0)) })
        }
    })
    put("ranges", buildJsonObject {
        put("1M", stockRange(year.takeLast(22)) { day(21 - it) })
        put("6M", stockRange(year.takeLast(126)) { day(125 - it) })
        put("1Y", stockRange(year) { day(251 - it) })
        put("5Y", stockRange(five + listOf(price)) { day((260 - it) * 7) })
    })
    put("default_range", "1Y")
    put("source", buildJsonObject { put("name", "Stooq"); put("url", "https://stooq.com/") })
}

private fun entityFixture(): JsonObject = buildJsonObject {
    put("title", "Ada_Lovelace"); put("display_title", "Ada Lovelace"); put("description", "britische Mathematikerin")
    put("extract", "Augusta Ada King, Countess of Lovelace (1815–1852), war eine britische Mathematikerin. Sie gilt als erste Programmiererin: Für Charles Babbages Analytical Engine beschrieb sie 1843 einen Algorithmus zur Berechnung der Bernoulli-Zahlen und erkannte, dass die Maschine mehr als nur Zahlen verarbeiten könnte.")
    put("lang", "de"); put("url", "https://de.wikipedia.org/wiki/Ada_Lovelace")
    put("image", buildJsonObject { put("src", "https://upload.wikimedia.org/ada-lovelace.jpg"); put("width", 330); put("height", 412); put("alt", "Ada Lovelace") })
    put("original_image", "https://upload.wikimedia.org/ada-lovelace-full.jpg")
    put("kind", "standard")
    put("source", buildJsonObject { put("name", "Wikipedia"); put("url", "https://de.wikipedia.org/wiki/Ada_Lovelace") })
}

private fun newsFixture(): JsonObject = buildJsonObject {
    put("query", "Nestlé")
    put("articles", buildJsonArray {
        listOf(
                Triple("Nestlé senkt Prognose und kündigt Sparprogramm an", "srf.ch", "vor 3 Std."),
                Triple("Was der neue Chef mit dem Konzern vorhat", "nzz.ch", "gestern"),
                Triple("Kaffee bleibt der Wachstumstreiber", "handelszeitung.ch", "6. Nov."),
                Triple("Analysten sehen Erholungspotenzial bei der Aktie", "finews.ch", "5. Nov."),
                Triple("Vevey: Neues Forschungszentrum eröffnet", "rts.ch", "4. Nov."),
        ).forEachIndexed { i, (title, source, date) ->
            add(buildJsonObject {
                put("title", title); put("url", "https://www.$source/news/$i"); put("source", source); put("date_text", date)
                put("excerpt", "Kurzfassung des Artikels.")
                if (i != 3) put("image", "https://images.plum.example/news-$i.jpg")
            })
        }
    })
    put("source", buildJsonObject { put("name", "SearXNG"); put("url", "https://docs.searxng.org/") })
}

private fun galleryFixture(): JsonObject = buildJsonObject {
    put("query", "Matterhorn")
    put("images", buildJsonArray {
        repeat(9) { i ->
            add(buildJsonObject {
                put("src", "https://images.plum.example/matterhorn-$i.jpg"); put("thumbnail", "https://images.plum.example/matterhorn-$i-thumb.jpg")
                put("title", "Matterhorn ${listOf("im Morgenlicht", "vom Riffelsee", "im Winter", "Nordwand", "bei Nacht", "mit Wolken", "vom Gornergrat", "im Sommer", "Panorama")[i]}")
                put("page_url", "https://commons.wikimedia.org/wiki/File:Matterhorn_$i.jpg"); put("source", "commons.wikimedia.org")
                put("width", 1600); put("height", 1200)
            })
        }
    })
    put("source", buildJsonObject { put("name", "SearXNG"); put("url", "https://docs.searxng.org/") })
}

// ── Spec fixtures ───────────────────────────────────────────────────────────

private const val LAYOUT_SPEC = """
{"version":2,"title":"E-Bikes im Vergleich","state":{"tab":0},
 "data":{"trend":[{"m":"Jan","v":12},{"m":"Feb","v":15},{"m":"Mär","v":14},{"m":"Apr","v":19},{"m":"Mai","v":23},{"m":"Jun","v":26}]},
 "root":{"type":"stack","children":[
  {"type":"tabs","id":"bikes","bind":"tab","tabs":[
   {"label":"Pendeln","children":[
    {"type":"card","title":"Stromer ST3","subtitle":"Schnell und robust für den Arbeitsweg","image":{"src":"https://images.plum.example/stromer.jpg","alt":"Stromer ST3"},"expandable":true,
     "actions":[{"label":"Mehr dazu","action":{"type":"sendMessage","text":"Erzähl mir mehr über den Stromer ST3"}},{"label":"Vergleichen","variant":"secondary","action":{"type":"prefill","text":"Vergleiche den Stromer ST3 mit "}}],
     "children":[{"type":"rating","value":4.5,"count":1284,"label":"Testberichte"},{"type":"text","text":"45 km/h, 814-Wh-Akku, bis 180 km Reichweite.","tone":"muted"}]}
   ]},
   {"label":"Touren","children":[
    {"type":"list","items":[
     {"title":"Riese & Müller Delite","subtitle":"Vollgefedert, 1250 Wh","trailing":"CHF 7'990","icon":"bike","action":{"type":"openUrl","url":"https://www.r-m.de/"}},
     {"title":"Cube Stereo Hybrid","subtitle":"Leicht im Gelände","trailing":"CHF 4'290","icon":"🚵"},
     {"title":"Flyer Goroc","subtitle":"Schweizer Marke","trailing":"CHF 5'490","icon":"star","action":{"type":"openEntity","title":"Flyer (Fahrradhersteller)"}}
    ]}
   ]},
   {"label":"Stadt","children":[{"type":"callout","tone":"tip","title":"Tipp","text":"In der Stadt reicht oft ein 400-Wh-Akku – leichter und günstiger."}]}
  ]},
  {"type":"accordion","items":[
   {"title":"Was kostet ein guter Akku?","open":true,"children":[{"type":"text","text":"Ersatzakkus kosten 600 bis 1'000 Franken und halten 800 bis 1'000 Ladezyklen."}]},
   {"title":"Wie oft muss ich laden?","children":[{"type":"text","text":"Bei 20 km pro Tag etwa zweimal pro Woche."}]},
   {"title":"Brauche ich eine Versicherung?","children":[{"type":"text","text":"Eine Velo-Versicherung deckt Diebstahl und Schäden ab."}]}
  ]},
  {"type":"grid","columns":2,"children":[
   {"type":"kpi","label":"Verkäufe","value":"26","format":"integer","delta":"3","spark":"trend"},
   {"type":"kpi","label":"Rückgaben","value":"2.4","format":"percent","delta":"-0.6","deltaFormat":"percent","hint":"Vormonat 3 %"}
  ]}
 ]}}
"""

private const val CONTENT_SPEC = """
{"version":2,"root":{"type":"stack","children":[
 {"type":"carousel","aspect":"4:3","items":[
  {"title":"Zermatt","subtitle":"Matterhorn-Blick und autofrei","meta":["2 h 30 min","ab CHF 89"],"badge":"Beliebt","image":{"src":"https://images.plum.example/zermatt.jpg","alt":"Zermatt"},"action":{"type":"sendMessage","text":"Plane einen Tag in Zermatt"}},
  {"title":"Lauterbrunnen","subtitle":"72 Wasserfälle","meta":["1 h 50 min","ab CHF 54"],"image":{"src":"https://images.plum.example/lauterbrunnen.jpg","alt":"Lauterbrunnen"}},
  {"title":"Lugano","subtitle":"Seepromenade und Palmen","meta":["2 h 05 min"],"image":{"src":"https://images.plum.example/lugano.jpg","alt":"Lugano"}},
  {"title":"Appenzell","subtitle":"Alpstein und Käse","meta":["1 h 15 min"],"image":{"src":"https://images.plum.example/appenzell.jpg","alt":"Appenzell"}}
 ]},
 {"type":"timeline","items":[
  {"time":"08:02","title":"Abfahrt Zürich HB","text":"Gleis 13, IC 8","status":"done"},
  {"time":"10:34","title":"Umsteigen in Visp","text":"Matterhorn Gotthard Bahn","status":"current"},
  {"time":"11:44","title":"Ankunft Zermatt","status":"upcoming"},
  {"time":"13:00","title":"Gornergrat","text":"Zahnradbahn auf 3089 m","status":"upcoming"}
 ]},
 {"type":"row","children":[
  {"type":"progress","value":"68","label":"Sparziel","kind":"bar"},
  {"type":"progress","value":"3","max":"4","label":"Etappen geschafft","kind":"ring"}
 ]},
 {"type":"image","src":"https://images.plum.example/matterhorn.jpg","alt":"Matterhorn im Morgenlicht","caption":"Matterhorn im Morgenlicht – tippen öffnet die Lightbox","aspect":"16:9"},
 {"type":"callout","tone":"info","text":"Züge nach Zermatt fahren im Stundentakt."},
 {"type":"callout","tone":"success","title":"Gebucht","text":"Dein Ticket ist bestätigt."},
 {"type":"callout","tone":"warning","text":"Am Wochenende sind die Bergbahnen voll."},
 {"type":"callout","tone":"danger","title":"Lawinengefahr","text":"Stufe 3 oberhalb von 2200 m."},
 {"type":"code","language":"kotlin","title":"Beispiel","code":"fun greet(name: String) =\n    println(\"Grüezi, \" + name)"},
 {"type":"math","tex":"E = mc^2 \\quad \\frac{a+b}{2} \\geq \\sqrt{ab}","display":true},
 {"type":"button","label":"Route kopieren","variant":"secondary","action":{"type":"copy","text":"Zürich HB 08:02 → Visp → Zermatt 11:44"}}
]}}
"""

private const val INPUTS_SPEC = """
{"version":2,"state":{"day":"2026-11-21","people":2,"klass":"2","note":"","window":true},
 "root":{"type":"form","title":"Reise anfragen","children":[
  {"type":"date","bind":"day","label":"Reisedatum","min":"2026-11-07","max":"2027-06-30"},
  {"type":"stepper","bind":"people","label":"Personen","min":1,"max":9},
  {"type":"radio","bind":"klass","label":"Klasse","options":[{"value":"1","label":"1. Klasse"},{"value":"2","label":"2. Klasse"}]},
  {"type":"checkbox","bind":"window","label":"Fensterplatz"},
  {"type":"textarea","bind":"note","label":"Wünsche","rows":3,"placeholder":"z. B. Velo mitnehmen"}
 ],"submit":{"label":"Verbindungen suchen","message":"Suche Verbindungen am {{day}} für {{people|integer}} Personen in der {{klass}}. Klasse"}}}
"""

private const val LEARNING_SPEC = """
{"version":2,"state":{"servings":4},
 "root":{"type":"stack","children":[
  {"type":"heading","text":"Risotto für {{servings|integer}} Personen"},
  {"type":"stepper","bind":"servings","label":"Portionen","min":1,"max":12},
  {"type":"checklist","id":"ingredients","title":"Zutaten","copyable":true,"items":[
   {"id":"rice","label":"{{servings*80|integer}} g Risottoreis","detail":"Carnaroli oder Arborio"},
   {"id":"broth","label":"{{servings*250|integer}} ml Gemüsebrühe","detail":"heiss halten"},
   {"id":"onion","label":"{{max(1, round(servings/2))|integer}} Zwiebel"},
   {"id":"wine","label":"{{servings*30|integer}} ml Weisswein"},
   {"id":"parm","label":"{{servings*20|integer}} g Parmesan"},
   {"id":"butter","label":"{{servings*10|integer}} g Butter"}
  ]},
  {"type":"quiz","id":"planets","title":"Planeten-Quiz","questions":[
   {"q":"Welcher Planet ist der grösste im Sonnensystem?","options":["Mars","Jupiter","Saturn","Neptun"],"answer":1,"hint":"Ein Gasriese mit dem Grossen Roten Fleck.","explanation":"Jupiter hat mehr als die doppelte Masse aller anderen Planeten zusammen."},
   {"q":"Wie heisst der rote Planet?","kind":"text","answer":"Mars","hint":"Benannt nach dem römischen Kriegsgott."},
   {"q":"Welcher Planet hat die meisten bekannten Monde?","options":["Erde","Jupiter","Saturn"],"answer":2,"explanation":"Saturn hat über 140 bestätigte Monde."}
  ]},
  {"type":"flashcards","id":"capitals","cards":[
   {"front":"Schweiz","back":"Bern – Bundesstadt seit 1848"},
   {"front":"Australien","back":"Canberra"},
   {"front":"Kanada","back":"Ottawa"},
   {"front":"Brasilien","back":"Brasília"},
   {"front":"Japan","back":"Tokio"}
  ]}
 ]}}
"""

private const val CHARTS_SPEC = """
{"version":2,"state":{"period":6},
 "data":{
  "sales":[{"m":1,"label":"Jan","online":4200,"store":3100},{"m":2,"label":"Feb","online":3900,"store":2900},{"m":3,"label":"Mär","online":4600,"store":3300},{"m":4,"label":"Apr","online":5100,"store":3500},{"m":5,"label":"Mai","online":5600,"store":3400},{"m":6,"label":"Jun","online":6100,"store":3600},{"m":7,"label":"Jul","online":5800,"store":3900},{"m":8,"label":"Aug","online":6400,"store":4100},{"m":9,"label":"Sep","online":6900,"store":3800},{"m":10,"label":"Okt","online":7200,"store":4000},{"m":11,"label":"Nov","online":7900,"store":4400},{"m":12,"label":"Dez","online":9100,"store":5200}],
  "points":[{"x":1.2,"y":2.1},{"x":2.0,"y":2.9},{"x":2.6,"y":3.1},{"x":3.1,"y":4.2},{"x":3.8,"y":4.0},{"x":4.4,"y":5.3},{"x":5.0,"y":5.1},{"x":5.7,"y":6.4},{"x":6.3,"y":6.0},{"x":7.1,"y":7.4},{"x":7.8,"y":7.1},{"x":8.6,"y":8.8}]
 },
 "views":{"recent":{"from":"sales","filter":"m > 12 - period"}},
 "root":{"type":"stack","children":[
  {"type":"chart","kind":"area","data":"recent","x":"label","series":[{"key":"online","label":"Online"},{"key":"store","label":"Filiale"}],"format":"currency:CHF","ranges":[{"label":"3M","value":3},{"label":"6M","value":6},{"label":"1J","value":12}],"rangeBind":"period","height":220},
  {"type":"chart","kind":"bar","data":"sales","x":"label","series":[{"key":"online","label":"Online"},{"key":"store","label":"Filiale"}],"stacked":true,"height":200},
  {"type":"chart","kind":"scatter","data":"points","x":"x","series":[{"key":"y","label":"Messwert"}],"height":200},
  {"type":"chart","kind":"pie","data":[{"k":"Miete","v":1850},{"k":"Essen","v":720},{"k":"Mobilität","v":310},{"k":"Freizeit","v":420}],"x":"k","series":[{"key":"v","label":"Ausgaben"}],"format":"currency:CHF","height":200},
  {"type":"table","data":"sales","columns":[{"key":"label","label":"Monat"},{"key":"online","label":"Online","format":"currency:CHF"},{"key":"store","label":"Filiale","format":"currency:CHF"}],"highlight":"online > 7000"}
 ]}}
"""

private const val LIVE_SPEC = """
{"version":2,"root":{"type":"stack","children":[
 {"type":"weather","id":"w1","location":"Zürich","days":7},
 {"type":"currency","id":"fx","from":"EUR","to":"CHF","amount":100},
 {"type":"stock","id":"nesn","symbol":"NESN.SW","range":"1Y"},
 {"type":"entity","id":"ada","title":"Ada Lovelace"},
 {"type":"news","id":"news","query":"Nestlé"},
 {"type":"gallery","id":"pics","query":"Matterhorn"}
]}}
"""

private const val STATES_SPEC = """
{"version":2,"root":{"type":"stack","children":[
 {"type":"weather","id":"w_pending","location":"Bern","days":5},
 {"type":"stock","id":"s_failed","symbol":"XYZ.SW"},
 {"type":"entity","id":"e_failed","title":"Unbekannter Ort"},
 {"type":"gallery","id":"g_pending","query":"Aletschgletscher"},
 {"type":"text","text":"Darunter ein Baustein, den der Client lokal ersetzt:"},
 {"type":"rating","value":9}
]}}
"""
