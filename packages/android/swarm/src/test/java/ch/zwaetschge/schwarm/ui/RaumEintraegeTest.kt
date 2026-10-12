package com.claudewebui.swarm.ui

import com.claudewebui.swarm.VALE
import com.claudewebui.swarm.data.Agent
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.Raeume
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Vorschau
import com.claudewebui.swarm.data.VorschauArt
import com.claudewebui.swarm.data.Zugang
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Räume-Liste (App 2.4). In 2.3.0 stürzte die App mit echten Daten ab: Mehrere Melder teilen sich
 * #schwarm-alarme als Arbeitsraum, die LazyColumn bekam dieselbe Raum-ID zweimal als Schlüssel.
 */
class RaumEintraegeTest {

    private fun agent(id: String, name: String, raum: String?, modus: String = "worker") =
        Agent(id, name, "L2", "T2", modus, AgentStatus.ONLINE, raum, null, null, emptyList(), 1, null, "@_sw_$id:example.ch")

    private fun zustand(agenten: Map<String, String>, liste: List<Agent>) = SchwarmZustand(
        ich = VALE,
        raeume = Raeume(lobby = "!lobby", board = "!board", freigaben = "!freigaben", log = "!log", alarme = "!alarme", agenten = agenten),
        beigetreten = setOf("!lobby", "!board", "!freigaben", "!log", "!alarme", "!duo", "!ag-brian"),
        agenten = liste,
    )

    private fun eindeutig(e: List<RaumEintrag>) = assertEquals(e.map { it.raumId }.distinct(), e.map { it.raumId })

    @Test
    fun `Vorschau wie live - Melder im Alarmraum geben keine doppelten Schluessel`() {
        val z = Vorschau.zustand()
        val e = raumEintraege(z)
        eindeutig(e)
        val alarme = e.single { it.raumId == "!alarme" }
        assertEquals(RaumArt.SYSTEM, alarme.art)
        assertEquals(Kanal.ALARME, alarme.kanal)
        assertTrue("Melder bekommen keine eigene Agenten-Zeile", e.none { it.agentId in setOf("autoupdater", "trader", "sicherheit") })
        assertEquals(RaumArt.ALLGEMEIN, e.first().art)
        assertEquals(RaumArt.LOBBY, e[1].art)
        assertTrue(e.any { it.kanal == Kanal.FREIGABEN })
    }

    @Test
    fun `Gast sieht keine Freigaben und kein Allgemein, Schluessel bleiben eindeutig`() {
        val e = raumEintraege(Vorschau.zustand(VorschauArt(zugang = Zugang.GAST)))
        eindeutig(e)
        assertFalse(e.any { it.kanal == Kanal.FREIGABEN })
        assertFalse(e.any { it.art == RaumArt.ALLGEMEIN })
    }

    @Test
    fun `Teilen sich zwei Agenten einen Arbeitsraum, gibt es eine Zeile fuer beide`() {
        val z = zustand(
            mapOf("beta" to "!duo", "alpha" to "!duo", "brian" to "!ag-brian", "wache" to "!alarme", "irrlaeufer" to "!lobby"),
            listOf(agent("alpha", "Alpha", "!duo"), agent("beta", "Beta", "!duo"), agent("brian", "Brian", "!ag-brian", "native")),
        )
        val e = raumEintraege(z)
        eindeutig(e)
        val agenten = e.filter { it.art == RaumArt.AGENT }
        assertEquals(listOf("Beta · Alpha", "Brian"), agenten.map { it.titel })
        assertEquals("beta", agenten.first().agentId)
        assertEquals(RaumArt.LOBBY, e.single { it.raumId == "!lobby" }.art)
        assertEquals(listOf("!alarme", "!freigaben", "!board", "!log"), e.filter { it.art == RaumArt.SYSTEM }.map { it.raumId })
    }

    @Test
    fun `Kennt die App einen Agenten noch nicht, heisst seine Zeile ag-id`() {
        val e = raumEintraege(zustand(mapOf("neu" to "!ag-neu"), emptyList()))
        val zeile = e.single { it.raumId == "!ag-neu" }
        assertEquals("ag-neu", zeile.titel)
        assertFalse("noch nicht beigetreten", zeile.beigetreten)
    }
}
