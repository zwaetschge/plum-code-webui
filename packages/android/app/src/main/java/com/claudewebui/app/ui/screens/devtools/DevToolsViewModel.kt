package com.claudewebui.app.ui.screens.devtools

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AndroidConnectInput
import com.claudewebui.app.data.model.AndroidDeviceSnapshot
import com.claudewebui.app.data.model.AndroidEmulatorStatus
import com.claudewebui.app.data.model.AndroidPairInput
import com.claudewebui.app.data.model.CreateIssueInput
import com.claudewebui.app.data.model.CreatePullRequestInput
import com.claudewebui.app.data.model.CreateRepoInput
import com.claudewebui.app.data.model.GitHubIssue
import com.claudewebui.app.data.model.GitHubPullRequest
import com.claudewebui.app.data.model.GitHubRelease
import com.claudewebui.app.data.model.GitHubRepoInfo
import com.claudewebui.app.data.model.GitHubWorkflowRun
import com.claudewebui.app.data.model.MergePullRequestInput
import com.claudewebui.app.data.model.RerunWorkflowInput
import com.claudewebui.app.data.model.GitHubRepo
import com.claudewebui.app.data.model.GitHubTokenStatus
import com.claudewebui.app.data.model.OracleBrowserState
import com.claudewebui.app.data.model.PreviewConfig
import com.claudewebui.app.data.model.PreviewPort
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DevToolsTab { PREVIEW, GITHUB, ORACLE, DEVICES }

