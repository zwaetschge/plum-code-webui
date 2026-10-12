@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)

package com.claudewebui.swarm.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.VideoFile
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Anhang
import com.claudewebui.swarm.data.AnhangArt
import com.claudewebui.swarm.data.AnhangLeser
import com.claudewebui.swarm.data.Aufnahme
import com.claudewebui.swarm.data.Datei
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs
import kotlin.math.max

/*
 * Dateien aller Art (SCHNITTSTELLEN-app.md, App 2.2): Anhängen über Photo Picker, Dokumentenauswahl
 * und Kamera, Sprachnachricht mit gedrückt Halten; in Nachrichten Audio zum Abspielen und Karten für
 * Video und Dateien mit Öffnen, Teilen und Speichern.
 */

fun dateiAnbieter(context: Context) = "${context.packageName}.dateien"

/** Der Anhang, der in einer Eingabe wartet, und die laufende Aufnahme. */
@Stable
class AnhangStand {
    var anhang by mutableStateOf<Anhang?>(null)
    var laedt by mutableStateOf(false)
    var menue by mutableStateOf(false)
    var aufnahme by mutableStateOf<Aufnahme?>(null)
    var aufnahmeMs by mutableLongStateOf(0L)
    /** Wie weit der Finger nach links gewischt ist (px, negativ). */
    var versatz by mutableFloatStateOf(0f)
    val pegel = mutableStateListOf<Float>()
}

/** Die drei Wege zu einem Anhang; die Launcher bleiben registriert, solange die Eingabe steht. */
class AnhangWege(val bildOderVideo: () -> Unit, val datei: () -> Unit, val kamera: () -> Unit)

@Composable
fun rememberAnhangWege(stand: AnhangStand, vm: SchwarmViewModel): AnhangWege {
    val kontext = LocalContext.current
    val scope = rememberCoroutineScope()
    fun nehmen(uri: Uri, verkleinern: Boolean) {
        scope.launch {
            stand.laedt = true
            try {
                stand.anhang = withContext(Dispatchers.IO) { AnhangLeser.vorbereiten(kontext, uri, verkleinern) }
            } catch (e: Exception) {
                vm.melden("Die Datei liess sich nicht lesen: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                stand.laedt = false
            }
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { nehmen(it, true) } }
    val dokument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { nehmen(it, false) } }
    var fotoUri by remember { mutableStateOf<Uri?>(null) }
    val kamera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val u = fotoUri
        if (ok && u != null) nehmen(u, true)
    }
    return remember(stand) {
        AnhangWege(
            bildOderVideo = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
            datei = { dokument.launch(arrayOf("*/*")) },
            kamera = {
                val ordner = File(kontext.cacheDir, "kamera").apply { mkdirs() }
                ordner.listFiles()?.forEach { it.delete() }
                val f = File(ordner, "foto-${System.currentTimeMillis()}.jpg")
                val u = FileProvider.getUriForFile(kontext, dateiAnbieter(kontext), f)
                fotoUri = u
                try {
                    kamera.launch(u)
                } catch (e: ActivityNotFoundException) {
                    vm.melden("Auf diesem Gerät gibt es keine Kamera-App.")
                }
            },
        )
    }
}

