package com.claudewebui.app.ui.screens.auth

import com.claudewebui.app.R
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

// ── Biometric availability ────────────────────────────────────────────────────

enum class BiometricAvailability {
    AVAILABLE,
    NOT_ENROLLED,
    NOT_SUPPORTED,
    UNAVAILABLE,
}

fun checkBiometricAvailability(context: android.content.Context): BiometricAvailability {
    val manager = BiometricManager.from(context)
    val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        BIOMETRIC_STRONG or DEVICE_CREDENTIAL
    } else {
        BIOMETRIC_WEAK
    }
    return when (manager.canAuthenticate(authenticators)) {
        BiometricManager.BIOMETRIC_SUCCESS -> BiometricAvailability.AVAILABLE
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> BiometricAvailability.NOT_ENROLLED
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> BiometricAvailability.NOT_SUPPORTED
        else -> BiometricAvailability.UNAVAILABLE
    }
}

// ── BiometricPromptHost composable ────────────────────────────────────────────

/**
 * Composable wrapper around [BiometricPrompt].
 *
 * Shows the system biometric dialog when [trigger] becomes true.
 * Results are delivered via [onSuccess] / [onError] / [onCancelled].
 *
 * Must be hosted inside a [FragmentActivity] context.
 */
@Composable
fun BiometricPromptHost(
    trigger: Boolean,
    title: String = androidx.compose.ui.res.stringResource(R.string.auth_authenticate_94a01),
    subtitle: String = androidx.compose.ui.res.stringResource(R.string.auth_use_your_biometric_credential_to_continue_41c3b),
    negativeButtonText: String = androidx.compose.ui.res.stringResource(R.string.auth_use_password_28cbb),
    onSuccess: () -> Unit,
    onError: (errorCode: Int, message: String) -> Unit = { _, _ -> },
    onCancelled: () -> Unit = {},
    onResetTrigger: () -> Unit,
) {
    val context = LocalContext.current

    LaunchedEffect(trigger) {
        if (!trigger) return@LaunchedEffect

        val activity = context as? FragmentActivity ?: run {
            onError(-1, "BiometricPrompt requires a FragmentActivity")
            onResetTrigger()
            return@LaunchedEffect
        }

        val executor = ContextCompat.getMainExecutor(context)

        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onSuccess()
                onResetTrigger()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                when (errorCode) {
                    BiometricPrompt.ERROR_USER_CANCELED,
                    BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                    BiometricPrompt.ERROR_CANCELED -> {
                        onCancelled()
                    }
                    else -> onError(errorCode, errString.toString())
                }
                onResetTrigger()
            }

            override fun onAuthenticationFailed() {
                // Individual attempt failed — the system shows its own error UI
            }
        }

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
                } else {
                    setNegativeButtonText(negativeButtonText)
                }
            }
            .build()

        BiometricPrompt(activity, executor, callback).authenticate(promptInfo)
    }
}

// ── BiometricAuthGate composable ──────────────────────────────────────────────

/**
 * Higher-level gate that fires biometric auth on first composition when
 * [enabled] is true and the device supports it.
 *
 * Use this at the top of a screen that should re-authenticate on resume.
 */
@Composable
fun BiometricAuthGate(
    enabled: Boolean,
    onAuthenticated: () -> Unit,
    onSkip: () -> Unit,
) {
    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val context = LocalContext.current
    var triggered by remember { mutableStateOf(false) }

    LaunchedEffect(enabled) {
        if (!enabled) {
            onSkip()
            return@LaunchedEffect
        }
        val availability = checkBiometricAvailability(context)
        if (availability == BiometricAvailability.AVAILABLE) {
            triggered = true
        } else {
            onSkip()
        }
    }

    BiometricPromptHost(
        trigger = triggered,
        title = screenResources.getString(R.string.auth_unlock_plum_code_690e1),
        subtitle = screenResources.getString(R.string.auth_verify_your_identity_to_continue_e15de),
        negativeButtonText = screenResources.getString(R.string.auth_cancel_77dfd),
        onSuccess = {
            triggered = false
            onAuthenticated()
        },
        onError = { _, _ ->
            triggered = false
            onSkip()
        },
        onCancelled = {
            triggered = false
            onSkip()
        },
        onResetTrigger = { triggered = false },
    )
}
