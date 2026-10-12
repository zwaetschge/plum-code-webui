package com.claudewebui.swarm.data

import android.content.Context
import android.os.Build
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Abstürze melden, ohne Inhalte preiszugeben (Punkt 20). Der Handler schreibt beim Absturz eine kleine Datei:
 * App-Version, Android-Version, Klasse der Ausnahme und die obersten Frames. Keine Nachrichten, keine
 * Event-IDs, keine Tokens — was trotzdem wie ein Bezeichner aussieht, ersetzt [entschaerfen]. Beim nächsten
 * Start schickt die App die Fälle als Notice nach #schwarm-log und löscht sie.
 */
object Absturz {
    private const val ORDNER = "absturz"
    private const val MAX_DATEIEN = 8
    private const val MAX_TEXT = 420

    fun ordner(context: Context): File = File(context.filesDir, ORDNER)

    fun version(context: Context): Pair<Int, String> = runCatching {
        val pi = context.packageManager.getPackageInfo(context.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else @Suppress("DEPRECATION") pi.versionCode
        code to (pi.versionName ?: "?")
    }.getOrDefault(0 to "?")

    /**
     * Bezeichner aus dem Text nehmen: Matrix-IDs, Event-IDs, Raum-IDs, MXC-Adressen und Tokens der Form
     * `syt_…`, `mct_…`, `cc_…`, `wt_…`, `swm_…` werden zu `…`, ebenso lange Hex- oder Base64-Folgen.
     */
    fun entschaerfen(text: String): String {
        var t = text
        for (m in listOf(
            Regex("""[@!$#][A-Za-z0-9._:/=-]{3,}"""),
            Regex("""\b(?:syt|mct|cc|wt|swm|mcp)_[A-Za-z0-9_-]{4,}"""),
            Regex("""mxc://\S+"""),
            Regex("""\b[A-Fa-f0-9]{24,}\b"""),
            Regex("""\b[A-Za-z0-9+/_-]{40,}={0,2}\b"""),
        )) t = t.replace(m, "…")
        return t.replace('\n', ' ').replace('\r', ' ').trim().take(160)
    }

    /** Der Bericht zu einer Ausnahme: eine Zeile, ohne Inhalt. */
    fun bericht(context: Context, t: Throwable): String {
        val (code, name) = version(context)
        val rahmen = t.stackTrace().take(4).joinToString(" · ") {
            "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}"
        }
        val grund = t.message?.let { entschaerfen(it) }?.takeIf { it.isNotBlank() && it != "…" }
        val text = buildString {
            append("📱 App-Absturz $name ($code), Android ${Build.VERSION.RELEASE}: ${t.javaClass.name}")
            if (grund != null) append(" · $grund")
            if (rahmen.isNotBlank()) append(" · bei $rahmen")
        }
        return text.take(MAX_TEXT)
    }

    /** Stacktrace plus Ursachen, höchstens vier Frames insgesamt. */
    private fun Throwable.stackTrace(): List<StackTraceElement> = buildList {
        var t: Throwable? = this@stackTrace
        var tiefen = 0
        while (t != null && tiefen < 3) {
            addAll(t.stackTrace.take(if (tiefen == 0) 4 else 1))
            t = t.cause?.takeIf { it !== t }
            tiefen++
        }
    }

    fun schreiben(context: Context, t: Throwable) {
        runCatching {
            val ordner = ordner(context).apply { mkdirs() }
            // Nicht mehr als MAX_DATEIEN Fälle: die ältesten fliegen raus, bevor der neue dazukommt.
            ordner.listFiles()?.sortedByDescending { it.lastModified() }?.dropLast(MAX_DATEIEN - 1)
                ?.forEach { it.delete() }
            val zeit = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            File(ordner, "$zeit.txt").writeText(bericht(context, t))
        }
    }

    /** Die gemeldeten Fälle, älteste zuerst. */
    fun faelle(context: Context): List<File> =
        runCatching { ordner(context).listFiles()?.sortedBy { it.name }.orEmpty() }.getOrDefault(emptyList())

    fun loeschen(f: File) = runCatching { f.delete() }

    /**
     * Den Standard-Handler ersetzen: erst schreiben, dann weiterreichen, damit Android den Absturz
     * wie gewohnt beendet und im System protokolliert.
     */
    fun haendler(context: Context, vorher: Thread.UncaughtExceptionHandler?): Thread.UncaughtExceptionHandler =
        Thread.UncaughtExceptionHandler { thread, t ->
            schreiben(context, t)
            vorher?.uncaughtException(thread, t)
        }
}
