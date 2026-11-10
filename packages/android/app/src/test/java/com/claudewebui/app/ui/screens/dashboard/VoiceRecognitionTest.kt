package com.claudewebui.app.ui.screens.dashboard

import android.speech.SpeechRecognizer
import com.claudewebui.app.data.model.AssistantPersonalization
import com.claudewebui.app.data.model.AssistantVoiceOption
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceRecognitionTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun germanPrefersSwissStandardGermanThenGermany() {
        assertEquals(listOf("de-CH", "de-DE"), recognitionLocales("de"))
        assertEquals(listOf("de-CH", "de-DE"), recognitionLocales("German"))
        // OmniVoice voices say "Auto"; unknown or blank means the voice mode's German.
        assertEquals(listOf("de-CH", "de-DE"), recognitionLocales("Auto"))
        assertEquals(listOf("de-CH", "de-DE"), recognitionLocales(null))
        assertEquals(listOf("de-CH", "de-DE"), recognitionLocales("??"))
        assertEquals(listOf("de-AT", "de-CH", "de-DE"), recognitionLocales("de_AT"))
    }

    @Test fun otherLanguagesUseTheirUsualLocale() {
        assertEquals(listOf("fr-FR"), recognitionLocales("fr"))
        assertEquals(listOf("it-IT"), recognitionLocales("it"))
        assertEquals(listOf("en-US"), recognitionLocales("en"))
        assertEquals(listOf("en-GB", "en-US"), recognitionLocales("en-GB"))
        assertEquals(listOf("fr-CH", "fr-FR"), recognitionLocales("fr_ch"))
    }

    @Test fun errorCodesMatchTheFramework() {
        assertEquals(SpeechRecognizer.ERROR_NO_MATCH, SR_ERROR_NO_MATCH)
        assertEquals(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, SR_ERROR_SPEECH_TIMEOUT)
        assertEquals(SpeechRecognizer.ERROR_SERVER, SR_ERROR_SERVER)
        assertEquals(SpeechRecognizer.ERROR_NETWORK, SR_ERROR_NETWORK)
        assertEquals(SpeechRecognizer.ERROR_CLIENT, SR_ERROR_CLIENT)
        assertEquals(SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SR_ERROR_RECOGNIZER_BUSY)
        assertEquals(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS, SR_ERROR_INSUFFICIENT_PERMISSIONS)
        assertEquals(SpeechRecognizer.ERROR_SERVER_DISCONNECTED, SR_ERROR_SERVER_DISCONNECTED)
        assertEquals(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SR_ERROR_LANGUAGE_NOT_SUPPORTED)
        assertEquals(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, SR_ERROR_LANGUAGE_UNAVAILABLE)
    }

    @Test fun silenceListensAgainLanguageMovesOnFailuresFallBack() {
        for (onDevice in listOf(true, false)) {
            assertEquals(RecognizerOutcome.Silence, recognizerOutcome(SR_ERROR_NO_MATCH, onDevice))
            assertEquals(RecognizerOutcome.Silence, recognizerOutcome(SR_ERROR_SPEECH_TIMEOUT, onDevice))
            assertEquals(RecognizerOutcome.NextLocale, recognizerOutcome(SR_ERROR_LANGUAGE_NOT_SUPPORTED, onDevice))
            assertEquals(RecognizerOutcome.NextLocale, recognizerOutcome(SR_ERROR_LANGUAGE_UNAVAILABLE, onDevice))
            assertEquals(RecognizerOutcome.Retry, recognizerOutcome(SR_ERROR_RECOGNIZER_BUSY, onDevice))
            assertEquals(RecognizerOutcome.Unavailable, recognizerOutcome(SR_ERROR_INSUFFICIENT_PERMISSIONS, onDevice))
        }
        // A failing on-device engine still leaves the system recognizer; a failing system recognizer means the server.
        assertEquals(RecognizerOutcome.NextRecognizer, recognizerOutcome(SR_ERROR_SERVER, onDevice = true))
        assertEquals(RecognizerOutcome.Unavailable, recognizerOutcome(SR_ERROR_SERVER, onDevice = false))
        assertEquals(RecognizerOutcome.Unavailable, recognizerOutcome(SR_ERROR_NETWORK, onDevice = false))
        assertEquals(RecognizerOutcome.Unavailable, recognizerOutcome(SR_ERROR_AUDIO, onDevice = false))
        // A recognizer that never gets ready: the system one after on-device, else the server.
        assertEquals(RecognizerOutcome.NextRecognizer, recognizerOutcome(SR_NOT_READY, onDevice = true))
        assertEquals(RecognizerOutcome.Unavailable, recognizerOutcome(SR_NOT_READY, onDevice = false))
    }

    @Test fun mistralVoicesKeepTheirPrefixedIdAndLanguage() {
        val voices = json.decodeFromString<List<AssistantVoiceOption>>(
            """[{"voice_id":"Rufus-Beck","name":"Rufus-Beck","language":"Auto","source":"clone","engine":"omnivoice"},
               {"id":"mistral:01a0f318-4ae8-7446-a3e4-45aa092940b2","name":"Heidi · Deutsch","engine":"mistral","language":"de"}]""",
        )
        val heidi = voices[1]
        assertEquals("mistral:01a0f318-4ae8-7446-a3e4-45aa092940b2", heidi.key)
        assertEquals("Heidi · Deutsch", heidi.label)
        assertEquals("de", voiceLanguage(voices, heidi.key))
        assertEquals("Auto", voiceLanguage(voices, "Rufus Beck"))
        assertNull(voiceLanguage(voices, "mistral:unknown"))
        assertNull(voiceLanguage(null, heidi.key))
    }

    @Test fun speechRecognitionDefaultsToTheDeviceAndRoundTrips() {
        assertEquals("device", AssistantPersonalization().speechRecognition)
        assertEquals("device", json.decodeFromString<AssistantPersonalization>("""{"revision":3}""").speechRecognition)
        val server = json.decodeFromString<AssistantPersonalization>("""{"revision":3,"speechRecognition":"server"}""")
        assertEquals("server", server.speechRecognition)
        assertEquals("server", server.updatePayload().getValue("preferences").jsonObject.getValue("speechRecognition").jsonPrimitive.content)
    }
}
