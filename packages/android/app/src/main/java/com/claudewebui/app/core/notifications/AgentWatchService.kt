package com.claudewebui.app.core.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.claudewebui.app.MainActivity
import com.claudewebui.app.R
import com.claudewebui.app.widget.WidgetRefreshWorker

/**
 * Foreground service that keeps the process — and with it the socket — alive
 * while agent turns run. Without it, Doze drops the connection minutes after
 * the screen turns off and completion notifications silently never arrive.
 *
 * Started when a turn begins — our own send, or one observed on any monitored
 * session — and stopped when the last watched session finishes or the watchdog
 * timeout hits. A turn seen while the app sits in the background may be refused
 * a foreground start by the OS; that is expected and best-effort, so every
 * start path swallows the refusal instead of crashing the process that is
 * carrying the socket.
 */
class AgentWatchService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!NotificationPreferences.canPostNotifications(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val count = intent?.getIntExtra(EXTRA_ACTIVE_COUNT, 1) ?: 1
        val detail = intent?.getStringExtra(EXTRA_DETAIL)
        // Android 12+ rejects a foreground start requested from the background.
        // Since turns observed on other sessions can arrive at any time, that
        // refusal is a normal outcome and must not take the app down with it.
        val promoted = runCatching {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(this, count, detail),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                } else {
                    0
                },
            )
        }.isSuccess
        running = promoted
        if (!promoted) {
            // No keep-alive means the socket can be dropped in Doze, so hand
            // the turn to the periodic worker exactly as the timeout path does.
            runCatching { WidgetRefreshWorker.ensurePeriodic(applicationContext) }
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15 caps dataSync foreground time per day. Let go gracefully —
        // the next turn start brings the service right back.
        //
        // Hand over rather than just disappearing: once the socket loses its
        // keep-alive the running turn can finish unheard, so the periodic
        // worker takes over and picks the result up through AttentionSync.
        runCatching {
            WidgetRefreshWorker.ensurePeriodic(applicationContext)
            WidgetRefreshWorker.refreshNow(applicationContext)
        }
        stopSelf()
    }

    companion object {
        const val CHANNEL_ID = "agent_watch"
        private const val NOTIFICATION_ID = 4000
        private const val EXTRA_ACTIVE_COUNT = "active_count"
        private const val EXTRA_DETAIL = "detail"

        @Volatile
        private var running = false

        /** Start or update the keep-alive notification for [activeCount] turns. */
        fun start(context: Context, activeCount: Int) {
            if (!NotificationPreferences.canPostNotifications(context)) {
                stop(context)
                return
            }
            val intent = Intent(context, AgentWatchService::class.java)
                .putExtra(EXTRA_ACTIVE_COUNT, activeCount)
            // Keep-alive is best effort: if the OS refuses the (re)start in an
            // exotic state, the in-process notification flows still work.
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }

        /**
         * Refresh the live "what is running" line without restarting the
         * service — a plain notify() on the existing foreground notification.
         */
        fun updateDetail(context: Context, activeCount: Int, detail: String?) {
            if (!running || !NotificationPreferences.canPostNotifications(context)) return
            runCatching {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NOTIFICATION_ID, buildNotification(context, activeCount, detail))
            }
        }

        fun stop(context: Context) {
            running = false
            runCatching { context.stopService(Intent(context, AgentWatchService::class.java)) }
        }

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.native_channel_active),
                    NotificationManager.IMPORTANCE_MIN,
                ).apply {
                    description = context.getString(R.string.native_channel_active_description)
                    setShowBadge(false)
                },
            )
        }

        private fun buildNotification(
            context: Context,
            activeCount: Int,
            detail: String? = null,
        ): Notification {
            val tap = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val text = when {
                detail != null && activeCount == 1 -> context.getString(R.string.native_working_detail, detail.take(80))
                detail != null -> context.getString(R.string.native_agents_latest, activeCount, detail.take(70))
                activeCount == 1 ->
                    context.getString(R.string.native_agent_working)
                else ->
                    context.getString(R.string.native_agents_working, activeCount)
            }
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Plum Code")
                .setContentText(text)
                .setContentIntent(tap)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build()
        }
    }
}
