package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.ui.screens.devtools.AndroidDevicesPanel
import com.claudewebui.app.ui.screens.devtools.BrowserLiveCard
import com.claudewebui.app.ui.screens.devtools.DevToolsViewModel
import com.claudewebui.app.ui.screens.devtools.OracleBrowserPanel
import com.claudewebui.app.ui.theme.PlumTheme
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/**
 * Verbindungen: one list with a section per connection kind — Android devices
 * and the browser today; SSH hosts join as another section.
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
