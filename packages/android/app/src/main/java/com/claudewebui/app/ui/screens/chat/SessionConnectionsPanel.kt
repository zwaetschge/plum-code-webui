package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.data.model.SshConnection
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.screens.settings.ConnectionTestState
import com.claudewebui.app.ui.screens.settings.ConnectionsUiState
import com.claudewebui.app.ui.screens.settings.ConnectionsViewModel
import com.claudewebui.app.ui.screens.settings.TestResultLine
import com.claudewebui.app.ui.screens.settings.sshTarget
import com.claudewebui.app.ui.screens.devtools.AndroidDevicesPanel
import com.claudewebui.app.ui.screens.devtools.BrowserLiveCard
import com.claudewebui.app.ui.screens.devtools.DevToolsViewModel
import com.claudewebui.app.ui.screens.devtools.OracleBrowserPanel
import com.claudewebui.app.ui.theme.PlumTheme
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/**
 * Verbindungen: one list with a section per connection kind — Android
 * devices, SSH hosts and the browser.
 */
@Composable
internal fun SessionConnectionsPanel(
    sessionId: String,
    workingDirectory: String,
    storeOwner: ViewModelStoreOwner,
    modifier: Modifier = Modifier,
) {
    val t = PlumTheme.tokens
    val vm: DevToolsViewModel = koinViewModel(
        viewModelStoreOwner = storeOwner,
        parameters = { parametersOf(sessionId, workingDirectory) },
    )
    val state by vm.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(vm) {
        vm.loadDevices()
        vm.loadOracle()
    }
    val sshVm: ConnectionsViewModel = koinViewModel(
        viewModelStoreOwner = storeOwner,
        parameters = { parametersOf(sessionId) },
    )
    val sshState by sshVm.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(sshVm) { sshVm.load() }
    LazyColumn(
        modifier,
        contentPadding = PaddingValues(t.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(t.spacing.md),
    ) {
        item(key = "title") {
            Text(stringResource(R.string.session_tool_connections), style = MaterialTheme.typography.titleLarge)
        }
        (state.error ?: state.notice)?.let { message ->
            item(key = "message") {
                Text(
                    message,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item(key = "android-header") { SectionHeader(Icons.Outlined.PhoneAndroid, stringResource(R.string.session_tool_android_devices)) }
        item(key = "android") { AndroidDevicesPanel(state = state, viewModel = vm) }
        item(key = "ssh-header") { SectionHeader(Icons.Outlined.Dns, stringResource(R.string.connections_ssh_hosts)) }
        item(key = "ssh") { SshHostsSection(state = sshState, viewModel = sshVm) }
        item(key = "browser-header") { SectionHeader(Icons.Outlined.Language, stringResource(R.string.session_tool_browser)) }
        item(key = "browser-live") { BrowserLiveCard(state = state, viewModel = vm) }
        item(key = "oracle") { OracleBrowserPanel(state = state, viewModel = vm) }
    }
}

@Composable
private fun SectionHeader(icon: ImageVector, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, style = MaterialTheme.typography.titleSmall)
    }
}

/**
 * SSH hosts attached to this session. The agent gets them as `ssh <alias>`
 * targets; the hosts themselves are created in Settings → Verbindungen.
 */
@Composable
private fun SshHostsSection(state: ConnectionsUiState, viewModel: ConnectionsViewModel) {
    val t = PlumTheme.tokens
    val attachedIds = state.attached.map { it.id }.toSet()
    val available = state.connections.filterNot { it.id in attachedIds }
    val busy = state.sessionBusy

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            if (!state.agentAccess) {
                Text(stringResource(R.string.connections_session_no_agent_access), color = PlumAmber, fontSize = 12.sp)
            }
            (state.sessionError ?: state.loadError)?.let { Text(it, color = PlumRed, fontSize = 12.sp) }

            if (state.attached.isEmpty()) {
                Text(
                    stringResource(if (state.isLoading) R.string.connections_loading else R.string.connections_session_none_attached),
                    color = PlumMuted,
                    fontSize = 12.sp,
                )
            }
            state.attached.forEach { connection ->
                val test = state.tests[connection.id] ?: ConnectionTestState()
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SshHostLabel(connection, Modifier.weight(1f))
                        SshAction(stringResource(R.string.connections_test), test.running) { viewModel.test(connection.id) }
                        SshAction(stringResource(R.string.connections_session_detach), busy, PlumRed) { viewModel.detach(connection.id) }
                    }
                    TestResultLine(test)
                }
            }

            Text(
                stringResource(R.string.connections_session_available),
                color = PlumText,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = t.spacing.inline),
            )
            when {
                state.isLoading && state.connections.isEmpty() -> Text(
                    stringResource(R.string.connections_loading),
                    color = PlumMuted,
                    fontSize = 12.sp,
                )
                state.connections.isEmpty() -> Text(
                    stringResource(R.string.connections_session_no_global),
                    color = PlumMuted,
                    fontSize = 12.sp,
                )
                available.isEmpty() -> Text(
                    stringResource(R.string.connections_session_all_attached),
                    color = PlumMuted,
                    fontSize = 12.sp,
                )
                else -> available.forEach { connection ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SshHostLabel(connection, Modifier.weight(1f))
                        SshAction(stringResource(R.string.connections_session_attach), busy) { viewModel.attach(connection.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SshHostLabel(connection: SshConnection, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(
            connection.alias,
            color = PlumText,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            sshTarget(connection),
            color = PlumMuted,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SshAction(
    label: String,
    disabled: Boolean,
    color: androidx.compose.ui.graphics.Color = PlumAccent,
    onClick: () -> Unit,
) {
    val t = PlumTheme.tokens
    Text(
        label,
        color = if (disabled) PlumMuted else color,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clickable(enabled = !disabled, onClick = onClick)
            .padding(horizontal = t.spacing.sm, vertical = t.spacing.inline),
    )
}
