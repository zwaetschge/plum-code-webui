package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Shuffle
import androidx.compose.material.icons.outlined.TouchApp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.PlumMotionTokens
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.motion.reducedMotion
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

private fun JsonObject.with(key: String, value: JsonElement): JsonObject = JsonObject(this + (key to value))
private fun ints(values: Collection<Int>) = JsonArray(values.map { JsonPrimitive(it) })
private fun JsonObject.intList(key: String): List<Int> = (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.intOrNull } ?: emptyList()
private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

/** Header with a title and a small progress readout. */
@Composable
private fun LearningHeader(title: String?, trailing: String, ctx: DuiCtx) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title.orEmpty(), Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp), fontWeight = FontWeight.SemiBold, color = ctx.palette.text)
        Text(trailing, style = MaterialTheme.typography.labelMedium.merge(duiTabular), color = ctx.palette.muted)
    }
}

@Composable
private fun ThinProgress(fraction: Float, ctx: DuiCtx, color: Color = ctx.palette.accent) {
    val reduce = reducedMotion()
    val shown by animateFloatAsState(fraction.coerceIn(0f, 1f), if (reduce) snap() else tween(DUI_ROW_MS, easing = DuiEase), label = "dui_learning_progress")
    Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(ctx.palette.text.copy(alpha = .08f))) {
        Box(Modifier.fillMaxWidth(shown).height(4.dp).clip(CircleShape).background(color))
    }
}

@Composable
private fun PillButton(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector?, onClick: () -> Unit, ctx: DuiCtx, modifier: Modifier = Modifier, primary: Boolean = false, tint: Color? = null, enabled: Boolean = true) {
    val source = remember { MutableInteractionSource() }
    val color = tint ?: if (primary) ctx.palette.accent else ctx.palette.text
    Row(
        modifier
            .heightIn(min = 40.dp)
            .pressScale(source)
            .clip(CircleShape)
            .background(if (primary) color.copy(alpha = .22f) else color.copy(alpha = .07f))
            .border(1.dp, if (primary) color.copy(alpha = .45f) else ctx.palette.duiEdge, CircleShape)
            .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else .45f)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        icon?.let { Icon(it, null, tint = tint ?: ctx.palette.text, modifier = Modifier.size(16.dp)) }
        Text(label, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), fontWeight = FontWeight.SemiBold, color = tint ?: ctx.palette.text, maxLines = 1)
    }
}

// ── Checklist ───────────────────────────────────────────────────────────────

@Composable
internal fun DuiChecklist(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val items = node.objects("items")
    val memory = rememberDuiMemory(ctx.memoryKey, node.string("id"))
    val done = memory.value.strings("done").toSet()
    val count = items.count { it.string("id") in done }
    val palette = ctx.palette
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(PlumMotionTokens.COPY_CONFIRM_MS); copied = false } }
    val title = node.string("title")
    val allDone = count == items.size && items.isNotEmpty()
    DuiPanel(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LearningHeader(title ?: stringResource(R.string.dynamic_ui_checklist), stringResource(R.string.dynamic_ui_checklist_progress, count, items.size), ctx)
            ThinProgress(if (items.isEmpty()) 0f else count.toFloat() / items.size, ctx, if (allDone) palette.duiPositive else palette.accent)
        }
        Column {
            items.forEachIndexed { index, item ->
                val id = item.string("id").orEmpty()
                val checked = id in done
                val label = ctx.rt.template(item.string("label").orEmpty())
                val detail = item.string("detail")?.let { ctx.rt.template(it) }
                ChecklistRow(label, detail, checked, ctx, Modifier.duiRise(ctx.animate, index)) {
                    val next = if (checked) done - id else done + id
                    memory.update(memory.value.with("done", JsonArray(next.map { JsonPrimitive(it) })))
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AnimatedVisibility(allDone, enter = fadeIn(tween(DUI_ROW_MS)) + scaleIn(tween(DUI_ROW_MS, easing = DuiEase), initialScale = .9f), exit = fadeOut()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Outlined.Check, null, tint = palette.duiPositive, modifier = Modifier.size(16.dp))
                    Text(stringResource(R.string.dynamic_ui_checklist_done), style = MaterialTheme.typography.labelLarge, color = palette.duiPositive, fontWeight = FontWeight.SemiBold)
                }
            }
            Spacer(Modifier.weight(1f))
            if (count > 0) PillButton(stringResource(R.string.dynamic_ui_reset), Icons.Outlined.Refresh, { memory.update(memory.value.with("done", JsonArray(emptyList()))) }, ctx)
            if (node.bool("copyable") == true) PillButton(
                stringResource(if (copied) R.string.dynamic_ui_copied else R.string.dynamic_ui_copy_list),
                if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                {
                    val text = buildString {
                        title?.let { appendLine(it) }
                        items.forEach { item ->
                            val mark = if (item.string("id") in done) "☑" else "☐"
                            append(mark).append(' ').append(ctx.rt.template(item.string("label").orEmpty()))
                            item.string("detail")?.let { append(" — ").append(ctx.rt.template(it)) }
                            appendLine()
                        }
                    }.trimEnd()
                    clipboard.setText(AnnotatedString(text))
                    copied = true
                },
                ctx,
            )
        }
    }
}

