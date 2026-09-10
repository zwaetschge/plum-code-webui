package com.claudewebui.app.di

import androidx.room.Room
import com.claudewebui.app.data.local.AppDatabase
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

val databaseModule = module {

    /**
     * Room database — single instance for the lifetime of the app.
     * Stored on internal storage; encrypted via SQLCipher could be added later.
     */
    single {
        Room.databaseBuilder(
            androidContext(),
            AppDatabase::class.java,
            AppDatabase.DATABASE_NAME
        )
            // No destructive fallback. The outbox in this database holds messages
            // the user typed and the server has not acknowledged, so wiping it to
            // survive a version jump would delete their work without a word.
            .addMigrations(*AppDatabase.ALL_MIGRATIONS)
            .build()
    }

    // --- DAOs ---

    single { get<AppDatabase>().sessionDao() }

    single { get<AppDatabase>().messageDao() }

    single { get<AppDatabase>().draftDao() }

    single { get<AppDatabase>().outboxDao() }

    single { get<AppDatabase>().sessionReadStateDao() }
}
