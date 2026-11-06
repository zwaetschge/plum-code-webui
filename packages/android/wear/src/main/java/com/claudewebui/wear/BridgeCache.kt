package com.claudewebui.wear

import android.content.Context
import org.json.JSONArray

/** What the watch last heard from Plum over its own bridge connection. */
data class BridgeData(
    val usage: List<UsageRow> = emptyList(),
    /** When Plum computed the usage rows. */
    val usageAt: Long = 0,
    val approvals: List<Approval> = emptyList(),
    val sessions: List<SessionRow> = emptyList(),
    /** Last successful contact with Plum (local clock), for „Stand vor …“. */
    val syncedAt: Long = 0,
)

/**
 * The latest bridge data as raw JSON in private prefs, so tile, complications
 * and an offline app start render instantly. Holds no secret: the token lives
 * in [PairingStore].
 */
object BridgeCache {

    private const val PREFS = "plum_bridge"
    private const val KEY_USAGE = "usage"
    private const val KEY_USAGE_AT = "usageAt"
    private const val KEY_APPROVALS = "approvals"
    private const val KEY_SESSIONS = "sessions"
    private const val KEY_SYNCED_AT = "syncedAt"
    private const val KEY_ATTEMPT_AT = "attemptAt"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(context: Context): BridgeData {
        val prefs = prefs(context)
        return BridgeData(
            usage = BridgeJson.usageRows(parse(prefs.getString(KEY_USAGE, null))),
            usageAt = prefs.getLong(KEY_USAGE_AT, 0),
            approvals = BridgeJson.approvals(parse(prefs.getString(KEY_APPROVALS, null))),
            sessions = BridgeJson.sessions(parse(prefs.getString(KEY_SESSIONS, null))),
            syncedAt = prefs.getLong(KEY_SYNCED_AT, 0),
        )
    }

    fun saveUsage(context: Context, raw: JSONArray, at: Long, syncedAt: Long) {
        prefs(context).edit()
            .putString(KEY_USAGE, raw.toString())
            .putLong(KEY_USAGE_AT, at)
            .putLong(KEY_SYNCED_AT, syncedAt)
            .apply()
    }

    fun saveApprovals(context: Context, raw: JSONArray, syncedAt: Long) {
        prefs(context).edit()
            .putString(KEY_APPROVALS, raw.toString())
            .putLong(KEY_SYNCED_AT, syncedAt)
            .apply()
    }

    fun saveSessions(context: Context, raw: JSONArray, syncedAt: Long) {
        prefs(context).edit()
            .putString(KEY_SESSIONS, raw.toString())
            .putLong(KEY_SYNCED_AT, syncedAt)
            .apply()
    }

    /** Last background refresh attempt; keeps the tile from re-triggering a failing refresh. */
    fun attemptAt(context: Context): Long = prefs(context).getLong(KEY_ATTEMPT_AT, 0)

    fun markAttempt(context: Context, at: Long = System.currentTimeMillis()) {
        prefs(context).edit().putLong(KEY_ATTEMPT_AT, at).apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    private fun parse(json: String?): JSONArray? =
        if (json.isNullOrBlank()) null else runCatching { JSONArray(json) }.getOrNull()
}
