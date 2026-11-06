package com.claudewebui.wear

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest

/**
 * Watch-face complication with the account usage the big ring shows: the
 * active provider, else the fullest one. RANGED_VALUE draws the percentage as
 * an arc, SHORT_TEXT as „62 %“. Fed from the bridge cache only.
 */
class UsageComplicationService : ComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        build(type, label = "Codex", percent = 62, estimate = false)

    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        val row = if (PairingStore.isPaired(this)) BridgeCache.load(this).usage.focusRow() else null
        if (row == null) {
            listener.onComplicationData(NoDataComplicationData())
            return
        }
        listener.onComplicationData(
            build(request.complicationType, row.label, row.displayPercent, row.estimate)
        )
    }

    private fun build(
        type: ComplicationType,
        label: String,
        percent: Int,
        estimate: Boolean,
    ): ComplicationData? {
        val description = PlainComplicationText.Builder("Plum $label: $percent Prozent genutzt").build()
        val text = PlainComplicationText.Builder(WearFormat.percent(percent, estimate)).build()
        val title = PlainComplicationText.Builder(label).build()
        return when (type) {
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(
                value = percent.coerceIn(0, 100).toFloat(),
                min = 0f,
                max = 100f,
                contentDescription = description,
            )
                .setText(text)
                .setTitle(title)
                .setTapAction(openApp(this, WearMainActivity.PAGE_USAGE))
                .build()
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text, description)
                .setTitle(title)
                .setTapAction(openApp(this, WearMainActivity.PAGE_USAGE))
                .build()
            else -> null
        }
    }

    companion object {
        /** Opens the watch app on one of its pages; one request code per page keeps the extras apart. */
        fun openApp(context: Context, page: Int): PendingIntent =
            PendingIntent.getActivity(
                context,
                100 + page,
                Intent(context, WearMainActivity::class.java)
                    .putExtra(WearMainActivity.EXTRA_PAGE, page)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }
}
