package com.claudewebui.swarm.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.media.ExifInterface
import android.net.Uri
import android.webkit.MimeTypeMap
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/** Ein Bild aus dem Photo Picker, bereit zum Hochladen: höchstens [BILD_KANTE] px, als JPEG oder PNG. */
class Bildwahl(
    val daten: ByteArray,
    val mime: String,
    val breite: Int,
    val hoehe: Int,
    val name: String,
    /** Zum Zeigen in der Eingabe, bevor es rausgeht. */
    val vorschau: Bitmap,
)

/** Grösser schickt die App kein Bild: Für Brian reicht das, und es geht schnell über Mobilfunk. */
const val BILD_KANTE = 2048
private const val PNG_MAX_BYTES = 4_000_000

object Bilder {
    /**
     * Das gewählte Bild lesen, drehen wie im EXIF vermerkt und verkleinern. Ein PNG in erlaubter Grösse
     * bleibt, wie es ist (Bildschirmfotos mit Text bleiben scharf), alles andere wird JPEG (Qualität 85).
     */
    fun vorbereiten(context: Context, uri: Uri): Bildwahl {
        val cr = context.contentResolver
        val roh = cr.openInputStream(uri)?.use { it.readBytes() } ?: throw IllegalStateException("Das Bild liess sich nicht öffnen.")
        // Eigene Dateien (geteilte Bilder im Cache) kennt der ContentResolver nicht: Typ aus der Endung.
        val mime = cr.getType(uri)
            ?: uri.lastPathSegment?.substringAfterLast('.', "")?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.lowercase()) }
            ?: "image/jpeg"
        val grenzen = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(roh, 0, roh.size, grenzen)
        if (grenzen.outWidth <= 0 || grenzen.outHeight <= 0) throw IllegalStateException("Das ist kein Bild, das die App lesen kann.")
        val drehung = runCatching {
            when (ExifInterface(roh.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }.getOrDefault(0)
        val name = "bild-" + SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
        val unveraendert = mime == "image/png" && drehung == 0 && roh.size <= PNG_MAX_BYTES &&
            max(grenzen.outWidth, grenzen.outHeight) <= BILD_KANTE
        if (unveraendert) {
            val bmp = dekodieren(roh, 640) ?: throw IllegalStateException("Das Bild liess sich nicht lesen.")
            return Bildwahl(roh, "image/png", grenzen.outWidth, grenzen.outHeight, "$name.png", bmp)
        }
        var bmp = dekodieren(roh, BILD_KANTE) ?: throw IllegalStateException("Das Bild liess sich nicht lesen.")
        if (drehung != 0) {
            val m = Matrix().apply { postRotate(drehung.toFloat()) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val aus = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, aus)
        return Bildwahl(aus.toByteArray(), "image/jpeg", bmp.width, bmp.height, "$name.jpg", bmp)
    }

    /** Dekodieren, höchstens `kante` px an der längeren Seite. */
    fun dekodieren(daten: ByteArray, kante: Int): Bitmap? {
        val grenzen = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(daten, 0, daten.size, grenzen)
        if (grenzen.outWidth <= 0 || grenzen.outHeight <= 0) return null
        var stichprobe = 1
        while (max(grenzen.outWidth, grenzen.outHeight) / (stichprobe * 2) >= kante) stichprobe *= 2
        val bmp = BitmapFactory.decodeByteArray(daten, 0, daten.size, BitmapFactory.Options().apply { inSampleSize = stichprobe })
            ?: return null
        val laenger = max(bmp.width, bmp.height)
        if (laenger <= kante) return bmp
        val f = kante.toFloat() / laenger
        return Bitmap.createScaledBitmap(bmp, (bmp.width * f).roundToInt().coerceAtLeast(1), (bmp.height * f).roundToInt().coerceAtLeast(1), true)
    }

    /** Das Bild im Beispiel-Chat: ein Oleander auf dem Balkon, gemalt statt geladen. */
    fun vorschauBild(): Bitmap {
        val b = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 0f, 600f, 0xFF9CC9F0.toInt(), 0xFFE9F2F8.toInt(), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, 800f, 600f, p)
        p.shader = null
        // Geländer
        p.color = 0xFF8D8F93.toInt()
        c.drawRect(0f, 400f, 800f, 412f, p)
        for (x in 20..780 step 60) c.drawRect(x.toFloat(), 412f, x + 8f, 600f, p)
        // Topf
        p.color = 0xFFB5623A.toInt()
        val topf = Path().apply { moveTo(300f, 470f); lineTo(500f, 470f); lineTo(470f, 600f); lineTo(330f, 600f); close() }
        c.drawPath(topf, p)
        p.color = 0xFF9A4F2C.toInt()
        c.drawRect(290f, 455f, 510f, 480f, p)
        // Blätter: schmal, zu dritt
        p.color = 0xFF2F6B3A.toInt()
        val blaetter = listOf(
            Triple(400f, 330f, -80f), Triple(360f, 300f, -115f), Triple(440f, 300f, -60f), Triple(330f, 360f, -140f),
            Triple(470f, 360f, -40f), Triple(380f, 230f, -100f), Triple(420f, 220f, -75f), Triple(300f, 300f, -150f),
            Triple(500f, 290f, -25f), Triple(350f, 420f, -165f), Triple(450f, 420f, -15f),
        )
        for ((x, y, w) in blaetter) {
            c.save()
            c.rotate(w, x, y)
            c.drawOval(RectF(x, y - 11f, x + 150f, y + 11f), p)
            c.restore()
        }
        p.color = 0xFF3F8A4B.toInt()
        c.drawRect(396f, 250f, 404f, 460f, p)
        // Blüten
        val bluete = listOf(390f to 160f, 330f to 200f, 460f to 180f, 280f to 250f, 520f to 240f, 420f to 120f, 360f to 130f)
        for ((x, y) in bluete) {
            p.color = 0xFFE66A9A.toInt()
            for (i in 0 until 5) {
                c.save()
                c.rotate(i * 72f, x, y)
                c.drawOval(RectF(x - 9f, y - 30f, x + 9f, y), p)
                c.restore()
            }
            p.color = 0xFFFFE08A.toInt()
            c.drawCircle(x, y, 6f, p)
        }
        return b
    }
}
