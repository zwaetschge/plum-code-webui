package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/git` — local repository operations on a workspace path. */
interface GitApi {
    /** GET /api/git/status?path=:path */
    suspend fun gitStatus(path: String): ApiResponse<GitStatus>

    /** GET /api/git/log?path=:path&limit=:limit */
    suspend fun gitLog(path: String, limit: Int = 50): ApiResponse<List<GitCommit>>

    /** GET /api/git/diff?path=:path — the server returns one raw unified-diff string. */
    suspend fun gitDiff(path: String): ApiResponse<GitDiffText>

    /** GET /api/git/diff-staged?path=:path — staged changes as one diff string. */
    suspend fun gitDiffStaged(path: String): ApiResponse<GitDiffText>

    /** POST /api/git/stage — empty/omitted files stages everything. */
    suspend fun gitStage(path: String, files: List<String>? = null): ApiResponse<JsonElement>

    /** POST /api/git/commit — commits whatever is staged; stage first. */
    suspend fun gitCommit(path: String, input: GitCommitInput): ApiResponse<GitCommitResult>

    /** POST /api/git/pull */
    suspend fun gitPull(path: String): ApiResponse<JsonElement>

    /** GET /api/git/branches?path=:path */
    suspend fun gitBranches(path: String): ApiResponse<List<GitBranch>>

    /** POST /api/git/checkout */
    suspend fun gitCheckout(path: String, branch: String, create: Boolean = false): ApiResponse<JsonElement>
}

class GitApiImpl(private val http: ApiHttp) : GitApi {

    override suspend fun gitStatus(path: String): ApiResponse<GitStatus> =
        http.get("/api/git/status") { parameter("path", path) }

    override suspend fun gitLog(path: String, limit: Int): ApiResponse<List<GitCommit>> =
        http.get("/api/git/log") {
            parameter("path", path)
            parameter("limit", limit)
        }

    override suspend fun gitDiff(path: String): ApiResponse<GitDiffText> =
        http.get("/api/git/diff") { parameter("path", path) }

    override suspend fun gitDiffStaged(path: String): ApiResponse<GitDiffText> =
        http.get("/api/git/diff-staged") { parameter("path", path) }

    override suspend fun gitStage(path: String, files: List<String>?): ApiResponse<JsonElement> =
        http.post("/api/git/stage") { setBody(mapOf("path" to path, "files" to files)) }

    override suspend fun gitCommit(path: String, input: GitCommitInput): ApiResponse<GitCommitResult> =
        http.post("/api/git/commit") { setBody(mapOf("path" to path, "message" to input.message)) }

    override suspend fun gitPull(path: String): ApiResponse<JsonElement> =
        http.post("/api/git/pull") { setBody(mapOf("path" to path)) }

    override suspend fun gitBranches(path: String): ApiResponse<List<GitBranch>> =
        http.get("/api/git/branches") { parameter("path", path) }

    override suspend fun gitCheckout(path: String, branch: String, create: Boolean): ApiResponse<JsonElement> =
        http.post("/api/git/checkout") { setBody(GitCheckoutInput(path, branch, create)) }
}
