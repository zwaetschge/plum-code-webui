package com.claudewebui.app.ui.components.dashboard

import android.content.Context
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumRed
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * What a session is doing, seen from the supervisor's chair.
 *
 * Every screen used to read `status`, `busy` and `pendingApprovals` for itself
 * and reach a slightly different verdict — which is how a crashed session and
 * one politely asking a question ended up the same shade of amber, and how a
 * STOPPED session came to be labelled "Waiting". This enum is decided once, in
 * [effectiveState], and then drives colour, wording, grouping and sort order
 * alike.
 */
enum class SessionActivity { NEEDS_YOU, WORKING, QUEUED, FAILED, IDLE }

/**
 * How long a session has gone without a sign of life, in three steps.
 *
 * `status` only reports that a process exists, so a harness that died mid-turn
 * claims RUNNING for as long as the row survives. Time since the last activity
 * is the only signal that separates "working" from "hung", and the dashboard
 * has to say which one it is rather than showing a hopeful green dot.
 */
enum class Stillness { ACTIVE, STILL, SUSPICIOUS }

/** Dashboard sections, in the order a supervisor should read them. */
enum class SessionGroup(private val headerRes: Int) {
    NEEDS_YOU(R.string.component_needs_you),
    WORKING(R.string.component_working),
    QUEUED(R.string.component_queued),
    SETTLED(R.string.component_settled);

    val header: String @Composable get() = stringResource(headerRes)
}

/**
 * How long a session may stay quiet before the dashboard stops believing its
 * own "working" label.
 *
 * Configurable because the honest threshold depends on the work: a session
 * running a test suite is silent for minutes by design, one editing files is
 * not. Cycled from Settings, read back through [IdlePrefs].
 */
enum class IdleThreshold(val minutes: Long) {
    FAST(5),
    NORMAL(10),
    RELAXED(20),
    PATIENT(45);

    val label: String @Composable get() = stringResource(R.string.component_minutes, minutes)

    companion object {
        val DEFAULT = NORMAL

        fun fromMinutes(minutes: Long): IdleThreshold =
            entries.firstOrNull { it.minutes == minutes } ?: DEFAULT
    }
}

/** The single verdict about one session. */
data class SessionState(
    val activity: SessionActivity,
    val stillness: Stillness,
    val group: SessionGroup,
    /** One line, suitable under the session name. */
    val label: String,
    /** Minutes since the last sign of life; null when the session never reported one. */
    val quietForMinutes: Long?,
) {
    /**
     * Worth an icon and a coloured line rather than muted grey — the session
     * either wants something or has stopped behaving as advertised.
     */
    val flagged: Boolean
        get() = activity == SessionActivity.NEEDS_YOU ||
            activity == SessionActivity.FAILED ||
            (activity == SessionActivity.WORKING && stillness != Stillness.ACTIVE)
}

/** A session together with the verdict, so neither is recomputed per row. */
data class SupervisedSession(val session: Session, val state: SessionState)

/** One dashboard section and its sessions, already ordered. */
data class SessionSection(val group: SessionGroup, val sessions: List<SupervisedSession>)

/**
 * The facts a verdict is made from, independent of which endpoint delivered
 * them.
 *
 * The dashboard reads a full [Session]; the home-screen widgets read the
 * gateway's narrower projection out of a JSON cache. Both have to reach the
 * same verdict about the same session, so both go through this.
 */
data class SessionFacts(
    val status: SessionStatus,
    val busy: Boolean = false,
    val queueDepth: Int = 0,
    val pendingApprovals: Int = 0,
    val activitySummary: String? = null,
    val lastActivityAt: String? = null,
    val updatedAt: String = "",
)

fun Session.facts(): SessionFacts = SessionFacts(
    status = status,
    busy = busy,
    queueDepth = queueDepth,
    pendingApprovals = pendingApprovals,
    activitySummary = activitySummary,
    lastActivityAt = lastActivityAt,
    updatedAt = updatedAt,
)

/** The dashboard's entry point; the verdict itself is decided below. */
fun effectiveState(
    session: Session,
    now: Instant = Instant.now(),
    idleAfterMinutes: Long = IdleThreshold.DEFAULT.minutes,
): SessionState = effectiveState(session.facts(), now, idleAfterMinutes)

/**
 * Decide what a session is really doing.
 *
 * Order matters: an approval outranks everything, because a session blocked on
 * a prompt still reports itself as RUNNING and would otherwise look busy. A
 * failure outranks a stale RUNNING flag for the same reason.
 */
