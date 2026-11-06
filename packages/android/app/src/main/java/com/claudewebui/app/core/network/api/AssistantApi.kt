package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.setBody
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import com.claudewebui.app.core.network.AssistantAccountKey
import com.claudewebui.app.core.security.TokenStore
import io.ktor.client.request.*
import io.ktor.client.request.header
import io.ktor.client.call.body
import io.ktor.http.HttpHeaders
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.plugins.timeout

interface AssistantApi {
    suspend fun getChatToolCatalog(owner: String, input: JsonObject): ApiResponse<List<JsonObject>>
    suspend fun decideChatTool(owner: String, chatId: String, turnId: String, callId: String, decision: String): ApiResponse<JsonObject>
    suspend fun saveChatMemory(owner: String, id: String?, input: AssistantResourceInput): ApiResponse<AssistantResource>
    suspend fun getMemoryTopics(search: String = "", offset: Int = 0): ApiResponse<JsonObject>
    suspend fun getMemoryTopicDocument(id: String, offset: Int = 0): ApiResponse<JsonObject>
    suspend fun forgetMemoryTopic(owner: String, id: String, version: String): ApiResponse<JsonObject>
    suspend fun forgetChatMemory(owner: String, id: String, revision: Long): ApiResponse<JsonObject>
    suspend fun getResourceRevisionDiff(collection: String, id: String, from: Long, to: Long): ApiResponse<JsonObject>
    suspend fun getManagedChats(archived: Boolean = false, search: String = "", offset: Int = 0): ApiResponse<JsonObject>
    suspend fun bulkManageChats(owner: String, input: JsonObject): ApiResponse<JsonObject>
    suspend fun getArtifactToolFile(artifactId: String, assetId: String): ByteArray
    suspend fun getChatToolFile(chatId: String, assetId: String): ByteArray
    suspend fun getChatToolServers(): ApiResponse<List<JsonObject>>
    suspend fun saveProfileChatOptions(owner: String, id: String, input: JsonObject): ApiResponse<AssistantResource>
    suspend fun saveChatOptions(owner: String, id: String, input: JsonObject): ApiResponse<AssistantResource>
    suspend fun exportModelChat(id: String): ByteArray
    suspend fun getModelChatShares(id: String): ApiResponse<List<JsonObject>>
    suspend fun shareModelChat(id: String): ApiResponse<JsonObject>
    suspend fun revokeModelChatShare(id: String): ApiResponse<JsonObject>
    suspend fun importModelChats(owner: String, providerId: String, model: String, bytes: ByteArray): ApiResponse<JsonObject>
    suspend fun getAssistantResources(collection: String, offset: Int = 0, search: String? = null, status: String? = null, sort: String? = null, projectId: String? = null): ApiResponse<List<AssistantResource>>
    suspend fun getAssistantPersonalization(): ApiResponse<AssistantPersonalization>
    suspend fun updateAssistantPersonalization(owner: String, input: JsonObject): ApiResponse<AssistantPersonalization>
    suspend fun getAssistantReferencePhoto(slot: String): ByteArray
    suspend fun changeAssistantReferencePhoto(owner: String, slot: String, revision: Long, filename: String?, mimeType: String?, bytes: ByteArray?): ApiResponse<AssistantPersonalization>
    suspend fun getAssistantOverview(): ApiResponse<JsonObject>
    suspend fun getAssistantResource(collection: String, id: String): ApiResponse<AssistantResource>
    suspend fun archiveAssistantResource(collection: String, id: String, revision: Long): ApiResponse<JsonObject>
    suspend fun getAssistantTaskLimits(id: String): ApiResponse<JsonObject>
    suspend fun getAssistantTaskImages(id: String): ApiResponse<List<AssistantApiImage>>
    suspend fun getAssistantTaskImage(id: String, imageId: String): ByteArray
    suspend fun uploadAssistantTaskImage(owner: String, id: String, revision: Long, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<JsonObject>
    suspend fun removeAssistantTaskImage(owner: String, id: String, imageId: String, revision: Long): ApiResponse<AssistantResource>
    suspend fun getAssistantApiProviders(): ApiResponse<List<AssistantApiProvider>>
    suspend fun getAssistantApiTurns(id: String, beforeSeq: Long? = null): ApiResponse<AssistantApiHistory>
    suspend fun getAssistantApiImages(id: String): ApiResponse<List<AssistantApiImage>>
    /** Show another version of a regenerated/edited turn (with the thread that followed it). */
    suspend fun activateAssistantApiTurn(id: String, turnId: String): ApiResponse<JsonObject>
    /** Rename and/or move a model chat; `projectId` JsonNull removes it from its project. */
    suspend fun updateAssistantApiChatMeta(id: String, meta: JsonObject): ApiResponse<AssistantResource>
    /** Permanently delete a model chat with all versions. */
    suspend fun deleteAssistantApiChat(id: String): ApiResponse<JsonObject>
    /** Permanently delete a project with its chats, sources and project memory. */
    suspend fun deleteAssistantProject(id: String): ApiResponse<JsonObject>
    suspend fun getAssistantApiImage(id: String, assetId: String): ByteArray
    suspend fun getAssistantSourceFile(id: String, revision: Long): ByteArray
    suspend fun uploadAssistantApiImage(owner: String, id: String, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<AssistantApiImage>
    suspend fun uploadAssistantApiDocument(owner: String, id: String, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<JsonObject>
    /** Whisper through Vocarium; dictation sends AAC, the voice mode 16 kHz WAV. */
    suspend fun transcribeAssistantAudio(owner: String, bytes: ByteArray, fileName: String = "dictation.m4a", mimeType: String = "audio/mp4"): ApiResponse<JsonObject>
    suspend fun speakAssistantText(owner: String, text: String, voice: String, language: String): ByteArray
    /** Loads Whisper and [voice] on Vocarium before a voice conversation; reports each one's readiness. */
    suspend fun warmAssistantVoice(owner: String, voice: String, language: String): ApiResponse<JsonObject>
    suspend fun getAssistantVoices(): ApiResponse<List<AssistantVoiceOption>>
    suspend fun deliverAssistantApiCommand(owner: String, path: String, payload: JsonObject): ApiResponse<JsonObject>
    /** PATCH /api/assistant/api-chats/:id — model, profile, sources and writing style of a model chat. */
    suspend fun updateAssistantApiChat(owner: String, id: String, input: JsonObject): ApiResponse<AssistantResource>
    suspend fun createAssistantResource(collection: String, input: AssistantResourceInput): ApiResponse<AssistantResource>
    suspend fun updateAssistantResource(collection: String, id: String, input: AssistantResourceInput): ApiResponse<AssistantResource>
    suspend fun sendAssistantTaskCommand(id: String, input: AssistantTaskCommand): ApiResponse<JsonObject>
    suspend fun getAssistantTaskResults(id: String): ApiResponse<List<AssistantTaskResultCandidate>>
    suspend fun bindAssistantProfile(sessionId: String, profileId: String?): ApiResponse<JsonObject>
    suspend fun getAssistantMatrixStatus(): ApiResponse<JsonObject>
    suspend fun connectAssistantMatrix(input: AssistantMatrixLogin): ApiResponse<JsonObject>
    suspend fun getAssistantMatrixRooms(): ApiResponse<List<AssistantMatrixRoom>>
    suspend fun getAssistantMatrixMessages(roomId: String, threadId: String? = null, from: String? = null): ApiResponse<AssistantMatrixPage>
    suspend fun sendAssistantMatrixEvent(roomId: String, input: AssistantMatrixSend): ApiResponse<JsonObject>
    suspend fun openAssistantBrianConversation(): ApiResponse<JsonObject>
    suspend fun getSwarmDirectory(): ApiResponse<SwarmDirectory>
    /** start, stop or restart; only containers the directory lists, admin only. */
    suspend fun swarmContainerAction(name: String, action: String, host: String? = null): ApiResponse<JsonObject>
    suspend fun getSwarmContainerLogs(name: String, host: String? = null): ApiResponse<SwarmContainerLogs>
    suspend fun getAssistantMatrixMedia(roomId: String, eventId: String): ByteArray
    suspend fun getHermesStatus(fresh: Boolean = false): ApiResponse<HermesStatus>
    /** Starts the autoupdater's update of Brian; admin only. */
    suspend fun updateHermes(): ApiResponse<HermesStatus>
    /** Hermes image update or compose rebuild of one Schwarm agent; admin only. */
    suspend fun updateHermesAgent(id: String): ApiResponse<HermesStatus>
    suspend fun setHermesAutoUpdate(paused: Boolean): ApiResponse<HermesStatus>
}

class AssistantApiImpl(private val http: ApiHttp) : AssistantApi {
    override suspend fun getChatToolCatalog(owner: String, input: JsonObject): ApiResponse<List<JsonObject>> = http.post("/api/assistant/api-chat-tools/catalog") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun decideChatTool(owner: String, chatId: String, turnId: String, callId: String, decision: String): ApiResponse<JsonObject> = http.post("/api/assistant/api-chats/${checked(chatId)}/turns/${checked(turnId)}/tools/${checked(callId)}/decision") { attributes.put(AssistantAccountKey, owner); setBody(JsonObject(mapOf("decision" to kotlinx.serialization.json.JsonPrimitive(decision)))) }
    override suspend fun saveChatMemory(owner: String, id: String?, input: AssistantResourceInput): ApiResponse<AssistantResource> = if (id == null) http.post("/api/assistant/memory") { attributes.put(AssistantAccountKey, owner); setBody(input) } else http.patch("/api/assistant/memory/${checked(id)}") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun getMemoryTopics(search: String, offset: Int): ApiResponse<JsonObject> = http.get("/api/assistant/memory-system/topics") { url { parameters.append("search", search); parameters.append("offset", offset.toString()) } }
    override suspend fun getMemoryTopicDocument(id: String, offset: Int): ApiResponse<JsonObject> = http.get("/api/assistant/memory-system/topics/${checked(id)}") { url { parameters.append("offset", offset.toString()) } }
    override suspend fun forgetMemoryTopic(owner: String, id: String, version: String): ApiResponse<JsonObject> = http.delete("/api/assistant/memory-system/topics/${checked(id)}") { attributes.put(AssistantAccountKey, owner); setBody(JsonObject(mapOf("expectedVersion" to kotlinx.serialization.json.JsonPrimitive(version)))) }
    override suspend fun forgetChatMemory(owner: String, id: String, revision: Long): ApiResponse<JsonObject> = http.delete("/api/assistant/memory-system/${checked(id)}") { attributes.put(AssistantAccountKey, owner); setBody(JsonObject(mapOf("expectedRevision" to kotlinx.serialization.json.JsonPrimitive(revision)))) }
    override suspend fun getResourceRevisionDiff(collection: String, id: String, from: Long, to: Long): ApiResponse<JsonObject> = http.get("/api/assistant/revision-diff/${checked(collection)}/${checked(id)}") { url { parameters.append("from", from.toString()); parameters.append("to", to.toString()) } }
    override suspend fun getManagedChats(archived: Boolean, search: String, offset: Int): ApiResponse<JsonObject> = http.get("/api/assistant/api-chats/manage") { url { parameters.append("archived", archived.toString()); parameters.append("search", search); parameters.append("offset", offset.toString()) } }
    override suspend fun bulkManageChats(owner: String, input: JsonObject): ApiResponse<JsonObject> = http.post("/api/assistant/api-chats/bulk") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun getArtifactToolFile(artifactId: String, assetId: String): ByteArray = http.get("/api/assistant/artifacts/${checked(artifactId)}/tool-files/${checked(assetId)}")
    override suspend fun getChatToolFile(chatId: String, assetId: String): ByteArray = http.get("/api/assistant/api-chats/${checked(chatId)}/tool-files/${checked(assetId)}")
    override suspend fun getChatToolServers(): ApiResponse<List<JsonObject>> = http.get("/api/mcp-servers")
    override suspend fun saveProfileChatOptions(owner: String, id: String, input: JsonObject): ApiResponse<AssistantResource> = http.put("/api/assistant/profiles/${checked(id)}/options") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun saveChatOptions(owner: String, id: String, input: JsonObject): ApiResponse<AssistantResource> = http.put("/api/assistant/api-chats/${checked(id)}/options") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun exportModelChat(id: String): ByteArray = http.get("/api/assistant/api-chats/${checked(id)}/export")
    override suspend fun getModelChatShares(id: String): ApiResponse<List<JsonObject>> = http.get("/api/assistant/api-chats/${checked(id)}/shares")
    override suspend fun shareModelChat(id: String): ApiResponse<JsonObject> = http.post("/api/assistant/api-chats/${checked(id)}/share") { setBody(kotlinx.serialization.json.buildJsonObject {}) }
    override suspend fun revokeModelChatShare(id: String): ApiResponse<JsonObject> = http.delete("/api/assistant/shares/${checked(id)}")
    override suspend fun importModelChats(owner: String, providerId: String, model: String, bytes: ByteArray): ApiResponse<JsonObject> {
        require(owner == TokenStore.assistantOwnerKey())
        require(bytes.size <= 25 * 1024 * 1024)
        val form = MultiPartFormDataContent(formData {
            append("providerId", providerId); append("model", model)
            append("file", bytes, Headers.build { append(HttpHeaders.ContentType, "application/json"); append(HttpHeaders.ContentDisposition, "filename=\"chat-import.json\"") })
        })
        return http.client.post("${http.baseUrl}/api/assistant/api-chats/import") { attributes.put(AssistantAccountKey, owner); setBody(form) }.body()
    }
    private fun checked(value: String): String {
        require(value.matches(Regex("[A-Za-z0-9_-]+"))) { "Invalid assistant resource identifier" }
        return value
    }
    override suspend fun getAssistantResources(collection: String, offset: Int, search: String?, status: String?, sort: String?, projectId: String?): ApiResponse<List<AssistantResource>> = http.get("/api/assistant/${checked(collection)}") { url { parameters.append("limit", "100"); parameters.append("offset",offset.coerceAtLeast(0).toString()); search?.let { parameters.append("search", it) }; status?.takeIf { it.isNotBlank() }?.let { parameters.append("status", it) }; sort?.let { parameters.append("sort", it) }; projectId?.let { parameters.append("projectId", it) } } }
    override suspend fun getAssistantPersonalization(): ApiResponse<AssistantPersonalization> = http.get("/api/assistant/personalization")
    override suspend fun updateAssistantPersonalization(owner: String, input: JsonObject): ApiResponse<AssistantPersonalization> = http.put("/api/assistant/personalization") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun getAssistantReferencePhoto(slot: String): ByteArray { require(slot in setOf("portrait", "fullBody")); return http.get("/api/assistant/personalization/photos/$slot") }
    override suspend fun changeAssistantReferencePhoto(owner: String, slot: String, revision: Long, filename: String?, mimeType: String?, bytes: ByteArray?): ApiResponse<AssistantPersonalization> {
        require(slot in setOf("portrait", "fullBody"))
        if (bytes == null) return http.delete("/api/assistant/personalization/photos/$slot") {
            attributes.put(AssistantAccountKey, owner)
            setBody(kotlinx.serialization.json.buildJsonObject { put("expectedRevision", kotlinx.serialization.json.JsonPrimitive(revision)) })
        }
        return upload(owner, "/api/assistant/personalization/photos/$slot", requireNotNull(filename), requireNotNull(mimeType), bytes, revision)
    }
    override suspend fun getAssistantOverview(): ApiResponse<JsonObject> = http.get("/api/assistant/overview")
    override suspend fun getAssistantResource(collection: String, id: String): ApiResponse<AssistantResource> = http.get("/api/assistant/${checked(collection)}/${checked(id)}")
    override suspend fun archiveAssistantResource(collection: String, id: String, revision: Long): ApiResponse<JsonObject> = http.delete("/api/assistant/${checked(collection)}/${checked(id)}") { setBody(kotlinx.serialization.json.buildJsonObject { put("expectedRevision", kotlinx.serialization.json.JsonPrimitive(revision)) }) }
    override suspend fun getAssistantTaskLimits(id: String): ApiResponse<JsonObject> = http.get("/api/assistant/tasks/${checked(id)}/limits")
    override suspend fun getAssistantTaskImages(id: String): ApiResponse<List<AssistantApiImage>> = http.get("/api/assistant/tasks/${checked(id)}/images")
    override suspend fun getAssistantTaskImage(id: String, imageId: String): ByteArray = http.get("/api/assistant/tasks/${checked(id)}/images/${checked(imageId)}")
    override suspend fun uploadAssistantTaskImage(owner: String, id: String, revision: Long, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<JsonObject> = upload(owner, "/api/assistant/tasks/${checked(id)}/images", filename, mimeType, bytes, revision)
    override suspend fun removeAssistantTaskImage(owner: String, id: String, imageId: String, revision: Long): ApiResponse<AssistantResource> = http.delete("/api/assistant/tasks/${checked(id)}/images/${checked(imageId)}") { attributes.put(AssistantAccountKey, owner); url { parameters.append("expectedRevision", revision.toString()) } }
    private suspend inline fun <reified T> upload(owner: String, path: String, filename: String, mimeType: String, bytes: ByteArray, revision: Long): ApiResponse<T> {
        require(owner == TokenStore.assistantOwnerKey())
        require(bytes.isNotEmpty() && bytes.size <= 5 * 1024 * 1024)
        require(mimeType in listOf("image/png", "image/jpeg", "image/webp", "image/gif"))
        val multipart = MultiPartFormDataContent(formData {
            append("expectedRevision", revision.toString())
            append("file", bytes, Headers.build {
                append(HttpHeaders.ContentType, mimeType)
                append(HttpHeaders.ContentDisposition, "filename=\"${filename.replace(Regex("[^A-Za-z0-9._-]"), "_").take(180)}\"")
            })
        })
        return http.client.post("${http.baseUrl}$path") {
            attributes.put(AssistantAccountKey, owner)
            header(HttpHeaders.ContentType, multipart.contentType.toString())
            setBody(multipart)
        }.body()
    }
    override suspend fun getAssistantApiProviders(): ApiResponse<List<AssistantApiProvider>> = http.get("/api/assistant/api-chat-providers")
    override suspend fun getAssistantApiTurns(id: String, beforeSeq: Long?): ApiResponse<AssistantApiHistory> = http.get("/api/assistant/api-chats/${checked(id)}/turns") { url { beforeSeq?.let { parameters.append("beforeSeq", it.toString()) } } }
    override suspend fun getAssistantApiImages(id: String): ApiResponse<List<AssistantApiImage>> = http.get("/api/assistant/api-chats/${checked(id)}/images")
    override suspend fun activateAssistantApiTurn(id: String, turnId: String): ApiResponse<JsonObject> = http.post("/api/assistant/api-chats/${checked(id)}/turns/${checked(turnId)}/activate") { setBody(kotlinx.serialization.json.buildJsonObject {}) }
    override suspend fun updateAssistantApiChatMeta(id: String, meta: JsonObject): ApiResponse<AssistantResource> = http.post("/api/assistant/api-chats/${checked(id)}/meta") { setBody(meta) }
    override suspend fun deleteAssistantApiChat(id: String): ApiResponse<JsonObject> = http.post("/api/assistant/api-chats/${checked(id)}/delete") { setBody(kotlinx.serialization.json.buildJsonObject {}) }
    override suspend fun deleteAssistantProject(id: String): ApiResponse<JsonObject> = http.post("/api/assistant/projects/${checked(id)}/delete") { setBody(kotlinx.serialization.json.buildJsonObject {}) }
    override suspend fun getAssistantSourceFile(id: String, revision: Long): ByteArray = http.get("/api/assistant/sources/${checked(id)}/file?revision=$revision")
    override suspend fun getAssistantApiImage(id: String, assetId: String): ByteArray = http.get("/api/assistant/api-chats/${checked(id)}/images/${checked(assetId)}")
    override suspend fun uploadAssistantApiImage(owner: String, id: String, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<AssistantApiImage> {
        require(owner == TokenStore.assistantOwnerKey())
        require(bytes.isNotEmpty() && bytes.size <= 5 * 1024 * 1024)
        require(mimeType in listOf("image/png", "image/jpeg", "image/webp", "image/gif"))
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_").take(180).ifEmpty { "image" }
        val multipart = MultiPartFormDataContent(formData {
            append("file", bytes, Headers.build {
                append(HttpHeaders.ContentType, ContentType.parse(mimeType).toString())
                append(HttpHeaders.ContentDisposition, "filename=\"$safeName\"")
            })
        })
        return http.client.post("$server/api/assistant/api-chats/${checked(id)}/images") {
            attributes.put(AssistantAccountKey, owner)
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.ContentType, multipart.contentType.toString())
            setBody(multipart)
        }.body()
    }
    override suspend fun uploadAssistantApiDocument(owner: String, id: String, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<JsonObject> {
        require(owner == TokenStore.assistantOwnerKey())
        require(bytes.isNotEmpty() && bytes.size <= 25 * 1024 * 1024)
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_").take(180).ifEmpty { "image" }
        val multipart = MultiPartFormDataContent(formData {
            append("file", bytes, Headers.build {
                append(HttpHeaders.ContentType, ContentType.parse(mimeType).toString())
                append(HttpHeaders.ContentDisposition, "filename=\"$safeName\"")
            })
        })
        return http.client.post("$server/api/assistant/api-chats/${checked(id)}/documents") {
            timeout { requestTimeoutMillis = 120_000; socketTimeoutMillis = 120_000 }
            attributes.put(AssistantAccountKey, owner)
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.ContentType, multipart.contentType.toString())
            setBody(multipart)
        }.body()
    }
    override suspend fun transcribeAssistantAudio(owner: String, bytes: ByteArray, fileName: String, mimeType: String): ApiResponse<JsonObject> {
        require(owner == TokenStore.assistantOwnerKey())
        require(bytes.isNotEmpty() && bytes.size <= 20 * 1024 * 1024)
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        val multipart = MultiPartFormDataContent(formData {
            append("language", "de")
            append("file", bytes, Headers.build {
                require(fileName.matches(Regex("[A-Za-z0-9_.-]+")))
                append(HttpHeaders.ContentType, mimeType)
                append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
            })
        })
        return http.client.post("$server/api/assistant/voice/transcribe") {
            attributes.put(AssistantAccountKey, owner)
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.ContentType, multipart.contentType.toString())
            timeout { requestTimeoutMillis = 190_000; socketTimeoutMillis = 190_000 }
            setBody(multipart)
        }.body()
    }
    override suspend fun getAssistantVoices(): ApiResponse<List<AssistantVoiceOption>> = http.get("/api/assistant/voice/voices")
    override suspend fun speakAssistantText(owner: String, text: String, voice: String, language: String): ByteArray {
        require(owner == TokenStore.assistantOwnerKey())
        require(text.isNotBlank() && text.length <= 5000)
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        return http.client.post("$server/api/assistant/voice/speech") {
            attributes.put(AssistantAccountKey, owner)
            header(HttpHeaders.Authorization, "Bearer $token")
            timeout { requestTimeoutMillis = 190_000; socketTimeoutMillis = 190_000 }
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("text", kotlinx.serialization.json.JsonPrimitive(text))
                put("voice", kotlinx.serialization.json.JsonPrimitive(voice))
                put("language", kotlinx.serialization.json.JsonPrimitive(language))
            })
        }.body()
    }
    override suspend fun warmAssistantVoice(owner: String, voice: String, language: String): ApiResponse<JsonObject> {
        require(owner == TokenStore.assistantOwnerKey())
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        return http.client.post("$server/api/assistant/voice/warmup") {
            attributes.put(AssistantAccountKey, owner)
            header(HttpHeaders.Authorization, "Bearer $token")
            timeout { requestTimeoutMillis = 190_000; socketTimeoutMillis = 190_000 }
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("voice", kotlinx.serialization.json.JsonPrimitive(voice))
                put("language", kotlinx.serialization.json.JsonPrimitive(language))
            })
        }.body()
    }
    override suspend fun deliverAssistantApiCommand(owner: String, path: String, payload: JsonObject): ApiResponse<JsonObject> {
        require(path.matches(Regex("^/api/assistant/(?:api-chats(?:/[A-Za-z0-9_-]+/(?:turns|branches|results|selection|turns/[A-Za-z0-9_-]+/stop))?|tasks/[A-Za-z0-9_-]+/(?:results|commands))$")))
        require(owner == TokenStore.assistantOwnerKey())
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        return http.client.post("$server$path") { attributes.put(AssistantAccountKey, owner); header(HttpHeaders.Authorization, "Bearer $token"); setBody(payload) }.body()
    }
    override suspend fun createAssistantResource(collection: String, input: AssistantResourceInput): ApiResponse<AssistantResource> = http.post("/api/assistant/${checked(collection)}") { setBody(input) }
    override suspend fun updateAssistantApiChat(owner: String, id: String, input: JsonObject): ApiResponse<AssistantResource> = http.patch("/api/assistant/api-chats/${checked(id)}") { attributes.put(AssistantAccountKey, owner); setBody(input) }
    override suspend fun updateAssistantResource(collection: String, id: String, input: AssistantResourceInput): ApiResponse<AssistantResource> = http.patch("/api/assistant/${checked(collection)}/${checked(id)}") { setBody(input) }
    override suspend fun sendAssistantTaskCommand(id: String, input: AssistantTaskCommand): ApiResponse<JsonObject> = http.post("/api/assistant/tasks/${checked(id)}/commands") { setBody(input) }
    override suspend fun getAssistantTaskResults(id: String): ApiResponse<List<AssistantTaskResultCandidate>> = http.get("/api/assistant/tasks/${checked(id)}/results")
    override suspend fun bindAssistantProfile(sessionId: String, profileId: String?): ApiResponse<JsonObject> = http.post("/api/assistant/sessions/${checked(sessionId)}/profile") { setBody(AssistantProfileBinding(profileId)) }
    override suspend fun getAssistantMatrixStatus(): ApiResponse<JsonObject> = http.get("/api/assistant/matrix/status")
    override suspend fun connectAssistantMatrix(input: AssistantMatrixLogin): ApiResponse<JsonObject> = http.post("/api/assistant/matrix/connect") { setBody(input) }
    override suspend fun getAssistantMatrixRooms(): ApiResponse<List<AssistantMatrixRoom>> = http.get("/api/assistant/matrix/rooms")
    override suspend fun getAssistantMatrixMessages(roomId: String, threadId: String?, from: String?): ApiResponse<AssistantMatrixPage> = http.get("/api/assistant/matrix/rooms/${roomId.encodeURLPathPart()}/messages") { url { threadId?.let { parameters.append("threadId",it) }; from?.let { parameters.append("from",it) } } }
    override suspend fun sendAssistantMatrixEvent(roomId: String, input: AssistantMatrixSend): ApiResponse<JsonObject> = http.post("/api/assistant/matrix/rooms/${roomId.encodeURLPathPart()}/events") { setBody(input) }
    override suspend fun openAssistantBrianConversation(): ApiResponse<JsonObject> = http.post("/api/assistant/matrix/brian/conversation")
    override suspend fun getSwarmDirectory(): ApiResponse<SwarmDirectory> = http.get("/api/assistant/swarm/directory")
    override suspend fun swarmContainerAction(name: String, action: String, host: String?): ApiResponse<JsonObject> =
        http.post("/api/assistant/swarm/containers/${name.encodeURLPathPart()}/${checked(action)}") { setBody(buildJsonObject { host?.let { put("host", it) } }) }
    override suspend fun getSwarmContainerLogs(name: String, host: String?): ApiResponse<SwarmContainerLogs> =
        http.get("/api/assistant/swarm/containers/${name.encodeURLPathPart()}/logs") { url { host?.let { parameters.append("host", it) } } }
    override suspend fun getAssistantMatrixMedia(roomId: String, eventId: String): ByteArray = http.get("/api/assistant/matrix/rooms/${roomId.encodeURLPathPart()}/events/${eventId.encodeURLPathPart()}/media")
    override suspend fun getHermesStatus(fresh: Boolean): ApiResponse<HermesStatus> = http.get("/api/hermes") { url { if (fresh) parameters.append("fresh", "1") } }
    override suspend fun updateHermes(): ApiResponse<HermesStatus> = http.post("/api/hermes/update")
    override suspend fun updateHermesAgent(id: String): ApiResponse<HermesStatus> = http.post("/api/hermes/agents/${checked(id)}/update")
    override suspend fun setHermesAutoUpdate(paused: Boolean): ApiResponse<HermesStatus> = http.put("/api/hermes/auto-update") { setBody(HermesAutoUpdateInput(paused)) }
}
