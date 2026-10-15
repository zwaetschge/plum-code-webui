package com.claudewebui.app.ui.screens.dashboard

import android.content.Context
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.core.graphics.PathParser
import com.claudewebui.app.ui.theme.PlumPalette
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.float
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.min
import kotlin.math.pow

/*
 * Player for the start-page sketches. `assets/start_scenes.json` is written by
 * `packages/frontend/scripts/start-scenes.mjs` and played identically by the
 * WebUI (`StartScene.tsx`); keep the interpolation rules in step.
 */

internal class SceneTrack(val property: String, val times: FloatArray, val values: FloatArray, val ease: String)

internal class SceneShape(
    val kind: String,
    val geometry: FloatArray,
    val rx: Float,
    val path: Path?,
    val children: List<SceneShape>,
    val fill: String?,
    val stroke: String?,
    val strokeWidth: Float,
    val alpha: Float,
    val offset: Offset,
    val rotation: Float,
    val pivot: Offset,
    val delay: Float,
    val tracks: List<SceneTrack>,
)

internal class StartSceneData(val duration: Long, val rest: Float, val shapes: List<SceneShape>)

internal object StartScenes {
    @Volatile private var cache: Map<String, StartSceneData>? = null

    fun get(context: Context, key: String): StartSceneData? {
        val scenes = cache ?: synchronized(this) {
            cache ?: runCatching {
                val text = context.assets.open("start_scenes.json").bufferedReader().use { it.readText() }
                Json.parseToJsonElement(text).jsonObject.mapValues { (_, value) -> scene(value.jsonObject) }
            }.getOrDefault(emptyMap()).also { cache = it }
        }
        return scenes[key]
    }

    private fun scene(json: JsonObject) = StartSceneData(
        duration = json["dur"]?.jsonPrimitive?.float?.toLong() ?: 5000L,
        rest = json["rest"]?.jsonPrimitive?.floatOrNull ?: .75f,
        shapes = json["sh"]!!.jsonArray.map { shape(it.jsonObject) },
    )

    private fun JsonObject.num(name: String, default: Float = 0f) = this[name]?.jsonPrimitive?.floatOrNull ?: default
    private fun JsonObject.pair(name: String): Offset? = (this[name] as? JsonArray)?.let { Offset(it[0].jsonPrimitive.float, it[1].jsonPrimitive.float) }

    private fun shape(json: JsonObject): SceneShape {
        val kind = json["k"]!!.jsonPrimitive.content
        val geometry = when (kind) {
            "rect" -> floatArrayOf(json.num("x"), json.num("y"), json.num("w"), json.num("h"))
            "circ" -> floatArrayOf(json.num("cx"), json.num("cy"), json.num("r"))
            else -> floatArrayOf()
        }
        val pivot = json.pair("or") ?: when (kind) {
            "rect" -> Offset(geometry[0] + geometry[2] / 2, geometry[1] + geometry[3] / 2)
            "circ" -> Offset(geometry[0], geometry[1])
            else -> Offset(60f, 28f)
        }
        return SceneShape(
            kind = kind,
            geometry = geometry,
            rx = json.num("rx"),
            path = json["d"]?.jsonPrimitive?.contentOrNull?.let { PathParser.createPathFromPathData(it).asComposePath() },
            children = (json["c"] as? JsonArray)?.map { shape(it.jsonObject) }.orEmpty(),
            fill = json["f"]?.jsonPrimitive?.contentOrNull,
            stroke = json["s"]?.jsonPrimitive?.contentOrNull,
            strokeWidth = json.num("sw", 1.5f),
            alpha = json.num("o", 1f),
            offset = json.pair("tr") ?: Offset.Zero,
            rotation = json.num("ro"),
            pivot = pivot,
            delay = json.num("dl"),
            tracks = (json["an"] as? JsonArray)?.map { track ->
                val obj = track.jsonObject
                val keys = obj["k"]!!.jsonArray.map { it.jsonArray }
                SceneTrack(
                    obj["p"]!!.jsonPrimitive.content,
                    FloatArray(keys.size) { keys[it][0].jsonPrimitive.float },
                    FloatArray(keys.size) { keys[it][1].jsonPrimitive.float },
                    obj["e"]?.jsonPrimitive?.contentOrNull ?: "o",
                )
            }.orEmpty(),
        )
    }
}

private fun ease(kind: String, u: Float): Float = when (kind) {
    "io" -> if (u < .5f) 4 * u * u * u else 1 - (-2 * u + 2).pow(3) / 2
    "l" -> u
    "s" -> 0f
    "b" -> 1 + 2.70158f * (u - 1).pow(3) + 1.70158f * (u - 1).pow(2)
    else -> 1 - (1 - u).pow(3)
}

