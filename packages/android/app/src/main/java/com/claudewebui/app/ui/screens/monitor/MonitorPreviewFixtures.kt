package com.claudewebui.app.ui.screens.monitor

import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.QuestionItem
import com.claudewebui.app.data.model.QuestionOption
import com.claudewebui.app.data.model.QuestionRequestEvent
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus

/**
 * Fixture state for the `claudewebui://preview-monitor` debug deep link, so
 * the grid can be rendered and screenshotted on a device without a login.
 */
internal fun previewMonitorState(): MonitorUiState {
    fun session(id: String, name: String, provider: CLIProvider, busy: Boolean, approvals: Int = 0, summary: String? = null) = Session(
        id = id,
        userId = "preview",
        name = name,
        workingDirectory = "/mnt/user/appdata/$id",
        status = if (busy) SessionStatus.RUNNING else SessionStatus.STOPPED,
        cliProvider = provider,
        createdAt = "2026-09-14T20:00:00Z",
        updatedAt = "2026-09-14T21:40:00Z",
        busy = busy,
        activitySummary = summary,
        pendingApprovals = approvals,
        lastActivityAt = "2026-09-14T21:49:30Z",
        lastMessage = "Die Migration ist vorbereitet, ich führe jetzt die Tests aus.",
    )
    val webui = session("webui", "Plum WebUI", CLIProvider.CODEX, busy = true, summary = "Bash: pnpm typecheck")
    val android = session("android", "Android-App", CLIProvider.CLAUDE, busy = true, approvals = 1)
    val docs = session("docs", "Dokumentation", CLIProvider.OPENCODE, busy = false)
    return MonitorUiState(
        slots = listOf("webui", "android", "docs", null),
        sessions = listOf(webui, android, docs),
        isConnected = true,
        tiles = mapOf(
            "webui" to MonitorTile(
                sessionId = "webui",
                session = webui,
                currentTool = "Bash: pnpm typecheck",
                streamingText = "Ich habe die Socket-Schicht angepasst und prüfe jetzt die Typen.\n\n" +
                    "\$ pnpm typecheck\n> tsc --noEmit\n\nKeine Fehler. Als Nächstes baue ich das Frontend-Bundle und ",
            ),
            "android" to MonitorTile(
                sessionId = "android",
                session = android,
                lastReply = "Der Monitor-Screen ist fertig. Bevor ich die APK auf das Gerät installiere, brauche ich eine Freigabe.",
                approval = MonitorApproval(requestId = "req-1", toolName = "android_install", description = "APK installieren"),
            ),
            "docs" to MonitorTile(
                sessionId = "docs",
                session = docs,
                lastReply = "README und AGENTS.md sind aktualisiert.",
                draft = "Bitte auch das Diagramm einbauen",
                pendingAttachments = listOf(
                    com.claudewebui.app.data.model.PendingFileAttachment(
                        uri = "content://preview/diagram.png",
                        mimeType = "image/png",
                        filename = "diagramm.png",
                        sizeBytes = 240_000,
                    ),
                ),
                question = QuestionRequestEvent(
                    sessionId = "docs",
                    requestId = "q-1",
                    questions = listOf(
                        QuestionItem(
                            question = "Soll ich die Änderungen committen?",
                            options = listOf(QuestionOption("Ja"), QuestionOption("Nein"), QuestionOption("Später")),
                        ),
                    ),
                ),
            ),
        ),
    )
}
