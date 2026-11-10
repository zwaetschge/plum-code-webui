package com.claudewebui.app.ui.components.dynamicui

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.Saver
import androidx.compose.ui.platform.LocalContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/** Dirty inputs shared by every revision of a view within one conversation. */
class DynamicUiStateStore {
    var edits by mutableStateOf<Map<String, Map<String, Any?>>>(emptyMap())
        private set

    fun set(view: String, key: String, value: Any?) { edits = edits + (view to (edits[view].orEmpty() + (key to value))) }
    fun reset(view: String) { edits = edits + (view to emptyMap()) }

    /** Starts a view from persisted edits unless it already has its own. */
    fun seed(view: String, fields: Map<String, Any?>) { if (!edits.containsKey(view)) edits = edits + (view to fields) }

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

/**
 * Per-message state of Dynamic UI components (checklist ticks, quiz answers,
 * flashcard progress, edited inputs), kept on the device under
 * `turnId:nodeId` — the Android counterpart of the WebUI's localStorage. A
 * small SharedPreferences file; the oldest entries are pruned past a cap.
 */
internal object DynamicUiMemory {
    private const val PREFS = "plum_dynamic_ui"
    private const val MAX_ENTRIES = 600

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs != null) return
        synchronized(this) {
            if (prefs == null) prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        }
    }

    fun read(key: String): JsonObject? {
        val text = prefs?.getString(key, null) ?: return null
        return runCatching { (Json.parseToJsonElement(text) as JsonObject)["v"] as? JsonObject }.getOrNull()
    }

    fun write(key: String, value: JsonObject?) {
        val store = prefs ?: return
        val editor = store.edit()
        if (value == null) editor.remove(key)
        else editor.putString(key, JsonObject(mapOf("t" to JsonPrimitive(System.currentTimeMillis()), "v" to value)).toString())
        editor.apply()
        if (value != null && store.all.size > MAX_ENTRIES) prune(store)
    }

    private fun prune(store: SharedPreferences) {
        val stamped = store.all.mapNotNull { (key, raw) ->
            val stamp = (raw as? String)?.let { text ->
                runCatching { ((Json.parseToJsonElement(text) as JsonObject)["t"] as? JsonPrimitive)?.longOrNull }.getOrNull()
            } ?: 0L
            key to stamp
        }.sortedBy { it.second }
        val editor = store.edit()
        stamped.take((stamped.size - MAX_ENTRIES * 3 / 4).coerceAtLeast(0)).forEach { editor.remove(it.first) }
        editor.apply()
    }

    /** Edited inputs of a view (all revisions share the view ID). */
    fun readState(view: String): Map<String, Any?>? = read("$view:state")?.mapValues { uiValueOf(it.value) }

    fun writeState(view: String, edits: Map<String, Any?>) = write("$view:state", JsonObject(edits.mapValues { uiValueToJson(it.value) }))
}

/** One stateful component's persisted JSON; [update] writes through. */
internal class DuiMemory(private val key: String?, initial: JsonObject) {
    var value by mutableStateOf(initial)
        private set

    fun update(next: JsonObject) {
        value = next
        key?.let { DynamicUiMemory.write(it, next) }
    }

    fun clear() {
        value = JsonObject(emptyMap())
        key?.let { DynamicUiMemory.write(it, null) }
    }
}

/** State of node [nodeId] in message [memoryKey]; in memory only without a key. */
@Composable
internal fun rememberDuiMemory(memoryKey: String?, nodeId: String?): DuiMemory {
    val context = LocalContext.current
    val key = if (memoryKey != null && nodeId != null) "$memoryKey:$nodeId" else null
    return remember(key) {
        DynamicUiMemory.init(context)
        DuiMemory(key, key?.let { DynamicUiMemory.read(it) } ?: JsonObject(emptyMap()))
    }
}
