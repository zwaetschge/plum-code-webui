package com.claudewebui.swarm.data

import com.claudewebui.swarm.HUB
import com.claudewebui.swarm.VALE
import com.claudewebui.swarm.json
import com.claudewebui.swarm.data.matrix.Ereignis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime
import java.time.ZoneId

/** Die State-Events des Hubs in der Lobby: Nur der Hub zählt, ein unbekanntes `v` heisst „App aktualisieren“. */
class HubLeserTest {

    private fun e(typ: String, inhalt: String, key: String? = "", von: String = HUB) =
        Ereignis(type = typ, sender = von, content = json(inhalt), stateKey = key)

    private val notaus = """{ "v": 1, "url": "https://notaus.example.ch", "geraete": [ { "id": "ABCDEF0123", "name": "Fold" } ] }"""

    @Test
    fun `Nur Events des Hubs mit State-Key zaehlen`() {
        assertNotNull(HubLeser.lesen(listOf(e(SCHWARM_NOTAUS, notaus)), HUB).notaus)
        assertNull(HubLeser.lesen(listOf(e(SCHWARM_NOTAUS, notaus, von = "@mallory:example.ch")), HUB).notaus)
        assertNull(HubLeser.lesen(listOf(e(SCHWARM_NOTAUS, notaus, key = null)), HUB).notaus)
    }

    @Test
    fun `Unbekanntes v wird nicht gelesen, sondern als neuere Version gemeldet`() {
        val h = HubLeser.lesen(listOf(e(SCHWARM_ROUTINEN, """{ "v": 2, "routinen": [ { "name": "morgen" } ] }""")), HUB)
        assertNull(h.routinen)
        assertTrue(h.zuNeu(SCHWARM_ROUTINEN))
        assertFalse(h.zuNeu(SCHWARM_NOTAUS))
    }

    @Test
    fun `Not-Aus - nur https-Adresse, Geraete-ID klein und hexadezimal`() {
        val n = HubLeser.notaus(json("""{ "url": "http://unsicher.example.ch", "geraete": [
            { "id": "ABCDEF0123", "name": "" }, { "id": "kein-hex!", "name": "weg" } ] }"""))
        assertNull(n.url)
        assertEquals(listOf("abcdef0123"), n.geraete.map { it.id })
        assertEquals("abcdef01", n.geraete.single().name)
    }

    @Test
    fun `App-Update nur mit mxc und gueltigem version_code, Pruefsumme nur wenn sie passt`() {
        val gut = HubLeser.appRelease(json("""{ "mxc": "mxc://example.ch/abc", "version_code": "18", "sha256": "${"AB".repeat(32)}" }"""))!!
        assertEquals(18, gut.versionCode)
        assertEquals("18", gut.versionName)
        assertEquals("ab".repeat(32), gut.sha256)

        assertEquals("", HubLeser.appRelease(json("""{ "mxc": "mxc://example.ch/abc", "version_code": 18, "sha256": "zu-kurz" }"""))!!.sha256)
        assertNull(HubLeser.appRelease(json("""{ "mxc": "https://example.ch/app.apk", "version_code": 18 }""")))
        assertNull(HubLeser.appRelease(json("""{ "mxc": "mxc://example.ch/abc", "version_code": 0 }""")))
        assertNull(HubLeser.appRelease(json("""{ "mxc": "mxc://example.ch/abc" }""")))
    }

    @Test
    fun `Zeitpunkte als Millisekunden, Kommazahl oder ISO-Zeit`() {
        val t = HubLeser.tuersteher(json("""{ "aktualisiert": "2026-09-28T10:00:00Z", "sperren": [
            { "ip": "203.0.113.7", "seit": 1700000000000, "bis": "1700000000000.0" },
            { "ip": "<script>", "seit": 1 } ] }"""))
        assertEquals(java.time.Instant.parse("2026-09-28T10:00:00Z").toEpochMilli(), t.aktualisiert)
        assertEquals(listOf("203.0.113.7"), t.sperren.map { it.ip })
        assertEquals(1_700_000_000_000L, t.sperren.single().seit)
        assertEquals(1_700_000_000_000L, t.sperren.single().bis)
        assertEquals("gesperrt fehlt: Zahl der gültigen Sperren", 1, t.gesperrt)
    }

    private fun um(stunde: Int, minute: Int) =
        ZonedDateTime.of(2026, 9, 28, stunde, minute, 0, 0, ZoneId.of("Europe/Zurich")).toInstant()

    @Test
    fun `Ruhezeit ueber Mitternacht, Ende ausgeschlossen`() {
        val r = HubLeser.ruhe(json("""{ "an": true, "von": "22:00", "bis": "07:00" }"""))!!
        assertTrue(r.jetzt(um(23, 30)))
        assertTrue(r.jetzt(um(6, 59)))
        assertFalse(r.jetzt(um(7, 0)))
        assertFalse(r.jetzt(um(12, 0)))
        assertFalse(r.copy(an = false).jetzt(um(23, 30)))
        assertFalse("gleiche Zeiten heissen keine Ruhe", r.copy(bis = "22:00").jetzt(um(23, 30)))
        assertNull(HubLeser.ruhe(json("""{ "an": true, "von": "25:00", "bis": "07:00" }""")))
    }

    @Test
    fun `Rollen - Vale an der MXID, Gast nur mit Event, Nur-Vale-Befehle nie fuer Gaeste`() {
        val h = HubLeser.lesen(listOf(
            e(SCHWARM_ROLLEN, """{ "rolle": "gast", "agenten": ["brian"], "befehle": ["!Auftrag", "stop", " "] }""", key = "@vanessa:example.ch"),
        ), HUB)
        assertEquals(Rolle.VALE, Rolle.bestimmen(VALE, h, lobbyBeigetreten = true, lobbyEingeladen = false))

        val gast = Rolle.bestimmen("@vanessa:example.ch", h, lobbyBeigetreten = true, lobbyEingeladen = false)
        assertEquals(Zugang.GAST, gast.zugang)
        assertEquals(listOf("auftrag", "stop"), gast.gast!!.befehle)
        assertTrue(gast.darf("auftrag"))
        assertFalse("stop bleibt Vale vorbehalten, auch wenn das Event es nennt", gast.darf("stop"))
        assertTrue(gast.darfAuftragAn("brian"))
        assertFalse(gast.darfAuftragAn("claude-code"))
        assertFalse(gast.entscheidet)

        assertEquals(Zugang.KEIN_ZUGANG, Rolle.bestimmen("@besuch:example.ch", h, lobbyBeigetreten = true, lobbyEingeladen = false).zugang)
        assertEquals(Zugang.PRUEFT, Rolle.bestimmen("@besuch:example.ch", h, lobbyBeigetreten = false, lobbyEingeladen = true).zugang)
    }
}
