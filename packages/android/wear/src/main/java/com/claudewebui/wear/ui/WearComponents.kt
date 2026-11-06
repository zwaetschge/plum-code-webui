package com.claudewebui.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claudewebui.wear.PlumBridge
import com.claudewebui.wear.WearFormat
import kotlinx.coroutines.delay

/** Plum palette on black, as on the phone (brand purple, brass accent). */
object WearColors {
    val Accent = Color(0xFFC377FF)
    val Brass = Color(0xFFCC785C)
    val Surface = Color(0xFF1F1A28)
    val SurfaceStrong = Color(0xFF2E2640)
    val Text = Color.White
    val Muted = Color(0xFFB7B2C0)
    val Faint = Color(0xFF8A8494)
    val Green = Color(0xFF15803D)
    val Red = Color(0xFF991B1B)
    val Amber = Color(0xFFF59E0B)
    val Track = Color.White.copy(alpha = 0.15f)
}

private val PlumColors = Colors(
    primary = WearColors.Accent,
    primaryVariant = Color(0xFF8E4FD0),
    secondary = WearColors.Brass,
    secondaryVariant = Color(0xFF7A4532),
    background = Color.Black,
    surface = WearColors.Surface,
    error = Color(0xFFEA2143),
    onPrimary = Color(0xFF1A1022),
    onSecondary = Color.Black,
    onBackground = Color.White,
    onSurface = Color.White,
    onSurfaceVariant = WearColors.Muted,
    onError = Color.Black,
)

@Composable
fun PlumWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(colors = PlumColors, content = content)
}

/** The current time, ticking twice a minute for „Stand vor …“ and forecasts. */
@Composable
fun rememberNow(): Long {
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(30_000)
            value = System.currentTimeMillis()
        }
    }
    return now
}

/** A usage ring with free content in the middle. */
@Composable
fun UsageRing(
    percent: Int,
    color: Color,
    size: Dp,
    stroke: Dp,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            progress = percent.coerceIn(0, 100) / 100f,
            modifier = Modifier.fillMaxSize(),
            indicatorColor = color,
            trackColor = WearColors.Track,
            strokeWidth = stroke,
        )
        content()
    }
}

@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(color)
    )
}

/** A non-interactive card for request details. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(WearColors.Surface)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        content = content,
    )
}

/** Full-width chip with one label; [background] decides its meaning (allow, deny, neutral). */
@Composable
fun ActionChip(
    label: String,
    background: Color = WearColors.SurfaceStrong,
    enabled: Boolean = true,
    secondary: String? = null,
    onClick: () -> Unit,
) {
    Chip(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        colors = ChipDefaults.primaryChipColors(
            backgroundColor = background,
            contentColor = Color.White,
            secondaryContentColor = WearColors.Muted,
        ),
        label = { Text(label, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        secondaryLabel = if (secondary == null) {
            null
        } else {
            { Text(secondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        },
    )
}

@Composable
fun CenteredText(
    text: String,
    color: Color = WearColors.Muted,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier.fillMaxWidth(),
        color = color,
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.caption1,
    )
}

/**
 * Connection state below the content: nothing while live, otherwise how old
 * the shown data is („Offline · Stand vor 12 Min.“) or what to do.
 */
fun connectionNote(connection: PlumBridge.Connection, syncedAt: Long, now: Long): String? {
    val age = if (syncedAt > 0) "Stand ${WearFormat.ago(syncedAt, now)}" else null
    return when (connection) {
        PlumBridge.Connection.Connected -> null
        PlumBridge.Connection.Connecting -> age?.let { "Verbinde … · $it" } ?: "Verbinde …"
        is PlumBridge.Connection.Offline -> listOfNotNull("Offline", age).joinToString(" · ")
        PlumBridge.Connection.Unauthorized -> "Kopplung ungültig – am Handy neu koppeln"
        PlumBridge.Connection.Unpaired -> "Nicht gekoppelt"
    }
}
