package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/github` — token, repos, clone/push, and the gh-backed PR/CI/issue routes. */
interface GitHubApi {
    /** GET /api/github/token/validate */
    suspend fun validateGitHubToken(): ApiResponse<GitHubTokenStatus>

    /** GET /api/github/user */
    suspend fun getGitHubUser(): ApiResponse<GitHubUser>

    /** GET /api/github/repos */
    suspend fun getGitHubRepos(): ApiResponse<GitHubRepoPage>

    /** POST /api/github/repos */
    suspend fun createGitHubRepo(input: CreateRepoInput): ApiResponse<GitHubRepo>

    /** POST /api/github/clone */
    suspend fun cloneGitHubRepo(
        repoUrl: String,
        targetDir: String,
        branch: String? = null,
    ): ApiResponse<JsonElement>

    /** POST /api/github/push */
    suspend fun pushToGitHub(
        workingDirectory: String,
        remote: String? = null,
        branch: String? = null,
        force: Boolean = false,
    ): ApiResponse<JsonElement>

    // ── gh-backed: pull requests, CI runs, issues, releases ──────────────────

    /** GET /api/github/cli/repo */
    suspend fun getGitHubRepoInfo(workingDirectory: String): ApiResponse<GitHubRepoInfo>

    /** GET /api/github/pulls */
    suspend fun getGitHubPullRequests(
        workingDirectory: String,
        state: String = "open",
        limit: Int = 20,
    ): ApiResponse<List<GitHubPullRequest>>

    /** POST /api/github/pulls */
    suspend fun createGitHubPullRequest(input: CreatePullRequestInput): ApiResponse<CreatedUrl>

    /** POST /api/github/pulls/:number/merge */
    suspend fun mergeGitHubPullRequest(
        number: Int,
        input: MergePullRequestInput,
    ): ApiResponse<JsonElement>

    /** GET /api/github/runs */
    suspend fun getGitHubRuns(
        workingDirectory: String,
        limit: Int = 20,
    ): ApiResponse<List<GitHubWorkflowRun>>

    /** POST /api/github/runs/:id/rerun */
    suspend fun rerunGitHubWorkflow(
        runId: Long,
        input: RerunWorkflowInput,
    ): ApiResponse<JsonElement>

    /** GET /api/github/issues */
    suspend fun getGitHubIssues(
        workingDirectory: String,
        state: String = "open",
        limit: Int = 20,
    ): ApiResponse<List<GitHubIssue>>

    /** POST /api/github/issues */
    suspend fun createGitHubIssue(input: CreateIssueInput): ApiResponse<CreatedUrl>

    /** GET /api/github/releases */
    suspend fun getGitHubReleases(
        workingDirectory: String,
        limit: Int = 20,
    ): ApiResponse<List<GitHubRelease>>
}

class GitHubApiImpl(private val http: ApiHttp) : GitHubApi {

    override suspend fun validateGitHubToken(): ApiResponse<GitHubTokenStatus> =
        http.get("/api/github/token/validate")

    override suspend fun getGitHubUser(): ApiResponse<GitHubUser> =
        http.get("/api/github/user")

    override suspend fun getGitHubRepos(): ApiResponse<GitHubRepoPage> =
        http.get("/api/github/repos")

    override suspend fun createGitHubRepo(input: CreateRepoInput): ApiResponse<GitHubRepo> =
        http.post("/api/github/repos") { setBody(input) }

    override suspend fun cloneGitHubRepo(
        repoUrl: String,
        targetDir: String,
        branch: String?,
    ): ApiResponse<JsonElement> =
        http.post("/api/github/clone") { setBody(CloneRepoInput(repoUrl, targetDir, branch)) }

    override suspend fun pushToGitHub(
        workingDirectory: String,
        remote: String?,
        branch: String?,
        force: Boolean,
    ): ApiResponse<JsonElement> =
        http.post("/api/github/push") { setBody(PushInput(workingDirectory, remote, branch, force)) }

    override suspend fun getGitHubRepoInfo(workingDirectory: String): ApiResponse<GitHubRepoInfo> =
        http.get("/api/github/cli/repo") { parameter("workingDirectory", workingDirectory) }

    override suspend fun getGitHubPullRequests(
        workingDirectory: String,
        state: String,
        limit: Int,
    ): ApiResponse<List<GitHubPullRequest>> =
        http.get("/api/github/pulls") {
            parameter("workingDirectory", workingDirectory)
            parameter("state", state)
            parameter("limit", limit)
        }

    override suspend fun createGitHubPullRequest(input: CreatePullRequestInput): ApiResponse<CreatedUrl> =
        http.post("/api/github/pulls") { setBody(input) }

    override suspend fun mergeGitHubPullRequest(
        number: Int,
        input: MergePullRequestInput,
    ): ApiResponse<JsonElement> =
        http.post("/api/github/pulls/$number/merge") { setBody(input) }

    override suspend fun getGitHubRuns(
        workingDirectory: String,
        limit: Int,
    ): ApiResponse<List<GitHubWorkflowRun>> =
        http.get("/api/github/runs") {
            parameter("workingDirectory", workingDirectory)
            parameter("limit", limit)
        }

    override suspend fun rerunGitHubWorkflow(
        runId: Long,
        input: RerunWorkflowInput,
    ): ApiResponse<JsonElement> =
        http.post("/api/github/runs/$runId/rerun") { setBody(input) }

    override suspend fun getGitHubIssues(
        workingDirectory: String,
        state: String,
        limit: Int,
    ): ApiResponse<List<GitHubIssue>> =
        http.get("/api/github/issues") {
            parameter("workingDirectory", workingDirectory)
            parameter("state", state)
            parameter("limit", limit)
        }

    override suspend fun createGitHubIssue(input: CreateIssueInput): ApiResponse<CreatedUrl> =
        http.post("/api/github/issues") { setBody(input) }

    override suspend fun getGitHubReleases(
        workingDirectory: String,
        limit: Int,
    ): ApiResponse<List<GitHubRelease>> =
        http.get("/api/github/releases") {
            parameter("workingDirectory", workingDirectory)
            parameter("limit", limit)
        }
}
