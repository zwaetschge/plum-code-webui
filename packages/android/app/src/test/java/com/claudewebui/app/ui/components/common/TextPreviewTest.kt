package com.claudewebui.app.ui.components.common
import org.junit.Test
import org.junit.Assert.*
class TextPreviewTest {
 @Test fun previewRemovesMarkupWithoutRemovingReadableLinkText() {
  assertEquals("Hello World link", plainTextPreview("# **Hello**\nWorld [link](https://example.com)"))
 }
 @Test fun boundedPreviewEndsWithEllipsis() {
  val preview = plainTextPreview("a".repeat(300), 80)
  assertEquals(80, preview.length); assertTrue(preview.endsWith("…"))
 }
}
