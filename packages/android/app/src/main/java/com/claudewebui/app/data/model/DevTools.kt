package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ============================================================================
// Web preview
//
// Note: the preview routes answer with the bare object, not the usual
// ApiResponse envelope, so these are deserialized directly.
// ============================================================================

@Serializable
data class PreviewConfig(
    val enabled: Boolean = false,
    val hostname: String? = null,
)

@Serializable
data class PreviewPort(
    val port: Int,
    val name: String = "",
    val source: String = "",
    val reachable: Boolean = false,
    val status: Int? = null,
    val title: String? = null,
    val contentType: String? = null,
    val error: String? = null,
)

@Serializable
data class PreviewPortScan(
    val projectPath: String? = null,
    val scannedAt: String = "",
    val ports: List<PreviewPort> = emptyList(),
)

@Serializable
data class PreviewProcess(
    val name: String = "",
    val command: String = "",
    val running: Boolean = false,
    val pid: Int? = null,
    val status: String = "",
    val startedAt: String? = null,
    val exitCode: Int? = null,
    val error: String? = null,
    val outputTail: List<String> = emptyList(),
)

@Serializable
data class PreviewStartInput(val projectPath: String, val script: String = "")

// ============================================================================
// GitHub
// ============================================================================

/**
 * GitHub payloads keep the API's snake_case: the backend service forwards
 * GitHub's own field names rather than remapping them.
 */
@Serializable
data class GitHubUser(
    val login: String = "",
    val name: String? = null,
    val email: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("public_repos") val publicRepos: Int = 0,
)

@Serializable
data class GitHubTokenStatus(
    val valid: Boolean = false,
    val user: GitHubUser? = null,
    val scopes: List<String> = emptyList(),
    val error: String? = null,
)

@Serializable
data class GitHubRepo(
    val name: String = "",
    @SerialName("full_name") val fullName: String = "",
    val description: String? = null,
    val private: Boolean = false,
    @SerialName("html_url") val htmlUrl: String = "",
    @SerialName("clone_url") val cloneUrl: String = "",
    @SerialName("default_branch") val defaultBranch: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    val language: String? = null,
    val size: Long = 0,
)

@Serializable
data class GitHubRepoPage(
    val repos: List<GitHubRepo> = emptyList(),
    val hasMore: Boolean = false,
)

@Serializable
data class CreateRepoInput(
    val name: String,
    val description: String? = null,
    val private: Boolean = false,
    @SerialName("auto_init") val autoInit: Boolean = true,
)

@Serializable
data class CloneRepoInput(
    val url: String,
    val targetDir: String,
    val branch: String? = null,
)

@Serializable
data class PushInput(
    val workingDirectory: String,
    val remote: String? = null,
    val branch: String? = null,
    val force: Boolean? = null,
)

// ============================================================================
// Oracle browser
// ============================================================================

@Serializable
data class OracleViewport(
    val width: Int = 1280,
    val height: Int = 720,
)

@Serializable
data class OracleBrowserState(
    val sessionId: String = "",
    val status: String = "idle",
    val running: Boolean = false,
    val mode: String = "profile",
    val chatgptUrl: String = "",
    val currentUrl: String? = null,
    val title: String? = null,
    val profileDir: String = "",
    val debugPort: Int? = null,
    val remoteChromeTarget: String? = null,
    val oracleWillAttachToEmbeddedBrowser: Boolean = false,
    val startedAt: String? = null,
    val stoppedAt: String? = null,
    val lastFrameAt: String? = null,
    val viewport: OracleViewport = OracleViewport(),
    val message: String = "",
    val error: String? = null,
    val outputTail: String = "",
)

@Serializable
data class OracleStartInput(val url: String? = null)

@Serializable
data class OracleNavigateInput(val url: String)

@Serializable
data class OracleClickInput(
    val xRatio: Float,
    val yRatio: Float,
    val button: String = "left",
)

@Serializable
data class OracleWheelInput(
    val xRatio: Float,
    val yRatio: Float,
    val deltaX: Float = 0f,
    val deltaY: Float,
)

@Serializable
data class OracleKeyInput(
    val key: String,
    val code: String? = null,
    val altKey: Boolean = false,
    val ctrlKey: Boolean = false,
    val metaKey: Boolean = false,
    val shiftKey: Boolean = false,
)

@Serializable
data class OracleTextInput(val text: String)

// ── gh-backed collaboration surface ─────────────────────────────────────────
// Mirrors the WebUI's GitHubPanel. Served by /api/github/{pulls,runs,issues,
// releases}, which shell out to the deployment-wide authenticated gh CLI, so
// none of this needs a per-user personal access token.

@Serializable
data class GitHubCheckRollup(
    val state: String = "",
    val total: Int = 0,
    val failed: Int = 0,
)

@Serializable
data class GitHubPullRequest(
    val number: Int,
    val title: String = "",
    val state: String = "",
    val isDraft: Boolean = false,
    val author: String = "",
    val headRefName: String = "",
    val baseRefName: String = "",
    val url: String = "",
    val statusCheckRollup: GitHubCheckRollup? = null,
)

@Serializable
data class GitHubWorkflowRun(
    val databaseId: Long,
    val name: String = "",
    val displayTitle: String = "",
    val status: String = "",
    val conclusion: String? = null,
    val headBranch: String = "",
    val url: String = "",
    val createdAt: String = "",
)

@Serializable
data class GitHubIssue(
    val number: Int,
    val title: String = "",
    val state: String = "",
    val author: String = "",
    val url: String = "",
    val labels: List<String> = emptyList(),
)

@Serializable
data class GitHubRelease(
    val tagName: String = "",
    val name: String = "",
    val isDraft: Boolean = false,
    val isLatest: Boolean = false,
    val isPrerelease: Boolean = false,
    val publishedAt: String? = null,
)

@Serializable
data class GitHubRepoInfo(
    val nameWithOwner: String = "",
    val url: String = "",
)

@Serializable
data class CreatePullRequestInput(
    val workingDirectory: String,
    val title: String,
    val body: String? = null,
    val base: String? = null,
    val head: String? = null,
    val draft: Boolean = false,
)

@Serializable
data class CreateIssueInput(
    val workingDirectory: String,
    val title: String,
    val body: String? = null,
)

@Serializable
data class MergePullRequestInput(
    val workingDirectory: String,
    val method: String = "squash",
    val deleteBranch: Boolean = false,
)

@Serializable
data class RerunWorkflowInput(
    val workingDirectory: String,
    val failedOnly: Boolean = true,
)

@Serializable
data class CreatedUrl(val url: String = "")
