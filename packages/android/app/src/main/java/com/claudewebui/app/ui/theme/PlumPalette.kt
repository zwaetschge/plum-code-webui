package com.claudewebui.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The Plum surface palette.
 *
 * The screens paint with these rather than with MaterialTheme's colour scheme,
 * so this — not [ClaudeWebUITheme] — is what has to change for the app to have
 * more than one look. Every colour the UI uses lives here; nothing outside this
 * file should hardcode a surface, text or border colour.
 */
data class PlumPalette(
    val background: Color,
    val surface: Color,
    val surfaceStrong: Color,
    val border: Color,
    val borderSoft: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val accentDeep: Color,
    val green: Color,
    val blue: Color,
    val amber: Color,
    val red: Color,
    /** Tint for the hairline grid drawn across the backdrop. */
    val grid: Color,
    /** The two ambient glows behind the backdrop; transparent disables them. */
    val glowPrimary: Color,
    val glowSecondary: Color,
    /** Aurora ribbons from the WebUI backdrop; transparent disables the effect. */
    val waveViolet: Color,
    val waveCyan: Color,
    val waveRose: Color,
    val waveGold: Color,
    /** Fill for raised circular controls such as the header icon buttons. */
    val controlSurface: Color,
    /** Barely-there wash used to lift rows and inner cards off a panel. */
    val subtleFill: Color,
    /** Slightly stronger wash for tracks behind progress bars. */
    val trackFill: Color,
    /** Recessed background of segmented controls (time range, chart metric). */
    val segmentTrack: Color,
    /** Fill and label of the selected segment. */
    val segmentSelected: Color,
    val onSegmentSelected: Color,
    /** Tint behind a selected tab card. */
    val selectionTint: Color,
    // ── Frosted glass ────────────────────────────────────────────────────────
    // Mirrors the WebUI's `.glass-panel`: a very translucent fill over the
    // atmospheric backdrop, a hairline border, a soft drop shadow and a bright
    // 1px inset highlight along the top edge — that highlight is what actually
    // reads as "glass" rather than "flat card".
    val glassFill: Color,
    val glassFillTop: Color,
    val glassHighlight: Color,
    val glassShadow: Color,
    val isLight: Boolean,
)

val PlumDarkPalette = PlumPalette(
    background = Color(0xFF080B0D),
    surface = Color(0xE616191C),
    surfaceStrong = Color(0xF21B1E21),
    border = Color(0xFF34383D),
    borderSoft = Color(0xFF24292E),
    text = Color(0xFFF3F1F5),
    muted = Color(0xFFA8A6AE),
    accent = Color(0xFFB56BFF),
    accentDeep = Color(0xFF7247E8),
    green = Color(0xFF35E59A),
    blue = Color(0xFF3298FF),
    amber = Color(0xFFFFB536),
    red = Color(0xFFFF575F),
    grid = Color.White.copy(alpha = .018f),
    glowPrimary = Color(0x302B7FFF),
    glowSecondary = Color(0x2D8F3DFF),
    waveViolet = Color(0xFFB56BFF),
    waveCyan = Color(0xFF22D5EB),
    waveRose = Color(0xFFEF60BD),
    waveGold = Color(0xFFF5C258),
    controlSurface = Color(0xE6212428),
    subtleFill = Color.White.copy(alpha = .025f),
    trackFill = Color.White.copy(alpha = .07f),
    segmentTrack = Color(0xB517191B),
    segmentSelected = Color(0xFFE8EDF7),
    onSegmentSelected = Color(0xFF17202E),
    selectionTint = Color(0x351A3DA1),
    glassFill = Color.White.copy(alpha = .045f),
    glassFillTop = Color.White.copy(alpha = .085f),
    glassHighlight = Color.White.copy(alpha = .14f),
    glassShadow = Color.Black.copy(alpha = .55f),
    isLight = false,
)

/**
 * Light surface. Accents are darkened rather than reused from the dark palette:
 * the neon tones that read well on near-black drop below usable contrast on a
 * light background, especially for the small 9-11sp metadata text.
 */
val PlumLightPalette = PlumPalette(
    background = Color(0xFFF6F5F8),
    surface = Color(0xF2FFFFFF),
    surfaceStrong = Color(0xFFFFFFFF),
    border = Color(0xFFD9D6DE),
    borderSoft = Color(0xFFE6E4EA),
    text = Color(0xFF17181C),
    muted = Color(0xFF5E5C66),
    accent = Color(0xFF7B2FD6),
    accentDeep = Color(0xFF5B21B6),
    green = Color(0xFF0F9D6B),
    blue = Color(0xFF1668D6),
    amber = Color(0xFF9A6200),
    red = Color(0xFFC8303C),
    grid = Color.Black.copy(alpha = .025f),
    glowPrimary = Color(0x142B7FFF),
    glowSecondary = Color(0x148F3DFF),
    waveViolet = Color(0xFF7185D6),
    waveCyan = Color(0xFF39B5AB),
    waveRose = Color(0xFFAA78B8),
    waveGold = Color(0xFF9AA9C1),
    controlSurface = Color(0xFFFFFFFF),
    subtleFill = Color(0xFFF1F0F4),
    trackFill = Color(0xFFE3E1E8),
    segmentTrack = Color(0xFFE9E7EE),
    segmentSelected = Color(0xFF2A2733),
    onSegmentSelected = Color(0xFFFFFFFF),
    selectionTint = Color(0x1F7B2FD6),
    glassFill = Color.White.copy(alpha = .62f),
    glassFillTop = Color.White.copy(alpha = .80f),
    glassHighlight = Color.White.copy(alpha = .95f),
    glassShadow = Color(0xFF2A2440).copy(alpha = .16f),
    isLight = true,
)