@Composable
private fun ChecklistRow(label: String, detail: String?, checked: Boolean, ctx: DuiCtx, modifier: Modifier, onToggle: () -> Unit) {
    val palette = ctx.palette
    val reduce = reducedMotion()
    val fill by animateFloatAsState(if (checked) 1f else 0f, if (reduce) snap() else spring(.6f, 600f), label = "dui_check_fill")
    val textColor by animateColorAsState(if (checked) palette.muted else palette.text, if (reduce) snap() else tween(240), label = "dui_check_text")
    val stateLabel = stringResource(if (checked) R.string.dynamic_ui_state_done else R.string.dynamic_ui_state_open)
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.Checkbox, onClick = onToggle)
            .heightIn(min = 46.dp)
            .padding(horizontal = 2.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) { stateDescription = stateLabel },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.padding(top = 1.dp).size(22.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(22.dp)) {
                val stroke = 1.8.dp.toPx()
                drawCircle(palette.text.copy(alpha = .3f * (1f - fill)), radius = size.minDimension / 2 - stroke / 2, style = Stroke(stroke))
                drawCircle(palette.accent.copy(alpha = fill), radius = (size.minDimension / 2) * (.6f + .4f * fill))
            }
            if (fill > .05f) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(14.dp).graphicsLayer { scaleX = fill; scaleY = fill })
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, textDecoration = if (checked) TextDecoration.LineThrough else null), color = textColor)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = palette.muted) }
        }
    }
}

// ── Quiz ────────────────────────────────────────────────────────────────────

/** Normalised text answer: trimmed, case-insensitive, single spaces. */
private fun normalAnswer(value: String) = value.trim().replace(Regex("\\s+"), " ").lowercase()

@Composable
internal fun DuiQuiz(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val questions = node.objects("questions")
    if (questions.isEmpty()) return
    val memory = rememberDuiMemory(ctx.memoryKey, node.string("id"))
    val state = memory.value
    val index = (state.int("i") ?: 0).coerceIn(0, questions.size)
    val answers = (state["a"] as? JsonObject) ?: JsonObject(emptyMap())
    val hints = state.intList("h").toSet()
    val palette = ctx.palette
    val reduce = reducedMotion()
    fun correct(question: JsonObject, answer: JsonElement?): Boolean = when {
        answer == null -> false
        quizQuestionKind(question) == "choice" -> (answer as? JsonPrimitive)?.intOrNull == question.number("answer")?.toInt()
        else -> normalAnswer(answer.str().orEmpty()) == normalAnswer(question.string("answer").orEmpty())
    }
    val score = questions.indices.count { correct(questions[it], answers[it.toString()]) }
    val finished = index >= questions.size
    DuiPanel(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LearningHeader(
                node.string("title") ?: stringResource(R.string.dynamic_ui_quiz),
                if (finished) stringResource(R.string.dynamic_ui_quiz_score_short, score, questions.size) else stringResource(R.string.dynamic_ui_quiz_position, index + 1, questions.size),
                ctx,
            )
            // One segment per question: answered right/wrong, current, open.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                questions.forEachIndexed { i, question ->
                    val answer = answers[i.toString()]
                    val color = when {
                        answer != null && correct(question, answer) -> palette.duiPositive
                        answer != null -> palette.duiNegative
                        i == index -> palette.accent
                        else -> palette.text.copy(alpha = .1f)
                    }
                    Box(Modifier.weight(1f).height(4.dp).clip(CircleShape).background(color))
                }
            }
        }
        AnimatedContent(
            targetState = index,
            transitionSpec = {
                if (reduce) EnterTransition.None togetherWith ExitTransition.None
                else (fadeIn(tween(DUI_ROW_MS, easing = DuiEase)) + slideInHorizontally(tween(DUI_ROW_MS, easing = DuiEase)) { it / 8 }) togetherWith
                    (fadeOut(tween(150)) + slideOutHorizontally(tween(150)) { -it / 10 }) using SizeTransform(clip = false)
            },
            label = "dui_quiz",
        ) { current ->
            if (current >= questions.size) QuizResult(score, questions.size, ctx) { memory.update(JsonObject(emptyMap())) }
            else QuizQuestion(
                question = questions[current],
                answer = answers[current.toString()],
                hintShown = current in hints,
                correct = { correct(questions[current], it) },
                ctx = ctx,
                onAnswer = { value -> memory.update(state.with("a", JsonObject(answers + (current.toString() to value)))) },
                onHint = { memory.update(state.with("h", ints(hints + current))) },
                onNext = { memory.update(state.with("i", JsonPrimitive(current + 1))) },
                last = current == questions.lastIndex,
            )
        }
    }
}

