package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.MergeType
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.GitBranch
import com.claudewebui.app.data.model.GitCommit
import com.claudewebui.app.data.model.GitFileDiff
import com.claudewebui.app.data.model.GitStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitScreen(
    workingDirectory: String,
    gitStatus: GitStatus?,
    commits: List<GitCommit>,
    diffs: List<GitFileDiff>,
    branches: List<GitBranch>,
    isLoading: Boolean,
    isCommitting: Boolean,
    isPushing: Boolean,
    onNavigateBack: () -> Unit,
    onStageAll: () -> Unit,
    onCommit: (message: String) -> Unit,
    onPush: () -> Unit,
    onSwitchBranch: (branch: String) -> Unit,
    onRefresh: () -> Unit
) {
    val t = PlumTheme.tokens
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf(stringResource(R.string.chat_status), stringResource(R.string.chat_log), stringResource(R.string.chat_branches))
    var showCommitDialog by remember { mutableStateOf(false) }
    var selectedCommit by remember { mutableStateOf<GitCommit?>(null) }
    var expandedDiff by remember { mutableStateOf<GitFileDiff?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.chat_panel_git))
                        gitStatus?.let { status ->
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(t.spacing.inline),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.MergeType,
                                    contentDescription = null,
                                    modifier = Modifier.size(t.spacing.md),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    status.branch,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Surface(
                                    color = if (status.isClean)
                                        Color(0xFF4CAF50).copy(alpha = 0.2f)
                                    else
                                        MaterialTheme.colorScheme.errorContainer,
                                    shape = RoundedCornerShape(t.spacing.xs)
                                ) {
                                    Text(
                                        if (status.isClean) stringResource(R.string.chat_git_clean) else stringResource(R.string.chat_git_dirty),
                                        modifier = Modifier.padding(horizontal = t.spacing.xs, vertical = 1.dp),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (status.isClean)
                                            Color(0xFF4CAF50)
                                        else
                                            MaterialTheme.colorScheme.onErrorContainer
                                    )
                                }
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.chat_back))
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.chat_refresh))
                    }
                },
                windowInsets = TopAppBarDefaults.windowInsets
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Tab row
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) }
                    )
                }
            }

            when {
                isLoading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }
                else -> when (selectedTab) {
                    0 -> GitStatusTab(
                        status = gitStatus,
                        diffs = diffs,
                        expandedDiff = expandedDiff,
                        onExpandDiff = { diff -> expandedDiff = if (expandedDiff == diff) null else diff },
                        onStageAll = onStageAll,
                        onCommit = { showCommitDialog = true },
                        onPush = onPush,
                        isCommitting = isCommitting,
                        isPushing = isPushing
                    )
                    1 -> GitLogTab(
                        commits = commits,
                        onCommitClick = { selectedCommit = it }
                    )
                    2 -> GitBranchesTab(
                        branches = branches,
                        onSwitchBranch = onSwitchBranch
                    )
                }
            }
        }
    }

    // Commit dialog
    if (showCommitDialog) {
        CommitDialog(
            stagedCount = gitStatus?.staged?.size ?: 0,
            onDismiss = { showCommitDialog = false },
            onCommit = { message ->
                onCommit(message)
                showCommitDialog = false
            }
        )
    }

    // Commit detail dialog
    selectedCommit?.let { commit ->
        CommitDetailDialog(
            commit = commit,
            onDismiss = { selectedCommit = null }
        )
    }
}

