package com.claudewebui.app.core.devicecontrol

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/**
 * Accessibility service that drives the phone for Plum sessions: reads the
 * screen, taps, types, scrolls, takes screenshots. The design follows Buddy
 * (github.com/ghorbelhamdi/buddy-android, Apache-2.0): a plain accessibility
 * service — no adb, no root, no pairing beyond the user's own sign-in.
 *
 * The bridge socket lives in [DeviceControlService]; this service only
 * executes the tools and starts/stops the bridge with its own lifetime.
 */
class DeviceControlAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: DeviceControlAccessibilityService? = null
            private set

        val isRunning: Boolean get() = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        if (DeviceControlPrefs.isEnabled(this)) {
            ContextCompat.startForegroundService(this, DeviceControlService.intent(this))
        }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        stopBridge()
        return super.onUnbind(intent)
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        stopBridge()
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun stopBridge() {
        if (instance === this) instance = null
        DeviceControlService.stop(this)
    }

    // ========================================================================
    // Tools — called from DeviceControlService on a worker thread
    // ========================================================================

    fun status(): String {
        val root = rootInActiveWindow
        val pkg = root?.packageName?.toString() ?: "unknown"
        val metrics = resources.displayMetrics
        return listOf(
            "service=running",
            "device=${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})",
            "foreground=$pkg",
            "screen=${metrics.widthPixels}x${metrics.heightPixels}",
        ).joinToString("\n")
    }

    fun readScreen(max: Int): String {
        val root = rootInActiveWindow ?: return "error: no active window"
        val lines = ArrayList<String>(max.coerceAtMost(400) + 4)
        walk(root, 0, lines, max.coerceAtMost(400))
        val header = "screen ${resources.displayMetrics.widthPixels}x${resources.displayMetrics.heightPixels}, foreground ${root.packageName}"
        return if (lines.isEmpty()) "$header\n(no readable elements)" else header + "\n" + lines.joinToString("\n")
    }

    private fun walk(node: AccessibilityNodeInfo, depth: Int, out: MutableList<String>, max: Int) {
        if (out.size >= max) return
        if (!node.isVisibleToUser) return
        val r = Rect().also { node.getBoundsInScreen(it) }
        if (!r.isEmpty) {
            val sb = StringBuilder("[${r.left},${r.top}-${r.right},${r.bottom}]")
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty()) sb.append(" \"").append(text.take(160)).append('"')
            val desc = node.contentDescription?.toString()?.trim().orEmpty()
            if (desc.isNotEmpty()) sb.append(" desc=\"").append(desc.take(80)).append('"')
            node.viewIdResourceName?.let { sb.append(" id=").append(it.take(120)) }
            if (node.isClickable) sb.append(" clickable")
            if (node.isEditable) sb.append(" editable")
            if (node.isScrollable) sb.append(" scrollable")
            out.add(sb.toString())
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            walk(child, depth + 1, out, max)
        }
    }

    suspend fun tap(x: Float, y: Float, holdMs: Long = 60): String =
        when (gesture(x, y, x, y, holdMs)) {
            true -> "Tapped (${x.toInt()}, ${y.toInt()})."
            false -> "Gesture was cancelled at (${x.toInt()}, ${y.toInt()}); read_screen to see the current state."
        }

    suspend fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): String =
        when (gesture(x1, y1, x2, y2, durationMs)) {
            true -> "Swiped (${x1.toInt()},${y1.toInt()}) → (${x2.toInt()},${y2.toInt()}) over ${durationMs}ms."
            false -> "Swipe was cancelled; read_screen to see the current state."
        }

    private suspend fun gesture(
        x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long
    ): Boolean {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(20, 10_000))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val done = CompletableDeferred<Boolean>()
        dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) { done.complete(true) }
            override fun onCancelled(gestureDescription: GestureDescription?) { done.complete(false) }
        }, null)
        return withTimeoutOrNull(TimeUnit.SECONDS.toMillis(12)) { done.await() } ?: false
    }

    fun typeText(text: String): String {
        val field = findFocusedInput()
            ?: return "error: no focused text field; tap a field first, then type"
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        val ok = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        return if (ok) "Typed into the focused field." else "error: the focused field refused the text"
    }

    private fun findFocusedInput(): AccessibilityNodeInfo? {
        val editable = ArrayList<AccessibilityNodeInfo>()
        for (w in windows) {
            if (w.type == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY ||
                w.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD
            ) continue
            val root = w.root ?: continue
            root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                ?.takeIf { it.isEditable }?.let { return it }
            collectEditable(root, editable)
        }
        return editable.singleOrNull()
    }

    private fun collectEditable(node: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>) {
        if (node == null || out.size > 1 || !node.isVisibleToUser) return
        if (node.isEditable && node.isEnabled) out.add(node)
        for (i in 0 until node.childCount) collectEditable(node.getChild(i), out)
    }

    fun press(key: String): String {
        val action = when (key.lowercase().trim()) {
            "back" -> AccessibilityService.GLOBAL_ACTION_BACK
            "home" -> AccessibilityService.GLOBAL_ACTION_HOME
            "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
            "notifications" -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
            else -> return "error: unknown key \"$key\" (back, home, recents, notifications, quick_settings)"
        }
        return if (performGlobalAction(action)) "Pressed $key." else "error: $key was refused"
    }

    fun openApp(packageName: String): String {
        val intent = packageManager.getLaunchIntentForPackage(packageName.trim())
            ?: return "error: no launchable app \"$packageName\"; use list_apps for package names"
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        return "Launched $packageName."
    }

    fun listApps(): String {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = packageManager.queryIntentActivities(intent, 0)
            .map { "${it.loadLabel(packageManager)} — ${it.activityInfo.packageName}" }
            .sorted()
        return if (apps.isEmpty()) "No launchable apps found." else apps.take(300).joinToString("\n")
    }

    /** Screenshot via the accessibility API (Android 11+), scaled and PNG-encoded. */
    suspend fun screenshot(scale: Double): String = withContext(Dispatchers.Default) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return@withContext "error: screenshots need Android 11+"
        }
        val done = CompletableDeferred<String>()
        takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor,
            object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                    try {
                        val hardware = screenshot.hardwareBuffer ?: run {
                            done.complete("error: empty screenshot buffer"); return
                        }
                        val bitmap = Bitmap.wrapHardwareBuffer(hardware, null)
                        if (bitmap == null) {
                            hardware.close(); done.complete("error: could not wrap screenshot"); return
                        }
                        val software = bitmap.copy(Bitmap.Config.ARGB_8888, false)
                        bitmap.recycle()
                        hardware.close()
                        val factor = scale.coerceIn(0.2, 1.0)
                        val w = (software.width * factor).toInt().coerceAtLeast(1)
                        val h = (software.height * factor).toInt().coerceAtLeast(1)
                        val scaled = Bitmap.createScaledBitmap(software, w, h, true)
                        val bytes = ByteArrayOutputStream().use { stream ->
                            scaled.compress(Bitmap.CompressFormat.PNG, 90, stream)
                            stream.toByteArray()
                        }
                        software.recycle()
                        if (scaled !== software) scaled.recycle()
                        done.complete(Base64.encodeToString(bytes, Base64.NO_WRAP))
                    } catch (failure: Exception) {
                        done.complete("error: ${failure.message}")
                    }
                }

                override fun onFailure(errorCode: Int) {
                    done.complete("error: screenshot failed with code $errorCode")
                }
            })
        withTimeoutOrNull(TimeUnit.SECONDS.toMillis(15)) { done.await() } ?: "error: screenshot timed out"
    }
}
