package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.claudewebui.app.R
import com.claudewebui.app.ui.theme.PlumGlassCard
import com.claudewebui.app.ui.theme.PlumTheme

/** The parent transcript owns scrolling; these cards never nest another lazy list. */
@Composable
fun TaskWorkflowGrid(onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val tokens = PlumTheme.tokens
    val context = LocalContext.current
    Column(modifier.padding(tokens.spacing.screenHorizontal), verticalArrangement = Arrangement.spacedBy(tokens.spacing.md)) {
        Text(stringResource(R.string.workflow_heading), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        BoxWithConstraints {
            val columns = if (maxWidth >= 480.dp) 2 else 1
            Column(verticalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
                taskWorkflows.chunked(columns).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(tokens.spacing.sm)) {
                        row.forEach { workflow ->
                            PlumGlassCard(
                                modifier = Modifier.weight(1f).heightIn(min = tokens.sizing.touchTarget),
                                onClick = { onSelect(context.getString(workflow.prompt)) },
                            ) {
                                Text(stringResource(workflow.title), style = MaterialTheme.typography.titleSmall)
                                Spacer(Modifier.height(tokens.spacing.xs))
                                Text(stringResource(workflow.description), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}
