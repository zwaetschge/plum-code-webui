package com.claudewebui.swarm.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** Die Ausgabe von docker.list, wie der Worker betrieb sie schickt (T-0051 vom 28.09.). */
class BetriebTest {
    @Test
    fun `Kopfzeile faellt weg, Tabs trennen die Spalten`() {
        val aus = "2 Container (Filter: council-matrix)\n" +
            "council-matrix\trunning\tUp 17 seconds (healthy)\tsha256:1e11\n" +
            "council-matrix.vor-20260928-201118z\texited\tExited (0) 18 seconds ago\tsha256:fb23"
        val l = containerLesen(aus)
        assertEquals(2, l.size)
        assertEquals(ContainerZeile("council-matrix", "running", "Up 17 seconds (healthy)"), l[0])
        assertEquals("exited", l[1].zustand)
    }

    @Test
    fun `Kein Container - leere Liste`() {
        assertEquals(emptyList<ContainerZeile>(), containerLesen("Kein Container passt zu \"xyz\""))
    }
}
