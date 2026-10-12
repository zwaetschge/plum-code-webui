package com.claudewebui.swarm.data

import android.content.Context
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.PI
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Dateien aller Art (SCHNITTSTELLEN-app.md, App 2.2): Bild, Video, Audio, beliebige Datei und die
 * Sprachnachricht. Das Event wählt die App nach dem MIME-Typ.
 */
enum class AnhangArt(val msgtype: String) {
    BILD("m.image"),
    VIDEO("m.video"),
    AUDIO("m.audio"),
    DATEI("m.file"),
    SPRACHE("m.audio");

    companion object {
        fun vonMime(mime: String): AnhangArt = when {
            mime.startsWith("image/") -> BILD
            mime.startsWith("video/") -> VIDEO
            mime.startsWith("audio/") -> AUDIO
            else -> DATEI
        }
    }
}

/** Ein Anhang, bereit zum Hochladen. */
class Anhang(
    val daten: ByteArray,
    val mime: String,
    val name: String,
    val art: AnhangArt,
    val breite: Int? = null,
    val hoehe: Int? = null,
    val dauerMs: Long? = null,
    /** Pegel der Sprachnachricht, 0–1024, für die Welle. */
    val welle: List<Int>? = null,
    /** Zum Zeigen in der Eingabe (nur bei Bildern). */
    val vorschau: android.graphics.Bitmap? = null,
) {
    val groesse: Long get() = daten.size.toLong()
}

/** Grösser liest die App keine Datei in den Speicher, auch wenn der Server mehr nähme. */
const val ANHANG_MAX_BYTES = 200_000_000L

object AnhangLeser {
    private val zeitstempel get() = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())

    /** Name und Grösse aus dem ContentResolver; ohne Namen einer aus Typ und Zeit. */
    private fun nameUndGroesse(context: Context, uri: Uri, mime: String): Pair<String, Long?> {
        var name: String? = null
        var groesse: Long? = null
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    name = c.getString(0)
                    groesse = if (c.isNull(1)) null else c.getLong(1)
                }
            }
        }
        if (name.isNullOrBlank() && uri.scheme == "file") name = uri.lastPathSegment
        val endung = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
        val sicher = name?.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_")?.trim()?.take(120)?.ifBlank { null }
            ?: "datei-$zeitstempel" + (endung?.let { ".$it" } ?: "")
        return sicher to groesse
    }

    fun mimeVon(context: Context, uri: Uri): String =
        context.contentResolver.getType(uri)
            ?: uri.lastPathSegment?.substringAfterLast('.', "")?.lowercase()?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
            ?: "application/octet-stream"

    /**
     * Eine Datei aus dem Photo Picker oder der Dokumentenauswahl lesen. Bilder aus dem Picker werden wie
     * bisher verkleinert (`verkleinern`); eine Datei aus der Dokumentenauswahl geht unverändert raus.
     */
    fun vorbereiten(context: Context, uri: Uri, verkleinern: Boolean): Anhang {
        val mime = mimeVon(context, uri)
        val art = AnhangArt.vonMime(mime)
        if (art == AnhangArt.BILD && verkleinern && mime != "image/gif") {
            val b = Bilder.vorbereiten(context, uri)
            return Anhang(b.daten, b.mime, b.name, AnhangArt.BILD, b.breite, b.hoehe, vorschau = b.vorschau)
        }
        val (name, groesse) = nameUndGroesse(context, uri, mime)
        if (groesse != null && groesse > ANHANG_MAX_BYTES) {
            throw IllegalStateException("Die Datei ist zu gross (${groesse / 1_000_000} MB).")
        }
        val daten = context.contentResolver.openInputStream(uri)?.use { ein ->
            val aus = ByteArrayOutputStream()
            val puffer = ByteArray(64 * 1024)
            var gesamt = 0L
            while (true) {
                val n = ein.read(puffer)
                if (n < 0) break
                gesamt += n
                if (gesamt > ANHANG_MAX_BYTES) throw IllegalStateException("Die Datei ist zu gross (über ${ANHANG_MAX_BYTES / 1_000_000} MB).")
                aus.write(puffer, 0, n)
            }
            aus.toByteArray()
        } ?: throw IllegalStateException("Die Datei liess sich nicht öffnen.")
        return when (art) {
            AnhangArt.BILD -> {
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(daten, 0, daten.size, o)
                Anhang(
                    daten, mime, name, art,
                    o.outWidth.takeIf { it > 0 }, o.outHeight.takeIf { it > 0 },
                    vorschau = Bilder.dekodieren(daten, 480),
                )
            }
            AnhangArt.VIDEO, AnhangArt.AUDIO -> {
                val (dauer, groessen) = metadaten(context, uri)
                Anhang(daten, mime, name, art, groessen?.first, groessen?.second, dauer)
            }
            else -> Anhang(daten, mime, name, art)
        }
    }

    /** Dauer und, bei Video, Breite und Höhe. */
    private fun metadaten(context: Context, uri: Uri): Pair<Long?, Pair<Int, Int>?> {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(context, uri)
            val dauer = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            val b = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
            val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
            val drehung = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val groessen = if (b != null && h != null) (if (drehung == 90 || drehung == 270) h to b else b to h) else null
            dauer to groessen
        } catch (e: Exception) {
            null to null
        } finally {
            runCatching { r.release() }
        }
    }

    /** Eine fertige Sprachnachricht aus der Aufnahme. */
    fun sprache(datei: File, mime: String, dauerMs: Long, welle: List<Int>): Anhang {
        val endung = if (mime == "audio/ogg") "ogg" else "m4a"
        return Anhang(
            datei.readBytes(), mime, "sprachnachricht-$zeitstempel.$endung", AnhangArt.SPRACHE,
            dauerMs = dauerMs, welle = welle,
        )
    }
}

