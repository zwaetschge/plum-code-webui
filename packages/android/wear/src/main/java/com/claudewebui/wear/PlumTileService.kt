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
 * Quick-glance tile: running sessions, pending approvals, today's tokens and
 * cost — rendered from the cached phone snapshot; tapping opens the watch app.
 */
class PlumTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> =
        CallbackToFutureAdapter.getFuture { completer ->
            val snapshot = WearSnapshotStore.cached(this)
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
                                            .setRoot(layout(snapshot))
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

    private fun layout(snapshot: WearSnapshot): LayoutElementBuilders.LayoutElement {
        // Approvals and questions are both "someone has to answer this", and a
        // tile has one line for it.
        val waiting = snapshot.approvals.size + snapshot.questions.size
        val approvalsLine = if (waiting == 0) {
            "nothing waiting"
        } else {
            "$waiting waiting!"
        }
        val openApp = ModifiersBuilders.Modifiers.Builder()
            .setClickable(
                ModifiersBuilders.Clickable.Builder()
                    .setId("open")
                    .setOnClick(
                        ActionBuilders.LaunchAction.Builder()
                            .setAndroidActivity(
                                ActionBuilders.AndroidActivity.Builder()
                                    .setPackageName(packageName)
                                    .setClassName(WearMainActivity::class.java.name)
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()

        return LayoutElementBuilders.Box.Builder()
            .setModifiers(openApp)
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .addContent(
                LayoutElementBuilders.Column.Builder()
                    .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                    .addContent(text("Plum Code", 16f, 0xFFCC785C.toInt(), bold = true))
                    .addContent(text("${snapshot.running} running", 22f, 0xFFFFFFFF.toInt(), bold = true))
                    .addContent(
                        text(
                            approvalsLine,
                            14f,
                            if (waiting == 0) 0xFF8A8494.toInt() else 0xFFF59E0B.toInt(),
                        )
                    )
                    .addContent(
                        text(
                            "${WearSnapshotStore.fmtTokens(snapshot.tokensToday)} tok · " +
                                "$%.2f".format(snapshot.costToday),
                            13f,
                            0xFFB7B2C0.toInt(),
                        )
                    )
                    .build()
            )
            .build()
    }

    private fun text(
        value: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
    ): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text.Builder()
            .setText(value)
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
    }
}
