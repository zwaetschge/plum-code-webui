@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudewebui.swarm.ui

import androidx.activity.compose.BackHandler
import android.app.Activity
import android.view.WindowManager
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Hive
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.data.Agent
import com.claudewebui.swarm.data.AgentStatus
import com.claudewebui.swarm.data.AlarmStufe
import com.claudewebui.swarm.data.Rolle
import com.claudewebui.swarm.data.SchwarmZustand
import com.claudewebui.swarm.data.Verbindung
import com.claudewebui.swarm.data.Vorlage
import com.claudewebui.swarm.data.Zugang
import androidx.compose.material.icons.outlined.Lock
import kotlinx.coroutines.launch

/**
 * Die vier Bereiche (App 2.4). Jede Sache hat genau einen Ort:
 *  - Aktuell: was dich braucht (Freigaben, Rückfragen, Pläne, Alarme), was läuft, was neu ist, was fertig ist.
 *  - Chat: Allgemein, dein Chat mit Brian, als Ersatz für ChatGPT im Web.
 *  - Räume: Lobby, Arbeitsräume der Agenten, Alarme, Freigaben, Board und Log.
 *  - Schwarm: Agenten mit Modell und Stimme, Abo-Stand, Werkzeuge, Einstellungen und der Not-Aus.
 * Vorher waren es fünf (Übersicht, Allgemein, Räume, Board, Meldungen), und dieselbe Rückfrage stand an
 * bis zu fünf Stellen.
 */
enum class Bereich(val titel: String, val icon: ImageVector) {
    AKTUELL("Aktuell", Icons.Outlined.Dashboard),
    CHAT("Chat", Icons.Outlined.ChatBubbleOutline),
    RAEUME("Räume", Icons.Outlined.Forum),
    SCHWARM("Schwarm", Icons.Outlined.Hive),
}

sealed interface Detail {
    data class AuftragD(val id: String) : Detail
    data class RaumD(val raumId: String, val titel: String, val agentId: String? = null) : Detail
    /** Eine Freigabe oder ein Alarm mit Thread. */
    data class MeldungD(val raumId: String, val eventId: String) : Detail
    data object EinstellungenD : Detail
    /** Die Sitzungen eines Workers mit Einheiten, heute Plum (Punkt 17). */
    data class EinheitenD(val agent: String) : Detail
    data object TuersteherD : Detail
    data object RoutinenD : Detail
    data object VorlagenD : Detail
    /** Verlauf und Kennzahlen (Punkt 20). */
    data object KennzahlenD : Detail
    /** Der Patch eines Code-Auftrags: das `m.file` im Thread der Karte (Punkt 13). */
    data class PatchD(val raumId: String, val eventId: String) : Detail
    /** Ein Chat in Allgemein; ohne Wurzel ein neuer. */
    data class ChatD(val wurzel: String?) : Detail
    data object LobbyD : Detail
    /** Alle Aufträge mit Filtern, das frühere Board (App 2.4). */
    data object BoardD : Detail
    /** Freigaben, Alarme oder das Log des Hubs als ganze Liste (App 2.4). */
    data class KanalD(val kanal: Kanal) : Detail
    /** Die Seite eines Agenten: Stand, Modell, Stimme, Aufträge, Pause (App 2.4). */
    data class AgentD(val id: String) : Detail
    /** Was zur Einrichtung noch fehlt (App 2.9). */
    data object EinrichtungD : Detail
    /** Die Kette der Benachrichtigungen, Glied für Glied (App 2.9). */
    data object DiagnoseD : Detail
    /** Container, Logs und Neustart über den Worker betrieb (App 2.9). */
    data object BetriebD : Detail
    /** Brians LiteLLM: Budget, Kette, Bildmodell, Chat-Modelle (App 2.10). */
    data object LiteLlmD : Detail
}

private const val TRENNER = '\u0001'
private const val STAPEL_TRENNER = '\u0002'

private fun detailText(d: Detail): String = when (d) {
    is Detail.AuftragD -> "A$TRENNER${d.id}"
    is Detail.RaumD -> "R$TRENNER${d.raumId}$TRENNER${d.titel}$TRENNER${d.agentId.orEmpty()}"
    is Detail.MeldungD -> "M$TRENNER${d.raumId}$TRENNER${d.eventId}"
    Detail.EinstellungenD -> "E"
    is Detail.EinheitenD -> "U$TRENNER${d.agent}"
    Detail.TuersteherD -> "T"
    Detail.RoutinenD -> "O"
    Detail.VorlagenD -> "V"
    Detail.KennzahlenD -> "K"
    is Detail.PatchD -> "P$TRENNER${d.raumId}$TRENNER${d.eventId}"
    is Detail.ChatD -> "C$TRENNER${d.wurzel.orEmpty()}"
    Detail.LobbyD -> "L"
    Detail.BoardD -> "B"
    is Detail.KanalD -> "N$TRENNER${d.kanal.name}"
    is Detail.AgentD -> "G$TRENNER${d.id}"
    Detail.EinrichtungD -> "I"
    Detail.DiagnoseD -> "D"
    Detail.BetriebD -> "Y"
    Detail.LiteLlmD -> "W"
}

