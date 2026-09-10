package com.claudewebui.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.claudewebui.app.data.local.dao.DraftDao
import com.claudewebui.app.data.local.dao.MessageDao
import com.claudewebui.app.data.local.dao.OutboxDao
import com.claudewebui.app.data.local.dao.SessionReadStateDao
import com.claudewebui.app.data.local.dao.SessionDao
import com.claudewebui.app.data.local.entity.DraftEntity
import com.claudewebui.app.data.local.entity.MessageEntity
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.local.entity.SessionEntity

/**
 * Main Room database for the Claude Code WebUI Android app.
 *
 * Bump [version] and provide a [androidx.room.migration.Migration] whenever
 * the schema changes. Every version step has a migration and there is no
 * destructive fallback: `message_outbox` holds user messages that have not
 * reached the server yet, and dropping the database to dodge a migration
 * would throw them away silently.
 */
@Database(
    entities = [
        SessionEntity::class,
        MessageEntity::class,
        DraftEntity::class,
        OutboxEntity::class,
        SessionReadStateEntity::class,
    ],
    version = 8,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun sessionDao(): SessionDao
    abstract fun messageDao(): MessageDao
    abstract fun draftDao(): DraftDao
    abstract fun outboxDao(): OutboxDao
    abstract fun sessionReadStateDao(): SessionReadStateDao

    companion object {
        const val DATABASE_NAME = "claude_webui.db"

        /** The first schema bump only cached the CLI model and reasoning effort. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE sessions ADD COLUMN cliModel TEXT")
                db.execSQL("ALTER TABLE sessions ADD COLUMN cliReasoning TEXT")
            }
        }

        /** Preserve the version-2 cache when adding durable media/session metadata. */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE sessions ADD COLUMN cliServiceTier TEXT")
                db.execSQL("ALTER TABLE sessions ADD COLUMN claudeSessionId TEXT")
                db.execSQL("ALTER TABLE messages ADD COLUMN media TEXT")
            }
        }

        /** Preserve existing cached conversations while introducing delivery state. */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE sessions ADD COLUMN unreadCount INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE messages ADD COLUMN clientMessageId TEXT")
                db.execSQL("ALTER TABLE messages ADD COLUMN eventSequence INTEGER")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS message_outbox (
                        clientMessageId TEXT NOT NULL PRIMARY KEY,
                        sessionId TEXT NOT NULL,
                        content TEXT NOT NULL,
                        attachmentsJson TEXT NOT NULL,
                        uploadIdsJson TEXT NOT NULL,
                        activeFollowupMode TEXT NOT NULL,
                        status TEXT NOT NULL,
                        progress REAL NOT NULL,
                        error TEXT,
                        retryable INTEGER NOT NULL,
                        createdAt INTEGER NOT NULL,
                        acceptedAt TEXT,
                        messageId TEXT,
                        disposition TEXT,
                        highWatermark INTEGER,
                        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_message_outbox_sessionId " +
                        "ON message_outbox(sessionId)"
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_message_outbox_sessionId_createdAt " +
                        "ON message_outbox(sessionId, createdAt)"
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS session_read_state (
                        sessionId TEXT NOT NULL PRIMARY KEY,
                        chatId TEXT,
                        lastReadMessageId TEXT,
                        lastSeenSequence INTEGER NOT NULL,
                        highWatermark INTEGER NOT NULL,
                        snapshotRevision INTEGER NOT NULL,
                        scrollAnchorMessageId TEXT,
                        scrollOffset INTEGER NOT NULL,
                        unreadCount INTEGER NOT NULL,
                        updatedAt TEXT,
                        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent()
                )
            }
        }

        /** Keep cached delivery/history data while making thread identity durable. */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE messages ADD COLUMN chatId TEXT")
                db.execSQL("ALTER TABLE message_outbox ADD COLUMN chatId TEXT")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_messages_sessionId_chatId_timestamp " +
                        "ON messages(sessionId, chatId, timestamp)"
                )
            }
        }

        /** Per-session presentation presets, cached so the sheet works offline. */
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE sessions ADD COLUMN designStyleSkill TEXT")
                db.execSQL("ALTER TABLE sessions ADD COLUMN writingStyleSkill TEXT")
            }
        }

        /**
         * Cache the server's runtime snapshot so the dashboard can tell a busy
         * session from an idle one without waiting for a REST round trip.
         */
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE sessions ADD COLUMN busy INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE sessions ADD COLUMN activitySummary TEXT")
                db.execSQL("ALTER TABLE sessions ADD COLUMN queueDepth INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE sessions ADD COLUMN pendingApprovals INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE sessions ADD COLUMN lastActivityAt TEXT")
            }
        }

        /** Retain legacy text while separating every subsequent thread's draft. */
        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE drafts_by_chat (
                        sessionId TEXT NOT NULL, content TEXT NOT NULL,
                        chatId TEXT NOT NULL, timestamp INTEGER NOT NULL,
                        PRIMARY KEY(sessionId, chatId),
                        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("""
                    INSERT INTO drafts_by_chat (sessionId, content, chatId, timestamp)
                    SELECT d.sessionId, d.content, COALESCE(r.chatId, ''), d.timestamp
                    FROM drafts d LEFT JOIN session_read_state r ON r.sessionId = d.sessionId
                """.trimIndent())
                db.execSQL("DROP TABLE drafts")
                db.execSQL("ALTER TABLE drafts_by_chat RENAME TO drafts")
                db.execSQL("CREATE INDEX index_drafts_sessionId ON drafts(sessionId)")
            }
        }

        /** Every migration, in order. [DatabaseModule] registers exactly this list. */
        val ALL_MIGRATIONS = arrayOf(
            MIGRATION_1_2,
            MIGRATION_2_3,
            MIGRATION_3_4,
            MIGRATION_4_5,
            MIGRATION_5_6,
            MIGRATION_6_7,
            MIGRATION_7_8,
        )
    }
}