data class DevToolsUiState(
    val tab: DevToolsTab = DevToolsTab.PREVIEW,
    val previewConfig: PreviewConfig? = null,
    val ports: List<PreviewPort> = emptyList(),
    val scannedAt: String = "",
    val isScanning: Boolean = false,
    val tokenStatus: GitHubTokenStatus? = null,
    val repos: List<GitHubRepo> = emptyList(),
    val isLoadingGitHub: Boolean = false,
    val gitHubAction: String? = null,
    // gh-backed collaboration data; see GitHubPanel in the WebUI
    val repoInfo: GitHubRepoInfo? = null,
    val pullRequests: List<GitHubPullRequest> = emptyList(),
    val workflowRuns: List<GitHubWorkflowRun> = emptyList(),
    val issues: List<GitHubIssue> = emptyList(),
    val releases: List<GitHubRelease> = emptyList(),
    val isLoadingCollab: Boolean = false,
    val oracle: OracleBrowserState? = null,
    val oracleFrame: ByteArray? = null,
    val isLoadingOracle: Boolean = false,
    val isOracleActionPending: Boolean = false,
    // Android test devices (ADB + shared emulator)
    val deviceSnapshot: AndroidDeviceSnapshot? = null,
    val emulatorStatus: AndroidEmulatorStatus? = null,
    val isLoadingDevices: Boolean = false,
    val isDeviceActionPending: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

/**
 * Dev-server preview ports and the GitHub connection.
 *
 * The preview routes answer without the usual ApiResponse envelope, so their
 * calls are not unwrapped the way the GitHub ones are.
 */
class DevToolsViewModel(
    private val sessionId: String,
    private val workingDirectory: String,
    private val api: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DevToolsUiState())
    val uiState: StateFlow<DevToolsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        scanPorts()
        loadGitHub()
        loadOracle()
    }

    fun selectTab(tab: DevToolsTab) {
        _uiState.update { it.copy(tab = tab) }
        // Devices are polled lazily — the builder bridge is often unreachable
        // and a failed probe on every DevTools open would be pure noise.
        if (tab == DevToolsTab.DEVICES && _uiState.value.deviceSnapshot == null) loadDevices()
        // Same reasoning for gh: four subprocesses per open is worth paying only
        // once the user actually looks at the GitHub tab.
        if (tab == DevToolsTab.GITHUB && _uiState.value.repoInfo == null) loadCollaboration()
    }

    fun scanPorts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isScanning = true, error = null) }
            coroutineScope {
                val config = async { runCatching { api.getPreviewConfig() }.getOrNull() }
                val scan = async {
                    runCatching {
                        api.getPreviewPorts(workingDirectory.takeIf { it.isNotBlank() })
                    }
                }
                val resolvedConfig = config.await()
                scan.await()
                    .onSuccess { result ->
                        _uiState.update {
                            it.copy(
                                previewConfig = resolvedConfig,
                                // Reachable ports first: an unreachable port is
                                // the common case and would otherwise bury the
                                // one server that is actually up.
                                ports = result.ports.sortedWith(
                                    compareByDescending<PreviewPort> { p -> p.reachable }
                                        .thenBy { p -> p.port },
                                ),
                                scannedAt = result.scannedAt,
                                isScanning = false,
                            )
                        }
                    }
                    .onFailure { failure ->
                        _uiState.update {
                            it.copy(
                                previewConfig = resolvedConfig,
                                isScanning = false,
                                error = failure.message,
                            )
                        }
                    }
            }
        }
    }

    fun loadGitHub() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingGitHub = true) }
            coroutineScope {
                val token = async { runCatching { api.validateGitHubToken().data }.getOrNull() }
                val repos = async { runCatching { api.getGitHubRepos().data?.repos }.getOrNull() }
                _uiState.update {
                    it.copy(
                        tokenStatus = token.await(),
                        repos = repos.await().orEmpty(),
                        isLoadingGitHub = false,
                    )
                }
            }
        }
    }

    /**
     * Pull requests, CI runs, issues and releases for this session's checkout.
     * All four load together so switching tabs never shows a stale list.
     */
    fun loadCollaboration() {
        if (workingDirectory.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingCollab = true, error = null) }
            coroutineScope {
                val repo = async { runCatching { api.getGitHubRepoInfo(workingDirectory).data }.getOrNull() }
                val pulls = async { runCatching { api.getGitHubPullRequests(workingDirectory).data }.getOrNull() }
                val runs = async { runCatching { api.getGitHubRuns(workingDirectory).data }.getOrNull() }
                val issues = async { runCatching { api.getGitHubIssues(workingDirectory).data }.getOrNull() }
                val releases = async { runCatching { api.getGitHubReleases(workingDirectory).data }.getOrNull() }
                _uiState.update {
                    it.copy(
                        repoInfo = repo.await(),
                        pullRequests = pulls.await().orEmpty(),
                        workflowRuns = runs.await().orEmpty(),
                        issues = issues.await().orEmpty(),
                        releases = releases.await().orEmpty(),
                        isLoadingCollab = false,
                    )
                }
            }
        }
    }

    fun createPullRequest(title: String, body: String) {
        val cleanTitle = title.trim()
        if (cleanTitle.isEmpty() || workingDirectory.isBlank()) return
        collabAction("Pull request created") {
            api.createGitHubPullRequest(
                CreatePullRequestInput(
                    workingDirectory = workingDirectory,
                    title = cleanTitle,
                    body = body.trim().takeIf(String::isNotEmpty),
                )
            )
        }
    }

    fun mergePullRequest(number: Int) {
        if (workingDirectory.isBlank()) return
        collabAction("Pull request merged") {
            api.mergeGitHubPullRequest(number, MergePullRequestInput(workingDirectory))
        }
    }

    fun rerunWorkflow(runId: Long) {
        if (workingDirectory.isBlank()) return
        collabAction("Re-run requested") {
            api.rerunGitHubWorkflow(runId, RerunWorkflowInput(workingDirectory))
        }
    }

    fun createIssue(title: String, body: String) {
        val cleanTitle = title.trim()
        if (cleanTitle.isEmpty() || workingDirectory.isBlank()) return
        collabAction("Issue created") {
            api.createGitHubIssue(
                CreateIssueInput(
                    workingDirectory = workingDirectory,
                    title = cleanTitle,
                    body = body.trim().takeIf(String::isNotEmpty),
                )
            )
        }
    }

    private fun collabAction(successNotice: String, block: suspend () -> Any?) {
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Working…", error = null) }
            val result = runCatching { block() }
            _uiState.update {
                it.copy(
                    gitHubAction = null,
                    notice = if (result.isSuccess) successNotice else it.notice,
                    error = result.exceptionOrNull()?.message ?: it.error,
                )
            }
            if (result.isSuccess) loadCollaboration()
        }
    }

    fun createRepo(name: String, description: String, isPrivate: Boolean) {
        val cleanName = name.trim()
        if (cleanName.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Creating repository…", error = null) }
            runCatching {
                val response = api.createGitHubRepo(
                    CreateRepoInput(
                        name = cleanName,
                        description = description.trim().takeIf(String::isNotEmpty),
                        private = isPrivate,
                    ),
                )
                if (!response.success) error(response.error?.message ?: "Repository creation failed")
                response
            }.onSuccess { response ->
                _uiState.update {
                    it.copy(notice = "Repository ${response.data?.fullName ?: cleanName} created")
                }
                loadGitHub()
            }.onFailure { failure ->
                _uiState.update { it.copy(error = failure.message ?: "Repository creation failed") }
            }
            _uiState.update { it.copy(gitHubAction = null) }
        }
    }

    fun cloneRepo(repoUrl: String, targetDirectory: String, branch: String = "") {
        val target = targetDirectory.trim()
        if (repoUrl.isBlank() || target.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Cloning repository…", error = null) }
            runCatching {
                val response =
                    api.cloneGitHubRepo(repoUrl, target, branch.trim().takeIf(String::isNotEmpty))
                if (!response.success) error(response.error?.message ?: "Clone failed")
                response
            }.onSuccess {
                _uiState.update { it.copy(notice = "Repository cloned to $target") }
            }.onFailure { failure ->
                _uiState.update { it.copy(error = failure.message ?: "Clone failed") }
            }
            _uiState.update { it.copy(gitHubAction = null) }
        }
    }

    fun push(remote: String = "", branch: String = "", force: Boolean = false) {
        if (workingDirectory.isBlank()) {
            _uiState.update { it.copy(error = "This session has no working directory") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Pushing commits…", error = null) }
            runCatching {
                val response = api.pushToGitHub(
                    workingDirectory,
                    remote.trim().takeIf(String::isNotEmpty),
                    branch.trim().takeIf(String::isNotEmpty),
                    force,
                )
                if (!response.success) error(response.error?.message ?: "Push failed")
                response
            }.onSuccess {
                _uiState.update { it.copy(notice = "Push completed") }
            }.onFailure { failure ->
                _uiState.update { it.copy(error = failure.message ?: "Push failed") }
            }
            _uiState.update { it.copy(gitHubAction = null) }
        }
    }

    fun defaultCloneTarget(repo: GitHubRepo): String {
        val parent = workingDirectory.trimEnd('/').substringBeforeLast('/', "")
        return if (parent.isBlank()) repo.name else "$parent/${repo.name}"
    }

    fun loadOracle(loadFrame: Boolean = true) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingOracle = true) }
            runCatching { api.getOracleBrowser(sessionId) }
                .onSuccess { response ->
                    val browser = response.data
                    _uiState.update {
                        it.copy(
                            oracle = browser,
                            isLoadingOracle = false,
                            error = if (response.success) it.error else response.error?.message,
                        )
                    }
                    if (loadFrame && browser?.running == true) loadOracleFrame()
                }
                .onFailure { failure ->
                    _uiState.update {
                        it.copy(isLoadingOracle = false, error = failure.message)
                    }
                }
        }
    }

    fun loadOracleFrame() {
        viewModelScope.launch {
            runCatching { api.getOracleFrame(sessionId) }
                .onSuccess { frame -> _uiState.update { it.copy(oracleFrame = frame) } }
        }
    }

    private fun oracleAction(action: suspend () -> com.claudewebui.app.data.model.ApiResponse<OracleBrowserState>) {
        viewModelScope.launch {
            _uiState.update { it.copy(isOracleActionPending = true, error = null) }
            runCatching {
                val response = action()
                if (!response.success) {
                    error(response.error?.message ?: "Oracle browser action failed")
                }
                response
            }
                .onSuccess { response ->
                    _uiState.update { it.copy(oracle = response.data) }
                    if (response.data?.running == true) loadOracleFrame()
                }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            _uiState.update { it.copy(isOracleActionPending = false) }
        }
    }

    fun startOracle(targetUrl: String) = oracleAction {
        api.startOracleBrowser(sessionId, targetUrl.trim().takeIf(String::isNotEmpty))
    }

    fun stopOracle() = oracleAction { api.stopOracleBrowser(sessionId) }

    fun reloadOracle() = oracleAction { api.reloadOracleBrowser(sessionId) }

    fun navigateOracle(targetUrl: String) {
        if (targetUrl.isBlank()) return
        oracleAction { api.navigateOracleBrowser(sessionId, targetUrl.trim()) }
    }

    fun clickOracle(xRatio: Float, yRatio: Float) {
        viewModelScope.launch {
            runCatching { api.clickOracleBrowser(sessionId, xRatio, yRatio) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun scrollOracle(deltaY: Float) {
        viewModelScope.launch {
            runCatching { api.wheelOracleBrowser(sessionId, deltaY) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun sendOracleText(text: String) {
        if (text.isEmpty()) return
        viewModelScope.launch {
            runCatching { api.textOracleBrowser(sessionId, text) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun sendOracleKey(key: String, code: String? = null) {
        viewModelScope.launch {
            runCatching { api.keyOracleBrowser(sessionId, key, code) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun startPreview(script: String = "dev") {
        if (workingDirectory.isBlank()) {
            _uiState.update { it.copy(error = "This session has no working directory") }
            return
        }
        viewModelScope.launch {
            // The route requires a script name; "dev" is the convention.
            runCatching { api.startPreview(workingDirectory, script.ifBlank { "dev" }) }
                .onSuccess { process ->
                    _uiState.update {
                        it.copy(
                            notice = process.error
                                ?: "${process.name.ifBlank { "Dev server" }} ${process.status}",
                        )
                    }
                    scanPorts()
                }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null, notice = null) }
    }

    // ── Android test devices ────────────────────────────────────────────────

    /** Live + remembered ADB devices plus the shared emulator's state. */
    fun loadDevices() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingDevices = true) }
            val snapshot = runCatching { api.getAndroidDevices(sessionId).data }.getOrNull()
            val emulator = runCatching { api.getAndroidEmulatorStatus().data }.getOrNull()
            _uiState.update {
                it.copy(
                    deviceSnapshot = snapshot ?: it.deviceSnapshot,
                    emulatorStatus = emulator ?: it.emulatorStatus,
                    isLoadingDevices = false,
                    error = if (snapshot == null) "Android builder unreachable" else it.error,
                )
            }
        }
    }

    /** Runs one device mutation, then refreshes so the list reflects reality. */
    private fun deviceAction(notice: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isDeviceActionPending = true, error = null) }
            val result = runCatching { block() }
            _uiState.update {
                it.copy(
                    isDeviceActionPending = false,
                    notice = if (result.isSuccess) notice else it.notice,
                    error = result.exceptionOrNull()?.message ?: it.error,
                )
            }
            loadDevices()
        }
    }

    fun pairDevice(host: String, port: Int, code: String) = deviceAction("Device paired") {
        api.pairAndroidDevice(AndroidPairInput(sessionId, host, port, code))
    }

    fun connectDevice(
        host: String,
        port: Int,
        friendlyName: String? = null,
        replaceSerial: String? = null,
    ) = deviceAction("Device connected") {
        api.connectAndroidDevice(
            AndroidConnectInput(sessionId, host, port, friendlyName, replaceSerial)
        )
    }

    fun reconnectDevices() = deviceAction("Reconnect attempted") {
        api.reconnectAndroidDevices()
    }

    fun disconnectDevice(serial: String) = deviceAction("Device disconnected") {
        api.disconnectAndroidDevice(serial)
    }

    fun forgetDevice(serial: String) = deviceAction("Device forgotten") {
        api.forgetAndroidDevice(serial)
    }

    fun startEmulator() = deviceAction("Emulator starting") { api.startAndroidEmulator() }

    fun stopEmulator() = deviceAction("Emulator stopping") { api.stopAndroidEmulator() }
}
