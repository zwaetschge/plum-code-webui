package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class AssistantReferencePhoto(val id: String, val filename: String, val mimeType: String, val byteLength: Long)

@Serializable
data class AssistantVoiceOption(val id: String? = null, val name: String? = null, val engine: String? = null) {
    /** What is stored and sent: OmniVoice by name, Mistral as `mistral:<id>`. */
    val key: String get() = if (engine == "mistral") id.orEmpty() else (name ?: id).orEmpty()
    val label: String get() = (name ?: id).orEmpty()
}

@Serializable
data class AssistantPersonalization(
    val revision: Long = 0,
    val memoryEnabled: Boolean = false,
    val memoryLearning: Boolean = false,
    val agentMemorySharing: Boolean = false,
    val chatHistory: Boolean = false,
    val writingStyleLearning: Boolean = false,
    val memoryProviderId: String = "",
    val memoryModel: String = "",
    val writingStyleEnabled: Boolean = false,
    val writingSample: String = "",
    val nickname: String = "",
    val occupation: String = "",
    val aboutYou: String = "",
    val baseStyle: String = "default",
    val warmth: String = "default",
    val enthusiasm: String = "default",
    val emoji: String = "default",
    val visualLayout: String = "default",
    val headings: String = "default",
    val chatInstructions: String = "",
    val taskInstructions: String = "",
    val codeInstructions: String = "",
    val conciseAnswers: Boolean = false,
    val suggestedPrompts: Boolean = true,
    val voiceHistory: Boolean = false,
    val webSearch: Boolean = true,
    val voiceChat: Boolean = true,
    val voiceName: String = "",
    val projectSearch: Boolean = false,
    val connectorSearch: Boolean = false,
    val referencePhotos: Map<String, AssistantReferencePhoto?> = mapOf("portrait" to null, "fullBody" to null),
) {
    fun updatePayload(): JsonObject {
        val json = Json { encodeDefaults = true }
        val fields = json.encodeToJsonElement(this).jsonObject.filterKeys { it !in setOf("revision", "referencePhotos") }
        return buildJsonObject { put("expectedRevision", revision); put("preferences", JsonObject(fields)) }
    }
}

internal fun JsonObject.assistantText(key: String): String = (get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
