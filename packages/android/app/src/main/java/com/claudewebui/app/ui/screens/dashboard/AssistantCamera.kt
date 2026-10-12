package com.claudewebui.app.ui.screens.dashboard

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.AsyncImage
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import kotlinx.coroutines.*
import java.io.File

/** Camera intent returns to a local preview; upload always needs a second action. */
@Composable
internal fun AssistantCamera(owner: String, chatId: String, api: ApiClient, enabled: Boolean, onImage: (String) -> Unit, onBusy: (Boolean) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val latestEnabled by rememberUpdatedState(enabled)
    val latestImage by rememberUpdatedState(onImage)
    val latestBusy by rememberUpdatedState(onBusy)
    var capture by remember { mutableStateOf<File?>(null) }
    var external by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var mounted by remember { mutableStateOf(true) }
    fun discard() { job?.cancel(); job = null; capture?.delete(); capture = null; working = false; latestBusy(false) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        external = false
        if (!success || !mounted || TokenStore.assistantOwnerKey() != owner) discard()
    }
    fun launch() {
        if (!latestEnabled || !mounted || TokenStore.assistantOwnerKey() != owner || !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        discard(); failure = null
        try {
            val directory = File(context.cacheDir, "camera").also { it.mkdirs() }
            val file = File.createTempFile("plum-chat-", ".jpg", directory)
            capture = file; external = true; latestBusy(true)
            camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.provider", file))
        } catch (error: Exception) { external = false; failure = error.message; discard() }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launch() else failure = context.getString(R.string.assistant_camera_denied)
    }
    DisposableEffect(owner, chatId, lifecycle) {
        // The external camera itself stops this Activity. Its local file must survive
        // that stop, but an already returned preview/upload is discarded on background.
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP && !external) discard() }
        lifecycle.addObserver(observer)
        onDispose { mounted = false; lifecycle.removeObserver(observer); discard() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (capture == null) OutlinedButton(enabled = enabled, onClick = {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launch()
            else permission.launch(Manifest.permission.CAMERA)
        }) { Text(stringResource(R.string.assistant_take_photo)) }
        else if (!external) {
            AsyncImage(capture, stringResource(R.string.assistant_camera_preview), modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = enabled && !working, onClick = {
                    val file = capture ?: return@Button
                    working = true; failure = null
                    job = scope.launch {
                        try {
                            val bytes = withContext(Dispatchers.IO) {
                                require(file.length() in 1..5L * 1024 * 1024) { context.getString(R.string.assistant_camera_too_large) }
                                file.readBytes()
                            }
                            val response = api.uploadAssistantApiImage(owner, chatId, "camera.jpg", "image/jpeg", bytes)
                            if (!mounted || TokenStore.assistantOwnerKey() != owner) throw CancellationException("Assistant account changed")
                            if (!response.success) error(response.error?.message ?: context.getString(R.string.assistant_image_unavailable))
                            latestImage(requireNotNull(response.data).id)
                            file.delete(); capture = null; latestBusy(false)
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (error: Exception) { if (mounted && TokenStore.assistantOwnerKey() == owner) failure = error.message }
                        finally { working = false }
                    }
                }) { Text(stringResource(R.string.assistant_use_photo)) }
                TextButton(onClick = { discard() }) { Text(stringResource(R.string.assistant_discard_photo)) }
            }
            if (working) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }
}
