package com.claudewebui.app.ui.screens.devtools

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.GitHubRepo
import com.claudewebui.app.data.model.PreviewPort
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * Dev-server preview ports and the GitHub connection for one session.
 */
@Composable
fun DevToolsScreen(
    viewModel: DevToolsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val wide = isTabletWidth()
    val uriHandler = LocalUriHandler.current
    var showCreateRepo by remember { mutableStateOf(false) }
    var cloneRepo by remember { mutableStateOf<GitHubRepo?>(null) }
    var showPush by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            // Include the IME so editors/fields lift above the keyboard.
            contentWindowInsets = WindowInsets.safeDrawing,
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (wide) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Dev tools",
                        subtitle = state.previewConfig?.hostname
                            ?: "Preview servers and GitHub",
                        actions = {
                            PlumIconButton(
                                Icons.Outlined.Refresh,
                                "Reload",
                                onClick = {
                                    viewModel.scanPorts()
                                    viewModel.loadGitHub()
                                },
                            )
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                "Back",
                                onNavigateBack,
                            )
                        },
                    )
                }

                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TabChip("Preview", state.tab == DevToolsTab.PREVIEW) {
                            viewModel.selectTab(DevToolsTab.PREVIEW)
                        }
                        TabChip("GitHub", state.tab == DevToolsTab.GITHUB) {
                            viewModel.selectTab(DevToolsTab.GITHUB)
                        }
                        TabChip("Oracle", state.tab == DevToolsTab.ORACLE) {
                            viewModel.selectTab(DevToolsTab.ORACLE)
                        }
                        TabChip("Devices", state.tab == DevToolsTab.DEVICES) {
                            viewModel.selectTab(DevToolsTab.DEVICES)
                        }
                    }
                }

                (state.error ?: state.notice)?.let { message ->
                    item {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(PlumSubtleFill)
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                message,
                                color = if (state.error != null) PlumRed else PlumText,
                                fontSize = 12.sp,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "Dismiss",
                                color = PlumAccent,
                                fontSize = 12.sp,
                                modifier = Modifier.clickable(onClick = viewModel::dismissError),
                            )
                        }
                    }
                }

                when (state.tab) {
                    DevToolsTab.PREVIEW -> {
                        item {
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    if (state.isScanning) {
                                        "Scanning ports…"
                                    } else {
                                        "Scanned ${state.scannedAt.take(19).replace('T', ' ')}"
                                    },
                                    color = PlumMuted,
                                    fontSize = 11.sp,
                                    modifier = Modifier.weight(1f),
                                )
                                Chip("Start dev server", Icons.Outlined.PlayArrow) {
                                    viewModel.startPreview()
                                }
                            }
                        }

                        if (state.ports.isEmpty() && !state.isScanning) {
                            item { EmptyCard("No ports scanned") }
                        }

                        items(state.ports, key = { it.port }) { port ->
                            PortRow(port) {
                                state.previewConfig?.hostname?.let { host ->
                                    uriHandler.openUri("https://$host/?port=${port.port}")
                                }
                            }
                        }
                    }

                    DevToolsTab.GITHUB -> {
                        item {
                            val status = state.tokenStatus
                            GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                                Column(
                                    Modifier.fillMaxWidth().padding(15.dp),
                                    verticalArrangement = Arrangement.spacedBy(7.dp),
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "GitHub token",
                                            color = PlumText,
                                            fontSize = 15.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.weight(1f),
                                        )
                                        StatusPill(
                                            if (status?.valid == true) "valid" else "invalid",
                                            if (status?.valid == true) PlumGreen else PlumRed,
                                        )
                                    }
                                    status?.user?.login?.takeIf { it.isNotBlank() }?.let {
                                        Text("Signed in as $it", color = PlumMuted, fontSize = 12.sp)
                                    }
                                    status?.error?.let {
                                        Text(it, color = PlumRed, fontSize = 11.sp)
                                    }
                                    if (status?.valid != true) {
                                        Text(
                                            "Configure the token in the web UI — it is stored " +
                                                "server-side and never sent to this device.",
                                            color = PlumMuted,
                                            fontSize = 11.sp,
                                        )
                                    }
                                }
                            }
                        }

                        if (state.tokenStatus?.valid == true) {
                            item {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Chip("New repo", Icons.Outlined.Add) { showCreateRepo = true }
                                    Chip("Push", Icons.Outlined.Upload) { showPush = true }
                                    state.gitHubAction?.let {
                                        Text(
                                            it,
                                            color = PlumMuted,
                                            fontSize = 11.sp,
                                            modifier = Modifier.align(Alignment.CenterVertically),
                                        )
                                    }
                                }
                            }
                        }

                        if (state.isLoadingGitHub) {
                            item {
                                Box(
                                    Modifier.fillMaxWidth().height(90.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    CircularProgressIndicator(
                                        color = PlumAccent,
                                        strokeWidth = 2.5.dp,
                                    )
                                }
                            }
                        } else if (state.repos.isEmpty()) {
                            item { EmptyCard("No repositories") }
                        }

                        items(state.repos, key = { it.fullName }) { repo ->
                            RepoRow(
                                repo = repo,
                                canClone = state.tokenStatus?.valid == true && state.gitHubAction == null,
                                onOpen = { uriHandler.openUri(repo.htmlUrl) },
                                onClone = { cloneRepo = repo },
                            )
                        }

                        item { GitHubCollabPanel(state = state, viewModel = viewModel) }
                    }

                    DevToolsTab.ORACLE -> item {
                        OracleBrowserPanel(state = state, viewModel = viewModel)
                    }

                    DevToolsTab.DEVICES -> item {
                        AndroidDevicesPanel(state = state, viewModel = viewModel)
                    }
                }
            }
        }
    }

    if (showCreateRepo) {
        CreateRepoDialog(
            onDismiss = { showCreateRepo = false },
            onCreate = { name, description, isPrivate ->
                showCreateRepo = false
                viewModel.createRepo(name, description, isPrivate)
            },
        )
    }

    cloneRepo?.let { repo ->
        CloneRepoDialog(
            repo = repo,
            initialTarget = viewModel.defaultCloneTarget(repo),
            onDismiss = { cloneRepo = null },
            onClone = { target, branch ->
                cloneRepo = null
                viewModel.cloneRepo(repo.cloneUrl, target, branch)
            },
        )
    }

    if (showPush) {
        PushRepoDialog(
            onDismiss = { showPush = false },
            onPush = { remote, branch, force ->
                showPush = false
                viewModel.push(remote, branch, force)
            },
        )
    }
}

