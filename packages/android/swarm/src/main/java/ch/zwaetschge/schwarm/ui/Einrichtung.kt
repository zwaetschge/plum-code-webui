package com.claudewebui.swarm.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Rocket
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.BuildConfig
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.hintergrund.Hintergrund
import com.claudewebui.swarm.hintergrund.RuheSpeicher
import kotlinx.coroutines.delay

// ── Einrichtung (App 2.9, Verbesserung 1) ───────────────────────────────────

/**
 * Ein Schritt der Einrichtung. `erledigt` rechnet die App selbst aus dem Stand aus (Worker online, Push beim Hub
 * angemeldet …); nur was sie nicht sehen kann, hakst du von Hand ab (`manuell`).
 */
data class Schritt(
    val id: String,
    val titel: String,
    val text: String,
    val erledigt: Boolean,
    val knopf: String? = null,
    val handlung: (() -> Unit)? = null,
    val manuell: Boolean = false,
    /** Wahlweise: zählt nicht als offen auf der Karte in „Aktuell“. */
    val wahlweise: Boolean = false,
)

private fun darfMelden(k: Context) = Build.VERSION.SDK_INT < 33 ||
    ContextCompat.checkSelfPermission(k, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

private fun ohneAkkuSparen(k: Context) =
    k.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(k.packageName) == true

private fun oeffnen(k: Context, intent: Intent) {
    runCatching { k.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/** Alle Schritte mit ihrem Stand; `neu` zählt hoch, wenn sich etwas ausserhalb der Flows geändert haben kann. */
@Composable
fun einrichtungsSchritte(vm: SchwarmViewModel, z: SchwarmZustand, a: Aktionen): List<Schritt> {
    val k = LocalContext.current
    val push by vm.push.collectAsStateWithLifecycle()
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    val erledigt by vm.einrichtungErledigt.collectAsStateWithLifecycle()
    var neu by remember { mutableIntStateOf(0) }
    val anfrage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { neu++ }
    // Erlaubnis und Akku ändern sich in den Systemeinstellungen: alle 2 s neu lesen, solange der Schritt offen ist.
    LaunchedEffect(Unit) { while (true) { delay(2_000); neu++ } }
    val verteiler = remember(neu) { vm.pushVerteiler() }
    val melden = remember(neu) { darfMelden(k) }
    val akku = remember(neu) { ohneAkkuSparen(k) }
    val amHub = z.hub.notaus?.geraete?.firstOrNull { it.id == notAus.geraetId }?.push
    fun online(id: String) = z.agent(id)?.status == AgentStatus.ONLINE
    val update = vm.neueVersion(z)
    return listOfNotNull(
        Schritt(
            "raeume", "Schwarm-Räume beitreten",
            if (z.einladungen.isEmpty()) "Du bist in allen Räumen." else "${z.einladungen.size} Einladungen warten.",
            z.einladungen.isEmpty(), "Alle annehmen", { vm.einladungenAnnehmen() },
        ),
        Schritt(
            "melden", "Benachrichtigungen erlauben",
            if (melden) "Erlaubt." else "Ohne Erlaubnis bleibt die App stumm, auch bei Freigaben.",
            melden, "Erlauben",
            { if (Build.VERSION.SDK_INT >= 33) anfrage.launch(Manifest.permission.POST_NOTIFICATIONS) },
        ),
        Schritt(
            "akku", "Akku-Optimierung für Schwarm aus",
            if (akku) "Aus: Android lässt die Weckrufe durch." else "Samsung schläfert Apps sonst ein, dann kommen Weckrufe erst Minuten später.",
            akku, "Einstellungen", { oeffnen(k, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) },
        ),
        Schritt(
            "ntfy", "ntfy installieren",
            if (verteiler.isNotEmpty()) "${verteiler.first().second} ist installiert." else "ntfy stellt die Weckrufe zu, in Sekunden statt alle 15 min.",
            verteiler.isNotEmpty(), "Im Store öffnen",
            { oeffnen(k, Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=io.heckel.ntfy"))) },
        ),
        Schritt(
            "notaus", "Gerät für den Not-Aus anmelden",
            if (notAus.angemeldet) "Angemeldet als ${notAus.name ?: notAus.geraetId?.take(8)}." else "Braucht es für den Not-Aus ohne Matrix und für die Sofort-Benachrichtigungen.",
            notAus.angemeldet, "Zu den Einstellungen", a.einstellungen,
        ),
        Schritt(
            "push", "Sofort-Benachrichtigungen einrichten",
            when {
                amHub?.fehler != null -> "Der Hub meldet: ${amHub.fehler}"
                push.endpoint != null && amHub != null -> "Aktiv über ${amHub.host}."
                else -> "Mit Fingerabdruck bestätigen; danach weckt der Hub die App."
            },
            push.endpoint != null && amHub != null && amHub.fehler == null,
            "Einrichten", { vm.pushEinrichten(k) },
        ),
        Schritt(
            "ruhe", "Ruhezeit festlegen",
            z.hub.ruhe?.takeIf { it.an }?.let { "Nachts ${it.von}–${it.bis} nur Dringendes." } ?: "Nachts wecken dann nur Freigaben, 🚨 und ⛔.",
            z.hub.ruhe?.an == true, "Festlegen", a.einstellungen, wahlweise = true,
        ),
        Schritt(
            "claude", "Claude-Code-Worker anmelden",
            if (online("claude-code")) "Online." else "Einmal im Terminal anmelden (Link öffnen, Code einfügen). Bis dahin übernimmt codex-host den Code.",
            online("claude-code"),
        ),
        Schritt(
            "codex", "Codex-Worker",
            if (online("codex-host")) "Online." else "Offline: Anmeldung von codex-host prüfen.",
            online("codex-host"),
        ),
        Schritt(
            "plum", "Plum-Token für die Brücke",
            if (z.hub.einheiten["plum"]?.verbunden == true) "Die Brücke ist verbunden." else "In Plum ein Gateway-Token erzeugen und der Brücke geben (`plum-bridge.py --plum-token`).",
            z.hub.einheiten["plum"]?.verbunden == true,
        ),
        Schritt(
            "mcp", "Plum darf Aufträge geben (MCP)",
            "Den Eintrag `schwarm` in Plums MCP-Liste freigeben. Das sieht die App nicht; hake es selbst ab.",
            "mcp" in erledigt, manuell = true, wahlweise = true,
        ),
        update?.let {
            Schritt("update", "Neue App-Version ${it.versionName}", "Installiert ist ${BuildConfig.VERSION_NAME}.", false, "Laden", { vm.appUpdateLaden() })
        },
    )
}

/** Karte in „Aktuell“, solange etwas offen ist. „Später“ blendet sie für einen Tag aus. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EinrichtungKarte(z: SchwarmZustand, a: Aktionen) {
    val vm = a.vm
    val spaeter by vm.einrichtungSpaeter.collectAsStateWithLifecycle()
    val schritte = einrichtungsSchritte(vm, z, a)
    val offen = schritte.filter { !it.erledigt && !it.wahlweise }
    if (offen.isEmpty() || System.currentTimeMillis() < spaeter) return
    HinweisKarte(
        Icons.Outlined.Rocket,
        "Einrichtung: ${offen.size} von ${schritte.count { !it.wahlweise }} Schritten offen",
        "Als Nächstes: ${offen.first().titel}.",
        MaterialTheme.colorScheme.primary,
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { a.oeffnen(Detail.EinrichtungD) }) { Text("Ansehen") }
            TextButton(onClick = { vm.einrichtungSpaeterSetzen() }) { Text("Später") }
        }
    }
}

@Composable
fun EinrichtungAnsicht(vm: SchwarmViewModel, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val schritte = einrichtungsSchritte(vm, z, a)
    val offen = schritte.count { !it.erledigt && !it.wahlweise }
    Scaffold(
        topBar = {
            SchwarmLeiste("Einrichtung", if (offen == 0) "alles erledigt" else "$offen offen", zurueck = if (a.zurueckPfeil) zurueck else null) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(top = pad.calculateTopPadding()).verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Text(
                "Was noch fehlt, damit der Schwarm ganz läuft. Die App hakt die meisten Schritte selbst ab, sobald sie es sieht.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
            schritte.sortedBy { it.erledigt }.forEach { s ->
                ListItem(
                    leadingContent = {
                        Icon(
                            if (s.erledigt) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                            null,
                            tint = if (s.erledigt) StatusGut else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    headlineContent = { Text(s.titel + if (s.wahlweise) " (wahlweise)" else "") },
                    supportingContent = { Text(reicherText(s.text, MaterialTheme.colorScheme)) },
                    trailingContent = {
                        when {
                            s.manuell -> Switch(checked = s.erledigt, onCheckedChange = { vm.einrichtungAbhaken(s.id, it) })
                            !s.erledigt && s.knopf != null && s.handlung != null -> TextButton(onClick = s.handlung) { Text(s.knopf) }
                        }
                    },
                )
                HorizontalDivider()
            }
            TextButton(onClick = { a.oeffnen(Detail.DiagnoseD) }, modifier = Modifier.padding(8.dp)) {
                Text("Benachrichtigungen kommen nicht? Diagnose öffnen")
            }
        }
    }
}

// ── Diagnose der Benachrichtigungen (App 2.9, Verbesserung 2) ──────────────

private enum class Ampel { GUT, WARNUNG, FEHLER, AUS }

@Composable
private fun DiagZeile(titel: String, text: String, ampel: Ampel) {
    val (icon: ImageVector, farbe: Color) = when (ampel) {
        Ampel.GUT -> Icons.Outlined.CheckCircle to StatusGut
        Ampel.WARNUNG -> Icons.Outlined.WarningAmber to StatusWarnung
        Ampel.FEHLER -> Icons.Outlined.ErrorOutline to StatusKritisch
        Ampel.AUS -> Icons.Outlined.RadioButtonUnchecked to MaterialTheme.colorScheme.onSurfaceVariant
    }
    ListItem(
        leadingContent = { Icon(icon, null, tint = farbe) },
        headlineContent = { Text(titel) },
        supportingContent = { Text(text) },
    )
}

/**
 * Die ganze Kette von „Hub hat etwas für dich“ bis „Benachrichtigung auf dem Gerät“, Glied für Glied. Das erste
 * rote Glied ist der Grund, wenn nichts ankommt.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DiagnoseAnsicht(vm: SchwarmViewModel, z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val k = LocalContext.current
    val push by vm.push.collectAsStateWithLifecycle()
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    val laeuft by vm.pushLaeuft.collectAsStateWithLifecycle()
    val testAb by vm.pushTestAb.collectAsStateWithLifecycle()
    var neu by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1_500); neu++ } }
    val jetzt = remember(neu) { System.currentTimeMillis() }
    val verteiler = remember(neu) { vm.pushVerteiler() }
    val pruefung = remember(neu) { RuheSpeicher.letztePruefung(k) }
    val amHub = z.hub.notaus?.geraete?.firstOrNull { it.id == notAus.geraetId }?.push
    Scaffold(
        topBar = {
            SchwarmLeiste("Diagnose", "Benachrichtigungen", zurueck = if (a.zurueckPfeil) zurueck else null) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(top = pad.calculateTopPadding()).verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Abschnitt("Auf dem Gerät", Modifier.padding(horizontal = 12.dp))
            DiagZeile("Benachrichtigungen erlaubt", if (darfMelden(k)) "ja" else "nein – Android zeigt nichts an", if (darfMelden(k)) Ampel.GUT else Ampel.FEHLER)
            DiagZeile(
                "Hintergrundprüfung",
                if (vm.benachrichtigungen) "an, alle 15 min und bei jedem Weckruf" else "aus (Einstellungen → Im Hintergrund prüfen)",
                if (vm.benachrichtigungen) Ampel.GUT else Ampel.FEHLER,
            )
            DiagZeile(
                "Akku-Optimierung",
                if (ohneAkkuSparen(k)) "aus für Schwarm" else "an – Weckrufe können sich verspäten",
                if (ohneAkkuSparen(k)) Ampel.GUT else Ampel.WARNUNG,
            )
            DiagZeile(
                "Letzte Hintergrundprüfung",
                pruefung?.let { (t, e) -> "${vorText(t, jetzt)} · $e" } ?: "noch nie",
                when {
                    pruefung == null -> Ampel.WARNUNG
                    !pruefung.second.startsWith("ok") -> Ampel.FEHLER
                    jetzt - pruefung.first > 40 * 60_000L -> Ampel.WARNUNG
                    else -> Ampel.GUT
                },
            )
            val ruhe = z.hub.ruhe
            DiagZeile(
                "Ruhezeit",
                when {
                    ruhe == null || !ruhe.an -> "keine"
                    ruhe.jetzt() -> "jetzt aktiv (${ruhe.von}–${ruhe.bis}): nur Freigaben, 🚨 und ⛔ laut"
                    else -> "${ruhe.von}–${ruhe.bis}, gerade nicht aktiv"
                },
                if (ruhe?.jetzt() == true) Ampel.WARNUNG else Ampel.GUT,
            )
            HorizontalDivider()
            Abschnitt("Weckrufe (Push)", Modifier.padding(horizontal = 12.dp))
            DiagZeile(
                "Verteiler",
                verteiler.firstOrNull()?.second?.let { "$it installiert" } ?: "keiner – ntfy installieren",
                if (verteiler.isNotEmpty()) Ampel.GUT else Ampel.FEHLER,
            )
            DiagZeile(
                "Beim Verteiler angemeldet",
                push.endpoint?.let { runCatching { Uri.parse(it).host }.getOrNull()?.let { h -> "ja, über $h" } ?: "ja" }
                    ?: (push.fehler ?: "nein"),
                if (push.endpoint != null) Ampel.GUT else if (verteiler.isEmpty()) Ampel.AUS else Ampel.FEHLER,
            )
            DiagZeile(
                "Not-Aus-Gerät beim Hub",
                if (notAus.angemeldet) "angemeldet (${notAus.geraetId?.take(8)})" else "nicht angemeldet – der Hub kennt dieses Gerät nicht",
                if (notAus.angemeldet) Ampel.GUT else Ampel.FEHLER,
            )
            DiagZeile(
                "Hub stellt zu",
                when {
                    amHub == null -> "der Hub hat keine Adresse für dieses Gerät"
                    amHub.fehler != null -> amHub.fehler
                    amHub.ok != null -> "an ${amHub.host}, zuletzt ${vorText(amHub.ok, jetzt)}"
                    else -> "an ${amHub.host}, noch nichts zugestellt"
                },
                when {
                    amHub == null -> if (push.endpoint == null) Ampel.AUS else Ampel.FEHLER
                    amHub.fehler != null -> Ampel.FEHLER
                    else -> Ampel.GUT
                },
            )
            val geweckt = push.geweckt
            val laufzeit = if (testAb != null && geweckt != null && geweckt >= testAb!!) geweckt - testAb!! else null
            DiagZeile(
                "Zuletzt geweckt",
                buildString {
                    append(geweckt?.let { vorText(it, jetzt) } ?: "noch nie")
                    if (laufzeit != null) append(" · Test kam nach ${"%.1f".format(laufzeit / 1000.0)} s an")
                    else if (testAb != null && jetzt - testAb!! > 30_000) append(" · Test seit ${(jetzt - testAb!!) / 1000} s nicht angekommen")
                },
                when {
                    testAb != null && laufzeit == null && jetzt - testAb!! > 30_000 -> Ampel.FEHLER
                    geweckt == null -> Ampel.AUS
                    else -> Ampel.GUT
                },
            )
            FlowRow(
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = { vm.pushTesten(k) }, enabled = !laeuft && push.endpoint != null && z.rolle.istVale) {
                    if (laeuft) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Test-Weckruf")
                }
                OutlinedButton(onClick = { Hintergrund.jetztPruefen(k); vm.melden("Hintergrundprüfung angestossen.") }) { Text("Jetzt prüfen") }
            }
            HorizontalDivider()
            Abschnitt("Verbindung", Modifier.padding(horizontal = 12.dp))
            DiagZeile(
                "Matrix",
                verbindungText(z),
                when (z.verbindung) {
                    com.claudewebui.swarm.data.Verbindung.BEREIT -> Ampel.GUT
                    com.claudewebui.swarm.data.Verbindung.FEHLER -> Ampel.FEHLER
                    else -> Ampel.WARNUNG
                },
            )
            val rel = z.hub.release
            DiagZeile(
                "Hub",
                when {
                    rel == null -> "kein Release-Stand"
                    !rel.strasse -> "ohne Release-Strasse gebaut – Befehle können fehlen"
                    else -> "Release ${rel.tag}" + (rel.seit?.let { " · läuft seit ${vorText(it, jetzt)}" } ?: "")
                },
                if (rel?.strasse == true) Ampel.GUT else Ampel.WARNUNG,
            )
            val update = vm.neueVersion(z)
            DiagZeile(
                "App",
                "${BuildConfig.VERSION_NAME}" + (update?.let { " · ${it.versionName} ist da" } ?: " · aktuell"),
                if (update == null) Ampel.GUT else Ampel.WARNUNG,
            )
        }
    }
}

// ── Ruhezeit (App 2.9, Verbesserung 3) ──────────────────────────────────────

private val VON = listOf("21:00", "22:00", "23:00", "00:00")
private val BIS = listOf("06:00", "06:30", "07:00", "08:00")

/** In den Einstellungen: Der Hub hält die Zeit (`!ruhe`), die App zeigt sie und meldet danach auch selbst still. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RuheEinstellung(vm: SchwarmViewModel, z: SchwarmZustand) {
    val r = z.hub.ruhe
    var wartet by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(r) { wartet = null }
    val von = r?.von ?: "22:00"
    val bis = r?.bis ?: "07:00"
    fun senden(befehl: String) {
        wartet = befehl
        vm.befehlMitAntwort(befehl) {}
    }
    Abschnitt("Ruhezeit", Modifier.padding(horizontal = 12.dp))
    ListItem(
        headlineContent = { Text("Nachts nur Dringendes") },
        supportingContent = {
            Text(
                if (r == null) "Der Hub hat noch keine Ruhezeit gemeldet (braucht Hub-Release ab 28.09.)."
                else "In der Zeit wecken nur Freigaben, 🚨 und ⛔. Alles andere kommt still und am Ende gesammelt." +
                    (wartet?.let { "\nGesendet: $it – wartet auf den Hub …" } ?: ""),
            )
        },
        trailingContent = {
            Switch(checked = r?.an == true, enabled = r != null && wartet == null, onCheckedChange = { senden(if (it) "!ruhe $von-$bis" else "!ruhe aus") })
        },
    )
    if (r?.an == true) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
            Text("Von", style = MaterialTheme.typography.labelMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                VON.forEach { v -> FilterChip(selected = v == von, enabled = wartet == null, onClick = { if (v != von) senden("!ruhe $v-$bis") }, label = { Text(v) }) }
            }
            Text("Bis", style = MaterialTheme.typography.labelMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BIS.forEach { b -> FilterChip(selected = b == bis, enabled = wartet == null, onClick = { if (b != bis) senden("!ruhe $von-$b") }, label = { Text(b) }) }
            }
        }
    }
}
