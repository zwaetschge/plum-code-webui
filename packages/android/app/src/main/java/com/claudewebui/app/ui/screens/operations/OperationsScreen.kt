package com.claudewebui.app.ui.screens.operations

import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.AdminUser
import com.claudewebui.app.data.model.AuditLogEntry
import com.claudewebui.app.data.model.DockerContainer
import com.claudewebui.app.data.model.Watchdog
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
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
import com.claudewebui.app.ui.components.common.metricColumns

/**
 * Containers, watchdogs, users and the audit log in one operations view.
 */
@Composable
fun OperationsScreen(
    viewModel: OperationsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val state by viewModel.uiState.collectAsState()
    val wide = isTabletWidth()

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (wide) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.operations_operations_a1fda),
                        subtitle = state.dockerStatus?.let { status ->
                            if (status.available) {
                                screenResources.getString(R.string.operations_docker_1_s_8184b, status.serverVersion ?: screenResources.getString(R.string.operations_connected_c5e23))
                            } else {
                                status.error ?: screenResources.getString(R.string.operations_docker_unavailable_61df4)
                            }
                        } ?: screenResources.getString(R.string.operations_containers_watchdogs_and_access_2ae75),
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, screenResources.getString(R.string.operations_reload_cce71), viewModel::load)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                screenResources.getString(R.string.operations_back_b52b3),
                                onNavigateBack,
                            )
                        },
                    )
                }

                state.error?.let { message ->
                    item {
                        com.claudewebui.app.ui.components.common.ErrorCard(
                            message = message,
                            onRetry = viewModel::load,
                        )
                    }
                }

                state.stats?.let { stats ->
                    item {
                        val metrics = listOf(
                            screenResources.getString(R.string.operations_users_57f2b) to stats.userCount.toString(),
                            screenResources.getString(R.string.operations_sessions_e11e3) to stats.sessionCount.toString(),
                            screenResources.getString(R.string.operations_running_73989) to stats.runningSessionCount.toString(),
                            screenResources.getString(R.string.operations_audit_fa170) to stats.auditCount.toString(),
                        )
                        val perRow = metricColumns()
                        Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                            metrics.chunked(perRow).forEach { rowMetrics ->
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                                ) {
                                    rowMetrics.forEach { (label, value) ->
                                        GlassPanel(Modifier.weight(1f), radius = 15.dp) {
                                            Column(Modifier.padding(13.dp)) {
                                                Text(
                                                    value,
                                                    color = PlumText,
                                                    fontSize = 21.sp,
                                                    fontWeight = FontWeight.Bold,
                                                )
                                                Text(label, color = PlumMuted, fontSize = 11.sp)
                                            }
                                        }
                                    }
                                    // Keep a short final row aligned with the
                                    // one above instead of stretching its cells.
                                    repeat(perRow - rowMetrics.size) {
                                        Box(Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                    }
                }

                item {
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    ) {
                        TabChip(screenResources.getString(R.string.operations_containers_e040a), state.tab == OperationsTab.CONTAINERS) {
                            viewModel.selectTab(OperationsTab.CONTAINERS)
                        }
                        TabChip(screenResources.getString(R.string.operations_watchdogs_fbf2c), state.tab == OperationsTab.WATCHDOGS) {
                            viewModel.selectTab(OperationsTab.WATCHDOGS)
                        }
                        TabChip(screenResources.getString(R.string.operations_users_57f2b), state.tab == OperationsTab.USERS) {
                            viewModel.selectTab(OperationsTab.USERS)
                        }
                        TabChip(screenResources.getString(R.string.operations_audit_fa170), state.tab == OperationsTab.AUDIT) {
                            viewModel.selectTab(OperationsTab.AUDIT)
                        }
                    }
                }

                if (state.isLoading) {
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(120.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else {
                    when (state.tab) {
                        OperationsTab.CONTAINERS -> {
                            if (state.containers.isEmpty()) {
                                item { EmptyCard(screenResources.getString(R.string.operations_no_containers_visible_5f733)) }
                            }
                            items(state.containers, key = { it.id }) { ContainerRow(it) }
                        }

                        OperationsTab.WATCHDOGS -> {
                            if (state.watchdogs.isEmpty()) {
                                item {
                                    EmptyCard(
                                        if (state.adminDenied) {
                                            screenResources.getString(R.string.operations_admin_access_required_737b1)
                                        } else {
                                            screenResources.getString(R.string.operations_no_watchdogs_configured_d7503)
                                        },
                                    )
                                }
                            }
                            items(state.watchdogs, key = { it.id }) { WatchdogRow(it) }
                        }

                        OperationsTab.USERS -> {
                            if (state.users.isEmpty()) {
                                item {
                                    EmptyCard(
                                        if (state.adminDenied) {
                                            screenResources.getString(R.string.operations_admin_access_required_737b1)
                                        } else {
                                            screenResources.getString(R.string.operations_no_users_c4b06)
                                        },
                                    )
                                }
                            }
                            items(state.users, key = { it.id }) { UserRow(it) }
                        }

                        OperationsTab.AUDIT -> {
                            if (state.audit.isEmpty()) {
                                item {
                                    EmptyCard(
                                        if (state.adminDenied) {
                                            screenResources.getString(R.string.operations_admin_access_required_737b1)
                                        } else {
                                            screenResources.getString(R.string.operations_no_audit_entries_01c84)
                                        },
                                    )
                                }
                            }
                            items(state.audit, key = { it.id }) { AuditRow(it) }
                        }
                    }
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
private fun EmptyCard(message: String) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Box(Modifier.fillMaxWidth().padding(26.dp), contentAlignment = Alignment.Center) {
            Text(message, color = PlumMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun ContainerRow(container: DockerContainer) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Column(Modifier.fillMaxWidth().padding(screenTokens.spacing.cozy), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    container.name,
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(
                    container.state,
                    if (container.isRunning) PlumGreen else PlumMuted,
                )
            }
            Text(
                container.image,
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                buildString {
                    append(container.status)
                    val ports = container.ports.joinToString(", ") { it.raw }
                    if (ports.isNotBlank()) append(" · ").append(ports)
                },
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun WatchdogRow(watchdog: Watchdog) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Column(Modifier.fillMaxWidth().padding(screenTokens.spacing.cozy), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    watchdog.containerName.ifBlank { watchdog.containerId.take(12) },
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(
                    if (watchdog.enabled) screenResources.getString(R.string.operations_enabled_3ea3f) else screenResources.getString(R.string.operations_paused_11b1b),
                    if (watchdog.enabled) PlumGreen else PlumMuted,
                )
            }
            Text(
                "${watchdog.autonomyLevel} · ${watchdog.sessionProvider}",
                color = PlumMuted,
                fontSize = 11.sp,
            )
            watchdog.lastIncidentAt?.let {
                Text(screenResources.getString(R.string.operations_last_incident_1_s_199b2, it.take(19)), color = PlumAmber, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun UserRow(user: AdminUser) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().padding(screenTokens.spacing.cozy),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    user.name?.takeIf { it.isNotBlank() } ?: user.email,
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    screenResources.getString(R.string.operations_1_s_2_s_sessions_f7a3d, user.email, user.sessionCount),
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(
                user.role,
                if (user.role == "admin") PlumAccent else PlumMuted,
            )
            if (user.status != "active") {
                StatusPill(user.status, PlumRed)
            }
        }
    }
}

@Composable
private fun AuditRow(entry: AuditLogEntry) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth(), radius = 14.dp) {
        Column(Modifier.fillMaxWidth().padding(screenTokens.spacing.md), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                entry.action,
                color = PlumText,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                buildString {
                    append(entry.createdAt.take(19).replace('T', ' '))
                    entry.actorEmail?.let { append(" · ").append(it) }
                    entry.ip?.let { append(" · ").append(it) }
                },
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
