package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

/**
 * Unsent text is owned by a session and chat. Empty chatId preserves legacy drafts.
 */
@Entity(
    tableName = "drafts",
    primaryKeys = ["sessionId", "chatId"],
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["sessionId"])]
)
data class DraftEntity(
    val sessionId: String,
    val content: String,
    val chatId: String = "",
    val timestamp: Long = System.currentTimeMillis()
)
