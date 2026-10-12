package com.claudewebui.swarm

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import java.io.File

/**
 * „Teilen → Schwarm“ (App 2.1): nimmt Text oder ein Bild aus einer anderen App und reicht beides an
 * die laufende App weiter, als neuen Chat in Allgemein. Ohne eigene Oberfläche; so landet der Chat in
 * der Aufgabe der App statt in der Aufgabe der teilenden App, und der Sync läuft nicht doppelt.
 *
 * Ein Bild liest die Activity gleich hier, solange die Leseberechtigung der teilenden App gilt, und
 * legt es als private Datei in den Cache. Weitergereicht wird nur diese Datei: Eine fremde Berechtigung
 * darf die App nicht an sich selbst weitergeben.
 */
class TeilenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val quelle = intent
        if (quelle?.action == Intent.ACTION_SEND) {
            val ziel = Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_SEND
                quelle.getStringExtra(Intent.EXTRA_TEXT)?.let { putExtra(Intent.EXTRA_TEXT, it.take(20_000)) }
                quelle.getStringExtra(Intent.EXTRA_SUBJECT)?.let { putExtra(Intent.EXTRA_SUBJECT, it.take(500)) }
                if (quelle.type?.startsWith("image/") == true) {
                    val bild = IntentCompat.getParcelableExtra(quelle, Intent.EXTRA_STREAM, Uri::class.java)
                    val datei = bild?.let { runCatching { kopieren(it, quelle.type) }.getOrNull() }
                    if (datei != null) putExtra(MainActivity.BILD_DATEI, datei.absolutePath)
                    else putExtra(MainActivity.BILD_FEHLER, true)
                }
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            startActivity(ziel)
        }
        finish()
    }

    /** Höchstens 25 MB; ältere geteilte Bilder fliegen vorher raus. */
    private fun kopieren(uri: Uri, typ: String?): File? {
        val ordner = File(cacheDir, GETEILT).apply { mkdirs() }
        ordner.listFiles()?.forEach { it.delete() }
        val mime = contentResolver.getType(uri) ?: typ ?: "image/jpeg"
        val endung = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "jpg"
        val datei = File(ordner, "bild-${System.currentTimeMillis()}.$endung")
        contentResolver.openInputStream(uri)?.use { ein ->
            datei.outputStream().use { aus ->
                val puffer = ByteArray(64 * 1024)
                var gesamt = 0L
                while (true) {
                    val n = ein.read(puffer)
                    if (n < 0) break
                    gesamt += n
                    if (gesamt > 25_000_000L) {
                        datei.delete()
                        return null
                    }
                    aus.write(puffer, 0, n)
                }
            }
        } ?: return null
        return datei
    }

    companion object {
        /** Unterordner im Cache für geteilte Bilder. */
        const val GETEILT = "geteilt"
    }
}
