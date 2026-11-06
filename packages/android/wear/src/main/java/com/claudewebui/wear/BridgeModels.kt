package com.claudewebui.wear

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime

/** When a usage window hits 100 % at the recent pace (see usage.limits in rpc.ts). */
data class UsageForecast(val state: String, val at: Long?)

data class UsageWindow(
    val label: String,
    val utilization: Int,
    val resetsAt: Long?,
    val forecast: UsageForecast,
)

/** One provider row of the bridge's `usage.limits` RPC / `usage` push. */
data class UsageRow(
    val provider: String,
    val label: String,
    val estimate: Boolean,
    val exhausted: Boolean,
    val active: Boolean,
    val analyticsPath: String,
    val windows: List<UsageWindow>,
) {
    /** The window closest to its limit — the one that runs out first. */
    val peak: UsageWindow? get() = windows.maxByOrNull { it.utilization }

    /** Shown number; an exhausted allowance counts as full whatever the windows say. */
    val displayPercent: Int
        get() {
            val value = peak?.utilization ?: 0
            return if (exhausted) maxOf(100, value) else value
        }

    /** Ring fill, 0..100. */
    val percent: Int get() = displayPercent.coerceIn(0, 100)
}

/** The row the big ring, tile and complication show: the active one, else the fullest. */
fun List<UsageRow>.focusRow(): UsageRow? = firstOrNull { it.active } ?: maxByOrNull { it.percent }

/** Same thresholds as the extension's toolbar ring. */
object UsageColors {
    val OK: Int = 0xFF07CA6B.toInt()
    val WARNING: Int = 0xFFE89558.toInt()
    val DANGER: Int = 0xFFEA2143.toInt()

    fun of(row: UsageRow): Int = when {
        row.exhausted || row.percent >= 90 -> DANGER
        row.percent >= 75 -> WARNING
        else -> OK
    }

    fun of(utilization: Int): Int = when {
        utilization >= 90 -> DANGER
        utilization >= 75 -> WARNING
        else -> OK
    }
}

data class QuestionItem(
    val header: String,
    val question: String,
    val multiple: Boolean,
    val options: List<String>,
)

/** An open tool approval or agent question from `approvals.list`. */
sealed interface Approval {
    val sessionId: String
    val sessionName: String?
    val requestId: String
    val createdAt: Long

    data class Permission(
        override val sessionId: String,
        override val sessionName: String?,
        override val requestId: String,
        override val createdAt: Long,
        val toolName: String,
        val description: String,
    ) : Approval

    data class Question(
        override val sessionId: String,
        override val sessionName: String?,
        override val requestId: String,
        override val createdAt: Long,
        val providerSessionId: String?,
        val questions: List<QuestionItem>,
    ) : Approval {
        /** One single-choice question with options is a one-tap answer; anything else is not. */
        val answerable: Boolean
            get() = questions.size == 1 && !questions[0].multiple && questions[0].options.isNotEmpty()
    }
}

/** A row of `sessions.list`. */
data class SessionRow(
    val id: String,
    val name: String,
    val provider: String,
    val status: String,
    val busy: Boolean,
    val lastActivity: Long,
)

object BridgeJson {

    fun usageRows(array: JSONArray?): List<UsageRow> = buildList<UsageRow> {
        for (i in 0 until (array?.length() ?: 0)) {
            val row = array!!.optJSONObject(i) ?: continue
            val windows = buildList<UsageWindow> {
                val list = row.optJSONArray("windows")
                for (j in 0 until (list?.length() ?: 0)) {
                    val window = list!!.optJSONObject(j) ?: continue
                    val forecast = window.optJSONObject("forecast")
                    add(
                        UsageWindow(
                            label = window.text("label").orEmpty(),
                            utilization = window.optDouble("utilization", 0.0).toInt().coerceAtLeast(0),
                            resetsAt = time(window.opt("resetsAt")),
                            forecast = UsageForecast(
                                state = forecast?.text("state") ?: "unknown",
                                at = time(forecast?.opt("at")),
                            ),
                        )
                    )
                }
            }
            val provider = row.text("provider") ?: continue
            add(
                UsageRow(
                    provider = provider,
                    label = row.text("label") ?: provider,
                    estimate = row.optBoolean("estimate", false),
                    exhausted = row.optBoolean("exhausted", false),
                    active = row.optBoolean("active", false),
                    analyticsPath = row.text("analyticsPath").orEmpty(),
                    windows = windows,
                )
            )
        }
    }

