package com.claudewebui.app.ui.components.filemanager

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.screens.filemanager.FileManagerViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileUploadSheet(
    sessionId: String,
    currentPath: String,
    onDismiss: () -> Unit,
    onUploadComplete: () -> Unit,
    viewModel: FileManagerViewModel
) {
    val componentTokens = PlumTheme.tokens
    val context = LocalContext.current
    val state by viewModel.state.collectAsState()

    var selectedFiles by remember { mutableStateOf<List<Pair<Uri, String>>>(emptyList()) }

    // File picker launcher (multiple files)
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        val newFiles = uris.mapNotNull { uri ->
            val fileName = getFileNameFromUri(context, uri) ?: return@mapNotNull null
            uri to fileName
        }
        selectedFiles = selectedFiles + newFiles
    }

    // Camera launcher
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success ->
        if (success) {
            cameraUri?.let { uri ->
                val fileName = "photo_${System.currentTimeMillis()}.jpg"
                selectedFiles = selectedFiles + (uri to fileName)
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        dragHandle = { BottomSheetDefaults.DragHandle() }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = componentTokens.spacing.lg)
                .padding(bottom = componentTokens.spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.lg)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    stringResource(R.string.component_upload_files),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold
                )
                TextButton(onClick = onDismiss) {
                    Text(stringResource(R.string.component_cancel))
                }
            }

            // Upload destination
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(componentTokens.radius.sm)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(componentTokens.spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Folder,
                        contentDescription = null,
                        modifier = Modifier.size(componentTokens.sizing.iconSm),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = currentPath,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            // Source buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm)
            ) {
                OutlinedButton(
                    onClick = { filePickerLauncher.launch("*/*") },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.FolderOpen, contentDescription = null, modifier = Modifier.size(componentTokens.sizing.iconInline))
                    Spacer(Modifier.width(componentTokens.spacing.inline))
                    Text(stringResource(R.string.component_storage))
                }
                OutlinedButton(
                    onClick = {
                        val uri = createTempImageUri(context)
                        cameraUri = uri
                        cameraLauncher.launch(uri)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(componentTokens.sizing.iconInline))
                    Spacer(Modifier.width(componentTokens.spacing.inline))
                    Text(stringResource(R.string.component_camera))
                }
            }

            // Selected files list
            if (selectedFiles.isNotEmpty()) {
                Text(
                    stringResource(R.string.component_selected_files, selectedFiles.size),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 200.dp)
                        .clip(RoundedCornerShape(componentTokens.radius.sm))
                        .border(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                            RoundedCornerShape(componentTokens.radius.sm)
                        ),
                    contentPadding = PaddingValues(componentTokens.spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xxs)
                ) {
                    items(selectedFiles) { (uri, name) ->
                        SelectedFileItem(
                            fileName = name,
                            onRemove = {
                                selectedFiles = selectedFiles.filter { it.first != uri }
                            }
                        )
                    }
                }
            } else {
                // Drop zone visual
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(100.dp)
                        .clip(RoundedCornerShape(componentTokens.radius.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .border(
                            width = componentTokens.spacing.xxs,
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                            shape = RoundedCornerShape(componentTokens.radius.md)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline)
                    ) {
                        Icon(
                            Icons.Default.CloudUpload,
                            contentDescription = null,
                            modifier = Modifier.size(componentTokens.spacing.xxl),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        )
                        Text(
                            stringResource(R.string.component_select_files_to_upload),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                        )
                    }
                }
            }

            // Upload progress
            if (state.isUploading) {
                Column(verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xs)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(stringResource(R.string.component_uploading), style = MaterialTheme.typography.bodySmall)
                        Text(
                            "${((state.uploadProgress ?: 0f) * 100).toInt()}%",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    LinearProgressIndicator(
                        progress = { state.uploadProgress ?: 0f },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // Error
            state.error?.let { error ->
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(componentTokens.radius.sm)
                ) {
                    Row(
                        modifier = Modifier.padding(componentTokens.spacing.md),
                        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm)
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            modifier = Modifier.size(componentTokens.sizing.iconSm),
                            tint = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            error,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
            }

            // Upload button
            Button(
                onClick = {
                    selectedFiles.forEach { (uri, name) ->
                        viewModel.uploadFile(context, uri, name)
                    }
                    onUploadComplete()
                },
                enabled = selectedFiles.isNotEmpty() && !state.isUploading,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (state.isUploading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(componentTokens.sizing.iconInline),
                        strokeWidth = componentTokens.spacing.xxs,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                    Spacer(Modifier.width(componentTokens.spacing.sm))
                    Text(stringResource(R.string.component_uploading))
                } else {
                    Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.size(componentTokens.sizing.iconInline))
                    Spacer(Modifier.width(componentTokens.spacing.sm))
                    Text(
                        if (selectedFiles.isEmpty()) stringResource(R.string.component_select_files_first)
                        else stringResource(R.string.component_upload_files_count, selectedFiles.size)
                    )
                }
            }
        }
    }
}

@Composable
private fun SelectedFileItem(
    fileName: String,
    onRemove: () -> Unit
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(componentTokens.spacing.inline)
            )
            .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.inline),
        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.Default.InsertDriveFile,
            contentDescription = null,
            modifier = Modifier.size(componentTokens.sizing.iconSm),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = fileName,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        IconButton(
            onClick = onRemove,
            modifier = Modifier.size(componentTokens.sizing.touchTarget)
        ) {
            Icon(
                Icons.Default.Close,
                contentDescription = stringResource(R.string.component_remove),
                modifier = Modifier.size(componentTokens.sizing.iconXs),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private fun getFileNameFromUri(context: android.content.Context, uri: Uri): String? {
    return try {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            cursor.moveToFirst()
            if (nameIndex >= 0) cursor.getString(nameIndex) else null
        } ?: uri.lastPathSegment
    } catch (e: Exception) {
        uri.lastPathSegment
    }
}

private fun createTempImageUri(context: android.content.Context): Uri {
    val directory = java.io.File(context.cacheDir, "camera").apply { mkdirs() }
    val file = java.io.File(directory, "camera_${System.currentTimeMillis()}.jpg")
    return androidx.core.content.FileProvider.getUriForFile(
        context,
        "${context.packageName}.provider",
        file
    )
}
