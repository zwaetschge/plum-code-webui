package com.claudewebui.app.ui.screens.dashboard

import androidx.annotation.StringRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Balance
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.EventNote
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.ReportProblem
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Cake
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.Flight
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.DirectionsRun
import androidx.compose.material.icons.outlined.Percent
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.PlumTheme
import java.util.Calendar
import kotlin.math.abs

private enum class StartSketch { Growth, Dashboard, Compare, Write, Plan, Explain }

private data class StartSuggestion(
    val sketch: StartSketch,
    @StringRes val title: Int,
    @StringRes val hint: Int,
    @StringRes val prompt: Int,
    val icon: ImageVector,
) {
    val interactive get() = sketch == StartSketch.Growth || sketch == StartSketch.Dashboard || sketch == StartSketch.Compare
}

/** Same 36 starters as the WebUI (`startSuggestionData.ts`), six per sketch. */
private val SUGGESTIONS = listOf(
    StartSuggestion(StartSketch.Growth, R.string.start_savings_title, R.string.start_savings_hint, R.string.start_savings_prompt, Icons.AutoMirrored.Outlined.TrendingUp),
    StartSuggestion(StartSketch.Growth, R.string.start_mortgage_title, R.string.start_mortgage_hint, R.string.start_mortgage_prompt, Icons.Outlined.Home),
    StartSuggestion(StartSketch.Growth, R.string.start_pillar3a_title, R.string.start_pillar3a_hint, R.string.start_pillar3a_prompt, Icons.Outlined.AccountBalance),
    StartSuggestion(StartSketch.Growth, R.string.start_loan_title, R.string.start_loan_hint, R.string.start_loan_prompt, Icons.Outlined.Calculate),
    StartSuggestion(StartSketch.Growth, R.string.start_power_title, R.string.start_power_hint, R.string.start_power_prompt, Icons.Outlined.Bolt),
    StartSuggestion(StartSketch.Growth, R.string.start_salary_title, R.string.start_salary_hint, R.string.start_salary_prompt, Icons.Outlined.Percent),
    StartSuggestion(StartSketch.Dashboard, R.string.start_budget_title, R.string.start_budget_hint, R.string.start_budget_prompt, Icons.Outlined.BarChart),
    StartSuggestion(StartSketch.Dashboard, R.string.start_running_title, R.string.start_running_hint, R.string.start_running_prompt, Icons.Outlined.DirectionsRun),
    StartSuggestion(StartSketch.Dashboard, R.string.start_sleep_title, R.string.start_sleep_hint, R.string.start_sleep_prompt, Icons.Outlined.Bedtime),
    StartSuggestion(StartSketch.Dashboard, R.string.start_groceries_title, R.string.start_groceries_hint, R.string.start_groceries_prompt, Icons.Outlined.ShoppingCart),
    StartSuggestion(StartSketch.Dashboard, R.string.start_project_title, R.string.start_project_hint, R.string.start_project_prompt, Icons.Outlined.Checklist),
    StartSuggestion(StartSketch.Dashboard, R.string.start_energy_title, R.string.start_energy_hint, R.string.start_energy_prompt, Icons.Outlined.Speed),
    StartSuggestion(StartSketch.Compare, R.string.start_ebike_title, R.string.start_ebike_hint, R.string.start_ebike_prompt, Icons.Outlined.Balance),
    StartSuggestion(StartSketch.Compare, R.string.start_phone_title, R.string.start_phone_hint, R.string.start_phone_prompt, Icons.Outlined.Smartphone),
    StartSuggestion(StartSketch.Compare, R.string.start_health_title, R.string.start_health_hint, R.string.start_health_prompt, Icons.Outlined.HealthAndSafety),
    StartSuggestion(StartSketch.Compare, R.string.start_travel_title, R.string.start_travel_hint, R.string.start_travel_prompt, Icons.Outlined.Flight),
    StartSuggestion(StartSketch.Compare, R.string.start_laptop_title, R.string.start_laptop_hint, R.string.start_laptop_prompt, Icons.Outlined.Laptop),
    StartSuggestion(StartSketch.Compare, R.string.start_streaming_title, R.string.start_streaming_hint, R.string.start_streaming_prompt, Icons.Outlined.Tv),
    StartSuggestion(StartSketch.Write, R.string.start_text_title, R.string.start_text_hint, R.string.start_text_prompt, Icons.Outlined.EditNote),
    StartSuggestion(StartSketch.Write, R.string.start_application_title, R.string.start_application_hint, R.string.start_application_prompt, Icons.Outlined.Work),
    StartSuggestion(StartSketch.Write, R.string.start_decline_title, R.string.start_decline_hint, R.string.start_decline_prompt, Icons.Outlined.Mail),
    StartSuggestion(StartSketch.Write, R.string.start_greeting_title, R.string.start_greeting_hint, R.string.start_greeting_prompt, Icons.Outlined.Cake),
    StartSuggestion(StartSketch.Write, R.string.start_post_title, R.string.start_post_hint, R.string.start_post_prompt, Icons.Outlined.Campaign),
    StartSuggestion(StartSketch.Write, R.string.start_complaint_title, R.string.start_complaint_hint, R.string.start_complaint_prompt, Icons.Outlined.ReportProblem),
    StartSuggestion(StartSketch.Plan, R.string.start_day_title, R.string.start_day_hint, R.string.start_day_prompt, Icons.Outlined.EventNote),
    StartSuggestion(StartSketch.Plan, R.string.start_menu_title, R.string.start_menu_hint, R.string.start_menu_prompt, Icons.Outlined.Restaurant),
    StartSuggestion(StartSketch.Plan, R.string.start_move_title, R.string.start_move_hint, R.string.start_move_prompt, Icons.Outlined.LocalShipping),
    StartSuggestion(StartSketch.Plan, R.string.start_exam_title, R.string.start_exam_hint, R.string.start_exam_prompt, Icons.Outlined.School),
    StartSuggestion(StartSketch.Plan, R.string.start_workout_title, R.string.start_workout_hint, R.string.start_workout_prompt, Icons.Outlined.FitnessCenter),
    StartSuggestion(StartSketch.Plan, R.string.start_party_title, R.string.start_party_hint, R.string.start_party_prompt, Icons.Outlined.Celebration),
    StartSuggestion(StartSketch.Explain, R.string.start_topic_title, R.string.start_topic_hint, R.string.start_topic_prompt, Icons.Outlined.Lightbulb),
    StartSuggestion(StartSketch.Explain, R.string.start_ai_title, R.string.start_ai_hint, R.string.start_ai_prompt, Icons.Outlined.Psychology),
    StartSuggestion(StartSketch.Explain, R.string.start_inflation_title, R.string.start_inflation_hint, R.string.start_inflation_prompt, Icons.Outlined.Payments),
    StartSuggestion(StartSketch.Explain, R.string.start_quantum_title, R.string.start_quantum_hint, R.string.start_quantum_prompt, Icons.Outlined.Science),
    StartSuggestion(StartSketch.Explain, R.string.start_nature_title, R.string.start_nature_hint, R.string.start_nature_prompt, Icons.Outlined.Eco),
    StartSuggestion(StartSketch.Explain, R.string.start_blockchain_title, R.string.start_blockchain_hint, R.string.start_blockchain_prompt, Icons.Outlined.Link),
)

