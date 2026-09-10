package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import androidx.room.Transaction
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionReadStateDao {
    @Query("SELECT * FROM session_read_state")
    fun observeAll(): Flow<List<SessionReadStateEntity>>

    @Query("SELECT * FROM session_read_state WHERE sessionId = :sessionId LIMIT 1")
    fun observe(sessionId: String): Flow<SessionReadStateEntity?>

    @Query("SELECT * FROM session_read_state WHERE sessionId = :sessionId LIMIT 1")
    suspend fun get(sessionId: String): SessionReadStateEntity?

    @Upsert
    suspend fun upsert(state: SessionReadStateEntity)

    @Query("UPDATE session_read_state SET unreadCount = :count WHERE sessionId = :sessionId")
    suspend fun updateUnreadCount(sessionId: String, count: Int)

    /**
     * Create the read-state row for a session that has none yet.
     *
     * Every NOT NULL column is listed because SQLite has no defaults for them,
     * and `ON CONFLICT ... DO UPDATE` is avoided deliberately: upsert syntax
     * needs SQLite 3.24, which only ships from API 30 while this app runs from
     * API 26.
     */
    @Query(
        """
        INSERT OR IGNORE INTO session_read_state
            (sessionId, chatId, lastReadMessageId, lastSeenSequence, highWatermark,
             snapshotRevision, scrollAnchorMessageId, scrollOffset, unreadCount, updatedAt)
        VALUES (:sessionId, NULL, NULL, 0, 0, 0, NULL, 0, :count, NULL)
        """
    )
    suspend fun insertMissing(sessionId: String, count: Int)

    /**
     * Apply the server's unread counts, which are authoritative: marking a
     * session read on the phone goes through `PUT .../read-state` first, so a
     * refresh cannot resurrect a badge the user just cleared.
     *
     * Rows are created rather than only updated, so this table is the single
     * source for the badge. Before, a session the user had never opened had no
     * row at all, and its count had to be read from the cached session row
     * instead — two counters that drifted apart as soon as one of them moved.
     */
    @Transaction
    suspend fun syncServerUnreadCounts(counts: Map<String, Int>) {
        counts.forEach { (sessionId, count) ->
            insertMissing(sessionId, count)
            updateUnreadCount(sessionId, count)
        }
    }
}
