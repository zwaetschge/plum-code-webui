package com.claudewebui.app.widget

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Everything the home-screen widgets can display, fetched in one pass and
 * cached so widgets keep showing the last known state when the server is
 * unreachable or the device is offline.
 */
@Serializable
data class WidgetSnapshot(
    val updatedAtMs: Long = 0,
    val today: WPeriod = WPeriod(),
    val week: WPeriod = WPeriod(),
    val providers: List<WEntry> = emptyList(),
    val models: List<WEntry> = emptyList(),
    val topSessions: List<WEntry> = emptyList(),
    val days: List<WDay> = emptyList(),
    val limits: List<WLimit> = emptyList(),
    val sessions: List<WSession> = emptyList(),
    val approvals: List<WApproval> = emptyList(),
    val questions: List<WQuestion> = emptyList(),
    // How many the server actually had, so a widget showing the first eight can
    // say so instead of quietly presenting a truncated list as the whole truth.
    val sessionTotal: Int = 0,
    val approvalTotal: Int = 0,
    val questionTotal: Int = 0,
    // Counted over every session the server reported, not over the handful that
    // fit in the cache, so a headline never undercounts what is running.
    val busyTotal: Int = 0,
    val needsYouTotal: Int = 0,
)

@Serializable
data class WPeriod(
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val totalTokens: Long = 0,
    val costUsd: Double = 0.0,
    val requests: Long = 0,
)

@Serializable
data class WEntry(
    val id: String = "",
    val name: String = "",
    val sub: String = "",
    val tokens: Long = 0,
    val costUsd: Double = 0.0,
    val colorArgb: Long = 0xFF94A3B8,
)

@Serializable
data class WDay(
    val label: String = "",
    val tokens: Long = 0,
    val costUsd: Double = 0.0,
)

@Serializable
data class WLimit(
    val provider: String = "",
    val window: String = "",
    val percent: Int = 0,
    val colorArgb: Long = 0xFF94A3B8,
)

@Serializable
data class WSession(
    val id: String = "",
    val name: String = "",
    val provider: String = "",
    val status: String = "stopped",
    val mode: String = "",
    // `status` only says a process exists. Everything below is what separates a
    // session that is thinking from one waiting on you or stuck, and it is the
    // same set of facts the dashboard decides its verdict from.
    val busy: Boolean = false,
    val activitySummary: String? = null,
    val queueDepth: Int = 0,
    val pendingApprovals: Int = 0,
    val lastActivityAt: String? = null,
    val updatedAt: String = "",
)

@Serializable
data class WApproval(
    val sessionId: String = "",
    val sessionName: String = "",
    val toolName: String = "",
    val requestId: String = "",
)

/**
 * A question the agent is blocked on, flattened to what a widget row can act on.
 *
 * Only the first question of a request is carried, and only its option labels:
 * a widget tap has to resolve to one answer, and a multi-question request or a
 * free-text one cannot be answered from a 40dp button. Those are marked
 * [answerable] = false and the row opens the app instead.
 */
@Serializable
data class WQuestion(
    val sessionId: String = "",
    val sessionName: String = "",
    val requestId: String = "",
    val providerSessionId: String = "",
    val prompt: String = "",
    val options: List<String> = emptyList(),
    val answerable: Boolean = false,
)

/** Plain-prefs JSON cache for the last successful widget snapshot. */
object WidgetStore {
    private const val PREFS = "plum_widget_cache"
    private const val KEY = "snapshot_v1"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun load(context: Context): WidgetSnapshot? =
        runCatching {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, null)
                ?.let { json.decodeFromString<WidgetSnapshot>(it) }
        }.getOrNull()

    fun save(context: Context, snapshot: WidgetSnapshot) {
        runCatching {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, json.encodeToString(WidgetSnapshot.serializer(), snapshot))
                .apply()
        }
    }
}
