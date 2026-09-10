package com.claudewebui.app.ui.screens.devtools

import com.claudewebui.app.R
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.GitHubRepo

@Composable
fun CreateRepoDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String, Boolean) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isPrivate by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(screenResources.getString(R.string.devtools_create_github_repository_5befc)) },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(screenResources.getString(R.string.devtools_repository_name_4d82d)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text(screenResources.getString(R.string.devtools_description_optional_388de)) },
                    modifier = Modifier.fillMaxWidth().padding(top = screenTokens.spacing.sm),
                )
                CheckRow(screenResources.getString(R.string.devtools_private_repository_03e23), isPrivate) { isPrivate = it }
                Text(
                    screenResources.getString(R.string.devtools_the_repository_is_initialized_with_a_readme_so_it_can_be_cloned_i_6efae),
                    modifier = Modifier.padding(top = screenTokens.spacing.inline),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.trim().matches(Regex("^[a-zA-Z0-9._-]+$")),
                onClick = { onCreate(name.trim(), description.trim(), isPrivate) },
            ) { Text(screenResources.getString(R.string.devtools_create_6e157)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(screenResources.getString(R.string.devtools_cancel_77dfd)) } },
    )
}

@Composable
fun CloneRepoDialog(
    repo: GitHubRepo,
    initialTarget: String,
    onDismiss: () -> Unit,
    onClone: (String, String) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var target by remember(initialTarget) { mutableStateOf(initialTarget) }
    var branch by remember(repo.defaultBranch) { mutableStateOf(repo.defaultBranch) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(screenResources.getString(R.string.devtools_clone_1_s_0d262, repo.name)) },
        text = {
            Column {
                OutlinedTextField(
                    value = target,
                    onValueChange = { target = it },
                    label = { Text(screenResources.getString(R.string.devtools_target_directory_5295d)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = branch,
                    onValueChange = { branch = it },
                    label = { Text(screenResources.getString(R.string.devtools_branch_optional_38d4d)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = screenTokens.spacing.sm),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = target.isNotBlank(),
                onClick = { onClone(target.trim(), branch.trim()) },
            ) { Text(screenResources.getString(R.string.devtools_clone_d8cdb)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(screenResources.getString(R.string.devtools_cancel_77dfd)) } },
    )
}

@Composable
fun PushRepoDialog(
    onDismiss: () -> Unit,
    onPush: (String, String, Boolean) -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var remote by remember { mutableStateOf("origin") }
    var branch by remember { mutableStateOf("") }
    var force by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(screenResources.getString(R.string.devtools_push_current_workspace_31d66)) },
        text = {
            Column {
                OutlinedTextField(
                    value = remote,
                    onValueChange = { remote = it },
                    label = { Text(screenResources.getString(R.string.devtools_remote_c93f6)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = branch,
                    onValueChange = { branch = it },
                    label = { Text(screenResources.getString(R.string.devtools_branch_current_if_empty_1b708)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = screenTokens.spacing.sm),
                )
                CheckRow(screenResources.getString(R.string.devtools_force_push_d9fbd), force) { force = it }
                if (force) {
                    Text(screenResources.getString(R.string.devtools_force_push_may_overwrite_remote_history_df2ed))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onPush(remote.trim(), branch.trim(), force) }) {
                Text(if (force) screenResources.getString(R.string.devtools_force_push_d9fbd) else screenResources.getString(R.string.devtools_push_8f7f5))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(screenResources.getString(R.string.devtools_cancel_77dfd)) } },
    )
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(top = screenTokens.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Text(label)
    }
}
