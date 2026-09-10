package com.claudewebui.app.ui.screens.filemanager

import com.claudewebui.app.R
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.FileInfo
import com.claudewebui.app.data.model.FileType
import com.claudewebui.app.ui.components.filemanager.FileUploadSheet
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import java.io.File
import java.text.DecimalFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileManagerScreen(
    sessionId: String,
    workingDirectory: String,
    onNavigateBack: () -> Unit,
    onOpenFile: (FileInfo) -> Unit,
    onSendToChat: (String) -> Unit = {}
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val viewModel: FileManagerViewModel = koinViewModel(
        parameters = { parametersOf(sessionId, workingDirectory) }
    )
    val state by viewModel.state.collectAsState()

    var showUploadSheet by remember { mutableStateOf(false) }
    var longPressedFile by remember { mutableStateOf<FileInfo?>(null) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    // Save-to-device: fetch the bytes (file, or the folder as ZIP) into the
    // cache, then let the system picker choose the destination — same flow as
    // chat attachments, no storage permission needed.
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var pendingSaveFile by remember { mutableStateOf<File?>(null) }
    var downloadBusy by remember { mutableStateOf(false) }
    val saveDownloadLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("*/*"),
    ) { destination ->
        val source = pendingSaveFile
        pendingSaveFile = null
        if (destination != null && source != null) {
            coroutineScope.launch(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openOutputStream(destination)?.use { output ->
                        source.inputStream().use { input -> input.copyTo(output) }
                    } ?: error(context.getString(R.string.filemanager_unwritable))
                }.onFailure {
                    viewModel.reportError(it.message ?: context.getString(R.string.filemanager_download_failed))
                }
                source.delete()
            }
        } else {
            source?.delete()
        }
    }
    val downloadToDevice: (FileInfo) -> Unit = { file ->
        if (!downloadBusy) {
            coroutineScope.launch {
                downloadBusy = true
                val saveName = if (file.type == FileType.DIRECTORY) "${file.name}.zip" else file.name
                viewModel.fetchDownload(file)
                    .mapCatching { bytes ->
                        withContext(Dispatchers.IO) { cacheDownload(context, saveName, bytes) }
                    }
                    .onSuccess { cached ->
                        pendingSaveFile = cached
                        saveDownloadLauncher.launch(saveName)
                    }
                    .onFailure { failure ->
                        viewModel.reportError(
                            failure.message ?: context.getString(R.string.filemanager_download_failed)
                        )
                    }
                downloadBusy = false
            }
        }
    }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Text(
                            text = state.pathSegments.lastOrNull() ?: screenResources.getString(R.string.filemanager_files_6ce6c),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = screenResources.getString(R.string.filemanager_back_b52b3))
                        }
                    },
                    actions = {
                        IconButton(onClick = { viewModel.refresh() }) {
                            Icon(Icons.Default.Refresh, contentDescription = screenResources.getString(R.string.filemanager_refresh_56e3b))
                        }
                    }
                )
                // Breadcrumb bar
                BreadcrumbBar(
                    segments = state.pathSegments,
                    onSegmentClick = { index ->
                        viewModel.navigateTo(viewModel.pathForSegment(index))
                    },
                    onGoUp = { viewModel.goUp() },
                    showGoUp = state.pathSegments.size > 1
                )
                // Search bar
                SearchBar(
                    query = state.searchQuery,
                    onQueryChange = { viewModel.search(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.xs)
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showUploadSheet = true },
                containerColor = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(Icons.Default.Upload, contentDescription = screenResources.getString(R.string.filemanager_upload_file_503a3))
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                state.error != null -> {
                    ErrorView(
                        message = state.error!!,
                        onRetry = { viewModel.refresh() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                state.filteredFiles.isEmpty() && state.searchQuery.isBlank() -> {
                    EmptyDirectoryView(modifier = Modifier.align(Alignment.Center))
                }
                state.filteredFiles.isEmpty() -> {
                    NoSearchResultsView(
                        query = state.searchQuery,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 80.dp)
                    ) {
                        items(
                            items = state.filteredFiles,
                            key = { it.path }
                        ) { file ->
                            FileListItem(
                                file = file,
                                onClick = {
                                    if (file.type == FileType.DIRECTORY) {
                                        viewModel.navigateTo(file.path)
                                    } else {
                                        onOpenFile(file)
                                    }
                                },
                                onLongClick = {
                                    longPressedFile = file
                                }
                            )
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 68.dp),
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)
                            )
                        }
                    }
                }
            }

            // Upload progress overlay
            if (state.isUploading) {
                UploadProgressOverlay(
                    progress = state.uploadProgress ?: 0f,
                    modifier = Modifier.align(Alignment.BottomCenter)
                )
            }
        }
    }

    // Long-press context menu
    longPressedFile?.let { file ->
        FileContextMenu(
            file = file,
            onDismiss = { longPressedFile = null },
            onDelete = {
                showDeleteDialog = true
            },
            onSendToChat = {
                onSendToChat(file.path)
                longPressedFile = null
            },
            onDownload = {
                downloadToDevice(file)
                longPressedFile = null
            },
            downloadBusy = downloadBusy
        )
    }

    // Delete confirmation dialog
    if (showDeleteDialog && longPressedFile != null) {
        AlertDialog(
            onDismissRequest = {
                showDeleteDialog = false
                longPressedFile = null
            },
            title = { Text(screenResources.getString(R.string.filemanager_delete_1_s_137cd, longPressedFile?.name)) },
            text = { Text(screenResources.getString(R.string.filemanager_this_action_cannot_be_undone_951f4)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        longPressedFile?.let { viewModel.deleteFile(it) }
                        showDeleteDialog = false
                        longPressedFile = null
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text(screenResources.getString(R.string.filemanager_delete_f6fdb))
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showDeleteDialog = false
                    longPressedFile = null
                }) {
                    Text(screenResources.getString(R.string.filemanager_cancel_77dfd))
                }
            }
        )
    }

    // Upload sheet
    if (showUploadSheet) {
        FileUploadSheet(
            sessionId = sessionId,
            currentPath = state.currentPath,
            onDismiss = { showUploadSheet = false },
            onUploadComplete = {
                showUploadSheet = false
                viewModel.refresh()
            },
            viewModel = viewModel
        )
    }
}

