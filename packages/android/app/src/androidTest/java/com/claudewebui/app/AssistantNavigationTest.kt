package com.claudewebui.app

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.ui.components.common.*
import com.claudewebui.app.ui.screens.dashboard.*
import com.claudewebui.app.ui.theme.*
import java.io.File
import java.net.ServerSocket
import java.net.InetAddress
import org.json.JSONObject
import org.json.JSONArray
import org.junit.*
import org.junit.Assert.*

/** Real Compose and Android WebView; HTTP stays inside an isolated on-device fixture. */
class AssistantNavigationTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var fixture: AssistantHttpFixture

    @Before fun setup() {
        fixture = AssistantHttpFixture()
        TokenStore.init(context)
        TokenStore.setServerUrl("http://localhost:${fixture.port}/mobile")
        TokenStore.setToken("native-ui-fixture-token")
        TokenStore.setUserId("native-ui-fixture-user")
        AppThemeStore.set(context, AppThemeOption.DARK)
    }
    @After fun cleanup() { fixture.close(); TokenStore.clearAll() }

    @Test fun selectorActionsDoNotOverlapAtDoubleFontSizeAndBottomMenuKeepsAllDestinations() {
        var scale by mutableStateOf(1f)
        var area by mutableStateOf("code")
        var palette by mutableStateOf(PlumDarkPalette)
        var personalized = false
        var destination: MainDestination? = null
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, scale), LocalPlumPalette provides palette) {
                NativeTestTheme {
                    PlumBackdrop {
                        Column(Modifier.fillMaxSize().padding(16.dp)) {
                            PlumAreaSelector(area, { area = it }, { personalized = true })
                            Text("Native content")
                            Spacer(Modifier.weight(1f))
                            PlumBottomBar(MainDestination.SESSIONS, { destination = it })
                        }
                    }
                }
            }
        }
        for (appearance in listOf(PlumDarkPalette, PlumLightPalette)) for (next in listOf(1f, 2f)) {
            compose.runOnIdle { scale = next; palette = appearance }
            val buttons = listOf("Chat", "Task", "Code").map { compose.onNodeWithContentDescription(it).fetchSemanticsNode().boundsInRoot }
            assertTrue(buttons[0].right <= buttons[1].left && buttons[1].right <= buttons[2].left)
            for (label in listOf("Chat", "Task", "Code")) compose.onNodeWithContentDescription(label).assertIsDisplayed().performClick()
            compose.runOnIdle { assertEquals("code", area) }
            compose.onNodeWithContentDescription(context.getString(R.string.assistant_personalization)).assertIsDisplayed().performClick()
            compose.runOnIdle { assertTrue(personalized) }
            compose.onNodeWithContentDescription(context.getString(R.string.assistant_shell_more)).performClick()
            compose.onNodeWithText(context.getString(R.string.component_analytics)).performClick()
            compose.runOnIdle { assertEquals(MainDestination.ANALYTICS, destination) }
            screenshot("native-navigation-${if (appearance == PlumDarkPalette) "dark" else "light"}-font-$next.png")
        }
    }

    @Test fun chatUsesBundledApiWorkspaceAndTaskCodeListsKeepTheirScope() {
        compose.setContent {
            CompositionLocalProvider(LocalPlumPalette provides PlumDarkPalette) {
                NativeTestTheme { DashboardScreen({}, { _, _, _ -> }, {}) }
            }
        }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        compose.waitForIdle()
        InstrumentationRegistry.getArguments().getString("fixtureCss")?.let {
            compose.waitUntil(30000) { fixture.paths.contains("/api/assistant/api-chat-providers") }; injectFixtureCss(it)
        }
        try { compose.waitUntil(45000) { device.hasObject(By.clazz("android.widget.EditText")) } }
        catch (failure: Throwable) { dumpWebState(); runCatching { device.dumpWindowHierarchy(File(context.getExternalFilesDir(null), "ui-test-screenshots/native-chat-ui.xml")) }; runCatching { screenshot("native-chat-failed.png") }; throw AssertionError("Chat did not render; requested paths: ${fixture.paths}", failure) }
        screenshot("native-api-chat-welcome.png")
        assertTrue(fixture.paths.any { it == "/api/assistant/api-chat-providers" })
        val composer = requireNotNull(device.findObject(By.clazz("android.widget.EditText")))
        composer.text = "Native Chat Probe"
        compose.waitUntil(10000) { device.hasObject(By.descContains("Nachricht senden").enabled(true)) || device.hasObject(By.textContains("Nachricht senden").enabled(true)) }
        requireNotNull(device.findObject(By.descContains("Nachricht senden").enabled(true)) ?: device.findObject(By.textContains("Nachricht senden").enabled(true))).click()
        compose.waitUntil(30000) { device.hasObject(By.textContains("PLUM_NATIVE_API_OK")) }
        screenshot("native-api-chat.png")
        compose.onNodeWithContentDescription("Task").performClick()
        compose.waitUntil(30000) { compose.onAllNodesWithText("Cache prüfen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Cache prüfen").assertIsDisplayed()
        compose.onNodeWithText("Codeprojekt").assertDoesNotExist()
        screenshot("native-task-sessions.png")
        compose.onNodeWithContentDescription("Code").performClick()
        compose.waitUntil(30000) { compose.onAllNodesWithText("Codeprojekt").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Codeprojekt").assertIsDisplayed()
        compose.onNodeWithText("Cache prüfen").assertDoesNotExist()
        screenshot("native-code-sessions.png")
    }

    @Test fun taskAndCodeAreSeparateNativeLists() {
        compose.setContent { CompositionLocalProvider(LocalPlumPalette provides PlumDarkPalette) { NativeTestTheme { DashboardScreen({}, { _, _, _ -> }, {}) } } }
        compose.onNodeWithContentDescription("Task").performClick()
        compose.waitUntil(30000) { compose.onAllNodesWithText("Cache prüfen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Cache prüfen").assertIsDisplayed()
        compose.onNodeWithText("Codeprojekt").assertDoesNotExist()
        screenshot("native-task-sessions.png")
        compose.onNodeWithContentDescription("Code").performClick()
        compose.waitUntil(30000) { compose.onAllNodesWithText("Codeprojekt").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Codeprojekt").assertIsDisplayed()
        compose.onNodeWithText("Cache prüfen").assertDoesNotExist()
        screenshot("native-code-sessions.png")
    }

    @Test fun personalizationShowsActualApiChoicesAndSavesTheChangedPreference() {
        compose.setContent {
            CompositionLocalProvider(LocalPlumPalette provides PlumDarkPalette) {
                NativeTestTheme { AssistantPersonalizationScreen({}, {}) }
            }
        }
        val provider = context.getString(R.string.assistant_memory_provider_choice)
        compose.waitUntil(30000) { compose.onAllNodesWithText(provider + ": ", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(provider + ": ", substring = true).performScrollTo().performClick()
        compose.onNodeWithText("Claude API").assertIsDisplayed().performClick()
        val model = context.getString(R.string.assistant_memory_model_choice)
        compose.onNodeWithText(model + ": ", substring = true).performScrollTo().performClick()
        compose.onNodeWithText("claude-sonnet-5-5").performClick()
        screenshot("native-personalization-dark.png")
        compose.onNodeWithText(context.getString(R.string.assistant_save), useUnmergedTree = false).performClick()
        compose.waitUntil(20000) { fixture.saved?.optJSONObject("preferences")?.optString("memoryModel") == "claude-sonnet-5-5" }
        assertEquals("anthropic", fixture.saved!!.getJSONObject("preferences").getString("memoryProviderId"))
    }

    // Optional diagnostic override belongs only to the emulator test APK.
    private fun injectFixtureCss(css: String) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val activity = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull()
            fun find(view: android.view.View): android.webkit.WebView? {
                if (view is android.webkit.WebView) return view
                if (view is android.view.ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                return null
            }
            activity?.window?.decorView?.let { find(it) }?.evaluateJavascript(
                "(()=>{const s=document.createElement('style');s.textContent=" + JSONObject.quote(css) + ";document.head.appendChild(s)})()", null)
        }
    }

    private fun dumpWebState() {
        val latch = java.util.concurrent.CountDownLatch(1)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val activity = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull()
            fun find(view: android.view.View): android.webkit.WebView? {
                if (view is android.webkit.WebView) return view
                if (view is android.view.ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                return null
            }
            val web = activity?.window?.decorView?.let { find(it) }
            if (web == null) { latch.countDown(); return@runOnMainSync }
            web.evaluateJavascript("JSON.stringify({url:location.href,text:document.body.innerText,hidden:document.hidden,innerHeight:innerHeight,clientHeight:document.documentElement.clientHeight,nodes:Array.from(document.querySelectorAll('html,body,#root,.plum-assistant-shell,.plum-assistant-shell>div,main,.plum-chat-page,.plum-chat-welcome,textarea')).map(e=>({tag:e.tagName,classes:e.className,rect:e.getBoundingClientRect().toJSON(),height:getComputedStyle(e).height,flex:getComputedStyle(e).flex,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility}))})") { value ->
                File(context.getExternalFilesDir(null), "ui-test-screenshots/native-chat-dom.json").writeText(value)
                latch.countDown()
            }
        }
        latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
                val folder = File(context.getExternalFilesDir(null), "ui-test-screenshots").apply { mkdirs() }
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(File(folder, name)))
    }
}

private class AssistantHttpFixture : AutoCloseable {
    private val server = ServerSocket(0, 30, InetAddress.getByName("127.0.0.1"))
    val port get() = server.localPort
    val paths = java.util.concurrent.CopyOnWriteArrayList<String>()
    @Volatile var saved: JSONObject? = null
    @Volatile private var chat: JSONObject? = null
    private val turns = JSONArray()
    private val preferences = JSONObject("""{"revision":1,"nickname":"Vale","referencePhotos":{"portrait":null,"fullBody":null},"memoryEnabled":false,"memoryLearning":false,"chatHistory":false,"voiceChat":true,"suggestedPrompts":false}""")
    init {
        Thread {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                Thread {
                    socket.use {
                        val reader = it.getInputStream().bufferedReader()
                        val first = reader.readLine() ?: return@use
                        val method = first.substringBefore(' ')
                        val path = first.substringAfter(' ').substringBefore(' ').substringBefore('?').removePrefix("/mobile")
                        var length = 0
                        while (true) {
                            val header = reader.readLine() ?: break
                            if (header.isEmpty()) break
                            if (header.startsWith("Content-Length:", true)) length = header.substringAfter(':').trim().toInt()
                        }
                        val chars = CharArray(length)
                        var position = 0
                        while (position < length) { val count = reader.read(chars, position, length-position); if (count < 0) break; position += count }
                        paths.add(path)
                        val data: Any = when {
                            path == "/auth/me" -> JSONObject("""{"id":"native-ui-fixture-user","name":"Vale","email":"fixture@example.invalid","role":"admin"}""")
                            path == "/api/basic-auth/status" -> JSONObject().put("enabled", false)
                            path == "/api/gateway/overview" -> JSONObject()
                            path.endsWith("/notifications") -> JSONObject().put("items", JSONArray()).put("unreadCount", 0)
                            path == "/api/assistant/personalization" -> {
                                if (method == "PUT") {
                                    saved = JSONObject(String(chars))
                                    val updated = saved!!.getJSONObject("preferences")
                                    val names = updated.keys()
                                    while (names.hasNext()) { val name = names.next() as String; preferences.put(name, updated.get(name)) }
                                    preferences.put("revision", preferences.getInt("revision")+1)
                                }
                                preferences
                            }
                            path == "/api/assistant/api-chat-providers" -> JSONArray("""[{"id":"anthropic","name":"Claude API","protocol":"anthropic","models":["claude-sonnet-5-5"]},{"id":"mistral","name":"Mistral","protocol":"openai","models":["mistral-large-4"]}]""")
                            path == "/api/assistant/api-chats" -> {
                                if (method == "POST") {
                                    val input = JSONObject(String(chars))
                                    chat = JSONObject().put("id", "native-api-chat").put("kind", "api-chat").put("revision", 1).put("title", input.getString("title")).put("body", input)
                                        .put("createdAt", "2026-10-11T00:00:00Z").put("updatedAt", "2026-10-11T00:00:00Z")
                                    chat!!
                                } else JSONArray().apply { chat?.let { put(it) } }
                            }
                            path.endsWith("/native-api-chat/turns") -> {
                                if (method == "POST") {
                                    val input = JSONObject(String(chars))
                                    val turn = JSONObject().put("id", input.getString("commandId")).put("seq", 1).put("prompt", input.getString("prompt"))
                                        .put("response", "PLUM_NATIVE_API_OK").put("status", "completed").put("model", "claude-sonnet-5-5").put("sourceVersions", JSONArray())
                                        .put("imageAssetIds", JSONArray()).put("usage", JSONObject.NULL).put("error", JSONObject.NULL).put("createdAt", "2026-10-11T00:00:00Z")
                                    turns.put(turn); turn
                                } else JSONObject().put("chat", chat).put("turns", turns)
                            }
                            path == "/api/sessions" -> JSONArray("""[{"id":"native-task","userId":"native-ui-fixture-user","name":"Cache prüfen","surface":"task","status":"stopped","workingDirectory":"/fixture/task","createdAt":"2026-10-11T00:00:00Z","updatedAt":"2026-10-11T00:00:00Z","cliProvider":"codex"},{"id":"native-code","userId":"native-ui-fixture-user","name":"Codeprojekt","surface":"code","status":"stopped","workingDirectory":"/fixture/code","createdAt":"2026-10-11T00:00:00Z","updatedAt":"2026-10-11T00:00:00Z","cliProvider":"codex"}]""")
                            path == "/api/cli-providers" -> JSONArray("""[{"id":"codex","name":"Codex","available":true,"enabled":true,"models":["gpt-5.5"]}]""")
                            path.contains("settings") -> JSONObject()
                            else -> JSONArray()
                        }
                        val body = JSONObject().put("success",true).put("data",data).toString().toByteArray()
                        it.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        it.getOutputStream().write(body)
                    }
                }.apply { isDaemon = true }.start()
            }
        }.apply { isDaemon = true }.start()
    }
    override fun close() { server.close() }
}

@Composable
private fun NativeTestTheme(content: @Composable () -> Unit) {
    ClaudeWebUITheme {
        CompositionLocalProvider(LocalReduceMotion provides true, LocalPlumTokens provides plumTokensFor(LocalPlumPalette.current, true)) { content() }
    }
}
