package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModelStoreOwner
import com.claudewebui.app.R
import com.claudewebui.app.ui.screens.notes.NotesScreen
import com.claudewebui.app.ui.screens.notes.NotesViewModel
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

internal enum class ChatSidePanel(val label: Int) {
    GIT(R.string.chat_panel_git),
    CHECKPOINTS(R.string.chat_panel_checkpoints),
    NOTES(R.string.chat_panel_notes),
}

/** Existing session tools remain interactive alongside the transcript on tablets. */
@Composable
internal fun ChatSessionSidePanel(
    sessionId: String,
    panel: ChatSidePanel,
    onPanelChange: (ChatSidePanel) -> Unit,
    onClose: () -> Unit,
    storeOwner: ViewModelStoreOwner,
    modifier: Modifier = Modifier,
) {
    val t = PlumTheme.tokens
    Column(modifier.statusBarsPadding()) {
        TabRow(selectedTabIndex = panel.ordinal) {
            ChatSidePanel.entries.forEach { option ->
                Tab(
                    selected = panel == option,
                    onClick = { onPanelChange(option) },
                    text = { Text(stringResource(option.label), maxLines = 1) },
                )
            }
        }
        Box(Modifier.weight(1f)) {
            when (panel) {
                ChatSidePanel.GIT -> {
                    val vm: GitViewModel = koinViewModel(
                        viewModelStoreOwner = storeOwner,
                        parameters = { parametersOf(sessionId) },
                    )
                    val state by vm.uiState.collectAsState()
                    GitScreen(
                        workingDirectory = state.workingDirectory,
                        gitStatus = state.gitStatus,
                        commits = state.commits,
                        diffs = state.diffs,
                        branches = state.branches,
                        isLoading = state.isLoading,
                        isCommitting = state.isCommitting,
                        isPushing = state.isPushing,
                        onNavigateBack = onClose,
                        onStageAll = vm::stageAll,
                        onCommit = vm::commit,
                        onPush = vm::push,
                        onSwitchBranch = vm::switchBranch,
                        onRefresh = vm::refreshGitStatus,
                    )
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(t.spacing.lg)) }
                }
                ChatSidePanel.CHECKPOINTS -> {
                    val vm: CheckpointViewModel = koinViewModel(
                        viewModelStoreOwner = storeOwner,
                        parameters = { parametersOf(sessionId) },
                    )
                    val state by vm.uiState.collectAsState()
                    CheckpointScreen(
                        sessionId = sessionId,
                        checkpoints = state.checkpoints,
                        isLoading = state.isLoading,
                        onNavigateBack = onClose,
                        onCreateCheckpoint = vm::createCheckpoint,
                        onRestoreCheckpoint = vm::restoreCheckpoint,
                        onDeleteCheckpoint = vm::deleteCheckpoint,
                    )
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(t.spacing.lg)) }
                }
                ChatSidePanel.NOTES -> {
                    val vm: NotesViewModel = koinViewModel(
                        viewModelStoreOwner = storeOwner,
                        parameters = { parametersOf(sessionId) },
                    )
                    NotesScreen(viewModel = vm, onNavigateBack = onClose)
                }
            }
        }
    }
}
