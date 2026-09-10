package com.claudewebui.app.ui.screens.auth

import com.claudewebui.app.R
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen

@Composable
fun ServerSetupScreen(
    viewModel: LoginViewModel,
    onServerConnected: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val authState by viewModel.authState.collectAsState()
    val recentServers by viewModel.recentServers.collectAsState()

    var serverUrl by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    // When state transitions to Connected → proceed to login
    if (authState is AuthState.Connected) {
        onServerConnected()
        return
    }

    val isLoading = authState is AuthState.Connecting
    val errorMessage = (authState as? AuthState.Error)?.message

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding(),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 40.dp),
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.xl),
        ) {
            // ── Header ────────────────────────────────────────────────────────
            item {
                Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
                    // Gradient globe icon
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(RoundedCornerShape(screenTokens.radius.lg))
                            .background(
                                Brush.linearGradient(listOf(PlumAccent, PlumBlue))
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Default.Language,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(28.dp),
                        )
                    }

                    Spacer(Modifier.height(8.dp))

                    Text(
                        text = screenResources.getString(R.string.auth_connect_to_server_ca09a),
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Text(
                        text = screenResources.getString(R.string.auth_enter_the_url_of_your_plum_code_webui_instance_37deb),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // ── URL Input ─────────────────────────────────────────────────────
            item {
                Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = {
                            serverUrl = it
                            if (authState is AuthState.Error) viewModel.resetToIdle()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusRequester),
                        label = { Text(screenResources.getString(R.string.auth_server_url_1d5d1)) },
                        placeholder = { Text("https://your-server.example.com") },
                        leadingIcon = {
                            Text(
                                text = if (serverUrl.startsWith("http")) "" else "https://",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = screenTokens.spacing.md),
                            )
                        },
                        trailingIcon = {
                            if (serverUrl.isNotEmpty()) {
                                IconButton(onClick = {
                                    serverUrl = ""
                                    viewModel.resetToIdle()
                                }) {
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = screenResources.getString(R.string.auth_clear_719ea),
                                        modifier = Modifier.size(screenTokens.sizing.iconInline),
                                    )
                                }
                            }
                        },
                        isError = authState is AuthState.Error,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Uri,
                            capitalization = KeyboardCapitalization.None,
                            imeAction = ImeAction.Go,
                        ),
                        keyboardActions = KeyboardActions(
                            onGo = { viewModel.testConnection(serverUrl) }
                        ),
                        singleLine = true,
                        shape = RoundedCornerShape(screenTokens.radius.md),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MaterialTheme.colorScheme.primary,
                            focusedLabelColor = MaterialTheme.colorScheme.primary,
                        ),
                    )

                    // Error message
                    AnimatedVisibility(
                        visible = authState is AuthState.Error,
                        enter = expandVertically() + fadeIn(),
                        exit = shrinkVertically() + fadeOut(),
                    ) {
                        if (errorMessage != null) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.size(screenTokens.sizing.iconSm),
                                )
                                Text(
                                    text = errorMessage,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }

                    // Connect button
                    Button(
                        onClick = { viewModel.testConnection(serverUrl) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        enabled = serverUrl.isNotBlank() && !isLoading,
                        shape = RoundedCornerShape(screenTokens.radius.md),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = Color.White,
                        ),
                    ) {
                        AnimatedContent(
                            targetState = isLoading,
                            transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(150)) },
                            label = "connect_button",
                        ) { loading ->
                            if (loading) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(screenTokens.sizing.iconInline),
                                        color = Color.White,
                                        strokeWidth = 2.dp,
                                    )
                                    Text(screenResources.getString(R.string.auth_connecting_fd3e7), style = MaterialTheme.typography.labelLarge)
                                }
                            } else {
                                Text(screenResources.getString(R.string.auth_connect_b6546), style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                }
            }

            // ── Recent servers ────────────────────────────────────────────────
            if (recentServers.isNotEmpty()) {
                item {
                    Text(
                        text = screenResources.getString(R.string.auth_recent_servers_6392d),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                items(recentServers) { url ->
                    RecentServerRow(
                        url = url,
                        onSelect = {
                            serverUrl = url
                            viewModel.testConnection(url)
                        },
                        onDelete = { viewModel.removeRecentServer(url) },
                    )
                }
            }
        }
    }
}

@Composable
private fun RecentServerRow(
    url: String,
    onSelect: () -> Unit,
    onDelete: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect),
        shape = RoundedCornerShape(screenTokens.radius.md),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        ),
        border = BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outlineVariant,
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = screenTokens.spacing.lg, vertical = screenTokens.spacing.md),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Default.History,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(screenTokens.sizing.iconInline),
                )
                Text(
                    text = url,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(
                onClick = onDelete,
                modifier = Modifier.size(com.claudewebui.app.ui.theme.PlumTheme.tokens.sizing.touchTarget),
            ) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = screenResources.getString(R.string.auth_remove_e9639),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(screenTokens.sizing.iconSm),
                )
            }
        }
    }
}

// ── Connection status indicator ───────────────────────────────────────────────

@Composable
fun ConnectionStatusDot(
    state: AuthState,
    modifier: Modifier = Modifier,
) {
    val (color, fraction) = when (state) {
        is AuthState.Connecting -> MaterialTheme.colorScheme.tertiary to 0.5f
        is AuthState.Connected -> PlumGreen to 1f
        is AuthState.Error -> MaterialTheme.colorScheme.error to 1f
        else -> MaterialTheme.colorScheme.outline to 0f
    }

    val animatedFraction by animateFloatAsState(
        targetValue = fraction,
        animationSpec = spring(stiffness = Spring.StiffnessMedium),
        label = "status_dot",
    )

    Box(
        modifier = modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = animatedFraction.coerceIn(0.3f, 1f))),
    )
}
