package com.claudewebui.app.core.notifications

import com.claudewebui.app.data.model.AppNotification

/** Kinds of feed rows that are worth a native notification on their own. */
internal val ANNOUNCEABLE_FEED_KINDS = setOf("reply", "goal", "error", "question")

/** What one pass over the server feed should say, and what it should remember. */
internal data class FeedDiff(
    /** Rows to announce now, oldest first so the newest ends on top. */
    val announce: List<AppNotification>,
    /** Every id seen in this pass; the next pass treats them as known. */
    val seen: Set<String>,
)

/**
 * Decide which feed rows are news.
 *
 * The first pass after install (or after the remembered ids were lost) only
 * records what exists — replaying a week of old "reply ready" rows as fresh
 * notifications would be worse than saying nothing. After that, an unread row
 * with an id nobody has recorded is a turn that finished while the socket was
 * down, and that is exactly the case this exists for.
 */
internal fun diffFeed(
    items: List<AppNotification>,
    seen: Set<String>,
    initialized: Boolean,
): FeedDiff {
    val ids = items.map { it.id }.toSet()
    if (!initialized) return FeedDiff(announce = emptyList(), seen = ids)
    val fresh = items
        .filter { it.readAt == null && it.id !in seen && it.kind in ANNOUNCEABLE_FEED_KINDS }
        .filter { !it.sessionId.isNullOrBlank() }
        .asReversed()
    return FeedDiff(announce = fresh, seen = seen + ids)
}
