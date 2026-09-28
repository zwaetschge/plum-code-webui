package com.claudewebui.app.core.updates
import org.junit.Test
import org.junit.Assert.*
class DownloadProgressTest {
 @Test fun unknownSizeIsIndeterminate() { assertEquals(-1, DownloadSnapshot(1, 20, -1, 0).progress) }
 @Test fun progressUsesRealByteCountAndIsBounded() {
  assertEquals(50, DownloadSnapshot(1, 50, 100, 0).progress)
  assertEquals(100, DownloadSnapshot(1, 200, 100, 0).progress)
  assertEquals(0, DownloadSnapshot(1, -1, 100, 0).progress)
 }
}
