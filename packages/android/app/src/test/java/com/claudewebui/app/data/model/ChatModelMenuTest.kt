package com.claudewebui.app.data.model

import com.claudewebui.app.ui.screens.settings.modelMenuOrder
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** „Modelle im Chat“: the Plum Chat model menu (`chatModels`, `providerId/model`, default first). */
class ChatModelMenuTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun chatModelsRoundTripThroughThePersonalizationUpdate() {
        val value = json.decodeFromString<AssistantPersonalization>("""{"revision":4,"chatModels":["deepseek/deepseek-v4-pro","mistral/mistral-large-latest"]}""")
        assertEquals(listOf("deepseek/deepseek-v4-pro", "mistral/mistral-large-latest"), value.chatModels)
        val sent = value.updatePayload().getValue("preferences").jsonObject.getValue("chatModels").jsonArray.map { it.jsonPrimitive.content }
        assertEquals(value.chatModels, sent)
        // Older servers without the field: every model.
        assertTrue(json.decodeFromString<AssistantPersonalization>("""{"revision":1}""").chatModels.isEmpty())
    }

    @Test fun theMenuMarksTheDefaultProviderAndKeepsServerOrder() {
        val menu = json.decodeFromString<List<AssistantApiProvider>>(
            """[{"id":"deepseek","name":"DeepSeek","protocol":"openai","models":["deepseek-v4-pro","deepseek-v4"],"default":true},{"id":"mistral","name":"Mistral","protocol":"openai","models":["mistral-large-latest"]}]""",
        )
        assertTrue(menu.first().default)
        assertFalse(menu.last().default)
        assertEquals("deepseek-v4-pro", menu.first().models.first())
    }

    @Test fun aSavedMenuPutsTheDefaultFirstAndTheRestInCatalogOrder() {
        val catalog = listOf("a/1", "a/2", "b/1", "b/2")
        assertEquals(listOf("b/1", "a/1", "b/2"), modelMenuOrder(catalog, setOf("b/2", "a/1", "b/1"), "b/1"))
        // A default that is no longer shown is dropped; the rest keeps catalog order.
        assertEquals(listOf("a/2", "b/2"), modelMenuOrder(catalog, setOf("b/2", "a/2"), "a/1"))
        assertEquals(listOf("a/1", "a/2"), modelMenuOrder(catalog, setOf("a/2", "a/1"), null))
    }
}