    fun approvals(array: JSONArray?): List<Approval> = buildList<Approval> {
        for (i in 0 until (array?.length() ?: 0)) {
            val item = array!!.optJSONObject(i) ?: continue
            val sessionId = item.text("sessionId") ?: continue
            val requestId = item.text("requestId") ?: continue
            val sessionName = item.text("sessionName")
            val createdAt = time(item.opt("createdAt")) ?: 0L
            when (item.text("kind")) {
                "permission" -> add(
                    Approval.Permission(
                        sessionId = sessionId,
                        sessionName = sessionName,
                        requestId = requestId,
                        createdAt = createdAt,
                        toolName = item.text("toolName").orEmpty(),
                        description = item.text("description").orEmpty(),
                    )
                )
                "question" -> {
                    val questions = buildList<QuestionItem> {
                        val list = item.optJSONArray("questions")
                        for (j in 0 until (list?.length() ?: 0)) {
                            val question = list!!.optJSONObject(j) ?: continue
                            val options = question.optJSONArray("options")
                            add(
                                QuestionItem(
                                    header = question.text("header").orEmpty(),
                                    question = question.text("question").orEmpty(),
                                    multiple = question.optBoolean("multiple", false),
                                    options = buildList<String> {
                                        for (k in 0 until (options?.length() ?: 0)) {
                                            val option = options!!.opt(k)
                                            val label = when (option) {
                                                is JSONObject -> option.text("label")
                                                is String -> option
                                                else -> null
                                            }
                                            if (!label.isNullOrBlank()) add(label)
                                        }
                                    },
                                )
                            )
                        }
                    }
                    add(
                        Approval.Question(
                            sessionId = sessionId,
                            sessionName = sessionName,
                            requestId = requestId,
                            createdAt = createdAt,
                            providerSessionId = item.text("providerSessionId"),
                            questions = questions,
                        )
                    )
                }
            }
        }
    }

    fun sessions(array: JSONArray?): List<SessionRow> = buildList<SessionRow> {
        for (i in 0 until (array?.length() ?: 0)) {
            val row = array!!.optJSONObject(i) ?: continue
            val id = row.text("id") ?: continue
            val status = row.text("status").orEmpty()
            add(
                SessionRow(
                    id = id,
                    name = row.text("name")?.takeIf { it.isNotBlank() } ?: "Session",
                    provider = row.text("provider").orEmpty(),
                    status = status,
                    busy = if (row.has("busy") && !row.isNull("busy")) {
                        row.optBoolean("busy", false)
                    } else {
                        status == "running"
                    },
                    lastActivity = time(row.opt("lastActivity")) ?: 0L,
                )
            )
        }
    }

    /** Epoch milliseconds from an ISO string or a number; null for anything else. */
    fun time(value: Any?): Long? = when (value) {
        null -> null
        is Number -> value.toLong().takeIf { it > 0 }
        is String -> parseIso(value)
        else -> null
    }

    private fun parseIso(text: String): Long? {
        val value = text.trim()
        if (value.isEmpty() || value == "null") return null
        value.toLongOrNull()?.let { return it.takeIf { ms -> ms > 0 } }
        return runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(value).toEpochMilli() }
            // Postgres-style "2026-10-31 18:20:00" without a zone is UTC.
            .recoverCatching { Instant.parse(value.replace(' ', 'T') + "Z").toEpochMilli() }
            .getOrNull()
    }
}

/** optString() turns JSON null into the text "null"; this does not. */
internal fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key)
