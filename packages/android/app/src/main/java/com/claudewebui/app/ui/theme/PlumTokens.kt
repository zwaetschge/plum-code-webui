package com.claudewebui.app.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// ═════════════════════════════════════════════════════════════════════════════
// Plum design tokens
//
// One place for the dp, radius, elevation, motion and surface values the
// screens currently carry as literals. The scale was chosen from a survey of
// the app (see ui/theme/README.md), so every token matches a value that is
// already in heavy use — migrating a screen onto the tokens is therefore a
// rename, not a redesign.
//
// Rule for new code: screens use tokens, not literals.
// ═════════════════════════════════════════════════════════════════════════════

// ── Spacing ──────────────────────────────────────────────────────────────────

@Immutable
data class PlumSpacing(
    val xxs: Dp = 2.dp,
    val xs: Dp = 4.dp,
    val sm: Dp = 8.dp,
    val md: Dp = 12.dp,
    val lg: Dp = 16.dp,
    val xl: Dp = 24.dp,
    val xxl: Dp = 32.dp,
    // Half steps. The survey found 6, 10, 14 and 20 dp used as often as the
    // main scale, so they get names instead of being rounded away.
    /** Gap between an icon and its label, or between two chips. */
    val inline: Dp = 6.dp,
    /** Gap between controls in a header action row. */
    val compact: Dp = 10.dp,
    /** Inner padding of dense panels and bubble rows. */
    val cozy: Dp = 14.dp,
    /** Gap between sections on a screen. */
    val section: Dp = 20.dp,
    // Semantic aliases used by the shared components.
    /** Horizontal inset of screen content from the window edge. */
    val screenHorizontal: Dp = 16.dp,
    /** Vertical gap between cards in a list. */
    val listGap: Dp = 12.dp,
    /** Inner padding of a glass card. */
    val cardPadding: Dp = 16.dp,
    /** Vertical gap between rows inside a card. */
    val rowGap: Dp = 8.dp,
    /** Horizontal inset of [com.claudewebui.app.ui.components.common.PlumScreenHeader]. */
    val headerHorizontal: Dp = 18.dp,
    /** Vertical inset of the screen header. */
    val headerVertical: Dp = 14.dp,
)

// ── Radius & shapes ──────────────────────────────────────────────────────────

@Immutable
data class PlumRadius(
    val xxs: Dp = 2.dp,
    val xs: Dp = 4.dp,
    val sm: Dp = 8.dp,
    /** Small controls, tags and inner chips. */
    val chip: Dp = 10.dp,
    val md: Dp = 12.dp,
    val lg: Dp = 16.dp,
    /** Default corner of [com.claudewebui.app.ui.components.common.GlassPanel]. */
    val panel: Dp = 20.dp,
    val xl: Dp = 24.dp,
    /** Floating navigation bar. */
    val bar: Dp = 30.dp,
    val xxl: Dp = 32.dp,
) {
    /** Fully rounded ends regardless of size. */
    val pill: Shape get() = RoundedCornerShape(50)

    /** Circle for avatars, dots and round icon buttons. */
    val circle: Shape get() = CircleShape

    /** Standard content card (the most common `shape =` in the app is 12dp; cards that hold lists use 16dp). */
    val cardShape: Shape get() = RoundedCornerShape(lg)

    /** Compact card / list row. */
    val rowShape: Shape get() = RoundedCornerShape(md)

    /** Frosted panel corner. */
    val panelShape: Shape get() = RoundedCornerShape(panel)

    /** Bottom sheet: rounded on top only. */
    val sheetShape: Shape get() = RoundedCornerShape(topStart = xl, topEnd = xl)

    /** Tag or status chip. */
    val chipShape: Shape get() = RoundedCornerShape(chip)

    /** Plain chat bubble. */
    val bubbleShape: Shape get() = RoundedCornerShape(lg)

    /** Assistant bubble: the top-start corner is tucked toward the avatar. */
    val bubbleIncomingShape: Shape
        get() = RoundedCornerShape(topStart = xs, topEnd = lg, bottomEnd = lg, bottomStart = lg)

    /** User bubble: mirrored tail. */
    val bubbleOutgoingShape: Shape
        get() = RoundedCornerShape(topStart = lg, topEnd = xs, bottomEnd = lg, bottomStart = lg)

    /** Floating nav bar corner. */
    val barShape: Shape get() = RoundedCornerShape(bar)
}

// ── Elevation ────────────────────────────────────────────────────────────────

/**
 * Shadow levels. The app is deliberately flat: almost every card sits at
 * `level0`, tonal surfaces at `level1`/`level2`, and only the glass panel and
 * the file-manager action sheet lift with a real shadow.
 */
@Immutable
data class PlumElevation(
    val level0: Dp = 0.dp,
    val level1: Dp = 1.dp,
    val level2: Dp = 2.dp,
    val level3: Dp = 8.dp,
    /** Drop shadow of a frosted glass panel. */
    val level4: Dp = 10.dp,
)

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * One layered surface role. Colours are resolved against the active palette,
 * so `foreground` and `foregroundMuted` already meet WCAG AA on the colour a
 * user actually sees — `opaqueFallback`, the container composited over the
 * backdrop.
 */
