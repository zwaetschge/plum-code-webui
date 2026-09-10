package com.claudewebui.app.core.notifications

import com.claudewebui.app.R
import android.app.Activity
import android.content.Context
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.core.tiles.QuickTileService
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.widget.WidgetRefreshWorker
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

/**
 * Manages local notifications without requiring Firebase or WorkManager.
 *
 * Responsibilities:
 * 1. Monitor [SocketManager] flows and post notifications when the app is in background.
 * 2. Handle Android 13+ POST_NOTIFICATIONS permission requests.
 * 3. Serve as the in-process dispatcher for inline notification actions (approve permission).
 */
object LocalNotificationManager {

    // Injected on app init; held weakly to avoid Context leak
    private var appContext: Context? = null
    private var socketManager: SocketManager? = null
    private var sessionRepository: SessionRepository? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Tracks whether the hosting Activity is currently in the foreground.
    private val _foreground = MutableStateFlow(false)

    /**
     * Whether any activity is started. Exposed because the chat's presence
     * heartbeat has to stop while the app is backgrounded, and this class is
     * already the one thing wired to the process lifecycle.
     */
    val foreground: StateFlow<Boolean> = _foreground.asStateFlow()

    private val appInForeground: Boolean get() = _foreground.value

    // Sessions with a turn in flight — drives the foreground keep-alive
    // service so the socket survives Doze until the reply lands.
    private val activeTurns = ConcurrentHashMap<String, Long>()
    private const val TURN_WATCH_TIMEOUT_MS = 60 * 60 * 1000L

    // Latest tool/subagent per working session, shown in the keep-alive
    // notification so the lockscreen/watch tells you what the agent is doing.
    private val activeDetail = ConcurrentHashMap<String, String>()
    @Volatile private var lastDetailPushMs = 0L
    @Volatile private var lastWidgetRefreshMs = 0L

    /** Widgets and the Wear companion update straight from socket events. */
    private fun refreshWidgets() {
        val ctx = appContext ?: return
        // One WorkManager enqueue per socket event churned the unique-work
        // queue during streaming; widgets don't need sub-3s freshness.
        val now = System.currentTimeMillis()
        if (now - lastWidgetRefreshMs < 3_000) return
        lastWidgetRefreshMs = now
        WidgetRefreshWorker.refreshNow(ctx)
    }

    // ── Initialisation ─────────────────────────────────────────────────────────

    /**
     * Initialize and start observing socket events.
     * Call once from [Application.onCreate] after [SocketManager] is created.
     */
    fun init(context: Context, socket: SocketManager, sessionRepository: SessionRepository) {
        appContext = context.applicationContext
        socketManager = socket
        this.sessionRepository = sessionRepository
        NotificationService.createChannels(context.applicationContext)
        observeSocketEvents(socket)
        observeMonitoredSessions(socket, sessionRepository)
    }

    /**
     * Keep the socket subscribed to every session worth watching.
     *
     * Until now exactly one session was subscribed — whichever chat was open —
     * so an approval prompt, a question or an error in any other session
     * reached the phone only if the user happened to be looking at it. Every
     * notification path downstream of the socket was effectively single-session.
     *
     * Lives here rather than in the dashboard's ViewModel because monitoring
     * must not stop when the user navigates into a chat or rotates the device.
     * Reconnects are already covered: [SocketManager] replays its subscriptions
     * on connect.
     */
    private fun observeMonitoredSessions(socket: SocketManager, repository: SessionRepository) {
        repository.sessions
            .onEach { sessions ->
                val ids = sessions
                    // Most recent activity first, so a full list loses the
                    // sessions nobody has touched rather than the live ones.
                    .sortedByDescending { it.lastActivityAt ?: it.updatedAt }
                    .take(SocketManager.MONITORED_SESSION_LIMIT)
                    .map { it.id }
                socket.syncMonitoredSessions(ids, openSessionId = openSessionId)

                // The Quick Settings tile had a working update path that
                // nothing ever called, so it showed "No sessions" forever.
                // This is the one place that already sees every session-list
                // change, live socket updates included.
                appContext?.let { ctx ->
                    QuickTileService.requestUpdate(ctx, sessions.count { it.busy || it.status == SessionStatus.RUNNING })
                }
            }
            .launchIn(scope)
    }

    /**
     * The chat the user currently has open, if any.
     *
     * Only used to keep its subscription alive when it drops out of the
     * monitored window — a long conversation the user is actively reading must
     * not go quiet because thirty other sessions were busier.
     */
    @Volatile
    private var openSessionId: String? = null

