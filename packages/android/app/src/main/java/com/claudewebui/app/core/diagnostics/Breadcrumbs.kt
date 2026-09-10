package com.claudewebui.app.core.diagnostics

import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The last few hundred things the app did, kept in memory for the crash report.
 *
 * A stack trace says where the process died, not how it got there. Whether the
 * socket had just reconnected, which screen was open, whether the app was
 * coming back from the background — none of that is in the trace, and it is
 * usually the half of the story that explains the crash. Callers drop a line
 * here at the interesting moments and [CrashReporter] appends the whole buffer
 * to the report.
 *
 * Categories in use: `lifecycle` (Application/Activity callbacks), `nav`
 * (destination changes, see [currentRoute]), `socket` (connection state, set
 * by the network layer). Anything else is fine; the category is only a prefix.
 *
 * Pure Kotlin/JVM on purpose so it is usable from unit tests and from code
 * that has no Context. Thread-safe: every call synchronises on the buffer.
 */
object Breadcrumbs {

    /** Ring size. 200 lines is roughly the last few minutes of normal use. */
    const val CAPACITY = 200

    /** Longer messages are cut so one chatty caller cannot eat the whole budget. */
    private const val MAX_MESSAGE_CHARS = 300

    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm:ss.SSS", Locale.US)

    private val lock = Any()
    private val buffer = ArrayDeque<String>(CAPACITY)
    private var route: String? = null

    /**
     * The navigation destination currently on screen, or null before the first
     * one is known. MainActivity sets it from the NavController's destination
     * listener; anything else that navigates outside that controller (a
     * dialog activity, a widget config screen) may set it too. Assigning a
     * non-null value also records a `nav` breadcrumb, so callers do not need
     * to do both.
     */
    var currentRoute: String?
        get() = synchronized(lock) { route }
        set(value) {
            synchronized(lock) { route = value }
            if (value != null) add("nav", value)
        }

    /** Appends one line; the oldest line is dropped once [CAPACITY] is reached. */
    fun add(category: String, message: String) {
        val line = buildString {
            append(timeFormat.format(LocalTime.now()))
            append(" [")
            append(category.trim().ifEmpty { "app" })
            append("] ")
            append(sanitize(message))
        }
        synchronized(lock) {
            if (buffer.size >= CAPACITY) buffer.removeFirst()
            buffer.addLast(line)
        }
    }

    /** Every recorded line, oldest first, as `HH:mm:ss.SSS [category] message`. */
    fun snapshot(): List<String> = synchronized(lock) { buffer.toList() }

    /** Empties the buffer and forgets the current route. */
    fun clear() {
        synchronized(lock) {
            buffer.clear()
            route = null
        }
    }

    private fun sanitize(message: String): String {
        val single = message.replace('\n', ' ').replace('\r', ' ').trim()
        return if (single.length <= MAX_MESSAGE_CHARS) single
        else single.take(MAX_MESSAGE_CHARS - 1) + "…"
    }
}
