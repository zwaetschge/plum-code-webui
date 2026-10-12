package com.claudewebui.app.data

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttpException
import com.claudewebui.app.core.security.TokenStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

@Serializable
data class AssistantPendingCommand(
    val id: String,
    val path: String,
    val payload: JsonObject,
    val label: String,
    val createdAt: Long,
    val expiresAt: Long? = null,
)

/** Commands stay in the existing encrypted, backup-excluded account store until
 * confirmed or explicitly discarded. Opening the screen never sends them. */
class AssistantApiOutbox(private val api: ApiClient, private val owner: String) {
    companion object {
        private val mutex = Mutex()
        private val json = Json { ignoreUnknownKeys = true }
    }

    private fun checkOwner() {
        if (owner != TokenStore.assistantOwnerKey()) throw CancellationException("Assistant account changed")
    }

    private fun read(): List<AssistantPendingCommand> {
        checkOwner()
        val stored = TokenStore.readAssistantOutbox(owner)
        val all = if (stored.isNullOrBlank()) emptyList() else json.decodeFromString<List<AssistantPendingCommand>>(stored)
        val valid = all.filter { it.expiresAt == null || it.expiresAt > System.currentTimeMillis() }
        if (valid.size != all.size) write(valid)
        return valid
    }

    private fun write(entries: List<AssistantPendingCommand>) {
        checkOwner()
        TokenStore.writeAssistantOutbox(owner, json.encodeToString(entries))
    }

    suspend fun pending(): List<AssistantPendingCommand> = mutex.withLock { read() }

    suspend fun discard(id: String) = mutex.withLock { write(read().filterNot { it.id == id }) }

    suspend fun send(path: String, input: JsonObject, label: String, expiresAt: String? = null): JsonObject = mutex.withLock {
        checkOwner()
        val all = read()
        // A second press reuses the stored identifier; a different action on an
        // unresolved endpoint requires reviewing/discarding the original first.
        val previous = all.firstOrNull { it.path == path }
        val content = JsonObject(input.filterKeys { it != "commandId" })
        require(previous == null || JsonObject(previous.payload.filterKeys { it != "commandId" }) == content) {
            "Review the pending delivery first"
        }
        require(all.size < 12 || previous != null) { "Review pending deliveries first" }
        val command = previous ?: UUID.randomUUID().toString().let { id ->
            AssistantPendingCommand(id, path, JsonObject(content + ("commandId" to JsonPrimitive(id))), label,
                System.currentTimeMillis(), expiresAt?.let { Instant.parse(it).toEpochMilli() })
        }
        require(command.expiresAt == null || command.expiresAt > System.currentTimeMillis()) { "Temporary conversation expired" }
        if (previous == null) write(all + command)
        deliver(command)
    }

    suspend fun retry(id: String): JsonObject = mutex.withLock {
        val command = read().firstOrNull { it.id == id } ?: error("Pending delivery no longer available")
        deliver(command)
    }

    private suspend fun deliver(command: AssistantPendingCommand): JsonObject {
        checkOwner()
        try {
            val response = api.deliverAssistantApiCommand(owner, command.path, command.payload)
            checkOwner()
            // An incomplete success envelope is also an unknown delivery. Keep
            // its original identifier so a later explicit retry is idempotent.
            check(response.success && (response.data != null || command.path.endsWith("/stop"))) { response.error?.message ?: "Delivery unconfirmed" }
            write(read().filterNot { it.id == command.id })
            return response.data ?: JsonObject(emptyMap())
        } catch (failure: ApiHttpException) {
            if (failure.status in 400..499 && failure.status !in listOf(408, 429)) {
                checkOwner()
                write(read().filterNot { it.id == command.id })
            }
            throw failure
        }
    }
}