    /** Called by the chat screen so its session is never unsubscribed underneath it. */
    fun setOpenSession(sessionId: String?) {
        openSessionId = sessionId
    }

    /**
     * Notify the manager that the app entered the foreground.
     * While in foreground we suppress background-only notifications.
     */
    fun onAppForegrounded() {
        _foreground.value = true
    }

    /**
     * Notify the manager that the app went to the background.
     */
    fun onAppBackgrounded() {
        _foreground.value = false
    }

    /** Clean up coroutine scope (call from Application.onTerminate if needed). */
    fun destroy() {
        scope.cancel()
        appContext = null
        socketManager = null
        sessionRepository = null
    }

    // ── Socket event observation ───────────────────────────────────────────────

    private fun observeSocketEvents(socket: SocketManager) {
        // Turn lifecycle: keep the process (and socket) alive while an agent
        // works, otherwise Doze kills the connection and no completion
        // notification ever arrives.
        socket.turnStarted
            .onEach { sessionId ->
                onTurnStarted(sessionId)
                cacheBusy(sessionId, busy = true)
                // The widgets showed a session as idle until the turn ended,
                // which is the half of the turn a supervisor cares least about.
                refreshWidgets()
            }
            .launchIn(scope)

        // Stale-turn watchdog — an interrupted/vanished turn must not pin the
        // foreground service forever.
        scope.launch {
            while (true) {
                delay(5 * 60 * 1000L)
                val cutoff = System.currentTimeMillis() - TURN_WATCH_TIMEOUT_MS
                val stale = activeTurns.filterValues { it < cutoff }.keys.toList()
                stale.forEach { onTurnFinished(it) }
            }
        }

        // Live "what is the agent doing" detail for the keep-alive notification.
        socket.toolUse
            .onEach { event ->
                if (event.status == ToolStatus.STARTED) {
                    val detail = event.actionSummary ?: event.toolName
                    activeDetail[event.sessionId] = detail
                    // Cheap when the turn is already watched, and the honest
                    // signal when no status event announced it.
                    onTurnStarted(event.sessionId)
                    pushWatchDetail()
                    cacheActivity(event.sessionId, detail)
                    // Debounced to 3s inside; streaming tools would otherwise
                    // enqueue a refresh per event.
                    refreshWidgets()
                }
            }
            .launchIn(scope)
        socket.agent
            .onEach { event ->
                if (event.status == ToolStatus.STARTED) {
                    val detail = appContext?.getString(R.string.native_agent_detail, event.agentType) ?: event.agentType
                    activeDetail[event.sessionId] = detail
                    onTurnStarted(event.sessionId)
                    pushWatchDetail()
                    cacheActivity(event.sessionId, detail)
                }
            }
            .launchIn(scope)

        // Queue depth, so the "3 queued" badge is right on every screen and not
        // just inside the chat that happens to be open.
        socket.queue
            .onEach { event ->
                if (event.busy) onTurnStarted(event.sessionId)
                sessionRepository?.cacheQueue(event.sessionId, event.depth, event.busy)
                refreshWidgets()
            }
            .launchIn(scope)

        // Completed assistant replies: end-of-turn signal plus the actual
        // "reply is ready" notification, with goal completions called out.
        socket.messages
            .onEach { message ->
                if (message.role != MessageRole.ASSISTANT) return@onEach
                onTurnFinished(message.sessionId)
                cacheIdle(message.sessionId)
                refreshWidgets()
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                if (!NotificationPreferences.canPostNotifications(ctx)) return@onEach
                val content = message.content.trim()
                if (content.isEmpty()) return@onEach
                val name = sessionName(message.sessionId)
                val isGoal = content.startsWith("Goal complete", ignoreCase = true)
                NotificationService.notifySessionCompleted(
                    ctx,
                    message.sessionId,
                    name,
                    summary = content.take(300),
                    title = if (isGoal) ctx.getString(R.string.native_goal_complete, name) else ctx.getString(R.string.native_reply_ready, name),
                )
            }
            .launchIn(scope)

        // Session status changes
        socket.status
            .onEach { (sessionId, status) ->
                if (status == SessionStatus.STOPPED || status == SessionStatus.ERROR) {
                    onTurnFinished(sessionId)
                    cacheIdle(sessionId)
                } else if (status == SessionStatus.RUNNING) {
                    // A turn started somewhere else — the web client, the
                    // gateway, another device. The keep-alive used to hang off
                    // our own send alone, so a run kicked off from the desktop
                    // lost its socket to Doze and finished unannounced.
                    onTurnStarted(sessionId)
                    cacheBusy(sessionId, busy = true)
                }
                sessionRepository?.cacheStatus(sessionId, status)
                refreshWidgets()
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                if (!NotificationPreferences.canPostNotifications(ctx)) return@onEach
                if (shouldPostGenericStatusNotification(status)) {
                    NotificationService.notifyError(
                        ctx, sessionId, sessionName(sessionId),
                        ctx.getString(R.string.native_session_error)
                    )
                }
            }
            .launchIn(scope)

        // Agent questions (OpenCode prompts) block the turn until answered —
        // surface them with the options as inline/watch actions. Multi-question
        // prompts need the full UI, so those fall back to an open-the-app nudge.
        socket.question
            .onEach { event ->
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                if (!NotificationPreferences.canPostNotifications(ctx)) return@onEach
                val question = event.questions.firstOrNull()
                if (event.questions.size == 1 && question != null) {
                    NotificationService.notifyQuestion(
                        ctx,
                        sessionId = event.sessionId,
                        sessionName = sessionName(event.sessionId),
                        questionText = question.question.ifBlank { ctx.getString(R.string.native_question_asked) },
                        options = question.options.map { it.label }.filter { it.isNotBlank() },
                        allowCustom = question.custom,
                        requestId = event.requestId,
                        providerSessionId = event.providerSessionId,
                    )
                } else {
                    NotificationService.notifyError(
                        ctx, event.sessionId, sessionName(event.sessionId),
                        ctx.getString(R.string.native_questions_asked, event.questions.size),
                        isWarning = true,
                    )
                }
            }
            .launchIn(scope)

        // Permission requests
        socket.permission
            .onEach { permissionJson ->
                refreshWidgets()
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                if (!NotificationPreferences.canPostNotifications(ctx)) return@onEach
                val obj = permissionJson.toString()
                // Parse minimal fields from the permission JSON element
                try {
                    val jsonObj = org.json.JSONObject(obj)
                    val sessionId = jsonObj.optString("sessionId", "")
                    val requestId = jsonObj.optString("requestId", "")
                    val toolName = jsonObj
                        .optJSONArray("toolNames")
                        ?.optString(0) ?: jsonObj.optString("toolName", ctx.getString(R.string.native_unknown_tool))
                    // The id was shown as the title back when only the open
                    // chat was subscribed and the name was on screen anyway.
                    // Now that approvals arrive from any session, a uuid tells
                    // the user nothing about which one is blocked.
                    if (sessionId.isNotBlank() && requestId.isNotBlank()) {
                        NotificationService.notifyPermissionRequest(
                            ctx, sessionId, sessionName(sessionId), toolName, requestId
                        )
                    } else if (sessionId.isNotBlank() && jsonObj.has("denials")) {
                        // Legacy payload — no inline approve, but the user must
                        // still learn the session is blocked.
                        NotificationService.notifyError(
                            ctx, sessionId, sessionName(sessionId),
                            ctx.getString(R.string.native_permission_tool, toolName),
                            isWarning = true,
                        )
                    }
                } catch (_: Exception) {}
            }
            .launchIn(scope)

        // Session errors
        socket.errors
            .onEach { (sessionId, errorMsg) ->
                onTurnFinished(sessionId)
                cacheIdle(sessionId)
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                if (!NotificationPreferences.canPostNotifications(ctx)) return@onEach
                NotificationService.notifyError(ctx, sessionId, sessionName(sessionId), errorMsg)
            }
            .launchIn(scope)

    }

