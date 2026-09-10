package com.claudewebui.app.data

import androidx.paging.PagingConfig
import androidx.paging.PagingSource
import androidx.paging.PagingState
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.core.network.api.MessagesApi
import com.claudewebui.app.core.network.api.MessagesApiImpl
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageHistorySnapshot
import com.claudewebui.app.data.model.MessagePageResponse
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.local.entity.toModel
import kotlinx.coroutines.CancellationException
import com.claudewebui.app.data.local.AppDatabase
import com.claudewebui.app.data.local.entity.MessageEntity
import com.claudewebui.app.data.local.entity.SessionEntity
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/** Exercises the generated Room PagingSource against a real in-memory SQLite DB. */
class MessagePagingTest {
    private lateinit var db: AppDatabase

    @Before fun createDatabase() {
        db = Room.inMemoryDatabaseBuilder(
            InstrumentationRegistry.getInstrumentation().targetContext,
            AppDatabase::class.java,
        ).build()
        runBlocking(Dispatchers.IO) {
            db.sessionDao().insertAll(listOf(session("one"), session("two")))
        }
    }

    @After fun closeDatabase() = db.close()

    @Test fun loadsBeyondTwoHundredWithStableOrderingAndThreadIsolation() = runBlocking(Dispatchers.IO) {
        val expected = (0 until 241).map { message(it) }
        db.messageDao().insertAll(expected.shuffled() + listOf(
            message(900, chatId = "sibling"),
            message(901, sessionId = "two"),
            message(902, chatId = null),
            message(903, chatId = ""),
        ))
        val source = db.messageDao().pageByChat("one", "main")
        val loaded = mutableListOf<MessageEntity>()
        var page = source.loadPage(PagingSource.LoadParams.Refresh(null, 150, false))
        loaded += page.data
        while (page.nextKey != null) {
            page = source.loadPage(PagingSource.LoadParams.Append(page.nextKey!!, 50, false))
            loaded += page.data
        }
        assertEquals(expected.last().id, db.messageDao().getLatest("one", "main", 1).single().id)
        assertEquals(241, loaded.size)
        assertEquals(241, loaded.map { it.id }.toSet().size)
        // Timestamp ties also test the sequence/id tie breakers across page boundaries.
        assertEquals(expected.asReversed().map { it.id }, loaded.map { it.id })
        assertTrue(loaded.all { it.sessionId == "one" && it.chatId == "main" })
        val legacy = db.messageDao().pageByChat("one", null)
            .loadPage(PagingSource.LoadParams.Refresh(null, 50, false))
        assertEquals(listOf(message(902, chatId = null).id), legacy.data.map { it.id })
    }

    @Test fun insertionInvalidatesSourceAndRefreshKeepsVisibleAnchorAndDurableReadPosition() = runBlocking(Dispatchers.IO) {
        db.messageDao().insertAll((0 until 241).map { message(it) })
        val source = db.messageDao().pageByChat("one", "main")
        val initial = source.loadPage(PagingSource.LoadParams.Refresh(null, 150, false))
        val anchorIndex = 100
        val anchor = initial.data[anchorIndex]
        db.sessionReadStateDao().upsert(
            SessionReadStateEntity(
                sessionId = "one", chatId = "main",
                scrollAnchorMessageId = anchor.id, scrollOffset = 27,
            )
        )
        val refreshKey = source.getRefreshKey(
            PagingState(
                pages = listOf(initial),
                anchorPosition = anchorIndex,
                config = PagingConfig(pageSize = 50, initialLoadSize = 150, enablePlaceholders = false),
                leadingPlaceholderCount = 0,
            )
        )
        val invalidated = CompletableDeferred<Unit>()
        source.registerInvalidatedCallback { invalidated.complete(Unit) }
        db.messageDao().insert(message(300))
        withTimeout(5_000) { invalidated.await() }
        assertTrue(source.invalid)
        val refreshed = db.messageDao().pageByChat("one", "main")
            .loadPage(PagingSource.LoadParams.Refresh(refreshKey, 150, false))
        assertTrue("Refresh must keep the message used as the scroll anchor", refreshed.data.any { it.id == anchor.id })
        val readState = db.sessionReadStateDao().get("one")!!
        assertEquals(anchor.id, readState.scrollAnchorMessageId)
        assertEquals(27, readState.scrollOffset)
    }

