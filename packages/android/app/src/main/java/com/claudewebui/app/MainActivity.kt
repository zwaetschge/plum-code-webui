package com.claudewebui.app

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.navigation.AppNavigation
import androidx.compose.material3.SnackbarHostState
import com.claudewebui.app.ui.components.common.LocalPlumSnackbar
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.theme.AppThemeStore
import com.claudewebui.app.ui.theme.LayoutPrefs
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.paletteFor
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private companion object {
        /** Above this background stay the socket is assumed to be a zombie. */
        const val STALE_SOCKET_THRESHOLD_MS = 60_000L
    }

    private var incomingDeepLink by mutableStateOf<String?>(null)
    private var stoppedAtRealtime = 0L
    private val socketManager: SocketManager by inject()

    override fun onStart() {
        super.onStart()
        if (stoppedAtRealtime == 0L) return // cold start — the login flow connects
        val awayMs = SystemClock.elapsedRealtime() - stoppedAtRealtime
        // After Doze the socket often still claims connected() while the server
        // dropped it long ago; only a fresh transport gets events flowing again.
        if (awayMs > STALE_SOCKET_THRESHOLD_MS) {
            socketManager.forceReconnect()
        } else {
            socketManager.ensureConnected()
        }
    }

    override fun onStop() {
        super.onStop()
        stoppedAtRealtime = SystemClock.elapsedRealtime()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge-to-edge before setContent. The no-argument overload defaults to
        // SystemBarStyle.auto, which picks its appearance from the *system* dark
        // mode and paints a scrim behind the bars. Plum's palette is chosen in
        // app settings and is usually dark even when the system is light, so
        // that default could tint the status bar until the palette-driven
        // DisposableEffect below replaced it. Start transparent instead.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.Transparent.toArgb()),
            navigationBarStyle = SystemBarStyle.dark(Color.Transparent.toArgb()),
        )
        // Belt and braces for devices that keep painting an opaque bar anyway:
        // measured on the iPlay tablet, both bars came out a flat #1A1A1A while
        // the window itself was already full-screen. Setting the colours on the
        // window directly is what actually makes the backdrop show through.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        super.onCreate(savedInstanceState)
        AppThemeStore.initialize(this)
        LayoutPrefs.initialize(this)
        incomingDeepLink = intent?.data?.toString()

        setContent {
            // The stored preference decides the palette; SYSTEM defers to the
            // device setting. Reading the flow here means a change in Settings
            // repaints the whole app, including the system bars.
            val themeOption by AppThemeStore.theme.collectAsState()
            val systemInDark = isSystemInDarkTheme()
            val palette = paletteFor(themeOption, systemInDark)
            val darkTheme = !palette.isLight

            // Update system bar styles to match the current theme
            DisposableEffect(darkTheme) {
                enableEdgeToEdge(
                    statusBarStyle = if (darkTheme) {
                        SystemBarStyle.dark(Color.Transparent.toArgb())
                    } else {
                        SystemBarStyle.light(
                            Color.Transparent.toArgb(),
                            Color.Black.toArgb()
                        )
                    },
                    navigationBarStyle = if (darkTheme) {
                        SystemBarStyle.dark(Color.Transparent.toArgb())
                    } else {
                        SystemBarStyle.light(
                            Color.Transparent.toArgb(),
                            Color.Black.toArgb()
                        )
                    }
                )
                onDispose {}
            }

            // One host state for the whole app: screens post errors from above
            // their scaffold, so the state cannot be owned by the scaffold.
            val snackbarHostState = remember { SnackbarHostState() }

            CompositionLocalProvider(
                LocalPlumPalette provides palette,
                LocalPlumSnackbar provides snackbarHostState,
            ) {
                ClaudeWebUITheme(darkTheme = darkTheme) {
                    // The atmospheric backdrop (glows + grid) sits behind every
                    // screen, so screens with transparent scaffolds read as
                    // frosted glass instead of floating on flat black.
                    PlumBackdrop(modifier = Modifier.fillMaxSize()) {
                        // Pass deep link intent to the navigation host
                        AppNavigation(
                            deepLinkUri = incomingDeepLink
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incomingDeepLink = intent.data?.toString()
    }
}