@Composable
private fun QuizQuestion(
    question: JsonObject,
    answer: JsonElement?,
    hintShown: Boolean,
    correct: (JsonElement?) -> Boolean,
    ctx: DuiCtx,
    onAnswer: (JsonElement) -> Unit,
    onHint: () -> Unit,
    onNext: () -> Unit,
    last: Boolean,
) {
    val palette = ctx.palette
    val answered = answer != null
    val right = correct(answer)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(question.string("q").orEmpty(), style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp, lineHeight = 23.sp), fontWeight = FontWeight.SemiBold, color = palette.text)
        if (quizQuestionKind(question) == "choice") {
            val options = question.strings("options")
            val solution = question.number("answer")?.toInt()
            val chosen = (answer as? JsonPrimitive)?.intOrNull
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                options.forEachIndexed { i, option ->
                    val state = when {
                        !answered -> 0
                        i == solution -> 1
                        i == chosen -> 2
                        else -> 3
                    }
                    QuizOption(('A' + i).toString(), option, state, enabled = !answered, ctx) { onAnswer(JsonPrimitive(i)) }
                }
            }
        } else {
            var typed by remember(question) { mutableStateOf(answer.str().orEmpty()) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(palette.duiField)
                        .border(1.dp, if (!answered) palette.duiEdge else if (right) palette.duiPositive.copy(alpha = .6f) else palette.duiNegative.copy(alpha = .6f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 11.dp),
                ) {
                    if (typed.isEmpty()) Text(stringResource(R.string.dynamic_ui_quiz_type_answer), style = MaterialTheme.typography.bodyMedium, color = palette.muted)
                    BasicTextField(
                        value = typed,
                        onValueChange = { typed = it.take(200) },
                        enabled = !answered,
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = palette.text),
                        cursorBrush = SolidColor(palette.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { if (typed.isNotBlank()) onAnswer(JsonPrimitive(typed)) }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (!answered) PillButton(stringResource(R.string.dynamic_ui_quiz_check), null, { onAnswer(JsonPrimitive(typed)) }, ctx, primary = true, enabled = typed.isNotBlank())
            }
            if (answered && !right) Text(stringResource(R.string.dynamic_ui_quiz_expected, question.string("answer").orEmpty()), style = MaterialTheme.typography.bodyMedium, color = palette.text)
        }
        val hint = question.string("hint")
        AnimatedVisibility(hintShown && hint != null && !answered, enter = expandVertically(tween(DUI_ROW_MS, easing = DuiEase)) + fadeIn(), exit = fadeOut()) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(palette.amber.copy(alpha = .12f)).padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.Lightbulb, null, tint = if (palette.isLight) Color(0xFFB26A00) else palette.amber, modifier = Modifier.size(17.dp))
                Text(hint.orEmpty(), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp), color = palette.text)
            }
        }
        AnimatedVisibility(answered, enter = expandVertically(tween(DUI_ROW_MS, easing = DuiEase)) + fadeIn(tween(DUI_ROW_MS)), exit = fadeOut()) {
            val tone = if (right) palette.duiPositive else palette.duiNegative
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(tone.copy(alpha = .10f)).padding(12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(if (right) Icons.Outlined.Check else Icons.Outlined.Close, null, tint = tone, modifier = Modifier.size(17.dp))
                    Text(stringResource(if (right) R.string.dynamic_ui_quiz_right else R.string.dynamic_ui_quiz_wrong), style = MaterialTheme.typography.labelLarge.copy(fontSize = 14.sp), fontWeight = FontWeight.SemiBold, color = tone)
                }
                question.string("explanation")?.let { Text(it, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp), color = palette.text) }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (hint != null && !answered && !hintShown) PillButton(stringResource(R.string.dynamic_ui_quiz_hint), Icons.Outlined.Lightbulb, onHint, ctx)
            Spacer(Modifier.weight(1f))
            if (answered) PillButton(
                stringResource(if (last) R.string.dynamic_ui_quiz_result else R.string.dynamic_ui_next),
                Icons.AutoMirrored.Outlined.ArrowForward, onNext, ctx, primary = true,
            )
        }
    }
}

