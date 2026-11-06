package com.claudewebui.wear

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Keeps tile and complications current while the app is closed: every 15
 * minutes (WorkManager's minimum) one short bridge connection fetches usage
 * and approvals, then closes again.
 */
class RefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext
        val paired = withContext(Dispatchers.IO) { PairingStore.syncFromDataLayer(app) }
        if (!paired) {
            // Unpaired on the phone meanwhile: nothing left to refresh until it pairs again.
            BridgeCache.clear(app)
            GlanceUpdates.request(app)
            cancel(app)
            return Result.success()
        }
        PlumBridge.refreshOnce(app)
        GlanceUpdates.request(app)
        // Periodic work: a failed round simply waits for the next one.
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "plum-refresh"
        private const val NOW = "plum-refresh-now"

        private val network = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(network)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun refreshNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setConstraints(network)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            val work = WorkManager.getInstance(context.applicationContext)
            work.cancelUniqueWork(PERIODIC)
            work.cancelUniqueWork(NOW)
        }
    }
}

/** Asks the system to re-render the tile and both complications from the caches. */
object GlanceUpdates {
    fun request(context: Context) {
        val app = context.applicationContext
        runCatching { TileService.getUpdater(app).requestUpdate(PlumTileService::class.java) }
        listOf(UsageComplicationService::class.java, ApprovalsComplicationService::class.java)
            .forEach { service ->
                runCatching {
                    ComplicationDataSourceUpdateRequester
                        .create(app, ComponentName(app, service))
                        .requestUpdateAll()
                }
            }
    }
}
