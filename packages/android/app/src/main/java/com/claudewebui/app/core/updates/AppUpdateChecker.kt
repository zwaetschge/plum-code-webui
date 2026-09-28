package com.claudewebui.app.core.updates

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.core.content.FileProvider
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.apiCall
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.io.File

/** DownloadManager owns the transfer; persisted identity lets us reattach after process death. */
class AppUpdateChecker(context: Context, private val apiClient: ApiClient) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs = appContext.getSharedPreferences("app_update", Context.MODE_PRIVATE)
    private val dm = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val _updateState = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val updateState: StateFlow<UpdateState> = _updateState.asStateFlow()
    private var downloadJob: Job? = null
    private var checkJob: Job? = null

    init {
        val id = prefs.getLong("id", -1)
        val path = prefs.getString("path", null)
        if (prefs.getInt("version", -1) <= BuildConfig.VERSION_CODE) {
            if (id >= 0) dm.remove(id)
            prefs.edit().clear().apply()
        } else if (id >= 0 && path != null) downloadJob = scope.launch {
            apiCall { observeDownload(id, File(path), openInstaller = false) }
                .onFailure { _updateState.value = UpdateState.Error(appContext.getString(R.string.update_failed)) }
        }
    }

    fun checkForUpdate() {
        if (downloadJob?.isActive == true || checkJob?.isActive == true) return
        checkJob = scope.launch {
            _updateState.value = UpdateState.Checking
            apiCall {
                val response = apiClient.checkAppVersion()
                check(response.success && response.data != null)
                response.data!!
            }.onSuccess { info ->
                _updateState.value = if (info.versionCode > BuildConfig.VERSION_CODE && info.downloadUrl.isNotBlank())
                    UpdateState.UpdateAvailable(BuildConfig.VERSION_NAME, info.version, info.downloadUrl, info.releaseNotes)
                else UpdateState.UpToDate
            }.onFailure { _updateState.value = UpdateState.Error(appContext.getString(R.string.update_failed)) }
        }
    }

    fun downloadAndInstall(downloadUrl: String) {
        if (downloadJob?.isActive == true) return
        _updateState.value = UpdateState.Downloading(-1)
        downloadJob = scope.launch {
            apiCall {
                // A signed link can expire while the user reads the release notes.
                val response = apiClient.checkAppVersion()
                val info = response.data
                check(response.success && info != null && info.versionCode > BuildConfig.VERSION_CODE)
                val file = File(appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "plum-update-${info.versionCode}-${System.currentTimeMillis()}.apk")
                val request = DownloadManager.Request(Uri.parse(info.downloadUrl))
                    .setTitle(appContext.getString(R.string.update_download_title))
                    .setDescription(appContext.getString(R.string.update_downloading))
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationUri(Uri.fromFile(file))
                val id = dm.enqueue(request)
                prefs.edit().putLong("id", id).putString("path", file.absolutePath).putInt("version", info.versionCode).commit()
                observeDownload(id, file, openInstaller = true)
            }.onFailure { _updateState.value = UpdateState.Error(appContext.getString(R.string.update_failed)) }
        }
    }

    private suspend fun observeDownload(id: Long, file: File, openInstaller: Boolean) {
        while (currentCoroutineContext().isActive) {
            val snapshot = dm.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
                if (!cursor.moveToFirst()) null else DownloadSnapshot(
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
                )
            }
            when (snapshot?.status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    @Suppress("DEPRECATION")
                    val archive = appContext.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
                    @Suppress("DEPRECATION")
                    val valid = file.length() > 0 && archive?.packageName == appContext.packageName && archive.versionCode == prefs.getInt("version", -1)
                    if (!valid) { failed(id, file, appContext.getString(R.string.update_missing)); return }
                    _updateState.value = UpdateState.ReadyToInstall
                    if (openInstaller) installApk(file)
                    return
                }
                DownloadManager.STATUS_FAILED, null -> {
                    failed(id, file, appContext.getString(R.string.update_download_failed, snapshot?.reason ?: -1))
                    return
                }
                else -> _updateState.value = UpdateState.Downloading(snapshot.progress)
            }
            delay(1_000)
        }
    }

    private fun failed(id: Long, file: File, message: String) {
        dm.remove(id)
        file.delete()
        prefs.edit().clear().apply()
        _updateState.value = UpdateState.Error(message)
    }

    fun installReadyUpdate() {
        val path = prefs.getString("path", null) ?: return
        installApk(File(path))
    }

    fun dismissUpdate() { if (downloadJob?.isActive != true) _updateState.value = UpdateState.Idle }

    private fun installApk(file: File) {
        if (!file.exists()) { _updateState.value = UpdateState.Error(appContext.getString(R.string.update_missing)); return }
        runCatching {
            val uri = FileProvider.getUriForFile(appContext, "${appContext.packageName}.provider", file)
            appContext.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            })
        }.onFailure { _updateState.value = UpdateState.Error(appContext.getString(R.string.update_installer_failed)) }
    }
}

internal data class DownloadSnapshot(val status: Int, val bytes: Long, val total: Long, val reason: Int) {
    val progress: Int get() = if (total <= 0) -1 else ((bytes.coerceAtLeast(0).toDouble() / total) * 100).toInt().coerceIn(0, 100)
}

sealed class UpdateState {
    object Idle : UpdateState()
    object Checking : UpdateState()
    object UpToDate : UpdateState()
    data class UpdateAvailable(val currentVersion: String, val newVersion: String, val downloadUrl: String, val releaseNotes: String? = null) : UpdateState()
    data class Downloading(val progress: Int) : UpdateState()
    object ReadyToInstall : UpdateState()
    data class Error(val message: String) : UpdateState()
}