/**
 * E-Ink: near-monochrome, no glows, no translucency. Mirrors the WebUI's `eink`
 * theme for high-contrast and reflective-display reading. Status colours stay
 * distinguishable by lightness rather than hue.
 */
val PlumEinkPalette = PlumPalette(
    background = Color(0xFFFFFFFF),
    surface = Color(0xFFFFFFFF),
    surfaceStrong = Color(0xFFF4F4F4),
    border = Color(0xFF000000),
    borderSoft = Color(0xFF767676),
    text = Color(0xFF000000),
    muted = Color(0xFF4A4A4A),
    accent = Color(0xFF000000),
    accentDeep = Color(0xFF000000),
    green = Color(0xFF2F2F2F),
    blue = Color(0xFF3D3D3D),
    amber = Color(0xFF5A5A5A),
    red = Color(0xFF1A1A1A),
    grid = Color.Transparent,
    glowPrimary = Color.Transparent,
    glowSecondary = Color.Transparent,
    waveViolet = Color.Transparent,
    waveCyan = Color.Transparent,
    waveRose = Color.Transparent,
    waveGold = Color.Transparent,
    controlSurface = Color(0xFFFFFFFF),
    subtleFill = Color(0xFFF4F4F4),
    trackFill = Color(0xFFDCDCDC),
    segmentTrack = Color(0xFFEDEDED),
    segmentSelected = Color(0xFF000000),
    onSegmentSelected = Color(0xFFFFFFFF),
    selectionTint = Color(0xFFE0E0E0),
    // No translucency on e-ink: flat white with a hard border reads best.
    glassFill = Color(0xFFFFFFFF),
    glassFillTop = Color(0xFFFFFFFF),
    glassHighlight = Color.Transparent,
    glassShadow = Color.Transparent,
    isLight = true,
)

val LocalPlumPalette = staticCompositionLocalOf { PlumDarkPalette }

/**
 * Which palette a stored preference resolves to. [systemInDark] decides the
 * SYSTEM case, so the caller supplies it from `isSystemInDarkTheme()`.
 */
fun paletteFor(theme: AppThemeOption, systemInDark: Boolean): PlumPalette = when (theme) {
    AppThemeOption.SYSTEM -> if (systemInDark) PlumDarkPalette else PlumLightPalette
    AppThemeOption.DARK -> PlumDarkPalette
    AppThemeOption.LIGHT -> PlumLightPalette
    AppThemeOption.EINK -> PlumEinkPalette
}

/**
 * Material colour scheme derived from the Plum palette.
 *
 * Several screens — MCP servers, providers, CLI tools, agents, permissions,
 * the file manager — are built entirely on `MaterialTheme.colorScheme` rather
 * than the Plum accessors. Rather than rewrite them, the Material scheme is
 * generated from the same palette so they inherit the active theme and stop
 * rendering in the unrelated default brand colours.
 */
fun PlumPalette.toMaterialScheme(): ColorScheme {
    val base = if (isLight) lightColorScheme() else darkColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = if (isLight) Color.White else Color.Black,
        primaryContainer = accentDeep,
        onPrimaryContainer = Color.White,
        secondary = blue,
        onSecondary = Color.White,
        // FilledTonalButton and friends draw from the *container* roles; leaving
        // them at the Material defaults left lavender buttons on an otherwise
        // monochrome e-ink screen.
        secondaryContainer = subtleFill,
        onSecondaryContainer = text,
        tertiary = accentDeep,
        onTertiary = Color.White,
        tertiaryContainer = subtleFill,
        onTertiaryContainer = text,
        inversePrimary = accentDeep,
        surfaceTint = accent,
        inverseSurface = text,
        inverseOnSurface = background,
        background = background,
        onBackground = text,
        surface = surfaceStrong,
        onSurface = text,
        surfaceVariant = subtleFill,
        onSurfaceVariant = muted,
        surfaceContainer = surfaceStrong,
        surfaceContainerHigh = surfaceStrong,
        surfaceContainerHighest = surfaceStrong,
        surfaceContainerLow = background,
        surfaceContainerLowest = background,
        outline = border,
        outlineVariant = borderSoft,
        error = red,
        onError = Color.White,
        errorContainer = red.copy(alpha = .15f),
        onErrorContainer = red,
    )
}
