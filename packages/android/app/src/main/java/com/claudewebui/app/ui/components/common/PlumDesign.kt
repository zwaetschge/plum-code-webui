package com.claudewebui.app.ui.components.common

import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.outlined.ViewList
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.ui.theme.GlassRole
import com.claudewebui.app.ui.theme.plumGlass
import com.claudewebui.app.ui.theme.LocalPlumHazeReady
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.PlumTheme
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.haze

// ═════════════════════════════════════════════════════════════════════════════
// Plum shared components
//
// Sections:
//   1. Palette accessors
//   2. Navigation model and app-wide locals
//   3. Backdrop and glass surfaces
//   4. Scroll-edge fades
//   5. Buttons and controls
//   6. Headers
//   7. Chips
//   8. Navigation chrome (rail, scaffold, bottom bar)
//   9. Provider helpers
//  10. Data visualisation
//
// Dp values come from PlumTheme.tokens (ui/theme/PlumTokens.kt) wherever a
// token with the identical value exists; the few odd literals left are
// deliberate and commented. See ui/theme/README.md.
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. Palette accessors ─────────────────────────────────────────────────────
// Resolved through the active palette rather than hardcoded, so the whole app
// re-themes without touching the ~340 call sites that read these names.
// See ui/theme/PlumPalette.kt for the palettes themselves.

val PlumBackground: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.background
val PlumSurface: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.surface
val PlumSurfaceStrong: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.surfaceStrong
val PlumBorder: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.border
val PlumBorderSoft: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.borderSoft
val PlumText: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.text
val PlumMuted: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.muted
val PlumAccent: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.accent
val PlumAccentDeep: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.accentDeep
val PlumGreen: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.green
val PlumBlue: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.blue
val PlumAmber: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.amber
val PlumRed: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.red
val PlumSubtleFill: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.subtleFill
val PlumTrackFill: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.trackFill

// ── 2. Navigation model and app-wide locals ──────────────────────────────────

enum class MainDestination(
    private val labelRes: Int,
    val icon: ImageVector,
) {
    SESSIONS(R.string.component_sessions, Icons.Outlined.ViewList),
    ACTIVITY(R.string.component_activity, Icons.Outlined.ShowChart),
    ANALYTICS(R.string.component_analytics, Icons.Outlined.Analytics),
    LIBRARY(R.string.component_library, Icons.Outlined.FolderOpen),
    SETTINGS(R.string.component_settings, Icons.Outlined.Settings);

    val label: String @Composable get() = stringResource(labelRes)
}

/**
 * Backdrop sampled by the floating nav bar. Screens draw into it; the bar reads
 * it back blurred, which is what gives the frosted look instead of a flat tint.
 *
 * Only meaningful where [com.claudewebui.app.ui.theme.LocalPlumHazeReady] is
 * also true; the default instance here has no source feeding it.
 */
val LocalPlumHaze = staticCompositionLocalOf { HazeState() }

/**
 * Shared error/confirmation channel. Failures used to surface as Toasts in some
 * screens and as silent state fields in others, so the same problem looked
 * different depending on where it happened — and a Toast cannot offer a retry.
 * Every screen inside [PlumNavScaffold] gets this host.
 */
val LocalPlumSnackbar = staticCompositionLocalOf { SnackbarHostState() }

// ── 3. Backdrop and glass surfaces ───────────────────────────────────────────

@Composable
fun PlumBackdrop(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val palette = LocalPlumPalette.current
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(palette.background),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            if (palette.glowPrimary != Color.Transparent) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(palette.glowPrimary, Color.Transparent),
                        center = Offset(size.width * .05f, size.height * .28f),
                        radius = size.width * .75f,
                    ),
                    radius = size.width * .75f,
                    center = Offset(size.width * .05f, size.height * .28f),
                )
            }
            if (palette.glowSecondary != Color.Transparent) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(palette.glowSecondary, Color.Transparent),
                        center = Offset(size.width * .98f, size.height * .04f),
                        radius = size.width * .60f,
                    ),
                    radius = size.width * .60f,
                    center = Offset(size.width * .98f, size.height * .04f),
                )
            }
            if (palette.grid != Color.Transparent) {
                // Grid pitch is a backdrop texture, not a layout value.
                val step = 36.dp.toPx()
                var x = 0f
                while (x <= size.width) {
                    drawLine(palette.grid, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
                    x += step
                }
                var y = 0f
                while (y <= size.height) {
                    drawLine(palette.grid, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
                    y += step
                }
            }
        }
        content()
    }
}

