package com.claudewebui.app.ui.motion

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.theme.LocalReduceMotion

/**
 * Shared motion vocabulary for the chat surfaces, mirroring the WebUI tokens
 * (`src/lib/motion/tokens.ts`). Springs are tuned by damping ratio and
 * stiffness, not nominal duration. Every helper honours the system
 * "remove animations" setting ([LocalReduceMotion]): the state change still
 * happens, it just snaps.
 *
 * The values are design heuristics, not platform norms.
 */
object PlumMotionTokens {
    /** Menus, sheets, status bubbles: calm, barely any overshoot. */
    const val MENU_DAMPING = 0.8f
    const val MENU_STIFFNESS = 380f

    /** Selection markers (effort rail): a bit firmer so it lands decisively. */
    const val MARKER_DAMPING = 0.85f
    const val MARKER_STIFFNESS = 480f

    /** Press feedback: quick and nearly critically damped. */
    const val PRESS_DAMPING = 0.75f
    const val PRESS_STIFFNESS = 900f
    const val PRESS_SCALE = 0.96f

    /** Elements entering (rise, fade in). */
    const val ENTER_MS = 280
    /** Elements leaving; exits are faster than entrances. */
    const val EXIT_MS = 170
    /** New content after a context switch (e.g. another chat). */
    const val SWITCH_IN_MS = 300
    /** How long a copy confirmation stays before reverting. */
    const val COPY_CONFIRM_MS = 1600L
    /** Distance a new message rises from. */
    val RISE_DISTANCE: Dp = 10.dp

    val EnterEasing: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val ExitEasing: Easing = CubicBezierEasing(0.4f, 0f, 1f, 1f)

    fun <T> menuSpring(): SpringSpec<T> = spring(MENU_DAMPING, MENU_STIFFNESS)
    fun <T> markerSpring(): SpringSpec<T> = spring(MARKER_DAMPING, MARKER_STIFFNESS)
    fun <T> pressSpring(): SpringSpec<T> = spring(PRESS_DAMPING, PRESS_STIFFNESS)
    fun <T> enterTween(delayMs: Int = 0): FiniteAnimationSpec<T> = tween(ENTER_MS, delayMs, EnterEasing)
    fun <T> exitTween(): FiniteAnimationSpec<T> = tween(EXIT_MS, easing = ExitEasing)
}

/** True when the system animator scale is 0; animations must snap. */
@Composable
fun reducedMotion(): Boolean = LocalReduceMotion.current

/** Returns this spec, or an instant snap when motion is reduced. */
fun <T> AnimationSpec<T>.orSnap(reduce: Boolean): AnimationSpec<T> = if (reduce) snap() else this

/** Same as [orSnap] for APIs that require a finite spec (enter/exit transitions). */
fun <T> FiniteAnimationSpec<T>.orSnapFinite(reduce: Boolean): FiniteAnimationSpec<T> = if (reduce) snap() else this

/**
 * Uniform press feedback: the element shrinks to [PlumMotionTokens.PRESS_SCALE]
 * while pressed and springs back on release. Pass the same interaction source
 * the clickable/button uses. Drawn in the graphics layer, so no relayout.
 */
fun Modifier.pressScale(interactionSource: InteractionSource): Modifier = composed {
    val pressed by interactionSource.collectIsPressedAsState()
    val reduce = LocalReduceMotion.current
    val scale by animateFloatAsState(
        if (pressed && !reduce) PlumMotionTokens.PRESS_SCALE else 1f,
        PlumMotionTokens.pressSpring<Float>().orSnap(reduce),
        label = "press_scale",
    )
    graphicsLayer { scaleX = scale; scaleY = scale }
}

/**
 * One-time rise for content that appears during the session: fades in while
 * travelling up by [distance]. With [animate] false (history that was already
 * there) or reduced motion it is drawn in place immediately.
 */
fun Modifier.riseIn(animate: Boolean, distance: Dp = PlumMotionTokens.RISE_DISTANCE): Modifier = composed {
    val reduce = LocalReduceMotion.current
    val progress = remember { Animatable(if (animate && !reduce) 0f else 1f) }
    LaunchedEffect(Unit) { if (progress.value < 1f) progress.animateTo(1f, PlumMotionTokens.enterTween()) }
    val px = with(LocalDensity.current) { distance.toPx() }
    graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * px
    }
}

/**
 * Context switch (another chat): old content leaves quickly and slightly
 * upwards, new content settles in from below. Instant when motion is reduced.
 */
fun plumSwitchTransform(reduce: Boolean, risePx: Int, exitPx: Int): ContentTransform =
    if (reduce) {
        EnterTransition.None togetherWith ExitTransition.None
    } else {
        (fadeIn(tween(PlumMotionTokens.SWITCH_IN_MS, PlumMotionTokens.EXIT_MS / 2, PlumMotionTokens.EnterEasing)) +
            slideInVertically(tween(PlumMotionTokens.SWITCH_IN_MS, PlumMotionTokens.EXIT_MS / 2, PlumMotionTokens.EnterEasing)) { risePx }) togetherWith
            (fadeOut(PlumMotionTokens.exitTween()) + slideOutVertically(PlumMotionTokens.exitTween()) { -exitPx })
    }

/**
 * Three dots pulsing in sequence: "the model is thinking". Static when
 * [active] is false or motion is reduced, so nothing loops without reason.
 */
@Composable
fun ThinkingDots(color: Color, modifier: Modifier = Modifier, active: Boolean = true, dot: Dp = 7.dp) {
    val reduce = reducedMotion()
    val transition = if (active && !reduce) rememberInfiniteTransition(label = "thinking_dots") else null
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(dot * 0.7f), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { index ->
            val phase = transition?.animateFloat(
                initialValue = 0f, targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(560, delayMillis = index * 140, easing = PlumMotionTokens.EnterEasing), RepeatMode.Reverse),
                label = "thinking_dot_$index",
            )
            Box(
                Modifier.size(dot)
                    .graphicsLayer { val p = phase?.value ?: 0.6f; val s = 0.7f + 0.3f * p; scaleX = s; scaleY = s; alpha = 0.4f + 0.6f * p }
                    .clip(CircleShape).background(color),
            )
        }
    }
}

/** Slim caret at the end of streaming text; breathes gently, static when motion is reduced. */
@Composable
fun StreamingCaret(color: Color, modifier: Modifier = Modifier) {
    val reduce = reducedMotion()
    val alpha = if (reduce) null else rememberInfiniteTransition(label = "caret").animateFloat(
        initialValue = 1f, targetValue = 0.25f,
        animationSpec = infiniteRepeatable(tween(520, easing = PlumMotionTokens.EnterEasing), RepeatMode.Reverse),
        label = "caret_alpha",
    )
    Box(
        modifier.size(width = 3.dp, height = 16.dp)
            .graphicsLayer { this.alpha = alpha?.value ?: 1f }
            .clip(RoundedCornerShape(2.dp)).background(color),
    )
}
