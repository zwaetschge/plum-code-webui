package com.claudewebui.app.ui.screens.filemanager
import org.junit.Test
import org.junit.Assert.*
class EditorRevisionTest {
 @Test fun typingDuringSaveStaysUnsaved() {
  val current = FileEditorUiState(original = "original", draft = "B", isSaving = true)
  val result = current.acknowledgeSave("A")
  assertEquals("A", result.original); assertEquals("B", result.draft)
  assertTrue(result.hasChanges); assertFalse(result.isSaving)
 }
 @Test fun unchangedSentRevisionClearsDirtyState() {
  assertFalse(FileEditorUiState(draft = "A").acknowledgeSave("A").hasChanges)
 }
}
