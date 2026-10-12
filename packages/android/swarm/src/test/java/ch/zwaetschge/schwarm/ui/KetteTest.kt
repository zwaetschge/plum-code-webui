package com.claudewebui.swarm.ui

import com.claudewebui.swarm.data.Auftrag
import com.claudewebui.swarm.data.Zustand
import org.junit.Assert.assertEquals
import org.junit.Test

/** Die Kette als Baum im Board (App 2.9). */
class KetteTest {
    private fun t(id: String, eltern: String? = null) = Auftrag(
        id = id, zustand = Zustand.IN_ARBEIT, zustaendig = "brian", ziel = id, hop = null, frist = null, hinweis = null,
        aktualisiert = 0, raumId = null, threadWurzel = null, ergebnis = null, grenzen = emptyList(), budget = null,
        eltern = eltern, von = null,
    )

    @Test
    fun `Kinder stehen eingerueckt unter den Eltern, nach Nummer`() {
        val k = kette(listOf(t("T-0010"), t("T-0013", "T-0010"), t("T-0011", "T-0010"), t("T-0012", "T-0011"), t("T-0009")))
        assertEquals(listOf("T-0010" to 0, "T-0011" to 1, "T-0012" to 2, "T-0013" to 1, "T-0009" to 0), k.map { it.first.id to it.second })
    }

    @Test
    fun `Eltern nicht in der Liste - das Kind ist eine Wurzel`() {
        assertEquals(listOf("T-0020" to 0), kette(listOf(t("T-0020", "T-0001"))).map { it.first.id to it.second })
    }

    @Test
    fun `Ein Kreis verschluckt keinen Auftrag`() {
        assertEquals(2, kette(listOf(t("T-0001", "T-0002"), t("T-0002", "T-0001"))).size)
    }
}
