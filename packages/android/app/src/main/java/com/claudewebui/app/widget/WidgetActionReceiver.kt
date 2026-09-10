package com.claudewebui.app.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.claudewebui.app.core.network.BackgroundApi
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

const val ACTION_WIDGET_APPROVE = "com.claudewebui.app.widget.APPROVE"
const val ACTION_WIDGET_DENY = "com.claudewebui.app.widget.DENY"
const val ACTION_WIDGET_ANSWER = "com.claudewebui.app.widget.ANSWER"
const val ACTION_WIDGET_DISMISS_QUESTION = "com.claudewebui.app.widget.DISMISS_QUESTION"
const val EXTRA_WIDGET_SESSION_ID = "widget_session_id"
const val EXTRA_WIDGET_REQUEST_ID = "widget_request_id"
const val EXTRA_WIDGET_PROVIDER_SESSION_ID = "widget_provider_session_id"
const val EXTRA_WIDGET_ANSWER = "widget_answer"

/**
 * Answers a permission request or a question straight from the widget — the
 * same REST paths the notification actions use, no app launch required. The
 * row disappears with the refresh that follows.
 */
class WidgetActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(EXTRA_WIDGET_SESSION_ID) ?: return
        val requestId = intent.getStringExtra(EXTRA_WIDGET_REQUEST_ID) ?: return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // A broadcast may only stay alive ~10s; the client's own 30s
                // timeout would outlive it and get killed mid-flight.
                val delivered = withTimeoutOrNull(8_000) {
                    runCatching { deliver(intent, sessionId, requestId) }.getOrDefault(false)
                } ?: false

                // Only drop the row once the server has it. Evicting first made
                // a timed-out or rejected tap look answered, and the agent stayed
                // blocked on a request the user believed they had already allowed.
                if (delivered) {
                    WidgetStore.load(context)?.let { snapshot ->
                        WidgetStore.save(
                            context,
                            snapshot.copy(
                                approvals = snapshot.approvals.filterNot { it.requestId == requestId },
                                questions = snapshot.questions.filterNot { it.requestId == requestId },
                            ),
                        )
                    }
                }
                WidgetHub.pushAll(context)
                WidgetRefreshWorker.refreshNow(context)
            } finally {
                pending.finish()
            }
        }
    }

    /** Returns true only when the server accepted the answer. */
    private suspend fun deliver(intent: Intent, sessionId: String, requestId: String): Boolean {
        val api = BackgroundApi.client
        val providerSessionId = intent.getStringExtra(EXTRA_WIDGET_PROVIDER_SESSION_ID)
            ?.takeIf { it.isNotBlank() }
        return when (intent.action) {
            ACTION_WIDGET_APPROVE, ACTION_WIDGET_DENY -> {
                val action =
                    if (intent.action == ACTION_WIDGET_APPROVE) PermissionAction.ALLOW_ONCE
                    else PermissionAction.DENY
                api.respondToPermission(PermissionResponse(sessionId, requestId, action))
                true
            }

            ACTION_WIDGET_ANSWER -> {
                val answer = intent.getStringExtra(EXTRA_WIDGET_ANSWER) ?: return false
                // The payload is one list of chosen labels per question, and the
                // widget only ever offers a row for a single-question request.
                api.respondToQuestion(requestId, listOf(listOf(answer)), providerSessionId)
                true
            }

            ACTION_WIDGET_DISMISS_QUESTION -> {
                api.rejectQuestion(requestId, providerSessionId)
                true
            }

            else -> false
        }
    }
}