private fun detailAus(s: String): Detail? {
    val t = s.split(TRENNER)
    return when (t.first()) {
        "A" -> t.getOrNull(1)?.let { Detail.AuftragD(it) }
        "R" -> if (t.size >= 4) Detail.RaumD(t[1], t[2], t[3].ifEmpty { null }) else null
        "M" -> if (t.size >= 3) Detail.MeldungD(t[1], t[2]) else null
        "E" -> Detail.EinstellungenD
        "U" -> t.getOrNull(1)?.let { Detail.EinheitenD(it) }
        "T" -> Detail.TuersteherD
        "O" -> Detail.RoutinenD
        "V" -> Detail.VorlagenD
        "K" -> Detail.KennzahlenD
        "P" -> if (t.size >= 3) Detail.PatchD(t[1], t[2]) else null
        "C" -> Detail.ChatD(t.getOrNull(1)?.ifEmpty { null })
        "L" -> Detail.LobbyD
        "B" -> Detail.BoardD
        "N" -> t.getOrNull(1)?.let { k -> Kanal.entries.firstOrNull { it.name == k } }?.let { Detail.KanalD(it) }
        "G" -> t.getOrNull(1)?.takeIf { it.isNotEmpty() }?.let { Detail.AgentD(it) }
        "I" -> Detail.EinrichtungD
        "D" -> Detail.DiagnoseD
        "Y" -> Detail.BetriebD
        "W" -> Detail.LiteLlmD
        else -> null
    }
}

/** Der Stapel der Details übersteht einen Neuaufbau der Activity (etwa beim Wechsel der Pixeldichte). */
private val StapelSpeicher = Saver<List<Detail>, String>(
    save = { l -> l.joinToString(STAPEL_TRENNER.toString(), transform = ::detailText) },
    restore = { s -> if (s.isEmpty()) emptyList() else s.split(STAPEL_TRENNER).mapNotNull(::detailAus) },
)

/** Was die Lobby-Eingabe vorbelegt; `nr` zählt, damit derselbe Befehl zweimal vorbelegt werden kann. */
data class Entwurf(val text: String = "", val nr: Int = 0)

/** Was die Ansichten auslösen dürfen — ein Bündel, damit nicht jede Ansicht zehn Lambdas bekommt. */
class Aktionen(
    val vm: SchwarmViewModel,
    /** Einen Bildschirm öffnen. Aus einer Liste ersetzt er das Detail, aus einem Detail kommt er obendrauf. */
    val oeffnen: (Detail) -> Unit,
    val neuerAuftrag: (agentId: String?) -> Unit,
    val notAus: () -> Unit,
    val befehlUndLobby: (String) -> Unit,
    /** Einen Befehl in die Eingabe der Lobby legen, ohne ihn zu senden. */
    val befehlVorbereiten: (String) -> Unit,
    /** Die Befehlspalette öffnen. */
    val palette: () -> Unit,
    /** Eine Vorlage einsetzen: Platzhalter abfragen, nachfragen, senden (Punkt 19). */
    val vorlageEinsetzen: (Vorlage) -> Unit,
    /** Liste und Detail nebeneinander (Innenbildschirm). */
    val breit: Boolean,
    /** Navigationsschiene statt unterer Leiste; dort sitzt der Not-Aus. */
    val schiene: Boolean,
    /** Was die angemeldete Person darf: Vale alles, ein Gast nur seine Befehle und Agenten. */
    val rolle: Rolle,
    /** Pfeil zurück zeigen: schmal immer, breit nur, wenn unter dem Detail noch eines liegt. */
    val zurueckPfeil: Boolean,
    /** Alle Details schliessen (breit: das ✕ oben rechts). */
    val schliessen: () -> Unit,
    val entwurf: Entwurf = Entwurf(),
    /** Das oberste Detail ersetzen, etwa den leeren Chat durch den eben begonnenen. */
    val ersetzen: (Detail) -> Unit = oeffnen,
    /** Der Schnellwechsler der Räume (Tippen auf den Titel eines Raums). */
    val schnellwahl: () -> Unit = {},
    /** Einen Raum aus der Liste öffnen: Allgemein, Lobby, Arbeitsraum, Board, Freigaben, Alarme oder Log. */
    val raumWaehlen: (RaumEintrag) -> Unit = {},
    /** Einen Eintrag aus „Neu in den Räumen“ öffnen: den Chat, den Auftrag, den Alarm oder den Raum. */
    val aktuellOeffnen: (AktuellEintrag) -> Unit = {},
    /** Zu einem Bereich unten wechseln. */
    val bereichWaehlen: (Bereich) -> Unit = {},
    /** „Neuer Auftrag“ mit vorbelegtem Ziel, etwa aus einer Antwort von Brian (App 2.5). */
    val auftragMitZiel: (agentId: String?, ziel: String) -> Unit = { _, _ -> },
    /** Was gerade offen ist, damit Listen es markieren. */
    val offen: Detail? = null,
) {
    val auftragOeffnen: (String) -> Unit = { oeffnen(Detail.AuftragD(it)) }
    val raumOeffnen: (raumId: String, titel: String, agentId: String?) -> Unit =
        { raum, titel, agent -> oeffnen(Detail.RaumD(raum, titel, agent)) }
    /** Eine Freigabe oder einen Alarm mit Thread als Detail öffnen. */
    val meldungOeffnen: (raumId: String, eventId: String) -> Unit = { raum, event -> oeffnen(Detail.MeldungD(raum, event)) }
    /** Freigaben, Alarme oder das Log als ganze Liste öffnen. */
    val meldungenOeffnen: (Kanal) -> Unit = { oeffnen(Detail.KanalD(it)) }
    val einstellungen: () -> Unit = { oeffnen(Detail.EinstellungenD) }
}