/** state: 0 open, 1 the right answer, 2 chosen and wrong, 3 not chosen. */
@Composable
private fun QuizOption(letter: String, label: String, state: Int, enabled: Boolean, ctx: DuiCtx, onClick: () -> Unit) {
    val palette = ctx.palette
    val reduce = reducedMotion()
    val tone = when (state) { 1 -> palette.duiPositive; 2 -> palette.duiNegative; else -> palette.text }
    val border by animateColorAsState(when (state) { 1, 2 -> tone.copy(alpha = .7f); else -> palette.duiEdge }, if (reduce) snap() else tween(220), label = "dui_quiz_border")
    val fill by animateColorAsState(when (state) { 1, 2 -> tone.copy(alpha = .12f); else -> palette.duiField }, if (reduce) snap() else tween(220), label = "dui_quiz_fill")
    val source = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .pressScale(source)
            .clip(RoundedCornerShape(14.dp))
            .background(fill)
            .border(1.dp, border, RoundedCornerShape(14.dp))
            .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .alpha(if (state == 3) .55f else 1f)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(if (state == 1 || state == 2) tone else palette.text.copy(alpha = .08f)), contentAlignment = Alignment.Center) {
            when (state) {
                1 -> Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(15.dp))
                2 -> Icon(Icons.Outlined.Close, null, tint = Color.White, modifier = Modifier.size(15.dp))
                else -> Text(letter, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = palette.muted)
            }
        }
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), color = palette.text)
    }
}

@Composable
private fun QuizResult(score: Int, total: Int, ctx: DuiCtx, onRestart: () -> Unit) {
    val palette = ctx.palette
    val fraction = if (total == 0) 0f else score.toFloat() / total
    val reduce = reducedMotion()
    val shown by animateFloatAsState(fraction, if (reduce) snap() else tween(1200, easing = DuiEase), label = "dui_quiz_ring")
    val message = when {
        fraction >= .99f -> R.string.dynamic_ui_quiz_perfect
        fraction >= .6f -> R.string.dynamic_ui_quiz_good
        else -> R.string.dynamic_ui_quiz_practice
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(104.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(104.dp)) {
                val stroke = 9.dp.toPx()
                val inset = stroke / 2
                drawArc(palette.text.copy(alpha = .09f), 0f, 360f, false, Offset(inset, inset), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke))
                drawArc(if (fraction >= .6f) palette.duiPositive else palette.accent, -90f, 360f * shown, false, Offset(inset, inset), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("$score/$total", style = MaterialTheme.typography.headlineSmall.merge(duiTabular), fontWeight = FontWeight.SemiBold, color = palette.text)
            }
        }
        Text(stringResource(R.string.dynamic_ui_quiz_score, score, total), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        Text(stringResource(message), style = MaterialTheme.typography.bodyMedium, color = palette.muted, textAlign = TextAlign.Center)
        PillButton(stringResource(R.string.dynamic_ui_quiz_again), Icons.Outlined.Refresh, onRestart, ctx, primary = true)
    }
}

// ── Flashcards ──────────────────────────────────────────────────────────────

