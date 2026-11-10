package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate
import java.time.ZoneOffset

// ── Stepper ─────────────────────────────────────────────────────────────────

@Composable
internal fun DuiStepper(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val lo = node.number("min")
    val hi = node.number("max")
    val step = node.number("step") ?: 1.0
    val decimals = remember(step) { stepDecimals(step) }
    val raw = uiNum(ctx.rt.state[bind]).takeIf { it.isFinite() } ?: lo ?: 0.0
    val value = raw.coerceIn(lo ?: Double.NEGATIVE_INFINITY, hi ?: Double.POSITIVE_INFINITY)
    val shown = formatUiValue(value, node.string("format"))
    val reduce = reducedMotion()
    var previous by remember { mutableStateOf(value) }
    val rising = value >= previous
    LaunchedEffect(value) { previous = value }
    fun move(direction: Int) {
        val next = java.math.BigDecimal(value + direction * step).setScale(decimals, java.math.RoundingMode.HALF_UP).toDouble()
            .coerceIn(lo ?: Double.NEGATIVE_INFINITY, hi ?: Double.POSITIVE_INFINITY)
        if (next != value) ctx.set(bind, next)
    }
    Row(
        modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = label; stateDescription = shown },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), color = ctx.palette.text)
        Row(
            Modifier.clip(CircleShape).background(ctx.palette.duiField).border(1.dp, ctx.palette.duiEdge, CircleShape).padding(3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StepperButton(Icons.Outlined.Remove, stringResource(R.string.dynamic_ui_decrease), enabled = !ctx.busy && (lo == null || value > lo), ctx) { move(-1) }
            AnimatedContent(
                targetState = shown,
                transitionSpec = {
                    if (reduce) EnterTransition.None togetherWith ExitTransition.None
                    else (slideInVertically(tween(220, easing = DuiEase)) { if (rising) it / 2 else -it / 2 } + fadeIn(tween(220))) togetherWith
                        (slideOutVertically(tween(160)) { if (rising) -it / 2 else it / 2 } + fadeOut(tween(120)))
                },
                label = "dui_stepper_value",
            ) { text ->
                Text(text, Modifier.widthIn(min = 44.dp).padding(horizontal = 6.dp), style = MaterialTheme.typography.titleSmall.merge(duiTabular), fontWeight = FontWeight.SemiBold, color = ctx.palette.text, textAlign = TextAlign.Center)
            }
            StepperButton(Icons.Outlined.Add, stringResource(R.string.dynamic_ui_increase), enabled = !ctx.busy && (hi == null || value < hi), ctx) { move(1) }
        }
    }
}

@Composable
private fun StepperButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, enabled: Boolean, ctx: DuiCtx, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    Box(
        Modifier
            .size(36.dp)
            .pressScale(source)
            .clip(CircleShape)
            .background(if (enabled) ctx.palette.text.copy(alpha = .08f) else ctx.palette.text.copy(alpha = .03f))
            .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClickLabel = description, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = ctx.palette.text.copy(alpha = if (enabled) 1f else .3f), modifier = Modifier.size(18.dp))
    }
}

// ── Radio ───────────────────────────────────────────────────────────────────

@Composable
internal fun DuiRadio(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val current = ctx.rt.state[bind]
    Column(modifier.fillMaxWidth().selectableGroup(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        FieldLabel(label, ctx.palette, Modifier.padding(bottom = 4.dp).semantics { heading() })
        optionsOf(node).forEach { option ->
            val selected = sameOption(option.value, current)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (selected) ctx.palette.accent.copy(alpha = .10f) else androidx.compose.ui.graphics.Color.Transparent)
                    .selectable(selected, enabled = !ctx.busy, role = Role.RadioButton) { ctx.set(bind, option.value) }
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = ctx.palette.accent, unselectedColor = ctx.palette.muted), modifier = Modifier.padding(8.dp))
                Text(option.label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), color = ctx.palette.text, fontWeight = if (selected) FontWeight.Medium else null)
            }
        }
    }
}

// ── Textarea ────────────────────────────────────────────────────────────────

