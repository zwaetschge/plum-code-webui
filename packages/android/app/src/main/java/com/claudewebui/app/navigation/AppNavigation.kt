package com.claudewebui.app.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.core.deeplink.DeepLinkDestination
import com.claudewebui.app.core.deeplink.DeepLinkHandler
import com.claudewebui.app.core.security.AuthEvents
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.ui.screens.analytics.AnalyticsScreen
import com.claudewebui.app.ui.screens.activity.ActivityScreen
import com.claudewebui.app.ui.screens.auth.LoginScreen
import com.claudewebui.app.ui.screens.auth.ServerSetupScreen
import com.claudewebui.app.ui.screens.chat.ChatScreen
import com.claudewebui.app.ui.screens.chat.CheckpointScreen
import com.claudewebui.app.ui.screens.chat.CheckpointViewModel
import com.claudewebui.app.ui.screens.chat.GitScreen
import com.claudewebui.app.ui.screens.chat.GitViewModel
import com.claudewebui.app.ui.screens.chat.UsageScreen
import com.claudewebui.app.ui.screens.chat.UsageViewModel
import com.claudewebui.app.ui.components.common.WindowWidth
import com.claudewebui.app.ui.components.common.rememberWindowWidth
import com.claudewebui.app.ui.screens.dashboard.AreaWorkspace
import com.claudewebui.app.ui.screens.dashboard.AreaWorkspaceHandoff
import com.claudewebui.app.ui.components.common.isShortWindow
import com.claudewebui.app.ui.screens.monitor.MonitorScreen
import com.claudewebui.app.ui.theme.LayoutPrefs
import com.claudewebui.app.ui.screens.filemanager.FileManagerScreen
import com.claudewebui.app.ui.screens.library.LibraryScreen
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.screens.settings.AgentsScreen
import com.claudewebui.app.ui.screens.settings.CliToolsScreen
import com.claudewebui.app.ui.screens.filemanager.FileEditorScreen
import com.claudewebui.app.ui.screens.notes.NotesScreen
import com.claudewebui.app.ui.screens.settings.IntegrationsScreen
import com.claudewebui.app.ui.screens.settings.ConnectionsScreen
import com.claudewebui.app.ui.screens.operations.OperationsScreen
import com.claudewebui.app.ui.screens.devtools.DevToolsScreen
import com.claudewebui.app.ui.screens.memory.MemoryScreen
import com.claudewebui.app.ui.screens.settings.CliProviderDetailScreen
import com.claudewebui.app.ui.screens.settings.McpSettingsScreen
import com.claudewebui.app.ui.screens.settings.PermissionsScreen
import com.claudewebui.app.ui.screens.settings.SettingsScreen
import com.claudewebui.app.ui.theme.LocalReduceMotion
import org.koin.compose.viewmodel.koinViewModel
import org.koin.compose.koinInject
import org.koin.core.parameter.parametersOf

// Material 3 Expressive motion: emphasized easing instead of linear tweens.
// Spec values from the M3 motion tokens (emphasized decelerate/accelerate).
private const val ENTER_DURATION = 450
private const val EXIT_DURATION = 350
private val EmphasizedDecelerate = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
private val EmphasizedAccelerate = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)

// Bottom-nav tabs are siblings — they cross-fade instead of pushing
// horizontally like a drill-down.
private val TAB_ROUTES = setOf("dashboard", "activity", "analytics", "library", "settings")

private fun AnimatedContentTransitionScope<NavBackStackEntry>.isTabSwitch(): Boolean =
    initialState.destination.route?.substringBefore('?') in TAB_ROUTES &&
        targetState.destination.route?.substringBefore('?') in TAB_ROUTES

private fun enterSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    if (isTabSwitch()) {
        fadeIn(animationSpec = tween(220, easing = LinearOutSlowInEasing)) +
            scaleIn(initialScale = 0.96f, animationSpec = tween(220, easing = EmphasizedDecelerate))
    } else {
        slideInHorizontally(
            initialOffsetX = { fullWidth -> fullWidth },
            animationSpec = tween(ENTER_DURATION, easing = EmphasizedDecelerate)
        ) + fadeIn(animationSpec = tween(ENTER_DURATION / 2))
    }
}

