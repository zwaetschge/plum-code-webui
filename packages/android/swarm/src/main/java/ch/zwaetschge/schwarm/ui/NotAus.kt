@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.claudewebui.swarm.ui

import android.app.KeyguardManager
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.PowerSettingsNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.NotAusSchluessel
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Verbindung
import com.claudewebui.swarm.data.VorschauArt
import com.claudewebui.swarm.data.Zugang
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.net.URI
import kotlin.coroutines.resume

/**
 * Bestätigung mit Biometrie oder PIN über das BiometricPrompt des Systems (ab Android 9), ohne
 * Zusatzbibliothek. Ohne Displaysperre gibt es nichts zu bestätigen: Dann entscheidet der Aufrufer,
 * ob die Rückfrage genügt (Not-Aus) oder ob er ablehnt (Zusammenführen).
 */
object Biometrie {
    enum class Ergebnis { OK, ABGEBROCHEN, NICHT_EINGERICHTET, FEHLER }

    fun eingerichtet(context: Context): Boolean =
        Build.VERSION.SDK_INT >= 28 && context.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    suspend fun bestaetigen(context: Context, titel: String, text: String): Pair<Ergebnis, String?> {
        if (Build.VERSION.SDK_INT < 28) return Ergebnis.NICHT_EINGERICHTET to "Biometrie braucht Android 9 oder neuer."
        if (!eingerichtet(context)) return Ergebnis.NICHT_EINGERICHTET to "Auf diesem Gerät ist keine Displaysperre eingerichtet."
        return fragen(context, titel, text)
    }

    @RequiresApi(28)
    private suspend fun fragen(context: Context, titel: String, text: String): Pair<Ergebnis, String?> =
        suspendCancellableCoroutine { weiter ->
            val abbruch = CancellationSignal()
            weiter.invokeOnCancellation { abbruch.cancel() }
            val ausfuehren = context.mainExecutor
            val prompt = BiometricPrompt.Builder(context)
                .setTitle(titel)
                .setSubtitle(text)
                .apply {
                    when {
                        Build.VERSION.SDK_INT >= 30 -> setAllowedAuthenticators(
                            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
                        )
                        Build.VERSION.SDK_INT == 29 -> @Suppress("DEPRECATION") setDeviceCredentialAllowed(true)
                        // Android 9 kennt nur Biometrie; der Knopf „Abbrechen“ meldet sich hier, nicht als Fehler.
                        else -> setNegativeButton("Abbrechen", ausfuehren) { _, _ ->
                            if (weiter.isActive) weiter.resume(Ergebnis.ABGEBROCHEN to null)
                        }
                    }
                }
                .build()
            prompt.authenticate(
                abbruch,
                ausfuehren,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                        if (weiter.isActive) weiter.resume(Ergebnis.OK to null)
                    }

                    override fun onAuthenticationError(code: Int, meldung: CharSequence?) {
                        val e = when (code) {
                            BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED,
                            BiometricPrompt.BIOMETRIC_ERROR_CANCELED,
                            -> Ergebnis.ABGEBROCHEN
                            BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT,
                            BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE,
                            BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS,
                            BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL,
                            -> Ergebnis.NICHT_EINGERICHTET
                            else -> Ergebnis.FEHLER
                        }
                        if (weiter.isActive) weiter.resume(e to meldung?.toString())
                    }
                },
            )
        }
}

/** `schwarm.zwaetschge-webui.ch` aus der Not-Aus-Adresse, für die Anzeige. */
private fun host(url: String?): String = runCatching { URI(url ?: "").host }.getOrNull() ?: "den Hub"

private fun aktionTitel(aktion: String): String = when (aktion) {
    "stopp" -> "Schwarm anhalten"
    "weiter" -> "Schwarm auftauen"
    else -> "Stand abfragen"
}

/**
 * Not-Aus: `!stop` über Matrix wie bisher, dazu der direkte Weg ohne Matrix (Punkt 18), signiert
 * mit dem Schlüssel des Geräts und mit Biometrie bestätigt. Ist Matrix gestört, steht er oben.
 */