/**
 * Eine Sprachnachricht aufnehmen: ab API 29 OGG/Opus, sonst AAC in MP4 (m4a). Der Pegel kommt aus
 * `maxAmplitude` und wird zur Welle (0–1024) für `org.matrix.msc1767.audio`.
 */
class Aufnahme(private val context: Context) {
    private var rec: MediaRecorder? = null
    val datei: File
    val mime: String = if (Build.VERSION.SDK_INT >= 29) "audio/ogg" else "audio/mp4"
    private val start = System.currentTimeMillis()
    private val pegel = ArrayList<Int>()

    init {
        val ordner = File(context.cacheDir, "aufnahme").apply { mkdirs() }
        ordner.listFiles()?.forEach { it.delete() }
        datei = File(ordner, "sprache-${System.currentTimeMillis()}." + if (mime == "audio/ogg") "ogg" else "m4a")
    }

    fun starten() {
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        if (Build.VERSION.SDK_INT >= 29) {
            r.setOutputFormat(MediaRecorder.OutputFormat.OGG)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
            r.setAudioSamplingRate(48_000)
            r.setAudioEncodingBitRate(32_000)
        } else {
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(44_100)
            r.setAudioEncodingBitRate(64_000)
        }
        r.setAudioChannels(1)
        r.setOutputFile(datei.absolutePath)
        r.prepare()
        r.start()
        rec = r
    }

    val dauerMs: Long get() = System.currentTimeMillis() - start

    /** Der aktuelle Pegel, 0–1, logarithmisch; merkt ihn für die Welle. */
    fun pegel(): Float {
        val roh = runCatching { rec?.maxAmplitude ?: 0 }.getOrDefault(0)
        val wert = if (roh <= 0) 0f else ((20 * log10(roh / 32767.0) + 50) / 50).toFloat().coerceIn(0f, 1f)
        pegel += (wert * 1024).roundToInt()
        return wert
    }

    /** Beenden; `behalten` false löscht die Datei. Liefert die Welle mit höchstens 100 Werten. */
    fun beenden(behalten: Boolean): List<Int> {
        runCatching { rec?.stop() }
        runCatching { rec?.release() }
        rec = null
        if (!behalten) datei.delete()
        return welleVerdichten(pegel, 100)
    }

