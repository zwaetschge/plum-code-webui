package com.claudewebui.app.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// ── Brand Colors ─────────────────────────────────────────────────────────────

val AntiqueBrass = Color(0xFFCC785C)
val AntiqueBrassLight = Color(0xFFE0A08A)
val AntiqueBrassDark = Color(0xFFB5603F)

val BrandPurple = Color(0xFFC377FF)
val BrandBlue = Color(0xFF2B75E2)

val BrandGradient = Brush.horizontalGradient(
    colors = listOf(BrandPurple, BrandBlue)
)

// ── Semantic Colors ──────────────────────────────────────────────────────────

val ErrorRed = Color(0xFFEF4444)
val ErrorRedLight = Color(0xFFFCA5A5)
val ErrorRedDark = Color(0xFFDC2626)

val SuccessGreen = Color(0xFF22C55E)
val SuccessGreenLight = Color(0xFF86EFAC)
val SuccessGreenDark = Color(0xFF16A34A)

val WarningAmber = Color(0xFFF59E0B)
val InfoBlue = Color(0xFF3B82F6)

// ── Provider Colors ──────────────────────────────────────────────────────────

val ClaudeColor = Color(0xFFCC785C)
val CodexColor = Color(0xFF10A37F)
val OpenCodeColor = Color(0xFF7C3AED)
val GoogleColor = Color(0xFF4285F4)

/**
 * Mistral orange for the Vibe harness.
 *
 * The Mistral *API* tracker in the analytics limits keeps its own historical
 * red-orange (0xFFFA520F); Vibe is a separate allowance of the same plan, so
 * it uses the brand orange and the two rows stay distinguishable.
 */
val VibeColor = Color(0xFFFF7000)

// ── Light Theme Palette ──────────────────────────────────────────────────────

val LightBackground = Color(0xFFF0EFEA)
val LightOnBackground = Color(0xFF141413)
val LightSurface = Color(0xFFFFFFFF)
val LightSurfaceVariant = Color(0xFFE8E7E2)
val LightOnSurface = Color(0xFF141413)
val LightOnSurfaceVariant = Color(0xFF5C5B57)
val LightOutline = Color(0xFFD4D3CE)
val LightOutlineVariant = Color(0xFFE0DFDA)
val LightSurfaceContainer = Color(0xFFF5F4EF)
val LightSurfaceContainerHigh = Color(0xFFEAE9E4)
val LightSurfaceContainerHighest = Color(0xFFE4E3DE)
val LightSurfaceContainerLow = Color(0xFFF8F7F2)
val LightSurfaceContainerLowest = Color(0xFFFFFFFF)
val LightInverseSurface = Color(0xFF313130)
val LightInverseOnSurface = Color(0xFFF0EFEA)

// ── Dark Theme Palette ───────────────────────────────────────────────────────

val DarkBackground = Color(0xFF141413)
val DarkOnBackground = Color(0xFFF0EFEA)
val DarkSurface = Color(0xFF1E1E1C)
val DarkSurfaceVariant = Color(0xFF2C2C29)
val DarkOnSurface = Color(0xFFF0EFEA)
val DarkOnSurfaceVariant = Color(0xFFA8A7A2)
val DarkOutline = Color(0xFF484845)
val DarkOutlineVariant = Color(0xFF363634)
val DarkSurfaceContainer = Color(0xFF232321)
val DarkSurfaceContainerHigh = Color(0xFF2D2D2B)
val DarkSurfaceContainerHighest = Color(0xFF383836)
val DarkSurfaceContainerLow = Color(0xFF1A1A18)
val DarkSurfaceContainerLowest = Color(0xFF0F0F0E)
val DarkInverseSurface = Color(0xFFE4E3DE)
val DarkInverseOnSurface = Color(0xFF313130)
