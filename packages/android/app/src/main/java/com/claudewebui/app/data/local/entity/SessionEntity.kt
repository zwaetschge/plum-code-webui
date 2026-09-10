package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ColumnInfo
import androidx.room.Index
import androidx.room.PrimaryKey
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.data.model.SessionStatus

/**
 * Room entity that caches [Session] data locally.
 * Indexed on [categoryId] for fast filtered queries.
 */
@Entity(
    tableName = "sessions",
    indices = [Index(value = ["categoryId"])]
)
data class SessionEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val provider: String,          // CLIProvider serialized name
    val status: String,            // SessionStatus serialized name
    val mode: String? = null,      // SessionMode serialized name, nullable
    val workingDirectory: String,
    val starred: Boolean = false,
    val lastMessage: String? = null,
    @ColumnInfo(defaultValue = "0") val unreadCount: Int = 0,
    val categoryId: String? = null,
    // Cached alongside the rest: without these the session settings sheet reads
    // a cached session that has dropped its model and reasoning, and shows
    // "provider default" for a session that has neither.
    val cliModel: String? = null,
    val cliReasoning: String? = null,
    val cliServiceTier: String? = null,
    val designStyleSkill: String? = null,
    val writingStyleSkill: String? = null,
    // Provider-native session id; resume/rewind logic needs it offline too.
    val claudeSessionId: String? = null,
    // Runtime snapshot, cached so the dashboard can distinguish "a process
    // exists" from "it is working on something" while offline or mid-refresh.
    @ColumnInfo(defaultValue = "0") val busy: Boolean = false,
    val activitySummary: String? = null,
    @ColumnInfo(defaultValue = "0") val queueDepth: Int = 0,
    @ColumnInfo(defaultValue = "0") val pendingApprovals: Int = 0,
    val lastActivityAt: String? = null,
    val updatedAt: String,
    val createdAt: String
)

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

fun Session.toEntity(): SessionEntity = SessionEntity(
    id = id,
    title = name,
    provider = cliProvider.name,
    status = status.name,
    mode = mode.name,
    workingDirectory = workingDirectory,
    starred = starred,
    lastMessage = lastMessage,
    unreadCount = unreadCount,
    categoryId = category,
    cliModel = cliModel,
    cliReasoning = cliReasoning,
    cliServiceTier = cliServiceTier,
    designStyleSkill = designStyleSkill,
    writingStyleSkill = writingStyleSkill,
    claudeSessionId = claudeSessionId,
    busy = busy,
    activitySummary = activitySummary,
    queueDepth = queueDepth,
    pendingApprovals = pendingApprovals,
    lastActivityAt = lastActivityAt,
    updatedAt = updatedAt,
    createdAt = createdAt
)

fun SessionEntity.toModel(): Session = Session(
    id = id,
    userId = "",                   // Not stored locally — filled from API when available
    name = title,
    workingDirectory = workingDirectory,
    claudeSessionId = claudeSessionId,
    status = runCatching { SessionStatus.valueOf(status) }.getOrDefault(SessionStatus.STOPPED),
    cliProvider = runCatching { CLIProvider.valueOf(provider) }.getOrDefault(CLIProvider.CODEX),
    starred = starred,
    lastMessage = lastMessage,
    unreadCount = unreadCount,
    category = categoryId,
    cliModel = cliModel,
    cliReasoning = cliReasoning,
    cliServiceTier = cliServiceTier,
    designStyleSkill = designStyleSkill,
    writingStyleSkill = writingStyleSkill,
    mode = mode?.let { m -> runCatching { SessionMode.valueOf(m) }.getOrNull() }
        ?: SessionMode.AUTO_ACCEPT,
    busy = busy,
    activitySummary = activitySummary,
    queueDepth = queueDepth,
    pendingApprovals = pendingApprovals,
    lastActivityAt = lastActivityAt,
    updatedAt = updatedAt,
    createdAt = createdAt
)
