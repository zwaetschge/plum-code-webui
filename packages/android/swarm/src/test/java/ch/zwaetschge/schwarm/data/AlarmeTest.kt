package com.claudewebui.swarm.data

import com.claudewebui.swarm.BETRIEB
import com.claudewebui.swarm.MIN
import com.claudewebui.swarm.nachricht
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Alarme (ADR-003 R4): Notice mit Fingerabdruck, Lebenslauf aus den Antworten im Thread. */
class AlarmeTest {

    private val paperless = "⚠️ paperless: unhealthy seit 3 min\n" +
        "Healthcheck: HTTP 502 von /api/\n" +
        "https://paperless.example.ch\n" +
        "docker-health:paperless · ✅ quittieren · 🔕 24 h stumm"

    private fun hubAlarm(name: String, fp: String) = "⚠️ $name: etwas stimmt nicht\nText\n$fp · ✅ quittieren · 🔕 24 h stumm"

    @Test
    fun `Notice einer Quelle - Stufe, Titel, Text, Link, Fingerabdruck`() {
        val a = Lebenslauf.alarmLesen(paperless, vomHub = false)
        assertNotNull(a)
        a!!
        assertEquals(AlarmStufe.WARN, a.stufe)
        assertNull("bei einem Puppet gehört „paperless: …“ zum Titel", a.name)
        assertEquals("paperless: unhealthy seit 3 min", a.titel)
        assertEquals("Healthcheck: HTTP 502 von /api/", a.text)
        assertEquals("https://paperless.example.ch", a.link)
        assertEquals("docker-health:paperless", a.fingerabdruck)
    }

    @Test
    fun `Notice des Hubs traegt den Namen vor dem Titel, altes schliessen gilt weiter`() {
        val a = Lebenslauf.alarmLesen(
            "🚨 hub: Hermes Phone ist nicht verbunden\nZuletzt gesehen 12:00.\nworker-weg:hermes-phone · ✅ schliessen · 🔕 24 h stumm",
            vomHub = true,
        )!!
        assertEquals(AlarmStufe.CRIT, a.stufe)
        assertEquals("hub", a.name)
        assertEquals("Hermes Phone ist nicht verbunden", a.titel)
        assertNull(a.link)
    }

    @Test
    fun `Ohne gueltige Fingerabdruck-Zeile ist es kein Alarm`() {
        assertNull(Lebenslauf.alarmLesen("ℹ️ Korrektur: 20 Alarme waren Fehlalarme\nDer Healthcheck lief während der Updates.", false))
        assertNull(Lebenslauf.alarmLesen("⚠️ nur eine Zeile · ✅ quittieren", false))
        assertNull(Lebenslauf.alarmLesen("⚠️ Titel\nkein fingerabdruck mit leerzeichen · ✅ quittieren", false))
        assertNull(Lebenslauf.alarmLesen("⚠️ Titel\n · ✅ quittieren", false))
    }