@Composable
internal fun DuiFlashcards(node: JsonObject, ctx: DuiCtx, modifier: Modifier) {
    val cards = node.objects("cards")
    if (cards.isEmpty()) return
    val memory = rememberDuiMemory(ctx.memoryKey, node.string("id"))
    val state = memory.value
    val order = state.intList("order").takeIf { saved -> saved.size == cards.size && saved.toSet() == cards.indices.toSet() } ?: cards.indices.toList()
    val position = (state.int("i") ?: 0).coerceIn(0, cards.size)
    val known = state.intList("known").toSet()
    val unknown = state.intList("unknown").toSet()
    var flipped by remember(position) { mutableStateOf(false) }
    val palette = ctx.palette
    val reduce = reducedMotion()
    val rotation by animateFloatAsState(if (flipped) 180f else 0f, if (reduce) snap() else tween(520, easing = DuiEase), label = "dui_flip")
    fun save(next: JsonObject) = memory.update(next)
    fun go(to: Int) = save(state.with("i", JsonPrimitive(to.coerceIn(0, cards.size))).with("order", ints(order)))
    fun mark(knew: Boolean) {
        val card = order.getOrNull(position) ?: return
        val nextKnown = if (knew) known + card else known - card
        val nextUnknown = if (knew) unknown - card else unknown + card
        save(state.with("known", ints(nextKnown)).with("unknown", ints(nextUnknown)).with("order", ints(order)).with("i", JsonPrimitive(position + 1)))
    }
    DuiPanel(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LearningHeader(
                stringResource(R.string.dynamic_ui_flashcards),
                if (position >= cards.size) stringResource(R.string.dynamic_ui_flashcards_known, known.size, cards.size) else "${position + 1} / ${cards.size}",
                ctx,
            )
            ThinProgress(position.toFloat() / cards.size, ctx)
        }
        if (position >= cards.size) {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.dynamic_ui_flashcards_summary, known.size, unknown.size), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.text, textAlign = TextAlign.Center)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (unknown.isNotEmpty()) PillButton(stringResource(R.string.dynamic_ui_flashcards_repeat), Icons.Outlined.Refresh, {
                        val again = order.filter { it in unknown }
                        save(JsonObject(mapOf("order" to ints(again + order.filter { it !in unknown }), "i" to JsonPrimitive(0), "known" to ints(known), "unknown" to ints(emptyList()))))
                    }, ctx, primary = true)
                    PillButton(stringResource(R.string.dynamic_ui_flashcards_restart), Icons.Outlined.Refresh, { memory.update(JsonObject(emptyMap())) }, ctx)
                }
            }
            return@DuiPanel
        }
        val card = cards[order[position]]
        val flipLabel = stringResource(R.string.dynamic_ui_flashcards_flip)
        val sideLabel = stringResource(if (flipped) R.string.dynamic_ui_card_back else R.string.dynamic_ui_card_front)
        val source = remember { MutableInteractionSource() }
        Box(
            Modifier
                .fillMaxWidth()
                .height(196.dp)
                .pressScale(source)
                .graphicsLayer {
                    rotationY = rotation
                    cameraDistance = 14f * density
                }
                .clip(RoundedCornerShape(20.dp))
                .background(
                    if (rotation <= 90f) (if (palette.isLight) Color.White else palette.text.copy(alpha = .07f))
                    else palette.accent.copy(alpha = if (palette.isLight) .12f else .18f),
                )
                .border(1.dp, if (rotation <= 90f) palette.duiEdge else palette.accent.copy(alpha = .4f), RoundedCornerShape(20.dp))
                .clickable(interactionSource = source, indication = null, role = Role.Button, onClickLabel = flipLabel) { flipped = !flipped }
                .semantics { stateDescription = sideLabel },
            contentAlignment = Alignment.Center,
        ) {
            val back = rotation > 90f
            Column(
                Modifier.fillMaxSize().graphicsLayer { if (back) rotationY = 180f }.padding(20.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    if (back) card.string("back").orEmpty() else card.string("front").orEmpty(),
                    style = if (back) MaterialTheme.typography.bodyLarge.copy(fontSize = 16.sp, lineHeight = 22.sp) else MaterialTheme.typography.titleLarge.copy(fontSize = 21.sp),
                    fontWeight = if (back) FontWeight.Normal else FontWeight.SemiBold,
                    color = palette.text,
                    textAlign = TextAlign.Center,
                )
            }
            if (!back) Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Outlined.TouchApp, null, tint = palette.muted, modifier = Modifier.size(13.dp))
                Text(flipLabel, style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            DuiToolButton(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.dynamic_ui_previous), { go(position - 1) }, enabled = position > 0)
            DuiToolButton(Icons.Outlined.Shuffle, stringResource(R.string.dynamic_ui_flashcards_shuffle), {
                save(state.with("order", ints(cards.indices.shuffled())).with("i", JsonPrimitive(0)))
            })
            Spacer(Modifier.weight(1f))
            if (flipped) {
                PillButton(stringResource(R.string.dynamic_ui_flashcards_unknown), Icons.Outlined.Close, { mark(false) }, ctx, tint = palette.duiNegative)
                PillButton(stringResource(R.string.dynamic_ui_flashcards_knew), Icons.Outlined.Check, { mark(true) }, ctx, tint = palette.duiPositive)
            } else DuiToolButton(Icons.AutoMirrored.Outlined.ArrowForward, stringResource(R.string.dynamic_ui_next), { go(position + 1) }, enabled = position < cards.size)
        }
    }
}
