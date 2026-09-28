package com.claudewebui.app.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceSettingsTest {
    @Test
    fun webAppearanceSettingsDeserializeAndCanBeSentBack() {
        val settings = Json.decodeFromString<UserSettings>(
            """{"userId":"test-user","theme":"eink","backgroundAnimation":"still","appearanceSync":true}"""
        )
        assertEquals(Theme.EINK, settings.theme)
        assertEquals(BackgroundAnimation.STILL, settings.backgroundAnimation)
        assertTrue(settings.appearanceSync)

        val update = Json.encodeToString(UpdateSettingsInput(
            theme = Theme.LIGHT,
            backgroundAnimation = BackgroundAnimation.GLASS,
            appearanceSync = true,
        ))
        assertTrue(update.contains("\"theme\":\"light\""))
        assertTrue(update.contains("\"backgroundAnimation\":\"glass\""))
        assertTrue(update.contains("\"appearanceSync\":true"))
    }
}
