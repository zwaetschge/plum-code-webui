package com.claudewebui.swarm.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipInputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Hilfen für Brian in Allgemein (Nachtrag zu App 2.2): In Matrix liest er PDF und Word nicht, Bilder und
 * Textdateien schon. Deshalb schickt die App zu einer PDF die ersten Seiten als Bilder, zu einer `.docx`
 * den Text als `.txt` und zu einer `.xlsx` das erste Blatt als `.csv`. In anderen Räumen gibt es das nicht.
 */
object BrianHilfe {
    private const val SEITEN_MAX = 8
    private const val KANTE = 1600
    private const val ZEILEN_MAX = 5_000

    fun istPdf(a: Anhang) = a.mime == "application/pdf" || a.name.endsWith(".pdf", ignoreCase = true)

    fun istDocx(a: Anhang) = a.mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        a.name.endsWith(".docx", ignoreCase = true)

    fun istXlsx(a: Anhang) = a.mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        a.name.endsWith(".xlsx", ignoreCase = true)

    /** Was zusätzlich mitgeht, als Satz für die Eingabe; `null`, wenn nichts. */
    fun hinweis(a: Anhang, pdfSeiten: Boolean): String? = when {
        istPdf(a) -> if (pdfSeiten) "Für Brian gehen die ersten Seiten (bis $SEITEN_MAX) als Bilder mit." else null
        istDocx(a) -> "Für Brian geht der Text als .txt mit."
        istXlsx(a) -> "Für Brian geht das erste Blatt als .csv mit."
        else -> null
    }

    /** Die Zusätze; was sich nicht aufbereiten lässt, fällt weg, die Datei selbst geht trotzdem. */
    fun zusaetze(context: Context, a: Anhang, pdfSeiten: Boolean): List<Anhang> = runCatching {
        when {
            istPdf(a) -> if (pdfSeiten) seitenAlsBilder(context, a) else emptyList()
            istDocx(a) -> listOfNotNull(wordText(a))
            istXlsx(a) -> listOfNotNull(ersteTabelle(a))
            else -> emptyList()
        }
    }.getOrDefault(emptyList())

    private fun basis(a: Anhang) = a.name.substringBeforeLast('.').ifBlank { "datei" }

    /** Die ersten Seiten als JPEG, etwa 1600 px an der langen Seite, auf weissem Grund. */
    private fun seitenAlsBilder(context: Context, a: Anhang): List<Anhang> {
        val ordner = File(context.cacheDir, "pdf-seiten").apply { mkdirs() }
        val quelle = File(ordner, "quelle-${System.currentTimeMillis()}.pdf")
        quelle.writeBytes(a.daten)
        val aus = ArrayList<Anhang>()
        try {
            ParcelFileDescriptor.open(quelle, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                val r = PdfRenderer(fd)
                try {
                    for (i in 0 until min(SEITEN_MAX, r.pageCount)) {
                        val seite = r.openPage(i)
                        try {
                            val f = KANTE.toFloat() / max(seite.width, seite.height).coerceAtLeast(1)
                            val w = (seite.width * f).roundToInt().coerceAtLeast(1)
                            val h = (seite.height * f).roundToInt().coerceAtLeast(1)
                            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                            bmp.eraseColor(Color.WHITE)
                            seite.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            val jpeg = ByteArrayOutputStream()
                            bmp.compress(Bitmap.CompressFormat.JPEG, 85, jpeg)
                            bmp.recycle()
                            aus += Anhang(jpeg.toByteArray(), "image/jpeg", "${basis(a)}-seite-${i + 1}.jpg", AnhangArt.BILD, w, h)
                        } finally {
                            seite.close()
                        }
                    }
                } finally {
                    r.close()
                }
            }
        } finally {
            quelle.delete()
        }
        return aus
    }

    private fun zipEintrag(daten: ByteArray, name: String): ByteArray? {
        ZipInputStream(daten.inputStream()).use { z ->
            while (true) {
                val e = z.nextEntry ?: return null
                if (e.name == name) return z.readBytes()
            }
        }
    }

    private fun leser(xml: ByteArray): XmlPullParser = Xml.newPullParser().apply {
        setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        setInput(xml.inputStream(), "UTF-8")
    }

