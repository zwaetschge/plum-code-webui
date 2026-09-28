package com.claudewebui.app.ui.screens.notes
import com.claudewebui.app.data.model.Note
import org.junit.Test
import org.junit.Assert.*
class NotesRevisionTest {
 @Test fun failedClosePreservesDraftAndError() {
  val draft = NotesUiState(editingId = "__new__", draftContent = "Keep me", isDirty = true, error = "offline")
  assertEquals(draft, draft.closeAfterSave(false))
  assertEquals(draft, draft.closeAfterSave(true))
  assertNull(draft.copy(isDirty = false).closeAfterSave(true).editingId)
 }
 @Test fun creationAcknowledgesIdWithoutLosingLaterKeystrokes() {
  val sent = NotesUiState(editingId = "__new__", draftTitle = "Title", draftContent = "A", isDirty = true)
  val current = sent.copy(draftContent = "B", isSaving = true)
  val result = current.acknowledgeNoteSave(sent, Note("server-id", title = "Title", content = "A"))
  assertEquals("server-id", result.editingId); assertEquals("B", result.draftContent)
  assertTrue(result.isDirty); assertEquals("A", result.savedContent)
 }
 @Test fun unchangedTextIsConfirmedAndDoesNotDuplicateTheNote() {
  val sent = NotesUiState(editingId = "note", draftContent = "A", isDirty = true, notes = listOf(Note("note", content = "old")))
  val result = sent.acknowledgeNoteSave(sent, Note("note", content = "A"))
  assertFalse(result.isDirty); assertEquals(1, result.notes.size)
 }
}
