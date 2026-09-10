package com.claudewebui.app.ui.screens.chat

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.*
import com.claudewebui.app.ui.components.common.*
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.PlumTheme
import java.text.DecimalFormat

@Composable
private fun LimitWindowStat(
    label: String,
    window: UsageLimitWindow,
    modifier: Modifier = Modifier,
) {
    val utilization = window.utilization.coerceIn(0, 100)
    val color = when {
        utilization >= 85 -> PlumRed
        utilization >= 60 -> PlumAmber
        else -> PlumGreen
    }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "$label  $utilization%",
                color = color,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
            formatLimitReset(LocalContext.current, window.resetsAt)?.let {
                Text(text = it, color = PlumMuted, fontSize = 10.sp)
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(3.dp)
                .clip(RoundedCornerShape(1.5.dp))
                .background(PlumTrackFill),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(utilization / 100f)
                    .background(color),
            )
        }
    }
}

private fun formatLimitReset(context: Context, resetsAt: String?): String? = runCatching {
    val instant = java.time.Instant.parse(resetsAt ?: return null)
    val minutes = java.time.Duration.between(java.time.Instant.now(), instant).toMinutes()
    when {
        minutes <= 0 -> null
        minutes < 60 -> context.getString(R.string.chat_reset_minutes, minutes)
        minutes < 48 * 60 -> context.getString(R.string.chat_reset_hours, minutes / 60)
        else -> context.getString(R.string.chat_reset_days, minutes / (24 * 60))
    }
}.getOrNull()

// ── Usage Banner ──────────────────────────────────────────────────────────────

@Composable
internal fun UsageBanner(usage: UsageData?, session: Session?, limits: UsageLimitData?) {
    val t = PlumTheme.tokens
    val df = remember { DecimalFormat("#,##0") }
    val costDf = remember { DecimalFormat("$0.0000") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = t.spacing.md, vertical = t.spacing.xs)
            .glassSurface(RoundedCornerShape(t.radius.lg))
            .padding(horizontal = t.spacing.lg, vertical = t.spacing.md),
        verticalArrangement = Arrangement.spacedBy(t.spacing.sm),
    ) {
        // Model + account limits — moved out of the header so the chat keeps
        // its vertical space; the header only carries title and tabs now.
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(t.spacing.md),
        ) {
            Text(
                text = "✦  ${session?.let { sessionModel(it) } ?: stringResource(R.string.chat_model)}",
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(0.9f),
            )
            val windows = buildList {
                limits?.fiveHour?.let { add("5h" to it) }
                limits?.sevenDay?.let { add(stringResource(R.string.chat_week) to it) }
            }
            if (windows.isEmpty()) {
                Text(text = stringResource(R.string.chat_limits_empty), color = PlumMuted, fontSize = 11.sp)
            } else {
                windows.forEach { (label, window) ->
                    LimitWindowStat(label = label, window = window, modifier = Modifier.weight(1f))
                }
            }
        }

        if (usage != null) {
            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                thickness = 0.5.dp,
            )

            // Context window progress
            if (usage.contextWindow > 0) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.chat_context),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = stringResource(R.string.chat_context_percent, usage.contextUsedPercent.toInt()),
                        style = MaterialTheme.typography.labelSmall,
                        color = when {
                            usage.contextUsedPercent >= 90 -> MaterialTheme.colorScheme.error
                            usage.contextUsedPercent >= 70 -> ClaudeWebUITheme.extendedColors.warning
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                LinearProgressIndicator(
                    progress = { (usage.contextUsedPercent / 100.0).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(t.spacing.xs)
                        .clip(RoundedCornerShape(t.spacing.xxs)),
                    color = when {
                        usage.contextUsedPercent >= 90 -> MaterialTheme.colorScheme.error
                        usage.contextUsedPercent >= 70 -> ClaudeWebUITheme.extendedColors.warning
                        else -> MaterialTheme.colorScheme.primary
                    },
                )
            }

            // Token row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(t.spacing.lg),
            ) {
                UsageStat(label = stringResource(R.string.chat_input), value = df.format(usage.inputTokens) + " tk")
                UsageStat(label = stringResource(R.string.chat_output), value = df.format(usage.outputTokens) + " tk")
                if (usage.cacheReadTokens > 0) {
                    UsageStat(label = stringResource(R.string.chat_cache), value = df.format(usage.cacheReadTokens) + " tk")
                }
                Spacer(modifier = Modifier.weight(1f))
                UsageStat(label = stringResource(R.string.chat_cost), value = costDf.format(usage.totalCostUsd))
            }
        }
    }
}

@Composable
private fun UsageStat(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Streaming Bubble ──────────────────────────────────────────────────────────