    // ── Room cache writes ──────────────────────────────────────────────────────

    // This class is the only socket collector that lives for the whole process,
    // so it is also the only place that can keep the cache honest for sessions
    // the user is not looking at. Before this, every screen except the open chat
    // showed whatever the last REST refresh happened to say.

    private suspend fun cacheBusy(sessionId: String, busy: Boolean) {
        sessionRepository?.cacheBusy(sessionId, busy)
    }

    /** What the agent is doing right now. */
    private suspend fun cacheActivity(sessionId: String, detail: String) {
        sessionRepository?.cacheActivity(sessionId, detail)
    }

    /** Turn over: not busy, and nothing in progress to describe. */
    private suspend fun cacheIdle(sessionId: String) {
        sessionRepository?.cacheIdle(sessionId)
    }

    // ── Turn watch (foreground keep-alive) ─────────────────────────────────────

    /**
     * Mark a turn as in flight and make sure the keep-alive is running.
     *
     * Called from tool, agent and queue events as well as from our own send,
     * so it fires many times per turn. Only the first call per session touches
     * the service: the notification count only changes when a session joins,
     * and [pushWatchDetail] owns the live text.
     */
    private fun onTurnStarted(sessionId: String) {
        val ctx = appContext ?: return
        val alreadyWatched = activeTurns.put(sessionId, System.currentTimeMillis()) != null
        if (!NotificationPreferences.canPostNotifications(ctx)) {
            AgentWatchService.stop(ctx)
            return
        }
        if (alreadyWatched) return
        AgentWatchService.start(ctx, activeTurns.size)
    }

