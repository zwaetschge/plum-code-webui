package com.claudewebui.app.ui.components.dynamicui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.AcUnit
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Flight
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.LocalCafe
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.LocalHospital
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.PedalBike
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.SportsSoccer
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Train
import androidx.compose.material.icons.outlined.Umbrella
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.reducedMotion
import com.claudewebui.app.ui.theme.PlumPalette
import com.claudewebui.app.ui.theme.PlumTheme
import kotlin.math.abs
import kotlin.math.roundToInt

// ── Motion (plan 1.6: text 0.7 s, rows 0.42 s, charts 1.2–1.8 s) ────────────

internal val DuiEase = CubicBezierEasing(.16f, 1f, .3f, 1f)
internal const val DUI_FADE_MS = 700
internal const val DUI_ROW_MS = 420
internal const val DUI_CHART_MS = 1400

/** A one-time rise for rows of a fresh answer, staggered by [index]. */
@Composable
internal fun Modifier.duiRise(animate: Boolean, index: Int = 0): Modifier {
    val reduce = reducedMotion()
    val progress = remember { androidx.compose.animation.core.Animatable(if (animate && !reduce) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (progress.value < 1f) progress.animateTo(1f, tween(DUI_ROW_MS, delayMillis = (index.coerceAtMost(8)) * 45, easing = DuiEase))
    }
    val distance = with(LocalDensity.current) { 8.dp.toPx() }
    return graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * distance
    }
}

// ── Colours ─────────────────────────────────────────────────────────────────

/* WebUI's --dui-edge (foreground / 0.12) and --dui-field (foreground / 0.06). */
internal val PlumPalette.duiEdge: Color get() = text.copy(alpha = .12f)
internal val PlumPalette.duiField: Color get() = text.copy(alpha = .06f)
internal val PlumPalette.duiPositive: Color get() = if (isLight) Color(0xFF0E8A4F) else Color(0xFF3DDC97)
internal val PlumPalette.duiNegative: Color get() = if (isLight) Color(0xFFC62B36) else Color(0xFFFF6B72)

/** Status tones info/success/warning/danger/tip(accent)/neutral. */
internal class DuiTone(val color: Color, val fill: Color, val icon: ImageVector)

internal fun duiTone(tone: String?, palette: PlumPalette): DuiTone {
    val color = when (tone) {
        "info" -> palette.blue
        "success", "positive" -> palette.duiPositive
        "warning" -> if (palette.isLight) Color(0xFFB26A00) else palette.amber
        "danger", "negative" -> palette.duiNegative
        "tip", "accent" -> palette.accent
        else -> palette.text
    }
    val icon = when (tone) {
        "info" -> Icons.Outlined.Info
        "success", "positive" -> Icons.Outlined.CheckCircle
        "warning" -> Icons.Outlined.WarningAmber
        "danger", "negative" -> Icons.Outlined.ErrorOutline
        "tip", "accent" -> Icons.Outlined.Lightbulb
        else -> Icons.Outlined.Info
    }
    return DuiTone(color, color.copy(alpha = if (palette.isLight) .09f else .13f), icon)
}

/** Colour of a server change tone (positive/negative/neutral). */
internal fun changeColor(tone: String?, palette: PlumPalette): Color = when (tone) {
    "positive" -> palette.duiPositive
    "negative" -> palette.duiNegative
    else -> palette.muted
}

// ── Skeletons ───────────────────────────────────────────────────────────────

/** Shimmering placeholder; static when motion is reduced. */
@Composable
internal fun DuiSkeleton(modifier: Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(8.dp)) {
    val palette = PlumTheme.palette
    val reduce = reducedMotion()
    val base = palette.text.copy(alpha = if (palette.isLight) .07f else .06f)
    val shine = palette.text.copy(alpha = if (palette.isLight) .13f else .12f)
    val shift = if (reduce) 0f else {
        val transition = rememberInfiniteTransition(label = "dui_skeleton")
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1500, easing = LinearEasing), RepeatMode.Restart), label = "dui_skeleton_shift").value
    }
    BoxWithConstraints(modifier.clip(shape)) {
        val width = constraints.maxWidth.toFloat().coerceAtLeast(1f)
        val offset = (2f * shift - .5f) * width * 1.5f
        Box(
            Modifier.fillMaxSize().background(
                if (reduce) SolidColor(base) else Brush.horizontalGradient(listOf(base, shine, base), startX = offset - width * .5f, endX = offset + width * .5f),
            ),
        )
    }
}

