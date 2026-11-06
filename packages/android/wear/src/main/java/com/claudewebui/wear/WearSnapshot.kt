package com.claudewebui.wear

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** One pending approval mirrored from the phone. */
data class WearApproval(
    val sessionId: String,
    val sessionName: String,
    val toolName: String,
    val requestId: String,
)

/**
 * A question the agent is blocked on, mirrored from the phone.
 *
 * [answerable] is false when the request needs more than one tap can express —
 * several questions, free text, or multi-select. Those show up as a prompt with
 * only a Dismiss button; the phone is where they get answered.
 */
data class WearQuestion(
    val sessionId: String,
    val sessionName: String,
    val requestId: String,
    val providerSessionId: String,
    val prompt: String,
    val options: List<String>,
    val answerable: Boolean,
)

data class WearSnapshot(
    val updatedAtMs: Long = 0,
    val running: Int = 0,
    val tokensToday: Long = 0,
    val costToday: Double = 0.0,
    val requestsToday: Long = 0,
    val approvals: List<WearApproval> = emptyList(),
    val questions: List<WearQuestion> = emptyList(),
)

/**
 * Snapshot access for every wear surface. The phone writes one DataItem at
 * /plum/snapshot; [WearDataListenerService] caches its JSON into prefs so the
 * tile and complication render instantly, and [readLive] pulls the DataItem
 * directly when freshness matters (foreground activity).
 */
object WearSnapshotStore {

    const val PATH_SNAPSHOT = "/plum/snapshot"
    const val PATH_APPROVAL_RESPONSE = "/plum/approval-response"
    const val PATH_QUESTION_RESPONSE = "/plum/question-response"
    const val KEY_JSON = "json"

    private const val PREFS = "wear_snapshot"
    private const val KEY_CACHED = "snapshot_json"

    private val _changes = MutableStateFlow(0)

    /** Bumped on every cached push so an open screen can re-read the snapshot. */
    val changes: StateFlow<Int> = _changes.asStateFlow()

    fun cache(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_CACHED, json).apply()
        _changes.update { it + 1 }
    }

    fun cached(context: Context): WearSnapshot =
        parse(
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_CACHED, null)
        )

    /** Blocking DataClient read — call off the main thread only. */
    fun readLive(context: Context): WearSnapshot {
        return runCatching {
            val items = Tasks.await(
                Wearable.getDataClient(context).dataItems,
                3, TimeUnit.SECONDS,
            )
            // release() in a finally: a malformed item threw out of the loop
            // and leaked the buffer, and DataItemBuffer is a shared native
            // allocation the Wear service does not reclaim for us.
            val json = try {
                var found: String? = null
                items.forEach { item ->
                    if (item.uri.path == PATH_SNAPSHOT) {
                        found = DataMapItem.fromDataItem(item).dataMap.getString(KEY_JSON)
                    }
                }
                found
            } finally {
                items.release()
            }
            json?.also { cache(context, it) }
            parse(json)
        }.getOrElse { cached(context) }
    }

    private fun parse(json: String?): WearSnapshot {
        if (json.isNullOrBlank()) return WearSnapshot()
        return runCatching {
            val root = JSONObject(json)
            val approvals = buildList {
                val array = root.optJSONArray("approvals")
                for (i in 0 until (array?.length() ?: 0)) {
                    val entry = array!!.optJSONObject(i) ?: continue
                    add(
                        WearApproval(
                            sessionId = entry.optString("sessionId"),
                            sessionName = entry.optString("sessionName"),
                            toolName = entry.optString("toolName"),
                            requestId = entry.optString("requestId"),
                        )
                    )
                }
            }
            val questions = buildList {
                val array = root.optJSONArray("questions")
                for (i in 0 until (array?.length() ?: 0)) {
                    val entry = array!!.optJSONObject(i) ?: continue
                    val labels = entry.optJSONArray("options")
                    add(
                        WearQuestion(
                            sessionId = entry.optString("sessionId"),
                            sessionName = entry.optString("sessionName"),
                            requestId = entry.optString("requestId"),
                            providerSessionId = entry.optString("providerSessionId"),
                            prompt = entry.optString("prompt"),
                            options = buildList {
                                for (j in 0 until (labels?.length() ?: 0)) {
                                    add(labels!!.optString(j))
                                }
                            },
                            answerable = entry.optBoolean("answerable", false),
                        )
                    )
                }
            }
            WearSnapshot(
                updatedAtMs = root.optLong("updatedAtMs"),
                running = root.optInt("running"),
                tokensToday = root.optLong("tokensToday"),
                costToday = root.optDouble("costToday", 0.0),
                requestsToday = root.optLong("requestsToday"),
                approvals = approvals,
                questions = questions,
            )
        }.getOrDefault(WearSnapshot())
    }

    fun fmtTokens(value: Long): String = when {
        value >= 1_000_000 -> "%.1fM".format(value / 1_000_000.0)
        value >= 1_000 -> "%.1fk".format(value / 1_000.0)
        else -> value.toString()
    }
}

/**
 * Answers for the snapshot fallback (watch not paired with Plum itself): the
 * phone's WearBridgeService turns them into the REST calls.
 */
object PhoneRelay {

    /** Ships one answer to the phone; true only if a node accepted it. */
    suspend fun send(context: Context, path: String, payload: JSONObject): Boolean =
        withContext(Dispatchers.IO) {
            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
            // One node, not all of them. Every node that receives this runs
            // WearBridgeService and POSTs the same answer, so a user paired
            // with both a phone and a tablet answered the request twice.
            runCatching {
                val nodes = Tasks.await(
                    Wearable.getNodeClient(context).connectedNodes,
                    3, TimeUnit.SECONDS,
                )
                nodes.any { node ->
                    runCatching {
                        Tasks.await(
                            Wearable.getMessageClient(context).sendMessage(node.id, path, bytes),
                            3, TimeUnit.SECONDS,
                        )
                    }.isSuccess
                }
            }.getOrDefault(false)
        }
}
