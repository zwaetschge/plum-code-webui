package com.claudewebui.app.core.notifications

import com.claudewebui.app.R
import android.content.Context
import android.util.Log
import com.claudewebui.app.core.network.BackgroundApi
import com.claudewebui.app.widget.WidgetDataFetcher

/**
 * The safety net for everything the live socket cannot reach.
 *
 * Every other notification path in the app depends on a socket connection, and
 * so on the process being alive. Android ends that process routinely — Doze,
 * memory pressure, or simply nobody opening the app for a day — and from then
 * on a session can sit waiting for an approval, or die with an error, without
 * the phone ever saying so.
 *
 * This runs inside the existing 15-minute widget worker, which survives all of
 * that, pulls one gateway overview and posts only what changed since the last
 * pass. Diffed rather than posted wholesale: an approval pending for two hours
 * must not re-alert eight times.
 */
object AttentionSync {

    private const val TAG = "AttentionSync"
    private const val PREFS = "plum_attention_sync"
    private const val KEY_APPROVALS = "notified_approvals_v1"
    private const val KEY_ERRORS = "notified_errors_v1"

    /**
     * Cap on what is carried between runs, so neither id set can grow without
     * bound in prefs. Far above any plausible number of simultaneously pending
     * approvals — a real overflow means something upstream is wrong.
     */
    private const val MAX_REMEMBERED = 200

    /** Stored per approval, so a vanished one can be traced back to its session. */
    private fun key(sessionId: String, requestId: String) = "$sessionId|$requestId"

    private fun sessionOf(key: String) = key.substringBefore('|')

    suspend fun run(context: Context) {
        if (!WidgetDataFetcher.isSignedIn()) return

        val overview = runCatching { BackgroundApi.client.getGatewayOverview() }
            .onFailure { Log.w(TAG, "Overview fetch failed: ${it.message}") }
            .getOrNull()
            ?.data
            ?: return

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seenApprovals = prefs.getStringSet(KEY_APPROVALS, emptySet()).orEmpty()
        val seenErrors = prefs.getStringSet(KEY_ERRORS, emptySet()).orEmpty()

        val names = overview.sessions.associate { it.id to it.name }
        val approvals = overview.pendingApprovals
        val approvalKeys = approvals.map { key(it.sessionId, it.requestId) }.toSet()
        val errored = overview.sessions.filter { it.status == "error" }.map { it.id }.toSet()

        // With the app on screen the socket posts these in real time. Record the
        // state so a later background pass does not re-announce what the user
        // has already seen, but stay quiet now.
        val announce = !LocalNotificationManager.foreground.value &&
            NotificationPreferences.canPostNotifications(context)

        if (announce) {
            for (approval in approvals) {
                if (key(approval.sessionId, approval.requestId) in seenApprovals) continue
                NotificationService.notifyPermissionRequest(
                    context = context,
                    sessionId = approval.sessionId,
                    sessionName = names[approval.sessionId] ?: approval.sessionId,
                    toolName = approval.toolName,
                    requestId = approval.requestId,
                )
            }

            for (sessionId in errored - seenErrors) {
                NotificationService.notifyError(
                    context = context,
                    sessionId = sessionId,
                    sessionName = names[sessionId] ?: sessionId,
                    message = context.getString(R.string.native_session_failed),
                )
            }

            // Answered somewhere else — in the web client, or on another device.
            // Nothing else would ever clear these, and a stale approval prompt
            // is worse than none: tapping it opens a request the server has
            // already forgotten.
            val stillPending = approvals.map { it.sessionId }.toSet()
            (seenApprovals - approvalKeys)
                .map(::sessionOf)
                .distinct()
                .filter { it.isNotBlank() && it !in stillPending && it !in errored }
                .forEach { NotificationService.cancelSessionNotifications(context, it) }
        }

        prefs.edit()
            .putStringSet(KEY_APPROVALS, bounded(approvalKeys))
            .putStringSet(KEY_ERRORS, bounded(errored))
            .apply()
    }

    private fun bounded(ids: Set<String>): Set<String> =
        if (ids.size <= MAX_REMEMBERED) ids
        else ids.take(MAX_REMEMBERED).toSet().also {
            Log.w(TAG, "Attention state truncated at $MAX_REMEMBERED of ${ids.size} ids")
        }
}
