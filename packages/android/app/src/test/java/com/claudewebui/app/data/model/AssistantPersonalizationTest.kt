package com.claudewebui.app.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class AssistantPersonalizationTest {
    @Test fun updateRespectsStrictRevisionContractAndKeepsPhotosOutOfPreferences() {
        val value = AssistantPersonalization(revision = 12, nickname = "Valentin", chatInstructions = "Schweizer Hochdeutsch", taskInstructions = "Hermes", codeInstructions = "Typprüfung", referencePhotos = mapOf("portrait" to AssistantReferencePhoto("private", "portrait.png", "image/png", 20), "fullBody" to null))
        val payload = value.updatePayload()
        assertEquals(setOf("expectedRevision", "preferences"), payload.keys)
        assertEquals(12L, payload.getValue("expectedRevision").jsonPrimitive.long)
        val fields = payload.getValue("preferences").jsonObject
        assertFalse(fields.containsKey("referencePhotos")); assertFalse(fields.containsKey("revision"))
        assertEquals("Hermes", fields.getValue("taskInstructions").jsonPrimitive.content)
        assertEquals("Typprüfung", fields.getValue("codeInstructions").jsonPrimitive.content)
        assertFalse(fields.getValue("memoryEnabled").jsonPrimitive.boolean)
        for (key in listOf("memoryLearning", "chatHistory", "writingStyleLearning", "agentMemorySharing")) assertFalse(fields.getValue(key).jsonPrimitive.boolean)
    }
    @Test fun memoryPreferencesRoundTripWithoutChangingPhotos() {
        val value = AssistantPersonalization(memoryEnabled = true, memoryLearning = true, chatHistory = true, writingStyleLearning = true, agentMemorySharing = true, memoryProviderId = "mistral", memoryModel = "mistral-large-latest")
        val fields = value.updatePayload().getValue("preferences").jsonObject
        assertEquals("mistral", fields.getValue("memoryProviderId").jsonPrimitive.content)
        assertEquals("mistral-large-latest", fields.getValue("memoryModel").jsonPrimitive.content)
        for (key in listOf("memoryLearning", "chatHistory", "writingStyleLearning", "agentMemorySharing")) assertTrue(fields.getValue(key).jsonPrimitive.boolean)
    }
    @Test fun acceptsOldSparseSettingsAndFutureFieldsWithoutEnablingMemory() {
        val json = Json { ignoreUnknownKeys = true }
        val value = json.decodeFromString<AssistantPersonalization>("""{"revision":2,"voiceChat":false,"futurePreference":true}""")
        assertEquals(2L, value.revision)
        assertFalse(value.voiceChat); assertFalse(value.voiceHistory); assertFalse(value.memoryEnabled)
        assertEquals(setOf("portrait", "fullBody"), value.referencePhotos.keys)
    }
}
