package com.claudewebui.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

// ── Light Color Scheme ───────────────────────────────────────────────────────

private val LightColorScheme = lightColorScheme(
    primary = AntiqueBrass,
    onPrimary = Color.White,
    primaryContainer = AntiqueBrassLight,
    onPrimaryContainer = Color(0xFF3D1600),
    secondary = Color(0xFF77574B),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFDBCF),
    onSecondaryContainer = Color(0xFF2C160C),
    tertiary = BrandPurple,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE8DEFF),
    onTertiaryContainer = Color(0xFF2B0052),
    error = ErrorRed,
    onError = Color.White,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),
    background = LightBackground,
    onBackground = LightOnBackground,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightOutline,
    outlineVariant = LightOutlineVariant,
    surfaceContainer = LightSurfaceContainer,
    surfaceContainerHigh = LightSurfaceContainerHigh,
    surfaceContainerHighest = LightSurfaceContainerHighest,
    surfaceContainerLow = LightSurfaceContainerLow,
    surfaceContainerLowest = LightSurfaceContainerLowest,
    inverseSurface = LightInverseSurface,
    inverseOnSurface = LightInverseOnSurface,
    inversePrimary = AntiqueBrassLight,
    scrim = Color(0xFF000000),
)

// ── Dark Color Scheme ────────────────────────────────────────────────────────

private val DarkColorScheme = darkColorScheme(
    primary = AntiqueBrassLight,
    onPrimary = Color(0xFF5A2000),
    primaryContainer = AntiqueBrassDark,
    onPrimaryContainer = Color(0xFFFFDBCF),
    secondary = Color(0xFFE7BEAF),
    onSecondary = Color(0xFF442A1F),
    secondaryContainer = Color(0xFF5D4034),
    onSecondaryContainer = Color(0xFFFFDBCF),
    tertiary = BrandPurple,
    onTertiary = Color(0xFF460083),
    tertiaryContainer = Color(0xFF6200B8),
    onTertiaryContainer = Color(0xFFE8DEFF),
    error = ErrorRedLight,
    onError = Color(0xFF7F1D1D),
    errorContainer = Color(0xFF991B1B),
    onErrorContainer = Color(0xFFFEE2E2),
    background = DarkBackground,
    onBackground = DarkOnBackground,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkOutline,
    outlineVariant = DarkOutlineVariant,
    surfaceContainer = DarkSurfaceContainer,
    surfaceContainerHigh = DarkSurfaceContainerHigh,
    surfaceContainerHighest = DarkSurfaceContainerHighest,
    surfaceContainerLow = DarkSurfaceContainerLow,
    surfaceContainerLowest = DarkSurfaceContainerLowest,
    inverseSurface = DarkInverseSurface,
    inverseOnSurface = DarkInverseOnSurface,
    inversePrimary = AntiqueBrass,
    scrim = Color(0xFF000000),
)

// ── Extended Colors ──────────────────────────────────────────────────────────

data class ExtendedColors(
    val success: Color,
    val onSuccess: Color,
    val successContainer: Color,
    val warning: Color,
    val onWarning: Color,
    val info: Color,
    val onInfo: Color,
    val brandPurple: Color,
    val brandBlue: Color,
    val codeBackground: Color,
    val codeForeground: Color,
)

val LocalExtendedColors = staticCompositionLocalOf {
    ExtendedColors(
        success = SuccessGreen,
        onSuccess = Color.White,
        successContainer = Color(0xFFDCFCE7),
        warning = WarningAmber,
        onWarning = Color.White,
        info = InfoBlue,
        onInfo = Color.White,
        brandPurple = BrandPurple,
        brandBlue = BrandBlue,
        codeBackground = Color(0xFFF5F4EF),
        codeForeground = Color(0xFF141413),
    )
}

private val LightExtendedColors = ExtendedColors(
    success = SuccessGreen,
    onSuccess = Color.White,
    successContainer = Color(0xFFDCFCE7),
    warning = WarningAmber,
    onWarning = Color.White,
    info = InfoBlue,
    onInfo = Color.White,
    brandPurple = BrandPurple,
    brandBlue = BrandBlue,
    codeBackground = Color(0xFFF0EFEA),
    codeForeground = Color(0xFF141413),
)

private val DarkExtendedColors = ExtendedColors(
    success = SuccessGreenLight,
    onSuccess = Color(0xFF052E16),
    successContainer = Color(0xFF14532D),
    warning = WarningAmber,
    onWarning = Color(0xFF422006),
    info = Color(0xFF93C5FD),
    onInfo = Color(0xFF1E3A5F),
    brandPurple = BrandPurple,
    brandBlue = BrandBlue,
    codeBackground = Color(0xFF1E1E1C),
    codeForeground = Color(0xFFF0EFEA),
)

// ── Theme Composable ─────────────────────────────────────────────────────────

@Composable
fun ClaudeWebUITheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    // Derived from the active Plum palette so the Material-based screens share
    // one theme with the Plum-based ones instead of keeping a separate brand.
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        else -> LocalPlumPalette.current.toMaterialScheme()
    }

    val extendedColors = if (darkTheme) DarkExtendedColors else LightExtendedColors
    val reduceMotion = rememberReduceMotion()

    // Design tokens follow the Plum palette, not the Material scheme: even with
    // dynamic colour on, surfaces, borders and glass derive from the palette so
    // the frosted look stays consistent with the backdrop it sits on.
    val palette = LocalPlumPalette.current
    val tokens = remember(palette, reduceMotion) { plumTokensFor(palette, reduceMotion) }

    // System bars are handled exclusively by enableEdgeToEdge in MainActivity.
    // Painting window.statusBarColor/navigationBarColor here made the bars
    // opaque again and fought the transparent edge-to-edge setup.

    CompositionLocalProvider(
        LocalExtendedColors provides extendedColors,
        LocalReduceMotion provides reduceMotion,
        LocalPlumTokens provides tokens,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = AppTypography,
            shapes = ExpressiveShapes,
            content = content,
        )
    }
}

/**
 * Material 3 Expressive leans on larger, softer corner radii than the M3
 * defaults (Android 16 QPR1 system apps use 16–32dp prominently).
 */
private val ExpressiveShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

// ── Convenience accessor ─────────────────────────────────────────────────────

object ClaudeWebUITheme {
    val extendedColors: ExtendedColors
        @Composable get() = LocalExtendedColors.current

    /** Same tokens as [PlumTheme.tokens]; kept here so either accessor works. */
    val tokens: PlumTokens
        @Composable get() = LocalPlumTokens.current
}
