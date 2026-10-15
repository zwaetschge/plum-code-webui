package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.interaction.MutableInteractionSource
import com.claudewebui.app.ui.motion.PlumMotionTokens
import com.claudewebui.app.ui.motion.orSnap
import com.claudewebui.app.ui.motion.pressScale
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.border
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.ui.theme.PlumTheme

/** One selectable model, grouped under the connection or provider it belongs to. */
internal data class ModelOption(val groupId: String, val group: String, val model: String, val label: String = model, val enabled: Boolean = true)

/** One stop of the thinking-depth rail; `id == null` means "leave it to the model". */
internal data class EffortStop(val id: String?, val label: String, val special: Boolean = false)

/** The levels the model chat API accepts per turn (`reasoningEffort`). */
@Composable
internal fun apiEffortStops(): List<EffortStop> = listOf(
    EffortStop(null, stringResource(R.string.effort_auto)),
    EffortStop("low", stringResource(R.string.effort_low)),
    EffortStop("medium", stringResource(R.string.effort_medium)),
    EffortStop("high", stringResource(R.string.effort_high)),
    EffortStop("max", stringResource(R.string.effort_max), special = true),
    EffortStop("ultra", stringResource(R.string.effort_ultra), special = true),
)

/** Levels that earn the animated nebula look: the deepest a provider offers. */
internal fun isSpecialLevel(id: String?): Boolean =
    id != null && id.lowercase() in setOf("max", "xhigh", "ultra", "ultrathink", "ultracode")

/**
 * Thinking depth as a segmented rail: a thumb glides to the chosen stop and a
 * gradient fills up to it. The fill carries a moving sheen; the deepest levels
 * (max, ultra, ultracode …) turn it into a drifting nebula with twinkling
 * stars and a glowing thumb. The stops are discrete, so it is deliberately not
 * a slider; the label cross-fades with every change.
 */
@Composable
internal fun EffortRail(stops: List<EffortStop>, selectedId: String?, onSelect: (String?) -> Unit, enabled: Boolean = true) {
    val palette = PlumTheme.palette
    val reduce = com.claudewebui.app.ui.theme.LocalReduceMotion.current
    // The thumb follows the finger and the tap at once; the caller's value
    // (often a server round trip) catches up afterwards.
    var pending by remember(selectedId) { mutableStateOf<Int?>(null) }
    val found = pending ?: stops.indexOfFirst { it.id == selectedId }
    val index = found.coerceAtLeast(0)
    val current = stops[index]
    val special = found >= 0 && current.special
    val nebula by animateFloatAsState(if (special) 1f else 0f, tween(420), label = "effort_nebula")
    val fx = rememberInfiniteTransition(label = "effort_fx")
    val sheen by fx.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "effort_sheen")
    val twinkle by fx.animateFloat(0f, 1f, infiniteRepeatable(tween(1900, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "effort_twinkle")
    val drift by fx.animateFloat(0f, 1f, infiniteRepeatable(tween(5200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "effort_drift")
    val pulse = remember { Animatable(1f) }
    LaunchedEffect(index) { if (!reduce) { pulse.snapTo(1.16f); pulse.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMedium)) } }
    val violet = Color(0xFF8B5CF6)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.effort_title), style = MaterialTheme.typography.labelLarge, color = palette.muted)
            Crossfade(current.label, animationSpec = tween(180), label = "effort_label") { label ->
                Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = if (special) Color(0xFFC4B5FD) else palette.accent)
            }
        }
        BoxWithConstraints(
            Modifier.fillMaxWidth().height(44.dp).clip(CircleShape).background(palette.segmentTrack),
        ) {
            val segment = maxWidth / stops.size
            // animateDpAsState retargets the running spring, so a quick second
            // pick continues from the thumb's current velocity instead of restarting.
            val x by animateDpAsState(segment * index, PlumMotionTokens.markerSpring<androidx.compose.ui.unit.Dp>().orSnap(reduce), label = "effort_thumb")
            val fill by animateDpAsState(if (found >= 0) segment * (index + 1) else 0.dp, spring<androidx.compose.ui.unit.Dp>(dampingRatio = 0.9f, stiffness = PlumMotionTokens.MARKER_STIFFNESS).orSnap(reduce), label = "effort_fill")
            Box(
                Modifier.width(fill).fillMaxHeight().clip(CircleShape).drawBehind {
                    val w = size.width
                    val h = size.height
                    val calm = listOf(palette.accent.copy(alpha = .45f), palette.accent)
                    val deep = listOf(Color(0xFF3B2F9E), Color(0xFF7C4DDB), Color(0xFFB07CF5), Color(0xFF6C7DF0))
                    drawRect(Brush.horizontalGradient(calm))
                    if (nebula > 0f) {
                        val shift = if (reduce) 0f else (drift - .5f) * w * .5f
                        drawRect(Brush.horizontalGradient(deep, startX = -w * .25f + shift, endX = w * 1.25f + shift), alpha = nebula)
                        for (i in 0 until 16) {
                            val sx = ((i * 0.6180339f) % 1f) * w
                            val sy = (0.18f + ((i * 0.37f) % 1f) * 0.64f) * h
                            val tw = if (reduce) .7f else .3f + .7f * kotlin.math.abs(kotlin.math.sin(twinkle * Math.PI.toFloat() + i))
                            drawCircle(Color.White.copy(alpha = tw * nebula), radius = (if (i % 3 == 0) 1.8f else 1.1f) * density, center = androidx.compose.ui.geometry.Offset(sx, sy))
                        }
                    }
                    if (!reduce) {
                        val bandX = (sheen * 1.8f - .4f) * w
                        drawRect(Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = .26f), Color.Transparent), startX = bandX - w * .25f, endX = bandX + w * .25f))
                    }
                },
            )
            if (found >= 0) Box(
                Modifier.offset { androidx.compose.ui.unit.IntOffset(x.roundToPx(), 0) }.width(segment).fillMaxHeight().padding(4.dp)
                    .graphicsLayer { scaleX = pulse.value; scaleY = pulse.value }
                    .then(if (nebula > 0f) Modifier.border(2.dp, violet.copy(alpha = .85f * nebula), CircleShape) else Modifier)
                    .clip(CircleShape).background(palette.segmentSelected),
            )
            val railPx = constraints.maxWidth.toFloat().coerceAtLeast(1f)
            val stopAt = { x: Float -> (x / (railPx / stops.size)).toInt().coerceIn(0, stops.lastIndex) }
            val commit = { i: Int -> pending = i; if (stops[i].id != selectedId) onSelect(stops[i].id) }
            Row(
                Modifier.fillMaxSize()
                    .pointerInput(enabled, stops.size) {
                        if (!enabled) return@pointerInput
                        detectTapGestures { commit(stopAt(it.x)) }
                    }
                    .pointerInput(enabled, stops.size) {
                        if (!enabled) return@pointerInput
                        detectHorizontalDragGestures(
                            onDragStart = { pending = stopAt(it.x) },
                            onDragEnd = { pending?.let(commit) },
                            onDragCancel = { pending = null },
                        ) { change, _ -> change.consume(); pending = stopAt(change.position.x) }
                    },
            ) {
                stops.forEachIndexed { i, stop ->
                    val active = i == found
                    val dot by animateColorAsState(if (active) Color.Transparent else palette.muted.copy(alpha = .55f), tween(160), label = "effort_dot")
                    Box(
                        Modifier.weight(1f).fillMaxHeight()
                            .semantics { selected = active; role = Role.RadioButton; contentDescription = stop.label; onClick { if (enabled) commit(i); enabled } },
                        contentAlignment = Alignment.Center,
                    ) { Box(Modifier.size(6.dp).clip(CircleShape).background(dot)) }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.effort_faster), style = MaterialTheme.typography.labelSmall, color = palette.muted)
            Text(stringResource(R.string.effort_smarter), style = MaterialTheme.typography.labelSmall, color = palette.muted)
        }
    }
}