@Immutable
data class PlumSurfaceRole(
    /** Translucent fill (bottom of the gradient). */
    val container: Color,
    /** Slightly brighter fill at the top edge; equals [container] for flat roles. */
    val containerTop: Color,
    /** Luminous hairline around the surface. */
    val border: Color,
    /** Highlight line along the top edge; transparent when the palette has no glass. */
    val highlight: Color,
    /** Backdrop blur radius when a haze source is available; `0.dp` disables blur. */
    val blurRadius: Dp,
    /** Opaque colour to paint instead of the translucent fill when blur is unavailable or unwanted. */
    val opaqueFallback: Color,
    /** Primary text and icons on this surface. */
    val foreground: Color,
    /** Secondary text; still at least 4.5:1 against [opaqueFallback]. */
    val foregroundMuted: Color,
    /** Shadow colour for roles that lift off the backdrop. */
    val shadow: Color,
    /** Shadow elevation for the role. */
    val elevation: Dp,
)

@Immutable
data class PlumSurfaces(
    /** Default frosted card, mirrors the WebUI `.glass-panel`. */
    val glass: PlumSurfaceRole,
    /** More opaque glass for panels that hold dense text (settings, code). */
    val glassStrong: PlumSurfaceRole,
    /** Raised control fill: round icon buttons, floating chips. */
    val raised: PlumSurfaceRole,
    /** Recessed fill: segmented tracks, progress rails, inner rows. */
    val sunken: PlumSurfaceRole,
    /** Floating bars and sheets laid out above scrolling content; blurs the backdrop. */
    val overlay: PlumSurfaceRole,
)

// ── Borders ──────────────────────────────────────────────────────────────────

@Immutable
data class PlumBorder(
    val hairline: Dp = 1.dp,
    /** Barely-there separator between rows. */
    val subtle: Color,
    /** Card and control outline. */
    val strong: Color,
    /** Focus and selection ring. */
    val focus: Color,
)

// ── Motion ───────────────────────────────────────────────────────────────────

/**
 * Durations already honour the system "remove animations" setting: when
 * [reduceMotion] is true every duration is `0`, so a `tween` built from these
 * values snaps instead of animating.
 */
@Immutable
data class PlumMotion(
    val reduceMotion: Boolean,
    /** Hover, press and colour changes. */
    val fast: Int,
    /** Expand/collapse, fades, list item moves. */
    val medium: Int,
    /** Sheet and screen transitions. */
    val slow: Int,
    val standardEasing: Easing = FastOutSlowInEasing,
    val decelerateEasing: Easing = LinearOutSlowInEasing,
    /** Material 3 emphasized-decelerate; used for reveals. */
    val emphasizedEasing: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f),
    /** Material 3 emphasized-accelerate; used for dismissals. */
    val exitEasing: Easing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f),
) {
    fun <T> tweenFast(): TweenSpec<T> = tween(fast, easing = standardEasing)
    fun <T> tweenMedium(): TweenSpec<T> = tween(medium, easing = standardEasing)
    fun <T> tweenSlow(): TweenSpec<T> = tween(slow, easing = emphasizedEasing)

    companion object {
        const val FAST_MS = 150
        const val MEDIUM_MS = 220
        const val SLOW_MS = 360

        fun resolve(reduceMotion: Boolean): PlumMotion = PlumMotion(
            reduceMotion = reduceMotion,
            fast = if (reduceMotion) 0 else FAST_MS,
            medium = if (reduceMotion) 0 else MEDIUM_MS,
            slow = if (reduceMotion) 0 else SLOW_MS,
        )
    }
}

// ── Sizing ───────────────────────────────────────────────────────────────────

@Immutable
data class PlumSizing(
    /** Minimum touch target. */
    val touchTarget: Dp = 48.dp,
    val iconXs: Dp = 14.dp,
    val iconSm: Dp = 16.dp,
    /** Icon beside a text row; the most common icon size in the app. */
    val iconInline: Dp = 18.dp,
    val iconMd: Dp = 20.dp,
    val iconLg: Dp = 24.dp,
    val avatarSm: Dp = 28.dp,
    val avatarMd: Dp = 34.dp,
    val avatarLg: Dp = 40.dp,
    /** Live/status dot next to a title. */
    val statusDot: Dp = 8.dp,
    /** Default size of [com.claudewebui.app.ui.components.common.StatusDot]. */
    val statusDotLarge: Dp = 10.dp,
    /** Count badge on a navigation item. */
    val badge: Dp = 15.dp,
    val navBarHeight: Dp = 78.dp,
    val navBarHeightShort: Dp = 54.dp,
    val navRailWidth: Dp = 96.dp,
    val navRailWidthShort: Dp = 68.dp,
)

// ── Provider accent ──────────────────────────────────────────────────────────

/** Provider colours resolved for the active light/dark palette. */
@Immutable
data class PlumProviderAccent(
    val color: Color,
    val container: Color,
    val onContainer: Color,
)

