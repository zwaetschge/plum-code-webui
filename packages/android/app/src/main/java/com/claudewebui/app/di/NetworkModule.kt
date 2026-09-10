package com.claudewebui.app.di

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.core.network.api.AgentsApi
import com.claudewebui.app.core.network.api.AgentsApiImpl
import com.claudewebui.app.core.network.api.AnalyticsApi
import com.claudewebui.app.core.network.api.AnalyticsApiImpl
import com.claudewebui.app.core.network.api.AndroidDevicesApi
import com.claudewebui.app.core.network.api.AndroidDevicesApiImpl
import com.claudewebui.app.core.network.api.AppApi
import com.claudewebui.app.core.network.api.AppApiImpl
import com.claudewebui.app.core.network.api.AuthApi
import com.claudewebui.app.core.network.api.AuthApiImpl
import com.claudewebui.app.core.network.api.CategoriesApi
import com.claudewebui.app.core.network.api.CategoriesApiImpl
import com.claudewebui.app.core.network.api.CheckpointsApi
import com.claudewebui.app.core.network.api.CheckpointsApiImpl
import com.claudewebui.app.core.network.api.ConfigLibraryApi
import com.claudewebui.app.core.network.api.ConfigLibraryApiImpl
import com.claudewebui.app.core.network.api.FilesApi
import com.claudewebui.app.core.network.api.FilesApiImpl
import com.claudewebui.app.core.network.api.GatewayApi
import com.claudewebui.app.core.network.api.GatewayApiImpl
import com.claudewebui.app.core.network.api.GitApi
import com.claudewebui.app.core.network.api.GitApiImpl
import com.claudewebui.app.core.network.api.GitHubApi
import com.claudewebui.app.core.network.api.GitHubApiImpl
import com.claudewebui.app.core.network.api.IntegrationsApi
import com.claudewebui.app.core.network.api.IntegrationsApiImpl
import com.claudewebui.app.core.network.api.McpServersApi
import com.claudewebui.app.core.network.api.McpServersApiImpl
import com.claudewebui.app.core.network.api.MemoryApi
import com.claudewebui.app.core.network.api.MemoryApiImpl
import com.claudewebui.app.core.network.api.MessagesApi
import com.claudewebui.app.core.network.api.MessagesApiImpl
import com.claudewebui.app.core.network.api.NotesApi
import com.claudewebui.app.core.network.api.NotesApiImpl
import com.claudewebui.app.core.network.api.OperationsApi
import com.claudewebui.app.core.network.api.OperationsApiImpl
import com.claudewebui.app.core.network.api.OracleBrowserApi
import com.claudewebui.app.core.network.api.OracleBrowserApiImpl
import com.claudewebui.app.core.network.api.PermissionsApi
import com.claudewebui.app.core.network.api.PermissionsApiImpl
import com.claudewebui.app.core.network.api.PreviewApi
import com.claudewebui.app.core.network.api.PreviewApiImpl
import com.claudewebui.app.core.network.api.ProvidersApi
import com.claudewebui.app.core.network.api.ProvidersApiImpl
import com.claudewebui.app.core.network.api.SessionsApi
import com.claudewebui.app.core.network.api.SessionsApiImpl
import com.claudewebui.app.core.network.api.SettingsApi
import com.claudewebui.app.core.network.api.SettingsApiImpl
import com.claudewebui.app.core.network.api.WorkspaceApi
import com.claudewebui.app.core.network.api.WorkspaceApiImpl
import org.koin.dsl.module

val networkModule = module {

    /**
     * The one Ktor client (OkHttp engine, JSON, bearer injection) every feature
     * API shares. It reads the server URL from TokenStore on each request.
     */
    single { ApiHttp() }

    // One implementation per backend area. Repositories keep injecting
    // [ApiClient]; these bindings exist so a feature API can also be injected
    // or replaced on its own.
    single<AuthApi> { AuthApiImpl(get()) }
    single<SessionsApi> { SessionsApiImpl(get()) }
    single<MessagesApi> { MessagesApiImpl(get()) }
    single<PermissionsApi> { PermissionsApiImpl(get()) }
    single<GatewayApi> { GatewayApiImpl(get()) }
    single<FilesApi> { FilesApiImpl(get()) }
    single<NotesApi> { NotesApiImpl(get()) }
    single<GitApi> { GitApiImpl(get()) }
    single<GitHubApi> { GitHubApiImpl(get()) }
    single<SettingsApi> { SettingsApiImpl(get()) }
    single<CategoriesApi> { CategoriesApiImpl(get()) }
    single<CheckpointsApi> { CheckpointsApiImpl(get()) }
    single<ProvidersApi> { ProvidersApiImpl(get()) }
    single<McpServersApi> { McpServersApiImpl(get()) }
    single<AgentsApi> { AgentsApiImpl(get()) }
    single<ConfigLibraryApi> { ConfigLibraryApiImpl(get()) }
    single<AnalyticsApi> { AnalyticsApiImpl(get()) }
    single<AppApi> { AppApiImpl(get()) }
    single<MemoryApi> { MemoryApiImpl(get()) }
    single<IntegrationsApi> { IntegrationsApiImpl(get()) }
    single<OperationsApi> { OperationsApiImpl(get()) }
    single<PreviewApi> { PreviewApiImpl(get()) }
    single<OracleBrowserApi> { OracleBrowserApiImpl(get()) }
    single<AndroidDevicesApi> { AndroidDevicesApiImpl(get()) }
    single<WorkspaceApi> { WorkspaceApiImpl(get()) }

    /**
     * The facade every repository and ViewModel injects. Composed from the
     * bindings above so the whole graph shares one HTTP client.
     */
    single {
        ApiClient(
            http = get(),
            auth = get(),
            sessions = get(),
            messages = get(),
            permissions = get(),
            gateway = get(),
            files = get(),
            notes = get(),
            git = get(),
            gitHub = get(),
            settings = get(),
            categories = get(),
            checkpoints = get(),
            providers = get(),
            mcpServers = get(),
            agents = get(),
            configLibrary = get(),
            analytics = get(),
            app = get(),
            memory = get(),
            integrations = get(),
            operations = get(),
            preview = get(),
            oracleBrowser = get(),
            androidDevices = get(),
            workspace = get(),
        )
    }

    /**
     * Single WebSocket manager for real-time session streaming.
     * SocketManager reads the server URL from TokenStore internally.
     */
    single { SocketManager() }
}