@Composable
private fun BreadcrumbBar(
    segments: List<String>,
    onSegmentClick: (Int) -> Unit,
    onGoUp: () -> Unit,
    showGoUp: Boolean,
    modifier: Modifier = Modifier
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = screenTokens.spacing.sm, vertical = screenTokens.spacing.inline),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (showGoUp) {
            IconButton(
                onClick = onGoUp,
                modifier = Modifier.size(com.claudewebui.app.ui.theme.PlumTheme.tokens.sizing.touchTarget)
            ) {
                Icon(
                    Icons.Default.ArrowUpward,
                    contentDescription = screenResources.getString(R.string.filemanager_go_up_25874),
                    modifier = Modifier.size(screenTokens.sizing.iconInline),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        Icon(
            Icons.Default.Home,
            contentDescription = null,
            modifier = Modifier.size(screenTokens.sizing.iconSm),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        segments.forEachIndexed { index, segment ->
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(screenTokens.sizing.iconSm),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )
            TextButton(
                onClick = { onSegmentClick(index) },
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                modifier = Modifier.height(28.dp)
            ) {
                Text(
                    text = segment,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (index == segments.lastIndex) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (index == segments.lastIndex)
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text(screenResources.getString(R.string.filemanager_search_files_fe116), style = MaterialTheme.typography.bodyMedium) },
        leadingIcon = {
            Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconInline))
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = screenResources.getString(R.string.filemanager_clear_719ea), modifier = Modifier.size(screenTokens.sizing.iconInline))
                }
            }
        },
        singleLine = true,
        modifier = modifier,
        shape = RoundedCornerShape(screenTokens.radius.xl),
        textStyle = MaterialTheme.typography.bodyMedium
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileListItem(
    file: FileInfo,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Row(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
            .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.compact),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)
    ) {
        // File icon
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(screenTokens.radius.sm))
                .background(fileIconBackground(file)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = fileIcon(file),
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = fileIconTint(file)
            )
        }

        // Name + metadata
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = file.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)
            ) {
                if (file.type == FileType.FILE) {
                    Text(
                        text = formatFileSize(file.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    text = formatDate(file.modifiedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        if (file.type == FileType.DIRECTORY) {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(screenTokens.sizing.iconInline),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
        }
    }
}

@Composable
private fun fileIconBackground(file: FileInfo): androidx.compose.ui.graphics.Color {
    return when {
        file.type == FileType.DIRECTORY -> MaterialTheme.colorScheme.primaryContainer
        isImageFile(file.extension) -> MaterialTheme.colorScheme.tertiaryContainer
        isCodeFile(file.extension) -> MaterialTheme.colorScheme.secondaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
}

@Composable
private fun fileIconTint(file: FileInfo): androidx.compose.ui.graphics.Color {
    return when {
        file.type == FileType.DIRECTORY -> MaterialTheme.colorScheme.onPrimaryContainer
        isImageFile(file.extension) -> MaterialTheme.colorScheme.onTertiaryContainer
        isCodeFile(file.extension) -> MaterialTheme.colorScheme.onSecondaryContainer
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}

private fun fileIcon(file: FileInfo): ImageVector {
    if (file.type == FileType.DIRECTORY) return Icons.Default.Folder
    return when (file.extension?.lowercase()) {
        "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp" -> Icons.Default.Image
        "mp4", "mkv", "avi", "mov", "webm" -> Icons.Default.VideoFile
        "mp3", "wav", "flac", "ogg", "aac" -> Icons.Default.AudioFile
        "pdf" -> Icons.Default.PictureAsPdf
        "zip", "tar", "gz", "7z", "rar" -> Icons.Default.FolderZip
        "kt", "java", "py", "js", "ts", "go", "rs", "cpp", "c", "h",
        "cs", "swift", "rb", "php", "sh", "bash", "zsh" -> Icons.Default.Code
        "json", "yaml", "yml", "toml", "xml", "env" -> Icons.Default.DataObject
        "md", "txt", "rst", "log" -> Icons.Default.Article
        "html", "htm", "css", "scss" -> Icons.Default.Language
        else -> Icons.AutoMirrored.Filled.InsertDriveFile
    }
}

private fun isImageFile(ext: String?) = ext?.lowercase() in setOf("png", "jpg", "jpeg", "gif", "webp", "svg", "bmp")
private fun isCodeFile(ext: String?) = ext?.lowercase() in setOf(
    "kt", "java", "py", "js", "ts", "go", "rs", "cpp", "c", "h",
    "cs", "swift", "rb", "php", "sh", "bash", "json", "yaml", "yml",
    "toml", "xml", "html", "htm", "css", "scss", "md"
)

private fun formatFileSize(bytes: Long): String {
    if (bytes == 0L) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    val fmt = DecimalFormat("#.#")
    var size = bytes.toDouble()
    var unitIndex = 0
    while (size >= 1024 && unitIndex < units.lastIndex) {
        size /= 1024
        unitIndex++
    }
    return "${fmt.format(size)} ${units[unitIndex]}"
}

private fun formatDate(dateStr: String): String {
    return try {
        dateStr.take(10) // "YYYY-MM-DD"
    } catch (e: Exception) {
        dateStr
    }
}

@Composable
private fun FileContextMenu(
    file: FileInfo,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
    onSendToChat: () -> Unit,
    onDownload: () -> Unit = {},
    downloadBusy: Boolean = false
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = file.name,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        text = {
            Column {
                TextButton(
                    onClick = {
                        onSendToChat()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Chat, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconInline))
                    Spacer(Modifier.width(8.dp))
                    Text(screenResources.getString(R.string.filemanager_send_path_to_chat_6d770))
                }
                TextButton(
                    onClick = {
                        onDownload()
                        onDismiss()
                    },
                    enabled = !downloadBusy,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconInline))
                    Spacer(Modifier.width(8.dp))
                    Column(horizontalAlignment = Alignment.Start) {
                        Text(
                            screenResources.getString(
                                if (file.type == FileType.DIRECTORY) R.string.filemanager_download_zip
                                else R.string.filemanager_download_file
                            )
                        )
                        if (file.type == FileType.DIRECTORY) {
                            Text(
                                screenResources.getString(R.string.filemanager_download_zip_hint),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                TextButton(
                    onClick = {
                        onDelete()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconInline))
                    Spacer(Modifier.width(8.dp))
                    Text(screenResources.getString(R.string.filemanager_delete_f6fdb))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(screenResources.getString(R.string.filemanager_cancel_77dfd)) }
        }
    )
}

private fun cacheDownload(context: android.content.Context, filename: String, bytes: ByteArray): File {
    val directory = File(context.cacheDir, "file-downloads").apply { mkdirs() }
    val safeName = filename
        .substringAfterLast('/')
        .substringAfterLast('\\')
        .replace(Regex("[\\p{Cc}\\p{Cf}]"), "")
        .take(120)
        .ifBlank { "download" }
    return File(directory, "${System.currentTimeMillis()}-$safeName").apply {
        outputStream().use { it.write(bytes) }
    }
}

@Composable
private fun UploadProgressOverlay(
    progress: Float,
    modifier: Modifier = Modifier
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(screenTokens.spacing.lg),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Column(modifier = Modifier.padding(screenTokens.spacing.lg)) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(screenResources.getString(R.string.filemanager_uploading_070e3), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text("${(progress * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun ErrorView(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Column(
        modifier = modifier.padding(screenTokens.spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)
    ) {
        Icon(
            Icons.Default.ErrorOutline,
            contentDescription = null,
            modifier = Modifier.size(screenTokens.sizing.touchTarget),
            tint = MaterialTheme.colorScheme.error
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        OutlinedButton(onClick = onRetry) {
            Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconSm))
            Spacer(Modifier.width(4.dp))
            Text(screenResources.getString(R.string.filemanager_retry_9f5cd))
        }
    }
}

@Composable
private fun EmptyDirectoryView(modifier: Modifier = Modifier) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Column(
        modifier = modifier.padding(screenTokens.spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)
    ) {
        Icon(
            Icons.Default.FolderOpen,
            contentDescription = null,
            modifier = Modifier.size(56.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        )
        Text(
            screenResources.getString(R.string.filemanager_empty_directory_950d3),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            screenResources.getString(R.string.filemanager_upload_files_using_the_button_below_c7fda),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
    }
}

@Composable
private fun NoSearchResultsView(query: String, modifier: Modifier = Modifier) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Column(
        modifier = modifier.padding(screenTokens.spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)
    ) {
        Icon(
            Icons.Default.SearchOff,
            contentDescription = null,
            modifier = Modifier.size(screenTokens.sizing.touchTarget),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        )
        Text(
            screenResources.getString(R.string.filemanager_no_results_for_1_s_70985, query),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
