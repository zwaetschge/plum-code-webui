package com.claudewebui.app.ui.components.common

/** Plain preview only: full chat still renders Markdown. */
fun plainTextPreview(text: String, limit: Int = 240): String = text
    .replace(Regex("```[\\s\\S]*?```"), " [code] ")
    .replace(Regex("!?\\[([^]]*)]\\([^)]*\\)"), "$1")
    .replace(Regex("(?m)^\\s{0,3}(?:#{1,6}|>|[-*+] )\\s*"), "")
    .replace("**", "").replace("__", "").replace("`", "")
    .replace(Regex("\\s+"), " ").trim().let { if (it.length > limit) it.take(limit - 1).trimEnd() + "…" else it }
