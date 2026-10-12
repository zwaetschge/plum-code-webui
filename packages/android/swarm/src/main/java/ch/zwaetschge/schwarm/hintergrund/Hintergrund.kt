package com.claudewebui.swarm.hintergrund

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.claudewebui.swarm.FreigabeAblehnen
import com.claudewebui.swarm.FreigabeActivity
import com.claudewebui.swarm.AntwortEmpfaenger
import com.claudewebui.swarm.MainActivity
import com.claudewebui.swarm.R
import com.claudewebui.swarm.data.AllgemeinLeser
import com.claudewebui.swarm.data.BRIAN_LOKAL
import com.claudewebui.swarm.data.KONTO_ALLGEMEIN
import com.claudewebui.swarm.data.Lebenslauf
import com.claudewebui.swarm.data.Sitzungsspeicher
import com.claudewebui.swarm.data.arr
import com.claudewebui.swarm.data.matrix.Ereignis
import com.claudewebui.swarm.data.matrix.MatrixClient
import com.claudewebui.swarm.data.matrix.MatrixFehler
import com.claudewebui.swarm.data.obj
import com.claudewebui.swarm.data.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Benachrichtigungen, ohne dass die App offen ist: Alle 15 min holt WorkManager, was seit
 * dem letzten Mal in Lobby, Freigaben, Alarmen und den Arbeitsräumen dazukam. Dringendes
 * meldet der Hub ausserdem über ntfy; das hier ersetzt ntfy nicht, es ergänzt es.
 */
object Hintergrund {
    const val WARTET = "wartet"
    const val FREIGABEN = "freigaben"
    const val ERGEBNISSE = "ergebnisse"
    const val ALARME = "alarme"
    const val UEBERSICHT = "uebersicht"
    const val ALLGEMEIN = "allgemein"
    private const val ARBEIT = "schwarm-pruefen"
    private const val WARTEN = "allgemein-warten"
    private const val SOFORT = "push-pruefen"

    fun kanaeleAnlegen(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(WARTET, "Rückfragen", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Ein Bot wartet auf deine Antwort." },
                NotificationChannel(FREIGABEN, "Freigaben", NotificationManager.IMPORTANCE_HIGH)
                    .apply {
                        description = "Eine Übergabe oder Betriebsaktion braucht dein ✅ oder ❌. " +
                            "Entscheiden kannst du nur in der App, nicht aus der Benachrichtigung."
                    },
                NotificationChannel(ERGEBNISSE, "Ergebnisse", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "Aufträge fertig, fehlgeschlagen oder zurückgemeldet." },
                NotificationChannel(ALARME, "Alarme", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Meldungen aus #schwarm-alarme." },
                NotificationChannel(UEBERSICHT, "Übersicht", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Tagesübersicht und Hinweise." },
                NotificationChannel(ALLGEMEIN, "Allgemein", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "Brian hat in Allgemein geantwortet. Werkzeugzeilen melden sich nicht." },
            ),
        )
    }

    fun planen(context: Context, an: Boolean) {
        val wm = WorkManager.getInstance(context)
        if (!an) {
            wm.cancelUniqueWork(ARBEIT)
            return
        }
        val auftrag = PeriodicWorkRequestBuilder<PruefArbeit>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        wm.enqueueUniquePeriodicWork(ARBEIT, ExistingPeriodicWorkPolicy.KEEP, auftrag)
    }

    fun abbestellen(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(ARBEIT)
        WorkManager.getInstance(context).cancelUniqueWork(WARTEN)
    }

    /**
     * Die App geht in den Hintergrund, während Brian an einem Chat arbeitet: bis zu 9 min mitlesen und
     * melden, sobald er fertig ist (sein ✅ oder ❌). Ab dem Stand `since` der App, damit nichts fehlt.
     */
    fun aufBrianWarten(context: Context, since: String?, wurzeln: List<String>) {
        val auftrag = OneTimeWorkRequestBuilder<BrianWarten>()
            .setInputData(workDataOf("since" to since, "wurzeln" to wurzeln.take(20).toTypedArray()))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WARTEN, ExistingWorkPolicy.REPLACE, auftrag)
    }

