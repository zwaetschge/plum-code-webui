package com.claudewebui.wear

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.tiles.ActionBuilders
import androidx.wear.tiles.ColorBuilders
import androidx.wear.tiles.DimensionBuilders
import androidx.wear.tiles.LayoutElementBuilders
import androidx.wear.tiles.ModifiersBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.ResourceBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import androidx.wear.tiles.TimelineBuilders
import com.google.common.util.concurrent.ListenableFuture

/**
 * Quick-glance tile. Paired with Plum: a big ring with the usage of the active
 * (else the fullest) provider plus the open approvals, from the bridge cache.
 * Not paired: the phone snapshot as before. Tapping opens the watch app.
 */
class PlumTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> =
        CallbackToFutureAdapter.getFuture { completer ->
            val root = if (PairingStore.isPaired(this)) {
                val data = BridgeCache.load(this)
                refreshIfStale(data)
                usageLayout(data)
            } else {
                snapshotLayout(WearSnapshotStore.cached(this))
            }
            completer.set(
                TileBuilders.Tile.Builder()
                    .setResourcesVersion(RESOURCES_VERSION)
                    .setFreshnessIntervalMillis(15 * 60_000L)
                    .setTimeline(
                        TimelineBuilders.Timeline.Builder()
                            .addTimelineEntry(
                                TimelineBuilders.TimelineEntry.Builder()
                                    .setLayout(
                                        LayoutElementBuilders.Layout.Builder()
                                            .setRoot(root)
                                            .build()
                                    )
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            "tile"
        }

    override fun onResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture { completer ->
            completer.set(
                ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
            )
            "resources"
        }

    /**
     * A tile coming into view with old data starts one background refresh —
     * but not again right after a failed one, or an offline watch would loop.
     */
    private fun refreshIfStale(data: BridgeData) {
        val now = System.currentTimeMillis()
        if (now - data.syncedAt < STALE_MS) return
        if (now - BridgeCache.attemptAt(this) < RETRY_MS) return
        runCatching { RefreshWorker.refreshNow(this) }
    }

    // ── paired: usage ring ──────────────────────────────────────────────────

    private fun usageLayout(data: BridgeData): LayoutElementBuilders.LayoutElement {
        val waiting = data.approvals.size
        val row = data.usage.focusRow()
        val column = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        val now = System.currentTimeMillis()
        val box = LayoutElementBuilders.Box.Builder()
            .setModifiers(openApp(if (waiting > 0) WearMainActivity.PAGE_APPROVALS else WearMainActivity.PAGE_USAGE))
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)

        if (row == null) {
            column.addContent(text("Plum Code", 15f, ACCENT, bold = true))
            column.addContent(text("Noch keine Daten", 13f, MUTED))
        } else {
            val color = UsageColors.of(row)
            box.addContent(ring(360f, TRACK))
            if (row.percent > 0) box.addContent(ring(360f * row.percent / 100f, color))
            column.addContent(text(row.label, 14f, MUTED))
            column.addContent(text(WearFormat.percent(row.displayPercent, row.estimate), 30f, WHITE, bold = true))
            val window = row.peak
            val detail = listOfNotNull(
                window?.label?.takeIf { it.isNotBlank() },
                window?.let { WearFormat.forecast(it.forecast, now) },
            ).joinToString(" · ")
            if (detail.isNotEmpty()) column.addContent(text(detail, 12f, MUTED, maxLines = 2))
        }
        column.addContent(spacer(6f))
        column.addContent(
            text(
                if (waiting == 0) "nichts offen" else "$waiting offen",
                14f,
                if (waiting == 0) MUTED else AMBER,
                bold = waiting > 0,
            )
        )
        if (data.syncedAt > 0 && now - data.syncedAt > STALE_MS * 2) {
            column.addContent(text("Stand ${WearFormat.time(data.syncedAt)}", 11f, MUTED))
        }
        return box.addContent(column.build()).build()
    }

    /** One arc of the ring, drawn clockwise from 12 o'clock along the screen edge. */
    private fun ring(lengthDegrees: Float, color: Int): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Arc.Builder()
            .setAnchorAngle(DimensionBuilders.degrees(0f))
            .setAnchorType(LayoutElementBuilders.ARC_ANCHOR_START)
            .addContent(
                LayoutElementBuilders.ArcLine.Builder()
                    .setLength(DimensionBuilders.degrees(lengthDegrees.coerceIn(0f, 360f)))
                    .setThickness(DimensionBuilders.dp(8f))
                    .setColor(ColorBuilders.argb(color))
                    .build()
            )
            .build()

    // ── not paired: phone snapshot ──────────────────────────────────────────

    private fun snapshotLayout(snapshot: WearSnapshot): LayoutElementBuilders.LayoutElement {
        // Approvals and questions are both "someone has to answer this", and a
        // tile has one line for it.
        val waiting = snapshot.approvals.size + snapshot.questions.size
        return LayoutElementBuilders.Box.Builder()
            .setModifiers(openApp(WearMainActivity.PAGE_USAGE))
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .addContent(
                LayoutElementBuilders.Column.Builder()
                    .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                    .addContent(text("Plum Code", 16f, ACCENT, bold = true))
                    .addContent(text("${snapshot.running} aktiv", 22f, WHITE, bold = true))
                    .addContent(
                        text(
                            if (waiting == 0) "nichts offen" else "$waiting offen",
                            14f,
                            if (waiting == 0) MUTED else AMBER,
                        )
                    )
                    .addContent(
                        text(
                            "${WearFormat.tokens(snapshot.tokensToday)} Tokens · " +
                                String.format(java.util.Locale.GERMAN, "%.2f $", snapshot.costToday),
                            13f,
                            SOFT,
                        )
                    )
                    .build()
            )
            .build()
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private fun openApp(page: Int): ModifiersBuilders.Modifiers =
        ModifiersBuilders.Modifiers.Builder()
            .setClickable(
                ModifiersBuilders.Clickable.Builder()
                    .setId("open")
                    .setOnClick(
                        ActionBuilders.LaunchAction.Builder()
                            .setAndroidActivity(
                                ActionBuilders.AndroidActivity.Builder()
                                    .setPackageName(packageName)
                                    .setClassName(WearMainActivity::class.java.name)
                                    .addKeyToExtraMapping(
                                        WearMainActivity.EXTRA_PAGE,
                                        ActionBuilders.AndroidIntExtra.Builder().setValue(page).build(),
                                    )
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()

    private fun spacer(heightDp: Float): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Spacer.Builder()
            .setHeight(DimensionBuilders.dp(heightDp))
            .build()

    private fun text(
        value: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
        maxLines: Int = 1,
    ): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text.Builder()
            .setText(value)
            .setMaxLines(maxLines)
            .setMultilineAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setSize(DimensionBuilders.sp(sizeSp))
                    .setColor(ColorBuilders.argb(color))
                    .setWeight(
                        if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD
                        else LayoutElementBuilders.FONT_WEIGHT_NORMAL
                    )
                    .build()
            )
            .build()

    companion object {
        private const val RESOURCES_VERSION = "1"
        private const val STALE_MS = 15 * 60_000L
        private const val RETRY_MS = 10 * 60_000L

        private val ACCENT = 0xFFCC785C.toInt()
        private val WHITE = 0xFFFFFFFF.toInt()
        private val MUTED = 0xFF8A8494.toInt()
        private val SOFT = 0xFFB7B2C0.toInt()
        private val AMBER = 0xFFF59E0B.toInt()
        private val TRACK = 0x33FFFFFF
    }
}
