package com.claudewebui.swarm.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Das Zugangstoken, nie das Passwort. */
data class Sitzung(
    val homeserver: String,
    val userId: String,
    val accessToken: String,
    val deviceId: String,
) {
    /** `@zwaetschge:zwaetschge-webui.ch` → `zwaetschge-webui.ch` */
    val domain: String get() = userId.substringAfter(':')
}

/**
 * Sitzung und Einstellungen, verschlüsselt mit einem Schlüssel aus dem Android-Keystore.
 * Die App hat `allowBackup=false`, das Token verlässt das Gerät also nicht.
 */
class Sitzungsspeicher(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "schwarm_sitzung",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun laden(): Sitzung? {
        val hs = prefs.getString("homeserver", null) ?: return null
        val user = prefs.getString("user_id", null) ?: return null
        val token = prefs.getString("access_token", null) ?: return null
        val device = prefs.getString("device_id", null) ?: return null
        return Sitzung(hs, user, token, device)
    }

    fun speichern(s: Sitzung) {
        prefs.edit()
            .putString("homeserver", s.homeserver)
            .putString("user_id", s.userId)
            .putString("access_token", s.accessToken)
            .putString("device_id", s.deviceId)
            .apply()
    }

    fun loeschen() {
        prefs.edit().clear().apply()
    }

    /** Eigener Sync-Stand der Hintergrundprüfung, getrennt vom Live-Sync der Oberfläche. */
    var hintergrundSince: String?
        get() = prefs.getString("bg_since", null)
        set(v) = prefs.edit().putString("bg_since", v).apply()

    var benachrichtigungen: Boolean
        get() = prefs.getBoolean("benachrichtigungen", true)
        set(v) = prefs.edit().putBoolean("benachrichtigungen", v).apply()

    var letzterBenutzer: String?
        get() = prefs.getString("letzter_benutzer", null)
        set(v) = prefs.edit().putString("letzter_benutzer", v).apply()

    var letzterServer: String?
        get() = prefs.getString("letzter_server", null)
        set(v) = prefs.edit().putString("letzter_server", v).apply()
}
