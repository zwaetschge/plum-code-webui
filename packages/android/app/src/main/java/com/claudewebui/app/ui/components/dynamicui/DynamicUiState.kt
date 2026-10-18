package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.Saver
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Dirty inputs shared by every revision of a view within one conversation. */
class DynamicUiStateStore {
    var edits by mutableStateOf<Map<String, Map<String, Any?>>>(emptyMap())
        private set

    fun set(view: String, key: String, value: Any?) { edits = edits + (view to (edits[view].orEmpty() + (key to value))) }
    fun reset(view: String) { edits = edits + (view to emptyMap()) }

    companion object {
        val StateSaver = Saver<DynamicUiStateStore, String>(
            save = { store -> JsonObject(store.edits.mapValues { (_, fields) -> JsonObject(fields.mapValues { uiValueToJson(it.value) }) }).toString() },
            restore = { text -> DynamicUiStateStore().apply {
                val parsed = runCatching { Json.parseToJsonElement(text) as JsonObject }.getOrNull()
                edits = parsed?.mapValues { (_, fields) -> (fields as? JsonObject)?.mapValues { uiValueOf(it.value) }.orEmpty() }.orEmpty()
            } },
        )
    }
}

fun mergeDynamicUiState(defaults: Map<String, Any?>, edits: Map<String, Any?>): Map<String, Any?> = defaults.mapValues { (key, value) ->
    val edited = edits[key]
    if (edits.containsKey(key) && (value == null || edited == null || (value is Number && edited is Number) || value.javaClass == edited.javaClass)) edited else value
}