fun verbindungText(z: SchwarmZustand): String = when {
    z.ausSpeicher != null && z.verbindung != Verbindung.FEHLER -> "verbindet … · Stand von ${zeitText(z.ausSpeicher)}"
    z.verbindung == Verbindung.VERBINDET -> "verbindet …"
    z.verbindung == Verbindung.BEREIT -> "verbunden · ${vorText(z.zuletztSync)}"
    z.verbindung == Verbindung.FEHLER -> "Verbindung gestört" + (z.standZeit.takeIf { it > 0 }?.let { " · Stand von ${zeitText(it)}" } ?: " – versucht es weiter")
    else -> "abgemeldet"
}

@Composable
fun SchwarmWurzel(vm: SchwarmViewModel) {
    val sitzung by vm.sitzung.collectAsStateWithLifecycle()
    val z by vm.schwarm.collectAsStateWithLifecycle()
    val gesperrt by vm.gesperrt.collectAsStateWithLifecycle()
    val ganzGesperrt by vm.screenshotsSperren.collectAsStateWithLifecycle()
    val sicher by vm.sicher.collectAsStateWithLifecycle()
    // Die Sperre und, wenn du es einschaltest, die ganze App sind nie in einem Screenshot oder in der
    // Vorschau der letzten Apps zu sehen (Punkt 5). Freigaben und der Not-Aus melden sich selbst als Quelle.
    LaunchedEffect(gesperrt, ganzGesperrt) { vm.sicherSetzen("sperre", gesperrt || ganzGesperrt) }
    Fensterschutz(sicher)
    when {
        sitzung == null -> Anmeldung(vm)
        gesperrt -> SperrAnsicht(vm)
        z.rolle.zugang == Zugang.KEIN_ZUGANG || z.rolle.zugang == Zugang.PRUEFT -> KeinZugangAnsicht(z, vm)
        else -> Hauptansicht(vm)
    }
    NotAusAntwortDialog(vm)
}

