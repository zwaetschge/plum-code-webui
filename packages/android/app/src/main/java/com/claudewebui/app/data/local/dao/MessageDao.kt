package com.claudewebui.app.data.local.dao

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.claudewebui.app.data.local.entity.MessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface MessageDao {

    /**
     * Observe one chat only; mixing sibling threads produces a false transcript.
     *
     * Windowed to the newest [limit] rows: this Flow re-materialises on every
     * write, so observing the whole chat kept the entire transcript resident
     * and re-read it per streamed message — long sessions ran out of memory.
     */
    @Query(
        "SELECT * FROM (" +
            "SELECT * FROM messages WHERE sessionId = :sessionId AND chatId IS :chatId " +
            "ORDER BY timestamp DESC, eventSequence DESC, id DESC LIMIT :limit" +
            ") ORDER BY timestamp ASC, eventSequence ASC, id ASC"
    )
    fun getByChat(sessionId: String, chatId: String?, limit: Int): Flow<List<MessageEntity>>

    /** Newest first: Paging loads the live tail first and older rows on demand. */
    @Query(
        "SELECT * FROM messages WHERE sessionId = :sessionId AND chatId IS :chatId " +
            "ORDER BY timestamp DESC, eventSequence DESC, id DESC"
    )
    fun pageByChat(sessionId: String, chatId: String?): PagingSource<Int, MessageEntity>

    /** Insert a single message, replacing on conflict (e.g. streaming update). */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: MessageEntity)

    /** Insert a batch of messages in one transaction. */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(messages: List<MessageEntity>)

    /** Rows representing the same durable event under a legacy/optimistic id. */
    @Query(
        """
        SELECT * FROM messages
        WHERE sessionId = :sessionId AND chatId IS :chatId AND (
            id = :id OR
            (:clientMessageId IS NOT NULL AND clientMessageId = :clientMessageId) OR
            (:eventSequence IS NOT NULL AND eventSequence = :eventSequence)
        )
        """
    )
    suspend fun findIdentityMatches(
        sessionId: String,
        chatId: String?,
        id: String,
        clientMessageId: String?,
        eventSequence: Long?,
    ): List<MessageEntity>

    @Query("DELETE FROM messages WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    /** Remove all cached messages for a session (e.g. after session deletion). */
    @Query("DELETE FROM messages WHERE sessionId = :sessionId")
    suspend fun deleteBySessionId(sessionId: String)

    @Query("DELETE FROM messages WHERE sessionId = :sessionId AND chatId IS :chatId")
    suspend fun deleteByChat(sessionId: String, chatId: String?)

    /**
     * Fetch the N most recent messages for a session — useful for
     * populating a summary or context window without loading the full history.
     */
    @Query(
        """
        SELECT * FROM messages
        WHERE sessionId = :sessionId AND chatId IS :chatId
        ORDER BY timestamp DESC, eventSequence DESC, id DESC
        LIMIT :limit
        """
    )
    suspend fun getLatest(sessionId: String, chatId: String?, limit: Int = 20): List<MessageEntity>

    /** One-shot fetch of all messages (no Flow). */
    @Query(
        "SELECT * FROM messages WHERE sessionId = :sessionId AND chatId IS :chatId " +
            "ORDER BY timestamp ASC, eventSequence ASC, id ASC"
    )
    suspend fun getByChatOnce(sessionId: String, chatId: String?): List<MessageEntity>

    /** Count cached messages for a session. */
    @Query("SELECT COUNT(*) FROM messages WHERE sessionId = :sessionId")
    suspend fun countForSession(sessionId: String): Int
}
