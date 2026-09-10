package com.claudewebui.app.di

import com.claudewebui.app.data.repository.AuthRepository
import com.claudewebui.app.data.repository.GatewayRepository
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.data.repository.NoteRepository
import com.claudewebui.app.data.repository.SettingsRepository
import com.claudewebui.app.ui.screens.activity.ActivityViewModel
import com.claudewebui.app.ui.screens.analytics.AnalyticsViewModel
import com.claudewebui.app.ui.screens.auth.LoginViewModel
import com.claudewebui.app.ui.screens.chat.ChatViewModel
import com.claudewebui.app.ui.screens.filemanager.FileEditorViewModel
import com.claudewebui.app.ui.screens.notes.NotesViewModel
import com.claudewebui.app.ui.screens.chat.CheckpointViewModel
import com.claudewebui.app.ui.screens.chat.GitViewModel
import com.claudewebui.app.ui.screens.chat.UsageViewModel
import com.claudewebui.app.ui.screens.dashboard.DashboardViewModel
import com.claudewebui.app.ui.screens.filemanager.FileManagerViewModel
import com.claudewebui.app.ui.screens.devtools.DevToolsViewModel
import com.claudewebui.app.ui.screens.memory.MemoryViewModel
import com.claudewebui.app.ui.screens.operations.OperationsViewModel
import com.claudewebui.app.ui.screens.settings.IntegrationsViewModel
import com.claudewebui.app.ui.screens.settings.SettingsViewModel
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

val viewModelModule = module {

    // --- Repositories ---

    single { AuthRepository(get(), get()) }

    single { SessionRepository(get(), get(), get()) }

    // Cross-session supervision: one overview call instead of a per-session
    // permission fan-out.
    single { GatewayRepository(get(), get()) }

    single { MessageRepository(get(), get(), get(), get(), get(), get()) }

    single { SettingsRepository(get()) }

    single { NoteRepository(get()) }

    // --- ViewModels ---

    // LoginViewModel(apiClient, context)
    viewModel { LoginViewModel(get(), androidContext()) }

    // DashboardViewModel(apiClient, sessionRepository, gatewayRepository)
    viewModel { DashboardViewModel(get(), get(), get(), androidContext()) }

    // ChatViewModel(sessionId, messageRepository, sessionRepository, settingsRepository, socketManager, apiClient, context)
    viewModel { (sessionId: String) ->
        ChatViewModel(sessionId, get(), get(), get(), get(), get(), androidContext())
    }

    // SettingsViewModel(settingsRepository, authRepository, context)
    viewModel { SettingsViewModel(get(), get(), androidContext()) }

    // NotesViewModel(sessionId, noteRepository)
    viewModel { (sessionId: String) -> NotesViewModel(sessionId, get()) }

    // FileEditorViewModel(path, apiClient)
    viewModel { (path: String) -> FileEditorViewModel(path, get()) }

    // FileManagerViewModel(sessionId, initialPath) — uses KoinComponent internally for ApiClient
    viewModel { (sessionId: String, initialPath: String) ->
        FileManagerViewModel(sessionId, initialPath)
    }

    // AnalyticsViewModel(apiClient)
    viewModel { AnalyticsViewModel(get()) }
    viewModel { ActivityViewModel(get(), get()) }

    // CheckpointViewModel(sessionId, apiClient)
    viewModel { (sessionId: String) -> CheckpointViewModel(sessionId, get(), get()) }

    // GitViewModel(sessionId, apiClient, sessionRepository)
    viewModel { (sessionId: String) -> GitViewModel(sessionId, get(), get(), get()) }

    // UsageViewModel(sessionId, apiClient)
    viewModel { (sessionId: String) -> UsageViewModel(sessionId, get(), get()) }

    // MemoryViewModel(workingDirectory, apiClient)
    viewModel { (workingDirectory: String) -> MemoryViewModel(workingDirectory, get()) }

    // DevToolsViewModel(sessionId, workingDirectory, apiClient)
    viewModel { (sessionId: String, workingDirectory: String) ->
        DevToolsViewModel(sessionId, workingDirectory, get())
    }

    // OperationsViewModel(apiClient)
    viewModel { OperationsViewModel(get()) }

    // IntegrationsViewModel(apiClient)
    viewModel { IntegrationsViewModel(get()) }
}
