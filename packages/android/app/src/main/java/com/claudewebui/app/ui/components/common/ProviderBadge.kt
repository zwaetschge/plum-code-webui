package com.claudewebui.app.ui.components.common

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.CliProvider
import com.claudewebui.app.ui.theme.ProviderThemes

// ── Badge Sizes ──────────────────────────────────────────────────────────────

enum class BadgeSize {
    SMALL,
    MEDIUM,
}

// ── ProviderBadge Composable ─────────────────────────────────────────────────

@Composable
fun ProviderBadge(
    provider: CliProvider,
    modifier: Modifier = Modifier,
    size: BadgeSize = BadgeSize.SMALL,
    showLabel: Boolean = true,
) {
    val componentTokens = PlumTheme.tokens
    val isDark = isSystemInDarkTheme()
    val theme = ProviderThemes.get(provider)
    val containerColor = ProviderThemes.containerColor(provider, isDark)
    val contentColor = ProviderThemes.onContainerColor(provider, isDark)

    val (iconSize, horizontalPadding, verticalPadding, textStyle) = when (size) {
        BadgeSize.SMALL -> BadgeDimensions(
            iconSize = componentTokens.spacing.cozy,
            horizontalPadding = componentTokens.spacing.sm,
            verticalPadding = componentTokens.spacing.xs,
            textStyle = MaterialTheme.typography.labelSmall,
        )
        BadgeSize.MEDIUM -> BadgeDimensions(
            iconSize = componentTokens.spacing.lg,
            horizontalPadding = componentTokens.spacing.compact,
            verticalPadding = componentTokens.spacing.inline,
            textStyle = MaterialTheme.typography.labelMedium,
        )
    }

    Surface(
        modifier = modifier,
        color = containerColor,
        shape = RoundedCornerShape(componentTokens.spacing.inline),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = horizontalPadding, vertical = verticalPadding),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = theme.icon,
                contentDescription = null,
                modifier = Modifier.size(iconSize),
                tint = contentColor,
            )
            if (showLabel) {
                Spacer(modifier = Modifier.width(componentTokens.spacing.xs))
                Text(
                    text = theme.displayName,
                    style = textStyle,
                    color = contentColor,
                )
            }
        }
    }
}

// ── Internal Dimension Holder ────────────────────────────────────────────────

private data class BadgeDimensions(
    val iconSize: androidx.compose.ui.unit.Dp,
    val horizontalPadding: androidx.compose.ui.unit.Dp,
    val verticalPadding: androidx.compose.ui.unit.Dp,
    val textStyle: androidx.compose.ui.text.TextStyle,
)

// ── Previews ─────────────────────────────────────────────────────────────────

@Preview(showBackground = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun ProviderBadgePreviewLight() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme(darkTheme = false) {
        Column(
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            modifier = Modifier.padding(componentTokens.spacing.lg),
        ) {
            CliProvider.entries
                .filter { it != CliProvider.UNKNOWN }
                .forEach { provider ->
                    Row(horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm)) {
                        ProviderBadge(provider = provider, size = BadgeSize.SMALL)
                        ProviderBadge(provider = provider, size = BadgeSize.MEDIUM)
                        ProviderBadge(provider = provider, size = BadgeSize.SMALL, showLabel = false)
                    }
                }
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFF141413)
@Composable
private fun ProviderBadgePreviewDark() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme(darkTheme = true) {
        Column(
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            modifier = Modifier.padding(componentTokens.spacing.lg),
        ) {
            CliProvider.entries
                .filter { it != CliProvider.UNKNOWN }
                .forEach { provider ->
                    ProviderBadge(provider = provider, size = BadgeSize.MEDIUM)
                }
        }
    }
}
