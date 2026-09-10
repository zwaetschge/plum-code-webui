package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.ui.screens.screenErrorMessage
import com.claudewebui.app.core.network.apiCall
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.ComfyUiSettings
import com.claudewebui.app.data.model.DiscordSettings
import com.claudewebui.app.data.model.HomeAssistantSettings
import com.claudewebui.app.data.model.UpdateDiscordSettingsInput
import com.claudewebui.app.data.model.UpdateHomeAssistantSettingsInput
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Result of a connection probe, kept per integration. */
data class TestState(
    val running: Boolean = false,
    val ok: Boolean? = null,
    val message: String? = null,
)

data class IntegrationsUiState(
    val comfyUi: ComfyUiSettings? = null,
    val discord: DiscordSettings? = null,
    val homeAssistant: HomeAssistantSettings? = null,
    val isLoading: Boolean = true,
    val comfyTest: TestState = TestState(),
    val discordTest: TestState = TestState(),
    val haTest: TestState = TestState(),
    val isSaving: Boolean = false,
    val saveError: String? = null,
    val savedNotice: String? = null,
)

/**
 * ComfyUI, Discord and Home Assistant integrations: status, connection probes
 * and editing.
 *
 * Secrets are write-only. The backend returns `*Configured` flags but never the
 * token itself, so an empty field means "leave as is" — clearing a stored
 * secret needs the explicit clear flag rather than submitting a blank value.
 */
class IntegrationsViewModel(private val api: ApiClient) : ViewModel() {

    private val _uiState = MutableStateFlow(IntegrationsUiState())
    val uiState: StateFlow<IntegrationsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            coroutineScope {
                val comfy = async { apiCall { api.getComfyUiSettings().data }.getOrNull() }
                val discord = async { apiCall { api.getDiscordSettings().data }.getOrNull() }
                val ha = async { apiCall { api.getHomeAssistantSettings().data }.getOrNull() }
                _uiState.update {
                    it.copy(
                        comfyUi = comfy.await(),
                        discord = discord.await(),
                        homeAssistant = ha.await(),
                        isLoading = false,
                    )
                }
            }
        }
    }

    fun testComfyUi() = probe(
        set = { state, value -> state.copy(comfyTest = value) },
        call = { api.testComfyUi().success },
    )

    fun testDiscord() = probe(
        set = { state, value -> state.copy(discordTest = value) },
        call = { api.testDiscord().success },
    )

    fun testHomeAssistant() = probe(
        set = { state, value -> state.copy(haTest = value) },
        call = { api.testHomeAssistant().success },
    )

    private fun probe(
        set: (IntegrationsUiState, TestState) -> IntegrationsUiState,
        call: suspend () -> Boolean,
    ) {
        viewModelScope.launch {
            _uiState.update { set(it, TestState(running = true)) }
            val result = apiCall { call() }
            _uiState.update {
                set(
                    it,
                    TestState(
                        running = false,
                        ok = result.getOrNull() ?: false,
                        message = result.exceptionOrNull()?.screenErrorMessage("settings", "probe")
                            ?: if (result.getOrNull() == true) "Reachable" else "Failed",
                    ),
                )
            }
        }
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    private fun save(notice: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, saveError = null, savedNotice = null) }
            val result = apiCall { block() }
            _uiState.update {
                it.copy(
                    isSaving = false,
                    saveError = result.exceptionOrNull()?.screenErrorMessage("settings", "save"),
                    savedNotice = if (result.isSuccess) notice else null,
                )
            }
            if (result.isSuccess) load()
        }
    }

    fun saveComfyUi(url: String?, enabled: Boolean?) =
        save("ComfyUI saved") { api.updateComfyUiSettings(url, enabled) }

    fun saveDiscord(input: UpdateDiscordSettingsInput) =
        save("Discord saved") { api.updateDiscordSettings(input) }

    fun saveHomeAssistant(input: UpdateHomeAssistantSettingsInput) =
        save("Home Assistant saved") { api.updateHomeAssistantSettings(input) }

    fun dismissSaveNotice() {
        _uiState.update { it.copy(savedNotice = null, saveError = null) }
    }
}
