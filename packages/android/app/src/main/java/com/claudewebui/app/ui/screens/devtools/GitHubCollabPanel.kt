package com.claudewebui.app.ui.screens.devtools

import com.claudewebui.app.R
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText

private enum class CollabTab(private val labelRes: Int) {
    PULLS(R.string.devtools_pull_requests_80302),
    RUNS(R.string.devtools_ci_13844),
    ISSUES(R.string.devtools_issues_30ce4),
    RELEASES(R.string.devtools_releases_8fa41);

    val label: String
        @androidx.compose.runtime.Composable get() = androidx.compose.ui.res.stringResource(labelRes)

}

/**
 * Pull requests, CI runs, issues and releases for the session's checkout,
 * mirroring the WebUI's GitHubPanel. Backed by /api/github/{pulls,runs,issues,
 * releases}, which run the deployment-wide authenticated gh CLI — no per-user
 * token needed.
 */
@Composable
fun GitHubCollabPanel(state: DevToolsUiState, viewModel: DevToolsViewModel) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val uriHandler = LocalUriHandler.current
    var tab by remember { mutableStateOf(CollabTab.PULLS) }
    var composing by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    val busy = state.gitHubAction != null || state.isLoadingCollab

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    state.repoInfo?.nameWithOwner?.takeIf { it.isNotBlank() } ?: screenResources.getString(R.string.devtools_github_5442e),
                    color = PlumText,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                ActionText(screenResources.getString(R.string.devtools_reload_cce71), busy) { viewModel.loadCollaboration() }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline)) {
                CollabTab.entries.forEach { entry ->
                    CollabTabChip(entry.label, tab == entry) { tab = entry }
                }
            }

            if (tab == CollabTab.PULLS || tab == CollabTab.ISSUES) {
                if (composing) {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text(screenResources.getString(R.string.devtools_title_768e0)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = body,
                        onValueChange = { body = it },
                        label = { Text(screenResources.getString(R.string.devtools_description_optional_388de)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
                        ActionText(screenResources.getString(R.string.devtools_cancel_77dfd), false) { composing = false }
                        ActionText(screenResources.getString(R.string.devtools_create_6e157), busy || title.isBlank()) {
                            if (tab == CollabTab.PULLS) {
                                viewModel.createPullRequest(title, body)
                            } else {
                                viewModel.createIssue(title, body)
                            }
                            composing = false
                            title = ""
                            body = ""
                        }
                    }
                } else {
                    ActionText(
                        if (tab == CollabTab.PULLS) screenResources.getString(R.string.devtools_new_pull_request_b0a42) else screenResources.getString(R.string.devtools_new_issue_051fb),
                        busy,
                    ) { composing = true }
                }
            }

            when (tab) {
                CollabTab.PULLS ->
                    if (state.pullRequests.isEmpty()) {
                        EmptyLine(screenResources.getString(R.string.devtools_no_open_pull_requests_dd307))
                    } else {
                        state.pullRequests.forEach { pr ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(
                                    Modifier.weight(1f).clickable { uriHandler.openUri(pr.url) }
                                ) {
                                    Text(
                                        "#${pr.number} ${pr.title}",
                                        color = PlumText,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        "${pr.author} · ${pr.headRefName} → ${pr.baseRefName}",
                                        color = checkTone(pr.statusCheckRollup?.state),
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                ActionText(screenResources.getString(R.string.devtools_merge_ea8f0), busy || pr.isDraft) {
                                    viewModel.mergePullRequest(pr.number)
                                }
                            }
                        }
                    }

                CollabTab.RUNS ->
                    if (state.workflowRuns.isEmpty()) {
                        EmptyLine(screenResources.getString(R.string.devtools_no_workflow_runs_70e8a))
                    } else {
                        state.workflowRuns.forEach { run ->
                            val failed = run.status == "completed" && run.conclusion != "success"
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(
                                    Modifier.weight(1f).clickable { uriHandler.openUri(run.url) }
                                ) {
                                    Text(
                                        run.displayTitle,
                                        color = PlumText,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        "${run.name} · ${run.headBranch} · " +
                                            (run.conclusion ?: run.status),
                                        color = if (failed) PlumRed else PlumGreen,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                if (failed) {
                                    ActionText(screenResources.getString(R.string.devtools_re_run_a7c77), busy) {
                                        viewModel.rerunWorkflow(run.databaseId)
                                    }
                                }
                            }
                        }
                    }

                CollabTab.ISSUES ->
                    if (state.issues.isEmpty()) {
                        EmptyLine(screenResources.getString(R.string.devtools_no_open_issues_82714))
                    } else {
                        state.issues.forEach { issue ->
                            Column(
                                Modifier.fillMaxWidth().clickable {
                                    uriHandler.openUri(issue.url)
                                }
                            ) {
                                Text(
                                    "#${issue.number} ${issue.title}",
                                    color = PlumText,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    (listOf(issue.author) + issue.labels).joinToString(" · "),
                                    color = PlumMuted,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }

                CollabTab.RELEASES ->
                    if (state.releases.isEmpty()) {
                        EmptyLine(screenResources.getString(R.string.devtools_no_releases_2d555))
                    } else {
                        state.releases.forEach { release ->
                            Column(Modifier.fillMaxWidth()) {
                                Text(
                                    release.name.ifBlank { release.tagName },
                                    color = PlumText,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    listOfNotNull(
                                        release.tagName,
                                        "latest".takeIf { release.isLatest },
                                        "draft".takeIf { release.isDraft },
                                        "pre-release".takeIf { release.isPrerelease },
                                        release.publishedAt?.take(10),
                                    ).joinToString(" · "),
                                    color = PlumMuted,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
            }
        }
    }
}

/** Plum's palette entries are @Composable getters, so this must be one too. */
@Composable
@ReadOnlyComposable
private fun checkTone(state: String?) = when (state) {
    "FAILURE" -> PlumRed
    "SUCCESS" -> PlumGreen
    else -> PlumMuted
}

/** TabChip in DevToolsScreen.kt is file-private, so this panel carries its own. */
@Composable
private fun CollabTabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        label,
        color = if (selected) PlumAccent else PlumMuted,
        fontSize = 12.sp,
        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        modifier = Modifier.clickable(onClick = onClick).padding(vertical = screenTokens.spacing.xxs),
    )
}

@Composable
private fun EmptyLine(label: String) {
    Text(label, color = PlumMuted, fontSize = 12.sp)
}

@Composable
private fun ActionText(label: String, disabled: Boolean, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        label,
        color = if (disabled) PlumMuted else PlumAccent,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .padding(start = screenTokens.spacing.md)
            .clickable(enabled = !disabled, onClick = onClick),
    )
}
