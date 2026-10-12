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
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.ui.Dringend
import com.claudewebui.swarm.ui.brauchtDich
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * „Braucht dich“ auf dem Homescreen (App 2.5): wie viel auf dich wartet und das Dringendste davon. Die App
 * schreibt den Stand bei jeder Änderung; das Widget zeigt dazu, von wann er ist. Ein Tipp öffnet „Aktuell“.
 */
class AktuellWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val ansicht = ansicht(context)
        ids.forEach { manager.updateAppWidget(it, ansicht) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) aktualisieren(context)
    }

    data class Inhalt(val zahl: Int, val zeile: String)

    companion object {
        private const val PREFS = "widget_aktuell"
        private val uhr = SimpleDateFormat("HH:mm", Locale.GERMAN)

        /** Was das Widget zeigen soll: die Zahl wie das Abzeichen unten und der erste Punkt aus „Braucht dich“. */
        fun inhalt(z: SchwarmZustand, jetzt: Long = System.currentTimeMillis()): Inhalt {
            val liste = brauchtDich(z, jetzt)
            val erste = liste.firstOrNull()?.let { d ->
                when (d) {
                    is Dringend.FreigabeW -> "🔐 Freigabe ${d.f.auftragId} an ${d.f.ziel}"
                    is Dringend.AlarmW -> "${d.al.stufe.zeichen} ${d.al.quelle}: ${d.al.titel}"
                    is Dringend.EntscheidungW -> "${d.e.art.zeichen} ${d.e.art.titel} ${d.e.auftragId ?: d.e.ablauf ?: ""}".trim()
                    is Dringend.RueckfrageW -> "${d.t.zustand.zeichen} ${d.t.id}: ${d.t.ziel.lineSequence().first()}"
                }
            }
            val zeile = when {
                erste != null -> erste.take(120)
                z.einladungen.isNotEmpty() -> "${z.einladungen.size} Schwarm-Räume warten auf dich"
                else -> "Nichts wartet auf dich"
            }
            return Inhalt(liste.size + z.einladungen.size, zeile)
        }

        fun speichern(context: Context, w: Inhalt) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("zahl", w.zahl).putString("zeile", w.zeile).putLong("stand", System.currentTimeMillis()).apply()
            aktualisieren(context)
        }

        fun aktualisieren(context: Context) {
            runCatching {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, AktuellWidget::class.java))
                if (ids.isNotEmpty()) manager.updateAppWidget(ids, ansicht(context))
            }
        }

        private fun ansicht(context: Context): RemoteViews {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val stand = p.getLong("stand", 0L)
            val zahl = p.getInt("zahl", 0)
            val v = RemoteViews(context.packageName, R.layout.swarm_widget_aktuell)
            if (stand == 0L) {
                v.setTextViewText(R.id.swarm_aktuell_zahl, "–")
                v.setTextViewText(R.id.swarm_aktuell_zeile, context.getString(R.string.swarm_widget_aktuell_leer))
                v.setViewVisibility(R.id.swarm_aktuell_stand, View.GONE)
            } else {
                v.setTextViewText(R.id.swarm_aktuell_zahl, if (zahl > 99) "99+" else zahl.toString())
                v.setTextColor(R.id.swarm_aktuell_zahl, if (zahl > 0) 0xFFFF6B6B.toInt() else 0xFF7EE0A1.toInt())
                v.setTextViewText(R.id.swarm_aktuell_zeile, p.getString("zeile", "").orEmpty())
                v.setViewVisibility(R.id.swarm_aktuell_stand, View.VISIBLE)
                v.setTextViewText(R.id.swarm_aktuell_stand, "Stand ${uhr.format(Date(stand))}")
            }
            val ziel = Intent(context, MainActivity::class.java)
                .setAction("ch.zwaetschge.schwarm.WIDGET_AKTUELL")
                .putExtra(MainActivity.ZIEL, MainActivity.ZIEL_AKTUELL)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            v.setOnClickPendingIntent(
                R.id.swarm_aktuell_wurzel,
                PendingIntent.getActivity(context, 120, ziel, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
            )
            return v
        }
    }
}
