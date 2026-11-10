package com.claudewebui.app.ui.screens.settings

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AssistantVoiceOption
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.screens.dashboard.speakThrough
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Voice used when nothing is chosen; the server falls back to the same one. */
const val DEFAULT_ASSISTANT_VOICE = "Rufus Beck"

/** Vocarium ids are hyphenated ("Rufus-Beck"), stored names are spoken ("Rufus Beck"). */
private fun normalizeVoice(value: String) = value.trim().replace('-', ' ').lowercase()

internal fun sameVoice(a: String, b: String): Boolean =
    a == b || (!a.startsWith("mistral:") && !b.startsWith("mistral:") && normalizeVoice(a) == normalizeVoice(b))

/** Mistral's German preset; the server speaks with it when a stored Mistral voice no longer exists. */
internal const val MISTRAL_GERMAN_VOICE = "mistral:01a0f318-4ae8-7446-a3e4-45aa092940b2"

/**
 * Names of the Mistral voices from the last loaded voice list, so every place
 * that shows the stored `mistral:<uuid>` reads „Heidi · Deutsch“ instead.
 */
internal object MistralVoiceNames {
    private val names = mutableStateMapOf<String, String>()
    fun learn(voices: List<AssistantVoiceOption>) { voices.forEach { if (it.engine == "mistral" && it.label.isNotBlank()) names[it.key] = it.label } }
    operator fun get(key: String): String? = names[key]
}

private val UUID_LIKE = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

/** Human label for a stored voice value; Mistral ids are named from the voice list when it was loaded. */
@Composable
fun assistantVoiceLabel(stored: String): String = when {
    stored.isBlank() -> stringResource(R.string.settings_hub_voice_default)
    stored.startsWith("mistral:") -> MistralVoiceNames[stored]
        ?: if (stored == MISTRAL_GERMAN_VOICE) "Heidi · Deutsch"
        else stored.removePrefix("mistral:").let { id ->
            if (UUID_LIKE.matches(id)) stringResource(R.string.voice_mistral_generic) else id.replace('_', ' ') + " · Mistral"
        }
    else -> stored
}

/**
 * The voice list and its preview playback. Loading failures keep the server's
 * message (for example "Vocarium ist nicht erreichbar") and can be retried.
 */
@Stable
class VoiceCatalog internal constructor(
    private val owner: String,
    private val api: ApiClient,
    private val context: Context,
    private val scope: CoroutineScope,
) {
    var voices by mutableStateOf<List<AssistantVoiceOption>?>(null)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var sampling by mutableStateOf<String?>(null)
        private set
    var sampleError by mutableStateOf<String?>(null)
        private set
    private var loadJob: Job? = null
    private var sampleJob: Job? = null

    fun load() {
        loadJob?.cancel()
        loadJob = scope.launch {
            loading = true
            loadError = null
            try {
                val response = api.getAssistantVoices()
                if (TokenStore.assistantOwnerKey() != owner) return@launch
                if (response.success) voices = response.data.orEmpty().filter { it.key.isNotBlank() }.also(MistralVoiceNames::learn)
                else loadError = response.error?.message ?: context.getString(R.string.assistant_voice_failed)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (TokenStore.assistantOwnerKey() == owner) loadError = failure.message ?: context.getString(R.string.assistant_voice_failed)
            } finally {
                loading = false
            }
        }
    }

    fun toggleSample(voice: String) {
        sampleJob?.cancel()
        if (sampling == voice) { sampling = null; return }
        sampling = voice
        sampleError = null
        sampleJob = scope.launch {
            try {
                speakThrough(context, owner, api, context.getString(R.string.assistant_voice_sample), voice, "German")
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                sampleError = failure.message ?: context.getString(R.string.assistant_voice_failed)
            } finally {
                if (sampling == voice) sampling = null
            }
        }
    }

    fun stopSample() {
        sampleJob?.cancel(); sampleJob = null
        sampling = null
    }
}

@Composable
fun rememberVoiceCatalog(owner: String, api: ApiClient): VoiceCatalog {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    val catalog = remember(owner) { VoiceCatalog(owner, api, context, scope) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(catalog) { if (catalog.voices == null) catalog.load() }
    DisposableEffect(catalog, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) catalog.stopSample() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); catalog.stopSample() }
    }
    return catalog
}