/** One starter per sketch in shuffled order; mornings lead with planning. */
private fun deal(hour: Int): List<StartSuggestion> {
    val hand = StartSketch.entries.map { sketch -> SUGGESTIONS.filter { it.sketch == sketch }.random() }.shuffled()
    return if (hour in 5..10) hand.sortedBy { if (it.sketch == StartSketch.Plan) 0 else 1 } else hand
}

/**
 * Start-page suggestions, same set as the WebUI (`StartSuggestions.tsx`): glass
 * cards with a looping sketch of the answer. Picking one fills the composer.
 */
@Composable
internal fun AssistantStartSuggestions(enabled: Boolean, columns: Int, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val reduce = reducedMotion()
    // One shared clock drives every sketch; reduced motion holds the resting frame.
    val phase: State<Float> = if (reduce) remember { mutableFloatStateOf(0.7f) } else {
        rememberInfiniteTransition(label = "start_sketch").animateFloat(0f, 1f, infiniteRepeatable(tween(5000, easing = LinearEasing)), label = "start_phase")
    }
    val items = remember { deal(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) }
    val prompts = items.associate { it.prompt to stringResource(it.prompt) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.chunked(columns).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { item -> StartCard(item, phase, enabled, Modifier.weight(1f)) { onPick(prompts.getValue(item.prompt)) } }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun StartCard(item: StartSuggestion, phase: State<Float>, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val palette = PlumTheme.palette
    val source = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        enabled = enabled,
        interactionSource = source,
        shape = RoundedCornerShape(16.dp),
        color = palette.controlSurface,
        border = BorderStroke(1.dp, palette.border.copy(alpha = .7f)),
        modifier = modifier.pressScale(source),
    ) {
        Column(Modifier.padding(8.dp)) {
            Box {
                Canvas(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(10.dp))) {
                    drawRect(palette.subtleFill)
                    drawSketch(item.sketch, phase.value, palette.accent, palette.text, palette.red, palette.background)
                }
                if (item.interactive) Surface(
                    shape = RoundedCornerShape(50),
                    color = palette.background.copy(alpha = .78f),
                    border = BorderStroke(1.dp, palette.accent.copy(alpha = .35f)),
                    modifier = Modifier.align(Alignment.TopEnd).padding(6.dp),
                ) { Text(stringResource(R.string.assistant_start_interactive), color = palette.accent, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp)) }
            }
            Row(Modifier.padding(top = 8.dp, start = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(item.icon, null, tint = palette.accent, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(item.title), color = palette.text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(stringResource(item.hint), color = palette.muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 3.dp, top = 1.dp))
        }
    }
}

/** 0 → 1 over [from, to] of the cycle, clamped. */
private fun span(t: Float, from: Float, to: Float) = ((t - from) / (to - from)).coerceIn(0f, 1f)
private fun ease(x: Float) = 1f - (1f - x) * (1f - x) * (1f - x)

private fun DrawScope.drawSketch(sketch: StartSketch, t: Float, accent: Color, text: Color, now: Color, hole: Color) {
    val w = size.width
    val h = size.height
    val u = h / 56f
    when (sketch) {
        StartSketch.Growth -> {
            val grow = ease(span(t, 0f, .45f))
            val fade = 1f - span(t, .88f, 1f)
            val curve = Path().apply {
                moveTo(w * .04f, h * .82f)
                cubicTo(w * .25f, h * .78f, w * .4f, h * .68f, w * .55f, h * .54f)
                cubicTo(w * .7f, h * .40f, w * .83f, h * .22f, w * .96f, h * .12f)
            }
            val area = Path().apply { addPath(curve); lineTo(w * .96f, h * .9f); lineTo(w * .04f, h * .9f); close() }
            drawPath(area, accent.copy(alpha = .16f * grow * fade))
            val measure = PathMeasure().apply { setPath(curve, false) }
            val part = Path()
            measure.getSegment(0f, measure.length * grow, part, true)
            drawPath(part, accent.copy(alpha = fade), style = Stroke(2f * u, cap = StrokeCap.Round))
            val track = h * .95f
            drawLine(text.copy(alpha = .14f), Offset(w * .07f, track), Offset(w * .93f, track), 1.4f * u, StrokeCap.Round)
            val knob = if (t < .9f) grow else 1f - span(t, .9f, 1f)
            drawCircle(accent, 2.6f * u, Offset(w * (.07f + .86f * knob), track))
        }
        StartSketch.Dashboard -> {
            drawRoundRect(text.copy(alpha = .07f), Offset(4 * u, 4 * u), Size(w * .28f, 11 * u), CornerRadius(3 * u))
            drawRoundRect(text.copy(alpha = .07f), Offset(w * .36f, 4 * u), Size(w * .28f, 11 * u), CornerRadius(3 * u))
            val bars = 6
            val gap = w / (bars * 1.8f + .8f)
            repeat(bars) { i ->
                // Each bar breathes on its own offset of the shared cycle.
                val wave = abs(((t + i * .15f) % 1f) * 2f - 1f)
                val scale = .3f + .55f * ease(wave)
                val barH = 32 * u * scale
                drawRoundRect(accent.copy(alpha = if (i % 2 == 0) .75f else .4f), Offset(gap * (.8f + i * 1.8f), 52 * u - barH), Size(gap, barH), CornerRadius(2 * u))
            }
        }
        StartSketch.Compare -> {
            val colW = (w - 12 * u) / 3f - 3 * u
            repeat(3) { i ->
                val x = 6 * u + i * (colW + 3 * u)
                drawRoundRect(text.copy(alpha = .07f), Offset(x, 6 * u), Size(colW, 44 * u), CornerRadius(5 * u))
                listOf(.6f, .72f, .42f).forEachIndexed { r, len ->
                    drawRoundRect(text.copy(alpha = .2f), Offset(x + 5 * u, (14 + r * 9) * u), Size(colW * len, 3 * u), CornerRadius(1.5f * u))
                }
            }
            // Selection ring rests on each column, then glides to the next.
            val step = t * 3f
            val slot = step.toInt().coerceAtMost(2)
            val glide = ease(span(step - slot, .8f, 1f))
            val pos = if (slot == 2) 2f - 2f * glide else slot + glide
            drawRoundRect(accent, Offset(6 * u + pos * (colW + 3 * u), 6 * u), Size(colW, 44 * u), CornerRadius(5 * u), style = Stroke(1.6f * u))
        }
        StartSketch.Write -> {
            val fade = 1f - span(t, .9f, 1f)
            var caretX = 10 * u
            repeat(3) { i ->
                val full = if (i == 2) w * .5f else w - 20 * u
                val grow = ease(span(t, i * .12f, i * .12f + .3f))
                drawRoundRect(text.copy(alpha = .2f * fade), Offset(10 * u, (12 + i * 13) * u), Size(full * grow, 4 * u), CornerRadius(2 * u))
                if (grow > 0f) caretX = 10 * u + full * grow
            }
            if ((t * 11f).toInt() % 2 == 0) drawRoundRect(accent, Offset(caretX + 2 * u, 33 * u), Size(1.6f * u, 10 * u), CornerRadius(.8f * u))
        }
        StartSketch.Plan -> {
            repeat(4) { i -> drawLine(text.copy(alpha = .14f), Offset(4 * u, (8 + i * 13) * u), Offset(w - 4 * u, (8 + i * 13) * u), .8f * u) }
            val fade = 1f - span(t, .9f, 1f)
            listOf(Triple(.1f, .35f, .5f), Triple(.33f, .45f, .8f), Triple(.2f, .3f, .5f)).forEachIndexed { i, (x, len, alpha) ->
                val inn = ease(span(t, i * .06f, i * .06f + .22f))
                drawRoundRect(accent.copy(alpha = alpha * inn * fade), Offset(w * x - 14 * u * (1f - inn), (10 + i * 13) * u), Size(w * len * (.4f + .6f * inn), 9 * u), CornerRadius(3 * u))
            }
            val nowX = 8 * u + (w - 16 * u) * t
            drawLine(now.copy(alpha = .75f), Offset(nowX, 4 * u), Offset(nowX, 52 * u), 1.2f * u)
        }
        StartSketch.Explain -> {
            val center = Offset(w / 2f, h / 2f)
            val nodes = listOf(Offset(w * .2f, 14 * u), Offset(w * .23f, 44 * u), Offset(w * .8f, 12 * u), Offset(w * .82f, 42 * u))
            val draw = ease(span(t, 0f, .35f))
            val fade = 1f - span(t, .9f, 1f)
            nodes.forEach { node -> drawLine(accent.copy(alpha = .55f * fade), center, center + (node - center) * draw, 1.4f * u, StrokeCap.Round) }
            drawCircle(accent, 7 * u, center)
            nodes.forEachIndexed { i, node ->
                val pop = ease(span(t, .07f + i * .036f, .25f + i * .036f)) * fade
                if (pop > 0f) {
                    drawCircle(hole, 4 * u * pop, node)
                    drawCircle(accent, 4 * u * pop, node, style = Stroke(1.6f * u))
                }
            }
        }
    }
}

/** Number of suggestion columns for the available width. */
internal fun startColumns(widthDp: Float) = if (widthDp >= 640f) 3 else 2