/**
 * Model and thinking depth in one sheet. [models] may be empty (an existing
 * conversation keeps its model) — then only the rail is shown.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ModelEffortSheet(
    models: List<ModelOption>,
    selectedGroup: String?,
    selectedModel: String?,
    onSelectModel: (ModelOption) -> Unit,
    stops: List<EffortStop>,
    effort: String?,
    onEffort: (String?) -> Unit,
    onDismiss: () -> Unit,
    showModels: Boolean = true,
    /** Extra rows under the rail, e.g. Codex Fast or the subagent model. */
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    val palette = PlumTheme.palette
    // Short (landscape) windows would otherwise park the rail below the fold.
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (showModels) {
                Text(stringResource(R.string.model_picker_title), style = MaterialTheme.typography.titleMedium)
                if (models.isEmpty()) Text(stringResource(R.string.model_picker_none), color = palette.muted)
                LazyColumn(Modifier.heightIn(max = 300.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    models.groupBy { it.groupId }.forEach { (_, group) ->
                        item(key = "group-${group.first().groupId}") {
                            Text(group.first().group.uppercase(), style = MaterialTheme.typography.labelSmall, color = palette.muted, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp, start = 4.dp))
                        }
                        items(group, key = { "${it.groupId}/${it.model}" }) { option ->
                            val active = option.groupId == selectedGroup && option.model == selectedModel
                            val tint by animateColorAsState(if (active) palette.accent.copy(alpha = .16f) else androidx.compose.ui.graphics.Color.Transparent, tween(160), label = "model_row")
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(14.dp)).background(tint)
                                    .semantics { selected = active; role = Role.RadioButton }
                                    .clickable(enabled = option.enabled) { onSelectModel(option) }.padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(option.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (option.enabled) palette.text else palette.muted)
                                if (active) Icon(Icons.Outlined.Check, null, tint = palette.accent)
                            }
                        }
                    }
                }
                HorizontalDivider()
            }
            EffortRail(stops, effort, onEffort)
            extra()
        }
    }
}

/** Compact composer chip: model name plus the chosen depth, opens the sheet. */
@Composable
internal fun ModelEffortChip(model: String, effortLabel: String?, enabled: Boolean, onClick: () -> Unit) {
    val palette = PlumTheme.palette
    val press = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick, enabled = enabled, shape = CircleShape,
        color = palette.segmentTrack, border = BorderStroke(1.dp, palette.border.copy(alpha = .6f)),
        interactionSource = press,
        modifier = Modifier.heightIn(min = 36.dp).pressScale(press),
    ) {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(model.ifBlank { stringResource(R.string.assistant_model_pick) }, style = MaterialTheme.typography.labelLarge, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
            if (effortLabel != null) Text(effortLabel, style = MaterialTheme.typography.labelSmall, color = palette.accent)
        }
    }
}
