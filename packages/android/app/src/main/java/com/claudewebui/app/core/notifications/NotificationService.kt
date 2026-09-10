package com.claudewebui.app.core.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.claudewebui.app.MainActivity
import com.claudewebui.app.R

/**
 * Local notification helper for Plum Code WebUI.
 *
 * Notification channels:
 * - SESSION_UPDATES_CHANNEL: Session completed / status changes
 * - PERMISSION_REQUESTS_CHANNEL: Permission approval prompts (high priority)
 * - ERRORS_CHANNEL: Error and warning notifications
 *
 * Notifications are grouped per session using [sessionId] as the group key.
 * Tap targets deep-link directly into the relevant session via [MainActivity].
 */
object NotificationService {

    // ── Channel IDs ───────────────────────────────────────────────────────
    const val SESSION_UPDATES_CHANNEL = "session_updates"
    const val PERMISSION_REQUESTS_CHANNEL = "permission_requests"
    const val ERRORS_CHANNEL = "errors"
    const val USAGE_ALERTS_CHANNEL = "usage_alerts"

    // ── Notification ID ranges ────────────────────────────────────────────
    // Ranges avoid collisions between categories while keeping grouping intact.
    private const val ID_SESSION_BASE = 1000
    private const val ID_PERMISSION_BASE = 2000
    private const val ID_ERROR_BASE = 3000
    private const val ID_QUESTION_BASE = 5000
    private const val ID_USAGE_ALERT = 6000

    // ── Action identifiers ────────────────────────────────────────────────
    const val ACTION_OPEN = "com.claudewebui.app.action.OPEN"
    const val ACTION_APPROVE_PERMISSION = "com.claudewebui.app.action.APPROVE_PERMISSION"
    const val ACTION_DENY_PERMISSION = "com.claudewebui.app.action.DENY_PERMISSION"
    const val ACTION_ANSWER_QUESTION = "com.claudewebui.app.action.ANSWER_QUESTION"
    const val ACTION_DISMISS = "com.claudewebui.app.action.DISMISS"

    // ── Intent extras ─────────────────────────────────────────────────────
    const val EXTRA_SESSION_ID = "session_id"
    const val EXTRA_REQUEST_ID = "request_id"
    const val EXTRA_NOTIFICATION_ID = "notification_id"
    const val EXTRA_PROVIDER_SESSION_ID = "provider_session_id"
    const val EXTRA_ANSWER = "answer"

    /** RemoteInput result key for free-text question replies. */
    const val KEY_TEXT_REPLY = "question_reply"

    // ── Channels setup ────────────────────────────────────────────────────

