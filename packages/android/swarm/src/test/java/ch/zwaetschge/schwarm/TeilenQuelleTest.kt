package com.claudewebui.swarm

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Die exportierte Teilen-Activity liest nur `content://` fremder Apps. */
class TeilenQuelleTest {
    private val ich = "com.claudewebui.app.debug"

    @Test
    fun `content von einer fremden App ist erlaubt`() {
        assertTrue(geteiltesBildErlaubt("content", "com.google.android.apps.photos.contentprovider", "com.google.android.apps.photos", ich))
        assertTrue(geteiltesBildErlaubt("content", "media", null, ich))
        assertTrue(geteiltesBildErlaubt("CONTENT", "media", "com.android.providers.media.module", ich))
    }

    @Test
    fun `file und andere Schemata werden abgelehnt`() {
        assertFalse(geteiltesBildErlaubt("file", null, null, ich))
        assertFalse(geteiltesBildErlaubt("file", "", null, ich))
        assertFalse(geteiltesBildErlaubt("http", "example.com", null, ich))
        assertFalse(geteiltesBildErlaubt(null, "media", null, ich))
        assertFalse(geteiltesBildErlaubt("content", null, null, ich))
    }

    @Test
    fun `eigene Provider werden abgelehnt`() {
        assertFalse(geteiltesBildErlaubt("content", "$ich.dateien", ich, ich))
        assertFalse(geteiltesBildErlaubt("content", "$ich.provider", null, ich))
        assertFalse(geteiltesBildErlaubt("content", ich, null, ich))
        assertFalse(geteiltesBildErlaubt("content", "media;$ich.dateien", null, ich))
        // Fremde Authority, die aber zu einem Provider der App aufgelöst wird.
        assertFalse(geteiltesBildErlaubt("content", "unverdaechtig", ich, ich))
    }

    @Test
    fun `aehnlich benannte fremde Pakete bleiben erlaubt`() {
        assertTrue(geteiltesBildErlaubt("content", "$ich-andere.provider", "$ich-andere", ich))
    }
}
