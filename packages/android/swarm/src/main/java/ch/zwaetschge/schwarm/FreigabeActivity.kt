package com.claudewebui.swarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.lifecycleScope
import com.claudewebui.swarm.data.Sitzungsspeicher
import com.claudewebui.swarm.data.matrix.MatrixClient
import com.claudewebui.swarm.ui.Biometrie
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Freigeben aus der Benachrichtigung (App 2.7, Vale: „setz das alles um“, Verbesserung 6). Die Activity hat keine
 * eigene Oberfläche: Sie fragt nach Fingerabdruck oder Gerätesperre und setzt dann dein ✅ auf die Freigabe-Notice,
 * genau wie der Knopf in der App. Ohne Displaysperre gibt es keine Bestätigung; dann öffnet sich die App bei den
 * Freigaben, wie bisher.
 */
class FreigabeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val raum = intent.getStringExtra(RAUM)?.takeIf { it.startsWith("!") }
        val event = intent.getStringExtra(EVENT)?.takeIf { it.startsWith("$") }
        val auftrag = intent.getStringExtra(AUFTRAG).orEmpty()
        val ziel = intent.getStringExtra(ZIEL_AGENT).orEmpty()
        if (raum == null || event == null) {
            finish()
            return
        }
        if (!Biometrie.eingerichtet(this)) {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .putExtra(MainActivity.ZIEL, MainActivity.ZIEL_FREIGABEN)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            )
            finish()
            return
        }
        lifecycleScope.launch {
            val (ergebnis, meldung) = Biometrie.bestaetigen(
                this@FreigabeActivity,
                "$auftrag an $ziel freigeben?",
                "Wie „Freigeben“ in der App: Mit deinem ✅ legt $ziel los.",
            )
            if (ergebnis == Biometrie.Ergebnis.OK) {
                val ok = withContext(Dispatchers.IO) { reagieren(applicationContext, raum, event, "✅") }
                Toast.makeText(
                    applicationContext,
                    if (ok) "✅ gesendet. Der Hub quittiert gleich." else "Nicht gesendet. Öffne die App und versuch es dort.",
                    Toast.LENGTH_LONG,
                ).show()
                if (ok) NotificationManagerCompat.from(applicationContext).cancel(event.hashCode())
            } else if (ergebnis != Biometrie.Ergebnis.ABGEBROCHEN) {
                Toast.makeText(applicationContext, meldung ?: "Nicht bestätigt, nichts gesendet.", Toast.LENGTH_LONG).show()
            }
            finish()
        }
    }

    companion object {
        const val RAUM = "ch.zwaetschge.schwarm.FREIGABE_RAUM"
        const val EVENT = "ch.zwaetschge.schwarm.FREIGABE_EVENT"
        const val AUFTRAG = "ch.zwaetschge.schwarm.FREIGABE_AUFTRAG"
        const val ZIEL_AGENT = "ch.zwaetschge.schwarm.FREIGABE_ZIEL"

        /** Deine Reaktion auf die Notice, mit der gespeicherten Sitzung. Liefert, ob sie angekommen ist. */
        suspend fun reagieren(context: Context, raum: String, event: String, zeichen: String): Boolean {
            val s = Sitzungsspeicher(context).laden() ?: return false
            val client = MatrixClient(s.homeserver, s.accessToken)
            return try {
                client.reagieren(raum, event, zeichen)
                true
            } catch (e: Exception) {
                false
            } finally {
                client.schliessen()
            }
        }
    }
}

/** „Ablehnen“ aus der Benachrichtigung: ❌ ohne Rückfrage, denn Ablehnen lässt nichts los. */
class FreigabeAblehnen : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val raum = intent.getStringExtra(FreigabeActivity.RAUM)?.takeIf { it.startsWith("!") } ?: return
        val event = intent.getStringExtra(FreigabeActivity.EVENT)?.takeIf { it.startsWith("$") } ?: return
        val ende = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                if (FreigabeActivity.reagieren(context.applicationContext, raum, event, "❌")) {
                    NotificationManagerCompat.from(context).cancel(event.hashCode())
                }
            } finally {
                ende.finish()
            }
        }
    }
}
