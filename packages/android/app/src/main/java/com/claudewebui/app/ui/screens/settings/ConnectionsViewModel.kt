package com.claudewebui.app.ui.screens.settings

import android.content.Context
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.R
import com.claudewebui.app.core.network.api.ConnectionsApi
import com.claudewebui.app.core.network.apiCall
import com.claudewebui.app.data.model.SessionConnections
import com.claudewebui.app.data.model.SshConnection
import com.claudewebui.app.data.model.SshConnectionInput
import com.claudewebui.app.ui.screens.screenErrorMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Probe result for one connection. */
data class ConnectionTestState(
    val running: Boolean = false,
    val ok: Boolean? = null,
    val message: String? = null,
    val durationMs: Long? = null,
)

data class ConnectionsUiState(
    val connections: List<SshConnection> = emptyList(),
    val isLoading: Boolean = true,
    val loadError: String? = null,
    val keyFilesAvailable: Boolean = false,
    val keyFiles: List<String> = emptyList(),
    val tests: Map<String, ConnectionTestState> = emptyMap(),
    val isSaving: Boolean = false,
    val saveError: String? = null,
    val notice: String? = null,
    // Session scope (only filled when the ViewModel has a session id)
    val attached: List<SshConnection> = emptyList(),
    val agentAccess: Boolean = true,
    val sessionBusy: Boolean = false,
    val sessionError: String? = null,
)

/** What the edit form submits; [tagsText] and [portText] are raw field text. */
data class SshConnectionDraft(
    val name: String = "",
    val alias: String = "",
    val host: String = "",
    val portText: String = "22",
    val user: String = "",
    val jumpHost: String = "",
    val tagsText: String = "",
    val keySource: String = "file",
    val keyFile: String? = null,
    val privateKey: String = "",
    val clearKey: Boolean = false,
) {
    val tags: List<String>
        get() = tagsText.split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

    companion object {
        fun from(connection: SshConnection) = SshConnectionDraft(
            name = connection.name,
            alias = connection.alias,
            host = connection.host,
            portText = connection.port.toString(),
            user = connection.user,
            jumpHost = connection.jumpHost.orEmpty(),
            tagsText = connection.tags.joinToString(", "),
            keySource = connection.keySource,
            keyFile = connection.keyFile,
        )
    }
}

/**
 * SSH connections (P5 "Verbindungen"): the global list for the settings
 * screen and, when [sessionId] is set, the hosts attached to that session.
 *
 * Keys are write-only like every other secret: the server reports
 * `keyConfigured`, an empty key field keeps the stored key and removing it
 * takes the explicit `clearKey` flag.
 */
class ConnectionsViewModel(
    private val sessionId: String?,
    private val api: ConnectionsApi,
    private val context: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConnectionsUiState())
    val uiState: StateFlow<ConnectionsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        load()
    }

    /** Global list, key files (settings only) and the session's attached set. */
    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, loadError = null) }
            coroutineScope {
                val list = async { apiCall { api.listConnections().data.orEmpty() } }
                val keys = if (sessionId == null) async { apiCall { api.listSshKeyFiles().data } } else null
                val session = sessionId?.let { id -> async { apiCall { api.getSessionConnections(id).data } } }
                val listResult = list.await()
                val keyFiles = keys?.await()?.getOrNull()
                val sessionResult = session?.await()
                _uiState.update { state ->
                    var next = state.copy(
                        isLoading = false,
                        connections = listResult.getOrNull() ?: state.connections,
                        loadError = listResult.exceptionOrNull()?.screenErrorMessage("connections", "load", context),
                    )
                    if (keyFiles != null) {
                        next = next.copy(keyFilesAvailable = keyFiles.available, keyFiles = keyFiles.files)
                    }
                    if (sessionResult != null) {
                        next = next.applySession(sessionResult.getOrNull()).copy(
                            sessionError = sessionResult.exceptionOrNull()
                                ?.screenErrorMessage("connections", "session", context),
                        )
                    }
                    next
                }
            }
        }
    }

    // ── Settings: create / update / delete ──────────────────────────────────

    fun save(editing: SshConnection?, draft: SshConnectionDraft, onSaved: () -> Unit) {
        val invalid = validateSshDraft(draft, editing)
        if (invalid != null) {
            _uiState.update { it.copy(saveError = context.getString(invalid), notice = null) }
            return
        }
        val upload = draft.keySource == SSH_KEY_SOURCE_UPLOAD
        val pasted = draft.privateKey.trim().takeIf { upload && !draft.clearKey && it.isNotEmpty() }
        val input = SshConnectionInput(
            kind = if (editing == null) "ssh" else null,
            name = draft.name.trim(),
            alias = draft.alias.trim(),
            host = draft.host.trim(),
            port = draft.portText.trim().toInt(),
            user = draft.user.trim(),
            // Empty string clears the jump host on PATCH; omitted on create.
            jumpHost = draft.jumpHost.trim().ifEmpty { if (editing != null) "" else null },
            tags = draft.tags,
            keySource = draft.keySource,
            keyFile = if (upload) null else draft.keyFile,
            privateKey = pasted,
            clearKey = if (editing != null && upload && draft.clearKey) true else null,
        )
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, saveError = null, notice = null) }
            val result = apiCall {
                if (editing == null) api.createConnection(input) else api.updateConnection(editing.id, input)
            }
            _uiState.update {
                it.copy(
                    isSaving = false,
                    saveError = result.exceptionOrNull()?.screenErrorMessage("connections", "save", context),
                    notice = if (result.isSuccess) context.getString(R.string.connections_saved) else null,
                )
            }
            if (result.isSuccess) {
                onSaved()
                load()
            }
        }
    }

    fun delete(connection: SshConnection) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, saveError = null, notice = null) }
            val result = apiCall { api.deleteConnection(connection.id) }
            _uiState.update {
                it.copy(
                    isSaving = false,
                    saveError = result.exceptionOrNull()?.screenErrorMessage("connections", "delete", context),
                    notice = if (result.isSuccess) context.getString(R.string.connections_deleted) else null,
                    connections = if (result.isSuccess) it.connections.filterNot { c -> c.id == connection.id } else it.connections,
                    tests = it.tests - connection.id,
                )
            }
            if (result.isSuccess) load()
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(saveError = null, notice = null) }
    }

    // ── Probe ───────────────────────────────────────────────────────────────

    fun test(connectionId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(tests = it.tests + (connectionId to ConnectionTestState(running = true))) }
            val result = apiCall { api.testConnection(connectionId).data }
            val probe = result.getOrNull()
            val state = when {
                probe != null -> ConnectionTestState(
                    running = false,
                    ok = probe.ok,
                    message = probe.message.ifBlank {
                        context.getString(if (probe.ok) R.string.connections_test_ok else R.string.connections_test_failed)
                    },
                    durationMs = probe.durationMs.toLong(),
                )
                else -> ConnectionTestState(
                    running = false,
                    ok = false,
                    message = result.exceptionOrNull()?.screenErrorMessage("connections", "test", context)
                        ?: context.getString(R.string.connections_test_failed),
                )
            }
            _uiState.update { it.copy(tests = it.tests + (connectionId to state)) }
        }
    }

    // ── Session: attach / detach ────────────────────────────────────────────

    fun attach(connectionId: String) {
        val current = _uiState.value.attached.map { it.id }
        if (connectionId in current) return
        replaceAttached(current + connectionId)
    }

    fun detach(connectionId: String) {
        replaceAttached(_uiState.value.attached.map { it.id }.filterNot { it == connectionId })
    }

    private fun replaceAttached(ids: List<String>) {
        val id = sessionId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(sessionBusy = true, sessionError = null) }
            val result = apiCall { api.setSessionConnections(id, ids).data }
            _uiState.update {
                it.applySession(result.getOrNull()).copy(
                    sessionBusy = false,
                    sessionError = result.exceptionOrNull()?.screenErrorMessage("connections", "attach", context),
                )
            }
        }
    }

    private fun ConnectionsUiState.applySession(session: SessionConnections?): ConnectionsUiState =
        if (session == null) this else copy(attached = session.connections, agentAccess = session.agentAccess)
}

