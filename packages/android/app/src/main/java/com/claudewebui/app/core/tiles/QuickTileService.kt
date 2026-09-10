package com.claudewebui.app.core.tiles

import com.claudewebui.app.R
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi
import com.claudewebui.app.MainActivity

/**
 * Quick Settings tile for Plum Code WebUI.
 *
 * Behaviour:
 * - **Subtitle**: shows the number of active (running) sessions; e.g. "2 running".
 * - **Tap**: opens the app (or creates a new session if none exist).
 * - **Long-press**: routes to the app settings screen via a deep-link intent.
 *
 * The tile state is updated whenever the tile transitions to an active listening
 * window ([onStartListening]) and whenever the session count changes via
 * [updateTile] (called from the rest of the app through [requestListeningState]).
 *
 * Registration in AndroidManifest requires:
 * ```xml
 * <service android:name=".core.tiles.QuickTileService"
 *          android:icon="@drawable/ic_notification"
 *          android:label="@string/tile_label"
 *          android:exported="true"
 *          android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
 *     <intent-filter>
 *         <action android:name="android.service.quicksettings.action.QS_TILE" />
 *     </intent-filter>
 * </service>
 * ```
 */
@RequiresApi(Build.VERSION_CODES.N)
class QuickTileService : TileService() {

    // ── TileService lifecycle ─────────────────────────────────────────────────

    override fun onStartListening() {
        super.onStartListening()
        updateTileDisplay()
    }

    override fun onStopListening() {
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        val sessionCount = TileStateHolder.activeSessionCount
        val uri = if (sessionCount == 0) {
            "claudewebui://new"
        } else {
            "claudewebui://"   // open the sessions list
        }
        launchApp(uri)
    }

    // TileService does not receive a direct long-press callback — instead the
    // system shows the default long-press menu. We override the tile's tap
    // behavior and note that in-app navigation should handle settings routing.
    // If long-press customisation is required in future it can be handled via
    // a secondary companion tile or in-app gesture.

    // ── Display update ────────────────────────────────────────────────────────

    private fun updateTileDisplay() {
        val tile = qsTile ?: return
        val count = TileStateHolder.activeSessionCount

        tile.apply {
            state = if (count > 0) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = if (count > 0) getString(R.string.native_tile_running, count) else getString(R.string.native_tile_no_sessions)
            }

            // contentDescription for accessibility
            contentDescription = if (count > 0) {
                getString(R.string.native_tile_active, count)
            } else {
                getString(R.string.native_tile_start)
            }

            updateTile()
        }
    }

    // ── App launch ────────────────────────────────────────────────────────────

    private fun launchApp(deepLink: String) {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = android.net.Uri.parse(deepLink)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

        // startActivityAndCollapse available on API 34+, fallback to unlockAndRun
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(
                android.app.PendingIntent.getActivity(
                    applicationContext,
                    0,
                    intent,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                            android.app.PendingIntent.FLAG_IMMUTABLE
                )
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    companion object {

        /**
         * Request the system to call [onStartListening] so the tile can refresh itself.
         * Call this when the session count changes.
         */
        fun requestUpdate(context: android.content.Context, count: Int) {
            TileStateHolder.activeSessionCount = count
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                requestListeningState(context, android.content.ComponentName(context, QuickTileService::class.java))
            }
        }
    }
}

/**
 * Simple in-process holder for tile state that survives across [TileService]
 * start/stop cycles within a single process.
 */
object TileStateHolder {
    @Volatile
    var activeSessionCount: Int = 0
}
