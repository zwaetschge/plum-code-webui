package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonObject

@Serializable
data class AssistantResource(val id: String, val kind: String, val revision: Long, val title: String, val body: JsonObject, val createdAt: String, val updatedAt: String)

@Serializable
data class AssistantResourceInput(val title: String, val body: JsonObject, val expectedRevision: Long? = null)

@Serializable
data class AssistantTaskCommand(val commandId: String, val expectedRevision: Long, val action: String, val text: String? = null)

@Serializable
data class AssistantTaskResultCandidate(val id: String, val title: String, val revision: Long, val type: String? = null)

@Serializable
data class AssistantProfileBinding(val profileId: String?)

@Serializable
data class AssistantMatrixEvent(@SerialName("event_id") val id: String? = null, val type: String, val sender: String? = null, @SerialName("state_key") val stateKey: String? = null, @SerialName("origin_server_ts") val timestamp: Long = 0, val content: JsonObject, val redacts: String? = null)
@Serializable
data class AssistantMatrixRoom(val id: String, val name: String, val alias: String? = null, val encrypted: Boolean = false, val state: List<AssistantMatrixEvent> = emptyList())
@Serializable
data class AssistantMatrixPage(val chunk: List<AssistantMatrixEvent>, val end: String? = null, @SerialName("next_batch") val nextBatch: String? = null)
@Serializable
data class AssistantMatrixLogin(val username: String, val password: String)
@Serializable
data class AssistantMatrixSend(val commandId: String, val type: String, val content: JsonObject)

@Serializable
data class AssistantApiProvider(val id: String, val name: String, val protocol: String, val models: List<String> = emptyList())
@Serializable
data class AssistantSourceVersion(val id: String, val revision: Long)
@Serializable
data class AssistantApiUsage(val input: Long, val output: Long, val cached: Long, val cacheWrite: Long, val costUsd: Double? = null)
@Serializable
data class AssistantApiTurn(val id: String, val seq: Long, val prompt: String, val response: String, val status: String, val error: String? = null, val model: String, val providerId: String? = null, val profileId: String? = null, val profileRevision: Long? = null, val sourceVersions: List<AssistantSourceVersion> = emptyList(), val imageAssetIds: List<String> = emptyList(), val usage: AssistantApiUsage? = null, val createdAt: String, val ui: JsonObject? = null, val uiError: String? = null, val uiPending: Boolean = false)
@Serializable
data class AssistantApiHistory(val chat: AssistantResource, val turns: List<AssistantApiTurn> = emptyList())
@Serializable
data class AssistantApiImage(val id: String, val filename: String, val mimeType: String, val byteLength: Long)
