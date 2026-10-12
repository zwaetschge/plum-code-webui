package com.claudewebui.swarm

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Schnellkachel „Not-Aus“ (App 2.5): öffnet die App mit der Rückfrage zum Not-Aus. Ausgelöst wird erst dort,
 * nach deiner Bestätigung; ein Tipp auf die Kachel allein hält nichts an. Bei gesperrtem Gerät fragt Android
 * zuerst nach dem Entsperren.
 */
class NotAusKachel : TileService() {
    override fun onStartListening() {
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            label = getString(R.string.swarm_kachel_notaus)
            if (Build.VERSION.SDK_INT >= 29) subtitle = "Schwarm anhalten"
            updateTile()
        }
    }

    override fun onClick() {
        val ziel = Intent(this, MainActivity::class.java)
            .setAction("ch.zwaetschge.schwarm.KACHEL_NOTAUS")
            .putExtra(MainActivity.ZIEL, MainActivity.ZIEL_NOTAUS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 130, ziel, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(ziel)
        }
    }
}