/**
 * Frosted glass surface, matching the WebUI's `.glass-panel`.
 *
 * Four things together make it read as glass rather than as a flat card: a
 * very translucent fill so the atmospheric backdrop shows through, a slight
 * top-to-bottom gradient, a soft drop shadow that lifts it off the background,
 * and a bright hairline along the top edge standing in for the CSS
 * `inset 0 1px 0` highlight. The backdrop itself is procedural and
 * low-frequency, so it needs no blur to look diffused behind the glass.
 *
 * Token equivalent: `Modifier.plumGlass(GlassRole.Default, panelShape)` plus
 * `elevation.level4`; new code should prefer
 * [com.claudewebui.app.ui.theme.PlumGlassCard].
 */
@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    radius: Dp = 20.dp,
    borderColor: Color = PlumBorder,
    content: @Composable () -> Unit,
) {
    val palette = LocalPlumPalette.current
    val tokens = PlumTheme.tokens
    val shape = RoundedCornerShape(radius)
    Box(
        modifier = modifier
            .shadow(
                elevation = if (palette.glassShadow == Color.Transparent) {
                    tokens.elevation.level0
                } else {
                    tokens.elevation.level4
                },
                shape = shape,
                ambientColor = palette.glassShadow,
                spotColor = palette.glassShadow,
            )
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    listOf(palette.glassFillTop, palette.glassFill),
                ),
            )
            .border(tokens.border.hairline, borderColor, shape),
    ) {
        if (palette.glassHighlight != Color.Transparent) {
            // The lit top edge. Inset horizontally so it fades out before the
            // corner radius, the way a real bevel catches light.
            Canvas(Modifier.matchParentSize()) {
                val inset = radius.toPx() * .55f
                drawLine(
                    brush = Brush.horizontalGradient(
                        0f to Color.Transparent,
                        .5f to palette.glassHighlight,
                        1f to Color.Transparent,
                    ),
                    start = Offset(inset, 1f),
                    end = Offset(size.width - inset, 1f),
                    strokeWidth = tokens.border.hairline.toPx(),
                )
            }
        }
        content()
    }
}

/**
 * Frosted-glass fill for arbitrary shapes — chat bubbles, header pills, input
 * fields. Same recipe as [GlassPanel] minus the drop shadow and top highlight,
 * which don't read at small scale: a translucent gradient over the atmospheric
 * backdrop plus a hairline border.
 *
 * Token equivalent: `Modifier.plumGlass(shape = shape, highlight = false)`.
 */
@Composable
fun Modifier.glassSurface(
    shape: Shape,
    borderColor: Color? = null,
): Modifier {
    val palette = LocalPlumPalette.current
    val hairline = PlumTheme.tokens.border.hairline
    return this
        .clip(shape)
        .background(Brush.verticalGradient(listOf(palette.glassFillTop, palette.glassFill)))
        .border(hairline, borderColor ?: palette.border, shape)
}

// ── 4. Scroll-edge fades ─────────────────────────────────────────────────────

/**
 * Dissolves a scroll container's edges instead of clipping them. A list that
 * ends in a hard line reads as a rendering fault — especially a horizontal row
 * cut mid-word, or a card sliced by a divider. The content is masked with a
 * gradient alpha, so the item fades into the backdrop as it scrolls out.
 *
 * DstIn needs a layer to blend against, but a full-viewport offscreen buffer
 * per frame is exactly the fill-rate cost these full-screen lists cannot
 * afford. The middle of the content therefore draws directly; only the thin
 * edge strips render through a saveLayer of their own size.
 */
