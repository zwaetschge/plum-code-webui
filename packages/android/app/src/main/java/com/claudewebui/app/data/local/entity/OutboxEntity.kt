package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.claudewebui.app.data.model.ActiveFollowupMode
import com.claudewebui.app.data.model.PersistedOutboxAttachment
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val outboxJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

@Serializable
enum class OutboxStatus { SENDING, ACCEPTED, FAILED }

@Entity(
    tableName = "message_outbox",
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        )
    ],
    indices = [Index(value = ["sessionId"]), Index(value = ["sessionId", "createdAt"])],
)
data class OutboxEntity(
    @PrimaryKey val clientMessageId: String,
    val sessionId: String,
    val content: String,
    val attachmentsJson: String = "[]",
    val uploadIdsJson: String = "[]",
    val activeFollowupMode: String = ActiveFollowupMode.QUEUE.name,
    val status: String = OutboxStatus.SENDING.name,
    val progress: Float = 0f,
    val error: String? = null,
    val retryable: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
    val acceptedAt: String? = null,
    val messageId: String? = null,
    val disposition: String? = null,
    val highWatermark: Long? = null,
    /** Thread captured when the turn was composed; retries never drift to another chat. */
    val chatId: String? = null,
) {
    val attachments: List<PersistedOutboxAttachment>
        get() = runCatching {
            outboxJson.decodeFromString<List<PersistedOutboxAttachment>>(attachmentsJson)
        }.getOrDefault(emptyList())

    val uploadIds: List<String>
        get() = runCatching { outboxJson.decodeFromString<List<String>>(uploadIdsJson) }
            .getOrDefault(emptyList())

    val followupMode: ActiveFollowupMode
        get() = runCatching { ActiveFollowupMode.valueOf(activeFollowupMode) }
            .getOrDefault(ActiveFollowupMode.QUEUE)

    val deliveryStatus: OutboxStatus
        get() = runCatching { OutboxStatus.valueOf(status) }.getOrDefault(OutboxStatus.FAILED)

    /** Moving a failed send is a new delivery; old upload IDs belong to its old chat. */
    fun retarget(chatId: String?, newClientMessageId: String): OutboxEntity {
        require(deliveryStatus == OutboxStatus.FAILED)
        require(newClientMessageId != clientMessageId)
        return OutboxEntity(
            clientMessageId = newClientMessageId,
            sessionId = sessionId,
            chatId = chatId,
            content = content,
            activeFollowupMode = activeFollowupMode,
            attachmentsJson = OutboxEntity.attachmentsJson(attachments.map {
                it.copy(uploadId = null, progress = 0f, uploadedChunks = emptyList(), totalChunks = 0, error = null)
            }),
        )
    }

    companion object {
        fun attachmentsJson(value: List<PersistedOutboxAttachment>): String = outboxJson.encodeToString(value)
        fun uploadIdsJson(value: List<String>): String = outboxJson.encodeToString(value)
    }
}
