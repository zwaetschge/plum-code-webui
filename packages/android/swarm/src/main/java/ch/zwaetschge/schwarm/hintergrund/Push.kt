package com.claudewebui.swarm.hintergrund

import android.app.BroadcastOptions
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/**
 * Sofort-Benachrichtigungen über UnifiedPush (App 2.5, Protokoll AND_3.1, ohne Bibliothek, weil der Builder
 * offline baut). Ein Verteiler wie ntfy hält die Verbindung für alle Apps; der Hub schickt an unsere Adresse
 * nur einen inhaltslosen Weckruf. Dann holt die App über Matrix selbst, was neu ist ([Hintergrund.jetztPruefen]).
 *
 * Die Adresse meldet die App signiert über den Not-Aus-Kanal beim Hub an (einmal mit Fingerabdruck); dazu setzt
 * sie einen Matrix-Pusher, damit auch Brians Antworten in Allgemein wecken.
 */
data class PushStand(
    /** Der Verteiler, bei dem die App angemeldet ist (Paketname), oder null. */
    val verteiler: String? = null,
    val endpoint: String? = null,
    val fehler: String? = null,
    /** Zuletzt geweckt (ms). */
    val geweckt: Long? = null,
)

object PushVerbindung {
    const val REGISTER = "org.unifiedpush.android.distributor.REGISTER"
    const val UNREGISTER = "org.unifiedpush.android.distributor.UNREGISTER"
    const val MESSAGE_ACK = "org.unifiedpush.android.distributor.MESSAGE_ACK"
    const val NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT"
    const val MESSAGE = "org.unifiedpush.android.connector.MESSAGE"
    const val REGISTRATION_FAILED = "org.unifiedpush.android.connector.REGISTRATION_FAILED"
    const val UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED"
    const val TEMP_UNAVAILABLE = "org.unifiedpush.android.connector.TEMP_UNAVAILABLE"
    private const val PREFS = "schwarm_push"

    private val _stand = MutableStateFlow(PushStand())
    val stand: StateFlow<PushStand> = _stand.asStateFlow()

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Beim Start der App: den gespeicherten Stand zeigen. */
    fun laden(context: Context) {
        val p = prefs(context)
        _stand.value = PushStand(
            verteiler = p.getString("verteiler", null),
            endpoint = p.getString("endpoint", null),
            fehler = p.getString("fehler", null),
            geweckt = p.getLong("geweckt", 0L).takeIf { it > 0 },
        )
    }

    private fun speichern(context: Context, s: PushStand) {
        prefs(context).edit()
            .putString("verteiler", s.verteiler).putString("endpoint", s.endpoint).putString("fehler", s.fehler)
            .putLong("geweckt", s.geweckt ?: 0L).apply()
        _stand.value = s
    }

    /** Installierte Verteiler (Paketname und Name), ohne die App selbst. */
    fun verteiler(context: Context): List<Pair<String, String>> {
        val pm = context.packageManager
        return pm.queryBroadcastReceivers(Intent(REGISTER), PackageManager.GET_RESOLVED_FILTER)
            .mapNotNull { it.activityInfo?.packageName }
            .filter { it != context.packageName }
            .distinct()
            .map { paket -> paket to runCatching { pm.getApplicationLabel(pm.getApplicationInfo(paket, 0)).toString() }.getOrDefault(paket) }
    }

    /** Beim Verteiler anmelden. Die Adresse kommt als NEW_ENDPOINT an [PushEmpfaenger]. */
    fun anmelden(context: Context, paket: String) {
        val token = UUID.randomUUID().toString()
        prefs(context).edit().putString("token", token).apply()
        speichern(context, PushStand(verteiler = paket))
        senden(context, Intent(REGISTER).setPackage(paket).putExtra("token", token).putExtra("message", "Schwarm"))
    }

    fun abmelden(context: Context) {
        val p = prefs(context)
        val token = p.getString("token", null)
        val paket = p.getString("verteiler", null)
        if (token != null && paket != null) senden(context, Intent(UNREGISTER).setPackage(paket).putExtra("token", token))
        p.edit().remove("token").apply()
        speichern(context, PushStand())
    }

    /** Mit Identität: ab Android 14 über BroadcastOptions, sonst über ein PendingIntent `pi` (AND_3). */
    internal fun senden(context: Context, intent: Intent) {
        intent.putExtra(
            "pi",
            PendingIntent.getBroadcast(context, 0, Intent().setPackage("org.unifiedpush.dummy_app"), PendingIntent.FLAG_IMMUTABLE),
        )
        if (Build.VERSION.SDK_INT >= 34) {
            context.sendBroadcast(intent, null, BroadcastOptions.makeBasic().setShareIdentityEnabled(true).toBundle())
        } else {
            context.sendBroadcast(intent)
        }
    }

    internal fun token(context: Context): String? = prefs(context).getString("token", null)

    internal fun neueAdresse(context: Context, endpoint: String) {
        speichern(context, _stand.value.copy(verteiler = prefs(context).getString("verteiler", null), endpoint = endpoint, fehler = null))
    }

    internal fun fehler(context: Context, text: String, weg: Boolean) {
        val alt = _stand.value
        speichern(context, alt.copy(endpoint = if (weg) null else alt.endpoint, fehler = text))
    }

    internal fun geweckt(context: Context) {
        speichern(context, _stand.value.copy(geweckt = System.currentTimeMillis()))
    }
}

/** Empfängt Adresse, Weckrufe und Abmeldungen vom Verteiler. Alles mit fremdem Token wird ignoriert. */
class PushEmpfaenger : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val token = intent.getStringExtra("token") ?: return
        if (token != PushVerbindung.token(context)) return
        val id = intent.getStringExtra("id")
        when (intent.action) {
            PushVerbindung.NEW_ENDPOINT -> {
                val endpoint = intent.getStringExtra("endpoint")?.takeIf { it.length <= 1000 } ?: return
                PushVerbindung.neueAdresse(context, endpoint)
                bestaetigen(context, token, id)
            }
            PushVerbindung.MESSAGE -> {
                bestaetigen(context, token, id)
                PushVerbindung.geweckt(context)
                Hintergrund.jetztPruefen(context)
            }
            PushVerbindung.REGISTRATION_FAILED ->
                PushVerbindung.fehler(context, "Der Verteiler lehnt ab (${intent.getStringExtra("reason") ?: "ohne Grund"}).", weg = true)
            PushVerbindung.UNREGISTERED ->
                PushVerbindung.fehler(context, "Beim Verteiler abgemeldet. Richte die Sofort-Benachrichtigungen neu ein.", weg = true)
            PushVerbindung.TEMP_UNAVAILABLE ->
                PushVerbindung.fehler(context, "Der Verteiler ist gerade nicht erreichbar.", weg = false)
        }
    }

    /** MESSAGE_ACK, wenn der Verteiler eine ID mitschickt (sonst meldet er die Adresse nach 30 s ab). */
    private fun bestaetigen(context: Context, token: String, id: String?) {
        if (id == null) return
        val paket = PushVerbindung.stand.value.verteiler
            ?: context.getSharedPreferences("schwarm_push", Context.MODE_PRIVATE).getString("verteiler", null) ?: return
        PushVerbindung.senden(context, Intent(PushVerbindung.MESSAGE_ACK).setPackage(paket).putExtra("token", token).putExtra("id", id))
    }
}

/** RAISE_TO_FOREGROUND: Der Verteiler bindet sich 5 s daran, damit die App den Weckruf sofort verarbeiten darf. */
class PushDienst : Service() {
    override fun onBind(intent: Intent?): IBinder = Binder()
}
