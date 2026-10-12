package com.claudewebui.swarm.data

import com.claudewebui.swarm.MIN
import com.claudewebui.swarm.nachricht
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Freigaben (ADR-003 R1): Notice des Hubs in #schwarm-freigaben, Quittung im Thread, deine Reaktion. */
class FreigabenTest {

    private fun notice(id: String, frist: String = "Läuft ab: 14:32 (nach 30 min)") =
        "🔐 Freigabe nötig · $id · T2-Agent\n" +
            "Kette: Vale → Brian → Codex (Host)\n" +
            "Was: docker.restart immich\n" +
            "  hängt seit dem Update\n" +
            "Ergebnis: Container läuft wieder\n" +
            "Grenzen: keine\n" +
            "$frist\n" +
            "✅ auf diese Nachricht gibt frei, ❌ lehnt ab. Es zählt nur deine Reaktion (§7.3)."

    @Test
    fun `Notice liest alle Felder, mehrzeiliges Was und das Ziel der Kette`() {
        val f = Lebenslauf.freigabeLesen(notice("T-0042", "Läuft ab: 14:32 (nach 45 min)"))
        assertNotNull(f)
        f!!
        assertEquals("T-0042", f.auftragId)
        assertEquals("T2", f.stufe)
        assertEquals("Vale → Brian → Codex (Host)", f.kette)
        assertEquals("Codex (Host)", f.ziel)
        assertEquals("docker.restart immich\n  hängt seit dem Update", f.was)
        assertEquals("Container läuft wieder", f.ergebnis)
        assertEquals("keine", f.grenzen)
        assertEquals(45, f.fristMin)
    }

    @Test
    fun `Frist fehlt oder ist unsinnig - dann gilt die Frist des Hubs`() {
        assertEquals(FREIGABE_FRIST_MIN, Lebenslauf.freigabeLesen(notice("T-1", "Läuft ab: bald"))!!.fristMin)
        assertEquals(FREIGABE_FRIST_MIN, Lebenslauf.freigabeLesen(notice("T-1", "Läuft ab: 14:32 (nach 0 min)"))!!.fristMin)
        assertEquals(FREIGABE_FRIST_MIN, Lebenslauf.freigabeLesen(notice("T-1", "Läuft ab: 14:32 (nach 5000 min)"))!!.fristMin)
    }

    @Test
    fun `Kopf mit Emoji-Variantenwaehler zaehlt, fremder Kopf nicht`() {
        assertEquals("T-7", Lebenslauf.freigabeLesen("🔐️ Freigabe nötig · T-7\nKette: Vale → Brian")?.auftragId)
        assertNull(Lebenslauf.freigabeLesen("🔐 T-0011: Brian möchte Claude Code beauftragen."))
        assertNull(Lebenslauf.freigabeLesen(""))
    }

    @Test
    fun `Quittungen - freigegeben, abgelehnt, abgelaufen, sonst nichts`() {
        assertEquals(FreigabeZustand.FREIGEGEBEN to "T-0042", Lebenslauf.quittungLesen("✅ freigegeben · T-0042"))
        assertEquals(FreigabeZustand.ABGELEHNT to "T-1", Lebenslauf.quittungLesen("❌️ abgelehnt · T-1"))
        assertEquals(FreigabeZustand.ABGELAUFEN to "T-0005", Lebenslauf.quittungLesen("⌛ abgelaufen nach 30 min · T-0005"))
        assertNull(Lebenslauf.quittungLesen("✅ freigegeben · T-0042 und noch mehr"))
        assertNull(Lebenslauf.quittungLesen("✅ Schritt 1/4: T-0014 fertig"))
    }

    @Test
    fun `Die erste Quittung im Thread entscheidet, wie im Hub`() {
        val g = Lebenslauf.freigabenLesen(listOf(
            nachricht("\$f", notice("T-0042"), zeit = 0),
            nachricht("\$q1", "✅ freigegeben · T-0042", zeit = 2 * MIN, thread = "\$f"),
            nachricht("\$q2", "❌ abgelehnt · T-0042", zeit = 3 * MIN, thread = "\$f"),
        ))
        val f = g.eintraege.single()
        assertEquals(FreigabeZustand.FREIGEGEBEN, f.zustand)
        assertEquals(2 * MIN, f.quittiert)
        assertEquals(30 * MIN, f.ablauf)
        assertTrue(g.nurLesen.isEmpty())
    }

    @Test
    fun `Quittung ohne Thread gehoert zur letzten Notice derselben Nummer davor`() {
        val g = Lebenslauf.freigabenLesen(listOf(
            nachricht("\$alt", notice("T-0050"), zeit = 0),
            nachricht("\$neu", notice("T-0050"), zeit = 10 * MIN),
            nachricht("\$q", "❌ abgelehnt · T-0050", zeit = 12 * MIN),
        ))
        val (neu, alt) = g.eintraege // neueste zuerst
        assertEquals("\$neu", neu.eventId)
        assertEquals(FreigabeZustand.ABGELEHNT, neu.zustand)
        assertEquals(FreigabeZustand.OFFEN, alt.zustand)
        assertTrue("die verbrauchte Quittung ist keine Nur-lesen-Notice", g.nurLesen.isEmpty())
    }

    @Test
    fun `Notices und Quittungen zaehlen nur vom Hub`() {
        val g = Lebenslauf.freigabenLesen(listOf(
            nachricht("\$echt", notice("T-0060"), zeit = 0),
            nachricht("\$falsch", notice("T-0061"), zeit = MIN, von = "@mallory:example.ch", notice = false),
            nachricht("\$q", "✅ freigegeben · T-0060", zeit = 2 * MIN, thread = "\$echt", von = "@mallory:example.ch"),
        ))
        val f = g.eintraege.single()
        assertEquals("T-0060", f.auftragId)
        assertEquals(FreigabeZustand.OFFEN, f.zustand)
        assertEquals(listOf("\$falsch"), g.nurLesen.map { it.eventId })
    }

    @Test
    fun `Deine Reaktion ohne Variantenwaehler, Ablauf nach der Frist`() {
        val f = Lebenslauf.freigabenLesen(listOf(
            nachricht("\$f", notice("T-0070"), zeit = 0, eigene = mapOf("✅️" to MIN)),
        )).eintraege.single()
        assertEquals("✅", f.meineReaktion)
        assertTrue(f.offenUm(29 * MIN))
        assertFalse("mit deiner Reaktion zählt sie nicht mehr im Abzeichen", f.brauchtDichUm(29 * MIN))
        assertEquals(FreigabeZustand.ABGELAUFEN, f.zustandUm(30 * MIN))
    }
}
