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
import com.claudewebui.app.ui.screens.dashboard.AdaptiveSessionWorkspace
import com.claudewebui.app.ui.theme.LayoutPrefs
import com.claudewebui.app.ui.screens.dashboard.DashboardScreen
import com.claudewebui.app.ui.screens.filemanager.FileManagerScreen
import com.claudewebui.app.ui.screens.library.LibraryScreen
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.screens.settings.AgentsScreen
import com.claudewebui.app.ui.screens.settings.CliToolsScreen
import com.claudewebui.app.ui.screens.filemanager.FileEditorScreen
import com.claudewebui.app.ui.screens.notes.NotesScreen
import com.claudewebui.app.ui.screens.settings.IntegrationsScreen
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
        when {
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
    LaunchedEffect(Unit) {
        AuthEvents.sessionExpired.collect {
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
            // On a tablet or unfolded device there is room for the session list
            // and the chat at once; pushing a full-screen chat there wastes half
            // the display and loses the list on every switch.
            val twoPaneOption by LayoutPrefs.twoPane.collectAsState()
            if (
                LayoutPrefs.shouldUseTwoPane(
                    twoPaneOption,
                    rememberWindowWidth() == WindowWidth.EXPANDED,
                )
            ) {
                AdaptiveSessionWorkspace(
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
                return@composable
            }
            DashboardScreen(
                onNavigateToChat = { sessionId ->
                    navController.navigate(Routes.Chat.createRoute(sessionId))
                },
                onNavigateToMessage = { sessionId, messageId, chatId ->
                    navController.navigate(Routes.Chat.createRoute(sessionId, messageId, chatId))
                },
                onNavigateToSettings = {
                    navController.navigate(SETTINGS_GRAPH)
                },
                onNavigateMain = { navController.navigateMain(it) },
            )
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
                    onNavigateToOperations = { navController.navigate(Routes.Operations.route) },
                    onLoggedOut = {
                        socketManager.disconnect()
                        navController.navigate(Routes.Login.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    onNavigateMain = { navController.navigateMain(it) },
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

private fun NavHostController.navigateMain(destination: MainDestination) {
    val route = when (destination) {
        MainDestination.SESSIONS -> Routes.Dashboard.route
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
