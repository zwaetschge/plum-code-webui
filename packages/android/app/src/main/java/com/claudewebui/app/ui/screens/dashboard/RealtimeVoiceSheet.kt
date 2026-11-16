package com.claudewebui.app.ui.screens.dashboard

import android.annotation.SuppressLint
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.claudewebui.app.core.network.socketEndpoint
import com.claudewebui.app.core.security.TokenStore
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** True when a wired headset, USB headset or Bluetooth audio output is active. */
internal fun hasExternalAudioOutput(audioManager: AudioManager?): Boolean {
    val devices = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: return false
    return devices.any {
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET
    }
}

/** Names of the Gemini Live models (the voice mode's first choice). */
internal val LIVE_MODEL_LABELS = mapOf(
    "gemini-3.8-live" to "Gemini Live",
    "gemini-3.8-live-extended-thinking" to "Gemini Live · Extended Thinking",
)

@SuppressLint("MissingPermission")
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun RealtimeVoiceSheet(
    owner: String,
    chatId: String,
    onSaved: () -> Unit,
    onDismiss: () -> Unit,
    /** Gemini Live model; blank lets the server pick (Gemini first, else OpenAI). */
    model: String = "",
    /** Gemini Live models the user can switch between. */
    models: List<String> = emptyList(),
    onModel: (String) -> Unit = {},
    /** Stored profile voice; a `gemini:<name>` voice is used for Gemini Live. */
    voice: String? = null,
    /** Live could not start: the classic voice mode (Mistral, then Vocarium) takes over. */
    onFallback: ((String) -> Unit)? = null,
) {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    var status by remember { mutableStateOf("Verbindet …") }
    var error by remember { mutableStateOf<String?>(null) }
    var heard by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf("") }
    var muted by remember { mutableStateOf(false) }
    val mute=remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    val socket=remember { AtomicReference<Socket?>() }
    val record=remember { AtomicReference<AudioRecord?>() }
    val track=remember { AtomicReference<AudioTrack?>() }
    val generation=remember { AtomicInteger(0) }
    val speakingUntilMs=remember { AtomicLong(0L) }
    val latestSaved by rememberUpdatedState(onSaved)
    val latestDismiss by rememberUpdatedState(onDismiss)
    val latestFallback by rememberUpdatedState(onFallback)
    val ready=remember(model) { java.util.concurrent.atomic.AtomicBoolean(false) }
    fun fail(message: String) {
        error=message
        if(!ready.get()) latestFallback?.invoke(message)
    }
    fun interruptBot() {
        generation.incrementAndGet()
        speakingUntilMs.set(0L)
        runCatching { track.get()?.apply { pause(); flush(); play() } }
        socket.get()?.emit("interrupt")
        status="Hört zu"
        answer=""
    }
    DisposableEffect(lifecycle) {
        val observer=LifecycleEventObserver { _, event -> if(event==Lifecycle.Event.ON_STOP) latestDismiss() }
        lifecycle.addObserver(observer); onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(owner,chatId,model) {
        error=null; heard=""; answer=""; status="Verbindet …"
        speakingUntilMs.set(0L)
        val output=Channel<Pair<Int,ByteArray>>(Channel.UNLIMITED)
        val jobs=mutableListOf<Job>()
        var echo:AcousticEchoCanceler?=null
        var suppressor:NoiseSuppressor?=null
        val audioManager=context.getSystemService(AudioManager::class.java)
        val prevMode=audioManager?.mode ?: AudioManager.MODE_NORMAL
        @Suppress("DEPRECATION")
        val prevSpeaker=audioManager?.isSpeakerphoneOn ?: false
        try {
            require(owner==TokenStore.assistantOwnerKey())
            val endpoint=socketEndpoint(requireNotNull(TokenStore.getServerUrl()))
            val token=requireNotNull(TokenStore.getToken())
            val client=IO.socket(URI(endpoint.origin+"/realtime"),IO.Options().apply {
                forceNew=true; path=endpoint.path; auth=buildMap { put("token",token); if(chatId.isNotBlank()) put("chatId",chatId); if(model.isNotBlank()) put("model",model); voice?.let { put("voice",it) } }
                extraHeaders=mapOf("Authorization" to listOf("Bearer $token"))
                transports=arrayOf("websocket"); reconnection=false
            }); socket.set(client)
            client.on(Socket.EVENT_CONNECT_ERROR) { args -> scope.launch { fail("Sprachverbindung nicht möglich"); record.get()?.stop() } }
            client.on("problem") { args -> scope.launch { fail(args.firstOrNull()?.toString() ?: "Sprachverbindung fehlgeschlagen"); runCatching { record.get()?.stop() }; client.disconnect() } }
            client.on("ready") {
                ready.set(true)
                scope.launch {
                    try {
                        runCatching {
                            audioManager?.mode=AudioManager.MODE_IN_COMMUNICATION
                            if(!hasExternalAudioOutput(audioManager)) {
                                @Suppress("DEPRECATION")
                                audioManager?.isSpeakerphoneOn=true
                            }
                        }
                        val rate=24000
                        val input=AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION,rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,maxOf(AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)*4,24000))
                        require(input.state==AudioRecord.STATE_INITIALIZED) { "Mikrofon nicht verfügbar" };record.set(input)
                        echo=if(AcousticEchoCanceler.isAvailable()) runCatching { AcousticEchoCanceler.create(input.audioSessionId)?.apply { enabled=true } }.getOrNull() else null
                        suppressor=if(NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(input.audioSessionId)?.apply { enabled=true } }.getOrNull() else null
                        val audio=AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT)*4,24000)).setTransferMode(AudioTrack.MODE_STREAM).build()
                        track.set(audio);audio.play(); input.startRecording();status="Hört zu"
                        jobs+=launch(Dispatchers.IO) {
                            val bytes=ByteArray(4800)
                            val silent=ByteArray(4800)
                            while(isActive) {
                                val n=input.read(bytes,0,bytes.size)
                                if(n<=0)break
                                if(!mute.get() && owner==TokenStore.assistantOwnerKey()) {
                                    val botSpeaking=System.currentTimeMillis()<speakingUntilMs.get()
                                    val src=if(botSpeaking) silent else bytes
                                    client.emit("audio",android.util.Base64.encodeToString(src,0,n,android.util.Base64.NO_WRAP))
                                }
                            }
                        }
                        jobs+=launch(Dispatchers.IO) {
                            for((epoch,bytes) in output) {
                                if(epoch==generation.get()) {
                                    audio.write(bytes,0,bytes.size,AudioTrack.WRITE_BLOCKING)
                                    speakingUntilMs.updateAndGet { maxOf(it,System.currentTimeMillis()+500L) }
                                    if(output.isEmpty) {
                                        val remain=(speakingUntilMs.get()-500L)-System.currentTimeMillis()
                                        if(remain>0 && epoch==generation.get()) delay(minOf(remain,1500L))
                                        if(output.isEmpty && epoch==generation.get()) withContext(Dispatchers.Main) { status="Hört zu" }
                                    }
                                }
                            }
                        }
                    }catch(failure:Exception){error=failure.message;client.emit("stop");client.disconnect()}
                }
            }
            client.on("audio") { args ->
                runCatching {
                    val bytes=android.util.Base64.decode(args.first().toString(),android.util.Base64.DEFAULT)
                    val now=System.currentTimeMillis()
                    val chunkMs=(bytes.size.toLong()*1000L)/48000L
                    val base=maxOf(now,speakingUntilMs.get()-500L)
                    speakingUntilMs.set(base+chunkMs+500L)
                    output.trySend(generation.get() to bytes)
                    scope.launch { status="Spricht" }
                }
            }
            client.on("speech") {
                if(System.currentTimeMillis()<speakingUntilMs.get()) return@on
                generation.incrementAndGet()
                speakingUntilMs.set(0L)
                runCatching { track.get()?.apply { pause();flush();play() } }
                scope.launch { status="Hört zu";answer="" }
            }
            client.on("transcript") { args -> runCatching { val value=args.first() as JSONObject;scope.launch { if(value.optString("role")=="user")heard=value.optString("text") else answer=value.optString("text") } } }
            client.on("saved") { scope.launch { latestSaved() } }
            client.on(Socket.EVENT_DISCONNECT) { scope.launch { status="Verbindung beendet";runCatching { record.get()?.stop() } } }
            client.connect()
            awaitCancellation()
        } finally {
            speakingUntilMs.set(0L)
            socket.getAndSet(null)?.apply { emit("stop");off();disconnect() }
            runCatching { record.getAndSet(null)?.apply { stop();release() } }
            echo?.release();suppressor?.release();output.close();jobs.forEach { it.cancel() }
            runCatching { track.getAndSet(null)?.apply { pause();flush();release() } }
            runCatching {
                @Suppress("DEPRECATION")
                audioManager?.isSpeakerphoneOn=prevSpeaker
                audioManager?.mode=prevMode
            }
        }
    }
    ModalBottomSheet(onDismissRequest=onDismiss,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().heightIn(max=androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp.dp * .85f).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text(LIVE_MODEL_LABELS[model] ?: "Realtime-Sprache",style=MaterialTheme.typography.headlineSmall)
            if(models.size>1) FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                models.forEach { id -> FilterChip(selected=id==model,onClick={ if(id!=model) onModel(id) },label={ Text(LIVE_MODEL_LABELS[id] ?: id) }) }
            }
            Text(status)
            Column(Modifier.fillMaxWidth().weight(1f, fill=false).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                if(heard.isNotBlank())Text(heard,style=MaterialTheme.typography.bodyMedium)
                if(answer.isNotBlank())Text(answer,style=MaterialTheme.typography.bodyLarge)
                error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            }
            FlowRow(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                if(status=="Spricht") {
                    FilledTonalButton(onClick={ interruptBot() }) { Text("Unterbrechen") }
                }
                OutlinedButton(enabled=error==null,onClick={muted=!muted;mute.set(muted)}) { Text(if(muted)"Mikrofon einschalten" else "Stummschalten") }
                Button(onClick=onDismiss) { Text("Beenden") }
            }
        }
    }
}
