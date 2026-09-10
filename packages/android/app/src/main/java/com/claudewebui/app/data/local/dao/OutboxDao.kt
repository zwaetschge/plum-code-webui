package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.claudewebui.app.data.local.entity.OutboxEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface OutboxDao {
    @Query("SELECT * FROM message_outbox WHERE status != 'ACCEPTED' ORDER BY createdAt ASC")
    fun observePending(): Flow<List<OutboxEntity>>

    @Query("DELETE FROM message_outbox WHERE clientMessageId = :clientMessageId AND status = 'FAILED'")
    suspend fun discardFailed(clientMessageId: String)

    @Query("SELECT * FROM message_outbox WHERE sessionId = :sessionId ORDER BY createdAt ASC")
    fun observeForSession(sessionId: String): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM message_outbox WHERE clientMessageId = :clientMessageId LIMIT 1")
    suspend fun get(clientMessageId: String): OutboxEntity?

    @Query("SELECT * FROM message_outbox WHERE sessionId = :sessionId AND status IN ('SENDING', 'FAILED') ORDER BY createdAt ASC")
    suspend fun pendingForSession(sessionId: String): List<OutboxEntity>

    @Upsert
    suspend fun upsert(item: OutboxEntity)

    @Query("DELETE FROM message_outbox WHERE clientMessageId = :clientMessageId")
    suspend fun delete(clientMessageId: String)

    @Query("DELETE FROM message_outbox WHERE status = 'ACCEPTED' AND createdAt < :before")
    suspend fun pruneAccepted(before: Long)
}
