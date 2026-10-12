package com.claudewebui.swarm.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest

/**
 * Die veröffentlichte APK (Punkt 20): State-Event `ch.zwaetschge.swarm.app` in der Lobby, geschrieben von
 * `matrix/ops/app-veroeffentlichen.mjs` als @schwarm. Die App vergleicht `versionCode` mit ihrem eigenen und
 * bietet an, die neue Version über den Server zu laden und zu installieren — statt die APK von Hand aus dem
 * Zwischenspeicher zu holen. Fehlt das Event, sagt die App nichts über Updates.
 */
data class AppRelease(
    val versionCode: Int,
    val versionName: String,
    val mxc: String,
    val groesse: Long,
    val sha256: String,
    val notizen: String,
    val zeit: Long?,
)

/** Wo das Laden der neuen Version steht. */
sealed interface UpdateStand {
    data object Untaetig : UpdateStand
    data object Laedt : UpdateStand
    data class Fehler(val text: String) : UpdateStand
}

/** Laden, Prüfen und Installieren der neuen APK. Die Signatur prüft Android selbst, wie bei jeder Installation. */
object AppUpdate {
    /** Grösser darf die APK nicht sein: Die App lädt sie ganz in den Speicher, bevor sie schreibt. */
    const val MAX_BYTES = 120_000_000L
    private const val ORDNER = "updates"

    fun ordner(context: Context): File = File(context.cacheDir, ORDNER).apply { mkdirs() }

    fun datei(context: Context, r: AppRelease): File = File(ordner(context), "schwarm-${r.versionCode}.apk")

    /**
     * Liegt die APK schon im Cache? Billig geprüft (Name und Grösse), damit die Karte nicht bei jedem
     * Neuzeichnen 20 MB hashen muss; die volle Prüfung mit SHA-256 läuft direkt nach dem Laden.
     */
    fun vorhanden(context: Context, r: AppRelease): File? =
        datei(context, r).takeIf { it.isFile && (r.groesse <= 0 || it.length() == r.groesse) }

    /** Ist die veröffentlichte Version neuer als die laufende? */
    fun neuer(r: AppRelease?, eigenerCode: Int): Boolean = false // Plum owns APK updates.

    /**
     * Grösse und SHA-256 gegen das Event prüfen. Liefert null, wenn die Datei passt, sonst den Grund —
     * die App installiert nur, was hier durchgeht.
     */
    fun pruefen(datei: File, r: AppRelease): String? {
        if (!datei.isFile) return "Die Datei ist nicht angekommen."
        if (r.groesse > 0 && datei.length() != r.groesse) {
            return "Die Grösse stimmt nicht: ${datei.length()} statt ${r.groesse} Bytes."
        }
        if (r.sha256.isNotBlank()) {
            val summe = sha256(datei) ?: return "Die Prüfsumme liess sich nicht rechnen."
            if (!summe.equals(r.sha256.trim(), ignoreCase = true)) return "Die Prüfsumme stimmt nicht."
        }
        return null
    }

    fun sha256(datei: File): String? = runCatching {
        val summe = MessageDigest.getInstance("SHA-256")
        datei.inputStream().use { ein ->
            val puff = ByteArray(64 * 1024)
            while (true) {
                val n = ein.read(puff)
                if (n <= 0) break
                summe.update(puff, 0, n)
            }
        }
        summe.digest().joinToString("") { "%02x".format(it) }
    }.getOrNull()

    /** Dem Paketinstallierer übergeben. Ohne die Erlaubnis für unbekannte Quellen geht nichts. */
    fun installieren(context: Context, datei: File): Boolean = false // Host AppUpdateChecker validates Plum package/signature.

    fun quelleErlaubt(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** Öffnet ausschliesslich die Berechtigung für das tatsächliche Hostpaket. */
    fun quelleOeffnen(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /** Im Cache bleibt höchstens die neueste APK. */
    fun aufraeumen(context: Context, behalten: File?) {
        runCatching { ordner(context).listFiles()?.forEach { if (it != behalten) it.delete() } }
    }
}
