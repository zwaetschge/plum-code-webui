package com.claudewebui.app.data.model

import org.junit.Assert.*
import org.junit.Test

class ReasoningLevelTest {
    @Test fun claudeAndZaiOfferTheSameEffortAndUltracode() {
        assertEquals(ReasoningLevel.forProvider(CLIProvider.CLAUDE), ReasoningLevel.forProvider(CLIProvider.ZAI))
        for (provider in listOf(CLIProvider.CLAUDE, CLIProvider.ZAI)) {
            assertTrue(ReasoningLevel.ULTRACODE in ReasoningLevel.forProvider(provider))
            assertTrue(ReasoningLevel.XHIGH in ReasoningLevel.forProvider(provider))
            assertFalse(ReasoningLevel.ULTRA in ReasoningLevel.forProvider(provider))
        }
        assertEquals(ReasoningLevel.ULTRACODE, ReasoningLevel.fromId("ultracode"))
        assertFalse(ReasoningLevel.ULTRACODE in ReasoningLevel.forProvider(CLIProvider.CODEX))
        assertTrue(ReasoningLevel.ULTRA in ReasoningLevel.forProvider(CLIProvider.CODEX))
    }

    @Test fun piOffersUltracodeButOpenCodeDoesNot() {
        assertTrue(ReasoningLevel.ULTRACODE in ReasoningLevel.forProvider(CLIProvider.PI))
        assertFalse(ReasoningLevel.ULTRACODE in ReasoningLevel.forProvider(CLIProvider.OPENCODE))
    }
}
