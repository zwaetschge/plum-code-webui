package com.claudewebui.app.ui.screens.dashboard

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.claudewebui.app.R
import com.claudewebui.app.data.model.AssistantVoiceOption
import com.claudewebui.app.ui.screens.settings.MISTRAL_GERMAN_VOICE
import com.claudewebui.app.ui.screens.settings.SettingsGroup
import com.claudewebui.app.ui.screens.settings.SettingsPageScaffold
import com.claudewebui.app.ui.screens.settings.SettingsRow
import com.claudewebui.app.ui.screens.settings.SettingsSwitchRow
import com.claudewebui.app.ui.screens.settings.SpeechRecognitionGroup
import com.claudewebui.app.ui.screens.settings.TileTone
import com.claudewebui.app.ui.screens.settings.assistantVoiceLabel
import kotlinx.coroutines.delay

/** Sample voice list: OmniVoice clones, then Mistral with Heidi first (other Mistral names are placeholders). */
private val PREVIEW_VOICES = listOf(
    AssistantVoiceOption(name = "Rufus-Beck", engine = "omnivoice", language = "Auto"),
    AssistantVoiceOption(name = "Vanessa", engine = "omnivoice", language = "Auto"),
    AssistantVoiceOption(name = "Marc-Uwe-Kling", engine = "omnivoice", language = "Auto"),
    AssistantVoiceOption(id = MISTRAL_GERMAN_VOICE, name = "Heidi · Deutsch", engine = "mistral", language = "de"),
    AssistantVoiceOption(id = "mistral:preview-fr", name = "Marie · Französisch", engine = "mistral", language = "fr"),
    AssistantVoiceOption(id = "mistral:preview-it", name = "Giulia · Italienisch", engine = "mistral", language = "it"),
    AssistantVoiceOption(id = "mistral:preview-en", name = "Paul · Englisch", engine = "mistral", language = "en"),
)

/**
 * Debug fixture for `claudewebui://preview-voice?section=…`, reachable without
 * a login:
 * - `settings`: the „Stimme & Sprache“ page with the speech recognition choice;
 * - `voices`: the voice mode with its voice menu open (OmniVoice and Mistral);
 * - `heard`: the voice mode while the device recognizer shows live text;
 * - `faces`: every face of the voice mode side by side;
 * - `live` (default): the voice mode listening with the phone's real
 *   recognizer (the conversation itself is simulated), to check which
 *   recognizer and locale it picks, the partial text and the fallback.
 */
@Composable
fun VoiceModePreviewScreen(section: String?) {
    when (section) {
        "settings" -> VoiceSettingsPreview()
        "voices" -> VoiceLayoutFixture(VoicePhase.Listening, hearing = false, heard = "", menuOpen = true)
        "heard" -> VoiceLayoutFixture(VoicePhase.Listening, hearing = true, heard = "Wie wird das Wetter morgen in Zürich", menuOpen = false)
        "faces" -> FaceGalleryPreview()
        else -> LiveRecognitionPreview()
    }
}

@Composable
private fun VoiceSettingsPreview() {
    var recognition by remember { mutableStateOf("device") }
    var voiceChat by remember { mutableStateOf(true) }
    var history by remember { mutableStateOf(false) }
    SettingsPageScaffold(stringResource(R.string.settings_hub_voice), onBack = null, contentPadding = WindowInsets.systemBars.asPaddingValues()) {
        item(key = "voice-output") {
            SettingsGroup(header = stringResource(R.string.settings_hub_voice_output), footer = stringResource(R.string.settings_hub_voice_footer)) {
                item { SettingsSwitchRow(stringResource(R.string.assistant_voice_chat), voiceChat, { voiceChat = it }, Icons.AutoMirrored.Outlined.VolumeUp, TileTone.Pink) }
                item { SettingsRow(title = stringResource(R.string.assistant_voice_pick), icon = Icons.Outlined.RecordVoiceOver, tone = TileTone.Violet, value = assistantVoiceLabel(MISTRAL_GERMAN_VOICE), onClick = {}) }
            }
        }
        item(key = "voice-recognition") { SpeechRecognitionGroup(recognition, enabled = true) { recognition = it } }
        item(key = "voice-history") {
            SettingsGroup { item { SettingsSwitchRow(stringResource(R.string.assistant_voice_history), history, { history = it }, Icons.Outlined.Mic, TileTone.Red) } }
        }
    }
}