    /**
     * Create all notification channels. Safe to call multiple times; the OS
     * is idempotent for existing channels.
     * Must be called before posting any notification (typically in Application.onCreate).
     */
    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        nm.createNotificationChannels(
            listOf(
                NotificationChannel(
                    SESSION_UPDATES_CHANNEL,
                    context.getString(R.string.native_channel_sessions),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = context.getString(R.string.native_channel_sessions_description)
                    setShowBadge(true)
                    enableLights(true)
                    lightColor = 0xFFCC785C.toInt() // AntiqueBrass brand color
                },
                NotificationChannel(
                    PERMISSION_REQUESTS_CHANNEL,
                    context.getString(R.string.native_channel_permissions),
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = context.getString(R.string.native_channel_permissions_description)
                    setShowBadge(true)
                    enableLights(true)
                    lightColor = 0xFFF59E0B.toInt() // WarningAmber
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 250, 100, 250)
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
                NotificationChannel(
                    ERRORS_CHANNEL,
                    context.getString(R.string.native_channel_errors),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = context.getString(R.string.native_channel_errors_description)
                    setShowBadge(false)
                    enableLights(true)
                    lightColor = 0xFFEF4444.toInt() // ErrorRed
                },
                NotificationChannel(
                    USAGE_ALERTS_CHANNEL,
                    context.getString(R.string.native_channel_usage),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = context.getString(R.string.native_channel_usage_description)
                    setShowBadge(false)
                }
            )
        )
    }

    // ── Public factory methods (usable from LocalNotificationManager) ──────

    /**
     * Post a "session completed" notification.
     *
     * @param context         Application context.
     * @param sessionId       ID of the completed session.
     * @param sessionName     Human-readable session title.
     * @param summary         Optional short summary of what Claude produced.
     */
    fun notifySessionCompleted(
        context: Context,
        sessionId: String,
        sessionName: String,
        summary: String? = null,
        title: String = context.getString(R.string.native_session_completed)
    ) {
        if (!NotificationPreferences.canPostNotifications(context)) return
        val notificationId = sessionIdToNotificationId(sessionId, ID_SESSION_BASE)
        val notification = buildSessionCompletedNotification(
            context, sessionId, sessionName, summary, notificationId, title
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Post a permission request notification with Approve / Dismiss actions.
     */
    fun notifyPermissionRequest(
        context: Context,
        sessionId: String,
        sessionName: String,
        toolName: String,
        requestId: String
    ) {
        if (!NotificationPreferences.canPostNotifications(context)) return
        val notificationId = sessionIdToNotificationId(sessionId, ID_PERMISSION_BASE)
        val notification = buildPermissionNotification(
            context, sessionId, sessionName, toolName, requestId, notificationId
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Post an error or warning notification.
     */
    fun notifyError(
        context: Context,
        sessionId: String,
        sessionName: String,
        message: String,
        isWarning: Boolean = false
    ) {
        if (!NotificationPreferences.canPostNotifications(context)) return
        val notificationId = sessionIdToNotificationId(sessionId, ID_ERROR_BASE)
        val notification = buildErrorNotification(
            context, sessionId, sessionName, message, isWarning, notificationId
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Post an agent question with the answer options as inline actions (max 3)
     * plus a free-text reply. Bridged to Wear so questions can be answered from
     * the watch like permission requests.
     */
    fun notifyQuestion(
        context: Context,
        sessionId: String,
        sessionName: String,
        questionText: String,
        options: List<String>,
        allowCustom: Boolean,
        requestId: String,
        providerSessionId: String?,
    ) {
        if (!NotificationPreferences.canPostNotifications(context)) return
        val notificationId = sessionIdToNotificationId(sessionId, ID_QUESTION_BASE)
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)

        fun answerIntent(answer: String?, requestCode: Int): PendingIntent =
            PendingIntent.getBroadcast(
                context,
                notificationId + requestCode,
                Intent(context, NotificationActionReceiver::class.java).apply {
                    action = ACTION_ANSWER_QUESTION
                    putExtra(EXTRA_SESSION_ID, sessionId)
                    putExtra(EXTRA_REQUEST_ID, requestId)
                    putExtra(EXTRA_PROVIDER_SESSION_ID, providerSessionId)
                    putExtra(EXTRA_NOTIFICATION_ID, notificationId)
                    answer?.let { putExtra(EXTRA_ANSWER, it) }
                },
                // Mutable so RemoteInput can attach the typed reply.
                PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (answer == null) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE),
            )

        val optionActions = options.take(3).mapIndexed { i, option ->
            NotificationCompat.Action(0, option.take(24), answerIntent(option, 400 + i))
        }
        val replyAction = if (allowCustom || options.isEmpty()) {
            NotificationCompat.Action.Builder(0, context.getString(R.string.native_reply), answerIntent(null, 450))
                .addRemoteInput(
                    androidx.core.app.RemoteInput.Builder(KEY_TEXT_REPLY)
                        .setLabel(context.getString(R.string.native_answer))
                        .build()
                )
                .build()
        } else null

        val builder = NotificationCompat.Builder(context, PERMISSION_REQUESTS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.native_agent_question, sessionName))
            .setContentText(questionText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(questionText))
            .setContentIntent(tapIntent)
            .setAutoCancel(false)
            .setOngoing(true)
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
        optionActions.forEach { builder.addAction(it) }
        replyAction?.let { builder.addAction(it) }
        val wearable = NotificationCompat.WearableExtender()
        optionActions.forEach { wearable.addAction(it) }
        replyAction?.let { wearable.addAction(it) }
        builder.extend(wearable)

        NotificationManagerCompat.from(context).notify(sessionId, notificationId, builder.build())
    }

    /** Quota / budget threshold notification (deduped by the caller). */
    fun notifyUsageAlert(context: Context, tag: String, title: String, message: String) {
        if (!NotificationPreferences.canPostNotifications(context)) return
        val tapIntent = PendingIntent.getActivity(
            context,
            ID_USAGE_ALERT,
            Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = android.net.Uri.parse("claudewebui://analytics?range=24h")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, USAGE_ALERTS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(tapIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .extend(NotificationCompat.WearableExtender())
            .build()
        NotificationManagerCompat.from(context).notify(tag, ID_USAGE_ALERT, notification)
    }

    /**
     * Cancel all notifications for a given session group.
     */
    fun cancelSessionNotifications(context: Context, sessionId: String) {
        val nm = NotificationManagerCompat.from(context)
        listOf(ID_SESSION_BASE, ID_PERMISSION_BASE, ID_ERROR_BASE, ID_QUESTION_BASE).forEach { base ->
            nm.cancel(sessionId, sessionIdToNotificationId(sessionId, base))
        }
    }

    // ── Private builders ──────────────────────────────────────────────────

    private fun buildSessionCompletedNotification(
        context: Context,
        sessionId: String,
        sessionName: String,
        summary: String?,
        notificationId: Int,
        title: String
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)
        val openAction = NotificationCompat.Action(
            0, context.getString(R.string.native_open), tapIntent
        )
        return NotificationCompat.Builder(context, SESSION_UPDATES_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(sessionName)
            .apply { summary?.let { setStyle(NotificationCompat.BigTextStyle().bigText(it)) } }
            .setContentIntent(tapIntent)
            .addAction(openAction)
            // Ensure "agent is done" also reads well on a paired watch.
            .extend(NotificationCompat.WearableExtender())
            .setAutoCancel(true)
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    private fun buildPermissionNotification(
        context: Context,
        sessionId: String,
        sessionName: String,
        toolName: String,
        requestId: String,
        notificationId: Int
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)

        val approveIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 100,
            Intent(context, NotificationActionReceiver::class.java).apply {
                action = ACTION_APPROVE_PERMISSION
                putExtra(EXTRA_SESSION_ID, sessionId)
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val denyIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 300,
            Intent(context, NotificationActionReceiver::class.java).apply {
                action = ACTION_DENY_PERMISSION
                putExtra(EXTRA_SESSION_ID, sessionId)
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dismissIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 200,
            Intent(context, NotificationActionReceiver::class.java).apply {
                action = ACTION_DISMISS
                putExtra(EXTRA_SESSION_ID, sessionId)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val approveAction = NotificationCompat.Action(0, context.getString(R.string.native_approve), approveIntent)
        val denyAction = NotificationCompat.Action(0, context.getString(R.string.native_deny), denyIntent)

        return NotificationCompat.Builder(context, PERMISSION_REQUESTS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.native_permission_session, sessionName))
            .setContentText(context.getString(R.string.native_agent_tool, toolName))
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(context.getString(R.string.native_permission_body, toolName))
            )
            .setContentIntent(tapIntent)
            .addAction(approveAction)
            .addAction(denyAction)
            .addAction(NotificationCompat.Action(0, context.getString(R.string.native_dismiss), dismissIntent))
            // Bridged to a paired Wear OS watch: the extender puts Approve/Deny
            // front and center so the request can be answered from the wrist.
            // The PendingIntents execute on the phone, which holds the session.
            .extend(
                NotificationCompat.WearableExtender()
                    .addAction(approveAction)
                    .addAction(denyAction)
            )
            .setAutoCancel(false)
            .setOngoing(true) // stays until user acts
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
    }

    private fun buildErrorNotification(
        context: Context,
        sessionId: String,
        sessionName: String,
        message: String,
        isWarning: Boolean,
        notificationId: Int
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)
        val title = if (isWarning) context.getString(R.string.native_warning_session, sessionName) else context.getString(R.string.native_error_session, sessionName)
        return NotificationCompat.Builder(context, ERRORS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(tapIntent)
            .addAction(NotificationCompat.Action(0, context.getString(R.string.native_open), tapIntent))
            .setAutoCancel(true)
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Stable integer ID derived from sessionId + base bucket. */
    private fun sessionIdToNotificationId(id: String, base: Int): Int =
        base + (id.hashCode() and 0x0FFF)

    /** PendingIntent that deep-links into a specific session. */
    private fun deepLinkPendingIntent(
        context: Context,
        sessionId: String,
        notificationId: Int
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = android.net.Uri.parse("claudewebui://session/$sessionId")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        return PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
