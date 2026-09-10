package com.claudewebui.app.ui.screens.auth

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AuthUser
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen

// ── Screen entry point ────────────────────────────────────────────────────────

@Composable
fun LoginScreen(
    viewModel: LoginViewModel,
    onAuthenticated: (AuthUser) -> Unit,
    onNavigateToServerSetup: () -> Unit,
    authCallbackUri: String? = null,
) {
    val authState by viewModel.authState.collectAsState()

    // Forward terminal state to caller
    LaunchedEffect(authState) {
        if (authState is AuthState.Authenticated) {
            onAuthenticated((authState as AuthState.Authenticated).user)
        }
    }

    LaunchedEffect(authCallbackUri) {
        authCallbackUri?.let(viewModel::handleMobileAuthCallback)
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        AnimatedContent(
            targetState = authState,
            transitionSpec = {
                (slideInVertically { it / 6 } + fadeIn(tween(300)))
                    .togetherWith(slideOutVertically { -it / 6 } + fadeOut(tween(200)))
            },
            label = "auth_content",
        ) { state ->
            when (state) {
                is AuthState.Idle -> {
                    // Rehydrate the selected server after returning from setup. The
                    // setup and login destinations own separate ViewModel instances.
                    LaunchedEffect(Unit) {
                        if (authCallbackUri == null) {
                            TokenStore.getServerUrl()?.let(viewModel::testConnection)
                                ?: onNavigateToServerSetup()
                        }
                    }
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    }
                }

                is AuthState.Connecting -> {
                    ConnectingView()
                }

                is AuthState.Connected -> {
                    AuthMethodSelectionView(
                        serverInfo = state.serverInfo,
                        authConfig = state.authConfig,
                        viewModel = viewModel,
                        onChangeServer = onNavigateToServerSetup,
                    )
                }

                is AuthState.Authenticating -> {
                    AuthenticatingView()
                }

                is AuthState.Authenticated -> {
                    // Handled via LaunchedEffect above
                    Box(Modifier.fillMaxSize())
                }

                is AuthState.Error -> {
                    ErrorView(
                        message = state.message,
                        isConnectionError = state.isConnectionError,
                        onRetry = {
                            if (state.isConnectionError) onNavigateToServerSetup()
                            else viewModel.resetToConnected()
                        },
                        onBack = {
                            viewModel.resetToIdle()
                            onNavigateToServerSetup()
                        },
                    )
                }
            }
        }
    }
}

// ── Branding header ───────────────────────────────────────────────────────────

@Composable
private fun BrandHeader(
    modifier: Modifier = Modifier,
    subtitle: String = "Sign in to your workspace",
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
    ) {
        Image(
            // The adaptive launcher resource resolves to an XML adaptive-icon on
            // Android 8+, which painterResource cannot decode.  The foreground is
            // a regular density-aware PNG and is safe to render inside Compose.
            painter = painterResource(id = R.mipmap.ic_launcher_foreground),
            contentDescription = null,
            modifier = Modifier.size(84.dp),
        )

        val titleText = buildAnnotatedString {
            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onBackground)) {
                append("Plum Code ")
            }
            withStyle(
                SpanStyle(
                    brush = Brush.horizontalGradient(listOf(PlumAccent, PlumBlue)),
                )
            ) {
                append("WebUI")
            }
        }

        Text(
            text = titleText,
            style = MaterialTheme.typography.headlineSmall,
        )

        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

// ── Auth method selection ─────────────────────────────────────────────────────

