package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// ── Thinking Block ────────────────────────────────────────────────────────────

@Composable
fun ThinkingBlock(
    thinking: String,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = false,
) {
    val componentTokens = PlumTheme.tokens
    var expanded by remember { mutableStateOf(initiallyExpanded) }
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    val chevronAngle by animateFloatAsState(
        targetValue = if (expanded) 90f else 0f,
        animationSpec = tween(componentTokens.motion.medium, easing = FastOutSlowInEasing),
        label = "chevron",
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.sm))
            .background(
                color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.6f),
            ),
    ) {
        // ── Collapsed header ──────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = componentTokens.spacing.md, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        ) {
            // Brain icon with subtle pulse when showing thinking indicator
            Icon(
                imageVector = Icons.Outlined.Psychology,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.size(15.dp),
            )

            Text(
                text = stringResource(R.string.component_thinking),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f),
            )

            // Word count hint
            val wordCount = remember(thinking) {
                thinking.trim().split(Regex("\\s+")).size
            }
            Text(
                text = stringResource(R.string.component_word_count, wordCount),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                fontSize = 10.sp,
            )

            // Expand chevron
            Icon(
                imageVector = Icons.Outlined.ChevronRight,
                contentDescription = if (expanded) stringResource(R.string.component_collapse_thinking) else stringResource(R.string.component_expand_thinking),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier
                    .size(componentTokens.sizing.iconSm)
                    .rotate(chevronAngle),
            )
        }

        // ── Expanded content ──────────────────────────────────────────────────
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(
                animationSpec = tween(componentTokens.motion.medium, easing = FastOutSlowInEasing),
                expandFrom = Alignment.Top,
            ) + fadeIn(animationSpec = tween(componentTokens.motion.fast)),
            exit = shrinkVertically(
                animationSpec = tween(componentTokens.motion.fast, easing = FastOutSlowInEasing),
                shrinkTowards = Alignment.Top,
            ) + fadeOut(animationSpec = tween(120)),
        ) {
            Column {
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                    thickness = 0.5.dp,
                )

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = componentTokens.spacing.md, end = componentTokens.spacing.md, top = componentTokens.spacing.compact, bottom = componentTokens.spacing.xs),
                ) {
                    // Left accent line
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(componentTokens.spacing.xxs)
                            .align(Alignment.TopStart)
                            .background(
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f),
                                shape = RoundedCornerShape(1.dp),
                            )
                    )

                    // Thinking text
                    Text(
                        text = thinking,
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontStyle = FontStyle.Italic,
                            lineHeight = 20.sp,
                            fontSize = 13.sp,
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
                        modifier = Modifier.padding(start = componentTokens.spacing.compact),
                    )
                }

                // Copy button row
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.inline),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(thinking))
                            copied = true
                        },
                        contentPadding = PaddingValues(horizontal = componentTokens.spacing.sm, vertical = componentTokens.spacing.xs),
                    ) {
                        Icon(
                            imageVector = if (copied) Icons.Outlined.CheckCircle else Icons.Outlined.ContentCopy,
                            contentDescription = stringResource(R.string.component_copy_thinking),
                            modifier = Modifier.size(13.dp),
                            tint = if (copied) Color(0xFF22C55E)
                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        )
                        Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
                        Text(
                            text = if (copied) stringResource(R.string.component_copied) else stringResource(R.string.component_copy),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (copied) Color(0xFF22C55E)
                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                            fontSize = 11.sp,
                        )
                    }
                }
            }
        }
    }

    LaunchedEffect(copied) {
        if (copied) {
            kotlinx.coroutines.delay(2000)
            copied = false
        }
    }
}