    /** Zurück im Vordergrund: Die App liest selbst. */
    fun nichtMehrWarten(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(WARTEN)

    /**
     * Ein Weckruf vom Hub (Sofort-Benachrichtigungen, App 2.5): gleich prüfen statt erst im 15-Minuten-Takt.
     * Kommt während einer Prüfung ein weiterer, läuft danach genau noch eine.
     */
    fun jetztPruefen(context: Context) {
        val auftrag = OneTimeWorkRequestBuilder<PruefArbeit>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(SOFORT, ExistingWorkPolicy.APPEND_OR_REPLACE, auftrag)
    }

    /** Die Meldung eines Chats weg, sobald du ihn in der App offen hast. */
    fun chatMeldungWeg(context: Context, wurzel: String) =
        NotificationManagerCompat.from(context).cancel(chatMeldungId(wurzel))

    fun chatMeldungId(wurzel: String): Int = ("allgemein|$wurzel").hashCode()

    /** Der Filter für Allgemein allein: nur die Zeitleiste, Reaktionen eingeschlossen. */
    fun allgemeinFilter(raum: String): String = buildJsonObject {
        put("room", buildJsonObject {
            put("rooms", JsonArray(listOf(JsonPrimitive(raum))))
            put("timeline", buildJsonObject { put("limit", JsonPrimitive(40)) })
            put("state", buildJsonObject { put("types", JsonArray(emptyList())) })
            put("ephemeral", buildJsonObject { put("types", JsonArray(emptyList())) })
            put("account_data", buildJsonObject { put("types", JsonArray(emptyList())) })
        })
        put("presence", buildJsonObject { put("types", JsonArray(emptyList())) })
        put("account_data", buildJsonObject { put("types", JsonArray(emptyList())) })
    }.toString()

    fun imVordergrund(): Boolean =
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
}

/**
 * „Brian hat geantwortet: <Titel>“ (App 2.1): je Chat eine Meldung mit der neuesten Antwort, keine für
 * Werkzeugzeilen. Was schon gemeldet ist, merkt sich das Gerät (Event-IDs), damit der Warte-Worker und
 * die 15-Minuten-Prüfung nicht doppelt melden.
 */
internal class AllgemeinMelder(
    private val ctx: Context,
    private val client: MatrixClient,
    private val raum: String,
    private val brian: String,
) {
    private val prefs = ctx.getSharedPreferences("hintergrund", Context.MODE_PRIVATE)
    private val ereignisse = LinkedHashMap<String, Ereignis>()

    fun aufnehmen(events: List<Ereignis>) {
        events.forEach { e -> e.eventId?.let { ereignisse[it] = e } }
    }

    private suspend fun ereignis(id: String): Ereignis? =
        ereignisse[id] ?: runCatching { client.ereignis(raum, id) }.getOrNull()?.also { ereignisse[id] = it }

    /** Die Wurzel des Chats, zu dem ein Event gehört. */
    private suspend fun wurzel(id: String): String? {
        val e = ereignis(id) ?: return null
        val rel = e.content.obj("m.relates_to")
        return if (rel?.str("rel_type") == "m.thread") rel.str("event_id") else id
    }

    /** Chats, in denen Brian fertig ist: sein ✅ oder ❌ auf eine Nachricht von dir. */
    suspend fun fertigeChats(): Set<String> {
        val ziele = ereignisse.values
            .filter { it.type == "m.reaction" && it.sender == brian }
            .mapNotNull { e ->
                val rel = e.content.obj("m.relates_to") ?: return@mapNotNull null
                val key = rel.str("key")?.let(Lebenslauf::zeichen)
                if (key == "✅" || key == "❌") rel.str("event_id") else null
            }
        return ziele.mapNotNull { wurzel(it) }.toSet()
    }

    private fun gemeldet(): List<String> = prefs.getString("allgemein_gemeldet", "").orEmpty().split('\n').filter { it.isNotEmpty() }

    /** Offene Antworten melden, nur in `nur` (null: alle). Liefert, wie viele Meldungen rausgingen. */
    suspend fun melden(nur: Set<String>?): Int {
        val schon = gemeldet().toMutableList()
        // Bearbeitungen: Es zählt der neueste Text (Hermes kann Antworten nachträglich ergänzen).
        val neuerText = HashMap<String, String>()
        ereignisse.values.filter { it.type == "m.room.message" && it.sender == brian }.forEach { e ->
            val rel = e.content.obj("m.relates_to")
            if (rel?.str("rel_type") == "m.replace") {
                val ziel = rel.str("event_id") ?: return@forEach
                e.content.obj("m.new_content")?.str("body")?.let { neuerText[ziel] = it }
            }
        }
        val jeChat = HashMap<String, Pair<Ereignis, String>>()
        for (e in ereignisse.values) {
            if (e.type != "m.room.message" || e.sender != brian) continue
            val rel = e.content.obj("m.relates_to")
            if (rel?.str("rel_type") == "m.replace") continue
            val id = e.eventId ?: continue
            if (id in schon) continue
            val text = neuerText[id] ?: e.content.str("body") ?: continue
            if (AllgemeinLeser.istStatusText(text)) continue
            val w = if (rel?.str("rel_type") == "m.thread") rel.str("event_id") ?: id else id
            if (nur != null && w !in nur) continue
            val bisher = jeChat[w]
            if (bisher == null || bisher.first.ts < e.ts) jeChat[w] = e to text
        }
        var gesendet = 0
        for ((w, paar) in jeChat) {
            val (e, text) = paar
            val kopf = ereignis(w)
            val titel = kopf?.content?.let { c ->
                AllgemeinLeser.titelText(c.str("body").orEmpty(), c.str("msgtype") == "m.image")
            } ?: "Allgemein"
            if (chatMelden(w, titel, text)) gesendet++
            // Alle Antworten dieses Chats bis hierher gelten als gemeldet.
            ereignisse.values.filter { x ->
                x.sender == brian && x.ts <= e.ts && x.eventId != null &&
                    (x.eventId == w || x.content.obj("m.relates_to")?.str("event_id") == w)
            }.forEach { x -> schon += x.eventId!! }
        }
        prefs.edit().putString("allgemein_gemeldet", schon.takeLast(300).joinToString("\n")).apply()
        return gesendet
    }

    private fun chatMelden(wurzel: String, titel: String, antwort: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        val ziel = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(MainActivity.ZIEL_CHAT, wurzel)
        val oeffnen = PendingIntent.getActivity(
            ctx, Hintergrund.chatMeldungId(wurzel), ziel,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // Markdown-Zeichen weg, damit die Meldung lesbar bleibt.
        val klar = antwort.lineSequence()
            .map { it.replace(Regex("""^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)"""), "").replace(Regex("""[*_`~]"""), "") }
            .filter { it.isNotBlank() && !it.trimStart().startsWith("|") }
            .joinToString("\n")
            .take(600)
        val n = NotificationCompat.Builder(ctx, Hintergrund.ALLGEMEIN)
            .setSmallIcon(R.drawable.swarm_ic_stat_schwarm)
            .setContentTitle("Brian hat geantwortet: $titel")
            .setContentText(klar.lineSequence().firstOrNull() ?: klar)
            .setStyle(NotificationCompat.BigTextStyle().bigText(klar))
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setGroup("schwarm-allgemein")
            .setSilent(RuheSpeicher.still(ctx, dringend = false))
            .build()
        NotificationManagerCompat.from(ctx).notify(Hintergrund.chatMeldungId(wurzel), n)
        return true
    }
}

/** Bis zu 9 min mitlesen, solange Brian an einem Chat arbeitet und die App im Hintergrund ist. */
class BrianWarten(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val speicher = Sitzungsspeicher(applicationContext)
        val s = speicher.laden() ?: return@withContext Result.success()
        if (!speicher.benachrichtigungen) return@withContext Result.success()
        val client = MatrixClient(s.homeserver, s.accessToken)
        try {
            val raum = client.kontoDaten(s.userId, KONTO_ALLGEMEIN)?.str("room_id")
                ?: return@withContext Result.success()
            val melder = AllgemeinMelder(applicationContext, client, raum, "@$BRIAN_LOKAL:${s.domain}")
            val filter = Hintergrund.allgemeinFilter(raum)
            var since = inputData.getString("since") ?: client.sync(filter, null, 0).nextBatch
            val wartend = inputData.getStringArray("wurzeln")?.toSet().orEmpty()
            val ende = System.currentTimeMillis() + 9 * 60_000L
            while (!isStopped && System.currentTimeMillis() < ende) {
                val antwort = client.sync(filter, since, 25_000)
                since = antwort.nextBatch
                if (Hintergrund.imVordergrund()) return@withContext Result.success()
                melder.aufnehmen(antwort.rooms?.join?.get(raum)?.timeline?.events.orEmpty())
                val fertig = melder.fertigeChats()
                if (fertig.isNotEmpty()) melder.melden(fertig)
                if (wartend.isNotEmpty() && wartend.all { it in fertig }) break
            }
            // Am Ende auch Antworten ohne ✅ (etwa nach einem Abbruch), sofern die App nicht offen ist.
            if (!Hintergrund.imVordergrund()) melder.melden(null)
            Result.success()
        } catch (e: Exception) {
            Result.success()
        } finally {
            client.schliessen()
        }
    }
}

data class Meldung(
    val kanal: String,
    val titel: String,
    val text: String,
    /** Raum und Thread der Frage: mit beiden bekommt die Meldung ein Antwortfeld (Punkt 11). */
    val raum: String? = null,
    val thread: String? = null,
    val event: String? = null,
)

/**
 * Was eine neue Nachricht für dich bedeutet. `art` ist lobby, freigaben, alarme oder eine Agent-ID.
 * Freigaben meldet [PruefArbeit] selbst, mit Frist und Sprung in die App.
 *
 * `raum` und `eventId` braucht die App für das Antwortfeld in der Meldung (Punkt 11): Die Antwort geht in
 * denselben Thread, in dem die Frage steht. Steht die Frage selbst in einem Thread, ist dessen Anfang das Ziel.
 */
fun einordnen(
    art: String,
    vomHub: Boolean,
    body: String,
    inhalt: JsonObject,
    ich: String,
    raum: String? = null,
    eventId: String? = null,
): Meldung? {
    val erste = body.lineSequence().firstOrNull().orEmpty().trim()
    val kurz = body.take(400)
    val rel = inhalt.obj("m.relates_to")
    val thread = if (rel?.str("rel_type") == "m.thread") rel.str("event_id") else eventId
    fun antwortbar(m: Meldung) = if (raum != null && thread != null && thread.startsWith("$")) {
        m.copy(raum = raum, thread = thread, event = eventId ?: thread)
    } else m
    return when (art) {
        "freigaben" -> null
        "alarme" -> when {
            // Antworten auf deine eigenen Reaktionen (✅ quittieren, 🔕 stumm, 🔔 laut) sind nichts Neues.
            erste.startsWith("✅") && (erste.contains("quittiert von") || erste.contains("geschlossen von")) -> null
            erste.startsWith("🔕") || erste.startsWith("🔔") -> null
            erste.startsWith("🚨") -> Meldung(Hintergrund.ALARME, "Alarm", kurz)
            erste.startsWith("⚠️") -> Meldung(Hintergrund.ALARME, "Warnung", kurz)
            else -> Meldung(Hintergrund.UEBERSICHT, "Meldung", kurz)
        }
        "lobby" -> if (!vomHub) null else when {
            erste.startsWith("❓") -> antwortbar(
                Meldung(Hintergrund.WARTET, if (body.contains("📋")) "Plan wartet auf dich" else "Rückfrage an dich", kurz),
            )
            // Ein Tor eines Ablaufs wartet auf ✅ oder ❌ (Punkt 11).
            erste.startsWith("🚦") -> Meldung(Hintergrund.WARTET, "Ablauf wartet auf dich", kurz)
            erste.startsWith("🔐") -> Meldung(Hintergrund.FREIGABEN, "Freigabe nötig", kurz)
            erste.startsWith("✅") || erste.startsWith("❌") || erste.startsWith("↩️") || erste.startsWith("🚫") ->
                Meldung(Hintergrund.ERGEBNISSE, erste.take(80), kurz)
            erste.startsWith("☀️") -> Meldung(Hintergrund.UEBERSICHT, "Tagesübersicht", body.take(700))
            // Der Tagesbericht um 21:00 (App 2.5), ruhig wie die Übersicht am Morgen.
            erste.startsWith("🌙") -> Meldung(Hintergrund.UEBERSICHT, "Tagesbericht", body.take(700))
            else -> null
        }
        else -> {
            val erwaehnt = inhalt.obj("m.mentions")?.arr("user_ids")
                ?.any { (it as? JsonPrimitive)?.content == ich } == true
            if (erwaehnt) antwortbar(Meldung(Hintergrund.WARTET, "$art fragt dich", kurz)) else null
        }
    }
}

class PruefArbeit(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    /** Für den Weckruf vor Android 12: WorkManager braucht dann eine Benachrichtigung, solange die Prüfung läuft. */
    override suspend fun getForegroundInfo(): ForegroundInfo = ForegroundInfo(
        4712,
        NotificationCompat.Builder(applicationContext, Hintergrund.UEBERSICHT)
            .setSmallIcon(R.drawable.swarm_ic_stat_schwarm)
            .setContentTitle("Schwarm prüft, was neu ist …")
            .setSilent(true)
            .build(),
    )

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val speicher = Sitzungsspeicher(applicationContext)
        val s = speicher.laden() ?: return@withContext Result.success()
        if (!speicher.benachrichtigungen) return@withContext Result.success()
        val client = MatrixClient(s.homeserver, s.accessToken)
        try {
            val d = s.domain
            val arten = mapOf(
                "schwarm-lobby" to "lobby", "schwarm-freigaben" to "freigaben", "schwarm-alarme" to "alarme",
                "ag-brian" to "Brian", "ag-claude-code" to "Claude Code", "ag-codex-host" to "Codex", "ag-hermes-phone" to "Hermes Phone", "ag-plum" to "Plum",
            ).mapNotNull { (alias, art) ->
                runCatching { client.aliasAufloesen("#$alias:$d") }.getOrNull()?.let { it to art }
            }.toMap()
            // Allgemein (App 2.1): der Raum steht in den Account-Daten.
            val allgemein = runCatching { client.kontoDaten(s.userId, KONTO_ALLGEMEIN)?.str("room_id") }.getOrNull()
                ?.takeIf { it.startsWith("!") && it !in arten }
            val alleArten = if (allgemein != null) arten + (allgemein to "allgemein") else arten
            if (alleArten.isEmpty()) return@withContext Result.success()
            val filter = buildJsonObject {
                put("room", buildJsonObject {
                    put("rooms", JsonArray(alleArten.keys.map { JsonPrimitive(it) }))
                    put("timeline", buildJsonObject { put("limit", JsonPrimitive(30)) })
                    put("state", buildJsonObject { put("types", JsonArray(emptyList())) })
                    put("ephemeral", buildJsonObject { put("types", JsonArray(emptyList())) })
                    put("account_data", buildJsonObject { put("types", JsonArray(emptyList())) })
                })
                put("presence", buildJsonObject { put("types", JsonArray(emptyList())) })
                put("account_data", buildJsonObject { put("types", JsonArray(emptyList())) })
            }.toString()
            val since = speicher.hintergrundSince
            val antwort = client.sync(filter, since, 0)
            speicher.hintergrundSince = antwort.nextBatch
            // Erster Lauf: nur den Stand merken, sonst käme der ganze Verlauf als Meldung.
            if (since == null) {
                RuheSpeicher.pruefungMerken(applicationContext, "ok, erster Lauf")
                return@withContext Result.success()
            }
            // Ist die App offen, sieht Vale es ohnehin.
            if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                RuheSpeicher.pruefungMerken(applicationContext, "ok, App war offen")
                return@withContext Result.success()
            }
            val hub = "@schwarm:$d"
            antwort.rooms?.join?.forEach { (raum, r) ->
                val art = alleArten[raum] ?: return@forEach
                val events = r.timeline?.events.orEmpty()
                if (art == "allgemein") {
                    AllgemeinMelder(applicationContext, client, raum, "@$BRIAN_LOKAL:$d").apply {
                        aufnehmen(events)
                        melden(null)
                    }
                    return@forEach
                }
                if (art == "freigaben") {
                    freigabenMelden(raum, events, hub)
                    return@forEach
                }
                events.forEach { e ->
                    if (e.type != "m.room.message" || e.sender == s.userId) return@forEach
                    if (e.content.obj("m.relates_to")?.str("rel_type") == "m.replace") return@forEach
                    val body = e.content.str("body") ?: return@forEach
                    einordnen(art, e.sender == hub, body, e.content, s.userId, raum, e.eventId)?.let {
                        melden(it, (e.eventId ?: body).hashCode(), freigaben = it.kanal == Hintergrund.FREIGABEN)
                    }
                }
            }
            val offen = antwort.rooms?.invite?.keys.orEmpty().count { it in arten }
            if (offen > 0) {
                melden(Meldung(Hintergrund.WARTET, "Schwarm-Einladungen", "$offen Räume warten darauf, dass du beitrittst."), 4711)
            }
            RuheSpeicher.pruefungMerken(applicationContext, "ok, $gemeldet gemeldet")
            Result.success()
        } catch (e: MatrixFehler) {
            RuheSpeicher.pruefungMerken(applicationContext, "Matrix antwortet ${e.status}")
            if (e.status == 401) Result.success() else Result.retry()
        } catch (e: Exception) {
            RuheSpeicher.pruefungMerken(applicationContext, "Fehler: ${e.message ?: e.javaClass.simpleName}")
            Result.retry()
        } finally {
            client.schliessen()
        }
    }

    /**
     * Neue offene Freigaben melden: eigener Kanal, Tippen öffnet die Freigaben in der App. Seit App 2.7 mit zwei
     * Knöpfen: „Freigeben“ fragt erst nach Fingerabdruck oder Gerätesperre (FreigabeActivity), „Ablehnen“ setzt ❌
     * gleich. Quittiert der Hub eine Freigabe, verschwindet ihre Meldung; nach der Frist sowieso.
     */
    private fun freigabenMelden(raum: String, events: List<Ereignis>, hub: String) {
        val jetzt = System.currentTimeMillis()
        val vomHub = events.filter { it.type == "m.room.message" && it.sender == hub }
        val entschieden = HashSet<String>()
        vomHub.forEach { e ->
            val rel = e.content.obj("m.relates_to") ?: return@forEach
            if (rel.str("rel_type") != "m.thread") return@forEach
            if (Lebenslauf.quittungLesen(e.content.str("body") ?: return@forEach) == null) return@forEach
            val wurzel = rel.str("event_id") ?: return@forEach
            entschieden += wurzel
            NotificationManagerCompat.from(applicationContext).cancel(wurzel.hashCode())
        }
        vomHub.forEach { e ->
            val id = e.eventId ?: return@forEach
            if (e.content.obj("m.relates_to") != null || id in entschieden) return@forEach
            val f = Lebenslauf.freigabeLesen(e.content.str("body") ?: return@forEach) ?: return@forEach
            val ablauf = e.ts + f.fristMin * 60_000L
            if (ablauf <= jetzt) return@forEach
            val text = buildString {
                append("An ${f.ziel}: ${f.was.lineSequence().firstOrNull().orEmpty()}")
                if (f.kette.isNotBlank()) append("\nKette: ${f.kette}")
                append("\nGrenzen: ${f.grenzen ?: "keine"}")
                append("\nLäuft ab um ${SimpleDateFormat("HH:mm", Locale.GERMAN).format(Date(ablauf))}.")
            }
            val ctx = applicationContext
            val freigeben = PendingIntent.getActivity(
                ctx, id.hashCode(),
                Intent(ctx, FreigabeActivity::class.java)
                    .putExtra(FreigabeActivity.RAUM, raum).putExtra(FreigabeActivity.EVENT, id)
                    .putExtra(FreigabeActivity.AUFTRAG, f.auftragId).putExtra(FreigabeActivity.ZIEL_AGENT, f.ziel)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val ablehnen = PendingIntent.getBroadcast(
                ctx, id.hashCode(),
                Intent(ctx, FreigabeAblehnen::class.java).putExtra(FreigabeActivity.RAUM, raum).putExtra(FreigabeActivity.EVENT, id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            melden(
                Meldung(Hintergrund.FREIGABEN, "Freigabe nötig · ${f.auftragId}", text),
                id.hashCode(),
                freigaben = true,
                gueltigMs = ablauf - jetzt,
                aktionen = listOf(
                    NotificationCompat.Action(0, "Ablehnen", ablehnen),
                    NotificationCompat.Action(0, "Freigeben …", freigeben),
                ),
            )
        }
    }

    private var gemeldet = 0

    private fun melden(m: Meldung, id: Int, freigaben: Boolean = false, gueltigMs: Long? = null, aktionen: List<NotificationCompat.Action> = emptyList()) {
        val ctx = applicationContext
        gemeldet++
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val ziel = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (freigaben) ziel.putExtra(MainActivity.ZIEL, MainActivity.ZIEL_FREIGABEN)
        // Eigener Request-Code: sonst überschriebe FLAG_UPDATE_CURRENT das Ziel der übrigen Meldungen.
        val oeffnen = PendingIntent.getActivity(
            ctx, if (freigaben) 1 else 0, ziel,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // Rückfragen aus der Meldung beantworten (Punkt 11): RemoteInput braucht einen veränderlichen Intent.
        val antworten = if (m.raum != null && m.thread != null) {
            PendingIntent.getBroadcast(
                ctx, id,
                Intent(ctx, AntwortEmpfaenger::class.java)
                    .putExtra(AntwortEmpfaenger.RAUM, m.raum)
                    .putExtra(AntwortEmpfaenger.THREAD, m.thread)
                    .putExtra(AntwortEmpfaenger.EVENT, m.event ?: m.thread)
                    .putExtra(AntwortEmpfaenger.MELDUNG, id),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        } else null
        val n = NotificationCompat.Builder(ctx, m.kanal)
            .setSmallIcon(R.drawable.swarm_ic_stat_schwarm)
            .setContentTitle(m.titel)
            .setContentText(m.text.lineSequence().firstOrNull() ?: m.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(m.text))
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .setGroup("schwarm")
            // Ruhezeit (App 2.9): Freigaben, 🚨 und ⛔ bleiben laut, der Rest kommt still.
            .setSilent(RuheSpeicher.still(ctx, dringend = freigaben || m.titel == "Alarm" || m.text.trimStart().startsWith("⛔")))
            .apply { if (gueltigMs != null) setTimeoutAfter(gueltigMs) }
            .apply {
                if (antworten != null) {
                    addAction(
                        NotificationCompat.Action.Builder(
                            0, "Antworten", antworten,
                        ).addRemoteInput(RemoteInput.Builder(AntwortEmpfaenger.SCHLUESSEL).setLabel("Antwort").build())
                            .build(),
                    )
                }
            }
            .apply { aktionen.forEach { addAction(it) } }
            .build()
        NotificationManagerCompat.from(ctx).notify(id, n)
    }
}
