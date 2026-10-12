package com.claudewebui.swarm.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.claudewebui.swarm.data.matrix.Ereignis
import com.claudewebui.swarm.data.matrix.SchwarmJson
import kotlinx.serialization.Serializable

/**
 * Der letzte bekannte Stand (Punkt 18): Board, offene Freigaben und Alarme. Fällt der Sync aus,
 * zeigt die App ihn mit Zeitstempel, statt leer dazustehen. Verschlüsselt wie die Sitzung, mit
 * einem Schlüssel aus dem Android-Keystore; beim Abmelden wird er gelöscht.
 */
@Serializable
data class Schnappschuss(
    val zeit: Long,
    val agenten: List<Agent> = emptyList(),
    val auftraege: List<Auftrag> = emptyList(),
    val freigaben: List<Freigabe> = emptyList(),
    val alarme: List<Alarm> = emptyList(),
    /** Allgemein (App 2.9): der Raum und seine letzten Events, damit die Chats sofort und offline lesbar sind. */
    val allgemeinRaum: String? = null,
    val allgemeinEreignisse: List<Ereignis> = emptyList(),
) {
    /** Ohne Zeit, zum Vergleichen: Hat sich der Inhalt geändert? */
    val inhalt: Schnappschuss get() = copy(zeit = 0)

    companion object {
        /** Nur so viel, wie es für den Überblick braucht; der Speicher bleibt klein. */
        fun aus(z: SchwarmZustand, jetzt: Long = System.currentTimeMillis()): Schnappschuss = Schnappschuss(
            zeit = z.zuletztSync,
            agenten = z.agenten,
            auftraege = z.auftraege.take(80),
            freigaben = z.freigaben.filter { it.offenUm(jetzt) } + z.freigaben.filterNot { it.offenUm(jetzt) }.take(10),
            alarme = z.alarme.filter { it.offenUm(jetzt) } + z.alarme.filterNot { it.offenUm(jetzt) }.take(20),
        )
    }
}

class StandSpeicher(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "schwarm_stand",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun laden(): Schnappschuss? = runCatching {
        prefs.getString("stand", null)?.let { SchwarmJson.decodeFromString(Schnappschuss.serializer(), it) }
    }.getOrNull()

    fun speichern(s: Schnappschuss) {
        runCatching { prefs.edit().putString("stand", SchwarmJson.encodeToString(Schnappschuss.serializer(), s)).apply() }
    }

    fun loeschen() {
        runCatching { prefs.edit().clear().apply() }
    }
}
