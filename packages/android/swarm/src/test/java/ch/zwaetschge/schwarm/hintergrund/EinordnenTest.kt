package com.claudewebui.swarm.hintergrund

import com.claudewebui.swarm.VALE
import com.claudewebui.swarm.json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Welche neue Nachricht im Hintergrund wie gemeldet wird (PruefArbeit → einordnen). */
class EinordnenTest {

    private val leer = json("{}")

    private fun ordne(art: String, body: String, vomHub: Boolean = true, inhalt: String = "{}", raum: String? = "!lobby", eventId: String? = "\$neu") =
        einordnen(art, vomHub, body, json(inhalt), VALE, raum, eventId)

    @Test
    fun `Alarme - kritisch und Warnung laut, deine eigenen Quittungen still`() {
        assertEquals(Hintergrund.ALARME to "Alarm", ordne("alarme", "🚨 backup: seit 2 Tagen keins\n…").let { it!!.kanal to it.titel })
        assertEquals(Hintergrund.ALARME to "Warnung", ordne("alarme", "⚠️ paperless: unhealthy").let { it!!.kanal to it.titel })
        assertNull(ordne("alarme", "✅ quittiert von Vale · meldet sich erst wieder, wenn er behoben war"))
        assertNull(ordne("alarme", "✅ geschlossen von Vale"))
        assertNull(ordne("alarme", "🔕 stumm bis 20:00 (24 h) · 🔔 hebt das auf"))
        assertNull(ordne("alarme", "🔔 wieder laut"))
        assertEquals(Hintergrund.UEBERSICHT, ordne("alarme", "✅ behoben: paperless läuft wieder")!!.kanal)
    }

    @Test
    fun `Freigaben meldet PruefArbeit selbst`() {
        assertNull(ordne("freigaben", "🔐 Freigabe nötig · T-0042 · T2-Agent"))
    }

    @Test
    fun `Lobby - nur der Hub zaehlt, Rueckfrage bekommt ein Antwortfeld im eigenen Thread`() {
        assertNull(ordne("lobby", "❓ T-0012 · Brian fragt: Schweiz oder EU?", vomHub = false))
        val m = ordne("lobby", "❓ T-0012 · Brian fragt: Schweiz oder EU?")!!
        assertEquals(Hintergrund.WARTET, m.kanal)
        assertEquals("Rückfrage an dich", m.titel)
        assertEquals(Triple("!lobby", "\$neu", "\$neu"), Triple(m.raum, m.thread, m.event))
    }

    @Test
    fun `Plan im Thread - Antwort geht an den Anfang des Threads`() {
        val m = ordne("lobby", "❓ T-0013 · Claude Code\n📋 Plan …",
            inhalt = """{ "m.relates_to": { "rel_type": "m.thread", "event_id": "${'$'}k13" } }""")!!
        assertEquals("Plan wartet auf dich", m.titel)
        assertEquals("\$k13", m.thread)
        assertEquals("\$neu", m.event)
    }

    @Test
    fun `Ohne Matrix-Event-ID kein Antwortfeld`() {
        val m = ordne("lobby", "❓ T-0012 · Brian fragt", eventId = "lokal-1")!!
        assertNull(m.raum)
        assertNull(m.thread)
    }

    @Test
    fun `Lobby - Tor, Freigabe, Ergebnisse, Uebersicht und Bericht, der Rest still`() {
        assertEquals(Hintergrund.WARTET to "Ablauf wartet auf dich", ordne("lobby", "🚦 Ablauf code-aenderung #3 …").let { it!!.kanal to it.titel })
        assertEquals(Hintergrund.FREIGABEN, ordne("lobby", "🔐 T-0011: Brian möchte Claude Code beauftragen.")!!.kanal)
        for (erste in listOf("✅ T-0014 fertig", "❌ T-0008 fehlgeschlagen", "↩️ T-0009 zurück", "🚫 T-0010 abgelehnt")) {
            val m = ordne("lobby", "$erste\nDetails")!!
            assertEquals(erste, Hintergrund.ERGEBNISSE, m.kanal)
            assertEquals(erste, m.titel)
        }
        val lang = "☀️ Guten Morgen\n" + "x".repeat(1000)
        assertEquals(700, ordne("lobby", lang)!!.text.length)
        assertEquals("Tagesbericht", ordne("lobby", "🌙 Der Tag in Zahlen")!!.titel)
        assertNull(ordne("lobby", "📥 T-0010 → Brian · Warum war das Backup so klein?"))
    }

    @Test
    fun `Arbeitsraum meldet nur, wenn du erwaehnt bist, Text hoechstens 400 Zeichen`() {
        val erwaehnt = """{ "m.mentions": { "user_ids": ["$VALE"] } }"""
        val m = ordne("Brian", "Soll ich?" + "x".repeat(600), inhalt = erwaehnt, raum = "!ag-brian")!!
        assertEquals(Hintergrund.WARTET, m.kanal)
        assertEquals("Brian fragt dich", m.titel)
        assertEquals(400, m.text.length)
        assertEquals("!ag-brian", m.raum)
        assertNull(ordne("Brian", "Soll ich?", inhalt = """{ "m.mentions": { "user_ids": ["@jemand:example.ch"] } }"""))
        assertNull(einordnen("Brian", false, "Soll ich?", leer, VALE))
    }
}