@Composable
internal fun DuiTextarea(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val rows = (node.number("rows") ?: 3.0).toInt().coerceIn(2, 8)
    val current = ctx.rt.state[bind]
    var text by remember(bind) { mutableStateOf(inputText(current)) }
    LaunchedEffect(current) { if ((current ?: "") != text) text = inputText(current) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label, ctx.palette)
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(ctx.palette.duiField)
                .border(1.dp, ctx.palette.duiEdge, RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            if (text.isEmpty()) node.string("placeholder")?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = ctx.palette.muted) }
            BasicTextField(
                value = text,
                onValueChange = { typed -> text = typed.take(200); ctx.set(bind, text) },
                enabled = !ctx.busy,
                minLines = rows,
                maxLines = rows + 4,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = ctx.palette.text),
                cursorBrush = SolidColor(ctx.palette.accent),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
            )
        }
    }
}

// ── Date ────────────────────────────────────────────────────────────────────

private fun parseIsoDate(value: String?): LocalDate? = value?.takeIf { it.length == 10 }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

private fun LocalDate.utcMillis(): Long = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DuiDate(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val bind = node.string("bind").orEmpty()
    val label = node.string("label").orEmpty()
    val current = ctx.rt.state[bind] as? String
    val date = parseIsoDate(current)
    val min = parseIsoDate(node.string("min"))
    val max = parseIsoDate(node.string("max"))
    var open by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label, ctx.palette)
        FieldBox(
            ctx.palette,
            Modifier.clickable(enabled = !ctx.busy, role = Role.Button, onClickLabel = label) { open = true }.semantics(mergeDescendants = true) {
                contentDescription = label
                stateDescription = current?.takeIf { it.isNotEmpty() }?.let { formatUiDate(it) } ?: ""
            },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Outlined.CalendarToday, null, tint = ctx.palette.muted, modifier = Modifier.size(17.dp))
                Text(
                    date?.let { formatUiDate(it.toString()) } ?: stringResource(R.string.dynamic_ui_date_pick),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (date != null) ctx.palette.text else ctx.palette.muted,
                )
            }
        }
    }
    if (open) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = date?.utcMillis(),
            initialDisplayedMonthMillis = (date ?: min ?: LocalDate.now()).utcMillis(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                    val day = java.time.Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                    return (min == null || !day.isBefore(min)) && (max == null || !day.isAfter(max))
                }
                override fun isSelectableYear(year: Int): Boolean = (min == null || year >= min.year) && (max == null || year <= max.year)
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { millis -> ctx.set(bind, java.time.Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                    open = false
                }) { Text(stringResource(R.string.dynamic_ui_ok)) }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.dynamic_ui_cancel)) } },
            colors = DatePickerDefaults.colors(containerColor = ctx.palette.surfaceStrong.copy(alpha = 1f)),
        ) {
            DatePicker(state, showModeToggle = false, colors = DatePickerDefaults.colors(containerColor = ctx.palette.surfaceStrong.copy(alpha = 1f), selectedDayContainerColor = ctx.palette.accent, todayDateBorderColor = ctx.palette.accent))
        }
    }
}

// ── Form ────────────────────────────────────────────────────────────────────

/** Collects inputs; „Senden“ sends the templated message as the next turn. */
@Composable
internal fun DuiForm(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val submit = node["submit"] as? JsonObject ?: return
    var sent by remember { mutableStateOf(false) }
    LaunchedEffect(sent) { if (sent) { delay(2400); sent = false } }
    val enabled = !ctx.busy && ctx.send != null
    val source = remember { MutableInteractionSource() }
    DuiSurface(modifier, palette = ctx.palette) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            node.string("title")?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = ctx.palette.text, modifier = Modifier.semantics { heading() }) }
            Children(node.objects("children"), ctx)
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .pressScale(source)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (sent) ctx.palette.duiPositive.copy(alpha = .18f) else ctx.palette.accent)
                    .clickable(interactionSource = source, indication = null, enabled = enabled && !sent, role = Role.Button) {
                        ctx.send?.invoke(ctx.rt.template(submit.string("message").orEmpty()))
                        sent = true
                    }
                    .alpha(if (enabled || sent) 1f else .5f)
                    .padding(horizontal = 16.dp, vertical = 11.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (sent) Icons.Outlined.Check else Icons.AutoMirrored.Outlined.Send, null, tint = if (sent) ctx.palette.duiPositive else androidx.compose.ui.graphics.Color.White, modifier = Modifier.padding(end = 8.dp).size(16.dp))
                Text(
                    if (sent) stringResource(R.string.dynamic_ui_form_sent) else submit.string("label").orEmpty(),
                    style = MaterialTheme.typography.labelLarge.copy(fontSize = 14.sp),
                    fontWeight = FontWeight.SemiBold,
                    color = if (sent) ctx.palette.duiPositive else androidx.compose.ui.graphics.Color.White,
                )
            }
        }
    }
}
