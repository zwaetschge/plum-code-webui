package com.claudewebui.app.ui.screens.chat

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttpException
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.model.CreateChatUploadInput
import com.claudewebui.app.data.model.FileAttachmentData
import com.claudewebui.app.data.repository.MessageRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** What a delivery carries once its files are on the server. */
internal data class PreparedDelivery(
    val uploadIds: List<String>,
    val legacyAttachments: List<FileAttachmentData>,
)

/**
 * Stages an outbox item's attachments as chunked uploads.
 *
 * Extracted from the chat's send controller so the monitor grid can send
 * files through exactly the same path — resumable chunks, the same size
 * limits, and the same base64 fallback for servers without staged uploads —
 * instead of growing a second, lesser implementation.
 */
internal class OutboxUploader(
    private val appContext: Context,
    private val api: ApiClient,
    private val messageRepository: MessageRepository,
) {
    suspend fun prepare(
        sessionId: String,
        item: OutboxEntity,
        onProgress: (Float) -> Unit = {},
    ): PreparedDelivery = withContext(Dispatchers.IO) {
        if (item.attachments.isEmpty()) return@withContext PreparedDelivery(emptyList(), emptyList())
        val staged = mutableListOf<java.io.File>()
        var totalBytes = 0L
        try {
        // Bounded heap: spool each URI to private disk, then upload bounded chunks.
        for (attachment in item.attachments) {
            val file = java.io.File.createTempFile("plum-upload-", ".part", appContext.cacheDir)
            staged += file
            val remaining = minOf(MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES - totalBytes)
            var copied = 0L
            appContext.contentResolver.openInputStream(Uri.parse(attachment.uri)).use { input ->
                requireNotNull(input)
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        copied += count
                        require(copied <= remaining) { appContext.getString(R.string.chat_attachment_limit, MAX_ATTACHMENT_COUNT, formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)) }
                        output.write(buffer, 0, count)
                    }
                }
            }
            totalBytes += copied
        }

        var updatedAttachments = item.attachments
        val uploadIds = mutableListOf<String>()
        try {
            item.attachments.forEachIndexed { attachmentIndex, original ->
                val file = staged[attachmentIndex]
                val byteSize = file.length().toInt()
                var upload = original.uploadId?.let { id ->
                    runCatching { api.getChatUpload(sessionId, id) }.getOrNull()?.data
                }
                if (upload == null || upload.status == "cancelled" || upload.status == "failed") {
                    val response = api.createChatUpload(
                        sessionId,
                        CreateChatUploadInput(
                            filename = original.filename,
                            mimeType = original.mimeType,
                            byteSize = byteSize.toLong(),
                            sha256 = fileSha256(file),
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
                    val range = chunkByteRange(chunkIndex, initial.chunkSize, byteSize) ?: continue
                    val start = range.first
                    val end = range.last + 1
                    val response = api.putChatUploadChunk(
                        sessionId = sessionId,
                        uploadId = initial.id,
                        index = chunkIndex,
                        bytes = java.io.RandomAccessFile(file, "r").use { reader ->
                            reader.seek(start.toLong()); ByteArray(end - start).also { reader.readFully(it) }
                        },
                        byteOffset = start.toLong(),
                        totalBytes = byteSize.toLong(),
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
                    onProgress(overallProgress)
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
                        data = Base64.encodeToString(staged[index].readBytes(), Base64.NO_WRAP),
                        mimeType = attachment.mimeType,
                        filename = attachment.filename,
                    )
                },
            )
        }
        } finally { staged.forEach { it.delete() } }
    }

    private fun fileSha256(file: java.io.File): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
