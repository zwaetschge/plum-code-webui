package com.claudewebui.swarm.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.claudewebui.swarm.MainActivity
import com.claudewebui.swarm.R
import com.claudewebui.swarm.data.FAVORITEN_MAX
import com.claudewebui.swarm.data.VorlagenSpeicher

/**
 * Die Favoriten auf dem Homescreen (Punkt 19): bis 6 Vorlagen als Knöpfe. Ein Tipp öffnet die App
 * mit der Vorlage; dort fragt sie die Platzhalter ab und schickt den Auftrag erst nach deinem Okay.
 * Klassisch mit RemoteViews, ohne Zeitplan: Die App aktualisiert das Widget, wenn sich Vorlagen ändern.
 */
class FavoritenWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val ansicht = ansicht(context)
        ids.forEach { manager.updateAppWidget(it, ansicht) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        // Nach einem Update der App gleich wieder die Favoriten zeigen, ohne dass die App offen sein muss.
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) aktualisieren(context)
    }

    companion object {
        private val KNOEPFE = intArrayOf(R.id.swarm_fav_0, R.id.swarm_fav_1, R.id.swarm_fav_2, R.id.swarm_fav_3, R.id.swarm_fav_4, R.id.swarm_fav_5)
        private val REIHEN = intArrayOf(R.id.swarm_widget_reihe_1, R.id.swarm_widget_reihe_2, R.id.swarm_widget_reihe_3)

        fun aktualisieren(context: Context) {
            runCatching {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, FavoritenWidget::class.java))
                if (ids.isNotEmpty()) manager.updateAppWidget(ids, ansicht(context))
            }
        }

        private fun ansicht(context: Context): RemoteViews {
            val favoriten = VorlagenSpeicher(context).favoriten().take(FAVORITEN_MAX)
            val v = RemoteViews(context.packageName, R.layout.swarm_widget_favoriten)
            v.setViewVisibility(R.id.swarm_widget_leer, if (favoriten.isEmpty()) View.VISIBLE else View.GONE)
            // Eine Reihe nur, wenn sie mindestens einen Favoriten hat.
            REIHEN.forEachIndexed { r, reihe ->
                v.setViewVisibility(reihe, if (favoriten.size > r * 2) View.VISIBLE else View.GONE)
            }
            KNOEPFE.forEachIndexed { i, knopf ->
                val f = favoriten.getOrNull(i)
                if (f == null) {
                    v.setViewVisibility(knopf, View.INVISIBLE)
                    return@forEachIndexed
                }
                v.setViewVisibility(knopf, View.VISIBLE)
                v.setTextViewText(knopf, "★ ${f.titel}")
                v.setContentDescription(knopf, "Favorit ${f.titel}: Auftrag an ${f.agent}")
                val ziel = Intent(context, MainActivity::class.java)
                    // Eigene Aktion je Knopf: sonst fasste Android die PendingIntents zusammen.
                    .setAction("ch.zwaetschge.schwarm.FAVORIT.$i")
                    .putExtra(MainActivity.VORLAGE, f.id)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                v.setOnClickPendingIntent(
                    knopf,
                    PendingIntent.getActivity(context, 100 + i, ziel, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            }
            // Ein Tipp auf den Titel öffnet einfach die App.
            val app = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            v.setOnClickPendingIntent(
                R.id.swarm_widget_titel,
                PendingIntent.getActivity(context, 99, app, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
            )
            return v
        }
    }
}
