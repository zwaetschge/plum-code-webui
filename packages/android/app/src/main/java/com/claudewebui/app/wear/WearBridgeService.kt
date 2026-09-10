package com.claudewebui.app.wear

import com.claudewebui.app.core.network.BackgroundApi
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionResponse
import com.claudewebui.app.widget.WidgetHub
import com.claudewebui.app.widget.WidgetRefreshWorker
import com.claudewebui.app.widget.WidgetStore
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Receives approval and question answers sent by the watch app over the Wear
 * data layer and forwards them to the backend — the watch never talks to the
 * server itself.
 */
class WearBridgeService : WearableListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(event: MessageEvent) {
        val isApproval = event.path == WearSync.PATH_APPROVAL_RESPONSE
        val isQuestion = event.path == WearSync.PATH_QUESTION_RESPONSE
        if (!isApproval && !isQuestion) {
            super.onMessageReceived(event)
            return
        }
        val payload = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull()
            ?: return
        val sessionId = payload.optString("sessionId")
        val requestId = payload.optString("requestId")
        if (requestId.isBlank() || (isApproval && sessionId.isBlank())) return

        scope.launch {
            val delivered = runCatching {
                if (isApproval) {
                    BackgroundApi.client.respondToPermission(
                        PermissionResponse(
                            sessionId,
                            requestId,
                            if (payload.optBoolean("approve", false)) PermissionAction.ALLOW_ONCE
                            else PermissionAction.DENY,
                        )
                    )
                } else {
                    val providerSessionId =
                        payload.optString("providerSessionId").takeIf { it.isNotBlank() }
                    val answer = payload.optString("answer").takeIf { it.isNotBlank() }
                    if (answer == null) {
                        BackgroundApi.client.rejectQuestion(requestId, providerSessionId)
                    } else {
                        // One list of chosen labels per question; the watch only
                        // ever offers single-question requests.
                        BackgroundApi.client.respondToQuestion(
                            requestId,
                            listOf(listOf(answer)),
                            providerSessionId,
                        )
                    }
                }
            }.isSuccess
            val context = applicationContext
            // Same rule as the widget: the watch row only disappears once the
            // backend has actually taken the answer.
            if (delivered) {
                WidgetStore.load(context)?.let { snapshot ->
                    val trimmed = snapshot.copy(
                        approvals = snapshot.approvals.filterNot { it.requestId == requestId },
                        questions = snapshot.questions.filterNot { it.requestId == requestId },
                    )
                    WidgetStore.save(context, trimmed)
                    WearSync.push(context, trimmed)
                }
            }
            WidgetHub.pushAll(context)
            WidgetRefreshWorker.refreshNow(context)
        }
    }
}
