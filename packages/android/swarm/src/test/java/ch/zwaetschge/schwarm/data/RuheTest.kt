package com.claudewebui.swarm.data

import com.claudewebui.swarm.HUB
import com.claudewebui.swarm.json
import com.claudewebui.swarm.data.matrix.Ereignis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** Ruhezeit (App 2.9): Zürcher Zeit, über Mitternacht, aus dem State-Event des Hubs. */
class RuheTest {
    private fun um(h: Int, m: Int = 0) = ZonedDateTime.of(2026, 9, 28, h, m, 0, 0, ZoneId.of("Europe/Zurich")).toInstant()

    @Test
    fun `Ueber Mitternacht - 22 bis 7 Uhr`() {
        val r = Ruhe(true, "22:00", "07:00")
        assertTrue(r.jetzt(um(23)))
        assertTrue(r.jetzt(um(3)))
        assertTrue(r.jetzt(um(22, 0)))
        assertFalse(r.jetzt(um(7, 0)))
        assertFalse(r.jetzt(um(12)))
    }

    @Test
    fun `Am Tag und ausgeschaltet`() {
        assertTrue(Ruhe(true, "12:00", "13:30").jetzt(um(13, 29)))
        assertFalse(Ruhe(true, "12:00", "13:30").jetzt(um(13, 30)))
        assertFalse(Ruhe(false, "22:00", "07:00").jetzt(um(23)))
        assertFalse(Ruhe(true, "08:00", "08:00").jetzt(um(8)))
    }

    @Test
    fun `Zeiten pruefen`() {
        assertEquals(22 * 60, Ruhe.minuten("22:00"))
        assertEquals(7 * 60, Ruhe.minuten("7"))
        assertNull(Ruhe.minuten("25:00"))
        assertNull(Ruhe.minuten("abc"))
    }

    @Test
    fun `HubLeser liest das Ruhe-Event, ungueltige Zeiten nicht`() {
        fun e(inhalt: String) = Ereignis(type = SCHWARM_RUHE, sender = HUB, content = json(inhalt), stateKey = "")
        val r = HubLeser.lesen(listOf(e("""{ "v": 1, "an": true, "von": "22:00", "bis": "07:00", "zone": "Europe/Zurich" }""")), HUB).ruhe
        assertEquals(Ruhe(true, "22:00", "07:00", "Europe/Zurich"), r)
        assertNull(HubLeser.lesen(listOf(e("""{ "v": 1, "an": true, "von": "26:00", "bis": "07:00" }""")), HUB).ruhe)
    }
}

/** LiteLLM-Event (App 2.10): Beträge in Cent, ungültige Modellnamen fallen weg. */
class LiteLlmTest {
    @Test
    fun `LiteLLM-Event lesen`() {
        val c = json("""{ "v": 1, "erreichbar": true, "ausgaben_cent": 1000, "budget_cent": 4000, "zeitraum": "30d", "zurueck": 1790000000000,
            "modelle": [ { "id": "ds/v4-pro", "anbieter": "DeepSeek" }, { "id": "böse modell" }, { "id": "mistral/large" } ] }""")
        val l = HubLeser.litellm(c)
        assertTrue(l.erreichbar)
        assertEquals(listOf("ds/v4-pro" to "DeepSeek", "mistral/large" to "LiteLLM"), l.modelle)
        assertEquals(0.25f, l.anteil!!, 0.001f)
        assertTrue(l.hat("mistral/large"))
        assertFalse(l.hat("gem/3.1-pro"))
    }
}