    private fun onTurnFinished(sessionId: String) {
        val ctx = appContext ?: return
        activeDetail.remove(sessionId)
        if (activeTurns.remove(sessionId) == null) return
        if (activeTurns.isEmpty() || !NotificationPreferences.canPostNotifications(ctx)) {
            AgentWatchService.stop(ctx)
        } else {
            AgentWatchService.start(ctx, activeTurns.size)
        }
    }

    /**
     * Update the keep-alive notification with the latest tool/agent detail.
     * Tool events stream fast, so pushes are throttled to one per 3 seconds.
     */
    private fun pushWatchDetail() {
        val ctx = appContext ?: return
        if (activeTurns.isEmpty()) return
        val now = System.currentTimeMillis()
        if (now - lastDetailPushMs < 3_000) return
        lastDetailPushMs = now
        val detail = activeDetail.values.lastOrNull()
        AgentWatchService.updateDetail(ctx, activeTurns.size, detail)
    }

    /** Human-readable session title from the Room cache; id-agnostic fallback. */
    private suspend fun sessionName(sessionId: String): String =
        runCatching { sessionRepository?.observeSession(sessionId)?.firstOrNull()?.name }
            .getOrNull() ?: appContext?.getString(R.string.native_session) ?: sessionId

    // ── Permission request handling ────────────────────────────────────────────

    /**
     * Check whether POST_NOTIFICATIONS permission is granted (Android 13+).
     * On older versions this always returns true.
     */
    fun hasNotificationPermission(context: Context): Boolean {
        return NotificationPreferences.hasRuntimePermission(context)
    }

    /** Apply a preference or permission change immediately to the watch service. */
    fun onNotificationsPreferenceChanged() {
        val ctx = appContext ?: return
        if (activeTurns.isNotEmpty() && NotificationPreferences.canPostNotifications(ctx)) {
            AgentWatchService.start(ctx, activeTurns.size)
        } else {
            AgentWatchService.stop(ctx)
        }
    }

    /**
     * Request POST_NOTIFICATIONS permission using a pre-registered launcher.
     * Obtain the launcher via:
     * ```kotlin
     * val launcher = rememberLauncherForActivityResult(
     *     ActivityResultContracts.RequestPermission()
     * ) { granted -> … }
     * ```
     */
    fun requestNotificationPermission(
        launcher: ActivityResultLauncher<String>
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /**
     * Show permission rationale dialog if needed (call from an Activity context).
     */
    fun shouldShowRationale(activity: Activity): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        return activity.shouldShowRequestPermissionRationale(
            android.Manifest.permission.POST_NOTIFICATIONS
        )
    }

    // ── Inline notification action dispatch ───────────────────────────────────

    /**
     * Called by [NotificationActionReceiver] when the user taps "Approve" on a
     * permission notification. Goes over REST — the socket event this used to
     * emit has no server-side handler, so approvals silently vanished.
     */
    fun approvePermissionFromNotification(
        context: Context,
        sessionId: String,
        requestId: String
    ) {
        sessionRepository?.let { repository ->
            scope.launch {
                repository.respondToPermission(sessionId, requestId, PermissionAction.ALLOW_ONCE)
            }
        }
        // Cancel the ongoing permission notification
        NotificationService.cancelSessionNotifications(context, sessionId)
    }

    /** "Deny" from the notification (phone or bridged Wear OS action). */
    fun denyPermissionFromNotification(
        context: Context,
        sessionId: String,
        requestId: String
    ) {
        sessionRepository?.let { repository ->
            scope.launch {
                repository.respondToPermission(sessionId, requestId, PermissionAction.DENY)
            }
        }
        NotificationService.cancelSessionNotifications(context, sessionId)
    }

    /** Inline/watch answer to an OpenCode question prompt. */
    fun answerQuestionFromNotification(
        context: Context,
        sessionId: String,
        requestId: String,
        providerSessionId: String?,
        answer: String,
    ) {
        sessionRepository?.let { repository ->
            scope.launch {
                repository.respondToQuestion(requestId, listOf(listOf(answer)), providerSessionId)
            }
        }
        NotificationService.cancelSessionNotifications(context, sessionId)
    }
}
