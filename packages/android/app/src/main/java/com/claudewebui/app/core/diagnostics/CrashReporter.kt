package com.claudewebui.app.core.diagnostics

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File

/**
 * Records unhandled crashes so they outlive the process that produced them.
 *
 * There was no crash reporting of any kind: an exception on a phone killed the
 * app and left nothing behind — no Crashlytics, no local file, nothing on the
 * server. The only evidence was the user saying "it closed itself".
 *
 * The handler cannot do network I/O — the process is already dying and an HTTP
 * call would be cut off mid-flight — so it writes the trace to a file and lets
 * the next start upload it through [pendingReport] / [clearPendingReport].
 *
 * Deliberately not Crashlytics: that means Firebase, a Google dependency and an
 * account, for a self-hosted client whose own server is the natural place to
 * send this.
 */
object CrashReporter {

    private const val TAG = "CrashReporter"
    private const val CRASH_FILE = "last-crash.txt"
    private const val MAX_TRACE_CHARS = 20_000

    /**
     * Installs the handler, chaining to whatever was there so the system still
     * gets its chance to show the "app stopped" dialog and record its own ANR
     * data. Swallowing that would hide crashes from the platform too.
     */
    fun install(context: Context) {
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                write(appContext, thread, throwable)
            } catch (error: Throwable) {
                // Never let reporting be the reason a crash gets worse.
                Log.e(TAG, "Failed to persist crash report", error)
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun write(context: Context, thread: Thread, throwable: Throwable) {
        val trace = buildString {
            appendLine("thread: ${thread.name}")
            appendLine("device: ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("android: ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})")
            appendLine()
            appendLine(Log.getStackTraceString(throwable))
        }.take(MAX_TRACE_CHARS)

        File(context.filesDir, CRASH_FILE).writeText(trace)
    }

    /** The trace from the previous run, or null if it ended normally. */
    fun pendingReport(context: Context): String? {
        val file = File(context.applicationContext.filesDir, CRASH_FILE)
        if (!file.exists()) return null
        return runCatching { file.readText() }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    /** Called once the report has been accepted, so it is not sent twice. */
    fun clearPendingReport(context: Context) {
        runCatching { File(context.applicationContext.filesDir, CRASH_FILE).delete() }
    }

    fun deviceDescription(): String = "${Build.MANUFACTURER} ${Build.MODEL}"

    fun osDescription(): String = "Android ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})"
}