/** `FLAG_SECURE` ein- und ausschalten, je nachdem, was gerade auf dem Bildschirm ist. */
@Composable
private fun Fensterschutz(aktiv: Boolean) {
    val fenster = (LocalContext.current as? Activity)?.window
    DisposableEffect(aktiv, fenster) {
        if (fenster != null) {
            if (aktiv) fenster.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            else fenster.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        onDispose { fenster?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

@Composable
private fun Hauptansicht(vm: SchwarmViewModel) {
    val z by vm.schwarm.collectAsStateWithLifecycle()
    val vorlagen by vm.vorlagen.collectAsStateWithLifecycle()
    val vorlageStart by vm.vorlageStart.collectAsStateWithLifecycle()
    // Die App geht dort auf, wo du zuletzt warst (App 2.4); beim ersten Mal in „Aktuell“.
    var bereich by rememberSaveable { mutableStateOf(Bereich.entries.firstOrNull { it.name == vm.letzterBereich } ?: Bereich.AKTUELL) }
    var stapel by rememberSaveable(stateSaver = StapelSpeicher) { mutableStateOf(emptyList<Detail>()) }
    val detail = stapel.lastOrNull()
    var neuerAuftragOffen by remember { mutableStateOf(false) }
    var neuerAuftragFuer by remember { mutableStateOf<String?>(null) }
    var neuerAuftragZiel by remember { mutableStateOf("") }
    var notAusFrage by remember { mutableStateOf(false) }
    var paletteOffen by remember { mutableStateOf(false) }
    var einsetzen by remember { mutableStateOf<Vorlage?>(null) }
    var entwurf by remember { mutableStateOf(Entwurf()) }
    var schnellwahlOffen by remember { mutableStateOf(false) }
    // Der Chat mit Brian ist Vales; ein Gast sieht drei Bereiche.
    val bereiche = if (z.rolle.istVale) Bereich.entries else Bereich.entries.filter { it != Bereich.CHAT }
    if (bereich !in bereiche) bereich = Bereich.AKTUELL
    LaunchedEffect(bereich) { vm.letzterBereich = bereich.name }
    // Was andere nicht sehen sollen: Freigaben, die Einzelheiten eines Auftrags und der Not-Aus (Punkt 5).
    val folgenreich = notAusFrage ||
        (detail is Detail.KanalD && detail.kanal == Kanal.FREIGABEN) ||
        (detail is Detail.MeldungD && z.raeume.freigaben == detail.raumId) ||
        detail is Detail.AuftragD
    LaunchedEffect(folgenreich) { vm.sicherSetzen("ansicht", folgenreich) }
    val sprung by vm.sprung.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.meldungen.collect { snackbar.showSnackbar(it) } }
    // „Rückgängig“ für einen eben gegebenen Auftrag (App 2.5): 4 s sichtbar, gesendet wird nach 5 s.
    LaunchedEffect(vm) {
        vm.ausstehend.collect { a ->
            snackbar.currentSnackbarData?.dismiss()
            val r = snackbar.showSnackbar(a.text, actionLabel = "Rückgängig", duration = SnackbarDuration.Short)
            if (r == SnackbarResult.ActionPerformed) vm.rueckgaengig(a.id)
        }
    }
    BackHandler(enabled = stapel.isNotEmpty()) { stapel = stapel.dropLast(1) }
    // Aus einer Benachrichtigung oder „Teilen“: gleich an die richtige Stelle.
    LaunchedEffect(sprung) {
        when (val s = sprung) {
            // Offene Freigaben stehen in „Aktuell“ zuoberst, mit Countdown und Knöpfen.
            Sprung.FREIGABEN -> {
                bereich = Bereich.AKTUELL
                stapel = emptyList()
            }
            is Sprung.ChatS -> if (z.rolle.istVale) {
                bereich = Bereich.CHAT
                stapel = listOf(Detail.ChatD(s.wurzel))
            }
            Sprung.GETEILT -> if (z.rolle.istVale) {
                bereich = Bereich.CHAT
                stapel = listOf(Detail.ChatD(null))
            } else {
                vm.geteiltUebernommen()
                vm.melden("Teilen geht in den Chat mit Brian, und den gibt es nur für Vale.")
            }
            Sprung.NEUER_CHAT -> if (z.rolle.istVale) {
                bereich = Bereich.CHAT
                stapel = listOf(Detail.ChatD(null))
            }
            Sprung.NEUER_AUFTRAG -> {
                bereich = Bereich.AKTUELL
                stapel = emptyList()
                if (z.rolle.darf("auftrag")) {
                    neuerAuftragFuer = null
                    neuerAuftragOffen = true
                }
            }
            Sprung.AKTUELL -> {
                bereich = Bereich.AKTUELL
                stapel = emptyList()
            }
            Sprung.NOTAUS -> {
                bereich = Bereich.SCHWARM
                stapel = emptyList()
                if (z.rolle.istVale) notAusFrage = true
            }
            null -> return@LaunchedEffect
        }
        vm.gesprungen()
    }
    // Ein Favorit aus dem Widget: Platzhalter abfragen, erst nach deinem Okay senden.
    LaunchedEffect(vorlageStart, vorlagen) {
        val id = vorlageStart ?: return@LaunchedEffect
        val v = vorlagen.firstOrNull { it.id == id }
        if (v != null) einsetzen = v else vm.melden("Diese Vorlage gibt es auf dem Gerät nicht mehr.")
        vm.vorlageGestartet()
    }
    // Ein vorbelegter Befehl gilt nur, bis du die Lobby verlässt; sonst stünde er beim nächsten Besuch wieder da.
    val lobbyOffen = detail == Detail.LobbyD
    LaunchedEffect(lobbyOffen) {
        if (!lobbyOffen && entwurf.text.isNotEmpty()) entwurf = Entwurf("", entwurf.nr + 1)
    }
    val bereichWaehlen = { b: Bereich ->
        bereich = b
        // Ein Bereich beginnt bei seiner Liste; noch einmal tippen führt auch dorthin zurück.
        stapel = emptyList()
    }
    // Ein Raum aus der Liste oder dem Schnellwechsler; `wechseln` stellt auch den Bereich auf „Räume“.
    val raumZiel = { e: RaumEintrag, wechseln: Boolean ->
        when (e.art) {
            RaumArt.ALLGEMEIN -> {
                bereich = Bereich.CHAT
                stapel = emptyList()
            }
            RaumArt.LOBBY -> {
                if (wechseln) bereich = Bereich.RAEUME
                stapel = listOf(Detail.LobbyD)
            }
            RaumArt.AGENT -> {
                if (wechseln) bereich = Bereich.RAEUME
                stapel = listOf(Detail.RaumD(e.raumId, "ag-${e.agentId}", e.agentId))
            }
            RaumArt.SYSTEM -> {
                if (wechseln) bereich = Bereich.RAEUME
                val k = e.kanal
                stapel = listOf(
                    when {
                        e.board -> Detail.BoardD
                        k != null -> Detail.KanalD(k)
                        else -> Detail.RaumD(e.raumId, e.titel)
                    },
                )
            }
        }
    }
    val aktuellZiel = { e: AktuellEintrag ->
        val r = z.raeume
        val n = e.n
        val wurzel = e.chatWurzel
        if (wurzel != null) bereich = Bereich.CHAT
        stapel = listOf(
            when {
                wurzel != null -> Detail.ChatD(wurzel)
                e.raumId == r.alarme -> Detail.MeldungD(e.raumId, n.threadWurzel ?: n.eventId)
                e.raumId == r.lobby -> Detail.LobbyD
                else -> {
                    val auftrag = n.auftragId
                        ?: n.threadWurzel?.let { t -> z.auftraege.firstOrNull { it.threadWurzel == t }?.id }
                    if (auftrag != null) {
                        Detail.AuftragD(auftrag)
                    } else {
                        val id = r.agenten.entries.firstOrNull { it.value == e.raumId }?.key
                        Detail.RaumD(e.raumId, "ag-${id ?: "?"}", id)
                    }
                }
            },
        )
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        // Aussenbildschirm < 600 dp: eine Spalte. Innenbildschirm (je nach Zoom 670–850 dp): Liste und Detail
        // nebeneinander; ab 720 dp mit der Schiene links statt der Leiste unten, das lässt mehr Höhe.
        val zweispaltig = maxWidth >= 600.dp
        val schiene = maxWidth >= 720.dp
        val listenBreite = ((maxWidth - if (schiene) 80.dp else 0.dp) * 0.42f).coerceIn(300.dp, 420.dp)
        fun aktionen(stapeln: Boolean) = Aktionen(
            vm = vm,
            oeffnen = { d -> stapel = if (stapeln) stapel.takeWhile { it != d } + d else listOf(d) },
            neuerAuftrag = { agent -> neuerAuftragFuer = agent; neuerAuftragZiel = ""; neuerAuftragOffen = true },
            notAus = { notAusFrage = true },
            // Befehle gehen in die Lobby; sie öffnet sich über dem, was gerade da ist.
            befehlUndLobby = { text -> vm.befehl(text); stapel = listOf(Detail.LobbyD) },
            befehlVorbereiten = { text ->
                entwurf = Entwurf(text, entwurf.nr + 1)
                stapel = listOf(Detail.LobbyD)
            },
            palette = { paletteOffen = true },
            vorlageEinsetzen = { einsetzen = it },
            breit = zweispaltig,
            schiene = schiene,
            rolle = z.rolle,
            zurueckPfeil = !zweispaltig || stapel.size > 1,
            schliessen = { stapel = emptyList() },
            entwurf = entwurf,
            ersetzen = { d -> stapel = stapel.dropLast(1) + d },
            schnellwahl = { schnellwahlOffen = true },
            raumWaehlen = { e -> raumZiel(e, false) },
            aktuellOeffnen = aktuellZiel,
            bereichWaehlen = bereichWaehlen,
            auftragMitZiel = { agent, ziel -> neuerAuftragFuer = agent; neuerAuftragZiel = ziel; neuerAuftragOffen = true },
            offen = detail,
        )
        val a = aktionen(stapeln = false)
        val ad = aktionen(stapeln = true)
        val zurueck = { stapel = stapel.dropLast(1) }
        val spalten: @Composable () -> Unit = {
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.width(listenBreite).fillMaxHeight()) { Liste(bereich, z, a) }
                VerticalDivider()
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (detail == null) Platzhalter(bereich, z, ad) else DetailAnsicht(detail, z, vm, ad, zurueck)
                }
            }
        }

        if (schiene) {
            Row(Modifier.fillMaxSize()) {
                NavigationRail(
                    header = {
                        if (z.rolle.darf("auftrag")) {
                            FloatingActionButton(onClick = { a.neuerAuftrag(null) }) { Icon(Icons.Filled.Add, "Neuer Auftrag") }
                        }
                    },
                ) {
                    Spacer(Modifier.height(12.dp))
                    bereiche.forEach { b ->
                        NavigationRailItem(
                            selected = b == bereich,
                            onClick = { bereichWaehlen(b) },
                            icon = { BereichsSymbol(b, z) },
                            label = { Text(b.titel) },
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (z.rolle.istVale) {
                        NavigationRailItem(
                            selected = false,
                            onClick = { notAusFrage = true },
                            icon = { Icon(Icons.Outlined.PanTool, null, tint = MaterialTheme.colorScheme.error) },
                            label = { Text("Not-Aus") },
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                }
                Column(Modifier.weight(1f)) {
                    Box(Modifier.weight(1f)) { spalten() }
                    VorleseLeiste(vm, unten = true)
                }
            }
            SnackbarHost(
                snackbar,
                Modifier.align(Alignment.BottomCenter).navigationBarsPadding().imePadding().padding(16.dp),
            )
        } else {
            Scaffold(
                contentWindowInsets = WindowInsets(0),
                snackbarHost = { SnackbarHost(snackbar) },
                bottomBar = {
                    val navigation = zweispaltig || detail == null
                    Column {
                        VorleseLeiste(vm, unten = !navigation)
                        if (navigation) {
                            NavigationBar {
                                bereiche.forEach { b ->
                                    NavigationBarItem(
                                        selected = b == bereich,
                                        onClick = { bereichWaehlen(b) },
                                        icon = { BereichsSymbol(b, z) },
                                        label = { Text(b.titel, maxLines = 1) },
                                    )
                                }
                            }
                        }
                    }
                },
                floatingActionButton = {
                    if (!zweispaltig && detail == null && bereich == Bereich.AKTUELL && z.rolle.darf("auftrag")) {
                        ExtendedFloatingActionButton(
                            onClick = { a.neuerAuftrag(null) },
                            icon = { Icon(Icons.Filled.Add, null) },
                            text = { Text("Auftrag") },
                        )
                    }
                },
            ) { pad ->
                Box(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad)) {
                    when {
                        zweispaltig -> spalten()
                        detail == null -> Liste(bereich, z, a)
                        else -> DetailAnsicht(detail, z, vm, ad, zurueck)
                    }
                }
            }
        }

        if (neuerAuftragOffen) {
            NeuerAuftrag(
                agenten = z.agenten,
                rolle = z.rolle,
                vorwahl = neuerAuftragFuer,
                anfangsZiel = neuerAuftragZiel,
                vorlagen = vorlagen.filter { v -> z.rolle.darfAuftragAn(v.agent.substringBefore('/')) },
                onSenden = { agent, ziel -> vm.auftrag(agent, ziel); neuerAuftragOffen = false },
                onVorlage = { agent, ziel ->
                    vm.vorlageSpeichern(Vorlage(titel = ziel.trim().lineSequence().first().take(40), agent = agent, ziel = ziel.trim()))
                },
                onVorlageEinsetzen = { v -> neuerAuftragOffen = false; einsetzen = v },
                onSchliessen = { neuerAuftragOffen = false },
            )
        }
        if (paletteOffen) {
            Befehlspalette(
                rolle = z.rolle,
                onSenden = { paletteOffen = false; a.befehlUndLobby(it) },
                onVorbereiten = { paletteOffen = false; a.befehlVorbereiten(it) },
                onSchliessen = { paletteOffen = false },
            )
        }
        if (schnellwahlOffen) {
            RaumSchnellwahl(
                z,
                offen = offenerRaum(detail, z) ?: if (bereich == Bereich.CHAT) z.raeume.allgemein else null,
                onWahl = { e ->
                    schnellwahlOffen = false
                    raumZiel(e, true)
                },
                onSchliessen = { schnellwahlOffen = false },
            )
        }
        einsetzen?.let { v ->
            VorlageEinsetzen(
                v,
                z.rolle,
                onSenden = { werte -> vm.vorlageSenden(v, werte); einsetzen = null },
                onSchliessen = { einsetzen = null },
            )
        }
    }

    if (notAusFrage && z.rolle.istVale) {
        NotAusDialog(vm, z, onSchliessen = { notAusFrage = false })
    }
}

/** Die App-Sperre (App 2.7): nichts vom Schwarm sichtbar, bis Fingerabdruck oder Gerätesperre bestätigt sind. */
@Composable
private fun SperrAnsicht(vm: SchwarmViewModel) {
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var hinweis by remember { mutableStateOf<String?>(null) }
    val fragen = {
        scope.launch {
            val (e, m) = Biometrie.bestaetigen(kontext, "Schwarm entsperren", "Die App kann freigeben und den Not-Aus auslösen.")
            if (e == Biometrie.Ergebnis.OK) vm.entsperren()
            else if (e == Biometrie.Ergebnis.NICHT_EINGERICHTET) vm.entsperren() // ohne Displaysperre lässt sich nicht sperren
            else hinweis = m
        }
    }
    LaunchedEffect(Unit) { fragen() }
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Outlined.Lock, null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text("Schwarm ist gesperrt", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(
            hinweis ?: "Entsperre mit Fingerabdruck oder Gerätesperre.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = { fragen() }) { Text("Entsperren") }
    }
}

/**
 * Abzeichen unten, bewusst sparsam: Nur „Aktuell“ zählt rot, was auf dich wartet. Der Chat zählt Brians neue
 * Antworten ruhig in der Akzentfarbe, Räume und Schwarm zeigen nur einen Punkt, wenn es etwas Neues gibt.
 */
@Composable
private fun BereichsSymbol(b: Bereich, z: SchwarmZustand) {
    when (b) {
        Bereich.AKTUELL -> {
            val jetzt = jetztBisFrist(z.freigaben.map { it.ablauf } + z.alarme.flatMap { it.fristen })
            Abzeichen(
                b.icon,
                aktuellZahl(z, jetzt),
                punkt = z.rolle.entscheidet && z.alarme.any { it.stufe == AlarmStufe.CRIT && it.offenUm(jetzt) && !it.stummUm(jetzt) },
            )
        }
        Bereich.CHAT -> Abzeichen(b.icon, z.allgemein.ungelesen, ruhig = true)
        Bereich.RAEUME -> Abzeichen(b.icon, 0, punkt = raeumeUngelesen(z) > 0, ruhig = true)
        Bereich.SCHWARM -> Abzeichen(
            b.icon,
            0,
            punkt = z.hub.neuereVersion.isNotEmpty() || z.agenten.any { it.status == AgentStatus.TRAEGE },
            ruhig = true,
        )
    }
}

@Composable
private fun Abzeichen(icon: ImageVector, zahl: Int, punkt: Boolean = false, ruhig: Boolean = false) {
    val f = MaterialTheme.colorScheme
    val grund = if (ruhig) f.primary else f.error
    val schrift = if (ruhig) f.onPrimary else f.onError
    when {
        zahl > 0 -> BadgedBox(badge = { Badge(containerColor = grund, contentColor = schrift) { Text(if (zahl > 99) "99+" else zahl.toString()) } }) {
            Icon(icon, null)
        }
        punkt -> BadgedBox(badge = { Badge(containerColor = grund) }) { Icon(icon, null) }
        else -> Icon(icon, null)
    }
}

@Composable
private fun Liste(bereich: Bereich, z: SchwarmZustand, a: Aktionen) {
    when (bereich) {
        Bereich.AKTUELL -> AktuellAnsicht(z, a)
        Bereich.CHAT -> AllgemeinAnsicht(z, a)
        Bereich.RAEUME -> RaeumeAnsicht(z, a)
        Bereich.SCHWARM -> SchwarmAnsicht(z, a)
    }
}

@Composable
private fun DetailAnsicht(d: Detail, z: SchwarmZustand, vm: SchwarmViewModel, a: Aktionen, zurueck: () -> Unit) {
    when (d) {
        is Detail.AuftragD -> AuftragAnsicht(d.id, z, a, zurueck)
        is Detail.RaumD -> RaumAnsicht(d.raumId, d.titel, d.agentId, z, a, zurueck)
        is Detail.MeldungD -> MeldungAnsicht(d.raumId, d.eventId, z, a, zurueck)
        Detail.EinstellungenD -> EinstellungenAnsicht(vm, z, a, zurueck)
        is Detail.EinheitenD -> EinheitenAnsicht(d.agent, z, a, zurueck)
        Detail.TuersteherD -> TuersteherAnsicht(z, a, zurueck)
        Detail.RoutinenD -> RoutinenAnsicht(z, a, zurueck)
        Detail.VorlagenD -> VorlagenAnsicht(z, a, zurueck)
        Detail.KennzahlenD -> KennzahlenAnsicht(z, a, zurueck)
        is Detail.PatchD -> PatchAnsicht(d.raumId, d.eventId, z, a, zurueck)
        is Detail.ChatD -> ChatAnsicht(d.wurzel, z, a, zurueck = if (a.zurueckPfeil) zurueck else null, schliessbar = a.breit)
        Detail.LobbyD -> LobbyAnsicht(z, a, zurueck = if (a.zurueckPfeil) zurueck else null, schliessbar = a.breit)
        Detail.BoardD -> BoardAnsicht(z, a, zurueck = if (a.zurueckPfeil) zurueck else null, schliessbar = a.breit)
        is Detail.KanalD -> KanalAnsicht(d.kanal, z, a, zurueck)
        is Detail.AgentD -> AgentAnsicht(d.id, z, a, zurueck = if (a.zurueckPfeil) zurueck else null, schliessbar = a.breit)
        Detail.EinrichtungD -> EinrichtungAnsicht(vm, z, a, zurueck)
        Detail.DiagnoseD -> DiagnoseAnsicht(vm, z, a, zurueck)
        Detail.BetriebD -> BetriebAnsicht(vm, z, a, zurueck)
        Detail.LiteLlmD -> LiteLlmAnsicht(z, a, zurueck)
    }
}

/** Breit und nichts gewählt: rechts steht, was zum Bereich passt. */
@Composable
private fun Platzhalter(bereich: Bereich, z: SchwarmZustand, a: Aktionen) {
    when (bereich) {
        // Links was dich braucht und was läuft, rechts alle Aufträge mit Filtern.
        Bereich.AKTUELL -> BoardAnsicht(z, a)
        Bereich.CHAT -> ChatAnsicht(null, z, a, zurueck = null, schliessbar = false)
        Bereich.RAEUME -> LobbyAnsicht(z, a, zurueck = null, schliessbar = false)
        Bereich.SCHWARM -> LeerHinweis(
            Icons.Outlined.Hive,
            "Wähle links einen Agenten",
            "Seine Seite zeigt Modell, Stimme, Aufträge und Abo-Stand. Werkzeuge und Einstellungen öffnen sich auch hier.",
        )
    }
}

/**
 * Oben rechts in „Aktuell“: der Not-Aus (nur Vale). Breit ohne Schiene kommt „+“ für einen neuen Auftrag
 * dazu, weil es dort keinen runden Knopf unten gibt; mit Schiene sitzen beide in der Schiene.
 */
@Composable
fun NotAusKnopf(a: Aktionen) {
    if (a.schiene) return
    if (a.breit && a.rolle.darf("auftrag")) {
        IconButton(onClick = { a.neuerAuftrag(null) }) { Icon(Icons.Filled.Add, "Neuer Auftrag") }
    }
    if (a.rolle.istVale) {
        IconButton(onClick = a.notAus) {
            Icon(Icons.Outlined.PanTool, "Not-Aus", tint = MaterialTheme.colorScheme.error)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NeuerAuftrag(
    agenten: List<Agent>,
    rolle: Rolle,
    vorwahl: String?,
    anfangsZiel: String,
    vorlagen: List<Vorlage>,
    onSenden: (String, String) -> Unit,
    onVorlage: (String, String) -> Unit,
    onVorlageEinsetzen: (Vorlage) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Gäste nur an ihre Agenten (Gastrolle).
    val moeglich = agenten.filter { it.nimmtAuftraege && rolle.darfAuftragAn(it.id) }
    var agent by remember { mutableStateOf(vorwahl?.takeIf { v -> moeglich.any { it.id == v } } ?: moeglich.firstOrNull()?.id) }
    var ziel by remember { mutableStateOf(anfangsZiel) }
    val gewaehlt = moeglich.firstOrNull { it.id == agent }
    ModalBottomSheet(
        onDismissRequest = onSchliessen,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Neuer Auftrag", style = MaterialTheme.typography.titleLarge)
            Text(
                "Geht als `!auftrag` in die Lobby. Budget und Frist setzt der Hub nach den Standards des Agenten.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            // Vorlagen, Favoriten zuerst: ein Tipp setzt sie ein, Platzhalter fragt die App danach ab (Punkt 19).
            if (vorlagen.isNotEmpty()) {
                Text("Aus einer Vorlage", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    vorlagen.sortedByDescending { it.favorit }.forEach { v ->
                        AssistChip(
                            onClick = { onVorlageEinsetzen(v) },
                            label = { Text(v.titel) },
                            leadingIcon = if (v.favorit) ({ Icon(Icons.Outlined.Star, null, Modifier.size(16.dp)) }) else null,
                        )
                    }
                }
            }
            if (moeglich.isEmpty()) {
                Text(
                    if (rolle.istGast) "Für dich ist gerade kein Agent freigegeben."
                    else "Noch keine Agenten sichtbar. Tritt zuerst den Schwarm-Räumen bei (Räume → Allen beitreten).",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Text("An", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                moeglich.forEach { x ->
                    FilterChip(
                        selected = x.id == agent,
                        onClick = { agent = x.id },
                        label = { Text(x.name) },
                        leadingIcon = { StatusPunkt(x.status) },
                    )
                }
            }
            OutlinedTextField(
                value = ziel,
                onValueChange = { ziel = it },
                label = { Text("Ziel") },
                placeholder = { Text("Was soll erreicht werden?") },
                minLines = 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth(),
            )
            if (gewaehlt != null) {
                Text(
                    buildString {
                        append("${gewaehlt.name}: ${gewaehlt.level} · ${gewaehlt.trust} · ${gewaehlt.modus}")
                        if (gewaehlt.trust == "T2" && rolle.istVale) append(". Hat Host-Zugriff; von dir direkt braucht es keine Freigabe.")
                        if (gewaehlt.status.name != "ONLINE") append(". Gerade ${gewaehlt.status.titel} – der Hub kann den Auftrag ablehnen.")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextButton(
                    onClick = { agent?.let { onVorlage(it, ziel) } },
                    enabled = agent != null && ziel.isNotBlank(),
                ) { Text("Als Vorlage") }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onSchliessen) { Text("Abbrechen") }
                Spacer(Modifier.padding(4.dp))
                Button(
                    onClick = { agent?.let { onSenden(it, ziel) } },
                    enabled = agent != null && ziel.isNotBlank(),
                ) { Text("Auftrag geben") }
            }
        }
    }
}