    @Test fun aroundWindowReplacementContainsSearchTargetAndInvalidatesOldPages() = runBlocking(Dispatchers.IO) {
        db.messageDao().insertAll((200 until 450).map { message(it) })
        val source = db.messageDao().pageByChat("one", "main")
        source.loadPage(PagingSource.LoadParams.Refresh(null, 150, false))
        val invalidated = CompletableDeferred<Unit>()
        source.registerInvalidatedCallback { invalidated.complete(Unit) }
        // A durable around response replaces the cached window, as the repository does.
        db.messageDao().deleteByChat("one", "main")
        db.messageDao().insertAll((60 until 140).map { message(it) })
        withTimeout(5_000) { invalidated.await() }
        val around = db.messageDao().pageByChat("one", "main")
            .loadPage(PagingSource.LoadParams.Refresh(null, 150, false))
        assertEquals(80, around.data.size)
        assertEquals(100, around.data.single { it.id == message(100).id }.content.toInt())
        assertTrue(around.data.none { it.content.toInt() >= 200 })
    }

    @Test fun supersededResponseCannotReplaceCacheEvenIfAcceptanceChangesDuringTransaction() = runBlocking(Dispatchers.IO) {
        val preserved = (60 until 140).map { message(it) }
        db.messageDao().insertAll(preserved)
        val http = ApiHttp()
        val messagesApi = object : MessagesApi by MessagesApiImpl(http) {
            override suspend fun getMessages(
                sessionId: String, limit: Int, before: String?, after: String?,
                around: String?, chatId: String?,
            ) = MessagePageResponse<Message>(
                success = true, data = (200 until 240).map { message(it).toModel() },
            )
        }
        val api = ApiClient(http = http, messages = messagesApi)
        val repository = MessageRepository(
            api, db.messageDao(), db.draftDao(), db.outboxDao(), db.sessionReadStateDao(), db,
        )
        try {
            // First reject before writes; then withdraw acceptance after writes
            // have begun to prove Room rolls back the entire replacement.
            for (rejectImmediately in listOf(true, false)) {
                var checks = 0
                try {
                    repository.fetchMessages("one", clearExisting = true, chatId = "main") {
                        !rejectImmediately && checks++ == 0
                    }
                    fail("A superseded response must cancel")
                } catch (_: CancellationException) {
                    val cached = db.messageDao().getByChatOnce("one", "main")
                    assertEquals(preserved.map { it.id }, cached.map { it.id })
                }
            }
        } finally {
            api.close()
        }
    }

    @Test fun staleReadPositionWriteCannotRegressTheAppliedReplayCursor() = runBlocking(Dispatchers.IO) {
        val api = ApiClient()
        val repository = MessageRepository(
            api, db.messageDao(), db.draftDao(), db.outboxDao(), db.sessionReadStateDao(), db,
        )
        try {
            val delayedScrollWrite = SessionReadStateEntity(
                sessionId = "one", lastSeenSequence = 7, highWatermark = 9, snapshotRevision = 2,
                scrollAnchorMessageId = "older-row", scrollOffset = 31,
            )
            repository.saveReadState(delayedScrollWrite.copy(
                lastSeenSequence = 19, highWatermark = 21, snapshotRevision = 5,
            ))
            repository.saveReadState(delayedScrollWrite)
            val stored = repository.cachedReadState("one")!!
            assertEquals(19L, stored.lastSeenSequence)
            assertEquals(21L, stored.highWatermark)
            assertEquals(5L, stored.snapshotRevision)
            assertEquals("older-row", stored.scrollAnchorMessageId)
            assertEquals(31, stored.scrollOffset)
        } finally {
            api.close()
        }
    }

    @Test fun mainHistoryUsesExplicitEmptyWireIdWhileBootstrapMayFollowServerActiveThread() = runBlocking(Dispatchers.IO) {
        val http = ApiHttp()
        val requestedIds = mutableListOf<String?>()
        val messagesApi = object : MessagesApi by MessagesApiImpl(http) {
            override suspend fun getMessages(
                sessionId: String, limit: Int, before: String?, after: String?,
                around: String?, chatId: String?,
            ): MessagePageResponse<Message> {
                requestedIds += chatId
                return MessagePageResponse(success = true, data = emptyList())
            }
        }
        val api = ApiClient(http = http, messages = messagesApi)
        val repository = MessageRepository(
            api, db.messageDao(), db.draftDao(), db.outboxDao(), db.sessionReadStateDao(), db,
        )
        try {
            repository.fetchMessages("one", chatId = null).getOrThrow()
            repository.fetchMessages("one", useServerActiveChat = true).getOrThrow()
            assertEquals(listOf("", null), requestedIds)
        } finally {
            api.close()
        }
    }