/**
 * Voices grouped OmniVoice (local) / Mistral (API), each with a preview
 * button. Tapping a voice selects it; the caller saves immediately.
 */
@Composable
fun VoiceChoiceGroups(
    catalog: VoiceCatalog,
    selected: String,
    enabled: Boolean,
    onSelect: (String) -> Unit,
) {
    val effective = selected.ifBlank { DEFAULT_ASSISTANT_VOICE }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        val voices = catalog.voices
        when {
            catalog.loading && voices == null -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            catalog.loadError != null -> SettingsGroup {
                item(hasIcon = false) {
                    SettingsMessage(
                        stringResource(R.string.settings_hub_voice_load_failed, catalog.loadError.orEmpty()),
                        error = true,
                        actionLabel = stringResource(R.string.settings_hub_retry),
                        onAction = catalog::load,
                    )
                }
            }
            voices != null && voices.isEmpty() -> SettingsGroup {
                item(hasIcon = false) {
                    SettingsMessage(stringResource(R.string.settings_hub_voice_empty), actionLabel = stringResource(R.string.settings_hub_retry), onAction = catalog::load)
                }
            }
        }
        catalog.sampleError?.let { message ->
            SettingsGroup { item(hasIcon = false) { SettingsMessage(stringResource(R.string.settings_hub_voice_preview_failed, message), error = true) } }
        }
        if (voices != null) {
            val known = voices.any { sameVoice(it.key, effective) }
            if (!known && selected.isNotBlank() && catalog.loadError == null) SettingsGroup {
                item(hasIcon = false) {
                    SettingsOptionRow(
                        title = stringResource(R.string.settings_hub_voice_unavailable, assistantVoiceLabel(selected)),
                        selected = true,
                        enabled = enabled,
                        onClick = {},
                    )
                }
            }
            val omni = voices.filter { it.engine != "mistral" }
            val mistral = voices.filter { it.engine == "mistral" }
            listOf(R.string.settings_hub_voice_engine_omni to omni, R.string.settings_hub_voice_engine_mistral to mistral).forEach { (header, group) ->
                if (group.isNotEmpty()) SettingsGroup(header = stringResource(header)) {
                    group.forEach { voice ->
                        item(hasIcon = false) {
                            val playing = catalog.sampling == voice.key
                            SettingsOptionRow(
                                title = voice.label,
                                selected = sameVoice(voice.key, effective),
                                enabled = enabled,
                                onClick = { if (!sameVoice(voice.key, selected)) onSelect(voice.key) },
                                trailing = {
                                    IconButton(onClick = { catalog.toggleSample(voice.key) }) {
                                        if (playing) Icon(Icons.Outlined.Stop, stringResource(R.string.settings_hub_voice_stop), tint = PlumAccent)
                                        else Icon(Icons.Outlined.PlayArrow, stringResource(R.string.assistant_voice_try), tint = PlumMuted)
                                    }
                                },
                            )
                        }
                    }
                }
            }
            if (catalog.loading) CircularProgressIndicator(Modifier.padding(start = 16.dp))
        }
    }
}

/**
 * Where the voice chat recognises speech: on the device (Android's
 * recognizer, live text) or on the server (Whisper on Vocarium). Saved as
 * `speechRecognition`; anything but "server" counts as the device.
 */
@Composable
fun SpeechRecognitionGroup(selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    val server = selected == "server"
    SettingsGroup(header = stringResource(R.string.voice_recognition_title), footer = stringResource(R.string.voice_recognition_footer)) {
        item(hasIcon = false) {
            SettingsOptionRow(
                title = stringResource(R.string.voice_recognition_device),
                subtitle = stringResource(R.string.voice_recognition_device_hint),
                selected = !server,
                enabled = enabled,
                onClick = { if (server) onSelect("device") },
            )
        }
        item(hasIcon = false) {
            SettingsOptionRow(
                title = stringResource(R.string.voice_recognition_server),
                subtitle = stringResource(R.string.voice_recognition_server_hint),
                selected = server,
                enabled = enabled,
                onClick = { if (!server) onSelect("server") },
            )
        }
    }
}
