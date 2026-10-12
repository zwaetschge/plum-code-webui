package com.claudewebui.swarm

import android.app.Application
import com.claudewebui.swarm.data.Absturz
import com.claudewebui.swarm.data.Sitzungsspeicher
import com.claudewebui.swarm.hintergrund.Hintergrund
import com.claudewebui.swarm.widget.FavoritenWidget

object SwarmIntegration {
    fun initialize(context: android.content.Context) {
        // Abstürze ohne Inhalt melden (Punkt 20): erst schreiben, dann an Android weiterreichen.
        Thread.setDefaultUncaughtExceptionHandler(Absturz.haendler(context, Thread.getDefaultUncaughtExceptionHandler()))
        Hintergrund.kanaeleAnlegen(context)
        // Add native entry points without replacing Plum's existing dynamic shortcuts.
        runCatching {
            val manager = context.getSystemService(android.content.pm.ShortcutManager::class.java)
            val entries = listOf(
                Triple("plum.swarm.chat", "Brian-Chat", MainActivity.ZIEL_NEUER_CHAT),
                Triple("plum.swarm.task", "Schwarm-Auftrag", MainActivity.ZIEL_NEUER_AUFTRAG),
                Triple("plum.swarm.current", "Schwarmübersicht", MainActivity.ZIEL_AKTUELL),
            ).take(manager.maxShortcutCountPerActivity).map { (id,label,target) ->
                android.content.pm.ShortcutInfo.Builder(context,id).setShortLabel(label)
                    .setIcon(android.graphics.drawable.Icon.createWithResource(context,R.drawable.swarm_ic_launcher_foreground))
                    .setIntent(android.content.Intent(context,MainActivity::class.java).setAction(android.content.Intent.ACTION_VIEW).putExtra(MainActivity.ZIEL,target)).build()
            }
            manager.addDynamicShortcuts(entries)
        }
        // Das Widget kennt nur, was die App ihm zuletzt gegeben hat: beim Start einmal auffrischen.
        FavoritenWidget.aktualisieren(context)
        val speicher = runCatching { Sitzungsspeicher(context) }.getOrNull() ?: return
        if (speicher.laden() != null) Hintergrund.planen(context, speicher.benachrichtigungen)
    }
}
