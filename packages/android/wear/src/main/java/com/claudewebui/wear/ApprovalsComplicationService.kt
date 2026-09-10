package com.claudewebui.wear

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService

/**
 * Watch-face complication showing how many approvals and questions are waiting;
 * tapping it opens the watch app's list.
 */
class ApprovalsComplicationService : ComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) build(2) else null

    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        val snapshot = WearSnapshotStore.cached(this)
        listener.onComplicationData(build(snapshot.approvals.size + snapshot.questions.size))
    }

    private fun build(count: Int): ComplicationData {
        val tap = PendingIntent.getActivity(
            this,
            0,
            Intent(this, WearMainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return ShortTextComplicationData.Builder(
            PlainComplicationText.Builder(count.toString()).build(),
            PlainComplicationText.Builder("Plum waiting").build(),
        )
            .setTapAction(tap)
            .build()
    }
}
