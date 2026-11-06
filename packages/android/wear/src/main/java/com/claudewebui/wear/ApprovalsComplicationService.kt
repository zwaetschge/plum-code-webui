package com.claudewebui.wear

import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest

/**
 * Watch-face complication showing how many approvals and questions are waiting;
 * tapping it opens the watch app on its „Freigaben“ page. Paired watches count
 * from their own bridge data, unpaired ones from the phone's snapshot.
 */
class ApprovalsComplicationService : ComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) build(2) else null

    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        listener.onComplicationData(build(waitingCount()))
    }

    private fun waitingCount(): Int =
        if (PairingStore.isPaired(this)) {
            BridgeCache.load(this).approvals.size
        } else {
            val snapshot = WearSnapshotStore.cached(this)
            snapshot.approvals.size + snapshot.questions.size
        }

    private fun build(count: Int): ComplicationData =
        ShortTextComplicationData.Builder(
            PlainComplicationText.Builder(count.toString()).build(),
            PlainComplicationText.Builder("Plum: $count offen").build(),
        )
            .setTitle(PlainComplicationText.Builder("offen").build())
            .setTapAction(UsageComplicationService.openApp(this, WearMainActivity.PAGE_APPROVALS))
            .build()
}
