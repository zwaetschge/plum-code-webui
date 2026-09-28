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
    private const val KEY_FEED_SEEN = "feed_seen_v1"
    private const val KEY_FEED_INITIALIZED = "feed_initialized_v1"

    /** How much of the feed one pass looks at; older rows were seen by an earlier pass. */
    private const val FEED_WINDOW = 40

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

        // The safety net uses the same system delivery in either lifecycle state.
        // Live events are deduplicated below, so reconnect gaps can still alert.
        val announce = NotificationPreferences.canPostNotifications(context)

        if (announce) {
            for (approval in approvals) {
                if (key(approval.sessionId, approval.requestId) in seenApprovals) continue
                if (LocalNotificationManager.wasRecentlyAnnounced(approval.sessionId, "approval:${approval.requestId}")) continue
                NotificationService.notifyPermissionRequest(
                    context = context,
                    sessionId = approval.sessionId,
                    sessionName = names[approval.sessionId] ?: approval.sessionId,
                    toolName = approval.toolName,
                    requestId = approval.requestId,
                )
            }

            for (sessionId in errored - seenErrors) {
                if (LocalNotificationManager.wasRecentlyAnnounced(sessionId, "error")) continue
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

        syncFeed(context, prefs, names, announce)
    }

    /**
     * Completed turns, from the server's durable feed.
     *
     * The overview says what is blocked right now; it says nothing about the
     * reply that landed twenty minutes ago while the socket was dead. The feed
     * does. Every row the live socket already announced was marked seen by
     * [markFeedSeen], so this only ever speaks for the turns the phone missed.
     */
    private suspend fun syncFeed(
        context: Context,
        prefs: android.content.SharedPreferences,
        names: Map<String, String>,
        announce: Boolean,
    ) {
        val feed = runCatching { BackgroundApi.client.getNotifications(FEED_WINDOW) }
            .onFailure { Log.w(TAG, "Feed fetch failed: ${it.message}") }
            .getOrNull()
            ?.data
            ?: return
        val seen = prefs.getStringSet(KEY_FEED_SEEN, emptySet()).orEmpty()
        val diff = diffFeed(feed.items, seen, prefs.getBoolean(KEY_FEED_INITIALIZED, false))

        if (announce) {
            for (item in diff.announce) {
                val sessionId = item.sessionId ?: continue
                if (LocalNotificationManager.wasRecentlyAnnounced(sessionId, item.kind)) continue
                val name = names[sessionId] ?: context.getString(R.string.native_session)
                when (item.kind) {
                    "reply", "goal" -> NotificationService.notifySessionCompleted(
                        context = context,
                        sessionId = sessionId,
                        sessionName = name,
                        summary = item.body?.take(300),
                        title = if (item.kind == "goal") context.getString(R.string.native_goal_complete, name)
                        else context.getString(R.string.native_reply_ready, name),
                    )
                    "question" -> NotificationService.notifyError(
                        context = context,
                        sessionId = sessionId,
                        sessionName = name,
                        message = item.body ?: context.getString(R.string.native_question_asked),
                        isWarning = true,
                    )
                    "error" -> NotificationService.notifyError(
                        context = context,
                        sessionId = sessionId,
                        sessionName = name,
                        message = item.body ?: context.getString(R.string.native_session_failed),
                    )
                }
            }
        }

        prefs.edit()
            .putBoolean(KEY_FEED_INITIALIZED, true)
            .putStringSet(KEY_FEED_SEEN, bounded(diff.seen))
            .apply()
    }

    /**
     * The live socket delivered this feed row, so a later background pass
     * must not deliver it again. Cheap enough to call per event.
     */
    fun markFeedSeen(context: Context, id: String) {
        if (id.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seen = prefs.getStringSet(KEY_FEED_SEEN, emptySet()).orEmpty()
        if (id in seen) return
        prefs.edit()
            .putBoolean(KEY_FEED_INITIALIZED, true)
            .putStringSet(KEY_FEED_SEEN, bounded(seen + id))
            .apply()
    }

    private fun bounded(ids: Set<String>): Set<String> =
        if (ids.size <= MAX_REMEMBERED) ids
        // Sets are insertion-ordered here, so dropping from the front keeps
        // the most recently recorded ids — the ones the next pass may see again.
        else ids.toList().takeLast(MAX_REMEMBERED).toSet().also {
            Log.w(TAG, "Attention state truncated at $MAX_REMEMBERED of ${ids.size} ids")
        }
}