fun Modifier.fadingEdges(
    top: Dp = 0.dp,
    bottom: Dp = 0.dp,
    start: Dp = 0.dp,
    end: Dp = 0.dp,
): Modifier {
    val vertical = top > 0.dp || bottom > 0.dp
    val horizontal = start > 0.dp || end > 0.dp
    // Mixed axes would need corner treatment no current caller wants; fall
    // back to a single full layer for that case instead of guessing.
    if (vertical && horizontal) {
        return this
            .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
            .drawWithContent {
                drawContent()
                fadeMask(top, bottom, start, end)
            }
    }
    return this.drawWithContent {
        val topPx = top.toPx().coerceIn(0f, size.height)
        val bottomPx = bottom.toPx().coerceIn(0f, size.height - topPx)
        val startPx = start.toPx().coerceIn(0f, size.width)
        val endPx = end.toPx().coerceIn(0f, size.width - startPx)

        clipRect(
            left = startPx,
            top = topPx,
            right = size.width - endPx,
            bottom = size.height - bottomPx,
        ) {
            this@drawWithContent.drawContent()
        }

        if (topPx > 0f) {
            fadeStrip(
                Rect(0f, 0f, size.width, topPx),
                Brush.verticalGradient(
                    colors = listOf(Color.Transparent, Color.Black),
                    endY = topPx,
                ),
            )
        }
        if (bottomPx > 0f) {
            fadeStrip(
                Rect(0f, size.height - bottomPx, size.width, size.height),
                Brush.verticalGradient(
                    colors = listOf(Color.Black, Color.Transparent),
                    startY = size.height - bottomPx,
                    endY = size.height,
                ),
            )
        }
        if (startPx > 0f) {
            fadeStrip(
                Rect(0f, 0f, startPx, size.height),
                Brush.horizontalGradient(
                    colors = listOf(Color.Transparent, Color.Black),
                    endX = startPx,
                ),
            )
        }
        if (endPx > 0f) {
            fadeStrip(
                Rect(size.width - endPx, 0f, size.width, size.height),
                Brush.horizontalGradient(
                    colors = listOf(Color.Black, Color.Transparent),
                    startX = size.width - endPx,
                    endX = size.width,
                ),
            )
        }
    }
}

/** Content clipped into a strip-sized layer, then alpha-masked with DstIn. */
private fun ContentDrawScope.fadeStrip(rect: Rect, brush: Brush) {
    if (rect.width <= 0f || rect.height <= 0f) return
    drawIntoCanvas { canvas -> canvas.saveLayer(rect, Paint()) }
    clipRect(rect.left, rect.top, rect.right, rect.bottom) {
        this@fadeStrip.drawContent()
    }
    drawRect(
        brush = brush,
        topLeft = Offset(rect.left, rect.top),
        size = Size(rect.width, rect.height),
        blendMode = BlendMode.DstIn,
    )
    drawIntoCanvas { canvas -> canvas.restore() }
}

/** Single-layer mask, used only when both axes fade at once. */
private fun ContentDrawScope.fadeMask(top: Dp, bottom: Dp, start: Dp, end: Dp) {
    if (top > 0.dp) {
        drawRect(
            brush = Brush.verticalGradient(
                colors = listOf(Color.Transparent, Color.Black),
                endY = top.toPx(),
            ),
            blendMode = BlendMode.DstIn,
        )
    }
    if (bottom > 0.dp) {
        drawRect(
            brush = Brush.verticalGradient(
                colors = listOf(Color.Black, Color.Transparent),
                startY = size.height - bottom.toPx(),
                endY = size.height,
            ),
            blendMode = BlendMode.DstIn,
        )
    }
    if (start > 0.dp) {
        drawRect(
            brush = Brush.horizontalGradient(
                colors = listOf(Color.Transparent, Color.Black),
                endX = start.toPx(),
            ),
            blendMode = BlendMode.DstIn,
        )
    }
    if (end > 0.dp) {
        drawRect(
            brush = Brush.horizontalGradient(
                colors = listOf(Color.Black, Color.Transparent),
                startX = size.width - end.toPx(),
                endX = size.width,
            ),
            blendMode = BlendMode.DstIn,
        )
    }
}

