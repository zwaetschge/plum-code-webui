package com.claudewebui.app.ui.theme
import org.junit.Test
import org.junit.Assert.*
class OverlayContrastTest {
 @Test fun overlayFallbackIsOpaqueAndBothTextRolesMeetAA() {
  for (palette in listOf(PlumDarkPalette, PlumLightPalette, PlumEinkPalette)) {
   val surface = plumTokensFor(palette, false).surfaces.overlay
   assertEquals(1f, surface.opaqueFallback.alpha, 0.001f)
   assertTrue(contrastRatio(surface.foreground, surface.opaqueFallback) >= 4.5f)
   assertTrue(contrastRatio(surface.foregroundMuted, surface.opaqueFallback) >= 4.5f)
  }
 }
}
