package com.claudewebui.app

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.core.notifications.NotificationPreferences
import com.claudewebui.app.core.notifications.NotificationService
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native delivery must work while an Activity is visible, without an app banner. */
class SystemNotificationsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun foregroundNotificationsReachAndroidWithActionsAndDeepLinks() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        if (Build.VERSION.SDK_INT >= 33) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName, Manifest.permission.POST_NOTIFICATIONS
            )
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val tag = "system-delivery-${System.nanoTime()}"
        val enabled = NotificationPreferences.isEnabled(context)
        val foreground = LocalNotificationManager.foreground.value
        compose.setContent { Text("Session open") }
        try {
            NotificationPreferences.setEnabled(context, true)
            LocalNotificationManager.onAppForegrounded()
            NotificationService.createChannels(context)
            NotificationService.notifySessionCompleted(context, tag, "Fixture", "Reply body", "Answer ready")
            NotificationService.notifyError(context, tag, "Fixture", "Error body")
            NotificationService.notifyPermissionRequest(context, tag, "Fixture", "Read", "permission-fixture")
            NotificationService.notifyQuestion(context, tag, "Fixture", "Continue?", listOf("Yes", "No"), true, "question-fixture", null)

            compose.waitUntil(5_000) { manager.activeNotifications.count { it.tag == tag } == 4 }
            val notifications = manager.activeNotifications.filter { it.tag == tag }.map { it.notification }
            assertTrue(notifications.all { it.contentIntent != null })
            val reply = notifications.single { it.channelId == NotificationService.SESSION_UPDATES_CHANNEL }
            assertEquals("Reply body", reply.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString())
            val prompts = notifications.filter { it.channelId == NotificationService.PERMISSION_REQUESTS_CHANNEL }
            assertEquals(2, prompts.size)
            assertTrue(prompts.all { it.actions.size == 3 })
            assertTrue(prompts.any { it.actions.any { action -> !action.remoteInputs.isNullOrEmpty() } })
        } finally {
            NotificationService.cancelSessionNotifications(context, tag)
            NotificationPreferences.setEnabled(context, enabled)
            if (!foreground) LocalNotificationManager.onAppBackgrounded()
        }
    }

    @Test fun disabledNotificationsStaySilentInForeground() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val tag = "system-disabled-${System.nanoTime()}"
        val enabled = NotificationPreferences.isEnabled(context)
        compose.setContent { Text("Session open") }
        try {
            NotificationPreferences.setEnabled(context, false)
            NotificationService.notifySessionCompleted(context, tag, "Fixture", "Reply body")
            NotificationService.notifyError(context, tag, "Fixture", "Error body")
            NotificationService.notifyPermissionRequest(context, tag, "Fixture", "Read", "permission-fixture")
            NotificationService.notifyQuestion(context, tag, "Fixture", "Continue?", listOf("Yes"), false, "question-fixture", null)
            assertTrue(manager.activeNotifications.none { it.tag == tag })
        } finally {
            NotificationService.cancelSessionNotifications(context, tag)
            NotificationPreferences.setEnabled(context, enabled)
        }
    }
}