private fun exitSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    if (isTabSwitch()) {
        fadeOut(animationSpec = tween(180))
    } else {
        slideOutHorizontally(
            targetOffsetX = { fullWidth -> -fullWidth / 4 },
            animationSpec = tween(EXIT_DURATION, easing = EmphasizedAccelerate)
        ) + fadeOut(animationSpec = tween(EXIT_DURATION))
    }
}

private fun popEnterSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    if (isTabSwitch()) {
        fadeIn(animationSpec = tween(220, easing = LinearOutSlowInEasing)) +
            scaleIn(initialScale = 0.96f, animationSpec = tween(220, easing = EmphasizedDecelerate))
    } else {
        slideInHorizontally(
            initialOffsetX = { fullWidth -> -fullWidth / 4 },
            animationSpec = tween(ENTER_DURATION, easing = EmphasizedDecelerate)
        ) + fadeIn(animationSpec = tween(ENTER_DURATION / 2))
    }
}

private fun popExitSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    if (isTabSwitch()) {
        fadeOut(animationSpec = tween(180))
    } else {
        slideOutHorizontally(
            targetOffsetX = { fullWidth -> fullWidth },
            animationSpec = tween(EXIT_DURATION, easing = EmphasizedAccelerate)
        ) + fadeOut(animationSpec = tween(EXIT_DURATION))
    }
}

/**
 * Whether the workspace uses two columns: from 600dp wide (unfolded Fold,
 * tablets), unless the window is short — a landscape phone or the Fold's cover
 * screen on its side has the width but not the height for two columns. The
 * setting can force either layout.
 */
@Composable
private fun rememberTwoPane(): Boolean {
    val option by LayoutPrefs.twoPane.collectAsState()
    return LayoutPrefs.shouldUseTwoPane(
        option,
        rememberWindowWidth() != WindowWidth.COMPACT && !isShortWindow(),
    )
}

