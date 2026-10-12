package com.claudewebui.swarm.hintergrund

import android.content.Context
import com.claudewebui.swarm.data.Ruhe

/**
 * Ruhezeit und Protokoll der Hintergrundprüfung (App 2.9). Die Hintergrundprüfung sieht keine State-Events; die
 * Oberfläche legt die Ruhezeit des Hubs deshalb hier ab. In der Ruhezeit meldet die App nur Dringendes laut
 * (Freigaben, 🚨, ⛔), alles andere still. Dazu merkt sie sich, wann sie zuletzt geprüft hat und mit welchem
 * Ergebnis, für die Diagnose.
 */
object RuheSpeicher {
    private const val PREFS = "schwarm_ruhe"

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun speichern(context: Context, r: Ruhe?) {
        val e = prefs(context).edit()
        if (r == null) e.remove("an").remove("von").remove("bis").remove("zone")
        else e.putBoolean("an", r.an).putString("von", r.von).putString("bis", r.bis).putString("zone", r.zone)
        e.apply()
    }

    fun laden(context: Context): Ruhe? {
        val p = prefs(context)
        val von = p.getString("von", null) ?: return null
        val bis = p.getString("bis", null) ?: return null
        return Ruhe(p.getBoolean("an", false), von, bis, p.getString("zone", null) ?: "Europe/Zurich")
    }

    /** Still melden? Nur in der Ruhezeit und nur, wenn es nicht dringend ist. */
    fun still(context: Context, dringend: Boolean): Boolean = !dringend && laden(context)?.jetzt() == true

    fun pruefungMerken(context: Context, ergebnis: String) {
        prefs(context).edit().putLong("pruefung", System.currentTimeMillis()).putString("pruefung_ergebnis", ergebnis.take(200)).apply()
    }

    /** Zeit (ms) und Ergebnis der letzten Hintergrundprüfung. */
    fun letztePruefung(context: Context): Pair<Long, String>? {
        val p = prefs(context)
        val t = p.getLong("pruefung", 0L).takeIf { it > 0 } ?: return null
        return t to p.getString("pruefung_ergebnis", "").orEmpty()
    }
}