@Composable
private fun PortRow(port: PreviewPort, onOpen: () -> Unit) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = port.reachable, onClick = onOpen)
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "${port.port}  ${port.name}",
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    port.title?.takeIf { it.isNotBlank() }
                        ?: port.error?.takeIf { it.isNotBlank() }
                        ?: port.source,
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(
                if (port.reachable) "open" else "closed",
                if (port.reachable) PlumGreen else PlumMuted,
            )
        }
    }
}

@Composable
private fun RepoRow(
    repo: GitHubRepo,
    canClone: Boolean,
    onOpen: () -> Unit,
    onClone: () -> Unit,
) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    repo.name,
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    repo.description?.takeIf { it.isNotBlank() } ?: repo.fullName,
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                if (repo.private) StatusPill("private", PlumAccent)
                if (canClone) {
                    Text(
                        "Clone",
                        color = PlumAccent,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clickable(onClick = onClone)
                            .padding(start = 12.dp, top = 8.dp, bottom = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun TabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (selected) PlumText else PlumMuted,
        fontSize = 12.sp,
        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 9.dp),
    )
}

@Composable
private fun Chip(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(PlumAccent.copy(alpha = .18f))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        androidx.compose.material3.Icon(
            icon,
            null,
            tint = PlumText,
            modifier = Modifier.padding(0.dp),
        )
        Text(label, color = PlumText, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun EmptyCard(message: String) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Box(Modifier.fillMaxWidth().padding(26.dp), contentAlignment = Alignment.Center) {
            Text(message, color = PlumMuted, fontSize = 12.sp)
        }
    }
}
