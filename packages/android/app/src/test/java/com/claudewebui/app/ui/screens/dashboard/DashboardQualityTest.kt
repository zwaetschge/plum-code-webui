package com.claudewebui.app.ui.screens.dashboard
import com.claudewebui.app.data.model.*
import org.junit.Test
import org.junit.Assert.*
class DashboardQualityTest {
 @Test fun oldSearchCannotReplaceNewQueryOrAnotherMode() {
  val current = DashboardUiState(searchQuery = "B", searchScope = DashboardSearchScope.MESSAGES)
  assertFalse(acceptsMessageSearch(current, "A")); assertTrue(acceptsMessageSearch(current, "B"))
  assertFalse(acceptsMessageSearch(current.copy(searchScope = DashboardSearchScope.SESSIONS), "B"))
 }
 @Test fun readDoesNotMeanApprovalResolved() {
  val notification = AppNotification("event", sessionId = "session", kind = "approval", readAt = "today", data = NotificationPayload(requestId = "pending"))
  assertTrue(canAnswerFeedApproval(notification, setOf("pending")))
  assertFalse(canAnswerFeedApproval(notification, emptySet()))
  assertFalse(canAnswerFeedApproval(notification.copy(sessionId = null), setOf("pending")))
 }
}