fun effectiveState(
    facts: SessionFacts,
    now: Instant = Instant.now(),
    idleAfterMinutes: Long = IdleThreshold.DEFAULT.minutes,
): SessionState {
    val quiet = facts.quietMinutes(now)
    val stillness = when {
        quiet == null || quiet < idleAfterMinutes -> Stillness.ACTIVE
        quiet < idleAfterMinutes * 3 -> Stillness.STILL
        else -> Stillness.SUSPICIOUS
    }
    val working = facts.busy || facts.status == SessionStatus.RUNNING
    val activity = when {
        facts.pendingApprovals > 0 -> SessionActivity.NEEDS_YOU
        facts.status == SessionStatus.ERROR -> SessionActivity.FAILED
        working -> SessionActivity.WORKING
        facts.queueDepth > 0 -> SessionActivity.QUEUED
        else -> SessionActivity.IDLE
    }
    val group = when (activity) {
        SessionActivity.NEEDS_YOU -> SessionGroup.NEEDS_YOU
        SessionActivity.WORKING -> SessionGroup.WORKING
        SessionActivity.QUEUED -> SessionGroup.QUEUED
        SessionActivity.FAILED, SessionActivity.IDLE -> SessionGroup.SETTLED
    }
    return SessionState(
        activity = activity,
        stillness = stillness,
        group = group,
        label = label(facts, activity, stillness, quiet),
        quietForMinutes = quiet,
    )
}

private fun label(
    facts: SessionFacts,
    activity: SessionActivity,
    stillness: Stillness,
    quiet: Long?,
): String = when (activity) {
    SessionActivity.NEEDS_YOU ->
        if (facts.pendingApprovals > 1) "${facts.pendingApprovals} approvals waiting"
        else "Waiting for your approval"

    SessionActivity.FAILED -> "Ended with an error" + quiet.suffix()

    SessionActivity.WORKING -> when (stillness) {
        // The summary is what the agent said it was doing; while it keeps
        // arriving there is no reason to doubt it.
        Stillness.ACTIVE ->
            (facts.activitySummary?.takeIf { it.isNotBlank() } ?: "Working") + queueSuffix(facts)
        // Past the threshold the claim and the evidence disagree, so the card
        // reports the evidence instead of repeating the claim.
        Stillness.STILL -> "No sign of life for ${quiet ?: 0}m"
        Stillness.SUSPICIOUS -> "Silent for ${humanQuiet(quiet)} — may be stuck"
    }

    SessionActivity.QUEUED ->
        if (facts.queueDepth == 1) "1 message queued" else "${facts.queueDepth} messages queued"

    SessionActivity.IDLE -> "Idle" + quiet.suffix()
}

private fun queueSuffix(facts: SessionFacts): String =
    if (facts.queueDepth > 0) "  •  ${facts.queueDepth} queued" else ""

private fun Long?.suffix(): String = this?.let { "  •  ${agoLabel(it)}" } ?: ""

private fun humanQuiet(minutes: Long?): String = when {
    minutes == null -> "a while"
    minutes < 60 -> "${minutes}m"
    minutes < 60 * 24 -> "${minutes / 60}h"
    else -> "${minutes / (60 * 24)}d"
}

/** Relative wording for a gap measured in minutes. */
fun agoLabel(minutes: Long): String = when {
    minutes < 1 -> "just now"
    minutes < 60 -> "${minutes}m ago"
    minutes < 60 * 24 -> "${minutes / 60}h ago"
    minutes < 60 * 24 * 7 -> "${minutes / (60 * 24)}d ago"
    else -> "over a week ago"
}

/**
 * Minutes since this session last did anything.
 *
 * `lastActivityAt` is the runtime's own marker and only exists once a turn has
 * run, so `updatedAt` stands in for sessions that have never been used. Null
 * when neither parses — an unreadable timestamp must not be reported as
 * suspicious silence.
 */
private fun SessionFacts.quietMinutes(now: Instant): Long? {
    val stamp = (lastActivityAt ?: updatedAt).takeIf { it.isNotBlank() } ?: return null
    val instant = runCatching { Instant.parse(stamp) }.getOrNull() ?: return null
    return ChronoUnit.MINUTES.between(instant, now).coerceAtLeast(0)
}

/**
 * Group sessions into the dashboard's sections.
 *
 * Empty sections are dropped, so a quiet account shows one heading rather than
 * four. Inside a section the most urgent row comes first; ties fall back to the
 * most recently touched session.
 */
fun superviseSessions(
    sessions: List<Session>,
    now: Instant = Instant.now(),
    idleAfterMinutes: Long = IdleThreshold.DEFAULT.minutes,
): List<SessionSection> {
    val supervised = sessions.map { SupervisedSession(it, effectiveState(it, now, idleAfterMinutes)) }
    return SessionGroup.entries.mapNotNull { group ->
        val rows = supervised
            .filter { it.state.group == group }
            .sortedWith(
                compareByDescending<SupervisedSession> { urgency(it) }
                    .thenByDescending { it.session.updatedAt }
            )
        if (rows.isEmpty()) null else SessionSection(group, rows)
    }
}

