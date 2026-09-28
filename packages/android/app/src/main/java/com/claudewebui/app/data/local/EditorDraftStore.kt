package com.claudewebui.app.data.local

import android.content.Context
import com.claudewebui.app.core.security.TokenStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest

@Serializable
data class EditorDraft(val id: String, val title: String = "", val content: String, val baseline: String = "")

/** Local recovery only, scoped to the server and signed-in account. Never automatically uploads a restored draft. */
class EditorDraftStore(context: Context) {
    private val prefs = context.getSharedPreferences("editor_recovery", Context.MODE_PRIVATE)
    private val account = "${TokenStore.getServerUrl()}|${TokenStore.getUserId()}"
    private val json = Json { ignoreUnknownKeys = true }
    private fun key(scope: String) = MessageDigest.getInstance("SHA-256")
        .digest("$account|$scope".toByteArray()).joinToString("") { "%02x".format(it) }
    fun read(scope: String): EditorDraft? = prefs.getString(key(scope), null)?.let {
        runCatching { json.decodeFromString<EditorDraft>(it) }.getOrNull()
    }
    fun write(scope: String, draft: EditorDraft) {
        prefs.edit().putString(key(scope), json.encodeToString(draft)).apply()
    }
    fun clear(scope: String) { prefs.edit().remove(key(scope)).apply() }
}
