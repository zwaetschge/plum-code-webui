package com.claudewebui.app.core.network

import com.claudewebui.app.data.model.DesktopActionInput
import com.claudewebui.app.data.model.DesktopLayout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class DesktopLayoutSerializationTest {
    @Test
    fun restoringPrimaryFloatingAndVisibleIsAnExplicitUpdate() {
        val json = Json { encodeDefaults = false }
        val request = DesktopActionInput("geekom", "layout", layout = DesktopLayout("primary", "floating", true))
        val layout = json.parseToJsonElement(json.encodeToString(request)).jsonObject.getValue("layout").jsonObject
        assertEquals("primary", layout.getValue("chatScreen").jsonPrimitive.content)
        assertEquals("floating", layout.getValue("chatPlacement").jsonPrimitive.content)
        assertEquals("true", layout.getValue("chatVisible").jsonPrimitive.content)
    }
}
