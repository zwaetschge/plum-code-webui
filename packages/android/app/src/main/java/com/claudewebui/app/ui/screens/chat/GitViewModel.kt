package com.claudewebui.app.ui.screens.chat

import android.content.Context
import com.claudewebui.app.R
import com.claudewebui.app.core.network.apiCall

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.GitBranch
import com.claudewebui.app.data.model.GitCommit
import com.claudewebui.app.data.model.GitCommitInput
import com.claudewebui.app.data.model.GitFileDiff
import com.claudewebui.app.data.model.GitStatus
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class GitUiState(
    val workingDirectory: String = "",
    val gitStatus: GitStatus? = null,
    val commits: List<GitCommit> = emptyList(),
    val diffs: List<GitFileDiff> = emptyList(),
    val branches: List<GitBranch> = emptyList(),
    val isLoading: Boolean = false,
    val isCommitting: Boolean = false,
    val isPushing: Boolean = false,
    val error: String? = null
)

class GitViewModel(
    private val sessionId: String,
    private val apiClient: ApiClient,
    private val sessionRepository: SessionRepository,
    private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GitUiState())
    val uiState: StateFlow<GitUiState> = _uiState.asStateFlow()

    init {
        loadSessionAndGit()
    }

    private fun loadSessionAndGit() {
        viewModelScope.launch {
            // Get working directory from session
            val session = sessionRepository.getSession(sessionId).getOrNull()
            val workingDir = session?.workingDirectory ?: ""
            _uiState.value = _uiState.value.copy(workingDirectory = workingDir)
            if (workingDir.isNotEmpty()) {
                refreshGitStatus(workingDir)
            }
        }
    }

    fun refreshGitStatus() {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        refreshGitStatus(workingDir)
    }

    private fun refreshGitStatus(path: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            // Each call fails independently — a broken diff must not blank the
            // whole panel.
            val status = apiCall { apiClient.gitStatus(path) }.getOrNull()
            val log = apiCall { apiClient.gitLog(path) }.getOrNull()
            val unstagedDiff = apiCall { apiClient.gitDiff(path) }.getOrNull()
            val stagedDiff = apiCall { apiClient.gitDiffStaged(path) }.getOrNull()
            val branches = apiCall { apiClient.gitBranches(path) }.getOrNull()

            val diffs =
                parseUnifiedDiff(stagedDiff?.data?.diff.orEmpty(), staged = true) +
                    parseUnifiedDiff(unstagedDiff?.data?.diff.orEmpty(), staged = false)

            _uiState.value = _uiState.value.copy(
                isLoading = false,
                gitStatus = if (status?.success == true) status.data else null,
                commits = if (log?.success == true) log.data ?: emptyList() else emptyList(),
                diffs = diffs,
                branches = if (branches?.success == true) branches.data ?: emptyList() else emptyList(),
                error = if (status == null) appContext.getString(R.string.chat_git_load_failed) else null,
            )
        }
    }

    fun stageAll() {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        viewModelScope.launch {
            apiCall { apiClient.gitStage(workingDir) }
                .onFailure { e -> _uiState.value = _uiState.value.copy(error = e.userMessage(appContext)) }
            refreshGitStatus(workingDir)
        }
    }

    fun commit(message: String) {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isCommitting = true, error = null)
            apiCall {
                // The commit route only commits what is staged; stage first or
                // it always answers NO_STAGED_CHANGES.
                apiClient.gitStage(workingDir)
                val response = apiClient.gitCommit(workingDir, GitCommitInput(message = message))
                if (!response.success) {
                    error(response.error?.message ?: appContext.getString(R.string.chat_commit_failed))
                }
                refreshGitStatus(workingDir)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.userMessage(appContext))
            }
            _uiState.value = _uiState.value.copy(isCommitting = false)
        }
    }

    fun push() {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isPushing = true, error = null)
            apiCall {
                val response = apiClient.pushToGitHub(workingDir)
                if (!response.success) {
                    error(response.error?.message ?: appContext.getString(R.string.chat_push_failed))
                }
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.userMessage(appContext))
            }
            _uiState.value = _uiState.value.copy(isPushing = false)
        }
    }

    /**
     * Check out an existing branch. The server refuses while the tree is dirty
     * so uncommitted agent work is never dragged onto another branch.
     */
    fun switchBranch(branch: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(error = null)
            val workingDir = _uiState.value.workingDirectory
            val result = apiCall { apiClient.gitCheckout(workingDir, branch) }
            result.exceptionOrNull()?.let { failure ->
                _uiState.value = _uiState.value.copy(error = failure.userMessage(appContext))
            }
            refreshGitStatus()
        }
    }

    /** Fast-forward from the remote and refresh the view. */
    fun pull() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(error = null)
            val workingDir = _uiState.value.workingDirectory
            val result = apiCall { apiClient.gitPull(workingDir) }
            result.exceptionOrNull()?.let { failure ->
                _uiState.value = _uiState.value.copy(error = failure.userMessage(appContext))
            }
            refreshGitStatus()
        }
    }
}

/**
 * Split one raw unified-diff string into per-file entries for the diff list.
 * The server returns `git diff` output verbatim; the UI wants files.
 */
internal fun parseUnifiedDiff(raw: String, staged: Boolean): List<GitFileDiff> {
    if (raw.isBlank()) return emptyList()
    val sections = raw.split(Regex("(?m)^diff --git ")).filter { it.isNotBlank() }
    return sections.mapNotNull { section ->
        val header = section.lineSequence().firstOrNull() ?: return@mapNotNull null
        // Header form: `a/path b/path`
        val file = Regex("b/(.+)$").find(header.trim())?.groupValues?.get(1)
            ?: header.substringAfterLast(' ').removePrefix("b/")
        val body = "diff --git " + section
        val additions = section.lineSequence().count { it.startsWith("+") && !it.startsWith("+++") }
        val deletions = section.lineSequence().count { it.startsWith("-") && !it.startsWith("---") }
        GitFileDiff(
            file = file,
            diff = body,
            additions = additions,
            deletions = deletions,
            staged = staged,
        )
    }
}