/**
 * Rank within a section: more approvals, longer silence and outright failure
 * all pull a row upward.
 */
private fun urgency(row: SupervisedSession): Int = when (row.state.activity) {
    SessionActivity.NEEDS_YOU -> 100 + row.session.pendingApprovals
    SessionActivity.WORKING -> row.state.stillness.ordinal
    SessionActivity.QUEUED -> row.session.queueDepth
    SessionActivity.FAILED -> 1
    SessionActivity.IDLE -> 0
}

/**
 * The one colour code on the dashboard: amber means the session wants
 * something from you, red means it failed, green means it is working, grey
 * means it is resting.
 */
/**
 * The same colour code for surfaces that cannot read the Compose palette.
 *
 * RemoteViews resolve no theme, so widget rows need literals. They live beside
 * [accentFor] rather than in the renderer precisely so the two cannot drift
 * apart without someone seeing it — the values are the dark palette's.
 */
fun widgetArgb(state: SessionState): Int = when (state.activity) {
    SessionActivity.NEEDS_YOU -> 0xFFFFB536.toInt()
    SessionActivity.FAILED -> 0xFFFF575F.toInt()
    SessionActivity.WORKING ->
        if (state.stillness == Stillness.ACTIVE) 0xFF35E59A.toInt() else 0xFFFFB536.toInt()
    SessionActivity.QUEUED -> 0xFFB56BFF.toInt()
    // The palette's border grey is nearly invisible on the widget card; this is
    // the muted tone the widget layouts already use for secondary text.
    SessionActivity.IDLE -> 0xFF6B6577.toInt()
}

@Composable
@ReadOnlyComposable
fun accentFor(state: SessionState): Color = when (state.activity) {
    SessionActivity.NEEDS_YOU -> PlumAmber
    SessionActivity.FAILED -> PlumRed
    // Silence past the threshold is reported in amber: still possibly fine,
    // but no longer something to show as healthy green.
    SessionActivity.WORKING -> if (state.stillness == Stillness.ACTIVE) PlumGreen else PlumAmber
    SessionActivity.QUEUED -> PlumAccent
    SessionActivity.IDLE -> PlumBorder
}

/** Localize a computed state at the UI boundary without adding Android to verdict calculation. */
fun SessionState.localizedLabel(context: Context, facts: SessionFacts): String {
    fun text(id: Int, vararg args: Any): String = context.getString(id, *args)
    fun ago(minutes: Long): String = when {
        minutes < 1 -> text(R.string.component_just_now)
        minutes < 60 -> text(R.string.component_minutes_ago, minutes)
        minutes < 1440 -> text(R.string.component_hours_ago, minutes / 60)
        minutes < 10080 -> text(R.string.component_days_ago, minutes / 1440)
        else -> text(R.string.component_over_week_ago)
    }
    fun quiet(minutes: Long?): String = when {
        minutes == null -> text(R.string.component_a_while)
        minutes < 60 -> text(R.string.component_minutes, minutes)
        minutes < 1440 -> text(R.string.component_quiet_hours, minutes / 60)
        else -> text(R.string.component_quiet_days, minutes / 1440)
    }
    val suffix = quietForMinutes?.let { "  •  ${ago(it)}" }.orEmpty()
    return when (activity) {
        SessionActivity.NEEDS_YOU -> if (facts.pendingApprovals > 1)
            text(R.string.component_pending_approvals, facts.pendingApprovals)
        else text(R.string.component_waiting_approval)
        SessionActivity.FAILED -> text(R.string.component_ended_error) + suffix
        SessionActivity.WORKING -> when (stillness) {
            Stillness.ACTIVE -> (facts.activitySummary?.takeIf { it.isNotBlank() }
                ?: text(R.string.component_working)) + if (facts.queueDepth > 0)
                "  •  ${text(R.string.component_queue_count, facts.queueDepth)}" else ""
            Stillness.STILL -> text(R.string.component_no_activity, quietForMinutes ?: 0)
            Stillness.SUSPICIOUS -> text(R.string.component_possibly_stuck, quiet(quietForMinutes))
        }
        SessionActivity.QUEUED -> if (facts.queueDepth == 1) text(R.string.component_message_queued)
            else text(R.string.component_messages_queued, facts.queueDepth)
        SessionActivity.IDLE -> text(R.string.component_idle) + suffix
    }
}
