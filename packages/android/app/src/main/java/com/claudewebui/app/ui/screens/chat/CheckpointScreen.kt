package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.Checkpoint

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckpointScreen(
    sessionId: String,
    checkpoints: List<Checkpoint>,
    isLoading: Boolean,
    onNavigateBack: () -> Unit,
    onCreateCheckpoint: (name: String, description: String?) -> Unit,
    onRestoreCheckpoint: (Checkpoint) -> Unit,
    onDeleteCheckpoint: (Checkpoint) -> Unit
) {
    val t = PlumTheme.tokens
    var showCreateDialog by remember { mutableStateOf(false) }
    var checkpointToRestore by remember { mutableStateOf<Checkpoint?>(null) }
    var checkpointToDelete by remember { mutableStateOf<Checkpoint?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.chat_panel_checkpoints))
                        Text(
                            stringResource(R.string.chat_restore_point_count, checkpoints.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.chat_back))
                    }
                },
                actions = {
                    IconButton(onClick = { showCreateDialog = true }) {
                        Icon(Icons.Default.AddCircleOutline, contentDescription = stringResource(R.string.chat_create_checkpoint))
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showCreateDialog = true },
                icon = { Icon(Icons.Default.Bookmark, contentDescription = null) },
                text = { Text(stringResource(R.string.chat_create_checkpoint_title)) }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                checkpoints.isEmpty() -> EmptyCheckpointsView(modifier = Modifier.align(Alignment.Center))
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = t.spacing.lg,
                            end = t.spacing.lg,
                            top = t.spacing.lg,
                            bottom = 100.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        itemsIndexed(
                            items = checkpoints,
                            key = { _, cp -> cp.id }
                        ) { index, checkpoint ->
                            CheckpointTimelineItem(
                                checkpoint = checkpoint,
                                isFirst = index == 0,
                                isLast = index == checkpoints.lastIndex,
                                onRestore = { checkpointToRestore = checkpoint },
                                onDelete = { checkpointToDelete = checkpoint }
                            )
                        }
                    }
                }
            }
        }
    }

    // Create checkpoint dialog
    if (showCreateDialog) {
        CreateCheckpointDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { name, description ->
                onCreateCheckpoint(name, description)
                showCreateDialog = false
            }
        )
    }

    // Restore confirmation dialog
    checkpointToRestore?.let { checkpoint ->
        AlertDialog(
            onDismissRequest = { checkpointToRestore = null },
            icon = {
                Icon(
                    Icons.Default.RestoreFromTrash,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
            },
            title = { Text(stringResource(R.string.chat_restore_checkpoint_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(t.spacing.sm)) {
                    Text(
                        stringResource(R.string.chat_restore_named, checkpoint.name),
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        stringResource(R.string.chat_restore_warning),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(t.radius.sm)
                    ) {
                        Row(
                            modifier = Modifier.padding(t.spacing.compact),
                            horizontalArrangement = Arrangement.spacedBy(t.spacing.inline)
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(t.spacing.cozy),
                                tint = MaterialTheme.colorScheme.onErrorContainer
                            )
                            Text(
                                stringResource(R.string.chat_restore_destructive),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onRestoreCheckpoint(checkpoint)
                        checkpointToRestore = null
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Icon(Icons.Default.Restore, contentDescription = null, modifier = Modifier.size(t.spacing.lg))
                    Spacer(Modifier.width(t.spacing.xs))
                    Text(stringResource(R.string.chat_restore))
                }
            },
            dismissButton = {
                TextButton(onClick = { checkpointToRestore = null }) {
                    Text(stringResource(R.string.chat_cancel))
                }
            }
        )
    }

    // Delete confirmation dialog
    checkpointToDelete?.let { checkpoint ->
        AlertDialog(
            onDismissRequest = { checkpointToDelete = null },
            title = { Text(stringResource(R.string.chat_delete_checkpoint_title)) },
            text = {
                Text(stringResource(R.string.chat_delete_named, checkpoint.name))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteCheckpoint(checkpoint)
                        checkpointToDelete = null
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text(stringResource(R.string.chat_delete_action))
                }
            },
            dismissButton = {
                TextButton(onClick = { checkpointToDelete = null }) {
                    Text(stringResource(R.string.chat_cancel))
                }
            }
        )
    }
}

@Composable
private fun CheckpointTimelineItem(
    checkpoint: Checkpoint,
    isFirst: Boolean,
    isLast: Boolean,
    onRestore: () -> Unit,
    onDelete: () -> Unit
) {
    val t = PlumTheme.tokens
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(t.spacing.md)
    ) {
        // Timeline column
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.width(t.spacing.xl)
        ) {
            // Top connector line
            if (!isFirst) {
                Box(
                    modifier = Modifier
                        .width(t.spacing.xxs)
                        .height(t.spacing.md)
                        .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
                )
            } else {
                Spacer(Modifier.height(t.spacing.md))
            }
            // Dot
            Box(
                modifier = Modifier
                    .size(t.spacing.cozy)
                    .clip(CircleShape)
                    .background(
                        if (isFirst) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)
                    )
            )
            // Bottom connector line
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(t.spacing.xxs)
                        .weight(1f)
                        .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
                )
            }
        }

        // Card content
        Card(
            modifier = Modifier
                .weight(1f)
                .padding(bottom = t.spacing.md),
            shape = RoundedCornerShape(t.radius.md),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(
                modifier = Modifier.padding(t.spacing.cozy),
                verticalArrangement = Arrangement.spacedBy(t.spacing.inline)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = checkpoint.name,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f)
                    )
                    if (isFirst) {
                        Surface(
                            color = MaterialTheme.colorScheme.primaryContainer,
                            shape = RoundedCornerShape(t.spacing.xs)
                        ) {
                            Text(
                                stringResource(R.string.chat_checkpoint_latest),
                                modifier = Modifier.padding(horizontal = t.spacing.inline, vertical = t.spacing.xxs),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                }
                if (!checkpoint.description.isNullOrBlank()) {
                    Text(
                        text = checkpoint.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(t.spacing.md)
                ) {
                    MetaChip(
                        icon = Icons.Default.ChatBubbleOutline,
                        text = stringResource(R.string.chat_message_count, checkpoint.messageCount)
                    )
                    MetaChip(
                        icon = Icons.Default.Schedule,
                        text = checkpoint.createdAt.take(10)
                    )
                }
                // Actions
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(
                        onClick = onDelete,
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(t.spacing.xs))
                        Text(stringResource(R.string.chat_delete_action), style = MaterialTheme.typography.labelMedium)
                    }
                    Spacer(Modifier.width(t.spacing.xs))
                    FilledTonalButton(onClick = onRestore) {
                        Icon(Icons.Default.Restore, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(t.spacing.xs))
                        Text(stringResource(R.string.chat_restore), style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun MetaChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String
) {
    val t = PlumTheme.tokens
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(t.spacing.md),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun CreateCheckpointDialog(
    onDismiss: () -> Unit,
    onCreate: (name: String, description: String?) -> Unit
) {
    val t = PlumTheme.tokens
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Default.Bookmark, contentDescription = null)
        },
        title = { Text(stringResource(R.string.chat_create_checkpoint_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(t.spacing.md)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.chat_name_required)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(stringResource(R.string.chat_checkpoint_name_placeholder)) }
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text(stringResource(R.string.chat_description_optional)) },
                    maxLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(stringResource(R.string.chat_checkpoint_description_placeholder)) }
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onCreate(name.trim(), description.trim().takeIf { it.isNotEmpty() })
                },
                enabled = name.isNotBlank()
            ) {
                Text(stringResource(R.string.chat_create))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.chat_cancel)) }
        }
    )
}

@Composable
private fun EmptyCheckpointsView(modifier: Modifier = Modifier) {
    val t = PlumTheme.tokens
    Column(
        modifier = modifier.padding(t.spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(t.spacing.md)
    ) {
        Icon(
            Icons.Default.BookmarkBorder,
            contentDescription = null,
            modifier = Modifier.size(56.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        )
        Text(
            stringResource(R.string.chat_no_checkpoints),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            stringResource(R.string.chat_checkpoint_empty_detail),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
    }
}
