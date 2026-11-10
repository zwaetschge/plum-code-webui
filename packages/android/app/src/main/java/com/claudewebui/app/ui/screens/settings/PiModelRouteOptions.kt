package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.data.model.PiModelRoute

/**
 * Options of the Pi model picker for a CLI subagent entry, kept free of
 * Compose and Android resources so the labelling rules are unit-testable.
 *
 * Mirrors `CliSubagentsSection.tsx`: the empty model ("first model in the Pi
 * menu") comes first, a stored model that the server no longer offers stays
 * selectable so opening the picker never silently changes the entry, and every
 * route names who pays for it.
 */

/** The label templates, filled from string resources (`%1$s` id, `%2$s` provider). */
data class PiModelLabels(
    val default: String,
    val direct: String,
    val hosted: String,
    val unavailable: String,
)

/** One picker row; [value] is what gets stored as the entry's model. */
data class PiModelOption(
    val value: String,
    val label: String,
    val unavailable: Boolean = false,
)

/** Providers the `subagents` MCP bridge knows how to spawn, in picker order. */
val CLI_SUBAGENT_PROVIDERS = listOf("codex", "claude", "zai", "pi", "vibe")

/** The picker replaces the free-text field only for Pi, and only with a list to pick from. */
fun usesPiModelPicker(provider: String, routes: List<PiModelRoute>): Boolean =
    provider == "pi" && routes.isNotEmpty()

fun piRouteLabel(route: PiModelRoute, labels: PiModelLabels): String =
    if (route.route == "hosted") labels.hosted.format(route.id, route.provider)
    else labels.direct.format(route.id)

fun piModelOptions(
    routes: List<PiModelRoute>,
    storedModel: String,
    labels: PiModelLabels,
): List<PiModelOption> {
    val stored = storedModel.trim()
    val options = mutableListOf(PiModelOption("", labels.default))
    if (stored.isNotEmpty() && routes.none { it.id == stored }) {
        options += PiModelOption(stored, labels.unavailable.format(stored), unavailable = true)
    }
    routes.distinctBy { it.id }.forEach { options += PiModelOption(it.id, piRouteLabel(it, labels)) }
    return options
}

/** The label shown on the closed picker for [storedModel]. */
fun piModelSelectedLabel(options: List<PiModelOption>, storedModel: String): String =
    options.firstOrNull { it.value == storedModel.trim() }?.label ?: storedModel
