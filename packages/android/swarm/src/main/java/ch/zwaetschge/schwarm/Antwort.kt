package com.claudewebui.swarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.claudewebui.swarm.data.Sitzungsspeicher
import com.claudewebui.swarm.data.matrix.MatrixClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Rückfragen aus der Benachrichtigung beantworten (Punkt 11). RemoteInput liefert den Text, dieser Empfänger
 * schickt ihn als Antwort in denselben Thread, in dem die Frage steht — die App muss dafür nicht auf sein.
 * Die Sitzung kommt aus dem verschlüsselten Speicher, genau wie bei [FreigabeActivity].
 */
class AntwortEmpfaenger : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val raum = intent.getStringExtra(RAUM)?.takeIf { it.startsWith("!") } ?: return
        val thread = intent.getStringExtra(THREAD)?.takeIf { it.startsWith("$") } ?: return
        val antwortAuf = intent.getStringExtra(EVENT)?.takeIf { it.startsWith("$") } ?: thread
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(SCHLUESSEL)?.toString()
            ?.replace("\u0000", "")?.trim()?.takeIf { it.isNotEmpty() && it.length <= 4000 } ?: return
        val meldung = intent.getIntExtra(MELDUNG, 0)
        val ende = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            val ok = senden(context.applicationContext, raum, thread, antwortAuf, text)
            if (ok && meldung != 0) NotificationManagerCompat.from(context).cancel(meldung)
            withContext(Dispatchers.Main) {
                Toast.makeText(
                    context.applicationContext,
                    if (ok) "Antwort gesendet." else "Nicht gesendet. Öffne die App und antworte dort.",
                    Toast.LENGTH_LONG,
                ).show()
            }
            ende.finish()
        }
    }

    companion object {
        const val RAUM = "ch.zwaetschge.schwarm.ANTWORT_RAUM"
        const val THREAD = "ch.zwaetschge.schwarm.ANTWORT_THREAD"
        const val EVENT = "ch.zwaetschge.schwarm.ANTWORT_EVENT"
        const val MELDUNG = "ch.zwaetschge.schwarm.ANTWORT_MELDUNG"
        const val SCHLUESSEL = "ch.zwaetschge.schwarm.ANTWORT_TEXT"

        /** Der Text als Antwort im Thread; die Form ist dieselbe wie in `SchwarmDienst.schreiben`. */
        suspend fun senden(context: Context, raum: String, thread: String, antwortAuf: String, text: String): Boolean {
            val s = runCatching { Sitzungsspeicher(context).laden() }.getOrNull() ?: return false
            val client = MatrixClient(s.homeserver, s.accessToken)
            val inhalt = buildJsonObject {
                put("msgtype", JsonPrimitive("m.text"))
                put("body", JsonPrimitive(text))
                put("m.relates_to", buildJsonObject {
                    put("rel_type", JsonPrimitive("m.thread"))
                    put("event_id", JsonPrimitive(thread))
                    put("is_falling_back", JsonPrimitive(true))
                    put("m.in_reply_to", buildJsonObject { put("event_id", JsonPrimitive(antwortAuf)) })
                })
            }
            return try {
                client.senden(raum, "m.room.message", inhalt)
                true
            } catch (e: Exception) {
                false
            } finally {
                client.schliessen()
            }
        }
    }
}
