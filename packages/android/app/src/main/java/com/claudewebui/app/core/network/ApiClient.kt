package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Non-2xx from the backend, reduced to a message a user can act on. The server
 * message wins when the body was the backend's JSON error envelope.
 */
class ApiHttpException(
    val status: Int,
    path: String,
    serverMessage: String? = null,
) : Exception(
    serverMessage ?: when (status) {
        502, 503, 504 -> "Server unavailable ($status) — it may be restarting. Try again shortly."
        401, 403 -> "Not authorized ($status) — sign in again."
        404 -> "Not found ($status): $path"
        429 -> "Rate limited (429) — wait a moment and retry."
        else -> "Server error ($status) on $path"
    }
)

/**
 * Central HTTP client for all REST API communication with the Plum Code WebUI backend.
 * Uses Ktor with OkHttp engine, kotlinx.serialization for JSON, and automatic
 * bearer token injection via [AuthInterceptorPlugin].
 */
class ApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }

    private val client = HttpClient(OkHttp) {
        // A 5xx from a restarting backend (or Traefik in front of it) carries a
        // text/plain body; without expectSuccess Ktor would try to decode that
        // as JSON and surface a raw NoTransformationFoundException dialog.
        // Fail with a readable message instead, and ride out short blips by
        // retrying idempotent GETs.
        expectSuccess = true
        HttpResponseValidator {
            handleResponseExceptionWithRequest { exception, request ->
                val response = (exception as? ResponseException)?.response
                    ?: return@handleResponseExceptionWithRequest
                // Backend errors ship {success:false, error:{message}} — keep
                // that message when present; proxy errors are plain text and
                // fall back to a status-based one.
                val serverMessage = runCatching {
                    this@ApiClient.json
                        .decodeFromString<ApiResponse<JsonElement>>(response.bodyAsText())
                        .error?.message
                }.getOrNull()
                throw ApiHttpException(
                    status = response.status.value,
                    path = request.url.encodedPath,
                    serverMessage = serverMessage,
                )
            }
        }
        install(HttpRequestRetry) {
            maxRetries = 2
            retryIf { req, response ->
                req.method == HttpMethod.Get && response.status.value in 500..599
            }
            exponentialDelay()
        }
        install(ContentNegotiation) {
            json(this@ApiClient.json)
        }
        install(AuthInterceptorPlugin)
        install(Logging) {
            level = LogLevel.NONE // Set to LogLevel.BODY for debugging
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 30_000
        }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
    }

    private val baseUrl: String
        get() = TokenStore.getServerUrl() ?: "http://localhost:3001"

    private fun url(path: String): String = "$baseUrl$path"

    /** Encode one Express route segment without turning spaces into '+'. */
    private fun pathSegment(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    // ========================================================================
    // Auth
    // ========================================================================

    /** POST /auth/dev-login */
    suspend fun devLogin(request: LoginRequest): ApiResponse<LoginResponse> =
        client.post(url("/auth/dev-login")) {
            setBody(request)
        }.body()

    /** POST /auth/logout */
    suspend fun logout(): ApiResponse<Unit> =
        client.post(url("/auth/logout")).body()

    /** GET /auth/me */
    suspend fun me(): ApiResponse<AuthUser> =
        client.get(url("/auth/me")).body()

    /** GET /auth/providers */
    suspend fun authProviders(): ApiResponse<AuthProviders> =
        client.get(url("/auth/providers")).body()

    /** Exchange the short-lived Authelia handoff code for a Plum JWT. */
    suspend fun mobileAuthExchange(request: MobileAuthExchangeRequest): ApiResponse<LoginResponse> =
        client.post(url("/auth/mobile/exchange")) {
            setBody(request)
        }.body()

    /** POST /api/basic-auth/login */
    suspend fun basicAuthLogin(request: BasicAuthLoginRequest): ApiResponse<LoginResponse> =
        client.post(url("/api/basic-auth/login")) {
            setBody(request)
        }.body()

    // ========================================================================
    // Sessions
    // ========================================================================

    /** GET /api/sessions */
    suspend fun getSessions(): ApiResponse<List<Session>> =
        client.get(url("/api/sessions")).body()

    /** GET /api/sessions/:id */
    suspend fun getSession(id: String): ApiResponse<Session> =
        client.get(url("/api/sessions/$id")).body()

    /** POST /api/sessions */
    suspend fun createSession(input: CreateSessionInput): ApiResponse<Session> =
        client.post(url("/api/sessions")) {
            setBody(input)
        }.body()

    /** PUT /api/sessions/:id */
    suspend fun updateSession(id: String, input: UpdateSessionInput): ApiResponse<Session> =
        client.put(url("/api/sessions/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/sessions/:id */
    suspend fun deleteSession(id: String): ApiResponse<Unit> =
        client.delete(url("/api/sessions/$id")).body()

    /** PATCH /api/sessions/:id/star — returns only the new flag, not a Session. */
    suspend fun starSession(id: String): ApiResponse<StarResult> =
        client.patch(url("/api/sessions/$id/star")).body()

    /** PATCH /api/sessions/:id/provider */
    suspend fun switchProvider(id: String, input: SwitchProviderInput): ApiResponse<Session> =
        client.patch(url("/api/sessions/$id/provider")) {
            setBody(input)
        }.body()

    /** PATCH /api/sessions/:id/model — null restores the provider default. */
    suspend fun setSessionModel(id: String, model: String?): ApiResponse<Session> =
        client.patch(url("/api/sessions/$id/model")) {
            setBody(mapOf("model" to model))
        }.body()

    /**
     * PATCH /api/sessions/:id/styles — per-session design/writing preset.
     * Sending null clears the preset; omitted keys stay untouched.
     */
    suspend fun setSessionStyles(
        id: String,
        designStyleSkill: String? = null,
        writingStyleSkill: String? = null,
        clearDesign: Boolean = false,
        clearWriting: Boolean = false,
    ): ApiResponse<Session> =
        client.patch(url("/api/sessions/$id/styles")) {
            setBody(
                buildMap<String, String?> {
                    if (designStyleSkill != null || clearDesign) put("designStyleSkill", designStyleSkill)
                    if (writingStyleSkill != null || clearWriting) put("writingStyleSkill", writingStyleSkill)
                }
            )
        }.body()

    /** PATCH /api/sessions/:id/reasoning */
    suspend fun setSessionReasoning(id: String, reasoning: String?): ApiResponse<Session> =
        client.patch(url("/api/sessions/$id/reasoning")) {
            setBody(mapOf("reasoning" to reasoning))
        }.body()

    suspend fun getAllowedDirectories(id: String): ApiResponse<List<String>> =
        client.get(url("/api/sessions/$id/allowed-directories")).body()

    suspend fun addAllowedDirectory(id: String, directory: String): ApiResponse<List<String>> =
        client.post(url("/api/sessions/$id/allowed-directories")) {
            setBody(mapOf("directory" to directory))
        }.body()

    suspend fun removeAllowedDirectory(id: String, directory: String): ApiResponse<List<String>> =
        client.delete(url("/api/sessions/$id/allowed-directories")) {
            parameter("directory", directory)
        }.body()

    /** GET /api/sessions/:id/chats — chat threads inside one session. */
    suspend fun getSessionChats(id: String): ApiResponse<SessionChatList> =
        client.get(url("/api/sessions/$id/chats")).body()

    /** POST /api/sessions/:id/chats — new thread with fresh context, auto-activated. */
    suspend fun createSessionChat(id: String, title: String? = null): ApiResponse<SessionChatList> =
        client.post(url("/api/sessions/$id/chats")) {
            setBody(if (title != null) mapOf("title" to title) else emptyMap<String, String>())
        }.body()

    /** POST /api/sessions/:id/chats/:chatId/activate — switch threads. */
    suspend fun activateSessionChat(id: String, chatId: String): ApiResponse<SessionChatList> =
        client.post(url("/api/sessions/$id/chats/$chatId/activate")).body()

    /** DELETE /api/sessions/:id/chats/:chatId — drop a thread and its messages. */
    suspend fun deleteSessionChat(id: String, chatId: String): ApiResponse<SessionChatList> =
        client.delete(url("/api/sessions/$id/chats/$chatId")).body()

    /**
     * POST /api/permissions/respond — answer a hooks-based permission request.
     * The socket has no handler for this; REST is the only working path
     * (mirrors the WebUI frontend).
     */
    suspend fun respondToPermission(input: PermissionResponse): PermissionRespondResult =
        client.post(url("/api/permissions/respond")) {
            setBody(input)
        }.body()

    /** GET /api/permissions/pending/:sessionId — outstanding approval prompts. */
    suspend fun getPendingPermissions(sessionId: String): ApiResponse<List<PendingPermissionItem>> =
        client.get(url("/api/permissions/pending/${pathSegment(sessionId)}")).body()

    /** POST /api/opencode/questions/respond — answer an OpenCode question prompt. */
    suspend fun respondToQuestion(
        requestId: String,
        answers: List<List<String>>,
        providerSessionId: String?
    ): ApiResponse<Unit> =
        client.post(url("/api/opencode/questions/respond")) {
            setBody(QuestionRespondInput(requestId, answers, providerSessionId))
        }.body()

    /** POST /api/opencode/questions/reject — dismiss an OpenCode question prompt. */
    suspend fun rejectQuestion(requestId: String, providerSessionId: String?): ApiResponse<Unit> =
        client.post(url("/api/opencode/questions/reject")) {
            setBody(QuestionRejectInput(requestId, providerSessionId))
        }.body()

    /**
     * GET /api/sessions/:id/messages. The newest page is returned when
     * [before] is null; subsequent calls page backwards from the oldest id.
     */
    suspend fun getMessages(
        sessionId: String,
        limit: Int = 200,
        before: String? = null,
        after: String? = null,
        around: String? = null,
        chatId: String? = null,
    ): MessagePageResponse<Message> =
        client.get(url("/api/sessions/${pathSegment(sessionId)}/messages")) {
            parameter("limit", limit)
            before?.let { parameter("before", it) }
            after?.let { parameter("after", it) }
            around?.let { parameter("around", it) }
            chatId?.let { parameter("chatId", it) }
        }.body()

    /** Full-text search scoped to one session. */
    suspend fun searchSessionMessages(
        sessionId: String,
        query: String,
        limit: Int = 50,
    ): ApiResponse<List<MessageSearchResult>> =
        client.get(url("/api/sessions/${pathSegment(sessionId)}/messages/search")) {
            parameter("q", query)
            parameter("limit", limit)
        }.body()

    /** Full-text search across all sessions owned by the current user. */
    suspend fun searchMessages(query: String, limit: Int = 50): ApiResponse<List<MessageSearchResult>> =
        client.get(url("/api/sessions/messages/search")) {
            parameter("q", query)
            parameter("limit", limit)
        }.body()

    /** Create a resumable chat upload before sending its id over Socket.IO. */
    suspend fun createChatUpload(
        sessionId: String,
        input: CreateChatUploadInput,
    ): ApiResponse<ChatUpload> =
        client.post(url("/api/sessions/${pathSegment(sessionId)}/uploads")) {
            setBody(input)
        }.body()

    /** Upload one idempotent binary chunk. Re-sending the same index is safe. */
    suspend fun putChatUploadChunk(
        sessionId: String,
        uploadId: String,
        index: Int,
        bytes: ByteArray,
        byteOffset: Long,
        totalBytes: Long,
    ): ApiResponse<ChatUpload> =
        client.put(
            url(
                "/api/sessions/${pathSegment(sessionId)}/uploads/" +
                    "${pathSegment(uploadId)}/chunks/$index"
            )
        ) {
            contentType(ContentType.Application.OctetStream)
            header("X-Chunk-SHA256", sha256Hex(bytes))
            header(
                HttpHeaders.ContentRange,
                "bytes $byteOffset-${byteOffset + bytes.size - 1}/$totalBytes",
            )
            setBody(bytes)
        }.body()

    suspend fun getChatUpload(sessionId: String, uploadId: String): ApiResponse<ChatUpload> =
        client.get(
            url(
                "/api/sessions/${pathSegment(sessionId)}/uploads/${pathSegment(uploadId)}"
            )
        ).body()

    suspend fun cancelChatUpload(sessionId: String, uploadId: String): ApiResponse<ChatUpload> =
        client.delete(
            url(
                "/api/sessions/${pathSegment(sessionId)}/uploads/${pathSegment(uploadId)}"
            )
        ).body()

    suspend fun getSessionReadState(sessionId: String): ApiResponse<SessionReadState> =
        client.get(url("/api/sessions/${pathSegment(sessionId)}/read-state")).body()

    suspend fun updateSessionReadState(
        sessionId: String,
        chatId: String?,
        lastReadMessageId: String?,
    ): ApiResponse<SessionReadState> =
        client.put(url("/api/sessions/${pathSegment(sessionId)}/read-state")) {
            setBody(
                mapOf(
                    "chatId" to chatId,
                    "lastReadMessageId" to lastReadMessageId,
                )
            )
        }.body()

    private fun sha256Hex(bytes: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }

    /** Authenticated bytes for a durable chat attachment. */
    suspend fun getSessionMedia(sessionId: String, mediaId: String): ByteArray =
        client.get(
            url(
                "/api/sessions/${pathSegment(sessionId)}/media/${pathSegment(mediaId)}"
            )
        ).body()

    /** PATCH /api/sessions/:id/category — returns only the assignment, not a Session. */
    suspend fun updateSessionCategory(id: String, categoryId: String?): ApiResponse<CategoryAssignment> =
        client.patch(url("/api/sessions/$id/category")) {
            setBody(mapOf("categoryId" to categoryId))
        }.body()

    // ========================================================================
    // Files
    // ========================================================================

    /**
     * GET /api/files?path=:path — directory listing.
     *
     * The router mounts this on the collection root; there is no `/directory`
     * sub-path, and calling one returned HTML 404 that failed to decode.
     */
    suspend fun getDirectory(path: String): ApiResponse<DirectoryContents> =
        client.get(url("/api/files")) {
            parameter("path", path)
        }.body()

    /** GET /api/files/home — returns homeDir plus allowed/common paths. */
    suspend fun getHomePaths(): ApiResponse<HomePaths> =
        client.get(url("/api/files/home")).body()

    /** POST /api/files/upload (multipart; multer only accepts the field name "files"). */
    suspend fun uploadFile(
        sessionId: String,
        fileName: String,
        fileBytes: ByteArray,
        mimeType: String
    ): ApiResponse<JsonElement> =
        client.submitFormWithBinaryData(
            url = url("/api/files/upload"),
            formData = formData {
                append("sessionId", sessionId)
                append("files", fileBytes, Headers.build {
                    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                    append(HttpHeaders.ContentType, mimeType)
                })
            }
        ).body()

    /** GET /api/files/content — read a text file (server rejects >1 MB). */
    suspend fun getFileContent(path: String): ApiResponse<FileContent> =
        client.get(url("/api/files/content")) {
            parameter("path", path)
        }.body()

    /** PUT /api/files/content — write a file back to the workspace. */
    suspend fun saveFileContent(path: String, content: String): ApiResponse<JsonElement> =
        client.put(url("/api/files/content")) {
            setBody(SaveFileInput(path, content))
        }.body()

    // ========================================================================
    // Notes
    // ========================================================================

    /** GET /api/notes/session/:sessionId — notes attached to one session. */
    suspend fun getSessionNotes(sessionId: String): ApiResponse<List<Note>> =
        client.get(url("/api/notes/session/$sessionId")).body()

    /** POST /api/notes */
    suspend fun createNote(input: CreateNoteInput): ApiResponse<Note> =
        client.post(url("/api/notes")) { setBody(input) }.body()

    /** PATCH /api/notes/:id */
    suspend fun updateNote(id: String, input: UpdateNoteInput): ApiResponse<Note> =
        client.patch(url("/api/notes/$id")) { setBody(input) }.body()

    /** DELETE /api/notes/:id */
    suspend fun deleteNote(id: String): ApiResponse<Unit> =
        client.delete(url("/api/notes/$id")).body()

    // ========================================================================
    // Git
    // ========================================================================

    /** GET /api/git/status?path=:path */
    suspend fun gitStatus(path: String): ApiResponse<GitStatus> =
        client.get(url("/api/git/status")) {
            parameter("path", path)
        }.body()

    /** GET /api/git/log?path=:path&limit=:limit */
    suspend fun gitLog(path: String, limit: Int = 50): ApiResponse<List<GitCommit>> =
        client.get(url("/api/git/log")) {
            parameter("path", path)
            parameter("limit", limit)
        }.body()

    /** GET /api/git/diff?path=:path — the server returns one raw unified-diff string. */
    suspend fun gitDiff(path: String): ApiResponse<GitDiffText> =
        client.get(url("/api/git/diff")) {
            parameter("path", path)
        }.body()

    /** GET /api/git/diff-staged?path=:path — staged changes as one diff string. */
    suspend fun gitDiffStaged(path: String): ApiResponse<GitDiffText> =
        client.get(url("/api/git/diff-staged")) {
            parameter("path", path)
        }.body()

    /** POST /api/git/stage — empty/omitted files stages everything. */
    suspend fun gitStage(path: String, files: List<String>? = null): ApiResponse<JsonElement> =
        client.post(url("/api/git/stage")) {
            setBody(mapOf("path" to path, "files" to files))
        }.body()

    /** POST /api/git/commit — commits whatever is staged; stage first. */
    suspend fun gitCommit(path: String, input: GitCommitInput): ApiResponse<GitCommitResult> =
        client.post(url("/api/git/commit")) {
            setBody(mapOf("path" to path, "message" to input.message))
        }.body()

    /** POST /api/git/pull */
    suspend fun gitPull(path: String): ApiResponse<JsonElement> =
        client.post(url("/api/git/pull")) {
            setBody(mapOf("path" to path))
        }.body()

    /** GET /api/git/branches?path=:path */
    suspend fun gitBranches(path: String): ApiResponse<List<GitBranch>> =
        client.get(url("/api/git/branches")) {
            parameter("path", path)
        }.body()

    // ========================================================================
    // Settings
    // ========================================================================

    /** GET /api/settings */
    suspend fun getSettings(): ApiResponse<UserSettings> =
        client.get(url("/api/settings")).body()

    /** PUT /api/settings */
    suspend fun updateSettings(input: UpdateSettingsInput): ApiResponse<UserSettings> =
        client.put(url("/api/settings")) {
            setBody(input)
        }.body()

    // ========================================================================
    // Categories
    // ========================================================================

    /** GET /api/categories */
    suspend fun getCategories(): ApiResponse<List<Category>> =
        client.get(url("/api/categories")).body()

    /** POST /api/categories */
    suspend fun createCategory(input: CreateCategoryInput): ApiResponse<Category> =
        client.post(url("/api/categories")) {
            setBody(input)
        }.body()

    /** PATCH /api/categories/:id */
    suspend fun updateCategory(id: String, input: UpdateCategoryInput): ApiResponse<Category> =
        client.patch(url("/api/categories/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/categories/:id */
    suspend fun deleteCategory(id: String): ApiResponse<Unit> =
        client.delete(url("/api/categories/$id")).body()

    // ========================================================================
    // Checkpoints
    // ========================================================================

    /** GET /api/checkpoints/sessions/:sessionId */
    suspend fun getCheckpoints(sessionId: String): ApiResponse<List<Checkpoint>> =
        client.get(url("/api/checkpoints/sessions/$sessionId")).body()

    /** POST /api/checkpoints — sessionId travels in the body, not the path. */
    suspend fun createCheckpoint(
        sessionId: String,
        input: CreateCheckpointInput
    ): ApiResponse<Checkpoint> =
        client.post(url("/api/checkpoints")) {
            setBody(mapOf(
                "sessionId" to sessionId,
                "name" to input.name,
                "description" to input.description,
            ))
        }.body()

    /** POST /api/checkpoints/:checkpointId/restore */
    suspend fun restoreCheckpoint(checkpointId: String): ApiResponse<JsonElement> =
        client.post(url("/api/checkpoints/$checkpointId/restore")).body()

    /** DELETE /api/checkpoints/:checkpointId */
    suspend fun deleteCheckpoint(checkpointId: String): ApiResponse<Unit> =
        client.delete(url("/api/checkpoints/$checkpointId")).body()

    // ========================================================================
    // CLI Providers
    // ========================================================================

    /** GET /api/cli-providers */
    suspend fun getCLIProviders(): ApiResponse<List<CLIProviderConfig>> =
        client.get(url("/api/cli-providers")).body()

    // ========================================================================
    // MCP Servers
    // ========================================================================

    /** GET /api/mcp-servers */
    suspend fun getMcpServers(): ApiResponse<List<McpServer>> =
        client.get(url("/api/mcp-servers")).body()

    /** POST /api/mcp-servers */
    suspend fun createMcpServer(input: CreateMcpServerInput): ApiResponse<McpServer> =
        client.post(url("/api/mcp-servers")) {
            setBody(input)
        }.body()

    /** PUT /api/mcp-servers/:id */
    suspend fun updateMcpServer(id: String, input: UpdateMcpServerInput): ApiResponse<McpServer> =
        client.put(url("/api/mcp-servers/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/mcp-servers/:id */
    suspend fun deleteMcpServer(id: String): ApiResponse<Unit> =
        client.delete(url("/api/mcp-servers/$id")).body()

    /**
     * POST /api/mcp-servers/:id/test — actually spawn the subprocess (or open
     * the SSE URL) and report whether it came up. Admin-only.
     */
    suspend fun testMcpServer(id: String): ApiResponse<McpTestResult> =
        client.post(url("/api/mcp-servers/$id/test")).body()

    // ========================================================================
    // CLI Tools
    // ========================================================================

    /** GET /api/cli-tools */
    suspend fun getCliTools(): ApiResponse<List<JsonElement>> =
        client.get(url("/api/cli-tools")).body()

    /** POST /api/cli-tools */
    suspend fun createCliTool(input: JsonElement): ApiResponse<JsonElement> =
        client.post(url("/api/cli-tools")) {
            setBody(input)
        }.body()

    /** PUT /api/cli-tools/:id */
    suspend fun updateCliTool(id: String, input: JsonElement): ApiResponse<JsonElement> =
        client.put(url("/api/cli-tools/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/cli-tools/:id */
    suspend fun deleteCliTool(id: String): ApiResponse<Unit> =
        client.delete(url("/api/cli-tools/$id")).body()

    // ========================================================================
    // CLI harness login
    // ========================================================================

    /** POST /api/cli-login/:provider/start — spawns the harness's auth command. */
    suspend fun startCliLogin(provider: String): ApiResponse<CliLoginSession> =
        client.post(url("/api/cli-login/$provider/start")).body()

    /** GET /api/cli-login/:id — poll for the code, URL, or completion. */
    suspend fun getCliLogin(id: String): ApiResponse<CliLoginSession> =
        client.get(url("/api/cli-login/$id")).body()

    /** POST /api/cli-login/:id/code — answer a prompt that wants a pasted code. */
    suspend fun submitCliLoginCode(id: String, code: String): ApiResponse<CliLoginSession> =
        client.post(url("/api/cli-login/$id/code")) {
            setBody(CliLoginCodeInput(code))
        }.body()

    /** DELETE /api/cli-login/:id — abandon the run. */
    suspend fun cancelCliLogin(id: String): ApiResponse<Unit> =
        client.delete(url("/api/cli-login/$id")).body()

    // ========================================================================
    // Custom Agents
    // ========================================================================

    /** GET /api/agents */
    suspend fun getAgents(): ApiResponse<List<CustomAgent>> =
        client.get(url("/api/agents")).body()

    /** GET /api/agents/:id */
    suspend fun getAgent(id: String): ApiResponse<CustomAgent> =
        client.get(url("/api/agents/$id")).body()

    /** POST /api/agents */
    suspend fun createAgent(input: CreateCustomAgentInput): ApiResponse<CustomAgent> =
        client.post(url("/api/agents")) {
            setBody(input)
        }.body()

    /** PUT /api/agents/:id */
    suspend fun updateAgent(id: String, input: UpdateCustomAgentInput): ApiResponse<CustomAgent> =
        client.put(url("/api/agents/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/agents/:id */
    suspend fun deleteAgent(id: String): ApiResponse<Unit> =
        client.delete(url("/api/agents/$id")).body()

    // ========================================================================
    // Claude config library (skills / agents / plugins / styles on disk)
    // ========================================================================

    /**
     * GET /api/claude-config/skills — the on-disk skill catalogue.
     *
     * `library` selects the catalogue slice: `skill` (default) returns coding
     * skills only, `all` additionally folds in the design and writing style
     * presets, `design` / `writing` return just those.
     */
    suspend fun getConfigSkills(library: String = "skill"): ApiResponse<List<ConfigSkill>> =
        client.get(url("/api/claude-config/skills")) {
            parameter("library", library)
        }.body()

    /** GET /api/claude-config/agents — agents defined as markdown in `~/.claude/agents`. */
    suspend fun getConfigAgents(): ApiResponse<List<ConfigAgent>> =
        client.get(url("/api/claude-config/agents")).body()

    /** GET /api/claude-config/plugins */
    suspend fun getConfigPlugins(): ApiResponse<List<ConfigPlugin>> =
        client.get(url("/api/claude-config/plugins")).body()

    /** GET /api/claude-config/style-library */
    suspend fun getStyleLibrary(): ApiResponse<StyleLibrary> =
        client.get(url("/api/claude-config/style-library")).body()

    /**
     * PUT /api/claude-config/skill/:name/toggle
     *
     * These three routes flip the stored state themselves and ignore the
     * request body, so there is no desired-state parameter — the response
     * reports which way it landed. Admin-only on the server.
     */
    suspend fun toggleConfigSkill(name: String): ApiResponse<ToggleResult> =
        client.put(url("/api/claude-config/skill/${pathSegment(name)}/toggle")).body()

    /** PUT /api/claude-config/agent/:name/toggle */
    suspend fun toggleConfigAgent(name: String): ApiResponse<ToggleResult> =
        client.put(url("/api/claude-config/agent/${pathSegment(name)}/toggle")).body()

    /** PUT /api/claude-config/plugin/:name/toggle */
    suspend fun toggleConfigPlugin(name: String): ApiResponse<ToggleResult> =
        client.put(url("/api/claude-config/plugin/${pathSegment(name)}/toggle")).body()

    suspend fun getConfigAgent(name: String): ApiResponse<ConfigAgentContent> =
        client.get(url("/api/claude-config/agent/${pathSegment(name)}")).body()

    suspend fun saveConfigAgent(
        key: String?,
        input: SaveConfigAgentInput,
    ): ApiResponse<ConfigAgent> = if (key == null) {
        client.post(url("/api/claude-config/agents")) { setBody(input) }.body()
    } else {
        client.put(url("/api/claude-config/agent/${pathSegment(key)}")) { setBody(input) }.body()
    }

    suspend fun deleteConfigAgent(name: String): ApiResponse<Unit> =
        client.delete(url("/api/claude-config/agent/${pathSegment(name)}")).body()

    suspend fun getConfigSkill(name: String): ApiResponse<ConfigSkillContent> =
        client.get(url("/api/claude-config/skill/${pathSegment(name)}")).body()

    suspend fun saveConfigSkill(
        key: String?,
        input: SaveConfigSkillInput,
    ): ApiResponse<ConfigSkill> = if (key == null) {
        client.post(url("/api/claude-config/skills")) { setBody(input) }.body()
    } else {
        client.put(url("/api/claude-config/skill/${pathSegment(key)}")) { setBody(input) }.body()
    }

    suspend fun deleteConfigSkill(name: String): ApiResponse<Unit> =
        client.delete(url("/api/claude-config/skill/${pathSegment(name)}")).body()

    suspend fun getConfigPlugin(name: String): ApiResponse<ConfigPluginContent> =
        client.get(url("/api/claude-config/plugin/${pathSegment(name)}")).body()

    suspend fun saveConfigPlugin(
        key: String?,
        input: SaveConfigPluginInput,
    ): ApiResponse<ConfigPlugin> = if (key == null) {
        client.post(url("/api/claude-config/plugins")) { setBody(input) }.body()
    } else {
        client.put(url("/api/claude-config/plugin/${pathSegment(key)}")) { setBody(input) }.body()
    }

    suspend fun deleteConfigPlugin(id: String): ApiResponse<Unit> =
        client.delete(url("/api/claude-config/plugin/${pathSegment(id)}")).body()

    suspend fun getConfigMarketplaces(): ApiResponse<List<ConfigMarketplace>> =
        client.get(url("/api/claude-config/marketplaces")).body()

    suspend fun installConfigPlugin(input: InstallPluginInput): ApiResponse<ConfigPlugin> =
        client.post(url("/api/claude-config/plugins/install")) { setBody(input) }.body()

    suspend fun getZaiApi(): ApiResponse<ZaiApiStatus> =
        client.get(url("/api/settings/zai-api")).body()

    suspend fun updateZaiApi(input: UpdateZaiApiInput): ApiResponse<ZaiApiStatus> =
        client.put(url("/api/settings/zai-api")) { setBody(input) }.body()

    suspend fun deleteZaiApi(): ApiResponse<Unit> =
        client.delete(url("/api/settings/zai-api")).body()

    suspend fun getOpenCodeProviders(): ApiResponse<List<OpenCodeProvider>> =
        client.get(url("/api/opencode/providers")).body()

    suspend fun saveOpenCodeProvider(input: SaveOpenCodeProviderInput): ApiResponse<OpenCodeProvider> =
        client.put(url("/api/opencode/providers")) { setBody(input) }.body()

    suspend fun deleteOpenCodeProvider(id: String): ApiResponse<Unit> =
        client.delete(url("/api/opencode/providers/${pathSegment(id)}")).body()

    suspend fun testOpenCodeProvider(id: String): ApiResponse<OpenCodeProviderTest> =
        client.post(url("/api/opencode/providers/${pathSegment(id)}/test")).body()

    // ========================================================================
    // Slash commands
    // ========================================================================

    /** GET /api/commands */
    suspend fun getCommands(): ApiResponse<List<SlashCommand>> =
        client.get(url("/api/commands")).body()

    // ========================================================================
    // Analytics
    // ========================================================================

    /** GET /api/analytics/summary — the same unified ledger used by the WebUI. */
    suspend fun getAnalyticsSummary(
        period: String,
        timezoneOffsetMinutes: Int,
        offset: Int = 0
    ): ApiResponse<JsonElement> =
        client.get(url("/api/analytics/summary")) {
            parameter("period", period)
            parameter("tz", timezoneOffsetMinutes)
            parameter("offset", offset)
        }.body()

    /** GET /api/analytics/timeline — real token, cost and request history. */
    suspend fun getAnalyticsTimeline(
        period: String,
        timezoneOffsetMinutes: Int,
        offset: Int = 0,
        granularity: String = if (period == "24h") "hour" else "day"
    ): ApiResponse<JsonElement> =
        client.get(url("/api/analytics/timeline")) {
            parameter("period", period)
            parameter("tz", timezoneOffsetMinutes)
            parameter("offset", offset)
            parameter("granularity", granularity)
        }.body()

    // ========================================================================
    // Usage
    // ========================================================================

    /** GET /api/analytics/sessions/:sessionId — per-session token totals + history. */
    suspend fun getSessionUsage(sessionId: String): ApiResponse<JsonElement> =
        client.get(url("/api/analytics/sessions/$sessionId")).body()

    /**
     * GET /api/usage/limits?provider=:provider — live account quota.
     *
     * Answers `supported = false` (with an explanatory error, still HTTP 200)
     * for harnesses that have no account of their own, so callers should check
     * [UsageLimitsResponse.supported] rather than treating it as a failure.
     */
    suspend fun getUsageLimits(provider: String): UsageLimitsResponse =
        client.get(url("/api/usage/limits")) {
            parameter("provider", provider)
        }.body()

    // ========================================================================
    // App Version
    // ========================================================================

    /** GET /api/app/version — returns latest Android APK metadata */
    suspend fun checkAppVersion(): ApiResponse<AppVersionInfo> =
        client.get(url("/api/app/version")).body()

    // ========================================================================
    // Memories
    // ========================================================================

    /** GET /api/memories?workingDirectory=:cwd */
    suspend fun getMemories(workingDirectory: String): ApiResponse<MemoryListing> =
        client.get(url("/api/memories")) {
            parameter("workingDirectory", workingDirectory)
        }.body()

    /** GET /api/memories/content?path=:path&workingDirectory=:cwd */
    suspend fun getMemoryContent(path: String, workingDirectory: String): ApiResponse<MemoryContent> =
        client.get(url("/api/memories/content")) {
            parameter("path", path)
            parameter("workingDirectory", workingDirectory)
        }.body()

    /** PUT /api/memories/content */
    suspend fun saveMemoryContent(
        path: String,
        content: String,
        workingDirectory: String,
    ): ApiResponse<JsonElement> =
        client.put(url("/api/memories/content")) {
            setBody(SaveMemoryInput(workingDirectory, path, content))
        }.body()

    /** POST /api/memories — create a new memory file. */
    suspend fun createMemory(
        name: String,
        content: String,
        workingDirectory: String,
    ): ApiResponse<JsonElement> =
        client.post(url("/api/memories")) {
            setBody(CreateMemoryInput(workingDirectory, name, content))
        }.body()

    /** DELETE /api/memories?path=:path&workingDirectory=:cwd — params, not a body. */
    suspend fun deleteMemory(path: String, workingDirectory: String): ApiResponse<JsonElement> =
        client.delete(url("/api/memories")) {
            parameter("path", path)
            parameter("workingDirectory", workingDirectory)
        }.body()

    // ========================================================================
    // Integrations (ComfyUI / Discord / Home Assistant)
    // ========================================================================

    /** GET /api/comfyui/settings */
    suspend fun getComfyUiSettings(): ApiResponse<ComfyUiSettings> =
        client.get(url("/api/comfyui/settings")).body()

    /** PUT /api/comfyui/settings — admin-only; url must be absolute. */
    suspend fun updateComfyUiSettings(url: String?, enabled: Boolean?): ApiResponse<ComfyUiSettings> =
        client.put(url("/api/comfyui/settings")) {
            setBody(
                buildMap<String, Any> {
                    url?.let { put("url", it) }
                    enabled?.let { put("enabled", it) }
                }
            )
        }.body()

    /** PUT /api/discord/settings — webhook or bot transport. */
    suspend fun updateDiscordSettings(input: UpdateDiscordSettingsInput): ApiResponse<DiscordSettings> =
        client.put(url("/api/discord/settings")) { setBody(input) }.body()

    /** PUT /api/home-assistant/settings — admin-only. */
    suspend fun updateHomeAssistantSettings(
        input: UpdateHomeAssistantSettingsInput,
    ): ApiResponse<HomeAssistantSettings> =
        client.put(url("/api/home-assistant/settings")) { setBody(input) }.body()

    /** PUT /api/basic-auth/credentials — rotate the local login. */
    suspend fun updateBasicAuthCredentials(
        currentPassword: String,
        newUsername: String?,
        newPassword: String?,
    ): ApiResponse<JsonElement> =
        client.put(url("/api/basic-auth/credentials")) {
            setBody(
                buildMap<String, String> {
                    put("currentPassword", currentPassword)
                    newUsername?.takeIf { it.isNotBlank() }?.let { put("newUsername", it) }
                    newPassword?.takeIf { it.isNotBlank() }?.let { put("newPassword", it) }
                }
            )
        }.body()

    /** GET /api/comfyui/test — probes ComfyUI's /system_stats. */
    suspend fun testComfyUi(): ApiResponse<JsonElement> =
        client.get(url("/api/comfyui/test")).body()

    /** GET /api/discord/settings */
    suspend fun getDiscordSettings(): ApiResponse<DiscordSettings> =
        client.get(url("/api/discord/settings")).body()

    /** POST /api/discord/test */
    suspend fun testDiscord(): ApiResponse<JsonElement> =
        client.post(url("/api/discord/test")).body()

    /** GET /api/home-assistant/settings */
    suspend fun getHomeAssistantSettings(): ApiResponse<HomeAssistantSettings> =
        client.get(url("/api/home-assistant/settings")).body()

    /** POST /api/home-assistant/test */
    suspend fun testHomeAssistant(): ApiResponse<JsonElement> =
        client.post(url("/api/home-assistant/test")).body()

    // ========================================================================
    // Operations (Docker / watchdogs)
    // ========================================================================

    /** GET /api/docker/status */
    suspend fun getDockerStatus(): ApiResponse<DockerStatus> =
        client.get(url("/api/docker/status")).body()

    /** GET /api/docker/containers */
    suspend fun getDockerContainers(): ApiResponse<List<DockerContainer>> =
        client.get(url("/api/docker/containers")).body()

    /** GET /api/watchdogs — admin-only; a non-admin gets 403. */
    suspend fun getWatchdogs(): ApiResponse<List<Watchdog>> =
        client.get(url("/api/watchdogs")).body()

    // ========================================================================
    // Admin
    // ========================================================================

    /** GET /api/admin/stats */
    suspend fun getAdminStats(): ApiResponse<AdminStats> =
        client.get(url("/api/admin/stats")).body()

    /** GET /api/admin/users */
    suspend fun getAdminUsers(): ApiResponse<List<AdminUser>> =
        client.get(url("/api/admin/users")).body()

    /** GET /api/admin/audit-log */
    suspend fun getAuditLog(limit: Int = 50): ApiResponse<AuditLogPage> =
        client.get(url("/api/admin/audit-log")) {
            parameter("limit", limit)
        }.body()

    // ========================================================================
    // Web preview
    //
    // These routes answer with the bare object rather than the ApiResponse
    // envelope used elsewhere, so the return types are the payloads directly.
    // ========================================================================

    /** GET /api/preview/config */
    suspend fun getPreviewConfig(): PreviewConfig =
        client.get(url("/api/preview/config")).body()

    /** GET /api/preview/ports — probes the common dev-server ports. */
    suspend fun getPreviewPorts(projectPath: String? = null): PreviewPortScan =
        client.get(url("/api/preview/ports")) {
            projectPath?.let { parameter("projectPath", it) }
        }.body()

    /** POST /api/preview/start */
    suspend fun startPreview(projectPath: String, script: String = ""): PreviewProcess =
        client.post(url("/api/preview/start")) {
            setBody(PreviewStartInput(projectPath, script))
        }.body()

    /** POST /api/preview/stop */
    suspend fun stopPreview(projectPath: String, script: String = ""): PreviewProcess =
        client.post(url("/api/preview/stop")) {
            setBody(PreviewStartInput(projectPath, script))
        }.body()

    // ========================================================================
    // GitHub
    // ========================================================================

    /** GET /api/github/token/validate */
    suspend fun validateGitHubToken(): ApiResponse<GitHubTokenStatus> =
        client.get(url("/api/github/token/validate")).body()

    /** GET /api/github/user */
    suspend fun getGitHubUser(): ApiResponse<GitHubUser> =
        client.get(url("/api/github/user")).body()

    /** GET /api/github/repos */
    suspend fun getGitHubRepos(): ApiResponse<GitHubRepoPage> =
        client.get(url("/api/github/repos")).body()

    /** POST /api/github/repos */
    suspend fun createGitHubRepo(input: CreateRepoInput): ApiResponse<GitHubRepo> =
        client.post(url("/api/github/repos")) {
            setBody(input)
        }.body()

    /** POST /api/github/clone */
    suspend fun cloneGitHubRepo(
        repoUrl: String,
        targetDir: String,
        branch: String? = null,
    ): ApiResponse<JsonElement> =
        client.post(url("/api/github/clone")) {
            setBody(CloneRepoInput(repoUrl, targetDir, branch))
        }.body()

    /** POST /api/github/push */
    suspend fun pushToGitHub(
        workingDirectory: String,
        remote: String? = null,
        branch: String? = null,
        force: Boolean = false,
    ): ApiResponse<JsonElement> =
        client.post(url("/api/github/push")) {
            setBody(PushInput(workingDirectory, remote, branch, force))
        }.body()

    // ── gh-backed: pull requests, CI runs, issues, releases ──────────────────

    /** GET /api/github/cli/repo */
    suspend fun getGitHubRepoInfo(workingDirectory: String): ApiResponse<GitHubRepoInfo> =
        client.get(url("/api/github/cli/repo")) {
            parameter("workingDirectory", workingDirectory)
        }.body()

    /** GET /api/github/pulls */
    suspend fun getGitHubPullRequests(
        workingDirectory: String,
        state: String = "open",
        limit: Int = 20,
    ): ApiResponse<List<GitHubPullRequest>> =
        client.get(url("/api/github/pulls")) {
            parameter("workingDirectory", workingDirectory)
            parameter("state", state)
            parameter("limit", limit)
        }.body()

    /** POST /api/github/pulls */
    suspend fun createGitHubPullRequest(input: CreatePullRequestInput): ApiResponse<CreatedUrl> =
        client.post(url("/api/github/pulls")) { setBody(input) }.body()

    /** POST /api/github/pulls/:number/merge */
    suspend fun mergeGitHubPullRequest(
        number: Int,
        input: MergePullRequestInput,
    ): ApiResponse<JsonElement> =
        client.post(url("/api/github/pulls/$number/merge")) { setBody(input) }.body()

    /** GET /api/github/runs */
    suspend fun getGitHubRuns(
        workingDirectory: String,
        limit: Int = 20,
    ): ApiResponse<List<GitHubWorkflowRun>> =
        client.get(url("/api/github/runs")) {
            parameter("workingDirectory", workingDirectory)
            parameter("limit", limit)
        }.body()

    /** POST /api/github/runs/:id/rerun */
    suspend fun rerunGitHubWorkflow(
        runId: Long,
        input: RerunWorkflowInput,
    ): ApiResponse<JsonElement> =
        client.post(url("/api/github/runs/$runId/rerun")) { setBody(input) }.body()

    /** GET /api/github/issues */
    suspend fun getGitHubIssues(
        workingDirectory: String,
        state: String = "open",
        limit: Int = 20,
    ): ApiResponse<List<GitHubIssue>> =
        client.get(url("/api/github/issues")) {
            parameter("workingDirectory", workingDirectory)
            parameter("state", state)
            parameter("limit", limit)
        }.body()

    /** POST /api/github/issues */
    suspend fun createGitHubIssue(input: CreateIssueInput): ApiResponse<CreatedUrl> =
        client.post(url("/api/github/issues")) { setBody(input) }.body()

    /** GET /api/github/releases */
    suspend fun getGitHubReleases(
        workingDirectory: String,
        limit: Int = 20,
    ): ApiResponse<List<GitHubRelease>> =
        client.get(url("/api/github/releases")) {
            parameter("workingDirectory", workingDirectory)
            parameter("limit", limit)
        }.body()

    // ========================================================================
    // Control gateway tokens, discovered projects, Codex plugins
    // (previously WebUI-only surfaces)
    // ========================================================================

    /** POST /api/app/crash-report — sent once on the start after a crash. */
    suspend fun reportCrash(input: CrashReportInput): ApiResponse<JsonElement> =
        client.post(url("/api/app/crash-report")) { setBody(input) }.body()

    /** GET /api/gateway/tokens */
    suspend fun getGatewayTokens(): ApiResponse<List<GatewayToken>> =
        client.get(url("/api/gateway/tokens")).body()

    /** POST /api/gateway/tokens — the only response that carries the secret. */
    suspend fun createGatewayToken(
        name: String,
        scope: String = "write",
    ): ApiResponse<GatewayToken> =
        client.post(url("/api/gateway/tokens")) {
            setBody(CreateGatewayTokenInput(name, scope))
        }.body()

    /** DELETE /api/gateway/tokens/:id */
    suspend fun revokeGatewayToken(id: String): ApiResponse<JsonElement> =
        client.delete(url("/api/gateway/tokens/$id")).body()

    /** GET /api/projects */
    suspend fun getDiscoveredProjects(): ApiResponse<List<DiscoveredProject>> =
        client.get(url("/api/projects")).body()

    /** GET /api/codex/plugins */
    suspend fun getCodexPlugins(): ApiResponse<List<CodexPlugin>> =
        client.get(url("/api/codex/plugins")).body()

    /** POST /api/codex/plugins/:id — enable or disable. */
    suspend fun setCodexPluginEnabled(id: String, enabled: Boolean): ApiResponse<JsonElement> =
        client.post(url("/api/codex/plugins/$id")) {
            setBody(CodexPluginToggleInput(enabled))
        }.body()

    /** POST /api/codex/plugins/install — admin-only on the server. */
    suspend fun installCodexPlugin(
        pluginName: String,
        marketplaceId: String,
    ): ApiResponse<JsonElement> =
        client.post(url("/api/codex/plugins/install")) {
            setBody(CodexPluginInstallInput(pluginName, marketplaceId))
        }.body()

    // ========================================================================
    // Oracle browser
    // ========================================================================

    suspend fun getOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState> =
        client.get(url("/api/oracle/browser/$sessionId")).body()

    suspend fun startOracleBrowser(
        sessionId: String,
        targetUrl: String?,
    ): ApiResponse<OracleBrowserState> =
        client.post(url("/api/oracle/browser/$sessionId/start")) {
            setBody(OracleStartInput(targetUrl))
        }.body()

    suspend fun stopOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState> =
        client.post(url("/api/oracle/browser/$sessionId/stop")).body()

    suspend fun reloadOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState> =
        client.post(url("/api/oracle/browser/$sessionId/reload")).body()

    suspend fun navigateOracleBrowser(
        sessionId: String,
        targetUrl: String,
    ): ApiResponse<OracleBrowserState> =
        client.post(url("/api/oracle/browser/$sessionId/navigate")) {
            setBody(OracleNavigateInput(targetUrl))
        }.body()

    suspend fun getOracleFrame(sessionId: String): ByteArray =
        client.get(url("/api/oracle/browser/$sessionId/frame")).body()

    suspend fun clickOracleBrowser(sessionId: String, xRatio: Float, yRatio: Float) {
        client.post(url("/api/oracle/browser/$sessionId/click")) {
            setBody(OracleClickInput(xRatio, yRatio))
        }
    }

    suspend fun wheelOracleBrowser(sessionId: String, deltaY: Float) {
        client.post(url("/api/oracle/browser/$sessionId/wheel")) {
            setBody(OracleWheelInput(.5f, .5f, deltaY = deltaY))
        }
    }

    suspend fun keyOracleBrowser(sessionId: String, key: String, code: String? = null) {
        client.post(url("/api/oracle/browser/$sessionId/key")) {
            setBody(OracleKeyInput(key, code))
        }
    }

    suspend fun textOracleBrowser(sessionId: String, text: String) {
        client.post(url("/api/oracle/browser/$sessionId/text")) {
            setBody(OracleTextInput(text))
        }
    }

    // ========================================================================
    // Android test devices (android-app-creator bridge)
    // ========================================================================

    suspend fun getAndroidDevices(sessionId: String? = null): ApiResponse<AndroidDeviceSnapshot> =
        client.get(url("/api/android/devices")) {
            sessionId?.let { parameter("sessionId", it) }
        }.body()

    suspend fun reconnectAndroidDevices(): ApiResponse<AndroidDeviceSnapshot> =
        client.post(url("/api/android/devices/reconnect-all")).body()

    suspend fun pairAndroidDevice(input: AndroidPairInput): ApiResponse<JsonElement> =
        client.post(url("/api/android/devices/pair")) { setBody(input) }.body()

    suspend fun connectAndroidDevice(input: AndroidConnectInput): ApiResponse<JsonElement> =
        client.post(url("/api/android/devices/connect")) { setBody(input) }.body()

    suspend fun disconnectAndroidDevice(serial: String): ApiResponse<JsonElement> =
        client.post(url("/api/android/devices/${pathSegment(serial)}/disconnect")).body()

    suspend fun forgetAndroidDevice(serial: String): ApiResponse<JsonElement> =
        client.delete(url("/api/android/devices/${pathSegment(serial)}")).body()

    suspend fun getAndroidEmulatorStatus(): ApiResponse<AndroidEmulatorStatus> =
        client.get(url("/api/android/emulator/status")).body()

    suspend fun startAndroidEmulator(): ApiResponse<JsonElement> =
        client.post(url("/api/android/emulator/start")) { setBody(emptyMap<String, String>()) }.body()

    suspend fun stopAndroidEmulator(): ApiResponse<JsonElement> =
        client.post(url("/api/android/emulator/stop")) { setBody(emptyMap<String, String>()) }.body()

    // ========================================================================
    // Workspace: templates, notifications, drafts, turn diffs, transcription
    // ========================================================================

    suspend fun getSessionTemplates(): ApiResponse<List<SessionTemplate>> =
        client.get(url("/api/workspace/templates")).body()

    suspend fun createSessionTemplate(
        input: CreateSessionTemplateInput,
    ): ApiResponse<SessionTemplate> =
        client.post(url("/api/workspace/templates")) { setBody(input) }.body()

    suspend fun deleteSessionTemplate(id: String): ApiResponse<Unit> =
        client.delete(url("/api/workspace/templates/${pathSegment(id)}")).body()

    /**
     * Whole transcript as Markdown. Returns raw text rather than an ApiResponse
     * envelope — the same endpoint doubles as the WebUI's file download.
     */
    suspend fun exportSessionTranscript(sessionId: String): String =
        client.get(url("/api/sessions/${pathSegment(sessionId)}/export")).bodyAsText()

    suspend fun getNotifications(limit: Int = 50): ApiResponse<NotificationFeed> =
        client.get(url("/api/workspace/notifications")) { parameter("limit", limit) }.body()

    /** Empty [ids] marks the whole feed read. */
    suspend fun markNotificationsRead(ids: List<String> = emptyList()): ApiResponse<Unit> =
        client.post(url("/api/workspace/notifications/read")) {
            setBody(if (ids.isEmpty()) emptyMap<String, String>() else mapOf("ids" to ids))
        }.body()

    suspend fun clearNotifications(): ApiResponse<Unit> =
        client.delete(url("/api/workspace/notifications")).body()

    /** Fires one sample notification through database, socket and web push. */
    suspend fun sendTestNotification(): ApiResponse<Unit> =
        client.post(url("/api/workspace/notifications/test")) {
            setBody(emptyMap<String, String>())
        }.body()

    suspend fun getSessionDraft(sessionId: String, chatId: String? = null): ApiResponse<SessionDraft> =
        client.get(url("/api/workspace/sessions/${pathSegment(sessionId)}/draft")) {
            parameter("chatId", chatId.orEmpty())
        }.body()

    suspend fun putSessionDraft(
        sessionId: String,
        content: String,
        chatId: String? = null,
    ): ApiResponse<Unit> =
        client.put(url("/api/workspace/sessions/${pathSegment(sessionId)}/draft")) {
            setBody(mapOf("content" to content, "chatId" to chatId.orEmpty()))
        }.body()

    suspend fun getTurnDiffs(sessionId: String, limit: Int = 20): ApiResponse<List<TurnDiffSummary>> =
        client.get(url("/api/workspace/sessions/${pathSegment(sessionId)}/turn-diffs")) {
            parameter("limit", limit)
        }.body()

    suspend fun getTurnDiff(diffId: String): ApiResponse<TurnDiffDetail> =
        client.get(url("/api/workspace/turn-diffs/${pathSegment(diffId)}")).body()

    /** Whether the server has a transcription backend configured. */
    suspend fun transcriptionAvailable(): ApiResponse<JsonElement> =
        client.get(url("/api/transcribe/status")).body()

    suspend fun transcribe(audio: ByteArray, fileName: String = "speech.m4a"): ApiResponse<TranscriptionResult> =
        client.submitFormWithBinaryData(
            url = url("/api/transcribe"),
            formData = formData {
                append("audio", audio, Headers.build {
                    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                    append(HttpHeaders.ContentType, "audio/mp4")
                })
            }
        ).body()

    /** Archive, restore, star or delete many sessions in one call. */
    suspend fun bulkSessions(input: BulkSessionInput): ApiResponse<JsonElement> =
        client.post(url("/api/sessions/bulk")) { setBody(input) }.body()

    /** `archived = true` swaps the list over to the archive. */
    suspend fun getSessions(archived: Boolean): ApiResponse<List<Session>> =
        client.get(url("/api/sessions")) { if (archived) parameter("archived", "1") }.body()

    /** GET /api/sessions/:id/peers — connected sessions in the mesh. */
    suspend fun getSessionPeers(sessionId: String): ApiResponse<List<SessionPeerLink>> =
        client.get(url("/api/sessions/${'$'}{pathSegment(sessionId)}/peers")).body()

    suspend fun gitCheckout(path: String, branch: String, create: Boolean = false): ApiResponse<JsonElement> =
        client.post(url("/api/git/checkout")) {
            setBody(GitCheckoutInput(path, branch, create))
        }.body()

    // ========================================================================
    // Health
    // ========================================================================

    /** GET /health */
    suspend fun health(): HttpResponse =
        client.get(url("/health"))

    // ========================================================================
    // Lifecycle
    // ========================================================================

    fun close() {
        client.close()
    }
}