// ── 5. Buttons and controls ──────────────────────────────────────────────────

/** Round raised icon button at the minimum touch target; the header action. */
@Composable
fun PlumIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = PlumText,
) {
    val tokens = PlumTheme.tokens
    Box(
        modifier = modifier
            .size(tokens.sizing.touchTarget)
            .clip(CircleShape)
            .background(LocalPlumPalette.current.controlSurface)
            .border(tokens.border.hairline, PlumBorderSoft, CircleShape)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, tint = tint, modifier = Modifier.size(tokens.sizing.iconLg))
    }
}

// ── 6. Headers ───────────────────────────────────────────────────────────────

@Composable
fun PlumScreenHeader(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    live: Boolean = false,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val tokens = PlumTheme.tokens
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                horizontal = tokens.spacing.headerHorizontal,
                vertical = tokens.spacing.headerVertical,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = PlumText,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.6).sp,
                )
                if (live) {
                    Box(
                        Modifier
                            // 7dp trailing gap is optical: the dot sits closer
                            // to its stringResource(R.string.component_live) label than to the title.
                            .padding(start = tokens.spacing.compact, end = 7.dp)
                            .size(tokens.sizing.statusDot)
                            .background(PlumGreen, CircleShape),
                    )
                    Text(stringResource(R.string.component_live), color = PlumMuted, fontSize = 14.sp)
                }
            }
            Text(
                subtitle,
                color = PlumMuted,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(tokens.spacing.compact), content = actions)
    }
}

@Composable
fun SectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = PlumText, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        if (caption != null) {
            Text("  $caption", color = PlumMuted, fontSize = 14.sp)
        }
        Box(Modifier.weight(1f))
        trailing?.invoke()
    }
}

// ── 7. Chips ─────────────────────────────────────────────────────────────────

