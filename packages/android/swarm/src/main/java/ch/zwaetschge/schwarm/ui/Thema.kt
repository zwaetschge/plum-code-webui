package com.claudewebui.swarm.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val Dunkel = darkColorScheme(
    primary = Color(0xFFF2B84B),
    onPrimary = Color(0xFF2B1D00),
    primaryContainer = Color(0xFF3A2C0B),
    onPrimaryContainer = Color(0xFFFFE0A3),
    secondary = Color(0xFF6EA8FE),
    onSecondary = Color(0xFF002E6B),
    secondaryContainer = Color(0xFF13294A),
    onSecondaryContainer = Color(0xFFCFE2FF),
    tertiary = Color(0xFF7EE0A1),
    onTertiary = Color(0xFF00391B),
    tertiaryContainer = Color(0xFF133A26),
    onTertiaryContainer = Color(0xFFBDF5D2),
    error = Color(0xFFFF6B6B),
    onError = Color(0xFF3D0000),
    errorContainer = Color(0xFF4A1414),
    onErrorContainer = Color(0xFFFFD9D9),
    background = Color(0xFF0B0D10),
    onBackground = Color(0xFFE6E9EF),
    surface = Color(0xFF0B0D10),
    onSurface = Color(0xFFE6E9EF),
    surfaceVariant = Color(0xFF1D2430),
    onSurfaceVariant = Color(0xFFA7B0BE),
    surfaceContainerLowest = Color(0xFF080A0D),
    surfaceContainerLow = Color(0xFF12161C),
    surfaceContainer = Color(0xFF161B23),
    surfaceContainerHigh = Color(0xFF1C222C),
    surfaceContainerHighest = Color(0xFF232A36),
    outline = Color(0xFF3A4454),
    outlineVariant = Color(0xFF262E3A),
)

private val Hell = lightColorScheme(
    primary = Color(0xFF8A5A00),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDDA6),
    onPrimaryContainer = Color(0xFF2B1D00),
    secondary = Color(0xFF1F5FBF),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD8E6FF),
    onSecondaryContainer = Color(0xFF001B3F),
    tertiary = Color(0xFF1B7A45),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFC7F2D6),
    onTertiaryContainer = Color(0xFF002111),
    error = Color(0xFFC62828),
    background = Color(0xFFF7F8FA),
    surface = Color(0xFFF7F8FA),
    surfaceContainerLow = Color(0xFFF1F3F6),
    surfaceContainer = Color(0xFFEBEEF2),
    surfaceContainerHigh = Color(0xFFE5E9EE),
    surfaceContainerHighest = Color(0xFFDFE4EA),
)

private val Schrift = Typography().let { t ->
    t.copy(
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = t.labelLarge.copy(fontWeight = FontWeight.SemiBold),
    )
}

val Mono = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp)

@Composable
fun SchwarmThema(dunkel: Boolean = isSystemInDarkTheme(), inhalt: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dunkel) Dunkel else Hell, typography = Schrift, content = inhalt)
}