    @Test fun protocolUpgradeRewindsUnsafe102ToSnapshot99ThenAppliesPreviouslyMissing100() = runBlocking(Dispatchers.IO) {
        val http = ApiHttp()
        val confirmed = message(99).toModel().copy(eventSequence = 99L)
        val latestResponse = MessagePageResponse(
            success = true,
            data = listOf(confirmed),
            snapshot = MessageHistorySnapshot(chatId = "main", highWatermark = 99L, revision = 7L),
        )
        var response = latestResponse
        val messagesApi = object : MessagesApi by MessagesApiImpl(http) {
            override suspend fun getMessages(
                sessionId: String, limit: Int, before: String?, after: String?,
                around: String?, chatId: String?,
            ): MessagePageResponse<Message> = response
        }
        val api = ApiClient(http = http, messages = messagesApi)
        val repository = MessageRepository(
            api, db.messageDao(), db.draftDao(), db.outboxDao(), db.sessionReadStateDao(), db,
        )
        val legacy = SessionReadStateEntity(
            sessionId = "one", chatId = "main", lastSeenSequence = 102L,
            highWatermark = 102L, snapshotRevision = 8L,
        )
        db.sessionReadStateDao().upsert(legacy)
        db.messageDao().insert(message(102).copy(eventSequence = 102L))
        try {
            // Neither an around/older page nor a failed latest fetch verifies v2.
            for (around in listOf(false, true)) {
                val page = repository.fetchMessages(
                    "one", clearExisting = true, chatId = "main", resetReplayCursor = true,
                    before = if (around) null else "older", around = if (around) "target" else null,
                ).getOrThrow()
                assertFalse(page.replayCursorReset)
                assertEquals(102L, repository.cachedReadState("one")!!.lastSeenSequence)
            }
            response = latestResponse.copy(success = false)
            assertTrue(repository.fetchMessages(
                "one", clearExisting = true, chatId = "main", resetReplayCursor = true,
            ).isFailure)
            assertEquals(102L, repository.cachedReadState("one")!!.lastSeenSequence)
            response = latestResponse.copy(snapshot = null)
            assertFalse(repository.fetchMessages(
                "one", clearExisting = true, chatId = "main", resetReplayCursor = true,
            ).getOrThrow().replayCursorReset)
            assertEquals(102L, repository.cachedReadState("one")!!.lastSeenSequence)
            response = latestResponse
            for (rejectImmediately in listOf(true, false)) {
                var checks = 0
                try {
                    repository.fetchMessages(
                        "one", clearExisting = true, chatId = "main", resetReplayCursor = true,
                    ) { !rejectImmediately && checks++ == 0 }
                    fail("A superseded latest response must not verify the cursor")
                } catch (_: CancellationException) {
                    assertEquals(102L, repository.cachedReadState("one")!!.lastSeenSequence)
                }
            }

            val verified = repository.fetchMessages(
                "one", clearExisting = true, chatId = "main", resetReplayCursor = true,
            ).getOrThrow()
            assertTrue(verified.replayCursorReset)
            assertEquals(99L, repository.cachedReadState("one")!!.lastSeenSequence)
            assertEquals(99L, repository.cachedReadState("one")!!.highWatermark)
            // A read receipt started before the upgrade cannot restore 102 later.
            repository.saveReadState(legacy.copy(scrollOffset = 42))
            assertEquals(99L, repository.cachedReadState("one")!!.lastSeenSequence)

            val previouslyMissing = message(100).toModel().copy(eventSequence = 100L)
            assertTrue(previouslyMissing.eventSequence!! > repository.cachedReadState("one")!!.lastSeenSequence)
            repository.cacheMessage(previouslyMissing, "main")
            repository.advanceAppliedSequence("one", 100L)
            assertEquals(100L, repository.cachedReadState("one")!!.lastSeenSequence)
            assertTrue(db.messageDao().getByChatOnce("one", "main").any { it.id == previouslyMissing.id })
            repository.advanceAppliedSequence("one", 98L)
            assertEquals(100L, repository.cachedReadState("one")!!.lastSeenSequence)
        } finally {
            api.close()
        }
    }

    private suspend fun PagingSource<Int, MessageEntity>.loadPage(
        params: PagingSource.LoadParams<Int>,
    ): PagingSource.LoadResult.Page<Int, MessageEntity> =
        when (val result = load(params)) {
            is PagingSource.LoadResult.Page -> result
            is PagingSource.LoadResult.Error -> throw AssertionError("Room paging failed", result.throwable)
            is PagingSource.LoadResult.Invalid -> throw AssertionError("Unexpected invalid source")
        }

    private fun session(id: String) = SessionEntity(
        id = id, title = id, provider = "CODEX", status = "IDLE",
        workingDirectory = "/workspace", createdAt = "2026-09-06T00:00:00Z",
        updatedAt = "2026-09-06T00:00:00Z",
    )

    private fun message(index: Int, sessionId: String = "one", chatId: String? = "main") = MessageEntity(
        id = "$sessionId-${chatId ?: "legacy"}-${index.toString().padStart(4, '0')}",
        sessionId = sessionId, chatId = chatId, role = "ASSISTANT", content = index.toString(),
        timestamp = "2026-09-06T00:00:00Z", isUser = false, eventSequence = (index / 2).toLong(),
    )
}