/** Tinted status tag: 14% of [color] behind a label in the same colour. */
@Composable
fun StatusPill(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val tokens = PlumTheme.tokens
    Box(
        modifier = modifier
            // 9dp sits between radius.sm and radius.chip; kept so the pill
            // does not visibly change. Candidate for radius.chip on migration.
            .clip(RoundedCornerShape(9.dp))
            .background(color.copy(alpha = .14f))
            .padding(horizontal = tokens.spacing.compact, vertical = tokens.spacing.inline),
    ) {
        Text(label, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

// ── 8. Navigation chrome ─────────────────────────────────────────────────────

/**
 * A vertical navigation rail for wide windows.
 *
 * On the unfolded Fold and on a tablet the bottom bar sits far from the hands
 * and eats vertical space that a mostly-vertical app needs; a side rail is the
 * Material answer and keeps the destinations reachable near the edge.
 */
@Composable
fun PlumNavRail(
    selected: MainDestination,
    onNavigate: (MainDestination) -> Unit,
    modifier: Modifier = Modifier,
    badgeDestination: MainDestination? = MainDestination.ACTIVITY,
    badgeCount: Int = 0,
) {
    val tokens = PlumTheme.tokens
    // Five labelled items need roughly 350dp; below that the labels go and the
    // rail narrows to icons so every destination still fits without scrolling.
    val short = isShortWindow() || LocalDensity.current.fontScale >= 1.5f
    val itemShape = RoundedCornerShape(tokens.radius.panel)
    // Sized to its items and parked in the bottom-left corner: on a tablet held
    // in two hands that is where the thumb actually reaches. A full-height pill
    // put the destinations in the middle of the screen, out of reach.
    GlassPanel(
        modifier = modifier
            .wrapContentHeight()
            .width(if (short) tokens.sizing.navRailWidthShort else tokens.sizing.navRailWidth)
            .padding(start = tokens.spacing.compact, bottom = tokens.spacing.compact),
        // Between radius.xl and radius.bar; matches the rail's narrower width.
        radius = 26.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .wrapContentHeight()
                .navigationBarsPadding()
                .padding(
                    vertical = if (short) tokens.spacing.inline else tokens.spacing.md,
                    horizontal = tokens.spacing.inline,
                ),
            verticalArrangement = Arrangement.spacedBy(
                if (short) tokens.spacing.xxs else tokens.spacing.inline,
            ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            MainDestination.entries.forEach { destination ->
                val active = destination == selected
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(itemShape)
                        .then(
                            if (active) {
                                Modifier
                                    .background(LocalPlumPalette.current.selectionTint)
                                    .border(tokens.border.hairline, PlumAccent, itemShape)
                            } else Modifier
                        )
                        .semantics { this.selected = active }
                        .clickable(role = Role.Button) { onNavigate(destination) }
                        .padding(vertical = if (short) 7.dp else tokens.spacing.compact),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    NavDestinationIcon(
                        destination = destination,
                        active = active,
                        badgeCount = if (destination == badgeDestination) badgeCount else 0,
                    )
                    if (!short) {
                        Text(
                            destination.label,
                            color = if (active) PlumAccent else PlumMuted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = tokens.spacing.xs),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Destination icon with the amber count badge. Shared by the rail and the
 * bottom bar, which used to carry two identical copies.
 */
@Composable
private fun NavDestinationIcon(
    destination: MainDestination,
    active: Boolean,
    badgeCount: Int,
) {
    val tokens = PlumTheme.tokens
    Box {
        Icon(
            destination.icon,
            contentDescription = destination.label,
            // 23dp: one step under iconLg so five items fit the short bar.
            tint = if (active) PlumAccent else PlumMuted,
            modifier = Modifier.size(23.dp),
        )
        if (badgeCount > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(tokens.sizing.badge)
                    .background(PlumAmber, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    badgeCount.coerceAtMost(9).toString(),
                    color = Color.Black,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/**
 * Picks the navigation affordance that fits the window: a side rail once there
 * is width to spare, the bottom bar otherwise. Screens hand over their content
 * and get the correct insets either way.
 */
@Composable
fun PlumNavScaffold(
    selected: MainDestination,
    onNavigate: (MainDestination) -> Unit,
    badgeCount: Int = 0,
    floatingActionButton: @Composable (() -> Unit)? = null,
    /**
     * Optional title row for rail layouts. It spans the top starting at the very
     * left edge, above the rail, so a screen title does not have to start after
     * the rail's width. Ignored in the bottom-bar layout, where screens draw
     * their own header inside the content.
     */
    header: (@Composable () -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit,
) {
    val tokens = PlumTheme.tokens
    // Provided once at the app root, not here: screens collect their error
    // events above this scaffold, and a host state created here would be a
    // different instance from the one they post into.
    val snackbarHostState = LocalPlumSnackbar.current
    // Floating action button inset from the content corner.
    val fabInset = 22.dp
    if (isTabletWidth()) {
        // The header floats over the top-left corner instead of sitting in a row
        // above everything: a real row also pushes the right-hand pane down, which
        // left a dead band and a hard edge above the detail view. Panes that need
        // to clear it get the inset through `content`'s PaddingValues and can
        // apply it to just the columns that sit underneath.
        Box(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxSize()) {
                PlumNavRail(
                    selected,
                    onNavigate,
                    badgeCount = badgeCount,
                    // Bottom-left corner. The title floats over the space this leaves
                    // free at the top of the rail column, so neither has to move.
                    modifier = Modifier.align(Alignment.Bottom),
                )
                // Without a Scaffold there is nothing applying window insets, so
                // the content would slide under the status bar.
                // No status bar inset here on purpose. The bar is transparent and
                // floats over the content: backdrops, gradients and glass panels run
                // all the way to the top edge, and the inset is handed to the screen
                // so it can offset the parts that must stay readable. Consuming it
                // here instead cut a hard horizontal edge across the top of every
                // pane that paints its own background.
                Box(Modifier.weight(1f)) {
                    // Rail layouts have no bottom bar consuming the nav-bar inset,
                    // so hand it to the screen instead of a zero padding.
                    content(
                        PaddingValues(
                            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding(),
                            bottom = WindowInsets.navigationBars
                                .asPaddingValues()
                                .calculateBottomPadding(),
                        )
                    )
                    SnackbarHost(
                        snackbarHostState,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .navigationBarsPadding()
                            .padding(bottom = tokens.spacing.lg),
                    )
                    // No bottom bar to sit above, so the action floats in the
                    // content corner itself.
                    floatingActionButton?.let { fab ->
                        Box(
                            Modifier
                                .align(Alignment.BottomEnd)
                                .navigationBarsPadding()
                                .padding(end = fabInset, bottom = fabInset),
                        ) { fab() }
                    }
                }
            }
            header?.let { headerContent ->
                Box(
                    Modifier
                        .align(Alignment.TopStart)
                        .statusBarsPadding()
                        .padding(start = tokens.spacing.lg, top = tokens.spacing.xs),
                ) { headerContent() }
            }
        }
    } else {
        // The bar floats above the content instead of living in Scaffold's
        // bottomBar slot: that slot reserves an opaque strip which cut the last
        // session card off with a hard black edge. Content now scrolls beneath
        // the glass bar and simply gets enough bottom padding to clear it.
        val short = isShortWindow() || LocalDensity.current.fontScale >= 1.5f
        val barHeight = if (short) tokens.sizing.navBarHeightShort else tokens.sizing.navBarHeight
        val barInset = barHeight + if (short) tokens.spacing.sm else tokens.spacing.lg

        val hazeState = remember { HazeState() }

        Scaffold(
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
        ) { _ ->
            Box(Modifier.fillMaxSize()) {
                // Everything drawn here is what the bar blurs.
                Box(Modifier.fillMaxSize().haze(hazeState)) {
                    // Same rule as the rail layout: the bar floats, and the screen
                    // gets the inset. Scaffold's own value is zero here because
                    // contentWindowInsets is cleared, so read the inset directly.
                    content(
                        PaddingValues(
                            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding(),
                            bottom = barInset + WindowInsets.navigationBars
                                .asPaddingValues()
                                .calculateBottomPadding(),
                        )
                    )
                }

                // Above the floating bar, or the bar covers the message.
                SnackbarHost(
                    snackbarHostState,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .navigationBarsPadding()
                        .padding(bottom = barInset),
                )

                // The bar is laid out above the haze source, so it may blur it;
                // LocalPlumHazeReady tells plumGlass(...) the state is live.
                CompositionLocalProvider(
                    LocalPlumHaze provides hazeState,
                    LocalPlumHazeReady provides true,
                ) {
                    PlumBottomBar(
                        selected,
                        onNavigate,
                        modifier = Modifier.align(Alignment.BottomCenter),
                        badgeCount = badgeCount,
                    )
                }

                floatingActionButton?.let { fab ->
                    Box(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .navigationBarsPadding()
                            .padding(end = fabInset, bottom = barInset),
                    ) { fab() }
                }
            }
        }
    }
}

@Composable
fun PlumBottomBar(
    selected: MainDestination,
    onNavigate: (MainDestination) -> Unit,
    modifier: Modifier = Modifier,
    badgeDestination: MainDestination? = MainDestination.ACTIVITY,
    badgeCount: Int = 0,
) {
    val tokens = PlumTheme.tokens
    val short = isShortWindow() || LocalDensity.current.fontScale >= 1.5f
    val barShape = tokens.radius.barShape
    // 22dp: the item pill is inset from the 30dp bar so both curves stay concentric.
    val itemShape = RoundedCornerShape(22.dp)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(
                horizontal = tokens.spacing.cozy,
                vertical = if (short) tokens.spacing.xs else tokens.spacing.sm,
            )
            .height(if (short) tokens.sizing.navBarHeightShort else tokens.sizing.navBarHeight)
            .shadow(tokens.elevation.level4, barShape)
            .plumGlass(role = GlassRole.Overlay, shape = barShape),
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = tokens.spacing.xs, vertical = 5.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MainDestination.entries.forEach { destination ->
                val active = destination == selected
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(itemShape)
                        .then(
                            if (active) {
                                Modifier
                                    .background(LocalPlumPalette.current.selectionTint)
                                    .border(tokens.border.hairline, PlumAccent, itemShape)
                            } else Modifier
                        )
                        .semantics { this.selected = active }
                        .clickable(role = Role.Button) { onNavigate(destination) }
                        .padding(vertical = tokens.spacing.sm),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    NavDestinationIcon(
                        destination = destination,
                        active = active,
                        badgeCount = if (destination == badgeDestination) badgeCount else 0,
                    )
                    if (!short) Text(
                        destination.label,
                        color = if (active) PlumAccent else PlumMuted,
                        fontSize = 11.sp,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }
    }
}

// ── 9. Provider helpers ──────────────────────────────────────────────────────

// Composable because the brand tints now resolve through the active palette.
@Composable
@ReadOnlyComposable
fun providerColor(provider: CLIProvider): Color = when (provider) {
    CLIProvider.CODEX -> PlumGreen
    CLIProvider.OPENCODE -> PlumAccent
    CLIProvider.PI -> PlumBlue
    CLIProvider.KIMI -> Color(0xFF2582ED)
    CLIProvider.ZAI -> Color(0xFF7ED957)
    CLIProvider.CLAUDE -> PlumAmber
}

fun providerLabel(provider: CLIProvider): String = when (provider) {
    CLIProvider.CODEX -> "CODEX"
    CLIProvider.OPENCODE -> "OPENCODE"
    CLIProvider.PI -> "PI"
    CLIProvider.KIMI -> "KIMI"
    CLIProvider.ZAI -> "Z.AI"
    CLIProvider.CLAUDE -> "CLAUDE"
}

fun providerModel(provider: CLIProvider): String = when (provider) {
    CLIProvider.CODEX -> "gpt-5.5"
    CLIProvider.OPENCODE -> "glm-5.1"
    CLIProvider.PI -> "glm-5.1"
    CLIProvider.KIMI -> "kimi-for-coding"
    CLIProvider.ZAI -> "opus"
    CLIProvider.CLAUDE -> "sonnet"
}

/** The model a session actually runs: explicit choice first, provider default as fallback. */
fun sessionModel(session: Session): String =
    session.cliModel?.takeIf { it.isNotBlank() } ?: providerModel(session.cliProvider)

// ── 10. Data visualisation ───────────────────────────────────────────────────

@Composable
fun Sparkline(
    color: Color,
    values: List<Float>,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        if (values.size < 2) return@Canvas
        val max = values.maxOrNull()?.coerceAtLeast(1f) ?: 1f
        val min = values.minOrNull() ?: 0f
        val range = (max - min).coerceAtLeast(1f)
        val step = size.width / (values.size - 1)
        val points = values.mapIndexed { index, value ->
            Offset(index * step, size.height - ((value - min) / range) * size.height)
        }
        for (index in 0 until points.lastIndex) {
            drawLine(
                color = color,
                start = points[index],
                end = points[index + 1],
                strokeWidth = 2.dp.toPx(),
                cap = StrokeCap.Round,
            )
        }
        drawPath(
            path = androidx.compose.ui.graphics.Path().apply {
                moveTo(points.first().x, size.height)
                points.forEach { lineTo(it.x, it.y) }
                lineTo(points.last().x, size.height)
                close()
            },
            brush = Brush.verticalGradient(listOf(color.copy(alpha = .24f), Color.Transparent)),
        )
    }
}