/** Das Anhängen-Menü: Bild oder Video, Datei, Kamera; dazu der Hinweis zur Sprachnachricht. */
@Composable
fun AnhangMenue(stand: AnhangStand, wege: AnhangWege, zusatz: (@Composable () -> Unit)? = null) {
    if (!stand.menue) return
    ModalBottomSheet(
        onDismissRequest = { stand.menue = false },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Anhängen", style = MaterialTheme.typography.titleLarge)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MenueKachel(Icons.Outlined.PhotoLibrary, "Bild oder Video", Modifier.weight(1f)) { stand.menue = false; wege.bildOderVideo() }
                MenueKachel(Icons.Outlined.Description, "Datei", Modifier.weight(1f)) { stand.menue = false; wege.datei() }
                MenueKachel(Icons.Outlined.PhotoCamera, "Kamera", Modifier.weight(1f)) { stand.menue = false; wege.kamera() }
            }
            Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(14.dp)) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Mic, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        "Sprachnachricht: das Mikrofon neben dem Eingabefeld gedrückt halten. Loslassen sendet, " +
                            "nach links wischen bricht ab.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            zusatz?.invoke()
            Text(
                "Brian sieht Bilder, liest Textdateien (.txt, .md, .csv, .json) und schreibt Sprachnachrichten mit. " +
                    "PDF und Word liest er in Matrix nicht; in Allgemein schickt die App deshalb Seiten als Bilder " +
                    "und den Text von Word-Dateien mit.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun MenueKachel(icon: ImageVector, titel: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = modifier) {
        Column(Modifier.padding(vertical = 18.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, Modifier.size(30.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            Spacer(Modifier.height(8.dp))
            Text(titel, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

fun anhangSymbol(mime: String?, art: String?): ImageVector = when {
    art == "m.video" || mime?.startsWith("video/") == true -> Icons.Outlined.VideoFile
    art == "m.audio" || mime?.startsWith("audio/") == true -> Icons.Outlined.AudioFile
    mime == "application/pdf" -> Icons.Outlined.PictureAsPdf
    mime?.startsWith("text/") == true || mime?.contains("json") == true -> Icons.Outlined.Description
    else -> Icons.Outlined.AttachFile
}

/** „PDF“, „Video“, „Audio“ …: kurz, für die Karte. */
fun anhangArtText(mime: String?, art: String?, name: String): String {
    val endung = name.substringAfterLast('.', "").uppercase().takeIf { it.length in 1..5 }
    return when {
        art == "m.video" || mime?.startsWith("video/") == true -> "Video"
        art == "m.audio" || mime?.startsWith("audio/") == true -> "Audio"
        art == "m.image" || mime?.startsWith("image/") == true -> "Bild"
        mime == "application/pdf" -> "PDF"
        endung != null -> endung
        else -> "Datei"
    }
}

fun dauerKurz(ms: Long?): String {
    val s = ((ms ?: 0) / 1000).coerceAtLeast(0)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

/** Der wartende Anhang in der Eingabe, mit Entfernen. */
@Composable
fun AnhangVorschau(stand: AnhangStand, hinweis: String? = null) {
    val a = stand.anhang
    if (a == null && !stand.laedt) return
    val f = MaterialTheme.colorScheme
    Row(Modifier.padding(start = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)).background(f.surfaceContainerHighest), contentAlignment = Alignment.Center) {
            val bild = a?.vorschau
            when {
                a == null -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                bild != null -> Image(remember(bild) { bild.asImageBitmap() }, "Gewähltes Bild", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else -> Icon(anhangSymbol(a.mime, a.art.msgtype), null, tint = f.primary)
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(a?.name ?: "wird vorbereitet …", style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (a != null) {
                Text(
                    buildList {
                        add(anhangArtText(a.mime, a.art.msgtype, a.name))
                        if (a.breite != null && a.hoehe != null) add("${a.breite} × ${a.hoehe}")
                        a.dauerMs?.let { add(dauerKurz(it)) }
                        add(groesseText(a.groesse))
                    }.joinToString(" · ") + if (a.art == AnhangArt.BILD) " · Text wird zur Bildunterschrift" else " · Text geht als Beschreibung mit",
                    style = MaterialTheme.typography.labelSmall,
                    color = f.onSurfaceVariant,
                    maxLines = 2,
                )
                hinweis?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = f.primary, maxLines = 2) }
            }
        }
        IconButton(onClick = { stand.anhang = null }, enabled = a != null) { Icon(Icons.Outlined.Close, "Anhang entfernen") }
    }
}

/**
 * Das Mikrofon: gedrückt halten nimmt auf, loslassen sendet, nach links wischen bricht ab. Bleibt an
 * seinem Platz, solange der Finger darauf ist; die Eingabe zeigt derweil [AufnahmeZeile].
 */
@Composable
fun SprachKnopf(stand: AnhangStand, aktiv: Boolean, vm: SchwarmViewModel, onFertig: (Anhang) -> Unit) {
    val kontext = LocalContext.current
    val haptik = LocalHapticFeedback.current
    val schwelle = with(LocalDensity.current) { 110.dp.toPx() }
    var erlaubt by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(kontext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }
    val anfrage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        erlaubt = ok
        vm.melden(if (ok) "Mikrofon erlaubt. Jetzt gedrückt halten und sprechen." else "Ohne Mikrofon keine Sprachnachricht.")
    }
    val f = MaterialTheme.colorScheme
    val nimmtAuf = stand.aufnahme != null
    Box(
        Modifier
            .padding(bottom = 4.dp)
            .size(48.dp)
            .clip(CircleShape)
            .background(if (nimmtAuf) f.error else if (aktiv) f.primary else f.onSurface.copy(alpha = 0.12f))
            .pointerInput(aktiv, erlaubt) {
                if (!aktiv) return@pointerInput
                awaitEachGesture {
                    val runter = awaitFirstDown(requireUnconsumed = false)
                    if (!erlaubt) {
                        anfrage.launch(Manifest.permission.RECORD_AUDIO)
                        return@awaitEachGesture
                    }
                    val auf = try {
                        Aufnahme(kontext).also { it.starten() }
                    } catch (e: Exception) {
                        vm.melden("Aufnahme nicht möglich: ${e.message ?: e.javaClass.simpleName}")
                        return@awaitEachGesture
                    }
                    haptik.performHapticFeedback(HapticFeedbackType.LongPress)
                    stand.pegel.clear()
                    stand.versatz = 0f
                    stand.aufnahmeMs = 0
                    stand.aufnahme = auf
                    var abbrechen = false
                    while (true) {
                        val ev = awaitPointerEvent()
                        val c = ev.changes.firstOrNull { it.id == runter.id }
                        if (c == null) {
                            abbrechen = true
                            break
                        }
                        stand.versatz = (c.position.x - runter.position.x).coerceAtMost(0f)
                        abbrechen = stand.versatz < -schwelle
                        c.consume()
                        if (!c.pressed) break
                    }
                    val dauer = auf.dauerMs
                    val zuKurz = dauer < 700
                    val welle = auf.beenden(behalten = !abbrechen && !zuKurz)
                    stand.aufnahme = null
                    stand.versatz = 0f
                    when {
                        abbrechen -> haptik.performHapticFeedback(HapticFeedbackType.LongPress)
                        zuKurz -> vm.melden("Zum Aufnehmen gedrückt halten, loslassen sendet.")
                        else -> runCatching { AnhangLeser.sprache(auf.datei, auf.mime, dauer, welle) }
                            .onSuccess(onFertig)
                            .onFailure { vm.melden("Die Aufnahme liess sich nicht lesen.") }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Mic, "Sprachnachricht (gedrückt halten)", tint = if (nimmtAuf) f.onError else if (aktiv) f.onPrimary else f.onSurface.copy(alpha = 0.38f))
    }
    // Pegel und Zeit, solange aufgenommen wird.
    val auf = stand.aufnahme
    LaunchedEffect(auf) {
        if (auf == null) return@LaunchedEffect
        while (stand.aufnahme === auf) {
            stand.pegel.add(auf.pegel())
            if (stand.pegel.size > 48) stand.pegel.removeAt(0)
            stand.aufnahmeMs = auf.dauerMs
            delay(100)
        }
    }
}

/** Statt des Eingabefelds, solange aufgenommen wird: Punkt, Zeit, Pegel und der Hinweis zum Abbrechen. */
@Composable
fun AufnahmeZeile(stand: AnhangStand, modifier: Modifier = Modifier) {
    val f = MaterialTheme.colorScheme
    val puls = rememberInfiniteTransition(label = "puls")
    val alpha by puls.animateFloat(0.35f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "alpha")
    val schwelle = with(LocalDensity.current) { 110.dp.toPx() }
    val abbrechen = stand.versatz < -schwelle
    Surface(color = if (abbrechen) f.errorContainer else f.surfaceContainerHighest, shape = RoundedCornerShape(24.dp), modifier = modifier.height(52.dp)) {
        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(f.error.copy(alpha = alpha)))
            Spacer(Modifier.width(10.dp))
            Text(dauerKurz(stand.aufnahmeMs), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(12.dp))
            val farbe = f.primary
            Canvas(Modifier.weight(1f).height(28.dp)) {
                val werte = stand.pegel
                val n = 48
                val breite = size.width / n
                for (i in 0 until n) {
                    val v = werte.getOrNull(werte.size - n + i) ?: 0f
                    val h = max(3f, v * size.height)
                    drawRoundRect(
                        farbe.copy(alpha = if (v > 0f) 0.9f else 0.25f),
                        topLeft = Offset(i * breite + breite * 0.2f, (size.height - h) / 2),
                        size = Size(breite * 0.6f, h),
                        cornerRadius = CornerRadius(breite, breite),
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Text(
                if (abbrechen) "Loslassen bricht ab" else "‹ wischen: abbrechen",
                style = MaterialTheme.typography.labelMedium,
                color = if (abbrechen) f.onErrorContainer else f.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

/** Ein Anhang in einer Nachricht: Bild wie bisher, Audio zum Abspielen, sonst die Karte. */
@Composable
fun AnhangAnzeige(d: Datei, a: Aktionen) {
    when {
        d.bild -> BildAnsicht(d, a)
        d.audio -> AudioSpieler(d, a)
        else -> DateiKarte(d, a)
    }
}

/** Video und Dateien: Symbol, Name, Grösse; Öffnen, Teilen, Speichern über den FileProvider. */
@Composable
fun DateiKarte(d: Datei, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    val kontext = LocalContext.current
    val scope = rememberCoroutineScope()
    val medien by a.vm.medien.collectAsStateWithLifecycle()
    val laedt = d.mxc?.let { medien[it] } is Ladung.Laeuft
    val mime = d.mime ?: "application/octet-stream"
    val speichern = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mime)) { ziel ->
        ziel?.let { a.vm.dateiSpeichern(d, it) }
    }
    fun mitDatei(tun: (Uri) -> Unit) {
        scope.launch {
            val datei = a.vm.dateiHolen(d) ?: return@launch
            val uri = runCatching { FileProvider.getUriForFile(kontext, dateiAnbieter(kontext), datei) }.getOrNull()
                ?: return@launch a.vm.melden("Die Datei liess sich nicht freigeben.")
            tun(uri)
        }
    }
    Surface(color = f.surfaceContainerHighest, contentColor = f.onSurface, shape = RoundedCornerShape(14.dp), modifier = Modifier.widthIn(max = 360.dp)) {
        Column(Modifier.padding(start = 12.dp, end = 6.dp, top = 12.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 6.dp)) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(f.primaryContainer), contentAlignment = Alignment.Center) {
                    if (laedt) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = f.onPrimaryContainer)
                    } else {
                        Icon(anhangSymbol(d.mime, d.art), null, tint = f.onPrimaryContainer)
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f, fill = false)) {
                    Text(d.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        buildList {
                            add(anhangArtText(d.mime, d.art, d.name))
                            if (d.dauerMs != null) add(dauerKurz(d.dauerMs))
                            if (d.breite != null && d.hoehe != null && d.video) add("${d.breite} × ${d.hoehe}")
                            d.groesse?.let { add(groesseText(it)) }
                        }.joinToString(" · "),
                        style = MaterialTheme.typography.labelMedium,
                        color = f.onSurfaceVariant,
                    )
                }
            }
            Row(Modifier.padding(top = 2.dp)) {
                TextButton(onClick = {
                    mitDatei { uri ->
                        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        try {
                            kontext.startActivity(i)
                        } catch (e: ActivityNotFoundException) {
                            a.vm.melden("Keine App auf dem Gerät öffnet ${anhangArtText(d.mime, d.art, d.name)}-Dateien.")
                        }
                    }
                }, enabled = d.mxc != null && !laedt) {
                    Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Öffnen")
                }
                TextButton(onClick = {
                    mitDatei { uri ->
                        val i = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        kontext.startActivity(Intent.createChooser(i, d.name))
                    }
                }, enabled = d.mxc != null && !laedt) {
                    Icon(Icons.Outlined.Share, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Teilen")
                }
                TextButton(onClick = {
                    try {
                        speichern.launch(d.name)
                    } catch (e: ActivityNotFoundException) {
                        a.vm.melden("Speichern geht auf diesem Gerät nicht.")
                    }
                }, enabled = d.mxc != null && !laedt) {
                    Icon(Icons.Outlined.Download, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Speichern")
                }
            }
        }
    }
}

/** Audio in der Nachricht: Abspielen und Pause, Zeitleiste, Dauer; Sprachnachrichten als Balken. */
@Composable
fun AudioSpieler(d: Datei, a: Aktionen) {
    val f = MaterialTheme.colorScheme
    val w by a.vm.wiedergabe.collectAsStateWithLifecycle()
    val aktiv = w?.mxc != null && w?.mxc == d.mxc
    val laedt = aktiv && w?.laedt == true
    val laeuft = aktiv && w?.laeuft == true
    val dauer = if (aktiv && (w?.dauerMs ?: 0) > 0) w!!.dauerMs else d.dauerMs ?: 0L
    val pos = if (aktiv) w?.positionMs ?: 0L else 0L
    val anteil = if (dauer > 0) (pos.toFloat() / dauer).coerceIn(0f, 1f) else 0f
    Surface(color = f.surfaceContainerHighest, contentColor = f.onSurface, shape = RoundedCornerShape(24.dp), modifier = Modifier.widthIn(min = 220.dp, max = 360.dp)) {
        Row(Modifier.padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledIconButton(
                onClick = { a.vm.abspielen(d) },
                enabled = d.mxc != null,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = f.primary, contentColor = f.onPrimary),
            ) {
                if (laedt) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = f.onPrimary)
                } else {
                    Icon(if (laeuft) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (laeuft) "Pause" else "Abspielen")
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                if (d.sprache) {
                    Welle(d.welle, anteil, aktiv) { a.vm.suchen(d, it) }
                } else {
                    Text(d.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Slider(
                        value = anteil,
                        onValueChange = { a.vm.suchen(d, it) },
                        enabled = aktiv && !laedt,
                        modifier = Modifier.height(28.dp),
                    )
                }
                Text(
                    (if (aktiv) "${dauerKurz(pos)} / " else "") + dauerKurz(dauer) + if (d.sprache) " · Sprachnachricht" else "",
                    style = MaterialTheme.typography.labelSmall,
                    color = f.onSurfaceVariant,
                )
            }
        }
    }
}

/** Die Welle einer Sprachnachricht; ohne Daten ein ruhiges Muster. Tippen springt. */
@Composable
private fun Welle(welle: List<Int>?, anteil: Float, aktiv: Boolean, onSuchen: (Float) -> Unit) {
    val f = MaterialTheme.colorScheme
    val werte = remember(welle) {
        val roh = welle?.takeIf { it.isNotEmpty() } ?: List(40) { i -> 300 + (abs((i * 37) % 11 - 5)) * 90 }
        val n = 40
        List(n) { i -> roh[(i * roh.size) / n].coerceIn(0, 1024) / 1024f }
    }
    val gespielt = f.primary
    val rest = f.onSurfaceVariant.copy(alpha = 0.35f)
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(30.dp)
            .pointerInput(aktiv) { detectTapGestures { p -> if (aktiv) onSuchen(p.x / size.width) } },
    ) {
        val breite = size.width / werte.size
        werte.forEachIndexed { i, v ->
            val h = max(3f, v * size.height)
            val anteilHier = (i + 0.5f) / werte.size
            drawRoundRect(
                if (anteilHier <= anteil) gespielt else rest,
                topLeft = Offset(i * breite + breite * 0.2f, (size.height - h) / 2),
                size = Size(breite * 0.6f, h),
                cornerRadius = CornerRadius(breite, breite),
            )
        }
    }
}

/** Die Knöpfe links und rechts einer Eingabe mit Anhängen: Büroklammer und Mikrofon oder Senden. */
@Composable
fun AnhangKnopf(stand: AnhangStand, aktiv: Boolean) {
    IconButton(
        onClick = { stand.menue = true },
        enabled = aktiv && !stand.laedt && stand.aufnahme == null,
        modifier = Modifier.padding(bottom = 4.dp),
    ) { Icon(Icons.Outlined.AttachFile, "Anhängen") }
}

/** Senden: gefüllt, solange es etwas zu senden gibt. */
@Composable
fun SendenKnopf(aktiv: Boolean, sendet: Boolean, onClick: () -> Unit) {
    FilledIconButton(onClick = onClick, enabled = aktiv && !sendet, modifier = Modifier.padding(bottom = 4.dp)) {
        if (sendet) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        } else {
            Icon(Icons.AutoMirrored.Filled.Send, "Senden")
        }
    }
}
