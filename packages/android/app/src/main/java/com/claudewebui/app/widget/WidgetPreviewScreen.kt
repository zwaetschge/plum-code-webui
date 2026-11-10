package com.claudewebui.app.widget

import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Debug-only gallery behind `claudewebui://preview-widgets`: every widget kind
 * rendered through the real [WidgetRenderer] and inflated with
 * `RemoteViews.apply`, so the home-screen widgets can be screenshotted without
 * placing them on a launcher.
 *
 * Query parameters: `kinds=limits,tokens` (default all), `sizes=2x2,4x2`
 * (default: the phone sizes; tablet cells are `t4x2`, `t4x3`), `translucent=1`,
 * `empty=1` (signed-out snapshot), `provider=Codex`, `period=7d`.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WidgetPreviewScreen(
    kinds: String? = null,
    sizes: String? = null,
    translucent: Boolean = false,
    empty: Boolean = false,
    provider: String? = null,
    period: String? = null,
) {
    val context = LocalContext.current
    val selectedKinds = kinds?.split(',')?.mapNotNull { name ->
        WidgetKind.entries.firstOrNull { it.name.equals(name.trim(), ignoreCase = true) }
    }?.takeIf { it.isNotEmpty() } ?: WidgetKind.entries
    val selectedSizes = sizes?.split(',')?.mapNotNull { key -> PREVIEW_SIZES.firstOrNull { it.key == key.trim() } }
        ?.takeIf { it.isNotEmpty() } ?: PREVIEW_SIZES.filterNot { it.key.startsWith("t") }
    val snapshot = if (empty) null else previewWidgetSnapshot()

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF3B4A6B), Color(0xFF6B5A7A), Color(0xFFC9A98E)),
                ),
            )
            .statusBarsPadding()
            .padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        items(selectedKinds) { kind ->
            Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                Text(kind.name, color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(top = 6.dp),
                ) {
                    selectedSizes.forEach { size ->
                        Box(Modifier.size(size.widthDp.dp, size.heightDp.dp)) {
                            AndroidView(
                                modifier = Modifier.fillMaxSize(),
                                factory = { FrameLayout(it) },
                                update = { frame ->
                                    frame.removeAllViews()
                                    val config = WidgetConfig(period = period ?: "24h", provider = provider, translucent = translucent)
                                    // The variant the launcher would pick at this size.
                                    val bucket = WidgetHub.bucketFor(kind, size.widthDp, size.heightDp)
                                    val views = WidgetRenderer.render(context, kind, snapshot, config, size = bucket)
                                    frame.addView(views.apply(context, frame))
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

private data class PreviewSize(val key: String, val widthDp: Int, val heightDp: Int)

/** Roughly what a phone launcher hands a widget at these cell spans. */
private val PREVIEW_SIZES = listOf(
    PreviewSize("2x1", 150, 74),
    PreviewSize("2x2", 160, 160),
    PreviewSize("3x2", 240, 172),
    PreviewSize("4x2", 330, 172),
    // A 4×2 on a taller-celled phone launcher (Pixel-class 6.7").
    PreviewSize("4x2l", 350, 195),
    PreviewSize("4x3", 330, 260),
    // Tablet cells (Galaxy Tab S8 Ultra class launcher).
    PreviewSize("t4x2", 520, 230),
    PreviewSize("t4x3", 520, 340),
)

/** A realistic snapshot so every widget has something to show. */
internal fun previewWidgetSnapshot(nowMs: Long = System.currentTimeMillis()): WidgetSnapshot {
    val minute = 60_000L
    val hour = 60 * minute
    val iso = { offsetMs: Long -> java.time.Instant.ofEpochMilli(nowMs - offsetMs).toString() }
    fun session(id: String, name: String, provider: String, busy: Boolean, approvals: Int = 0, summary: String? = null) =
        WSession(
            id = id,
            name = name,
            provider = provider,
            status = if (busy) "running" else "stopped",
            busy = busy,
            activitySummary = summary,
            pendingApprovals = approvals,
            lastActivityAt = iso(if (busy) 20_000 else 3 * hour),
            updatedAt = iso(if (busy) 20_000 else 3 * hour),
        )
    val sessions = listOf(
        session("android", "Android-Widgets", "Claude Code", busy = true, approvals = 1),
        session("webui", "Plum WebUI", "Codex", busy = true, summary = "Bash: pnpm typecheck"),
        session("pi", "Pi-Parität", "Pi", busy = true, summary = "Lese AGENTS.md"),
        session("docs", "Dokumentation", "Claude Code", busy = false),
        session("vibe", "Vibe-Release", "Mistral Vibe", busy = false),
        session("hermes", "Hermes-Bereich", "Kimi Code", busy = false),
    )
    return WidgetSnapshot(
        updatedAtMs = nowMs - 2 * minute,
        today = WPeriod(
            inputTokens = 1_840_000, outputTokens = 212_000, cacheReadTokens = 9_400_000,
            totalTokens = 11_452_000, costUsd = 7.84, requests = 312,
        ),
        week = WPeriod(
            inputTokens = 12_100_000, outputTokens = 1_480_000, cacheReadTokens = 61_000_000,
            totalTokens = 74_580_000, costUsd = 48.20, requests = 2_143,
        ),
        providers = listOf(
            WEntry(name = "Claude Code", tokens = 41_200_000, costUsd = 31.10, colorArgb = 0xFFD97757),
            WEntry(name = "Codex", tokens = 18_700_000, costUsd = 9.40, colorArgb = 0xFF22C55E),
            WEntry(name = "Pi", tokens = 9_100_000, costUsd = 4.80, colorArgb = 0xFF60A5FA),
            WEntry(name = "Mistral Vibe", tokens = 5_580_000, costUsd = 2.90, colorArgb = 0xFFFF7000),
        ),
        models = listOf(
            WEntry(name = "claude-opus-5-5", sub = "Claude Code", tokens = 30_100_000, costUsd = 26.40, colorArgb = 0xFFD97757),
            WEntry(name = "gpt-5.5-codex", sub = "Codex", tokens = 18_700_000, costUsd = 9.40, colorArgb = 0xFF22C55E),
            WEntry(name = "claude-sonnet-5", sub = "Claude Code", tokens = 11_100_000, costUsd = 4.70, colorArgb = 0xFFF0A07E),
            WEntry(name = "glm-5.3", sub = "Pi", tokens = 9_100_000, costUsd = 4.80, colorArgb = 0xFF60A5FA),
            WEntry(name = "devstral-3", sub = "Mistral Vibe", tokens = 5_580_000, costUsd = 2.90, colorArgb = 0xFFFF7000),
        ),
        topSessions = listOf(
            WEntry(id = "android", name = "Android-Widgets", tokens = 22_400_000, costUsd = 17.20),
            WEntry(id = "webui", name = "Plum WebUI", tokens = 14_900_000, costUsd = 9.80),
            WEntry(id = "pi", name = "Pi-Parität", tokens = 9_100_000, costUsd = 4.80),
            WEntry(id = "docs", name = "Dokumentation", tokens = 4_300_000, costUsd = 2.10),
            WEntry(id = "vibe", name = "Vibe-Release", tokens = 3_200_000, costUsd = 1.60),
        ),
        days = listOf(
            WDay("2026-11-03", 6_200_000, 4.1),
            WDay("2026-11-04", 12_800_000, 8.3),
            WDay("2026-11-05", 9_400_000, 6.2),
            WDay("2026-11-06", 15_100_000, 9.9),
            WDay("2026-11-07", 4_300_000, 2.8),
            WDay("2026-11-08", 15_330_000, 9.0),
            WDay("2026-11-09", 11_450_000, 7.8),
        ),
        limits = listOf(
            WLimit("Claude", "5h", 68, 0xFFF97316, resetsAtMs = nowMs + 96 * minute),
            WLimit("Claude", "Weekly", 42, 0xFFF97316, resetsAtMs = nowMs + 4 * 24 * hour + 7 * hour),
            WLimit("Claude", "Weekly Sonnet", 23, 0xFFF97316, resetsAtMs = nowMs + 4 * 24 * hour + 7 * hour),
            WLimit("Codex", "5h", 12, 0xFF22C55E, resetsAtMs = nowMs + 3 * hour),
            WLimit("Codex", "Weekly", 31, 0xFF22C55E, resetsAtMs = nowMs + 2 * 24 * hour),
            WLimit("Z.AI", "5h", 54, 0xFF14B8A6, resetsAtMs = nowMs + 41 * minute),
            WLimit("Vibe", "Month", 18, 0xFFFF7000, resetsAtMs = nowMs + 21 * 24 * hour),
        ),
        sessions = sessions,
        monitorSessions = sessions.take(4),
        approvals = listOf(
            WApproval("android", "Android-Widgets", "Bash", "req-1"),
            WApproval("webui", "Plum WebUI", "Edit", "req-2"),
        ),
        questions = listOf(
            WQuestion(
                sessionId = "pi", sessionName = "Pi-Parität", requestId = "q-1",
                prompt = "Tests auch auf dem Tablet?", options = listOf("Ja", "Nein"), answerable = true,
            ),
        ),
        sessionTotal = 11,
        approvalTotal = 2,
        questionTotal = 1,
        busyTotal = 3,
        needsYouTotal = 2,
    )
}
