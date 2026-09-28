package com.claudewebui.app.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CLIProviderTest {
    @Test
    fun kimiUsesBackendWireId() {
        assertEquals("\"kimi\"", Json.encodeToString(CLIProvider.KIMI))
        assertEquals(CLIProvider.KIMI, Json.decodeFromString<CLIProvider>("\"kimi\""))
    }

    @Test
    fun kimiIsAnActiveStandaloneProvider() {
        assertTrue(CLIProvider.KIMI in CLIProvider.active)
        assertEquals("Kimi", CLIProvider.KIMI.displayName)
        assertEquals(CLIProvider.KIMI, CLIProvider.fromId("kimi"))
    }

    @Test
    fun vibeUsesBackendWireId() {
        assertEquals("\"vibe\"", Json.encodeToString(CLIProvider.VIBE))
        assertEquals(CLIProvider.VIBE, Json.decodeFromString<CLIProvider>("\"vibe\""))
    }

    @Test
    fun vibeSitsBesideKimiInsideTheActiveOrdering() {
        assertTrue(CLIProvider.VIBE in CLIProvider.active)
        assertEquals("Vibe", CLIProvider.VIBE.displayName)
        assertEquals(CLIProvider.VIBE, CLIProvider.fromId("vibe"))
        // Codex stays first, Claude stays last as the legacy harness, and the
        // two persistent ACP harnesses stay neighbours.
        assertEquals(CLIProvider.CODEX, CLIProvider.active.first())
        assertEquals(CLIProvider.CLAUDE, CLIProvider.active.last())
        assertEquals(CLIProvider.KIMI, CLIProvider.active[CLIProvider.active.indexOf(CLIProvider.VIBE) - 1])
    }

    @Test
    fun vibeOffersItsOwnThinkingLevels() {
        assertEquals(
            listOf("off", "low", "medium", "high", "max"),
            ReasoningLevel.forProvider(CLIProvider.VIBE).map { it.id },
        )
    }

    @Test
    fun vibeThinkingOffDoesNotLeakIntoOtherProviders() {
        // Codex spells its lowest level "none"; offering Vibe's "off" there
        // would send a value the harness rejects and silently drop reasoning.
        assertTrue(ReasoningLevel.NONE in ReasoningLevel.forProvider(CLIProvider.CODEX))
        assertTrue(ReasoningLevel.OFF !in ReasoningLevel.forProvider(CLIProvider.CODEX))
        assertTrue(ReasoningLevel.OFF !in ReasoningLevel.forProvider(CLIProvider.KIMI))
        assertTrue(ReasoningLevel.OFF !in ReasoningLevel.forProvider(CLIProvider.CLAUDE))
    }
}
