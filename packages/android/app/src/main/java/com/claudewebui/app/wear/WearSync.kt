package com.claudewebui.app.wear

import android.content.Context
import com.claudewebui.app.widget.WidgetSnapshot
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import org.json.JSONObject

/**
 * Phone → watch mirror of the widget snapshot. One DataItem at /plum/snapshot
 * carries the quick stats, the pending approvals and the open questions; the
 * watch app, tile and
 * complication all read from it. Every call is best-effort — devices without
 * Play Services or a paired watch just no-op.
 */
object WearSync {

    const val PATH_SNAPSHOT = "/plum/snapshot"
    const val PATH_APPROVAL_RESPONSE = "/plum/approval-response"
    const val PATH_QUESTION_RESPONSE = "/plum/question-response"

    const val KEY_JSON = "json"

    /**
     * Whether a watch is paired at all. Used to decide if the periodic refresh
     * still has a consumer once every home-screen widget is gone. Blocking —
     * background threads only; assumes "no" when Play Services is absent.
     */
    fun hasPairedNode(context: Context): Boolean = runCatching {
        com.google.android.gms.tasks.Tasks.await(
            Wearable.getNodeClient(context).connectedNodes,
            3, java.util.concurrent.TimeUnit.SECONDS,
        ).isNotEmpty()
    }.getOrDefault(false)

    fun push(context: Context, snapshot: WidgetSnapshot) {
        runCatching {
            val json = JSONObject().apply {
                put("updatedAtMs", snapshot.updatedAtMs)
                put("running", snapshot.sessions.count { it.status == "running" })
                put("tokensToday", snapshot.today.totalTokens)
                put("costToday", snapshot.today.costUsd)
                put("requestsToday", snapshot.today.requests)
                put("approvals", JSONArray().apply {
                    snapshot.approvals.forEach { approval ->
                        put(JSONObject().apply {
                            put("sessionId", approval.sessionId)
                            put("sessionName", approval.sessionName)
                            put("toolName", approval.toolName)
                            put("requestId", approval.requestId)
                        })
                    }
                })
                // Only the options are mirrored, not the whole request: the watch
                // answers by label, and the phone owns the REST call.
                put("questions", JSONArray().apply {
                    snapshot.questions.forEach { question ->
                        put(JSONObject().apply {
                            put("sessionId", question.sessionId)
                            put("sessionName", question.sessionName)
                            put("requestId", question.requestId)
                            put("providerSessionId", question.providerSessionId)
                            put("prompt", question.prompt)
                            put("answerable", question.answerable)
                            put("options", JSONArray(question.options))
                        })
                    }
                })
            }
            val request = PutDataMapRequest.create(PATH_SNAPSHOT).apply {
                dataMap.putString(KEY_JSON, json.toString())
                dataMap.putLong("ts", snapshot.updatedAtMs)
            }.asPutDataRequest().setUrgent()
            Wearable.getDataClient(context).putDataItem(request)
        }
    }
}
