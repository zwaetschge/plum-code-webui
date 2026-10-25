package com.claudewebui.app.ui.screens.dashboard

import android.annotation.SuppressLint
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
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
import java.util.concurrent.atomic.AtomicReference

@SuppressLint("MissingPermission")
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun RealtimeVoiceSheet(owner: String, chatId: String, onSaved: () -> Unit, onDismiss: () -> Unit) {
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
    val latestSaved by rememberUpdatedState(onSaved)
    val latestDismiss by rememberUpdatedState(onDismiss)
    DisposableEffect(lifecycle) {
        val observer=LifecycleEventObserver { _, event -> if(event==Lifecycle.Event.ON_STOP) latestDismiss() }
        lifecycle.addObserver(observer); onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(owner,chatId) {
        val output=Channel<Pair<Int,ByteArray>>(64)
        val jobs=mutableListOf<Job>()
        var echo:AcousticEchoCanceler?=null
        try {
            require(owner==TokenStore.assistantOwnerKey())
            val endpoint=socketEndpoint(requireNotNull(TokenStore.getServerUrl()))
            val client=IO.socket(URI(endpoint.origin+"/realtime"),IO.Options().apply {
                path=endpoint.path; auth=mapOf("token" to TokenStore.getToken(),"chatId" to chatId)
                transports=arrayOf("websocket"); reconnection=false
            }); socket.set(client)
            client.on(Socket.EVENT_CONNECT_ERROR) { args -> scope.launch { error="Sprachverbindung nicht möglich"; record.get()?.stop() } }
            client.on("problem") { args -> scope.launch { error=args.firstOrNull()?.toString() ?: "Sprachverbindung fehlgeschlagen"; runCatching { record.get()?.stop() }; client.disconnect() } }
            client.on("ready") {
                scope.launch {
                    try {
                        val rate=24000
                        val input=AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION,rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,maxOf(AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)*4,24000))
                        require(input.state==AudioRecord.STATE_INITIALIZED) { "Mikrofon nicht verfügbar" };record.set(input)
                        echo=if(AcousticEchoCanceler.isAvailable()) runCatching { AcousticEchoCanceler.create(input.audioSessionId)?.apply { enabled=true } }.getOrNull() else null
                        val audio=AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT)*4,24000)).setTransferMode(AudioTrack.MODE_STREAM).build()
                        track.set(audio);audio.play(); input.startRecording();status="Hört zu"
                        jobs+=launch(Dispatchers.IO) {
                            val bytes=ByteArray(4800)
                            while(isActive) {
                                val n=input.read(bytes,0,bytes.size)
                                if(n<=0)break
                                if(!mute.get() && owner==TokenStore.assistantOwnerKey()) client.emit("audio",android.util.Base64.encodeToString(bytes,0,n,android.util.Base64.NO_WRAP))
                            }
                        }
                        jobs+=launch(Dispatchers.IO) { for((epoch,bytes) in output) if(epoch==generation.get()) audio.write(bytes,0,bytes.size,AudioTrack.WRITE_BLOCKING) }
                    }catch(failure:Exception){error=failure.message;client.emit("stop");client.disconnect()}
                }
            }
            client.on("audio") { args ->
                runCatching { val bytes=android.util.Base64.decode(args.first().toString(),android.util.Base64.DEFAULT); if(!output.trySend(generation.get() to bytes).isSuccess) { client.emit("stop");scope.launch { error="Audiowiedergabe überlastet" } };scope.launch { status="Spricht" } }
            }
            client.on("speech") { generation.incrementAndGet(); runCatching { track.get()?.apply { pause();flush();play() } };scope.launch { status="Hört zu";answer="" } }
            client.on("transcript") { args -> runCatching { val value=args.first() as JSONObject;scope.launch { if(value.optString("role")=="user")heard=value.optString("text") else answer=value.optString("text") } } }
            client.on("saved") { scope.launch { latestSaved() } }
            client.on(Socket.EVENT_DISCONNECT) { scope.launch { status="Verbindung beendet";runCatching { record.get()?.stop() } } }
            client.connect()
            awaitCancellation()
        } finally {
            socket.getAndSet(null)?.apply { emit("stop");off();disconnect() }
            runCatching { record.getAndSet(null)?.apply { stop();release() } }
            echo?.release();output.close();jobs.forEach { it.cancel() }
            runCatching { track.getAndSet(null)?.apply { pause();flush();release() } }
        }
    }
    ModalBottomSheet(onDismissRequest=onDismiss,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().heightIn(max=androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp.dp * .85f).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text("Realtime-Sprache",style=MaterialTheme.typography.headlineSmall)
            Text(status)
            Column(Modifier.fillMaxWidth().weight(1f, fill=false).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                if(heard.isNotBlank())Text(heard,style=MaterialTheme.typography.bodyMedium)
                if(answer.isNotBlank())Text(answer,style=MaterialTheme.typography.bodyLarge)
                error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            }
            FlowRow(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                OutlinedButton(enabled=error==null,onClick={muted=!muted;mute.set(muted)}) { Text(if(muted)"Mikrofon einschalten" else "Stummschalten") }
                Button(onClick=onDismiss) { Text("Beenden") }
            }
        }
    }
}
