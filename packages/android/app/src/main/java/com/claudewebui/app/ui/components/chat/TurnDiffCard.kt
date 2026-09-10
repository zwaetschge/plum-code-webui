package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.TurnDiffDetail
import com.claudewebui.app.data.model.TurnDiffSummary
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText

/**
 * One line per finished turn: how many files the agent touched and by how much.
 * Tapping loads the stored patch, so long diffs never travel with the thread.
 */
@Composable
fun TurnDiffRow(
    diff: TurnDiffSummary,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.md))
            .background(PlumSubtleFill)
            .border(1.dp, PlumBorder, RoundedCornerShape(componentTokens.radius.md))
            .clickable { onOpen(diff.id) }
            .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.component_changes),
            style = MaterialTheme.typography.labelMedium,
            color = PlumAccent,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(end = componentTokens.spacing.sm),
        )
        Text(
            diff.summary ?: stringResource(R.string.component_files_count, diff.filesChanged),
            style = MaterialTheme.typography.labelSmall,
            color = PlumMuted,
            modifier = Modifier.weight(1f),
        )
        if (diff.insertions > 0) {
            Text(
                "+${diff.insertions}",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF22C55E),
                modifier = Modifier.padding(start = componentTokens.spacing.inline),
            )
        }
        if (diff.deletions > 0) {
            Text(
                "-${diff.deletions}",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFEF4444),
                modifier = Modifier.padding(start = componentTokens.spacing.inline),
            )
        }
    }
}

/** Full patch view with the usual +/- colouring. */
@Composable
fun TurnDiffDetailView(detail: TurnDiffDetail, modifier: Modifier = Modifier) {
    val componentTokens = PlumTheme.tokens
    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = 480.dp)
            .verticalScroll(rememberScrollState())
            .padding(componentTokens.spacing.md),
        verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.xxs),
    ) {
        Text(
            detail.summary ?: stringResource(R.string.component_files_changed, detail.filesChanged),
            style = MaterialTheme.typography.labelMedium,
            color = PlumText,
            fontWeight = FontWeight.Bold,
        )
        Column(Modifier.horizontalScroll(rememberScrollState())) {
            detail.diff.lineSequence().forEach { line ->
                Text(
                    line,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = when {
                        line.startsWith("+++") || line.startsWith("---") -> PlumMuted
                        line.startsWith("+") -> Color(0xFF22C55E)
                        line.startsWith("-") -> Color(0xFFEF4444)
                        line.startsWith("@@") -> Color(0xFF38BDF8)
                        else -> PlumMuted
                    },
                    maxLines = 1,
                )
            }
        }
    }
}