// ── Root ─────────────────────────────────────────────────────────────────────

@Immutable
data class PlumTokens(
    val isDark: Boolean,
    val spacing: PlumSpacing,
    val radius: PlumRadius,
    val elevation: PlumElevation,
    val surfaces: PlumSurfaces,
    val border: PlumBorder,
    val motion: PlumMotion,
    val sizing: PlumSizing,
) {
    /** Provider accent that matches the current palette brightness. */
    fun providerAccent(provider: CliProvider): PlumProviderAccent {
        val theme = ProviderThemes.get(provider)
        return if (isDark) {
            PlumProviderAccent(theme.colorDark, theme.containerColorDark, theme.onContainerColorDark)
        } else {
            PlumProviderAccent(theme.color, theme.containerColor, theme.onContainerColor)
        }
    }
}

val LocalPlumTokens = staticCompositionLocalOf { plumTokensFor(PlumDarkPalette, reduceMotion = false) }

/**
 * `PlumTheme.tokens.spacing.lg` — the accessor screens should use. Mirrors the
 * `MaterialTheme.colorScheme` style so it reads naturally next to it.
 */
object PlumTheme {
    val tokens: PlumTokens
        @Composable @ReadOnlyComposable get() = LocalPlumTokens.current

    val palette: PlumPalette
        @Composable @ReadOnlyComposable get() = LocalPlumPalette.current

    val extendedColors: ExtendedColors
        @Composable @ReadOnlyComposable get() = LocalExtendedColors.current
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Builds the token set for a palette. Surfaces derive from the palette's
 * glass and fill colours so a new [PlumPalette] gets matching tokens for free.
 */
fun plumTokensFor(palette: PlumPalette, reduceMotion: Boolean): PlumTokens {
    val hasGlass = palette.glassHighlight != Color.Transparent
    val backdrop = palette.background

    fun role(
        container: Color,
        containerTop: Color = container,
        border: Color = palette.border,
        highlight: Color = if (hasGlass) palette.glassHighlight else Color.Transparent,
        blurRadius: Dp = 0.dp,
        shadow: Color = Color.Transparent,
        elevation: Dp = 0.dp,
    ): PlumSurfaceRole {
        val opaque = container.compositeOver(backdrop)
        return PlumSurfaceRole(
            container = container,
            containerTop = containerTop,
            border = border,
            highlight = highlight,
            blurRadius = if (hasGlass) blurRadius else 0.dp,
            opaqueFallback = opaque,
            foreground = aaForeground(palette.text, opaque, isLight = palette.isLight),
            foregroundMuted = aaForeground(palette.muted, opaque, isLight = palette.isLight),
            shadow = shadow,
            elevation = if (shadow == Color.Transparent) 0.dp else elevation,
        )
    }

    val surfaces = PlumSurfaces(
        glass = role(
            container = palette.glassFill,
            containerTop = palette.glassFillTop,
            shadow = palette.glassShadow,
            elevation = 10.dp,
        ),
        glassStrong = role(
            container = palette.surface,
            containerTop = palette.surfaceStrong,
            shadow = palette.glassShadow,
            elevation = 10.dp,
        ),
        raised = role(
            container = palette.controlSurface,
            border = palette.borderSoft,
            highlight = Color.Transparent,
        ),
        sunken = role(
            container = palette.segmentTrack,
            border = Color.Transparent,
            highlight = Color.Transparent,
        ),
        overlay = role(
            // Same tint the floating nav bar has always used over its blur.
            container = backdrop.copy(alpha = .55f),
            containerTop = palette.glassFillTop,
            blurRadius = 28.dp,
            shadow = palette.glassShadow,
            elevation = 10.dp,
        ),
    )

    return PlumTokens(
        isDark = !palette.isLight,
        spacing = PlumSpacing(),
        radius = PlumRadius(),
        elevation = PlumElevation(),
        surfaces = surfaces,
        border = PlumBorder(
            subtle = palette.borderSoft,
            strong = palette.border,
            focus = palette.accent,
        ),
        motion = PlumMotion.resolve(reduceMotion),
        sizing = PlumSizing(),
    )
}

// ── Contrast helpers ─────────────────────────────────────────────────────────

/** WCAG 2.x contrast ratio between two opaque colours, 1..21. */
fun contrastRatio(foreground: Color, background: Color): Float {
    val l1 = foreground.luminance() + 0.05f
    val l2 = background.luminance() + 0.05f
    return if (l1 > l2) l1 / l2 else l2 / l1
}

/** Minimum ratio for normal text under WCAG AA. */
const val WCAG_AA_TEXT = 4.5f

/**
 * Returns [candidate] when it reads at AA against [backdrop]; otherwise the
 * palette's strongest text colour for that brightness. The palettes already
 * pass, so this is a guard for future palettes rather than a repaint.
 */
private fun aaForeground(candidate: Color, backdrop: Color, isLight: Boolean): Color {
    if (contrastRatio(candidate, backdrop) >= WCAG_AA_TEXT) return candidate
    return if (isLight) Color(0xFF17181C) else Color(0xFFF3F1F5)
}
