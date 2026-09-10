package com.claudewebui.app.ui.theme

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.components.common.LocalPlumHaze
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeChild

// ═════════════════════════════════════════════════════════════════════════════
// Glass primitives
//
// Glassmorphism is used sparingly: translucent layered surfaces with a
// luminous 1px border, blurred only where a backdrop is actually available to
// blur. Everything here degrades to an opaque fill, so the same call site
// looks right on E-Ink, on devices without RenderEffect, and inside content
// that is itself the blur source.
// ═════════════════════════════════════════════════════════════════════════════

/** Which [PlumSurfaceRole] a glass surface paints with. */
enum class GlassRole {
    /** Standard frosted card. */
    Default,
    /** Denser glass for text-heavy panels. */
    Strong,
    /** Raised control fill. */
    Raised,
    /** Recessed track or inner row. */
    Sunken,
    /** Floating bar or sheet above scrolling content; the only role that blurs by default. */
    Overlay,
}

fun PlumSurfaces.forRole(role: GlassRole): PlumSurfaceRole = when (role) {
    GlassRole.Default -> glass
    GlassRole.Strong -> glassStrong
    GlassRole.Raised -> raised
    GlassRole.Sunken -> sunken
    GlassRole.Overlay -> overlay
}

/**
 * True only inside the subtree where [LocalPlumHaze] points at a state that a
 * `Modifier.haze(...)` source is feeding, and where the reader is laid out
 * above — not inside — that source. `PlumNavScaffold` provides it around the
 * floating bottom bar. A `hazeChild` placed inside its own source draws
 * itself recursively, so blur stays off unless this is true.
 */
val LocalPlumHazeReady = staticCompositionLocalOf { false }

/** Backdrop blur needs RenderEffect, which arrived with Android 12. */
val supportsBackdropBlur: Boolean
    get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

/**
 * Translucent fill + luminous hairline for any shape.
 *
 * - With `blur = true`, a live haze source, RenderEffect support and a palette
 *   that has glass, the backdrop is sampled and blurred behind the surface.
 * - When blur is requested but unavailable, the role's `opaqueFallback` is
 *   painted so text stays readable over whatever scrolls beneath.
 * - Otherwise the role's translucent gradient is painted; the procedural
 *   backdrop is low-frequency enough that it reads as diffused without blur.
 *
 * The bright top-edge highlight is what makes the surface read as glass
 * rather than a flat card; it is skipped when the palette sets it transparent
 * (E-Ink) or for the raised/sunken roles.
 */
@Composable
fun Modifier.plumGlass(
    role: GlassRole = GlassRole.Default,
    shape: Shape = PlumTheme.tokens.radius.cardShape,
    borderColor: Color? = null,
    blur: Boolean = role == GlassRole.Overlay,
    highlight: Boolean = role == GlassRole.Default || role == GlassRole.Strong || role == GlassRole.Overlay,
): Modifier {
    val tokens = PlumTheme.tokens
    val surface = tokens.surfaces.forRole(role)
    val hazeReady = LocalPlumHazeReady.current
    val hazeState = LocalPlumHaze.current
    val canBlur = blur && hazeReady && supportsBackdropBlur && surface.blurRadius > 0.dp

    val filled = when {
        canBlur -> this
            .clip(shape)
            .hazeChild(
                state = hazeState,
                shape = shape,
                style = HazeStyle(
                    backgroundColor = surface.opaqueFallback,
                    tint = HazeTint(surface.container),
                    blurRadius = surface.blurRadius,
                    noiseFactor = .04f,
                ),
            )
        blur -> this
            .clip(shape)
            .background(surface.opaqueFallback)
        else -> this
            .clip(shape)
            .background(Brush.verticalGradient(listOf(surface.containerTop, surface.container)))
    }

    val bordered = if (surface.border == Color.Transparent && borderColor == null) {
        filled
    } else {
        filled.border(tokens.border.hairline, borderColor ?: surface.border, shape)
    }

    return if (highlight && surface.highlight != Color.Transparent) {
        bordered.plumGlassHighlight(surface.highlight, tokens.border.hairline)
    } else {
        bordered
    }
}

/**
 * The lit top edge of a glass surface, drawn over the content. Inset from
 * both sides so it fades out before reaching the corner radius, the way a
 * real bevel catches light.
 */
fun Modifier.plumGlassHighlight(color: Color, strokeWidth: Dp = 1.dp): Modifier = drawWithContent {
    drawContent()
    val inset = minOf(size.width, size.height) * .12f
    drawLine(
        brush = Brush.horizontalGradient(
            0f to Color.Transparent,
            .5f to color,
            1f to Color.Transparent,
        ),
        start = Offset(inset, 1f),
        end = Offset(size.width - inset, 1f),
        strokeWidth = strokeWidth.toPx(),
    )
}

/**
 * A glass surface with the role's shadow, content colour and padding applied.
 *
 * Content inherits `LocalContentColor` that meets AA on the resolved backdrop,
 * so `Text` and `Icon` inside need no explicit colour for body copy. Pass
 * [onClick] to make the whole card a button.
 */
@Composable
fun PlumGlassCard(
    modifier: Modifier = Modifier,
    role: GlassRole = GlassRole.Default,
    shape: Shape = PlumTheme.tokens.radius.cardShape,
    contentPadding: Dp = PlumTheme.tokens.spacing.cardPadding,
    borderColor: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val surface = PlumTheme.tokens.surfaces.forRole(role)
    val lifted = if (surface.elevation > 0.dp && surface.shadow != Color.Transparent) {
        modifier.shadow(
            elevation = surface.elevation,
            shape = shape,
            ambientColor = surface.shadow,
            spotColor = surface.shadow,
        )
    } else {
        modifier
    }
    val clickable = if (onClick != null) {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }
    CompositionLocalProvider(LocalContentColor provides surface.foreground) {
        Column(
            modifier = lifted
                .plumGlass(role = role, shape = shape, borderColor = borderColor)
                .then(clickable)
                .padding(contentPadding),
            content = content,
        )
    }
}