const val SSH_KEY_SOURCE_FILE = "file"
const val SSH_KEY_SOURCE_UPLOAD = "upload"

private val SSH_ALIAS_REGEX = Regex("^[a-z0-9][a-z0-9-]{0,40}$")
private val SSH_HOST_REGEX = Regex("^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$")
private val SSH_USER_REGEX = Regex("^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$")
private val SSH_JUMP_REGEX =
    Regex("^(?:[A-Za-z0-9._][A-Za-z0-9._-]{0,63}@)?[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?::([0-9]{1,5}))?$")
private val SSH_TAG_REGEX = Regex("^[\\p{L}\\p{N}._-]{1,32}$")
private val SSH_PRIVATE_KEY_REGEX =
    Regex("^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\\n[\\s\\S]+\\n-----END [A-Z0-9 ]*PRIVATE KEY-----$")

/** Alias suggestion from a display name: lowercase, other characters to '-', trimmed. */
fun sshAliasFromName(name: String): String =
    name.trim().lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .take(41)
        .trimEnd('-')

/** Client-side mirror of the backend rules; the server stays authoritative. */
@StringRes
fun validateSshDraft(draft: SshConnectionDraft, editing: SshConnection?): Int? {
    if (draft.name.isBlank() || draft.name.trim().length > 80) return R.string.connections_error_name
    if (!SSH_ALIAS_REGEX.matches(draft.alias.trim())) return R.string.connections_error_alias
    if (!SSH_HOST_REGEX.matches(draft.host.trim())) return R.string.connections_error_host
    val port = draft.portText.trim().toIntOrNull()
    if (port == null || port !in 1..65535) return R.string.connections_error_port
    if (!SSH_USER_REGEX.matches(draft.user.trim())) return R.string.connections_error_user
    val jump = draft.jumpHost.trim()
    if (jump.isNotEmpty()) {
        val match = SSH_JUMP_REGEX.matchEntire(jump) ?: return R.string.connections_error_jump_host
        val jumpPort = match.groupValues.getOrNull(1)?.takeIf { it.isNotEmpty() }?.toIntOrNull()
        if (jumpPort != null && jumpPort !in 1..65535) return R.string.connections_error_jump_host
    }
    val tags = draft.tags
    if (tags.size > 12 || tags.any { !SSH_TAG_REGEX.matches(it) }) return R.string.connections_error_tags
    if (draft.keySource == SSH_KEY_SOURCE_FILE) {
        if (draft.keyFile.isNullOrBlank()) return R.string.connections_error_key_file
    } else {
        val key = draft.privateKey.replace("\r\n", "\n").replace('\r', '\n').trim()
        val keepsStored = editing != null && editing.keyConfigured && editing.keySource == SSH_KEY_SOURCE_UPLOAD
        if (key.isEmpty()) {
            if (!keepsStored && !draft.clearKey) return R.string.connections_error_private_key
        } else if (!draft.clearKey && !SSH_PRIVATE_KEY_REGEX.matches(key)) {
            return R.string.connections_error_private_key_format
        }
    }
    return null
}
