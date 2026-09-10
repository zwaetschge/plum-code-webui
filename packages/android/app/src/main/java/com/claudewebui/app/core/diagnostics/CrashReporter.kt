package com.claudewebui.app.core.diagnostics

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.claudewebui.app.BuildConfig
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
 *
 * ## What the report contains
 *
 * The server's `POST /api/app/crash-report` schema takes the trace as one
 * bounded `stackTrace` string (plus `appVersion`/`osVersion`/`device`, which
 * the uploader fills separately). Rather than add fields the server would have
 * to learn, the context lives *inside* that string as a header and a trailing
 * breadcrumb section, so an older backend stores it unchanged and a newer one
 * can parse it. Layout:
 *
 * ```
 * thread: main
 * app: 1.5.0 (8)
 * device: Google Pixel 8
 * android: 15 (sdk 35)
 * uptime: 12.4s
 * memory: jvm 41/128 MB used, max 512 MB; system 2.1 GB free, low=false
 * route: chat/{sessionId}
 *
 * <stack trace>
 *
 * --- breadcrumbs (oldest first) ---
 * 14:02:11.031 [lifecycle] Application.onCreate
 * ...
 * ```
 *
 * The first `thread:`/`device:`/`android:` lines and their order are kept as
 * they were, so anything that already parses them keeps working.
 */
object CrashReporter {

    private const val TAG = "CrashReporter"
    private const val CRASH_FILE = "last-crash.txt"

    /** Matches the server-side `stackTrace` bound; anything longer is rejected. */
    private const val MAX_REPORT_CHARS = 20_000

    /**
     * Ceiling for the trace itself so a long chain of causes still leaves room
     * for the breadcrumbs, which are usually the more useful half.
     */
    private const val MAX_TRACE_CHARS = 14_000

    private const val BREADCRUMB_HEADER = "--- breadcrumbs (oldest first) ---"

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
        val report = buildReport(context, thread, throwable)
        File(context.filesDir, CRASH_FILE).writeText(report)
    }

    /**
     * Assembles the full report text. Separate from [write] so the layout can
     * be exercised without a dying process. Every context probe is wrapped:
     * a failing memory query must not cost the stack trace.
     */
    fun buildReport(context: Context, thread: Thread, throwable: Throwable): String {
        val header = buildString {
            appendLine("thread: ${thread.name}")
            appendLine("app: ${appVersionDescription()}")
            appendLine("device: ${deviceDescription()}")
            appendLine("android: ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})")
            appendLine("uptime: ${processUptimeDescription()}")
            appendLine("memory: ${memoryDescription(context)}")
            appendLine("route: ${Breadcrumbs.currentRoute ?: "(unknown)"}")
            appendLine()
        }

        val trace = Log.getStackTraceString(throwable).let {
            if (it.length <= MAX_TRACE_CHARS) it
            else it.take(MAX_TRACE_CHARS) + "\n… trace truncated …\n"
        }

        // Whatever the header and trace leave over goes to breadcrumbs, most
        // recent kept, because the last thing that happened matters most.
        val budget = MAX_REPORT_CHARS - header.length - trace.length -
            BREADCRUMB_HEADER.length - 4
        val crumbs = breadcrumbSection(budget)

        return buildString {
            append(header)
            append(trace)
            if (crumbs.isNotEmpty()) {
                appendLine()
                appendLine(BREADCRUMB_HEADER)
                append(crumbs)
            }
        }.take(MAX_REPORT_CHARS)
    }

    private fun breadcrumbSection(budget: Int): String {
        if (budget <= 0) return ""
        val lines = runCatching { Breadcrumbs.snapshot() }.getOrDefault(emptyList())
        if (lines.isEmpty()) return ""
        val kept = ArrayDeque<String>()
        var used = 0
        for (line in lines.asReversed()) {
            val cost = line.length + 1
            if (used + cost > budget) break
            kept.addFirst(line)
            used += cost
        }
        val dropped = lines.size - kept.size
        return buildString {
            if (dropped > 0) appendLine("… $dropped older breadcrumb(s) omitted …")
            kept.forEach { appendLine(it) }
        }
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

    /** `versionName (versionCode)` from BuildConfig, so it is right even mid-crash. */
    fun appVersionDescription(): String =
        "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    private fun processUptimeDescription(): String = runCatching {
        val ms = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()
        val seconds = ms / 1000.0
        if (seconds < 120) String.format(java.util.Locale.US, "%.1fs", seconds)
        else String.format(java.util.Locale.US, "%dm %ds", (seconds / 60).toLong(), (seconds % 60).toLong())
    }.getOrDefault("(unknown)")

    private fun memoryDescription(context: Context): String = runCatching {
        val runtime = Runtime.getRuntime()
        val usedMb = (runtime.totalMemory() - runtime.freeMemory()) / MB
        val totalMb = runtime.totalMemory() / MB
        val maxMb = runtime.maxMemory() / MB
        val jvm = "jvm $usedMb/$totalMb MB used, max $maxMb MB"

        val system = runCatching {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                ?: return@runCatching null
            val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            val freeGb = info.availMem / GB.toDouble()
            String.format(java.util.Locale.US, "system %.1f GB free, low=%b", freeGb, info.lowMemory)
        }.getOrNull()

        if (system != null) "$jvm; $system" else jvm
    }.getOrDefault("(unknown)")

    private const val MB = 1024L * 1024L
    private const val GB = MB * 1024L
}