    /** Der Text einer `.docx`: je Absatz (`w:p`) eine Zeile, aus den Läufen `w:t`. */
    private fun wordText(a: Anhang): Anhang? {
        val xml = zipEintrag(a.daten, "word/document.xml") ?: return null
        val p = leser(xml)
        val alles = StringBuilder()
        val absatz = StringBuilder()
        var imText = false
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "w:t" -> imText = true
                    "w:tab" -> absatz.append('\t')
                    "w:br", "w:cr" -> absatz.append('\n')
                }
                XmlPullParser.TEXT -> if (imText) absatz.append(p.text)
                XmlPullParser.END_TAG -> when (p.name) {
                    "w:t" -> imText = false
                    "w:p" -> {
                        alles.append(absatz.toString().trimEnd()).append('\n')
                        absatz.clear()
                    }
                }
            }
        }
        val text = alles.toString().replace(Regex("""\n{3,}"""), "\n\n").trim()
        if (text.isEmpty()) return null
        return Anhang(text.toByteArray(), "text/plain", "${basis(a)}.txt", AnhangArt.DATEI)
    }

    /** Das erste Blatt einer `.xlsx` als CSV: geteilte Texte (`sharedStrings`) plus `sheet1`. */
    private fun ersteTabelle(a: Anhang): Anhang? {
        val geteilt = zipEintrag(a.daten, "xl/sharedStrings.xml")?.let { geteilteTexte(it) }.orEmpty()
        val blatt = zipEintrag(a.daten, "xl/worksheets/sheet1.xml") ?: return null
        val p = leser(blatt)
        val zeilen = ArrayList<MutableMap<Int, String>>()
        var zeile: MutableMap<Int, String>? = null
        var spalte = 0
        var typ: String? = null
        var imWert = false
        val wert = StringBuilder()
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "row" -> {
                        if (zeilen.size >= ZEILEN_MAX) break
                        zeile = HashMap<Int, String>().also { zeilen += it }
                    }
                    "c" -> {
                        spalte = spalteAus(p.getAttributeValue(null, "r")) ?: (zeile?.keys?.maxOrNull()?.plus(1) ?: 0)
                        typ = p.getAttributeValue(null, "t")
                        wert.clear()
                    }
                    "v", "t" -> imWert = true
                }
                XmlPullParser.TEXT -> if (imWert) wert.append(p.text)
                XmlPullParser.END_TAG -> when (p.name) {
                    "v", "t" -> imWert = false
                    "c" -> {
                        val roh = wert.toString()
                        val text = if (typ == "s") roh.trim().toIntOrNull()?.let { geteilt.getOrNull(it) } ?: roh else roh
                        if (text.isNotEmpty()) zeile?.put(spalte, text)
                    }
                }
            }
        }
        if (zeilen.all { it.isEmpty() }) return null
        val breite = (zeilen.flatMap { it.keys }.maxOrNull() ?: 0) + 1
        val csv = zeilen.joinToString("\n") { z -> (0 until breite).joinToString(",") { i -> csvFeld(z[i].orEmpty()) } }.trimEnd()
        return Anhang(csv.toByteArray(), "text/csv", "${basis(a)}.csv", AnhangArt.DATEI)
    }

    private fun geteilteTexte(xml: ByteArray): List<String> {
        val p = leser(xml)
        val aus = ArrayList<String>()
        val si = StringBuilder()
        var imText = false
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "si" -> si.clear()
                    "t" -> imText = true
                }
                XmlPullParser.TEXT -> if (imText) si.append(p.text)
                XmlPullParser.END_TAG -> when (p.name) {
                    "t" -> imText = false
                    "si" -> aus += si.toString()
                }
            }
        }
        return aus
    }

    /** „AB12“ → Spalte 27 (ab 0). */
    private fun spalteAus(ref: String?): Int? {
        val buchstaben = ref?.takeWhile { it.isLetter() }?.uppercase()?.ifEmpty { null } ?: return null
        return buchstaben.fold(0) { acc, c -> acc * 26 + (c - 'A' + 1) } - 1
    }

    private fun csvFeld(s: String): String =
        if (s.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + s.replace("\"", "\"\"") + "\"" else s
}
