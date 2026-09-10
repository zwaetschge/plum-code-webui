package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.R

import com.claudewebui.app.core.diagnostics.Breadcrumbs
import android.content.Context
import android.net.Uri
import android.util.Base64
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttpException
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.model.CreateChatUploadInput
import com.claudewebui.app.data.model.FileAttachmentData
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.PersistedOutboxAttachment
import com.claudewebui.app.data.model.SessionSendAck
import com.claudewebui.app.data.repository.MessageRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Durable sends: the Room outbox, staged uploads, socket acknowledgements and
 * retries. Owned by [ChatViewModel] and scoped to its `viewModelScope`.
 */
internal class ChatSendController(
    private val scope: CoroutineScope,
    private val sessionId: String,
    private val state: MutableStateFlow<ChatUiState>,
    private val messageRepository: MessageRepository,
    private val socketManager: SocketManager,
    private val api: ApiClient,
    private val appContext: Context,
    /** The cached transcript; an accepted send already persisted there is dropped from the outbox. */
    private val messages: StateFlow<List<Message>>,
    private val drafts: ChatDraftController,
    private val isSessionReady: () -> Boolean,
) {
    private val deliveryJobs = ConcurrentHashMap<String, Job>()

    fun sendMessage(content: String) {
        Breadcrumbs.add("chat.send", "submit")
        val attachments = state.value.pendingAttachments.takeIf { it.isNotEmpty() }
        if (content.isBlank() && attachments.isNullOrEmpty()) return
        if (!isSessionReady()) {
            state.update { it.copy(error = appContext.getString(R.string.chat_session_loading)) }
            return
        }
        val sendChatId = state.value.activeChatId
        val sentDraft = drafts.snapshotForSend(sendChatId)
        val trimmed = content.trim()
        val clientMessageId = UUID.randomUUID().toString()
        val persistedAttachments = attachments.orEmpty().map {
            PersistedOutboxAttachment(
                uri = it.uri,
                mimeType = it.mimeType,
                filename = it.filename,
                sizeBytes = it.sizeBytes,
            )
        }
        val item = OutboxEntity(
            clientMessageId = clientMessageId,
            sessionId = sessionId,
            chatId = state.value.activeChatId,
            content = trimmed,
            attachmentsJson = OutboxEntity.attachmentsJson(persistedAttachments),
            activeFollowupMode = state.value.activeFollowupMode.name,
            status = OutboxStatus.SENDING.name,
        )
        scope.launch {
            // The composer clears only after the message is durable in Room.
            // A process death or transport loss can therefore never erase it.
            messageRepository.putOutbox(item)
            val cleared = drafts.clearAfterSend(sentDraft)
            state.update {
                if (it.activeChatId != sendChatId || cleared == null) it else it.copy(
                    isSending = true,
                    draftText = "",
                    pendingAttachments = emptyList(),
                    isPreparingAttachments = persistedAttachments.isNotEmpty(),
                    attachmentPreparationProgress = 0f,
                    activeDeliveryId = clientMessageId,
                )
            }
            deliverOutbox(item)
        }
    }

    fun retryOutbox(clientMessageId: String) {
        Breadcrumbs.add("chat.send", "retry outbox")
        scope.launch {
            val item = messageRepository.getOutboxItem(clientMessageId) ?: return@launch
            val retry = prepareOutboxRetry(item)
            messageRepository.putOutbox(retry)
            deliverOutbox(retry)
        }
    }

    /** Drops a failed send for good — the only exit for a message the server will never take. */
    fun discardOutbox(clientMessageId: String) {
        scope.launch { messageRepository.discardFailedOutbox(clientMessageId) }
    }

    /** Re-targets a send whose original chat is gone at the chat that is open now. */
    fun resendOutboxInActiveChat(clientMessageId: String) {
        val targetChatId = state.value.activeChatId
        scope.launch {
            val replacement = messageRepository.retargetFailedOutbox(clientMessageId, targetChatId) ?: return@launch
            deliverOutbox(replacement)
        }
    }

    /** Re-drive everything still waiting once the socket is back. */
    fun retryPendingOutbox() {
        if (socketManager.connectionState.value != ConnectionState.CONNECTED) return
        scope.launch {
            messageRepository.pendingOutbox(sessionId)
                .filter { it.retryable || it.deliveryStatus == OutboxStatus.SENDING }
                .forEach(::deliverOutbox)
            messageRepository.pruneAcceptedOutbox(System.currentTimeMillis() - OUTBOX_ACCEPTED_RETENTION_MS)
        }
    }

    fun cancelDelivery(clientMessageId: String) {
        deliveryJobs.remove(clientMessageId)?.cancel()
        scope.launch {
            val item = messageRepository.getOutboxItem(clientMessageId) ?: return@launch
            item.uploadIds.forEach { uploadId ->
                runCatching { api.cancelChatUpload(sessionId, uploadId) }
            }
            failOutbox(item, appContext.getString(R.string.chat_upload_cancelled), true)
            state.update {
                it.copy(
                    isSending = false,
                    isPreparingAttachments = false,
                    attachmentPreparationProgress = 0f,
                    activeDeliveryId = null,
                )
            }
        }
    }

    /** ViewModel teardown: in-flight deliveries stop with the screen. */
    fun cancelAll() {
        deliveryJobs.values.forEach { it.cancel() }
    }

    private fun deliverOutbox(item: OutboxEntity) {
        if (deliveryJobs[item.clientMessageId]?.isActive == true) return
        deliveryJobs[item.clientMessageId] = scope.launch {
            try {
                if (socketManager.connectionState.value != ConnectionState.CONNECTED) {
                    failOutbox(item, appContext.getString(R.string.chat_saved_offline), true)
                    return@launch
                }
                state.update {
                    it.copy(
                        isSending = true,
                        isPreparingAttachments = item.attachments.isNotEmpty(),
                        activeDeliveryId = item.clientMessageId,
                    )
                }
                val prepared = prepareDelivery(item)
                val latest = messageRepository.getOutboxItem(item.clientMessageId) ?: item
                val acknowledgement = socketManager.sendMessage(
                    sessionId = sessionId,
                    chatId = item.chatId,
                    message = item.content,
                    images = prepared.legacyAttachments.takeIf { it.isNotEmpty() },
                    clientMessageId = item.clientMessageId,
                    uploadIds = prepared.uploadIds,
                    activeFollowupMode = item.followupMode,
                )
                if (acknowledgement.status == SessionSendAck.SendStatus.ACCEPTED) {
                    val alreadyPersisted = messages.value.any { message ->
                        message.clientMessageId == item.clientMessageId ||
                            (acknowledgement.messageId != null && message.id == acknowledgement.messageId)
                    }
                    if (alreadyPersisted) {
                        messageRepository.removeOutbox(item.clientMessageId)
                    } else {
                        messageRepository.putOutbox(
                            latest.copy(
                                status = OutboxStatus.ACCEPTED.name,
                                progress = 1f,
                                error = null,
                                retryable = false,
                                acceptedAt = acknowledgement.acceptedAt,
                                messageId = acknowledgement.messageId,
                                disposition = acknowledgement.disposition,
                                highWatermark = acknowledgement.highWatermark,
                                uploadIdsJson = OutboxEntity.uploadIdsJson(prepared.uploadIds),
                            )
                        )
                    }
                    acknowledgement.highWatermark?.let { sequence ->
                        val read = messageRepository.cachedReadState(sessionId)
                            ?: SessionReadStateEntity(sessionId)
                        messageRepository.saveReadState(
                            read.copy(highWatermark = maxOf(read.highWatermark, sequence))
                        )
                    }
                } else {
                    failOutbox(
                        latest,
                        acknowledgement.error ?: appContext.getString(R.string.chat_message_rejected),
                        acknowledgement.retryable,
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                failOutbox(item, failure.message ?: appContext.getString(R.string.chat_delivery_failed), true)
            } finally {
                deliveryJobs.remove(item.clientMessageId)
                state.update { current ->
                    if (current.activeDeliveryId == item.clientMessageId) {
                        current.copy(
                            isSending = false,
                            isPreparingAttachments = false,
                            attachmentPreparationProgress = 0f,
                            activeDeliveryId = null,
                        )
                    } else current
                }
            }
        }
    }

    private suspend fun failOutbox(item: OutboxEntity, error: String, retryable: Boolean) {
        val latest = messageRepository.getOutboxItem(item.clientMessageId) ?: item
        messageRepository.putOutbox(
            latest.copy(
                status = OutboxStatus.FAILED.name,
                error = error,
                retryable = retryable,
            )
        )
    }

    private suspend fun prepareDelivery(item: OutboxEntity): PreparedDelivery = withContext(Dispatchers.IO) {
        if (item.attachments.isEmpty()) return@withContext PreparedDelivery(emptyList(), emptyList())
        var totalBytes = 0L
        val allBytes = item.attachments.map { attachment ->
            val remaining = (MAX_TOTAL_ATTACHMENT_BYTES - totalBytes).coerceAtLeast(0)
            val bytes = readUriWithLimit(
                appContext,
                Uri.parse(attachment.uri),
                minOf(MAX_ATTACHMENT_BYTES, remaining),
            )
            totalBytes += bytes.size
            bytes
        }

        var updatedAttachments = item.attachments
        val uploadIds = mutableListOf<String>()
        try {
            item.attachments.forEachIndexed { attachmentIndex, original ->
                val bytes = allBytes[attachmentIndex]
                var upload = original.uploadId?.let { id ->
                    runCatching { api.getChatUpload(sessionId, id) }.getOrNull()?.data
                }
                if (upload == null || upload.status == "cancelled" || upload.status == "failed") {
                    val response = api.createChatUpload(
                        sessionId,
                        CreateChatUploadInput(
                            filename = original.filename,
                            mimeType = original.mimeType,
                            byteSize = bytes.size.toLong(),
                            sha256 = sha256Hex(bytes),
                        ),
                    )
                    if (!response.success || response.data == null) {
                        error(response.error?.message ?: appContext.getString(R.string.chat_upload_start_failed))
                    }
                    upload = response.data
                }

                val initial = requireNotNull(upload)
                val missing = when {
                    initial.status == "complete" -> emptyList()
                    initial.missingChunks.isNotEmpty() -> initial.missingChunks
                    else -> (0 until initial.totalChunks).toList()
                }
                var latest = initial
                for (chunkIndex in missing) {
                    ensureActive()
                    val range = chunkByteRange(chunkIndex, initial.chunkSize, bytes.size) ?: continue
                    val start = range.first
                    val end = range.last + 1
                    val response = api.putChatUploadChunk(
                        sessionId = sessionId,
                        uploadId = initial.id,
                        index = chunkIndex,
                        bytes = bytes.copyOfRange(start, end),
                        byteOffset = start.toLong(),
                        totalBytes = bytes.size.toLong(),
                    )
                    if (!response.success || response.data == null) {
                        error(response.error?.message ?: appContext.getString(R.string.chat_upload_named_failed, original.filename))
                    }
                    latest = response.data
                    val overallProgress = (
                        attachmentIndex + latest.progress.coerceIn(0f, 1f)
                    ) / item.attachments.size.toFloat()
                    updatedAttachments = updatedAttachments.toMutableList().also { list ->
                        list[attachmentIndex] = original.copy(
                            uploadId = latest.id,
                            progress = latest.progress,
                            uploadedChunks = latest.receivedChunks,
                            totalChunks = latest.totalChunks,
                            error = latest.error,
                        )
                    }
                    val persisted = (messageRepository.getOutboxItem(item.clientMessageId) ?: item).copy(
                        attachmentsJson = OutboxEntity.attachmentsJson(updatedAttachments),
                        uploadIdsJson = OutboxEntity.uploadIdsJson(uploadIds + latest.id),
                        progress = overallProgress,
                    )
                    messageRepository.putOutbox(persisted)
                    state.update {
                        it.copy(attachmentPreparationProgress = overallProgress)
                    }
                }
                if (latest.status != "complete") {
                    val refreshed = api.getChatUpload(sessionId, latest.id)
                    latest = refreshed.data ?: latest
                }
                if (latest.status != "complete") {
                    error(latest.error ?: appContext.getString(R.string.chat_upload_incomplete))
                }
                uploadIds += latest.id
                updatedAttachments = updatedAttachments.toMutableList().also { list ->
                    list[attachmentIndex] = original.copy(
                        uploadId = latest.id,
                        progress = 1f,
                        uploadedChunks = latest.receivedChunks,
                        totalChunks = latest.totalChunks,
                    )
                }
            }
            messageRepository.putOutbox(
                (messageRepository.getOutboxItem(item.clientMessageId) ?: item).copy(
                    attachmentsJson = OutboxEntity.attachmentsJson(updatedAttachments),
                    uploadIdsJson = OutboxEntity.uploadIdsJson(uploadIds),
                    progress = 1f,
                )
            )
            PreparedDelivery(uploadIds, emptyList())
        } catch (failure: ApiHttpException) {
            if (failure.status != 404 && failure.status != 405) throw failure
            // Compatibility with servers predating staged uploads.
            PreparedDelivery(
                uploadIds = emptyList(),
                legacyAttachments = item.attachments.mapIndexed { index, attachment ->
                    FileAttachmentData(
                        data = Base64.encodeToString(allBytes[index], Base64.NO_WRAP),
                        mimeType = attachment.mimeType,
                        filename = attachment.filename,
                    )
                },
            )
        }
    }
}

internal const val OUTBOX_ACCEPTED_RETENTION_MS = 24L * 60L * 60L * 1_000L
internal const val MAX_ATTACHMENT_COUNT = 8
// The backend persists at most 25 MB per file and Socket.IO caps the complete
// JSON frame at 50 MB. Base64 expands bytes by roughly one third, so a 32 MB
// raw total leaves room for filenames and protocol overhead.
internal const val MAX_ATTACHMENT_BYTES = 25L * 1024L * 1024L
internal const val MAX_TOTAL_ATTACHMENT_BYTES = 32L * 1024L * 1024L

private data class PreparedDelivery(
    val uploadIds: List<String>,
    val legacyAttachments: List<FileAttachmentData>,
)

internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

internal fun prepareOutboxRetry(item: OutboxEntity): OutboxEntity = item.copy(
    status = OutboxStatus.SENDING.name,
    error = null,
    retryable = true,
)

internal fun chunkByteRange(index: Int, chunkSize: Int, totalBytes: Int): IntRange? {
    if (index < 0 || chunkSize <= 0 || totalBytes <= 0) return null
    val start = index.toLong() * chunkSize.toLong()
    if (start >= totalBytes) return null
    val endExclusive = minOf(start + chunkSize, totalBytes.toLong()).toInt()
    return start.toInt() until endExclusive
}

internal fun readUriWithLimit(
    context: Context,
    uri: Uri,
    maxBytes: Long,
    onProgress: (Long) -> Unit = {},
): ByteArray {
    val input = context.contentResolver.openInputStream(uri)
        ?: error(context.getString(R.string.chat_file_unavailable))
    return input.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0L
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            total += count
            if (total > maxBytes) {
                error(context.getString(R.string.chat_file_too_big, formatBytes(maxBytes)))
            }
            output.write(buffer, 0, count)
            onProgress(total)
        }
        output.toByteArray()
    }
}

internal fun formatBytes(bytes: Long): String = when {
    bytes < 1_024 -> "$bytes B"
    bytes < 1_048_576 -> "%.1f KB".format(bytes / 1_024.0)
    else -> "%.1f MB".format(bytes / 1_048_576.0)
}
