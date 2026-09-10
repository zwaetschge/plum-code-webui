package com.claudewebui.app.ui.components.common

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.core.network.AppError
import com.claudewebui.app.ui.theme.ClaudeWebUITheme

// ── ErrorCard Composable ─────────────────────────────────────────────────────

@Composable
fun ErrorCard(
    message: String,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.component_something_went_wrong),
    onRetry: (() -> Unit)? = null,
    retryLabel: String = stringResource(R.string.component_retry),
) {
    ErrorCardContent(
        message = message,
        modifier = modifier,
        title = title,
        onRetry = onRetry,
        retryLabel = retryLabel,
        onReauth = null,
    )
}

/**
 * The typed variant. The message comes from [AppError.userMessage]; the
 * actions follow the error kind: Retry is offered whenever [onRetry] is given
 * except for [AppError.Unauthorized], where retrying cannot help and
 * "Sign in again" ([onReauth]) is the only sensible action.
 */
@Composable
fun ErrorCard(
    error: AppError,
    modifier: Modifier = Modifier,
    title: String = titleFor(error),
    onRetry: (() -> Unit)? = null,
    onReauth: (() -> Unit)? = null,
    retryLabel: String = stringResource(R.string.component_retry),
) {
    val unauthorized = error is AppError.Unauthorized
    ErrorCardContent(
        message = error.userMessage(androidx.compose.ui.platform.LocalContext.current),
        modifier = modifier,
        title = title,
        onRetry = onRetry?.takeIf { !unauthorized || onReauth == null },
        retryLabel = retryLabel,
        onReauth = onReauth?.takeIf { unauthorized },
    )
}

@Composable
private fun titleFor(error: AppError): String = when (error) {
    is AppError.Network -> stringResource(R.string.component_connection_problem)
    is AppError.Unauthorized -> stringResource(R.string.component_signed_out)
    is AppError.NotFound -> stringResource(R.string.component_not_found)
    is AppError.Server -> stringResource(R.string.component_server_error)
    is AppError.Contract -> stringResource(R.string.component_unexpected_response)
    is AppError.Cancelled -> stringResource(R.string.component_cancelled)
    is AppError.Unknown -> stringResource(R.string.component_something_went_wrong)
}

@Composable
private fun ErrorCardContent(
    message: String,
    modifier: Modifier,
    title: String,
    onRetry: (() -> Unit)?,
    retryLabel: String,
    onReauth: (() -> Unit)?,
) {
    val componentTokens = PlumTheme.tokens
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(componentTokens.radius.md),
        tonalElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier.padding(componentTokens.spacing.lg),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    modifier = Modifier.size(componentTokens.sizing.iconMd),
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                )
                Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }

            Spacer(modifier = Modifier.height(componentTokens.spacing.sm))

            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.8f),
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )

            if (onRetry != null || onReauth != null) {
                Spacer(modifier = Modifier.height(componentTokens.spacing.md))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
                ) {
                    if (onReauth != null) {
                        Button(
                            onClick = onReauth,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error,
                                contentColor = MaterialTheme.colorScheme.onError,
                            ),
                            shape = RoundedCornerShape(componentTokens.radius.sm),
                        ) {
                            Text(
                                text = stringResource(R.string.component_sign_in_again),
                                style = MaterialTheme.typography.labelLarge,
                            )
                        }
                    }

                    if (onRetry != null) {
                        if (onReauth != null) {
                            OutlinedButton(
                                onClick = onRetry,
                                shape = RoundedCornerShape(componentTokens.radius.sm),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(componentTokens.sizing.iconSm),
                                )
                                Spacer(modifier = Modifier.width(componentTokens.spacing.inline))
                                Text(
                                    text = retryLabel,
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        } else {
                            Button(
                                onClick = onRetry,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.error,
                                    contentColor = MaterialTheme.colorScheme.onError,
                                ),
                                shape = RoundedCornerShape(componentTokens.radius.sm),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(componentTokens.sizing.iconSm),
                                )
                                Spacer(modifier = Modifier.width(componentTokens.spacing.inline))
                                Text(
                                    text = retryLabel,
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Compact inline variant ───────────────────────────────────────────────────

@Composable
fun ErrorBanner(
    message: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    val componentTokens = PlumTheme.tokens
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(componentTokens.radius.sm),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.compact),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.ErrorOutline,
                contentDescription = null,
                modifier = Modifier.size(componentTokens.sizing.iconSm),
                tint = MaterialTheme.colorScheme.onErrorContainer,
            )
            Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (onRetry != null) {
                Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
                Button(
                    onClick = onRetry,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                    shape = RoundedCornerShape(componentTokens.spacing.inline),
                    contentPadding = ButtonDefaults.TextButtonContentPadding,
                ) {
                    Text(
                        text = stringResource(R.string.component_retry),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

/** [ErrorBanner] for a typed error; Retry only where it can help. */
@Composable
fun ErrorBanner(
    error: AppError,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    ErrorBanner(
        message = error.userMessage(androidx.compose.ui.platform.LocalContext.current),
        modifier = modifier,
        onRetry = onRetry?.takeIf { error !is AppError.Unauthorized },
    )
}

// ── Previews ─────────────────────────────────────────────────────────────────

@Preview(showBackground = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun ErrorCardPreview() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme {
        Column(
            modifier = Modifier.padding(componentTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.lg),
        ) {
            ErrorCard(
                message = "Failed to connect to the WebUI server. Check that the backend is running and the URL is correct.",
                onRetry = {},
            )

            ErrorCard(
                title = "Session Error",
                message = "The Claude CLI process exited unexpectedly with code 1.",
            )

            ErrorCard(
                error = AppError.Unauthorized(null),
                onRetry = {},
                onReauth = {},
            )

            ErrorCard(
                error = AppError.Server(503, null, null),
                onRetry = {},
            )

            ErrorBanner(
                message = "Connection lost. Retrying...",
                onRetry = {},
            )
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFF141413)
@Composable
private fun ErrorCardDarkPreview() {
    val componentTokens = PlumTheme.tokens
    ClaudeWebUITheme(darkTheme = true) {
        Column(
            modifier = Modifier.padding(componentTokens.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.lg),
        ) {
            ErrorCard(
                message = "WebSocket disconnected unexpectedly.",
                onRetry = {},
            )
            ErrorCard(
                error = AppError.Network(null),
                onRetry = {},
            )
            ErrorBanner(
                message = "Network error",
                onRetry = {},
            )
        }
    }
}