@Composable
fun AppNavigation(
    navController: NavHostController = rememberNavController(),
    deepLinkUri: String? = null
) {
    val socketManager = koinInject<SocketManager>()
    val reduceMotion = LocalReduceMotion.current
    val isAnalyticsPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview-analytics"
    val startDestination = remember(deepLinkUri) {
        val isDesignPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview"
        val isChatPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview-chat"
        val isMonitorPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview-monitor"
        val isDynamicUiPreview = BuildConfig.DEBUG && deepLinkUri?.startsWith("claudewebui://preview-dynui") == true
        val isChatModelsPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview-chatmodels"
        val isVoicePreview = BuildConfig.DEBUG && deepLinkUri?.startsWith("claudewebui://preview-voice") == true
        val isWidgetPreview = BuildConfig.DEBUG && deepLinkUri?.startsWith("claudewebui://preview-widgets") == true
        val isSubagentsPreview = BuildConfig.DEBUG && deepLinkUri?.startsWith("claudewebui://preview-subagents") == true
        when {
            isSubagentsPreview -> SUBAGENTS_PREVIEW_ROUTE
            isWidgetPreview -> WIDGET_PREVIEW_ROUTE
            isVoicePreview -> VOICE_PREVIEW_ROUTE
            isDynamicUiPreview -> DYNAMIC_UI_PREVIEW_ROUTE
            isChatModelsPreview -> CHAT_MODELS_PREVIEW_ROUTE
            isMonitorPreview -> MONITOR_PREVIEW_ROUTE
            isChatPreview -> Routes.Chat.createRoute("preview")
            isAnalyticsPreview -> Routes.Analytics.route
            TokenStore.isLoggedIn || isDesignPreview -> Routes.Dashboard.route
            else -> Routes.Login.route
        }
    }

    LaunchedEffect(Unit) {
        if (TokenStore.isLoggedIn) socketManager.connect()
    }

    // An expired token used to leave the app sitting on cached data forever.
    // Debug design previews run without a login, so their 401s are expected
    // and must not bounce the fixture screen to the login page.
    val isDesignPreviewLink = BuildConfig.DEBUG && deepLinkUri?.startsWith("claudewebui://preview") == true
    LaunchedEffect(Unit) {
        AuthEvents.sessionExpired.collect {
            if (isDesignPreviewLink && !TokenStore.isLoggedIn) {
                AuthEvents.consume()
                return@collect
            }
            socketManager.disconnect()
            AuthEvents.consume()
            navController.navigate(Routes.Login.route) {
                popUpTo(0) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    // Warm-start deep links: onNewIntent only updates the state — without this
    // a widget/notification tap while the app is already running went nowhere.
    LaunchedEffect(deepLinkUri) {
        val raw = deepLinkUri ?: return@LaunchedEffect
        if (!TokenStore.isLoggedIn) return@LaunchedEffect
        when (val dest = DeepLinkHandler.resolve(android.net.Uri.parse(raw))) {
            is DeepLinkDestination.Session ->
                navController.navigate(Routes.Chat.createRoute(dest.sessionId)) {
                    launchSingleTop = true
                }
            is DeepLinkDestination.Analytics ->
                navController.navigate(
                    Routes.Analytics.route + (dest.range?.let { "?range=$it" } ?: "")
                ) {
                    launchSingleTop = true
                }
            else -> Unit
        }
    }

    // Shared across the settings screens: a per-destination instance would
    // refetch everything on each navigation and render its empty state first,
    // which reads as "not configured" rather than "loading".
    val settingsViewModel =
        koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()

    NavHost(
        navController = navController,
        startDestination = startDestination,
        enterTransition = if (reduceMotion) ({ EnterTransition.None }) else enterSlide(),
        exitTransition = if (reduceMotion) ({ ExitTransition.None }) else exitSlide(),
        popEnterTransition = if (reduceMotion) ({ EnterTransition.None }) else popEnterSlide(),
        popExitTransition = if (reduceMotion) ({ ExitTransition.None }) else popExitSlide()
    ) {

        // ---- Auth ----

        composable(route = Routes.Login.route) {
            val viewModel = koinViewModel<com.claudewebui.app.ui.screens.auth.LoginViewModel>()
            LoginScreen(
                viewModel = viewModel,
                onAuthenticated = { _ ->
                    socketManager.connect()
                    // The shared settings ViewModel is created before login;
                    // fetch synced appearance again now that auth exists.
                    settingsViewModel.loadSettings()
                    navController.navigate(Routes.Dashboard.route) {
                        popUpTo(Routes.Login.route) { inclusive = true }
                    }
                },
                onNavigateToServerSetup = {
                    navController.navigate(Routes.ServerSetup.route)
                },
                authCallbackUri = deepLinkUri?.takeIf {
                    it.startsWith("claudewebui://auth/callback")
                },
            )
        }

        composable(route = Routes.ServerSetup.route) {
            val viewModel = koinViewModel<com.claudewebui.app.ui.screens.auth.LoginViewModel>()
            ServerSetupScreen(
                viewModel = viewModel,
                onServerConnected = {
                    navController.navigate(Routes.Login.route) {
                        popUpTo(Routes.ServerSetup.route) { inclusive = true }
                    }
                }
            )
        }

        // ---- Dashboard ----

        composable(route = Routes.Dashboard.route) {
            // One workspace for every width: compact windows keep the phone
            // flow, wide ones (unfolded Fold, tablets) show the selected area's
            // list beside one of its items. It decides the layout itself so the
            // open item survives folding and unfolding.
            AreaWorkspace(
                expanded = rememberTwoPane(),
                onNavigateToSettings = { navController.navigate(SETTINGS_GRAPH) },
                onNavigateMain = { navController.navigateMain(it) },
                onNavigateToFiles = { sessionId, dir ->
                    navController.navigate(Routes.FileManager.createRoute(sessionId, dir))
                },
                onNavigateToGit = { sessionId ->
                    navController.navigate(Routes.GitManager.createRoute(sessionId))
                },
                onNavigateToCheckpoints = { sessionId ->
                    navController.navigate(Routes.CheckpointManager.createRoute(sessionId))
                },
                onNavigateToNotes = { sessionId ->
                    navController.navigate(Routes.Notes.createRoute(sessionId))
                },
                onNavigateToMemory = { workingDirectory ->
                    navController.navigate(Routes.Memory.createRoute(workingDirectory))
                },
                onNavigateToDevTools = { sessionId, workingDirectory ->
                    navController.navigate(
                        Routes.DevTools.createRoute(sessionId, workingDirectory)
                    )
                },
            )
        }

        composable(
            route = Routes.Monitor.route,
            deepLinks = listOf(navDeepLink { uriPattern = "claudewebui://monitor" }),
        ) {
            MonitorScreen(
                onNavigateMain = { navController.navigateMain(it) },
                onOpenSession = { sessionId ->
                    navController.navigate(Routes.Chat.createRoute(sessionId))
                },
            )
        }

        if (BuildConfig.DEBUG) {
            // Fixture-backed render of the grid, reachable without a login so
            // the layout can be checked on a real device.
            // Every Dynamic UI v2 element with fixtures (claudewebui://preview-dynui?theme=light&section=live).
            composable(route = DYNAMIC_UI_PREVIEW_ROUTE) {
                val link = remember(deepLinkUri) { deepLinkUri?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() } }
                com.claudewebui.app.ui.components.dynamicui.DynamicUiDemoScreen(
                    initialTheme = link?.getQueryParameter("theme"),
                    initialSection = link?.getQueryParameter("section"),
                )
            }
            // „Modelle im Chat“ with sample providers (claudewebui://preview-chatmodels).
            composable(route = CHAT_MODELS_PREVIEW_ROUTE) {
                com.claudewebui.app.ui.screens.settings.ChatModelMenuPreviewScreen()
            }
            // Voice mode and speech recognition choice (claudewebui://preview-voice?section=settings|voices|heard|live).
            composable(route = VOICE_PREVIEW_ROUTE) {
                val link = remember(deepLinkUri) { deepLinkUri?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() } }
                com.claudewebui.app.ui.screens.dashboard.VoiceModePreviewScreen(link?.getQueryParameter("section"))
            }
            // Every home-screen widget through the real renderer
            // (claudewebui://preview-widgets?kinds=limits,tokens&sizes=2x2,4x2&translucent=1&empty=1).
            composable(route = WIDGET_PREVIEW_ROUTE) {
                val link = remember(deepLinkUri) { deepLinkUri?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() } }
                com.claudewebui.app.widget.WidgetPreviewScreen(
                    kinds = link?.getQueryParameter("kinds"),
                    sizes = link?.getQueryParameter("sizes"),
                    translucent = link?.getQueryParameter("translucent") == "1",
                    empty = link?.getQueryParameter("empty") == "1",
                    provider = link?.getQueryParameter("provider"),
                    period = link?.getQueryParameter("period"),
                )
            }
            // CLI subagents with the Pi route picker (claudewebui://preview-subagents?routes=0 for the free-text fallback).
            composable(route = SUBAGENTS_PREVIEW_ROUTE) {
                val link = remember(deepLinkUri) { deepLinkUri?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() } }
                com.claudewebui.app.ui.screens.settings.SubagentsPreviewScreen(
                    withRoutes = link?.getQueryParameter("routes") != "0",
                )
            }
            composable(route = MONITOR_PREVIEW_ROUTE) {
                MonitorScreen(
                    onNavigateMain = {},
                    onOpenSession = {},
                    previewState = com.claudewebui.app.ui.screens.monitor.previewMonitorState(),
                )
            }
        }

        composable(route = Routes.Activity.route) {
            ActivityScreen(
                onNavigateMain = { navController.navigateMain(it) },
                onOpenSession = { sessionId ->
                    navController.navigate(Routes.Chat.createRoute(sessionId))
                },
            )
        }

        composable(route = Routes.Library.route) {
            LibraryScreen(
                onNavigateMain = { navController.navigateMain(it) },
                viewModel = settingsViewModel,
            )
        }

        composable(route = Routes.Notes.ROUTE) { entry ->
            val id = entry.arguments?.getString(Routes.Notes.ARG_SESSION_ID).orEmpty()
            NotesScreen(
                viewModel = koinViewModel { parametersOf(id) },
                onNavigateBack = { navController.popBackStack() },
            )
        }

        // ---- Chat ----

        composable(
            route = Routes.Chat.ROUTE,
            arguments = listOf(
                navArgument(Routes.Chat.ARG_SESSION_ID) { type = NavType.StringType },
                navArgument(Routes.Chat.ARG_MESSAGE_ID) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
                navArgument(Routes.Chat.ARG_CHAT_ID) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
            deepLinks = listOf(
                navDeepLink { uriPattern = "claudewebui://session/{sessionId}" }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.Chat.ARG_SESSION_ID)
                ?: return@composable
            // Wide window (unfolded while this session was open full-screen, or
            // a deep link on a tablet): open it inside the workspace instead,
            // in its own area and selected in the right column.
            // The debug fixture chat has no server session to hand over, so it
            // stays full-screen and its transcript can be checked on a tablet.
            val fixtureChat = BuildConfig.DEBUG && sessionId == "preview"
            if (rememberTwoPane() && !fixtureChat) {
                val messageId = backStackEntry.arguments?.getString(Routes.Chat.ARG_MESSAGE_ID)
                val chatId = backStackEntry.arguments?.getString(Routes.Chat.ARG_CHAT_ID)
                LaunchedEffect(sessionId) {
                    AreaWorkspaceHandoff.open(sessionId, messageId, chatId)
                    navController.navigate(Routes.Dashboard.route) {
                        popUpTo(Routes.Dashboard.route)
                        launchSingleTop = true
                    }
                }
                return@composable
            }
            ChatScreen(
                sessionId = sessionId,
                initialMessageId = backStackEntry.arguments?.getString(Routes.Chat.ARG_MESSAGE_ID),
                initialChatId = backStackEntry.arguments?.getString(Routes.Chat.ARG_CHAT_ID),
                onNavigateBack = { navController.popBackStack() },
                // ChatScreen hands over the session's working directory; the
                // session id comes from this destination's own arguments.
                onNavigateToFiles = { dir ->
                    navController.navigate(Routes.FileManager.createRoute(sessionId, dir))
                },
                // ChatScreen passes the working DIRECTORY here — routing it as
                // the session id built "git//mnt/…" which matches no route and
                // crashed with IllegalArgumentException. The destination only
                // needs the session id it already has.
                onNavigateToGit = { _ ->
                    navController.navigate(Routes.GitManager.createRoute(sessionId))
                },
                onNavigateToCheckpoints = { sid ->
                    navController.navigate(Routes.CheckpointManager.createRoute(sid))
                },
                onNavigateToDevTools = { workingDirectory ->
                    navController.navigate(Routes.DevTools.createRoute(sessionId, workingDirectory))
                },
                onNavigateToMemory = { workingDirectory ->
                    navController.navigate(Routes.Memory.createRoute(workingDirectory))
                },
                onNavigateToNotes = { sid ->
                    navController.navigate(Routes.Notes.createRoute(sid))
                },
            )
        }

        // ---- Settings (nested navigation graph) ----

        navigation(
            startDestination = Routes.Settings.route,
            route = SETTINGS_GRAPH
        ) {
            composable(route = Routes.Settings.route) {
                val viewModel = settingsViewModel
                SettingsScreen(
                    viewModel = viewModel,
                    onNavigateToCliProvider = { providerId ->
                        navController.navigate(Routes.SettingsCliProvider.createRoute(providerId))
                    },
                    onNavigateToMcp = { navController.navigate(Routes.SettingsMcp.route) },
                    onNavigateToCliTools = { navController.navigate(Routes.SettingsCliTools.route) },
                    onNavigateToAgents = { navController.navigate(Routes.SettingsAgents.route) },
                    onNavigateToPermissions = { navController.navigate(Routes.SettingsPermissions.route) },
                    onNavigateToIntegrations = {
                        navController.navigate(Routes.SettingsIntegrations.route)
                    },
                    onNavigateToConnections = {
                        navController.navigate(Routes.SettingsConnections.route)
                    },
                    onNavigateToOperations = { navController.navigate(Routes.Operations.route) },
                    onLoggedOut = {
                        socketManager.disconnect()
                        navController.navigate(Routes.Login.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    onNavigateMain = { navController.navigateMain(it) },
                    onOpenAssistantFeature = { path ->
                        navController.navigate("$ASSISTANT_WEB_PREFIX?path=" + java.net.URLEncoder.encode(path, "UTF-8"))
                    },
                )
            }

            // Assistant web features opened from the settings (memory
            // management). Leaving it returns to the settings page.
            composable(
                route = "$ASSISTANT_WEB_PREFIX?path={path}",
                arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/assistant/memory" }),
            ) { entry ->
                val path = entry.arguments?.getString("path").orEmpty().ifBlank { "/assistant/memory" }
                com.claudewebui.app.ui.screens.dashboard.AssistantWebWorkspace(
                    path = path,
                    area = "chat",
                    onAreaSelect = { if (!navController.popBackStack(Routes.Dashboard.route, inclusive = false)) navController.navigate(Routes.Dashboard.route) },
                    onClose = { navController.popBackStack() },
                    onPersonalize = { navController.popBackStack() },
                    onNavigateToChat = { navController.navigate(Routes.Chat.createRoute(it)) },
                    onNativeChat = { if (!navController.popBackStack(Routes.Dashboard.route, inclusive = false)) navController.navigate(Routes.Dashboard.route) },
                    standaloneTitle = androidx.compose.ui.res.stringResource(
                        if (path.startsWith("/assistant/memory")) com.claudewebui.app.R.string.assistant_manage_memory else com.claudewebui.app.R.string.assistant_feature_title,
                    ),
                )
            }

            composable(route = Routes.SettingsCliProvider.ROUTE) { entry ->
                val viewModel = settingsViewModel
                CliProviderDetailScreen(
                    providerId = entry.arguments
                        ?.getString(Routes.SettingsCliProvider.ARG_PROVIDER_ID)
                        .orEmpty(),
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() },
                )
            }

            composable(route = Routes.SettingsMcp.route) {
                val viewModel = settingsViewModel
                McpSettingsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsCliTools.route) {
                val viewModel = settingsViewModel
                CliToolsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsAgents.route) {
                val viewModel = settingsViewModel
                AgentsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsPermissions.route) {
                val viewModel = settingsViewModel
                PermissionsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsIntegrations.route) {
                IntegrationsScreen(
                    viewModel = koinViewModel(),
                    onNavigateBack = { navController.popBackStack() },
                )
            }

            composable(route = Routes.SettingsConnections.route) {
                ConnectionsScreen(
                    viewModel = koinViewModel(parameters = { parametersOf("") }),
                    onNavigateBack = { navController.popBackStack() },
                )
            }
        }

        // ---- Operations ----

        composable(route = Routes.Operations.route) {
            OperationsScreen(
                viewModel = koinViewModel(),
                onNavigateBack = { navController.popBackStack() },
            )
        }

        // ---- Dev tools ----

        composable(route = Routes.DevTools.ROUTE) { entry ->
            val sessionId =
                entry.arguments?.getString(Routes.DevTools.ARG_SESSION_ID).orEmpty()
            val encoded =
                entry.arguments?.getString(Routes.DevTools.ARG_WORKING_DIRECTORY).orEmpty()
            val workingDirectory = java.net.URLDecoder.decode(encoded, "UTF-8")
            DevToolsScreen(
                viewModel = koinViewModel { parametersOf(sessionId, workingDirectory) },
                onNavigateBack = { navController.popBackStack() },
            )
        }

        // ---- Memory ----

        composable(route = Routes.Memory.ROUTE) { entry ->
            val encoded = entry.arguments?.getString(Routes.Memory.ARG_WORKING_DIRECTORY).orEmpty()
            val workingDirectory = java.net.URLDecoder.decode(encoded, "UTF-8")
            MemoryScreen(
                viewModel = koinViewModel { parametersOf(workingDirectory) },
                onNavigateBack = { navController.popBackStack() },
            )
        }

        // ---- File Manager ----

        composable(
            route = Routes.FileManager.ROUTE,
            arguments = listOf(
                navArgument(Routes.FileManager.ARG_SESSION_ID) { type = NavType.StringType },
                navArgument(Routes.FileManager.ARG_PATH) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.FileManager.ARG_SESSION_ID)
                ?: return@composable
            val startPath = java.net.URLDecoder.decode(
                backStackEntry.arguments?.getString(Routes.FileManager.ARG_PATH).orEmpty(),
                "UTF-8",
            )
            FileManagerScreen(
                sessionId = sessionId,
                workingDirectory = startPath,
                onNavigateBack = { navController.popBackStack() },
                onOpenFile = { fileInfo ->
                    navController.navigate(
                        Routes.FileViewer.createRoute(sessionId, fileInfo.path)
                    )
                },
                onSendToChat = { /* handled in chat via deep linking */ }
            )
        }

        // ---- File Viewer ----

        composable(
            route = Routes.FileViewer.ROUTE,
            arguments = listOf(
                navArgument(Routes.FileViewer.ARG_SESSION_ID) { type = NavType.StringType },
                navArgument(Routes.FileViewer.ARG_FILE_PATH) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val encoded = backStackEntry.arguments
                ?.getString(Routes.FileViewer.ARG_FILE_PATH)
                .orEmpty()
            val filePath = java.net.URLDecoder.decode(encoded, "UTF-8")
            FileEditorScreen(
                viewModel = koinViewModel { parametersOf(filePath) },
                onNavigateBack = { navController.popBackStack() },
            )
        }

        // ---- Analytics ----

        composable(
            route = Routes.Analytics.route + "?range={range}",
            arguments = listOf(
                navArgument("range") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            ),
            deepLinks = listOf(
                navDeepLink { uriPattern = "claudewebui://analytics?range={range}" }
            ),
        ) { backStackEntry ->
            AnalyticsScreen(
                onNavigateMain = { navController.navigateMain(it) },
                designPreview = isAnalyticsPreview,
                initialRange = backStackEntry.arguments?.getString("range"),
            )
        }

        // ---- Checkpoint Manager ----

        composable(
            route = Routes.CheckpointManager.ROUTE,
            arguments = listOf(
                navArgument(Routes.CheckpointManager.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId =
                backStackEntry.arguments?.getString(Routes.CheckpointManager.ARG_SESSION_ID)
                    ?: return@composable
            val viewModel = koinViewModel<CheckpointViewModel>(
                parameters = { parametersOf(sessionId) }
            )
            val uiState by viewModel.uiState.collectAsState()
            CheckpointScreen(
                sessionId = sessionId,
                checkpoints = uiState.checkpoints,
                isLoading = uiState.isLoading,
                onNavigateBack = { navController.popBackStack() },
                onCreateCheckpoint = { name, description ->
                    viewModel.createCheckpoint(name, description)
                },
                onRestoreCheckpoint = { checkpoint -> viewModel.restoreCheckpoint(checkpoint) },
                onDeleteCheckpoint = { checkpoint -> viewModel.deleteCheckpoint(checkpoint) }
            )
        }

        // ---- Git Manager ----

        composable(
            route = Routes.GitManager.ROUTE,
            arguments = listOf(
                navArgument(Routes.GitManager.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.GitManager.ARG_SESSION_ID)
                ?: return@composable
            val viewModel = koinViewModel<GitViewModel>(
                parameters = { parametersOf(sessionId) }
            )
            val uiState by viewModel.uiState.collectAsState()
            GitScreen(
                workingDirectory = uiState.workingDirectory,
                gitStatus = uiState.gitStatus,
                commits = uiState.commits,
                diffs = uiState.diffs,
                branches = uiState.branches,
                isLoading = uiState.isLoading,
                isCommitting = uiState.isCommitting,
                isPushing = uiState.isPushing,
                onNavigateBack = { navController.popBackStack() },
                onStageAll = { viewModel.stageAll() },
                onCommit = { message -> viewModel.commit(message) },
                onPush = { viewModel.push() },
                onSwitchBranch = { branch -> viewModel.switchBranch(branch) },
                onRefresh = { viewModel.refreshGitStatus() }
            )
        }

        // ---- Usage ----

        composable(
            route = Routes.Usage.ROUTE,
            arguments = listOf(
                navArgument(Routes.Usage.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.Usage.ARG_SESSION_ID)
                ?: return@composable
            val viewModel = koinViewModel<UsageViewModel>(
                parameters = { parametersOf(sessionId) }
            )
            val uiState by viewModel.uiState.collectAsState()
            UsageScreen(
                sessionId = sessionId,
                usageData = uiState.usageData,
                usageHistory = uiState.usageHistory,
                isLoading = uiState.isLoading,
                onNavigateBack = { navController.popBackStack() },
                onRefresh = { viewModel.refreshUsage() }
            )
        }
    }
}

private const val MONITOR_PREVIEW_ROUTE = "monitor_preview"
private const val DYNAMIC_UI_PREVIEW_ROUTE = "dynamic_ui_preview"
private const val CHAT_MODELS_PREVIEW_ROUTE = "chat_models_preview"
private const val VOICE_PREVIEW_ROUTE = "voice_preview"
private const val WIDGET_PREVIEW_ROUTE = "widget_preview"
private const val SUBAGENTS_PREVIEW_ROUTE = "subagents_preview"
private const val ASSISTANT_WEB_PREFIX = "settings_assistant_web"

private fun NavHostController.navigateMain(destination: MainDestination) {
    val route = when (destination) {
        MainDestination.SESSIONS -> Routes.Dashboard.route
        MainDestination.MONITOR -> Routes.Monitor.route
        MainDestination.ACTIVITY -> Routes.Activity.route
        MainDestination.ANALYTICS -> Routes.Analytics.route
        MainDestination.LIBRARY -> Routes.Library.route
        MainDestination.SETTINGS -> SETTINGS_GRAPH
    }
    navigate(route) {
        launchSingleTop = true
        restoreState = true
        popUpTo(Routes.Dashboard.route) { saveState = true }
    }
}