    companion object {
        fun welleVerdichten(werte: List<Int>, anzahl: Int): List<Int> {
            if (werte.isEmpty()) return emptyList()
            if (werte.size <= anzahl) return werte
            val schritt = werte.size.toDouble() / anzahl
            return (0 until anzahl).map { i ->
                val von = (i * schritt).toInt()
                val bis = min(werte.size, max(von + 1, ((i + 1) * schritt).toInt()))
                werte.subList(von, bis).max()
            }
        }
    }
}

/** Töne und Dateien für die Vorschau: nichts davon kommt vom Server. */
object VorschauMedien {
    /** WAV, 16 Bit mono; `toene`: Frequenz in Hz und Länge in ms, 0 Hz ist Stille. */
    fun wav(toene: List<Pair<Double, Int>>, rate: Int = 24_000): ByteArray {
        val proben = toene.sumOf { it.second * rate / 1000 }
        val pcm = ByteArray(proben * 2)
        var i = 0
        for ((hz, ms) in toene) {
            val n = ms * rate / 1000
            for (k in 0 until n) {
                // Sanft ein- und ausblenden, damit es nicht knackt.
                val huelle = min(1.0, min(k, n - k) / (rate * 0.012))
                val s = if (hz <= 0) 0.0 else sin(2 * PI * hz * k / rate) * 0.35 * huelle
                val v = (s * 32767).toInt()
                pcm[i++] = (v and 0xff).toByte()
                pcm[i++] = ((v shr 8) and 0xff).toByte()
            }
        }
        val aus = ByteArrayOutputStream()
        fun int(v: Int) = aus.write(byteArrayOf((v and 0xff).toByte(), ((v shr 8) and 0xff).toByte(), ((v shr 16) and 0xff).toByte(), ((v shr 24) and 0xff).toByte()))
        fun kurz(v: Int) = aus.write(byteArrayOf((v and 0xff).toByte(), ((v shr 8) and 0xff).toByte()))
        aus.write("RIFF".toByteArray()); int(36 + pcm.size); aus.write("WAVE".toByteArray())
        aus.write("fmt ".toByteArray()); int(16); kurz(1); kurz(1); int(rate); int(rate * 2); kurz(2); kurz(16)
        aus.write("data".toByteArray()); int(pcm.size); aus.write(pcm)
        return aus.toByteArray()
    }

    /** Eine kleine Tonfolge statt Sprache; `stueck` ändert die Melodie. */
    fun sprechprobe(stueck: Int, sekunden: Double = 1.6): ByteArray {
        val grund = listOf(392.0, 440.0, 494.0, 523.0)
        val n = (sekunden * 1000 / 200).toInt().coerceAtLeast(3)
        return wav((0 until n).map { k -> (if (k % 4 == 3) 0.0 else grund[(k + stueck) % grund.size] * (1 + (k % 2) * 0.25)) to 200 })
    }

    /** Ein gültiges, kleines PDF mit einer Seite Text. */
    fun pdf(zeilen: List<String>): ByteArray {
        val text = zeilen.mapIndexed { i, z ->
            val sauber = z.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            "BT /F1 ${if (i == 0) 18 else 12} Tf 56 ${760 - i * 26} Td ($sauber) Tj ET"
        }.joinToString("\n")
        val objekte = listOf(
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            "<< /Length ${text.toByteArray(Charsets.ISO_8859_1).size} >>\nstream\n$text\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        )
        val aus = ByteArrayOutputStream()
        val versatz = ArrayList<Int>()
        aus.write("%PDF-1.4\n".toByteArray(Charsets.ISO_8859_1))
        objekte.forEachIndexed { i, o ->
            versatz += aus.size()
            aus.write("${i + 1} 0 obj\n$o\nendobj\n".toByteArray(Charsets.ISO_8859_1))
        }
        val xref = aus.size()
        val tabelle = buildString {
            append("xref\n0 ${objekte.size + 1}\n0000000000 65535 f \n")
            versatz.forEach { append(String.format(Locale.ROOT, "%010d 00000 n \n", it)) }
            append("trailer\n<< /Size ${objekte.size + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
        }
        aus.write(tabelle.toByteArray(Charsets.ISO_8859_1))
        return aus.toByteArray()
    }
}
