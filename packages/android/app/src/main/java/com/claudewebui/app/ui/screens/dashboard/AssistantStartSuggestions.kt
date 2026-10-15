package com.claudewebui.app.ui.screens.dashboard

import androidx.annotation.StringRes
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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

private enum class StartSketch { Growth, Dashboard, Compare, Write, Plan, Explain }

private data class StartSuggestion(
    val key: String,
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
    StartSuggestion("savings", StartSketch.Growth, R.string.start_savings_title, R.string.start_savings_hint, R.string.start_savings_prompt, Icons.AutoMirrored.Outlined.TrendingUp),
    StartSuggestion("mortgage", StartSketch.Growth, R.string.start_mortgage_title, R.string.start_mortgage_hint, R.string.start_mortgage_prompt, Icons.Outlined.Home),
    StartSuggestion("pillar3a", StartSketch.Growth, R.string.start_pillar3a_title, R.string.start_pillar3a_hint, R.string.start_pillar3a_prompt, Icons.Outlined.AccountBalance),
    StartSuggestion("loan", StartSketch.Growth, R.string.start_loan_title, R.string.start_loan_hint, R.string.start_loan_prompt, Icons.Outlined.Calculate),
    StartSuggestion("power", StartSketch.Growth, R.string.start_power_title, R.string.start_power_hint, R.string.start_power_prompt, Icons.Outlined.Bolt),
    StartSuggestion("salary", StartSketch.Growth, R.string.start_salary_title, R.string.start_salary_hint, R.string.start_salary_prompt, Icons.Outlined.Percent),
    StartSuggestion("budget", StartSketch.Dashboard, R.string.start_budget_title, R.string.start_budget_hint, R.string.start_budget_prompt, Icons.Outlined.BarChart),
    StartSuggestion("running", StartSketch.Dashboard, R.string.start_running_title, R.string.start_running_hint, R.string.start_running_prompt, Icons.Outlined.DirectionsRun),
    StartSuggestion("sleep", StartSketch.Dashboard, R.string.start_sleep_title, R.string.start_sleep_hint, R.string.start_sleep_prompt, Icons.Outlined.Bedtime),
    StartSuggestion("groceries", StartSketch.Dashboard, R.string.start_groceries_title, R.string.start_groceries_hint, R.string.start_groceries_prompt, Icons.Outlined.ShoppingCart),
    StartSuggestion("project", StartSketch.Dashboard, R.string.start_project_title, R.string.start_project_hint, R.string.start_project_prompt, Icons.Outlined.Checklist),
    StartSuggestion("energy", StartSketch.Dashboard, R.string.start_energy_title, R.string.start_energy_hint, R.string.start_energy_prompt, Icons.Outlined.Speed),
    StartSuggestion("ebike", StartSketch.Compare, R.string.start_ebike_title, R.string.start_ebike_hint, R.string.start_ebike_prompt, Icons.Outlined.Balance),
    StartSuggestion("phone", StartSketch.Compare, R.string.start_phone_title, R.string.start_phone_hint, R.string.start_phone_prompt, Icons.Outlined.Smartphone),
    StartSuggestion("health", StartSketch.Compare, R.string.start_health_title, R.string.start_health_hint, R.string.start_health_prompt, Icons.Outlined.HealthAndSafety),
    StartSuggestion("travel", StartSketch.Compare, R.string.start_travel_title, R.string.start_travel_hint, R.string.start_travel_prompt, Icons.Outlined.Flight),
    StartSuggestion("laptop", StartSketch.Compare, R.string.start_laptop_title, R.string.start_laptop_hint, R.string.start_laptop_prompt, Icons.Outlined.Laptop),
    StartSuggestion("streaming", StartSketch.Compare, R.string.start_streaming_title, R.string.start_streaming_hint, R.string.start_streaming_prompt, Icons.Outlined.Tv),
    StartSuggestion("text", StartSketch.Write, R.string.start_text_title, R.string.start_text_hint, R.string.start_text_prompt, Icons.Outlined.EditNote),
    StartSuggestion("application", StartSketch.Write, R.string.start_application_title, R.string.start_application_hint, R.string.start_application_prompt, Icons.Outlined.Work),
    StartSuggestion("decline", StartSketch.Write, R.string.start_decline_title, R.string.start_decline_hint, R.string.start_decline_prompt, Icons.Outlined.Mail),
    StartSuggestion("greeting", StartSketch.Write, R.string.start_greeting_title, R.string.start_greeting_hint, R.string.start_greeting_prompt, Icons.Outlined.Cake),
    StartSuggestion("post", StartSketch.Write, R.string.start_post_title, R.string.start_post_hint, R.string.start_post_prompt, Icons.Outlined.Campaign),
    StartSuggestion("complaint", StartSketch.Write, R.string.start_complaint_title, R.string.start_complaint_hint, R.string.start_complaint_prompt, Icons.Outlined.ReportProblem),
    StartSuggestion("day", StartSketch.Plan, R.string.start_day_title, R.string.start_day_hint, R.string.start_day_prompt, Icons.Outlined.EventNote),
    StartSuggestion("menu", StartSketch.Plan, R.string.start_menu_title, R.string.start_menu_hint, R.string.start_menu_prompt, Icons.Outlined.Restaurant),
    StartSuggestion("move", StartSketch.Plan, R.string.start_move_title, R.string.start_move_hint, R.string.start_move_prompt, Icons.Outlined.LocalShipping),
    StartSuggestion("exam", StartSketch.Plan, R.string.start_exam_title, R.string.start_exam_hint, R.string.start_exam_prompt, Icons.Outlined.School),
    StartSuggestion("workout", StartSketch.Plan, R.string.start_workout_title, R.string.start_workout_hint, R.string.start_workout_prompt, Icons.Outlined.FitnessCenter),
    StartSuggestion("party", StartSketch.Plan, R.string.start_party_title, R.string.start_party_hint, R.string.start_party_prompt, Icons.Outlined.Celebration),
    StartSuggestion("topic", StartSketch.Explain, R.string.start_topic_title, R.string.start_topic_hint, R.string.start_topic_prompt, Icons.Outlined.Lightbulb),
    StartSuggestion("ai", StartSketch.Explain, R.string.start_ai_title, R.string.start_ai_hint, R.string.start_ai_prompt, Icons.Outlined.Psychology),
    StartSuggestion("inflation", StartSketch.Explain, R.string.start_inflation_title, R.string.start_inflation_hint, R.string.start_inflation_prompt, Icons.Outlined.Payments),
    StartSuggestion("quantum", StartSketch.Explain, R.string.start_quantum_title, R.string.start_quantum_hint, R.string.start_quantum_prompt, Icons.Outlined.Science),
    StartSuggestion("nature", StartSketch.Explain, R.string.start_nature_title, R.string.start_nature_hint, R.string.start_nature_prompt, Icons.Outlined.Eco),
    StartSuggestion("blockchain", StartSketch.Explain, R.string.start_blockchain_title, R.string.start_blockchain_hint, R.string.start_blockchain_prompt, Icons.Outlined.Link),
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
    // One shared clock drives every sketch; reduced motion holds each resting frame.
    val clock = remember { mutableLongStateOf(-1L) }
    LaunchedEffect(reduce) {
        if (reduce) { clock.longValue = -1L; return@LaunchedEffect }
        val start = withFrameMillis { it }
        while (true) withFrameMillis { clock.longValue = it - start }
    }
    val items = remember { deal(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) }
    val prompts = items.associate { it.prompt to stringResource(it.prompt) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.chunked(columns).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { item -> StartCard(item, clock, enabled, Modifier.weight(1f)) { onPick(prompts.getValue(item.prompt)) } }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun StartCard(item: StartSuggestion, clock: State<Long>, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val palette = PlumTheme.palette
    val source = remember { MutableInteractionSource() }
    val context = LocalContext.current
    val scene = remember(item.key) { StartScenes.get(context, item.key) }
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
                    scene?.let {
                        val now = clock.value
                        drawStartScene(it, if (now < 0) it.rest else (now % it.duration).toFloat() / it.duration, palette)
                    }
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

/** Number of suggestion columns for the available width. */
internal fun startColumns(widthDp: Float) = if (widthDp >= 640f) 3 else 2