@Composable
private fun GitStatusTab(
    status: GitStatus?,
    diffs: List<GitFileDiff>,
    expandedDiff: GitFileDiff?,
    onExpandDiff: (GitFileDiff) -> Unit,
    onStageAll: () -> Unit,
    onCommit: () -> Unit,
    onPush: () -> Unit,
    isCommitting: Boolean,
    isPushing: Boolean
) {
    val t = PlumTheme.tokens
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(t.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(t.spacing.lg)
    ) {
        // Quick actions
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(t.spacing.sm)
            ) {
                OutlinedButton(
                    onClick = onStageAll,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(t.spacing.lg))
                    Spacer(Modifier.width(t.spacing.xs))
                    Text(stringResource(R.string.chat_stage_all))
                }
                FilledTonalButton(
                    onClick = onCommit,
                    modifier = Modifier.weight(1f),
                    enabled = !isCommitting && (status?.staged?.isNotEmpty() == true)
                ) {
                    if (isCommitting) {
                        CircularProgressIndicator(modifier = Modifier.size(t.spacing.cozy), strokeWidth = t.spacing.xxs)
                    } else {
                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(t.spacing.lg))
                    }
                    Spacer(Modifier.width(t.spacing.xs))
                    Text(stringResource(R.string.chat_commit))
                }
                FilledTonalButton(
                    onClick = onPush,
                    modifier = Modifier.weight(1f),
                    enabled = !isPushing
                ) {
                    if (isPushing) {
                        CircularProgressIndicator(modifier = Modifier.size(t.spacing.cozy), strokeWidth = t.spacing.xxs)
                    } else {
                        Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.size(t.spacing.lg))
                    }
                    Spacer(Modifier.width(t.spacing.xs))
                    Text(stringResource(R.string.chat_push))
                }
            }
        }

        if (status == null) {
            item {
                Text(
                    stringResource(R.string.chat_not_repo),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            return@LazyColumn
        }

        // Staged files
        if (status.staged.isNotEmpty()) {
            item {
                FileSectionHeader(
                    title = stringResource(R.string.chat_staged_count, status.staged.size),
                    color = Color(0xFF4CAF50)
                )
            }
            items(diffs.filter { it.staged }) { diff ->
                DiffFileItem(
                    diff = diff,
                    isExpanded = expandedDiff == diff,
                    onClick = { onExpandDiff(diff) }
                )
            }
            items(status.staged.filter { staged -> diffs.none { it.file == staged && it.staged } }) { file ->
                SimpleFileItem(file = file, status = stringResource(R.string.chat_staged), color = Color(0xFF4CAF50))
            }
        }

        // Unstaged files
        if (status.unstaged.isNotEmpty()) {
            item {
                FileSectionHeader(
                    title = stringResource(R.string.chat_modified_count, status.unstaged.size),
                    color = MaterialTheme.colorScheme.secondary
                )
            }
            items(diffs.filter { !it.staged }) { diff ->
                DiffFileItem(
                    diff = diff,
                    isExpanded = expandedDiff == diff,
                    onClick = { onExpandDiff(diff) }
                )
            }
            items(status.unstaged.filter { u -> diffs.none { it.file == u && !it.staged } }) { file ->
                SimpleFileItem(file = file, status = stringResource(R.string.chat_modified), color = MaterialTheme.colorScheme.secondary)
            }
        }

        // Untracked files
        if (status.untracked.isNotEmpty()) {
            item {
                FileSectionHeader(
                    title = stringResource(R.string.chat_untracked_count, status.untracked.size),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            items(status.untracked) { file ->
                SimpleFileItem(file = file, status = stringResource(R.string.chat_untracked), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        // Clean state
        if (status.isClean) {
            item {
                Surface(
                    color = Color(0xFF4CAF50).copy(alpha = 0.1f),
                    shape = RoundedCornerShape(t.radius.md)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(t.spacing.lg),
                        horizontalArrangement = Arrangement.spacedBy(t.spacing.compact),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = Color(0xFF4CAF50)
                        )
                        Text(
                            stringResource(R.string.chat_tree_clean),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF4CAF50)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FileSectionHeader(title: String, color: Color) {
    val t = PlumTheme.tokens
    Row(
        horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(t.spacing.sm)
                .clip(RoundedCornerShape(t.spacing.xxs))
                .background(color)
        )
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = color
        )
    }
}

@Composable
private fun DiffFileItem(
    diff: GitFileDiff,
    isExpanded: Boolean,
    onClick: () -> Unit
) {
    val t = PlumTheme.tokens
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(t.radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = t.spacing.md, vertical = t.spacing.sm),
                horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Code,
                    contentDescription = null,
                    modifier = Modifier.size(t.spacing.cozy),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = diff.file.substringAfterLast('/'),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "+${diff.additions}",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF4CAF50),
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "-${diff.deletions}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.SemiBold
                )
                Icon(
                    if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    modifier = Modifier.size(t.spacing.cozy)
                )
            }
            if (isExpanded && diff.diff.isNotBlank()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                DiffContent(
                    diff = diff.diff,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF0D1117))
                        .padding(t.spacing.sm)
                )
            }
        }
    }
}

@Composable
private fun DiffContent(diff: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        diff.lines().take(100).forEach { line ->
            val color = when {
                line.startsWith("+") && !line.startsWith("+++") -> Color(0xFF4CAF50).copy(alpha = 0.8f)
                line.startsWith("-") && !line.startsWith("---") -> Color(0xFFF44336).copy(alpha = 0.8f)
                line.startsWith("@@") -> Color(0xFF2196F3).copy(alpha = 0.8f)
                else -> Color(0xFFCDD6F4).copy(alpha = 0.7f)
            }
            Text(
                text = line.take(120),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = color
                )
            )
        }
    }
}