@Composable
private fun AuthMethodSelectionView(
    serverInfo: ServerInfo,
    authConfig: AuthConfig,
    viewModel: LoginViewModel,
    onChangeServer: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var showBasicAuth by remember { mutableStateOf(false) }
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .systemBarsPadding()
            .imePadding()
            .padding(horizontal = screenTokens.spacing.xl, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.xl),
    ) {
        BrandHeader()

        // Connected server chip
        ConnectedServerChip(
            url = serverInfo.url,
            onChangeServer = onChangeServer,
        )

        // Auth options card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(screenTokens.radius.lg),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainer,
            ),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(screenTokens.spacing.section),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                Text(
                    text = screenResources.getString(R.string.auth_sign_in_ada2e),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                if (authConfig.proxyAuthEnabled) {
                    OAuthButton(
                        label = screenResources.getString(R.string.auth_continue_with_authelia_c00fb),
                        iconContent = {
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = null,
                                modifier = Modifier.size(screenTokens.sizing.iconMd),
                            )
                        },
                        onClick = {
                            val loginUrl = viewModel.beginProxyLogin()
                            if (loginUrl.isNotBlank()) {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(loginUrl)))
                            }
                        },
                    )
                }

                // Google OAuth
                if (authConfig.googleOAuthEnabled) {
                    OAuthButton(
                        label = screenResources.getString(R.string.auth_continue_with_google_ccc5b),
                        iconContent = {
                            GoogleIconSvg(modifier = Modifier.size(screenTokens.sizing.iconMd))
                        },
                        onClick = { /* Launch Custom Tab / WebView */ },
                    )
                }

                // GitHub OAuth
                if (authConfig.githubOAuthEnabled) {
                    OAuthButton(
                        label = screenResources.getString(R.string.auth_continue_with_github_baf2c),
                        iconContent = {
                            Icon(
                                Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier.size(screenTokens.sizing.iconMd),
                            )
                        },
                        onClick = { /* Launch Custom Tab */ },
                    )
                }

                // Separator before basic auth
                if (
                    authConfig.proxyAuthEnabled ||
                    authConfig.googleOAuthEnabled ||
                    authConfig.githubOAuthEnabled
                ) {
                    OrDivider()
                }

                // Basic Auth toggle
                AnimatedVisibility(
                    visible = !showBasicAuth,
                    enter = fadeIn(),
                    exit = fadeOut(),
                ) {
                    OutlinedButton(
                        onClick = { showBasicAuth = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(screenTokens.radius.chip),
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.outline,
                        ),
                    ) {
                        Icon(
                            Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(screenTokens.sizing.iconInline),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(screenResources.getString(R.string.auth_use_username_password_ab851))
                    }
                }

                // Basic Auth form
                AnimatedVisibility(
                    visible = showBasicAuth,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut(),
                ) {
                    BasicAuthForm(
                        viewModel = viewModel,
                        onCancel = { showBasicAuth = false },
                    )
                }

                // Dev login (only when available)
                if (authConfig.devLoginEnabled) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    TextButton(
                        onClick = { viewModel.loginDev() },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            screenResources.getString(R.string.auth_dev_login_no_auth_12d9f),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

// ── Basic auth form ───────────────────────────────────────────────────────────

@Composable
private fun BasicAuthForm(
    viewModel: LoginViewModel,
    onCancel: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var rememberMe by remember { mutableStateOf(true) }

    val authState by viewModel.authState.collectAsState()
    val isLoading = authState is AuthState.Authenticating
    val errorMessage = (authState as? AuthState.Error)?.message

    val passwordFocus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current

    Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md)) {
        // Username
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(screenResources.getString(R.string.auth_username_84c29)) },
            leadingIcon = {
                Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconMd))
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Text,
                capitalization = KeyboardCapitalization.None,
                imeAction = ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(
                onNext = { passwordFocus.requestFocus() }
            ),
            singleLine = true,
            isError = authState is AuthState.Error,
            shape = RoundedCornerShape(screenTokens.radius.chip),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MaterialTheme.colorScheme.primary,
                focusedLabelColor = MaterialTheme.colorScheme.primary,
            ),
        )

        // Password
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(passwordFocus),
            label = { Text(screenResources.getString(R.string.auth_password_8be3c)) },
            leadingIcon = {
                Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(screenTokens.sizing.iconMd))
            },
            trailingIcon = {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (passwordVisible) screenResources.getString(R.string.auth_hide_password_e4012) else screenResources.getString(R.string.auth_show_password_044b8),
                        modifier = Modifier.size(screenTokens.sizing.iconMd),
                    )
                }
            },
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    focusManager.clearFocus()
                    viewModel.loginBasicAuth(username, password)
                }
            ),
            singleLine = true,
            isError = authState is AuthState.Error,
            shape = RoundedCornerShape(screenTokens.radius.chip),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MaterialTheme.colorScheme.primary,
                focusedLabelColor = MaterialTheme.colorScheme.primary,
            ),
        )

        // Error
        AnimatedVisibility(
            visible = authState is AuthState.Error,
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut(),
        ) {
            if (errorMessage != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.inline),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(screenTokens.sizing.iconXs),
                    )
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }

        // Remember me
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Checkbox(
                checked = rememberMe,
                onCheckedChange = { rememberMe = it },
                colors = CheckboxDefaults.colors(checkedColor = MaterialTheme.colorScheme.primary),
            )
            Text(
                text = screenResources.getString(R.string.auth_keep_me_signed_in_5955c),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        // Actions
        Row(
            horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
            modifier = Modifier.fillMaxWidth(),
        ) {
            TextButton(
                onClick = onCancel,
                modifier = Modifier.weight(1f),
            ) {
                Text(screenResources.getString(R.string.auth_cancel_77dfd))
            }

            Button(
                onClick = { viewModel.loginBasicAuth(username, password) },
                modifier = Modifier.weight(2f).height(48.dp),
                enabled = username.isNotBlank() && password.isNotBlank() && !isLoading,
                shape = RoundedCornerShape(screenTokens.radius.chip),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                ),
            ) {
                AnimatedContent(
                    targetState = isLoading,
                    transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(150)) },
                    label = "login_button",
                ) { loading ->
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(screenTokens.sizing.iconInline),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(screenResources.getString(R.string.auth_sign_in_ada2e), style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
}

// ── OAuth button ──────────────────────────────────────────────────────────────

@Composable
private fun OAuthButton(
    label: String,
    iconContent: @Composable () -> Unit,
    onClick: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    OutlinedButton(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
        shape = RoundedCornerShape(screenTokens.radius.chip),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline,
        ),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        iconContent()
        Spacer(Modifier.width(10.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ── Connected server chip ─────────────────────────────────────────────────────

@Composable
private fun ConnectedServerChip(
    url: String,
    onChangeServer: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(screenTokens.radius.panel))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = screenTokens.spacing.md, vertical = screenTokens.spacing.inline),
        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(PlumGreen),
        )
        Text(
            text = url,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        TextButton(
            onClick = onChangeServer,
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
        ) {
            Text(
                screenResources.getString(R.string.auth_change_64fbd),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

// ── Or divider ────────────────────────────────────────────────────────────────

@Composable
private fun OrDivider() {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
    ) {
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        Text(
            text = screenResources.getString(R.string.auth_or_17583),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
}

// ── Loading views ─────────────────────────────────────────────────────────────

@Composable
private fun ConnectingView() {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.lg),
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(36.dp),
                strokeWidth = 3.dp,
            )
            Text(
                screenResources.getString(R.string.auth_connecting_to_server_f54a0),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AuthenticatingView() {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.lg),
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(36.dp),
                strokeWidth = 3.dp,
            )
            Text(
                screenResources.getString(R.string.auth_signing_you_in_10d06),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Error view ────────────────────────────────────────────────────────────────

@Composable
private fun ErrorView(
    message: String,
    isConnectionError: Boolean,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(screenTokens.spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.section),
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(screenTokens.radius.lg))
                    .background(MaterialTheme.colorScheme.errorContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.size(32.dp),
                )
            }

            Text(
                text = if (isConnectionError) screenResources.getString(R.string.auth_connection_failed_4a7b9) else screenResources.getString(R.string.auth_sign_in_failed_9c06f),
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )

            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Column(
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Button(
                    onClick = onRetry,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(screenTokens.radius.md),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                ) {
                    Text(if (isConnectionError) screenResources.getString(R.string.auth_try_again_cef2f) else screenResources.getString(R.string.auth_back_to_login_b5cd3))
                }

                if (!isConnectionError) {
                    OutlinedButton(
                        onClick = onBack,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(screenTokens.radius.md),
                    ) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = null,
                            modifier = Modifier.size(screenTokens.sizing.iconInline),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(screenResources.getString(R.string.auth_change_server_c30a8))
                    }
                }
            }
        }
    }
}

// ── Google icon placeholder (SVG path would normally live here) ───────────────

@Composable
private fun GoogleIconSvg(modifier: Modifier = Modifier) {
    // Simple G placeholder using text — replace with actual Google icon vector
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "G",
            style = MaterialTheme.typography.labelLarge.copy(
                fontWeight = FontWeight.Bold,
                color = Color(0xFF4285F4),
            ),
        )
    }
}
