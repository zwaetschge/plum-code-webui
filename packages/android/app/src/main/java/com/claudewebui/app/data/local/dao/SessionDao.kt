package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.Upsert
import com.claudewebui.app.data.local.entity.SessionEntity
import kotlinx.coroutines.flow.Flow

/** Projection for [SessionDao.pendingApprovalCounts]. */
data class PendingApprovalCount(val id: String, val pendingApprovals: Int)

@Dao
interface SessionDao {

    /** Observe all sessions ordered by most recently updated. */
    @Query("SELECT * FROM sessions ORDER BY updatedAt DESC")
    fun getAll(): Flow<List<SessionEntity>>

    /** Observe a single session by ID, or null if not cached. */
    @Query("SELECT * FROM sessions WHERE id = :id")
    fun getById(id: String): Flow<SessionEntity?>

    /** Observe sessions belonging to a specific category. */
    @Query("SELECT * FROM sessions WHERE categoryId = :categoryId ORDER BY updatedAt DESC")
    fun getByCategory(categoryId: String): Flow<List<SessionEntity>>

    /** Observe starred sessions. */
    @Query("SELECT * FROM sessions WHERE starred = 1 ORDER BY updatedAt DESC")
    fun getStarred(): Flow<List<SessionEntity>>

    /**
     * Insert or update a session. Must NOT use OnConflictStrategy.REPLACE:
     * SQLite implements REPLACE as DELETE+INSERT, which cascades the
     * messages/drafts foreign keys and wipes the cached chat history on
     * every session refresh.
     */
    @Upsert
    suspend fun insert(session: SessionEntity)

    /** Insert or update multiple sessions in a single transaction. */
    @Upsert
    suspend fun insertAll(sessions: List<SessionEntity>)

    /** Replace the remote snapshot without deleting still-valid parent rows first. */
    @Transaction
    suspend fun syncRemote(sessions: List<SessionEntity>) {
        // `GET /api/sessions` does not carry approval counts — those come from
        // the gateway overview. An upsert writes every column, so without this
        // a plain session refresh would silently zero the approval badges.
        val approvals = pendingApprovalCounts().associate { it.id to it.pendingApprovals }
        insertAll(
            sessions.map { session ->
                approvals[session.id]?.let { session.copy(pendingApprovals = it) } ?: session
            }
        )
        if (sessions.isEmpty()) deleteAll() else deleteNotIn(sessions.map { it.id })
    }

    @Query("SELECT id, pendingApprovals FROM sessions")
    suspend fun pendingApprovalCounts(): List<PendingApprovalCount>

    /**
     * Apply the gateway overview's approval counts, clearing sessions it no
     * longer lists so a resolved approval stops showing a badge.
     */
    @Transaction
    suspend fun syncPendingApprovals(counts: Map<String, Int>) {
        clearPendingApprovals()
        for ((id, count) in counts) setPendingApprovals(id, count)
    }

    @Query("UPDATE sessions SET pendingApprovals = 0 WHERE pendingApprovals != 0")
    suspend fun clearPendingApprovals()

    @Query("UPDATE sessions SET pendingApprovals = :count WHERE id = :id")
    suspend fun setPendingApprovals(id: String, count: Int)

    /**
     * Write a live runtime update from a socket event.
     *
     * A targeted UPDATE rather than a row upsert: socket traffic is frequent
     * and an upsert would need the whole entity, which the event does not have.
     */
    @Query(
        """
        UPDATE sessions
           SET busy = :busy,
               activitySummary = :activitySummary,
               queueDepth = :queueDepth,
               lastActivityAt = :lastActivityAt
         WHERE id = :id
        """
    )
    suspend fun setRuntime(
        id: String,
        busy: Boolean,
        activitySummary: String?,
        queueDepth: Int,
        lastActivityAt: String?,
    )

    /** Status from a socket lifecycle event, without touching the rest of the row. */
    @Query("UPDATE sessions SET status = :status WHERE id = :id")
    suspend fun setStatus(id: String, status: String)

    // The three below exist because a socket event carries one fact, not a
    // runtime snapshot. Routing them through [setRuntime] would write null over
    // whatever column the event happens not to mention — a queue update would
    // erase the tool detail, a tool event would zero the queue depth.

    /** Turn started/finished. */
    @Query("UPDATE sessions SET busy = :busy, lastActivityAt = :lastActivityAt WHERE id = :id")
    suspend fun setBusy(id: String, busy: Boolean, lastActivityAt: String?)

    /** What the agent is currently doing, from a tool or subagent event. */
    @Query(
        "UPDATE sessions SET activitySummary = :activitySummary, busy = 1, " +
            "lastActivityAt = :lastActivityAt WHERE id = :id"
    )
    suspend fun setActivity(id: String, activitySummary: String?, lastActivityAt: String?)

    /**
     * Turn over: idle and nothing in progress.
     *
     * One statement rather than setBusy(false) + setActivity(null), because
     * [setActivity] marks the session busy and would undo the first write.
     */
    @Query(
        "UPDATE sessions SET busy = 0, activitySummary = NULL, " +
            "lastActivityAt = :lastActivityAt WHERE id = :id"
    )
    suspend fun setIdle(id: String, lastActivityAt: String?)

    /** Queue depth and busy flag from a queue event. */
    @Query("UPDATE sessions SET queueDepth = :queueDepth, busy = :busy WHERE id = :id")
    suspend fun setQueue(id: String, queueDepth: Int, busy: Boolean)

    @Query("DELETE FROM sessions WHERE id NOT IN (:ids)")
    suspend fun deleteNotIn(ids: List<String>)

    @Update
    suspend fun update(session: SessionEntity)

    @Delete
    suspend fun delete(session: SessionEntity)

    /** Delete a session by ID. */
    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun deleteById(id: String)

    /** Clear the entire session cache. Called before a full network refresh. */
    @Query("DELETE FROM sessions")
    suspend fun deleteAll()

    /** One-shot fetch for a single session (no Flow). */
    @Query("SELECT * FROM sessions WHERE id = :id LIMIT 1")
    suspend fun getByIdOnce(id: String): SessionEntity?

    /** One-shot count — useful for deciding whether to show an empty state. */
    @Query("SELECT COUNT(*) FROM sessions")
    suspend fun count(): Int
}