@Composable
private fun SimpleFileItem(file: String, status: String, color: Color) {
    val t = PlumTheme.tokens
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = t.spacing.md, vertical = t.spacing.inline),
        horizontalArrangement = Arrangement.spacedBy(t.spacing.sm),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            color = color.copy(alpha = 0.15f),
            shape = RoundedCornerShape(3.dp)
        ) {
            Text(
                text = status.first().uppercaseChar().toString(),
                modifier = Modifier.padding(horizontal = t.spacing.xs, vertical = 1.dp),
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Bold
            )
        }
        Text(
            text = file.substringAfterLast('/'),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = file.substringBeforeLast('/', "").ifBlank { "." },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun GitLogTab(
    commits: List<GitCommit>,
    onCommitClick: (GitCommit) -> Unit
) {
    val t = PlumTheme.tokens
    if (commits.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.chat_no_commits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(t.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(t.spacing.sm)
    ) {
        items(commits) { commit ->
            CommitItem(commit = commit, onClick = { onCommitClick(commit) })
        }
    }
}

@Composable
private fun CommitItem(commit: GitCommit, onClick: () -> Unit) {
    val t = PlumTheme.tokens
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(t.radius.chip),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(t.spacing.md),
            horizontalArrangement = Arrangement.spacedBy(t.spacing.compact),
            verticalAlignment = Alignment.Top
        ) {
            // Hash badge
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(t.spacing.inline)
            ) {
                Text(
                    text = commit.shortHash,
                    modifier = Modifier.padding(horizontal = t.spacing.inline, vertical = 3.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = commit.message,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(t.spacing.xxs))
                Row(horizontalArrangement = Arrangement.spacedBy(t.spacing.sm)) {
                    Text(
                        text = commit.author,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = commit.date.take(10),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(t.spacing.cozy),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
            )
        }
    }
}

@Composable
private fun GitBranchesTab(
    branches: List<GitBranch>,
    onSwitchBranch: (String) -> Unit
) {
    val t = PlumTheme.tokens
    if (branches.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.chat_no_branches), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }

    val (local, remote) = branches.partition { !it.isRemote }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(t.spacing.lg),
        verticalArrangement = Arrangement.spacedBy(t.spacing.sm)
    ) {
        if (local.isNotEmpty()) {
            item {
                Text(
                    stringResource(R.string.chat_local_branches),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            items(local) { branch ->
                BranchItem(branch = branch, onSwitch = { onSwitchBranch(branch.name) })
            }
        }
        if (remote.isNotEmpty()) {
            item {
                Spacer(Modifier.height(t.spacing.sm))
                Text(
                    stringResource(R.string.chat_remote_branches),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.secondary
                )
            }
            items(remote) { branch ->
                BranchItem(branch = branch, onSwitch = { onSwitchBranch(branch.name) })
            }
        }
    }
}

@Composable
private fun BranchItem(branch: GitBranch, onSwitch: () -> Unit) {
    val t = PlumTheme.tokens
    Surface(
        shape = RoundedCornerShape(t.radius.chip),
        color = if (branch.isCurrent)
            MaterialTheme.colorScheme.primaryContainer
        else
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(t.spacing.md),
            horizontalArrangement = Arrangement.spacedBy(t.spacing.compact),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (branch.isCurrent) Icons.AutoMirrored.Filled.MergeType else Icons.Default.AccountTree,
                contentDescription = null,
                modifier = Modifier.size(t.spacing.lg),
                tint = if (branch.isCurrent)
                    MaterialTheme.colorScheme.onPrimaryContainer
                else
                    MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = branch.name,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (branch.isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                modifier = Modifier.weight(1f),
                color = if (branch.isCurrent)
                    MaterialTheme.colorScheme.onPrimaryContainer
                else
                    MaterialTheme.colorScheme.onSurface
            )
            if (branch.isCurrent) {
                Surface(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                    shape = RoundedCornerShape(t.spacing.xs)
                ) {
                    Text(
                        stringResource(R.string.chat_current),
                        modifier = Modifier.padding(horizontal = t.spacing.inline, vertical = t.spacing.xxs),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            } else if (!branch.isRemote) {
                TextButton(
                    onClick = onSwitch,
                    contentPadding = PaddingValues(horizontal = t.spacing.sm, vertical = t.spacing.xxs)
                ) {
                    Text(stringResource(R.string.chat_switch_branch), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun CommitDialog(
    stagedCount: Int,
    onDismiss: () -> Unit,
    onCommit: (message: String) -> Unit
) {
    val t = PlumTheme.tokens
    var message by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Check, contentDescription = null) },
        title = { Text(stringResource(R.string.chat_commit_changes)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(t.spacing.sm)) {
                Text(
                    stringResource(R.string.chat_commit_file_count, stagedCount),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text(stringResource(R.string.chat_commit_message)) },
                    placeholder = { Text(stringResource(R.string.chat_commit_placeholder)) },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 4
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onCommit(message.trim()) },
                enabled = message.isNotBlank()
            ) {
                Text(stringResource(R.string.chat_commit))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.chat_cancel)) }
        }
    )
}

@Composable
private fun CommitDetailDialog(
    commit: GitCommit,
    onDismiss: () -> Unit
) {
    val t = PlumTheme.tokens
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(commit.message, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(t.spacing.xs))
                Text(
                    commit.hash,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(t.spacing.inline)) {
                Row(horizontalArrangement = Arrangement.spacedBy(t.spacing.sm)) {
                    Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(t.spacing.cozy))
                    Text(commit.author, style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(t.spacing.sm)) {
                    Icon(Icons.Default.Schedule, contentDescription = null, modifier = Modifier.size(t.spacing.cozy))
                    Text(commit.date, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.chat_close)) }
        }
    )
}
