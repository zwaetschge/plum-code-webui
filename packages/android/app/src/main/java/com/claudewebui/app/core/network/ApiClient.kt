package com.claudewebui.app.core.network

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
import io.ktor.client.statement.*

/**
 * The REST facade for the Plum Code WebUI backend.
 *
 * The transport lives in [ApiHttp]; the endpoints live in one feature API per
 * backend area under `core.network.api`. This class only composes them, so a
 * repository or ViewModel keeps calling `api.getSessions()` exactly as before
 * while each feature can be read, tested and replaced on its own.
 *
 * Defaults for optional parameters are declared on the interfaces (Kotlin
 * forbids them on overrides), which is what keeps the delegated call sites
 * source-compatible.
 */
class ApiClient(
    private val http: ApiHttp = ApiHttp(),
    auth: AuthApi = AuthApiImpl(http),
    sessions: SessionsApi = SessionsApiImpl(http),
    messages: MessagesApi = MessagesApiImpl(http),
    permissions: PermissionsApi = PermissionsApiImpl(http),
    gateway: GatewayApi = GatewayApiImpl(http),
    files: FilesApi = FilesApiImpl(http),
    notes: NotesApi = NotesApiImpl(http),
    git: GitApi = GitApiImpl(http),
    gitHub: GitHubApi = GitHubApiImpl(http),
    settings: SettingsApi = SettingsApiImpl(http),
    categories: CategoriesApi = CategoriesApiImpl(http),
    checkpoints: CheckpointsApi = CheckpointsApiImpl(http),
    providers: ProvidersApi = ProvidersApiImpl(http),
    mcpServers: McpServersApi = McpServersApiImpl(http),
    agents: AgentsApi = AgentsApiImpl(http),
    configLibrary: ConfigLibraryApi = ConfigLibraryApiImpl(http),
    analytics: AnalyticsApi = AnalyticsApiImpl(http),
    app: AppApi = AppApiImpl(http),
    memory: MemoryApi = MemoryApiImpl(http),
    integrations: IntegrationsApi = IntegrationsApiImpl(http),
    operations: OperationsApi = OperationsApiImpl(http),
    preview: PreviewApi = PreviewApiImpl(http),
    oracleBrowser: OracleBrowserApi = OracleBrowserApiImpl(http),
    androidDevices: AndroidDevicesApi = AndroidDevicesApiImpl(http),
    workspace: WorkspaceApi = WorkspaceApiImpl(http),
) : AuthApi by auth,
    SessionsApi by sessions,
    MessagesApi by messages,
    PermissionsApi by permissions,
    GatewayApi by gateway,
    FilesApi by files,
    NotesApi by notes,
    GitApi by git,
    GitHubApi by gitHub,
    SettingsApi by settings,
    CategoriesApi by categories,
    CheckpointsApi by checkpoints,
    ProvidersApi by providers,
    McpServersApi by mcpServers,
    AgentsApi by agents,
    ConfigLibraryApi by configLibrary,
    AnalyticsApi by analytics,
    AppApi by app,
    MemoryApi by memory,
    IntegrationsApi by integrations,
    OperationsApi by operations,
    PreviewApi by preview,
    OracleBrowserApi by oracleBrowser,
    AndroidDevicesApi by androidDevices,
    WorkspaceApi by workspace {

    /** The server origin every request is built on, resolved from [com.claudewebui.app.core.security.TokenStore]. */
    val baseUrl: String
        get() = http.baseUrl

    // ========================================================================
    // Health
    // ========================================================================

    /** GET /health */
    suspend fun health(): HttpResponse =
        http.rawGet("/health")

    // ========================================================================
    // Lifecycle
    // ========================================================================

    fun close() {
        http.close()
    }
}