/** A line of skeleton text. */
@Composable
internal fun DuiSkeletonLine(fraction: Float, height: Dp = 12.dp) {
    DuiSkeleton(Modifier.fillMaxWidth(fraction).height(height), CircleShape)
}

// ── Segment bar ─────────────────────────────────────────────────────────────

/**
 * Segmented control with one sliding selection surface. [fill] spreads the
 * options over the width (tabs); otherwise they keep their natural width.
 */
@Composable
internal fun DuiSegmentBar(
    labels: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    fill: Boolean = true,
    small: Boolean = false,
    enabled: Boolean = true,
    description: String? = null,
) {
    val palette = PlumTheme.palette
    val reduce = reducedMotion()
    val density = LocalDensity.current
    val positions = remember(labels) { mutableStateMapOf<Int, Pair<Float, Float>>() }
    val target = positions[selected]
    var placed by remember(labels) { mutableStateOf(false) }
    val spec: AnimationSpec<Float> = if (!placed || reduce) snap() else spring(.86f, 520f)
    val x by animateFloatAsState(target?.first ?: 0f, spec, label = "dui_segment_x")
    val w by animateFloatAsState(target?.second ?: 0f, spec, label = "dui_segment_w")
    LaunchedEffect(target != null) { if (target != null) placed = true }
    val height = if (small) 30.dp else 36.dp
    val outer = RoundedCornerShape(if (small) 10.dp else 12.dp)
    val inner = RoundedCornerShape(if (small) 8.dp else 9.dp)
    Box(
        modifier
            .then(if (fill) Modifier.fillMaxWidth() else Modifier)
            .clip(outer)
            .background(palette.text.copy(alpha = if (palette.isLight) .06f else .07f))
            .padding(3.dp)
            .selectableGroup()
            .semantics { if (description != null) contentDescription = description },
    ) {
        if (target != null) Box(
            Modifier
                .offset { IntOffset(x.roundToInt(), 0) }
                .width(with(density) { w.toDp() })
                .height(height - 6.dp)
                .clip(inner)
                .background(if (palette.isLight) Color.White else palette.text.copy(alpha = .15f)),
        )
        Row(if (fill) Modifier.fillMaxWidth() else Modifier) {
            labels.forEachIndexed { index, label ->
                val active = index == selected
                Box(
                    Modifier
                        .then(if (fill) Modifier.weight(1f) else Modifier)
                        .height(height - 6.dp)
                        .clip(inner)
                        .onPlaced { positions[index] = it.positionInParent().x to it.size.width.toFloat() }
                        .selectable(active, enabled = enabled, role = Role.Tab) { if (!active) onSelect(index) }
                        .padding(horizontal = if (small) 10.dp else 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelLarge.copy(fontSize = if (small) 12.sp else 13.sp),
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                        color = if (active) palette.text else palette.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** A compact icon button for widget toolbars. */
@Composable
internal fun DuiToolButton(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = PlumTheme.palette.muted, enabled: Boolean = true) {
    IconButton(onClick = onClick, enabled = enabled, modifier = modifier.size(36.dp)) {
        Icon(icon, description, tint = tint, modifier = Modifier.size(18.dp))
    }
}

/** A small muted attribution line ("Quelle: Open-Meteo"), tappable when it has a link. */
@Composable
internal fun DuiSourceLine(source: UiLiveSource, extra: String? = null, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val palette = PlumTheme.palette
    val label = stringResource(R.string.dynamic_ui_source, source.name)
    Row(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .then(if (isUiHttpsUrl(source.url)) Modifier.clickable { openUiUrl(context, source.url) } else Modifier)
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(listOfNotNull(source.name.takeIf { it.isNotBlank() }?.let { label }, extra).joinToString(" · "), style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp), color = palette.muted.copy(alpha = .85f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ── Images (always through the authenticated proxy) ────────────────────────

/** Debug fixtures draw generated art instead of fetching real images. */
internal val LocalDuiDemoImages = staticCompositionLocalOf { false }

/**
 * An external https image loaded only through `/api/assistant/ui/image`.
 * Shows a shimmer while loading; on failure [fallback] (or nothing).
 */
@Composable
internal fun DuiImage(
    src: String?,
    alt: String?,
    modifier: Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    onFailed: (() -> Unit)? = null,
    fallback: (@Composable () -> Unit)? = null,
) {
    if (LocalDuiDemoImages.current) {
        DuiDemoArt(src.orEmpty(), modifier.semantics { if (alt != null) contentDescription = alt })
        return
    }
    val url = remember(src) { src?.let { uiImageProxyUrl(it) } }
    var state by remember(url) { mutableStateOf(if (url == null) 2 else 0) } // 0 loading, 1 done, 2 failed
    LaunchedEffect(state) { if (state == 2) onFailed?.invoke() }
    val reduce = reducedMotion()
    val alpha by animateFloatAsState(if (state == 1) 1f else 0f, if (reduce) snap() else tween(DUI_ROW_MS, easing = DuiEase), label = "dui_image_alpha")
    Box(modifier) {
        if (state == 0) DuiSkeleton(Modifier.matchParentSize(), RoundedCornerShape(0.dp))
        if (state == 2) fallback?.invoke()
        if (url != null && state != 2) AsyncImage(
            model = url,
            contentDescription = alt,
            contentScale = contentScale,
            alpha = alpha,
            onState = { result ->
                state = when (result) {
                    is AsyncImagePainter.State.Success -> 1
                    is AsyncImagePainter.State.Error -> 2
                    else -> state
                }
            },
            modifier = Modifier.matchParentSize(),
        )
    }
}

/** A quiet placeholder for an image that failed: soft tint with a glyph. */
@Composable
internal fun DuiImageFallback(modifier: Modifier = Modifier, icon: ImageVector = Icons.Outlined.PhotoCamera) {
    val palette = PlumTheme.palette
    Box(modifier.background(Brush.linearGradient(listOf(palette.accent.copy(alpha = .16f), palette.blue.copy(alpha = .10f)))), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = palette.text.copy(alpha = .35f), modifier = Modifier.size(26.dp))
    }
}

/** Deterministic landscape art for fixtures, seeded by the image URL. */
@Composable
internal fun DuiDemoArt(seed: String, modifier: Modifier) {
    val hash = remember(seed) { seed.hashCode() }
    val hues = remember(hash) {
        val base = (abs(hash) % 360).toFloat()
        listOf(base, (base + 38f) % 360f, (base + 200f) % 360f)
    }
    Canvas(modifier) {
        val sky = Brush.verticalGradient(listOf(Color.hsl(hues[0], .55f, .62f), Color.hsl(hues[1], .60f, .78f)))
        drawRect(sky)
        drawCircle(Color.White.copy(alpha = .55f), radius = size.minDimension * .12f, center = Offset(size.width * (.2f + (abs(hash) % 50) / 100f), size.height * .28f))
        val far = Path().apply {
            moveTo(0f, size.height * .72f)
            lineTo(size.width * .22f, size.height * .42f)
            lineTo(size.width * .41f, size.height * .63f)
            lineTo(size.width * .63f, size.height * .36f)
            lineTo(size.width * .86f, size.height * .6f)
            lineTo(size.width, size.height * .5f)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(far, Color.hsl(hues[2], .30f, .42f).copy(alpha = .85f))
        val near = Path().apply {
            moveTo(0f, size.height * .86f)
            quadraticTo(size.width * .35f, size.height * .66f, size.width * .62f, size.height * .82f)
            quadraticTo(size.width * .82f, size.height * .92f, size.width, size.height * .76f)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(near, Color.hsl(hues[2], .35f, .26f))
    }
}

// ── Lightbox ────────────────────────────────────────────────────────────────

/**
 * Stretches the surrounding dialog window over the whole screen, under the
 * system bars (Compose dialogs otherwise stop at them), with bar icons that
 * suit [lightBackground].
 */
@Composable
private fun DuiDialogFullWindow(lightBackground: Boolean) {
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.SideEffect {
        val provider = (view as? androidx.compose.ui.window.DialogWindowProvider) ?: (view.parent as? androidx.compose.ui.window.DialogWindowProvider)
        val window = provider?.window ?: return@SideEffect
        // Floating (dialog) windows drop FLAG_LAYOUT_IN_SCREEN; without it they stop at the bars.
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)
        window.setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = android.graphics.Color.TRANSPARENT
            window.navigationBarColor = android.graphics.Color.TRANSPARENT
        }
        window.attributes = window.attributes.apply {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            // Dialog windows fit the system bars by default (API 30+); the content handles insets itself.
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                fitInsetsTypes = 0
                fitInsetsSides = 0
            }
        }
        // Anything the window still leaves uncovered reads as part of a dark surface.
        if (!lightBackground) window.setDimAmount(1f)
        androidx.core.view.WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = lightBackground
            isAppearanceLightNavigationBars = lightBackground
        }
    }
}

internal class DuiLightboxImage(val src: String, val title: String? = null, val caption: String? = null, val link: String? = null)

/** Full-screen image viewer with swipe between images, double tap to zoom. */
@OptIn(ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
internal fun DuiLightbox(images: List<DuiLightboxImage>, start: Int, onDismiss: () -> Unit) {
    if (images.isEmpty()) return
    val context = LocalContext.current
    val pager = rememberPagerState(initialPage = start.coerceIn(0, images.lastIndex)) { images.size }
    var chrome by remember { mutableStateOf(true) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        DuiDialogFullWindow(lightBackground = false)
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                var zoomed by remember { mutableStateOf(false) }
                val scale by animateFloatAsState(if (zoomed) 2.2f else 1f, tween(260, easing = DuiEase), label = "dui_lightbox_zoom")
                Box(
                    Modifier
                        .fillMaxSize()
                        .pointerInput(page) { detectTapGestures(onDoubleTap = { zoomed = !zoomed }, onTap = { chrome = !chrome }) },
                    contentAlignment = Alignment.Center,
                ) {
                    DuiImage(
                        images[page].src,
                        images[page].title ?: images[page].caption,
                        Modifier.fillMaxWidth().fillMaxHeight(.8f).graphicsLayer { scaleX = scale; scaleY = scale },
                        contentScale = ContentScale.Fit,
                        fallback = { DuiImageFallback(Modifier.fillMaxSize()) },
                    )
                }
            }
            if (chrome) {
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, stringResource(R.string.dynamic_ui_close), tint = Color.White) }
                    Spacer(Modifier.weight(1f))
                    if (images.size > 1) Text("${pager.currentPage + 1} / ${images.size}", color = Color.White.copy(alpha = .85f), style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.width(12.dp))
                }
                val current = images[pager.currentPage]
                if (current.title != null || current.caption != null || current.link != null) Column(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .8f))))
                        .navigationBarsPadding()
                        .padding(horizontal = 18.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    current.title?.let { Text(it, color = Color.White, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    current.caption?.let { Text(it, color = Color.White.copy(alpha = .75f), style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                    current.link?.takeIf { isUiHttpsUrl(it) }?.let { link ->
                        Row(
                            Modifier.clip(RoundedCornerShape(8.dp)).clickable { openUiUrl(context, link) }.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, tint = Color.White.copy(alpha = .85f), modifier = Modifier.size(15.dp))
                            Text(stringResource(R.string.dynamic_ui_open_source), color = Color.White.copy(alpha = .85f), style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
        }
    }
}

// ── Full screen ─────────────────────────────────────────────────────────────

/**
 * Full-screen sheet for a chart, table or expandable card. [scrollable] false
 * hands the content the whole remaining area (a custom tile's frame scrolls itself).
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
internal fun DuiFullscreen(title: String?, onDismiss: () -> Unit, actions: @Composable RowScope.() -> Unit = {}, scrollable: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val palette = PlumTheme.palette
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        DuiDialogFullWindow(lightBackground = palette.isLight)
        Column(Modifier.fillMaxSize().background(palette.background).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                actions()
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, stringResource(R.string.dynamic_ui_close), tint = palette.text) }
            }
            if (scrollable) Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                content = content,
            ) else Column(Modifier.fillMaxSize().imePadding(), content = content)
        }
    }
}

// ── Intents ─────────────────────────────────────────────────────────────────

/**
 * Opens an https link in a Custom Tab (the browser's in-app tab) using the
 * Custom Tabs intent extras directly; other schemes are refused.
 */
internal fun openUiUrl(context: Context, url: String): Boolean {
    if (!isUiHttpsUrl(url)) return false
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        putExtras(Bundle().apply { putBinder("android.support.customtabs.extra.SESSION", null) })
        putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1)
        putExtra("androidx.browser.customtabs.extra.SHARE_STATE", 1)
        if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return runCatching { context.startActivity(intent); true }.getOrDefault(false)
}

/** Share sheet for exported text (CSV of a chart or table). */
internal fun shareUiText(context: Context, text: String, subject: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
        putExtra(Intent.EXTRA_SUBJECT, subject)
    }
    val chooser = Intent.createChooser(send, subject).apply { if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
    runCatching { context.startActivity(chooser) }
}

/** CSV with a header line; fields with separators or quotes are quoted. */
internal fun uiCsv(header: List<String>, rows: List<List<String>>): String {
    fun cell(value: String) = if (value.any { it == ',' || it == '"' || it == '\n' || it == ';' }) "\"" + value.replace("\"", "\"\"") + "\"" else value
    return (listOf(header) + rows).joinToString("\n") { line -> line.joinToString(",") { cell(it) } }
}

/** CSV value of an engine value: raw numbers without grouping. */
internal fun csvValue(value: Any?): String = when (value) {
    null -> ""
    is Double -> if (value.isFinite()) jsNumberString(value) else ""
    else -> jsString(value)
}

// ── Icons ───────────────────────────────────────────────────────────────────

/** UI_ICON_NAMES → Material symbol; null for an emoji or unknown name. */
internal fun uiIconFor(name: String?): ImageVector? = when (name) {
    "check" -> Icons.Outlined.Check
    "info" -> Icons.Outlined.Info
    "warning" -> Icons.Outlined.WarningAmber
    "star" -> Icons.Outlined.StarOutline
    "heart" -> Icons.Outlined.FavoriteBorder
    "clock" -> Icons.Outlined.Schedule
    "calendar" -> Icons.Outlined.CalendarToday
    "location" -> Icons.Outlined.Place
    "phone" -> Icons.Outlined.Phone
    "mail" -> Icons.Outlined.Email
    "link" -> Icons.Outlined.Link
    "user" -> Icons.Outlined.Person
    "users" -> Icons.Outlined.Group
    "home" -> Icons.Outlined.Home
    "work" -> Icons.Outlined.Work
    "car" -> Icons.Outlined.DirectionsCar
    "train" -> Icons.Outlined.Train
    "plane" -> Icons.Outlined.Flight
    "bike" -> Icons.Outlined.PedalBike
    "walk" -> Icons.AutoMirrored.Outlined.DirectionsWalk
    "food" -> Icons.Outlined.Restaurant
    "coffee" -> Icons.Outlined.LocalCafe
    "shopping" -> Icons.Outlined.ShoppingBag
    "money" -> Icons.Outlined.Payments
    "chart" -> Icons.AutoMirrored.Outlined.ShowChart
    "book" -> Icons.AutoMirrored.Outlined.MenuBook
    "school" -> Icons.Outlined.School
    "code" -> Icons.Outlined.Code
    "tool" -> Icons.Outlined.Build
    "idea" -> Icons.Outlined.Lightbulb
    "sun" -> Icons.Outlined.WbSunny
    "cloud" -> Icons.Outlined.Cloud
    "rain" -> Icons.Outlined.Umbrella
    "snow" -> Icons.Outlined.AcUnit
    "leaf" -> Icons.Outlined.Eco
    "fire" -> Icons.Outlined.LocalFireDepartment
    "gift" -> Icons.Outlined.CardGiftcard
    "music" -> Icons.Outlined.MusicNote
    "camera" -> Icons.Outlined.PhotoCamera
    "globe" -> Icons.Outlined.Public
    "lock" -> Icons.Outlined.Lock
    "settings" -> Icons.Outlined.Settings
    "health" -> Icons.Outlined.LocalHospital
    "sport" -> Icons.Outlined.SportsSoccer
    else -> null
}

/** Card-like container used by live widgets and learning components. */
@Composable
internal fun DuiPanel(modifier: Modifier = Modifier, padding: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
    val palette = PlumTheme.palette
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (palette.isLight) Color.White.copy(alpha = .82f) else palette.text.copy(alpha = .045f))
            .border(1.dp, palette.duiEdge, shape)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}
