package com.claudewebui.app.ui.screens.settings

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.ApiHttpException
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantApiProvider
import com.claudewebui.app.data.model.AssistantPersonalization
import com.claudewebui.app.data.model.StyleLibrary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * The newest personalization this process has saved or loaded, per account.
 * The model chat listens so a voice picked in the settings is used for the
 * very next read-aloud instead of after its periodic refresh.
 */
object AssistantPersonalizationEvents {
    private val _latest = MutableStateFlow<Pair<String, AssistantPersonalization>?>(null)
    val latest: StateFlow<Pair<String, AssistantPersonalization>?> = _latest.asStateFlow()
    fun publish(owner: String, value: AssistantPersonalization) { _latest.value = owner to value }
}

/**
 * Immediate-apply editing of the assistant personalization, like the system
 * settings app: toggles and pickers save at once, text saves debounced or when
 * the field loses focus. Changes are sent as partial updates against the last
 * known revision; a revision conflict reloads the server state and reports it,
 * any other failure reverts to the server state with the error.
 *
 * Saves run in the controller's own scope so a debounced edit still reaches
 * the server when the page is left before the debounce fires.
 */
@Stable
class AssistantSettingsController internal constructor(
    val owner: String,
    private val api: ApiClient,
    private val context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }
    private val mutex = Mutex()
    private val pending = LinkedHashMap<String, JsonElement>()
    private var server: AssistantPersonalization? = null
    private var debounce: Job? = null
    private var loadJob: Job? = null

    var value by mutableStateOf<AssistantPersonalization?>(null)
        private set
    var providers by mutableStateOf<List<AssistantApiProvider>>(emptyList())
        private set
    var styleLibrary by mutableStateOf(StyleLibrary())
        private set
    /** Every chat model of every connected provider (`?all=1`); null until loaded. */
    var allChatProviders by mutableStateOf<List<AssistantApiProvider>?>(null)
        private set
    private var chatProvidersJob: Job? = null
    var loading by mutableStateOf(false)
        private set
    var saving by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)

    private fun owns() = TokenStore.assistantOwnerKey() == owner
    private fun checkOwner() { if (!owns()) throw CancellationException("Assistant account changed") }

    fun load() {
        loadJob?.cancel()
        loadJob = scope.launch {
            loading = true
            error = null
            try {
                val response = api.getAssistantPersonalization(); checkOwner()
                check(response.success) { response.error?.message ?: context.getString(R.string.assistant_load_failed) }
                val data = requireNotNull(response.data)
                server = data
                value = overlay(data)
                AssistantPersonalizationEvents.publish(owner, data)
                runCatching { api.getStyleLibrary() }.getOrNull()?.data?.let { checkOwner(); styleLibrary = it }
                runCatching { api.getAssistantApiProviders() }.getOrNull()?.takeIf { it.success }?.let { models ->
                    checkOwner()
                    val rank = mapOf("anthropic" to 0, "mistral" to 1, "deepseek" to 2, "z-ai" to 3, "zai" to 3)
                    providers = models.data.orEmpty().filter { it.models.isNotEmpty() }.sortedBy { rank[it.id] ?: 4 }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (owns()) error = failure.message ?: context.getString(R.string.assistant_load_failed)
            } finally {
                if (owns()) loading = false
            }
        }
    }

    /** Loads once; later calls only refresh when nothing is loaded yet. */
    fun ensureLoaded() { if (value == null && !loading) load() }

    fun setBoolean(field: String, checked: Boolean) = set(field, JsonPrimitive(checked), immediate = true)
    fun setChoice(field: String, choice: String) = set(field, JsonPrimitive(choice), immediate = true)
    fun setText(field: String, text: String) = set(field, JsonPrimitive(text), immediate = false)
    fun setList(field: String, values: List<String>) = set(field, JsonArray(values.map(::JsonPrimitive)), immediate = true)

    /** Loads the full chat model catalog once per controller (the menu picker needs every model). */
    fun loadAllChatProviders() {
        if (allChatProviders != null || chatProvidersJob?.isActive == true) return
        chatProvidersJob = scope.launch {
            try {
                val response = api.getAllAssistantApiProviders(); checkOwner()
                check(response.success) { response.error?.message ?: context.getString(R.string.assistant_load_failed) }
                allChatProviders = response.data.orEmpty().filter { it.models.isNotEmpty() }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (owns()) {
                    allChatProviders = emptyList()
                    error = failure.message ?: context.getString(R.string.assistant_load_failed)
                }
            }
        }
    }

    /** Several fields that belong together (provider + model) in one revision. */
    fun setChoices(vararg fields: Pair<String, String>) {
        if (value == null) return
        fields.forEach { (key, choice) -> pending[key] = JsonPrimitive(choice) }
        server?.let { value = overlay(it) }
        flush()
    }

    private fun set(field: String, element: JsonElement, immediate: Boolean) {
        val base = server ?: return
        pending[field] = element
        value = overlay(base)
        debounce?.cancel()
        if (immediate) flush() else debounce = scope.launch { delay(700); flush() }
    }

    /** Sends whatever is pending now (focus left the field, page closed). */
    fun flush() {
        debounce?.cancel(); debounce = null
        if (pending.isEmpty()) return
        scope.launch { save() }
    }

    private suspend fun save() {
        mutex.withLock {
            val base = server ?: return
            if (pending.isEmpty()) return
            val batch = LinkedHashMap(pending)
            saving = true
            try {
                val payload = buildJsonObject {
                    put("expectedRevision", base.revision)
                    put("preferences", JsonObject(batch))
                }
                val response = api.updateAssistantPersonalization(owner, payload); checkOwner()
                check(response.success) { response.error?.message ?: context.getString(R.string.assistant_save_failed) }
                val next = requireNotNull(response.data)
                server = next
                batch.forEach { (key, sent) -> if (pending[key] == sent) pending.remove(key) }
                value = overlay(next)
                error = null
                AssistantPersonalizationEvents.publish(owner, next)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (conflict: ApiHttpException) {
                if (!owns()) return
                pending.clear()
                value = server
                error = conflict.message ?: context.getString(R.string.assistant_save_failed)
                if (conflict.status == 409) reloadAfterConflict()
            } catch (failure: Exception) {
                if (!owns()) return
                pending.clear()
                value = server
                error = failure.message ?: context.getString(R.string.assistant_save_failed)
            } finally {
                saving = false
            }
        }
        // Edits made while the request was in flight go out in the next revision.
        if (pending.isNotEmpty() && debounce == null) scope.launch { save() }
    }

    /** Another device changed the profile: take its state, keep the error visible. */
    private fun reloadAfterConflict() {
        val message = error
        scope.launch {
            try {
                val response = api.getAssistantPersonalization(); checkOwner()
                response.data?.takeIf { response.success }?.let { data ->
                    server = data
                    value = overlay(data)
                    AssistantPersonalizationEvents.publish(owner, data)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // The original conflict message already tells the user what happened.
            }
            if (owns()) error = message
        }
    }

    /** Adds, replaces (bytes non-null) or removes a reference photo; revision-checked like edits. */
    fun changePhoto(slot: String, filename: String?, mimeType: String?, bytes: ByteArray?) {
        scope.launch {
            mutex.withLock {
                val base = server ?: return@withLock
                saving = true
                try {
                    val response = api.changeAssistantReferencePhoto(owner, slot, base.revision, filename, mimeType, bytes); checkOwner()
                    check(response.success) { response.error?.message ?: context.getString(R.string.assistant_save_failed) }
                    val next = requireNotNull(response.data)
                    server = next
                    value = overlay(next)
                    error = null
                    AssistantPersonalizationEvents.publish(owner, next)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    if (owns()) {
                        error = failure.message ?: context.getString(R.string.assistant_save_failed)
                        if (failure is ApiHttpException && failure.status == 409) reloadAfterConflict()
                    }
                } finally {
                    saving = false
                }
            }
        }
    }

    fun reportError(message: String?) { error = message }

    suspend fun photo(slot: String): ByteArray? = try {
        api.getAssistantReferencePhoto(slot).takeIf { owns() }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        null
    }

    /** The server state with not-yet-confirmed local edits on top. */
    private fun overlay(base: AssistantPersonalization): AssistantPersonalization {
        if (pending.isEmpty()) return base
        val merged = JsonObject(json.encodeToJsonElement(base).jsonObject + pending)
        return runCatching { json.decodeFromJsonElement<AssistantPersonalization>(merged) }.getOrDefault(base)
    }

    internal fun dispose() {
        loadJob?.cancel()
        flush()
    }
}

/** One controller per signed-in assistant account; null without an account. */
@Composable
fun rememberAssistantSettingsController(api: ApiClient): AssistantSettingsController? {
    val owner = TokenStore.assistantOwnerKey() ?: return null
    val context = LocalContext.current.applicationContext
    val controller = remember(owner) { AssistantSettingsController(owner, api, context) }
    DisposableEffect(controller) {
        controller.ensureLoaded()
        onDispose { controller.dispose() }
    }
    return controller
}