private fun SceneTrack.sample(t: Float): Float {
    if (t <= times.first()) return values.first()
    if (t >= times.last()) return values.last()
    var i = 0
    while (times[i + 1] < t) i++
    val span = (times[i + 1] - times[i]).takeIf { it > 0f } ?: 1f
    return values[i] + (values[i + 1] - values[i]) * ease(ease, (t - times[i]) / span)
}

private class Pose(var x: Float = 0f, var y: Float = 0f, var r: Float = 0f, var sx: Float = 1f, var sy: Float = 1f, var o: Float = 1f, var d: Float = -1f)

private fun SceneShape.pose(t: Float): Pose {
    val local = (((t - delay) % 1f) + 1f) % 1f
    val pose = Pose()
    for (track in tracks) {
        val v = track.sample(local)
        when (track.property) {
            "x" -> pose.x += v
            "y" -> pose.y += v
            "r" -> pose.r += v
            "s" -> { pose.sx *= v; pose.sy *= v }
            "sx" -> pose.sx *= v
            "sy" -> pose.sy *= v
            "o" -> pose.o *= v
            "d" -> pose.d = v
        }
    }
    // An undrawn stroke would still show its round cap as a dot.
    if (pose.d in 0f..0.001f) pose.o = 0f
    return pose
}

/** The first [fraction] of every contour's total length, like an SVG dash with pathLength 1. */
private fun Path.trimmed(fraction: Float): Path {
    val source = asAndroidPath()
    val measure = android.graphics.PathMeasure(source, false)
    var total = 0f
    do total += measure.length while (measure.nextContour())
    var left = total * fraction
    val out = android.graphics.Path()
    measure.setPath(source, false)
    do {
        val length = measure.length
        if (left <= 0f) break
        measure.getSegment(0f, min(left, length), out, true)
        left -= length
    } while (measure.nextContour())
    return out.asComposePath()
}

private fun PlumPalette.token(name: String?): Color? = when (name) {
    null -> null
    "a" -> accent
    "a2" -> accent.copy(alpha = .45f)
    "a3" -> accent.copy(alpha = .16f)
    "t" -> text.copy(alpha = .22f)
    "t2" -> text.copy(alpha = .12f)
    "m" -> text.copy(alpha = .07f)
    "fg" -> text
    "bg" -> background
    "r" -> red
    "y" -> amber
    "g" -> green
    else -> null
}

/** Draws [scene] at cycle position [t], fitted into the canvas like an SVG viewBox of 120×56. */
internal fun DrawScope.drawStartScene(scene: StartSceneData, t: Float, palette: PlumPalette) {
    val unit = min(size.width / 120f, size.height / 56f)
    translate((size.width - 120f * unit) / 2f, (size.height - 56f * unit) / 2f) {
        scale(unit, unit, pivot = Offset.Zero) {
            scene.shapes.forEach { drawSceneShape(it, t, 1f, palette) }
        }
    }
}

private fun DrawScope.drawSceneShape(shape: SceneShape, t: Float, parentAlpha: Float, palette: PlumPalette) {
    val pose = shape.pose(t)
    val alpha = (parentAlpha * shape.alpha * pose.o).coerceIn(0f, 1f)
    if (alpha <= 0f) return
    withTransform({
        translate(shape.offset.x + pose.x, shape.offset.y + pose.y)
        rotate(shape.rotation + pose.r, shape.pivot)
        scale(pose.sx, pose.sy, shape.pivot)
    }) {
        val fill = palette.token(shape.fill)
        val stroke = palette.token(shape.stroke)
        val line = Stroke(shape.strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round)
        when (shape.kind) {
            "g" -> shape.children.forEach { drawSceneShape(it, t, alpha, palette) }
            "rect" -> {
                val (x, y, w, h) = shape.geometry
                listOfNotNull(fill?.let { it to Fill }, stroke?.let { it to line }).forEach { (color, style) ->
                    drawRoundRect(color, Offset(x, y), Size(w, h), CornerRadius(shape.rx), style = style, alpha = alpha)
                }
            }
            "circ" -> {
                val (cx, cy, r) = shape.geometry
                fill?.let { drawCircle(it, r, Offset(cx, cy), alpha = alpha) }
                stroke?.let { drawCircle(it, r, Offset(cx, cy), alpha = alpha, style = line) }
            }
            else -> shape.path?.let { path ->
                fill?.let { drawPath(path, it, alpha = alpha) }
                stroke?.let { drawPath(if (pose.d >= 0f) path.trimmed(pose.d) else path, it, alpha = alpha, style = line) }
            }
        }
    }
}
