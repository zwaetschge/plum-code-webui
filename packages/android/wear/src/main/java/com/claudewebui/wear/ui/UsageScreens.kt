package com.claudewebui.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.claudewebui.wear.PlumBridge
import com.claudewebui.wear.UsageColors
import com.claudewebui.wear.UsageRow
import com.claudewebui.wear.UsageWindow
import com.claudewebui.wear.WearFormat
import com.claudewebui.wear.focusRow

/**
 * Page 1 „Nutzung“: the active (else fullest) provider as a big ring with its
 * binding window and forecast, the others as compact rows below.
 */
@Composable
fun UsagePage(
    bridge: PlumBridge,
    listState: ScalingLazyListState,
    onOpenProvider: (String) -> Unit,
) {
    val rows by bridge.usage.collectAsStateWithLifecycle()
    val connection by bridge.connection.collectAsStateWithLifecycle()
    val syncedAt by bridge.syncedAt.collectAsStateWithLifecycle()
    val now = rememberNow()
    val focus = rows.focusRow()
    val others = rows.filter { it.provider != focus?.provider }
    val note = connectionNote(connection, syncedAt, now)

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        autoCentering = AutoCenteringParams(itemIndex = 0),
    ) {
        if (focus == null) {
            item { ListHeader { Text("Nutzung") } }
            item {
                CenteredText(
                    if (connection is PlumBridge.Connection.Connecting) "Lade …" else "Keine Nutzungsdaten"
                )
            }
        } else {
            item(key = "focus") {
                FocusRing(row = focus, now = now, onClick = { onOpenProvider(focus.provider) })
            }
            item(key = "focus-label") {
                Text(
                    text = listOfNotNull(focus.label, focus.peak?.label?.takeIf { it.isNotBlank() })
                        .joinToString(" · "),
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.title3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            val forecast = focus.peak?.let { WearFormat.forecast(it.forecast, now) }
            if (forecast != null) {
                item(key = "focus-forecast") {
                    CenteredText(
                        forecast,
                        color = if (focus.peak?.forecast?.state == "exhausts") WearColors.Amber else WearColors.Muted,
                    )
                }
            }
            items(others, key = { it.provider }) { row ->
                ProviderChip(row = row, onClick = { onOpenProvider(row.provider) })
            }
        }
        if (note != null) item(key = "note") { CenteredText(note, color = WearColors.Faint) }
    }
}

@Composable
private fun FocusRing(row: UsageRow, now: Long, onClick: () -> Unit) {
    val color = Color(UsageColors.of(row))
    UsageRing(
        percent = row.percent,
        color = color,
        size = 118.dp,
        stroke = 9.dp,
        modifier = Modifier
            .clickable(onClick = onClick)
            .semantics { contentDescription = "${row.label}: ${row.displayPercent} Prozent genutzt" },
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = WearFormat.percent(row.displayPercent, row.estimate),
                style = MaterialTheme.typography.display3,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            val reset = WearFormat.reset(row.peak?.resetsAt, now)
            if (row.exhausted) {
                Text("aufgebraucht", style = MaterialTheme.typography.caption2, color = color)
            } else if (reset != null) {
                Text(reset, style = MaterialTheme.typography.caption3, color = WearColors.Muted, maxLines = 1)
            }
        }
    }
}

@Composable
private fun ProviderChip(row: UsageRow, onClick: () -> Unit) {
    val peak = row.peak
    Chip(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = ChipDefaults.secondaryChipColors(
            backgroundColor = WearColors.Surface,
            contentColor = Color.White,
            secondaryContentColor = WearColors.Muted,
        ),
        icon = {
            UsageRing(
                percent = row.percent,
                color = Color(UsageColors.of(row)),
                size = 24.dp,
                stroke = 3.dp,
            )
        },
        label = { Text(row.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        secondaryLabel = {
            Text(
                listOfNotNull(
                    WearFormat.percent(row.displayPercent, row.estimate),
                    peak?.label?.takeIf { it.isNotBlank() },
                ).joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
    )
}

/** All windows of one provider, each with its reset time and forecast. */
@Composable
fun UsageDetailScreen(bridge: PlumBridge, provider: String) {
    val rows by bridge.usage.collectAsStateWithLifecycle()
    val connection by bridge.connection.collectAsStateWithLifecycle()
    val syncedAt by bridge.syncedAt.collectAsStateWithLifecycle()
    val now = rememberNow()
    val row = rows.firstOrNull { it.provider == provider }
    val listState = rememberScalingLazyListState()
    val note = connectionNote(connection, syncedAt, now)

    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(modifier = Modifier.fillMaxSize(), state = listState) {
            item { ListHeader { Text(row?.label ?: "Nutzung", maxLines = 1) } }
            if (row == null) {
                item { CenteredText("Keine Daten") }
            } else {
                if (row.estimate || row.exhausted) {
                    item {
                        CenteredText(
                            listOfNotNull(
                                "aufgebraucht".takeIf { row.exhausted },
                                "geschätzt".takeIf { row.estimate },
                            ).joinToString(" · "),
                            color = if (row.exhausted) Color(UsageColors.DANGER) else WearColors.Muted,
                        )
                    }
                }
                items(row.windows) { window -> WindowRow(window, now) }
            }
            if (note != null) item { CenteredText(note, color = WearColors.Faint) }
        }
    }
}

@Composable
private fun WindowRow(window: UsageWindow, now: Long) {
    val color = Color(UsageColors.of(window.utilization))
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            UsageRing(percent = window.utilization, color = color, size = 30.dp, stroke = 4.dp)
            Spacer(Modifier.width(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(
                    "${window.label} · ${WearFormat.percent(window.utilization)}",
                    style = MaterialTheme.typography.button,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                WearFormat.reset(window.resetsAt, now)?.let {
                    Text(it, style = MaterialTheme.typography.caption2, color = WearColors.Muted)
                }
                WearFormat.forecast(window.forecast, now)?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.caption2,
                        color = if (window.forecast.state == "exhausts") WearColors.Amber else WearColors.Muted,
                    )
                }
            }
        }
    }
}