@Composable
fun NotAusDialog(vm: SchwarmViewModel, z: SchwarmZustand, onSchliessen: () -> Unit, nurDirekt: Boolean = false) {
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    val kontext = LocalContext.current
    val scope = rememberCoroutineScope()
    var laeuftBiometrie by remember { mutableStateOf(false) }
    val gestoert = z.verbindung == Verbindung.FEHLER || z.ausSpeicher != null
    fun direkt(aktion: String) {
        if (laeuftBiometrie) return
        laeuftBiometrie = true
        scope.launch {
            val (e, grund) = Biometrie.bestaetigen(kontext, "Not-Aus ohne Matrix", aktionTitel(aktion))
            laeuftBiometrie = false
            when (e) {
                // Ohne Displaysperre verlangt auch der Schlüssel keine Bestätigung: Die Rückfrage hier genügt.
                Biometrie.Ergebnis.OK, Biometrie.Ergebnis.NICHT_EINGERICHTET -> {
                    vm.notAusDirekt(aktion)
                    onSchliessen()
                }
                Biometrie.Ergebnis.ABGEBROCHEN -> Unit
                Biometrie.Ergebnis.FEHLER -> vm.melden("Biometrie fehlgeschlagen: ${grund ?: "unbekannt"}")
            }
        }
    }
    AlertDialog(
        onDismissRequest = onSchliessen,
        icon = { Icon(Icons.Outlined.PanTool, null, tint = MaterialTheme.colorScheme.error) },
        title = { Text("Not-Aus") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (gestoert && notAus.bereit) {
                    HinweisKarte(
                        Icons.Outlined.CloudOff,
                        "Matrix antwortet gerade nicht",
                        "Nimm den direkten Weg unten: Er geht ohne Synapse und ohne Hub-Räume.",
                        StatusKritisch,
                    )
                }
                if (!nurDirekt) {
                    Text(
                        reicherText(
                            "`!stop` friert den ganzen Schwarm ein: keine neuen Aufträge, keine Übergaben, laufende " +
                                "werden abgebrochen. Auftauen mit `!weiter`.",
                            MaterialTheme.colorScheme,
                        ),
                    )
                    HorizontalDivider()
                }
                Text("Ohne Matrix", style = MaterialTheme.typography.titleSmall)
                if (notAus.bereit) {
                    Text(
                        reicherText(
                            "Signiert mit dem Schlüssel dieses Geräts, direkt an ${host(notAus.url)}. „Direkt anhalten“ friert ein wie " +
                                "`!stop` und bricht alle offenen Aufträge ab; die Worker bekommen `cancel`." +
                                if (notAus.vorschau) " In der Vorschau geht nichts raus." else "",
                            MaterialTheme.colorScheme,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (!notAus.angemeldet && !notAus.vorschau) {
                        Text(
                            "Der Hub führt dieses Gerät noch nicht. Ohne Anmeldung lehnt er mit 401 ab.",
                            style = MaterialTheme.typography.bodySmall,
                            color = StatusWarnung,
                        )
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Button(
                            onClick = { direkt("stopp") },
                            enabled = !notAus.laeuft && !laeuftBiometrie,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error,
                                contentColor = MaterialTheme.colorScheme.onError,
                            ),
                        ) {
                            Icon(Icons.Outlined.Fingerprint, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Direkt anhalten")
                        }
                        TextButton(onClick = { direkt("weiter") }, enabled = !notAus.laeuft && !laeuftBiometrie) { Text("Direkt weiter") }
                        TextButton(onClick = { direkt("stand") }, enabled = !notAus.laeuft && !laeuftBiometrie) { Text("Stand") }
                    }
                    if (notAus.laeuft) Wartet("Not-Aus unterwegs …")
                } else {
                    Text(
                        when {
                            !notAus.schluessel -> "Noch nicht eingerichtet: Melde dieses Gerät in den Einstellungen unter „Not-Aus ohne Matrix“ an."
                            notAus.url == null -> "Der Hub hat noch keine Not-Aus-Adresse gemeldet (Event ch.zwaetschge.swarm.notaus)."
                            else -> "Noch nicht bereit."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            if (nurDirekt) {
                TextButton(onClick = onSchliessen) { Text("Schliessen") }
            } else {
                Button(
                    onClick = { vm.notAus(); onSchliessen() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) { Text("Schwarm anhalten") }
            }
        },
        dismissButton = {
            if (!nurDirekt) {
                Row {
                    TextButton(onClick = { vm.weiter(); onSchliessen() }) { Text("!weiter") }
                    TextButton(onClick = onSchliessen) { Text("Abbrechen") }
                }
            }
        },
    )
}

/**
 * Die Antwort des Hubs auf einen Not-Aus ohne Matrix: eingefroren, offene und laufende Aufträge. Ist
 * der Hub nicht erreichbar, steht dazu der letzte gespeicherte Stand.
 */
@Composable
fun NotAusAntwortDialog(vm: SchwarmViewModel) {
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    val z by vm.schwarm.collectAsStateWithLifecycle()
    val antwort = notAus.antwort ?: return
    AlertDialog(
        onDismissRequest = { vm.notAusAntwortGelesen() },
        icon = {
            Icon(
                Icons.Outlined.PowerSettingsNew,
                null,
                tint = if (antwort.ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            )
        },
        title = { Text("${aktionTitel(antwort.aktion)}: " + if (antwort.ok) "angekommen" else "fehlgeschlagen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                antwort.fehler?.let { Text(it, color = if (antwort.ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error) }
                antwort.eingefroren?.let {
                    Text(if (it) "❄️ Der Schwarm ist eingefroren." else "▶️ Der Schwarm läuft.", style = MaterialTheme.typography.bodyLarge)
                }
                antwort.offen?.let { Text("Offene Aufträge: $it") }
                antwort.laufend?.let { Text("Laufende Aufträge: $it") }
                if (antwort.hubWeg) {
                    // Der Hub ist weg: der letzte Stand, den die App gespeichert hat (Punkt 18).
                    val jetzt = System.currentTimeMillis()
                    HinweisKarte(
                        Icons.Outlined.CloudOff,
                        "Letzter gespeicherter Stand" + (z.standZeit.takeIf { it > 0 }?.let { " von ${zeitText(it)}" } ?: ""),
                        if (z.standZeit <= 0) {
                            "Auf diesem Gerät ist kein Stand gespeichert."
                        } else {
                            "${z.auftraege.count { it.zustand.offen }} Aufträge offen · " +
                                "${z.freigaben.count { it.offenUm(jetzt) }} Freigaben offen · " +
                                "${z.alarme.count { it.offenUm(jetzt) }} Alarme offen. „Aktuell“ zeigt ihn im Detail."
                        },
                        StatusWarnung,
                    )
                }
                Text(
                    "Um ${zeitText(antwort.zeit)}" + (antwort.status.takeIf { it > 0 }?.let { " · HTTP $it" } ?: ""),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        },
        confirmButton = { Button(onClick = { vm.notAusAntwortGelesen() }) { Text("OK") } },
    )
}

/**
 * Einstellungen des Not-Aus ohne Matrix: dieses Gerät anmelden (`!geraet neu`), abmelden
 * (`!geraet weg`), den Stand direkt abfragen und die Geräte sehen, die der Hub führt.
 */
@Composable
fun NotAusEinstellungen(vm: SchwarmViewModel, z: SchwarmZustand) {
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    val kontext = LocalContext.current
    var anmelden by remember { mutableStateOf(false) }
    var abmelden by remember { mutableStateOf<String?>(null) }
    var fragen by remember { mutableStateOf(false) }
    val geraete = z.hub.notaus?.geraete.orEmpty()
    Abschnitt("Not-Aus ohne Matrix", Modifier.padding(horizontal = 12.dp))
    ListItem(
        headlineContent = {
            Text(
                when {
                    notAus.schluessel && notAus.angemeldet -> "✅ Angemeldet als ${notAus.name ?: "dieses Gerät"}"
                    notAus.schluessel -> "⏳ Angemeldet? Der Hub führt dieses Gerät noch nicht"
                    else -> "Nicht eingerichtet"
                },
            )
        },
        supportingContent = {
            Text(
                listOfNotNull(
                    notAus.geraetId?.let { "Geräte-ID $it" },
                    if (notAus.schluessel) {
                        if (notAus.mitBiometrie) "Schlüssel im Android-Keystore, nur mit Biometrie oder PIN nutzbar"
                        else "Schlüssel im Android-Keystore; ohne Displaysperre genügt die Rückfrage"
                    } else {
                        "Ein Schlüssel im Android-Keystore signiert den Not-Aus, auch wenn Synapse oder Hub nicht antworten."
                    },
                    notAus.url?.let { "Adresse $it" } ?: "Der Hub hat noch keine Adresse gemeldet.",
                ).joinToString("\n"),
            )
        },
    )
    FlowRow(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // In der Vorschau lässt sich der Schlüssel echt erzeugen (ohne zu senden), um die Biometrie zu prüfen.
        val echterSchluessel = remember(notAus) { NotAusSchluessel.vorhanden() }
        if (!notAus.schluessel || !notAus.angemeldet || (notAus.vorschau && !echterSchluessel)) {
            Button(onClick = { anmelden = true }) {
                Text(if (notAus.schluessel && !notAus.vorschau) "Noch einmal anmelden" else "Gerät anmelden")
            }
        }
        if (notAus.bereit) OutlinedButton(onClick = { fragen = true }) { Text("Stand direkt abfragen") }
        if (notAus.schluessel && notAus.geraetId != null) {
            TextButton(onClick = { abmelden = notAus.geraetId }) { Text("Abmelden") }
        }
    }
    if (geraete.isNotEmpty()) {
        Text(
            "Geräte beim Hub",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, top = 8.dp),
        )
        geraete.forEach { g ->
            ListItem(
                headlineContent = { Text(g.name + if (g.id == notAus.geraetId) " (dieses Gerät)" else "") },
                supportingContent = { Text(listOfNotNull(g.id, g.erstellt?.let { "seit ${zeitText(it)}" }).joinToString(" · ")) },
                trailingContent = { TextButton(onClick = { abmelden = g.id }) { Text("abmelden") } },
            )
        }
    }
    if (anmelden) {
        var name by remember { mutableStateOf(notAus.name ?: Build.MODEL) }
        AlertDialog(
            onDismissRequest = { anmelden = false },
            icon = { Icon(Icons.Outlined.Fingerprint, null) },
            title = { Text("Gerät für den Not-Aus anmelden") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        reicherText(
                            "Die App erzeugt einen Schlüssel im Android-Keystore und schickt `!geraet neu <name> <öffentlicher Schlüssel>` in die Lobby. " +
                                "Der private Schlüssel verlässt das Gerät nie.",
                            MaterialTheme.colorScheme,
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it.take(40) },
                        label = { Text("Name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(onClick = { vm.geraetAnmelden(name); anmelden = false }, enabled = name.isNotBlank()) { Text("Anmelden") }
            },
            dismissButton = { TextButton(onClick = { anmelden = false }) { Text("Abbrechen") } },
        )
    }
    abmelden?.let { id ->
        val eigenes = id == notAus.geraetId
        AlertDialog(
            onDismissRequest = { abmelden = null },
            title = { Text("Gerät $id abmelden?") },
            text = {
                Text(
                    reicherText(
                        "`!geraet weg $id` in die Lobby." + if (eigenes) " Danach löscht die App den Schlüssel auf diesem Gerät." else "",
                        MaterialTheme.colorScheme,
                    ),
                )
            },
            confirmButton = { Button(onClick = { vm.geraetAbmelden(id); abmelden = null }) { Text("Abmelden") } },
            dismissButton = { TextButton(onClick = { abmelden = null }) { Text("Behalten") } },
        )
    }
    if (fragen) {
        val scope = rememberCoroutineScope()
        AlertDialog(
            onDismissRequest = { fragen = false },
            title = { Text("Stand direkt abfragen?") },
            text = { Text("Nur lesen: Die App signiert „stand“ und fragt den Hub ohne Matrix. Mit Biometrie, falls eingerichtet.") },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        val (e, grund) = Biometrie.bestaetigen(kontext, "Not-Aus ohne Matrix", "Stand abfragen")
                        when (e) {
                            Biometrie.Ergebnis.OK, Biometrie.Ergebnis.NICHT_EINGERICHTET -> vm.notAusDirekt("stand")
                            Biometrie.Ergebnis.ABGEBROCHEN -> Unit
                            Biometrie.Ergebnis.FEHLER -> vm.melden("Biometrie fehlgeschlagen: ${grund ?: "unbekannt"}")
                        }
                        fragen = false
                    }
                }) { Text("Abfragen") }
            },
            dismissButton = { TextButton(onClick = { fragen = false }) { Text("Abbrechen") } },
        )
    }
}

/** Nur in der Vorschau: als Vale, Gast oder ohne Zugang ansehen, dazu Störung und neuere Hub-Version. */
@Composable
fun VorschauEinstellungen(vm: SchwarmViewModel) {
    val art by vm.vorschauArt.collectAsStateWithLifecycle()
    Abschnitt("Vorschau ausprobieren", Modifier.padding(horizontal = 12.dp))
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(Zugang.VALE to "Vale", Zugang.GAST to "Gast", Zugang.KEIN_ZUGANG to "ohne Zugang").forEach { (z, titel) ->
            FilterChip(selected = art.zugang == z, onClick = { vm.vorschauUmstellen(art.copy(zugang = z)) }, label = { Text(titel) })
        }
    }
    ListItem(
        headlineContent = { Text("Verbindung gestört") },
        supportingContent = { Text("Zeigt den letzten bekannten Stand mit Zeitstempel.") },
        trailingContent = { Switch(checked = art.gestoert, onCheckedChange = { vm.vorschauUmstellen(art.copy(gestoert = it)) }) },
    )
    ListItem(
        headlineContent = { Text("Neuere Hub-Version") },
        supportingContent = { Text("Die Routinen kommen mit v: 2: „bitte App aktualisieren“.") },
        trailingContent = { Switch(checked = art.neuereVersion, onCheckedChange = { vm.vorschauUmstellen(art.copy(neuereVersion = it)) }) },
    )
}

/**
 * Ein anderes Konto als Vales ohne Rollen-Event: „kein Zugang zum Schwarm“ (Punkt 16). Solange die
 * Lobby noch nicht gelesen ist, heisst es „wird geprüft“.
 */
@Composable
fun KeinZugangAnsicht(z: SchwarmZustand, vm: SchwarmViewModel) {
    val vorschau by vm.vorschau.collectAsStateWithLifecycle()
    val prueft = z.rolle.zugang == Zugang.PRUEFT
    Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(
                if (prueft) Icons.Outlined.HourglassTop else Icons.Outlined.PersonOff,
                null,
                Modifier.size(56.dp),
                tint = MaterialTheme.colorScheme.outline,
            )
            Text(
                if (prueft) "Zugang wird geprüft …" else "Kein Zugang zum Schwarm",
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
            )
            Text(
                if (prueft) {
                    if (z.einladungen.isNotEmpty()) "Tritt zuerst der Lobby bei; dort steht, was du im Schwarm darfst."
                    else "Die App liest gerade die Lobby: Dort steht, was ${z.ich} im Schwarm darf."
                } else {
                    "Für ${z.ich} gibt es im Schwarm keine Rolle. Vale muss dich zuerst als Gast eintragen; danach siehst du hier deine Agenten und Befehle."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            if (z.einladungen.isNotEmpty()) {
                Button(onClick = { vm.einladungenAnnehmen() }) { Text("Allen beitreten") }
            }
            if (vorschau) {
                OutlinedButton(onClick = { vm.vorschauUmstellen(VorschauArt()) }) { Text("Vorschau als Vale") }
            }
            TextButton(onClick = { vm.abmelden() }) { Text("Abmelden") }
        }
    }
}
