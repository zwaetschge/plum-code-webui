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
data class AssistantApiTurn(val id: String, val seq: Long, val prompt: String, val response: String, val status: String, val error: String? = null, val model: String, val providerId: String? = null, val profileId: String? = null, val profileRevision: Long? = null, val sourceVersions: List<AssistantSourceVersion> = emptyList(), val imageAssetIds: List<String> = emptyList(), val usage: AssistantApiUsage? = null, val createdAt: String, val ui: JsonObject? = null, val uiError: String? = null, val uiPending: Boolean = false, val versions: List<String> = emptyList(), val sources: List<AssistantChatSource> = emptyList(), val comparisons: List<AssistantChatComparison> = emptyList(), val toolEvents: List<AssistantChatToolEvent> = emptyList(), val contextReceipt: JsonObject? = null, val compaction: JsonObject? = null)
@Serializable
data class AssistantApiHistory(val chat: AssistantResource, val turns: List<AssistantApiTurn> = emptyList())
@Serializable
data class AssistantApiImage(val id: String, val filename: String, val mimeType: String, val byteLength: Long)

/** GET /api/assistant/swarm/directory: every agent the server can identify, with its real state. */
@Serializable
data class SwarmContainerState(val name: String, val state: String = "", val status: String = "", val running: Boolean = false, val health: String = "")
@Serializable
data class SwarmAgentRoom(val alias: String, val id: String? = null)
@Serializable
data class SwarmDirectoryAgent(
    val id: String,
    val name: String,
    val group: String,
    val kind: String,
    val description: String? = null,
    val mode: String? = null,
    val level: String? = null,
    val trust: String? = null,
    val runtime: String? = null,
    val model: String? = null,
    val skills: List<String> = emptyList(),
    val accepts: List<String> = emptyList(),
    val parallel: Int? = null,
    val budgetUsdDay: Double? = null,
    val spentTodayUsd: Double? = null,
    val room: SwarmAgentRoom? = null,
    val health: String = "unknown",
    val healthReason: String = "",
    val worker: String? = null,
    val cardStatus: String? = null,
    val offBox: Boolean? = null,
    val puppets: List<String>? = null,
    val containers: List<SwarmContainerState> = emptyList(),
    val lastLog: String? = null,
)
@Serializable
data class SwarmFailure(val task: String, val state: String = "", val reason: String = "", val at: String = "")
@Serializable
data class SwarmHubState(
    val reachable: Boolean = false,
    val ok: Boolean = false,
    val frozen: Boolean = false,
    val problems: List<String> = emptyList(),
    val openTasks: Int = 0,
    val approvalsPending: Int = 0,
    val outboxDead: Int = 0,
    val costTodayUsd: Double = 0.0,
    val failures: List<SwarmFailure> = emptyList(),
    val container: SwarmContainerState? = null,
    val error: String? = null,
)
@Serializable
data class SwarmDirectory(val hub: SwarmHubState, val agents: List<SwarmDirectoryAgent>, val matrixConnected: Boolean = false, val containersVisible: Boolean = false, val checkedAt: String = "")
@Serializable
data class SwarmContainerLogs(val lines: List<String> = emptyList())

@Serializable
data class AssistantChatSource(val id: String, val revision: Long, val title: String, val text: String, val citation: String = "", val page: Long? = null, val excerptStart: Long = 0, val retrieval: String? = null)
@Serializable
data class AssistantChatComparison(val providerId: String, val model: String, val response: String = "", val status: String, val error: String? = null)
@Serializable
data class AssistantChatToolEvent(val id: String, val name: String, val status: String, val result: String? = null, val arguments: String? = null)
