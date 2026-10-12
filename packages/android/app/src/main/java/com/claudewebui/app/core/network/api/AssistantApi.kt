package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.setBody
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.JsonObject
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
    suspend fun getAssistantResources(collection: String, offset: Int = 0, search: String? = null, status: String? = null, sort: String? = null): ApiResponse<List<AssistantResource>>
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
    suspend fun getAssistantApiImage(id: String, assetId: String): ByteArray
    suspend fun uploadAssistantApiImage(owner: String, id: String, filename: String, mimeType: String, bytes: ByteArray): ApiResponse<AssistantApiImage>
    suspend fun transcribeAssistantAudio(owner: String, bytes: ByteArray): ApiResponse<JsonObject>
    suspend fun speakAssistantText(owner: String, text: String, voice: String, language: String): ByteArray
    suspend fun deliverAssistantApiCommand(owner: String, path: String, payload: JsonObject): ApiResponse<JsonObject>
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
    suspend fun getAssistantMatrixMedia(roomId: String, eventId: String): ByteArray
}

class AssistantApiImpl(private val http: ApiHttp) : AssistantApi {
    private fun checked(value: String): String {
        require(value.matches(Regex("[A-Za-z0-9_-]+"))) { "Invalid assistant resource identifier" }
        return value
    }
    override suspend fun getAssistantResources(collection: String, offset: Int, search: String?, status: String?, sort: String?): ApiResponse<List<AssistantResource>> = http.get("/api/assistant/${checked(collection)}") { url { parameters.append("limit", "100"); parameters.append("offset",offset.coerceAtLeast(0).toString()); search?.let { parameters.append("search", it) }; status?.takeIf { it.isNotBlank() }?.let { parameters.append("status", it) }; sort?.let { parameters.append("sort", it) } } }
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
    override suspend fun transcribeAssistantAudio(owner: String, bytes: ByteArray): ApiResponse<JsonObject> {
        require(owner == TokenStore.assistantOwnerKey())
        require(bytes.isNotEmpty() && bytes.size <= 20 * 1024 * 1024)
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        val multipart = MultiPartFormDataContent(formData {
            append("language", "de")
            append("file", bytes, Headers.build {
                append(HttpHeaders.ContentType, "audio/mp4")
                append(HttpHeaders.ContentDisposition, "filename=\"dictation.m4a\"")
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
    override suspend fun deliverAssistantApiCommand(owner: String, path: String, payload: JsonObject): ApiResponse<JsonObject> {
        require(path.matches(Regex("^/api/assistant/(?:api-chats(?:/[A-Za-z0-9_-]+/(?:turns|branches|results|selection|turns/[A-Za-z0-9_-]+/stop))?|tasks/[A-Za-z0-9_-]+/(?:results|commands))$")))
        require(owner == TokenStore.assistantOwnerKey())
        val server = requireNotNull(TokenStore.getServerUrl()).trimEnd('/')
        val token = requireNotNull(TokenStore.getToken())
        return http.client.post("$server$path") { attributes.put(AssistantAccountKey, owner); header(HttpHeaders.Authorization, "Bearer $token"); setBody(payload) }.body()
    }
    override suspend fun createAssistantResource(collection: String, input: AssistantResourceInput): ApiResponse<AssistantResource> = http.post("/api/assistant/${checked(collection)}") { setBody(input) }
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
    override suspend fun getAssistantMatrixMedia(roomId: String, eventId: String): ByteArray = http.get("/api/assistant/matrix/rooms/${roomId.encodeURLPathPart()}/events/${eventId.encodeURLPathPart()}/media")
}