@Composable
private fun VoiceLayoutFixture(phase: VoicePhase, hearing: Boolean, heard: String, menuOpen: Boolean) {
    var voice by remember { mutableStateOf(MISTRAL_GERMAN_VOICE) }
    VoiceModeLayout(
        title = "Wetter am Wochenende",
        voiceSwitcher = { VoiceDropdown(PREVIEW_VOICES, null, voice, onOpen = {}, onRetry = {}, onSelect = { voice = it }, initiallyOpen = menuOpen) },
        phase = phase, level = if (hearing) .45f else 0f, hearing = hearing, paused = false, onDevice = true,
        voiceLabel = assistantVoiceLabel(voice), whisperReady = null, speechReady = true, prepareError = null,
        message = null, notice = null, heardText = heard, caption = "",
        onOrb = {}, onRetry = {}, onPause = {}, onClose = {},
    )
}

@Composable
private fun LiveRecognitionPreview() {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.RECORD_AUDIO) }
    var phase by remember { mutableStateOf(VoicePhase.Preparing) }
    var hearing by remember { mutableStateOf(false) }
    var heard by remember { mutableStateOf("") }
    var caption by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf<String?>(null) }
    var engine by remember { mutableStateOf("…") }
    val level = remember { mutableFloatStateOf(0f) }
    val active = remember { arrayOfNulls<DeviceSpeech>(1) }
    LaunchedEffect(granted) {
        if (!granted) return@LaunchedEffect
        val speech = DeviceSpeech(context, "de")
        try {
            var quick = 0
            while (true) {
                engine = speech.current ?: "kein Erkenner"
                if (!speech.available) { notice = context.getString(R.string.voice_mode_device_fallback); phase = VoicePhase.Paused; break }
                phase = VoicePhase.Listening; hearing = false
                val started = System.currentTimeMillis()
                active[0] = speech
                val result = try { speech.listen(level = { level.floatValue = it }, partial = { heard = it }, onSpeech = { hearing = true }) } finally { active[0] = null }
                engine = speech.current ?: "kein Erkenner"
                when (result) {
                    is DeviceHeard.Unavailable -> { notice = context.getString(R.string.voice_mode_device_fallback) + " (Fehler ${result.code})"; phase = VoicePhase.Paused; break }
                    DeviceHeard.Silence -> {
                        quick = if (System.currentTimeMillis() - started < 800) quick + 1 else 0
                        if (quick >= 5) { notice = context.getString(R.string.voice_mode_device_fallback) + " (keine Audiodaten)"; phase = VoicePhase.Paused; break }
                        if (quick > 0) delay(400)
                    }
                    is DeviceHeard.Text -> {
                        heard = result.text
                        phase = VoicePhase.Thinking; delay(1200)
                        caption = "Vorschau: hier spräche Plum die Antwort."; phase = VoicePhase.Speaking; delay(1800)
                        caption = ""
                    }
                }
            }
        } finally { speech.release() }
    }
    VoiceModeLayout(
        title = "Vorschau · $engine",
        voiceSwitcher = { VoiceDropdown(PREVIEW_VOICES, null, MISTRAL_GERMAN_VOICE, onOpen = {}, onRetry = {}, onSelect = {}) },
        phase = phase,
        level = if (phase == VoicePhase.Listening) level.floatValue else 0f,
        hearing = hearing, paused = phase == VoicePhase.Paused, onDevice = true,
        voiceLabel = assistantVoiceLabel(MISTRAL_GERMAN_VOICE), whisperReady = null, speechReady = true, prepareError = null,
        message = null, notice = notice, heardText = heard, caption = caption,
        onOrb = { if (phase == VoicePhase.Listening && hearing) active[0]?.finish() },
        onRetry = {}, onPause = {}, onClose = {},
    )
}

/**
 * Every face the voice mode can show, side by side: what the eyes say in each
 * phase, including the droop after a failure.
 */
@Composable
private fun FaceGalleryPreview() {
    val palette = com.claudewebui.app.ui.theme.PlumTheme.palette
    Column(
        Modifier.fillMaxSize().background(palette.background).systemBarsPadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val faces = listOf(
            Triple(VoicePhase.Preparing, "Preparing", false),
            Triple(VoicePhase.Listening, "Listening", false),
            Triple(VoicePhase.Transcribing, "Transcribing", false),
            Triple(VoicePhase.Thinking, "Thinking", false),
            Triple(VoicePhase.Speaking, "Speaking", false),
            Triple(VoicePhase.Paused, "Paused", false),
            Triple(VoicePhase.Thinking, "Failed", true),
        )
        faces.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                row.forEach { (phase, label, failed) ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        VoiceOrb(
                            phase, level = if (phase == VoicePhase.Listening) .55f else 0f,
                            reduce = true, failed = failed, modifier = Modifier.size(104.dp),
                        )
                        Text(label, style = MaterialTheme.typography.labelMedium, color = palette.muted)
                    }
                }
            }
        }
    }
}