    @Test
    fun `Anstieg hebt die Stufe, senkt sie aber nie`() {
        val g = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$b", "⬆️ 🚨 jetzt crit: paperless: unhealthy seit 15 min\nNeustart half nicht.", zeit = 12 * MIN, von = BETRIEB, thread = "\$a"),
            nachricht("\$c", "⬆️ jetzt info: paperless: wieder langsam", zeit = 13 * MIN, von = BETRIEB, thread = "\$a"),
        ))
        val a = g.eintraege.single()
        assertEquals(AlarmStufe.CRIT, a.stufe)
        assertEquals(AlarmStufe.WARN, a.ersteStufe)
        assertEquals("paperless: wieder langsam", a.anstieg)
        assertEquals(AlarmZustand.OFFEN, a.zustand)
        assertEquals(13 * MIN, a.zuletzt)
    }

    @Test
    fun `Quittung des Hubs nennt behoben und ist trotzdem QUITTIERT - der erste Abschluss zaehlt`() {
        val g = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$q", "✅ quittiert von Vale · meldet sich erst wieder, wenn er behoben war oder schlimmer wird", zeit = 2 * MIN, thread = "\$a"),
            nachricht("\$b", "✅ behoben: paperless läuft wieder", zeit = 9 * MIN, von = BETRIEB, thread = "\$a"),
        ))
        val a = g.eintraege.single()
        assertEquals(AlarmZustand.QUITTIERT, a.zustand)
        assertEquals(2 * MIN, a.beendet)
        assertTrue(a.beendetText!!.startsWith("quittiert von Vale"))
    }

    @Test
    fun `Behebung, auch in der alten Form geschlossen von`() {
        val behoben = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$b", "✅ behoben: Disk 3: 78 % belegt", zeit = 5 * MIN, von = BETRIEB, thread = "\$a"),
        )).eintraege.single()
        assertEquals(AlarmZustand.BEHOBEN, behoben.zustand)
        assertEquals("behoben: Disk 3: 78 % belegt", behoben.beendetText)

        val geschlossen = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$q", "✅ geschlossen von Vale", zeit = MIN, thread = "\$a"),
        )).eintraege.single()
        assertEquals(AlarmZustand.QUITTIERT, geschlossen.zustand)
    }

    @Test
    fun `Stumm mit Stunden aus der Antwort, laut hebt es auf, Unsinn heisst 24 h`() {
        val stumm = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$s", "🔕 stumm bis 20:00 (8 h) · 🔔 hebt das auf", zeit = MIN, thread = "\$a"),
        )).eintraege.single()
        assertEquals(MIN + 8 * 60 * MIN, stumm.stummBis)
        assertTrue(stumm.stummUm(2 * MIN))
        assertFalse(stumm.stummUm(MIN + 8 * 60 * MIN))

        val unsinn = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$s", "🔕 stumm (500 h)", zeit = MIN, thread = "\$a"),
        )).eintraege.single()
        assertEquals(MIN + 24 * 60 * MIN, unsinn.stummBis)

        val laut = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$s", "🔕 stumm (8 h)", zeit = MIN, thread = "\$a"),
            nachricht("\$l", "🔔 wieder laut", zeit = 3 * MIN, thread = "\$a"),
        )).eintraege.single()
        assertNull(laut.stummBis)
        assertEquals(3 * MIN, laut.stummGeaendert)
    }

    @Test
    fun `Antworten Fremder im Thread aendern nichts`() {
        val g = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$x", "✅ behoben: stimmt gar nicht", zeit = MIN, von = "@mallory:example.ch", notice = false, thread = "\$a"),
        ))
        assertEquals(AlarmZustand.OFFEN, g.eintraege.single().zustand)
        assertTrue(g.nurLesen.isEmpty())
    }

    @Test
    fun `Nachzuegler ohne Thread gehoert zur offenen Notice derselben Quelle`() {
        val g = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB),
            nachricht("\$b", "✅ behoben: paperless läuft wieder", zeit = MIN, von = BETRIEB),
            nachricht("\$i", "ℹ️ Korrektur: das war ein Fehlalarm", zeit = 2 * MIN, von = BETRIEB),
        ))
        assertEquals(AlarmZustand.BEHOBEN, g.eintraege.single().zustand)
        assertEquals("nur die Korrektur bleibt zum Lesen", listOf("\$i"), g.nurLesen.map { it.eventId })
    }

    @Test
    fun `Nachzuegler des Hubs findet seine Notice am Namen, nicht an der Zeit`() {
        val g = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$phone", hubAlarm("hub", "worker-weg:hermes-phone"), zeit = 0),
            nachricht("\$backup", hubAlarm("backup", "backup:nacht"), zeit = MIN),
            nachricht("\$b", "✅ hub: behoben nach 10 min", zeit = 2 * MIN),
        ))
        val alle = g.eintraege.associateBy { it.eventId }
        assertEquals(AlarmZustand.BEHOBEN, alle.getValue("\$phone").zustand)
        assertEquals("Hub", alle.getValue("\$phone").quelle)
        assertEquals(AlarmZustand.OFFEN, alle.getValue("\$backup").zustand)
        assertEquals("backup", alle.getValue("\$backup").quelle)
    }

    @Test
    fun `Dein Quittieren ohne Antwort - erst wartet es, nach zwei Minuten gilt es`() {
        val a = Lebenslauf.alarmeLesen(listOf(
            nachricht("\$a", paperless, zeit = 0, von = BETRIEB, eigene = mapOf("✅️" to 10 * MIN)),
        )).eintraege.single()
        assertEquals(mapOf("✅" to 10 * MIN), a.meineReaktionen)
        assertTrue(a.offenUm(11 * MIN))
        assertTrue(a.wartetAuf("✅", 11 * MIN))
        assertEquals(AlarmZustand.QUITTIERT, a.zustandUm(10 * MIN + QUITTUNG_FRIST_MS))
        assertFalse(a.wartetAuf("✅", 10 * MIN + QUITTUNG_FRIST_MS))
    }
}
