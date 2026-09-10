package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.PermissionRequestData
import com.claudewebui.app.data.model.QuestionRequestEvent

/**
 * Card for the legacy (denials-based) permission flow: the CLI turn was
 * blocked on one or more tools and asks to re-run with them approved.
 */
@Composable
fun LegacyPermissionCard(
    request: PermissionRequestData,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(componentTokens.radius.md)),
        shape = RoundedCornerShape(componentTokens.radius.md),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column(modifier = Modifier.padding(componentTokens.spacing.cozy)) {
            Text(
                text = stringResource(R.string.component_permission_required),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.height(componentTokens.spacing.xs))
            val tools = request.denials.joinToString(", ") { it.toolName }.ifBlank { stringResource(R.string.component_tools) }
            Text(
                text = stringResource(R.string.component_agent_wants_tools, tools),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(componentTokens.spacing.md))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            ) {
                OutlinedButton(
                    onClick = onDeny,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                ) {
                    Icon(Icons.Outlined.Block, contentDescription = null, modifier = Modifier.width(componentTokens.spacing.cozy))
                    Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
                    Text(stringResource(R.string.component_deny), style = MaterialTheme.typography.labelMedium)
                }
                FilledTonalButton(
                    onClick = onApprove,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                ) {
                    Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.width(componentTokens.spacing.cozy))
                    Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
                    Text(stringResource(R.string.component_approve_retry), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

/**
 * Card for OpenCode question prompts (`session:question_request`).
 * answers[i] carries the selected labels (or custom text) for question i.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuestionPromptCard(
    request: QuestionRequestEvent,
    onRespond: (List<List<String>>) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    // question index -> selected labels
    val selections = remember(request.requestId) { mutableStateMapOf<Int, Set<String>>() }
    // question index -> free-text answer (custom questions)
    val customText = remember(request.requestId) { mutableStateMapOf<Int, String>() }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(componentTokens.radius.md)),
        shape = RoundedCornerShape(componentTokens.radius.md),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column(modifier = Modifier.padding(componentTokens.spacing.cozy)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.QuestionAnswer,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.width(componentTokens.spacing.headerHorizontal),
                )
                Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
                Text(
                    text = stringResource(R.string.component_the_agent_needs_input),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            request.questions.forEachIndexed { index, question ->
                Spacer(modifier = Modifier.height(componentTokens.spacing.compact))
                Text(
                    text = question.question,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                )
                if (question.options.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(componentTokens.spacing.inline))
                    LazyRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline),
                        contentPadding = PaddingValues(end = componentTokens.spacing.sm),
                    ) {
                        items(question.options) { option ->
                            val selected = selections[index]?.contains(option.label) == true
                            FilterChip(
                                selected = selected,
                                onClick = {
                                    val current = selections[index].orEmpty()
                                    selections[index] = when {
                                        selected -> current - option.label
                                        question.multiple -> current + option.label
                                        else -> setOf(option.label)
                                    }
                                },
                                label = { Text(option.label, fontSize = 11.sp) },
                            )
                        }
                    }
                }
                if (question.custom) {
                    Spacer(modifier = Modifier.height(componentTokens.spacing.inline))
                    OutlinedTextField(
                        value = customText[index].orEmpty(),
                        onValueChange = { customText[index] = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text(stringResource(R.string.component_custom_answer), fontSize = 12.sp) },
                        textStyle = MaterialTheme.typography.bodySmall,
                        minLines = 1,
                        maxLines = 3,
                    )
                }
            }

            Spacer(modifier = Modifier.height(componentTokens.spacing.md))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            ) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                ) {
                    Text(stringResource(R.string.component_dismiss), style = MaterialTheme.typography.labelMedium)
                }
                val canSend = request.questions.indices.all { i ->
                    !selections[i].isNullOrEmpty() || !customText[i].isNullOrBlank() ||
                        request.questions[i].options.isEmpty() && !request.questions[i].custom
                }
                FilledTonalButton(
                    onClick = {
                        val answers = request.questions.indices.map { i ->
                            val picked = selections[i].orEmpty().toList()
                            val custom = customText[i]?.takeIf { it.isNotBlank() }
                            when {
                                picked.isNotEmpty() -> picked
                                custom != null -> listOf(custom)
                                else -> emptyList()
                            }
                        }
                        onRespond(answers)
                    },
                    enabled = canSend,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
                ) {
                    Text(stringResource(R.string.component_send), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}
