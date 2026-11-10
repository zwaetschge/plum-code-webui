package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.data.model.PiModelRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Pi model picker of a CLI subagent entry: same labels and option order as
 * the WebUI (`CliSubagentsSection.tsx`).
 */
class PiModelRouteOptionsTest {

    private val labels = PiModelLabels(
        default = "Standard (erstes Modell im Pi-Menü)",
        direct = "%1\$s · direkt",
        hosted = "%1\$s · über %2\$s (dessen Budget)",
        unavailable = "%1\$s · nicht mehr verfügbar",
    )

    private val routes = listOf(
        PiModelRoute("deepseek/deepseek-v4-pro", "deepseek", "deepseek-v4-pro", "direct"),
        PiModelRoute("mistral/deepseek-v4-pro", "mistral", "deepseek-v4-pro", "hosted"),
    )

    @Test
    fun `direct and hosted routes name who pays`() {
        assertEquals("deepseek/deepseek-v4-pro · direkt", piRouteLabel(routes[0], labels))
        assertEquals("mistral/deepseek-v4-pro · über mistral (dessen Budget)", piRouteLabel(routes[1], labels))
    }

    @Test
    fun `default comes first and stores an empty model`() {
        val options = piModelOptions(routes, "", labels)
        assertEquals(listOf("", "deepseek/deepseek-v4-pro", "mistral/deepseek-v4-pro"), options.map { it.value })
        assertEquals(labels.default, options.first().label)
        assertFalse(options.any { it.unavailable })
    }

    @Test
    fun `a stored model that vanished stays selectable right after the default`() {
        val options = piModelOptions(routes, "openrouter/qwen-old", labels)
        assertEquals(PiModelOption("openrouter/qwen-old", "openrouter/qwen-old · nicht mehr verfügbar", unavailable = true), options[1])
        assertEquals(4, options.size)
        assertEquals("openrouter/qwen-old · nicht mehr verfügbar", piModelSelectedLabel(options, "openrouter/qwen-old"))
    }

    @Test
    fun `a stored model that is still offered is not duplicated`() {
        val options = piModelOptions(routes, "mistral/deepseek-v4-pro", labels)
        assertEquals(3, options.size)
        assertEquals("mistral/deepseek-v4-pro · über mistral (dessen Budget)", piModelSelectedLabel(options, " mistral/deepseek-v4-pro "))
        assertEquals(labels.default, piModelSelectedLabel(options, ""))
    }

    @Test
    fun `duplicate ids from the server collapse to one row`() {
        val options = piModelOptions(routes + routes[0], "", labels)
        assertEquals(3, options.size)
    }

    @Test
    fun `the picker is only for pi and only with a list`() {
        assertTrue(usesPiModelPicker("pi", routes))
        assertFalse(usesPiModelPicker("pi", emptyList()))
        assertFalse(usesPiModelPicker("zai", routes))
        assertFalse(usesPiModelPicker("vibe", routes))
    }

    @Test
    fun `providers match the WebUI including vibe`() {
        assertEquals(listOf("codex", "claude", "zai", "pi", "vibe"), CLI_SUBAGENT_PROVIDERS)
    }
}
