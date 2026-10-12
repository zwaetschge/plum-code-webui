package com.claudewebui.swarm.data

import com.claudewebui.swarm.CLAUDE
import com.claudewebui.swarm.MIN
import com.claudewebui.swarm.nachricht
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pläne (❓ 📋 Plan, Punkt 8) und Tore (🚦, Punkt 11): Was wartet auf dein ✅ oder ❌? */
class EntscheidungenTest {

    private val jetzt = 1_000 * MIN

    private fun auftrag(zustand: Zustand) = Auftrag(
        id = "T-0013", zustand = zustand, zustaendig = "claude-code", ziel = "MCP-Werkzeug", hop = 0, frist = null,
        hinweis = null, aktualisiert = 0, raumId = "!ag-claude-code", threadWurzel = "\$k13", ergebnis = "Patch",
        grenzen = emptyList(), budget = null, eltern = null, von = null,
    )

    /** Der Plan im Thread der Karte (vom Worker) und seine Kopie in der Lobby (vom Hub). */
    private fun plaene(eigeneAufKopie: Map<String, Long> = emptyMap()) = mapOf(
        "!ag-claude-code" to Verlauf(listOf(
            nachricht("\$p13", "❓ T-0013 · Claude Code\n📋 Plan\n1. Schema\n2. Werkzeug", zeit = jetzt - 4 * MIN,
                raum = "!ag-claude-code", von = CLAUDE, thread = "\$k13"),
        )),
        "!lobby" to Verlauf(listOf(
            nachricht("\$l6", "❓ Claude Code fragt zu T-0013:\n📋 Plan\n1. Schema\n2. Werkzeug", zeit = jetzt - 4 * MIN,
                raum = "!lobby", eigene = eigeneAufKopie),
        )),
    )

    @Test
    fun `Plan und Lobby-Kopie werden ein Auftrag, die Kopie ist als Kopie markiert`() {
        val e = Lebenslauf.entscheidungenLesen(plaene(), listOf(auftrag(Zustand.RUECKFRAGE)), jetzt)
        assertEquals(2, e.size)
        assertTrue(e.all { it.art == EntscheidungsArt.PLAN && it.auftragId == "T-0013" && it.offen })
        assertEquals(setOf("\$l6"), e.filter { it.kopie }.map { it.nachricht.eventId }.toSet())
    }

    @Test
    fun `Deine Reaktion auf die Kopie erledigt auch das Original`() {
        val e = Lebenslauf.entscheidungenLesen(plaene(mapOf("✅" to jetzt - MIN)), listOf(auftrag(Zustand.RUECKFRAGE)), jetzt)
        assertTrue(e.none { it.offen })
        assertTrue(e.all { it.meine == "✅" })
    }

    @Test
    fun `Plan wartet nicht mehr, wenn der Auftrag schon weiterlaeuft`() {
        val e = Lebenslauf.entscheidungenLesen(plaene(), listOf(auftrag(Zustand.IN_ARBEIT)), jetzt)
        assertTrue(e.none { it.offen })
    }

    @Test
    fun `Tor wartet, bis danach etwas vom Hub im Thread kommt, und hoechstens 24 h`() {
        val tor = nachricht("\$t", "🚦 Ablauf code-aenderung #3, Schritt 3 von 4 fertig (T-0014). Weiter? ✅ / ❌",
            zeit = jetzt - 5 * MIN, raum = "!lobby", thread = "\$l7")
        val offen = Lebenslauf.entscheidungenLesen(mapOf("!lobby" to Verlauf(listOf(tor))), emptyList(), jetzt).single()
        assertEquals(EntscheidungsArt.TOR, offen.art)
        assertEquals("code-aenderung #3", offen.ablauf)
        assertEquals("T-0014", offen.auftragId)
        assertTrue(offen.offen)

        val weiter = nachricht("\$w", "✅ Schritt 4 von 4: fertig", zeit = jetzt - MIN, raum = "!lobby", thread = "\$l7")
        val danach = Lebenslauf.entscheidungenLesen(mapOf("!lobby" to Verlauf(listOf(tor, weiter))), emptyList(), jetzt)
        assertFalse(danach.single().offen)

        val alt = Lebenslauf.entscheidungenLesen(mapOf("!lobby" to Verlauf(listOf(tor))), emptyList(), tor.zeit + 24 * 60 * MIN)
        assertFalse(alt.single().offen)
    }

    @Test
    fun `Ein Tor von jemand anderem als dem Schwarm ist keine Entscheidung`() {
        val falsch = nachricht("\$t", "🚦 Ablauf x, Weiter?", zeit = jetzt, raum = "!lobby", von = "@mallory:example.ch")
        assertTrue(Lebenslauf.entscheidungenLesen(mapOf("!lobby" to Verlauf(listOf(falsch))), emptyList(), jetzt).isEmpty())
    }
}
