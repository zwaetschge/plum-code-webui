package com.claudewebui.swarm.data

/**
 * Freigaben (#schwarm-freigaben) und Alarme (#schwarm-alarme) aus dem Verlauf lesen: die Notice
 * des Hubs, die Antworten in ihrem Thread und deine Reaktionen darauf. Nur Text, kein Netz;
 * so liest die Vorschau mit denselben Funktionen wie der echte Sync. Was nicht passt, bleibt
 * eine gewöhnliche Nachricht zum Lesen. Werfen darf hier nichts.
 */
object Lebenslauf {

    /** Einträge mit Lebenslauf und die übrigen Notices des Raums (ältere Formate, nur lesen). */
    data class Gelesen<T>(val eintraege: List<T>, val nurLesen: List<Nachricht>)

    /** Die Felder einer Freigabe-Notice, wie sie `council/freigabe.ts` schreibt. */
    data class FreigabeText(
        val auftragId: String,
        val stufe: String?,
        val kette: String,
        val was: String,
        val ergebnis: String?,
        val grenzen: String?,
        val fristMin: Int,
    ) {
        val ziel: String get() = kette.substringAfterLast('→').trim().ifBlank { "?" }
    }

    /** Die Teile einer Alarm-Notice, wie sie `alarme.ts` schreibt. */
    data class AlarmText(
        val stufe: AlarmStufe,
        /** Name vor dem Titel, wenn der Hub selbst oder für eine Quelle ohne Puppet spricht („hub: …“). */
        val name: String?,
        val titel: String,
        val text: String,
        val link: String?,
        val fingerabdruck: String,
    )

    /** Reaktionen vergleicht der Hub ohne Emoji-Variantenwähler (U+FE0F); die App auch. */
    fun zeichen(schluessel: String): String = schluessel.replace("\uFE0F", "")

    // ── Freigaben ───────────────────────────────────────────────────────────

    private val freigabeKopf = Regex("""^🔐\uFE0F?\s*Freigabe nötig\s*·\s*(T-\d+)(.*)$""")
    private val stufeImKopf = Regex("""\b(T\d)-Agent""")
    private val fristImText = Regex("""nach\s+(\d{1,4})\s*min""")
    private val quittungZeile = Regex("""^(?:✅|❌|⌛)\uFE0F?\s*(freigegeben|abgelehnt|abgelaufen)\b.*·\s*(T-\d+)\s*$""")
    private val freigabeFelder = listOf("Kette", "Was", "Ergebnis", "Grenzen", "Läuft ab")

    /**
     * ```
     * 🔐 Freigabe nötig · T-0042 · T2-Agent
     * Kette: Vale → Brian → Codex (Host)
     * Was: …            (darf über mehrere Zeilen gehen)
     * Ergebnis: …
     * Grenzen: … oder „keine“
     * Läuft ab: 14:32 (nach 30 min)
     * ✅ auf diese Nachricht gibt frei, ❌ lehnt ab. …
     * ```
     */
    fun freigabeLesen(text: String): FreigabeText? = runCatching {
        val zeilen = text.lines()
        val kopf = freigabeKopf.find(zeilen.firstOrNull()?.trim().orEmpty()) ?: return@runCatching null
        val werte = LinkedHashMap<String, StringBuilder>()
        var feld: String? = null
        for (roh in zeilen.drop(1)) {
            val zeile = roh.trimEnd()
            val neu = freigabeFelder.firstOrNull { zeile.startsWith("$it:") }
            if (neu != null) {
                feld = neu
                werte[neu] = StringBuilder(zeile.substring(neu.length + 1).trim())
            } else if (zeile.trimStart().startsWith("✅")) {
                feld = null // der Bedienhinweis am Schluss
            } else {
                feld?.let { werte[it]?.append('\n')?.append(zeile) }
            }
        }
        val wert = { k: String -> werte[k]?.toString()?.trim()?.ifBlank { null } }
        FreigabeText(
            auftragId = kopf.groupValues[1],
            stufe = stufeImKopf.find(kopf.groupValues[2])?.groupValues?.get(1),
            kette = wert("Kette").orEmpty(),
            was = wert("Was").orEmpty(),
            ergebnis = wert("Ergebnis"),
            grenzen = wert("Grenzen"),
            fristMin = wert("Läuft ab")?.let { fristImText.find(it) }?.groupValues?.get(1)?.toIntOrNull()
                ?.takeIf { it in 1..1440 } ?: FREIGABE_FRIST_MIN,
        )
    }.getOrNull()

    /** „✅ freigegeben · T-0042“, „❌ abgelehnt · T-0042“ oder „⌛ abgelaufen nach 30 min · T-0042“. */
    fun quittungLesen(text: String): Pair<FreigabeZustand, String>? = runCatching {
        val m = quittungZeile.find(text.lineSequence().firstOrNull()?.trim().orEmpty()) ?: return@runCatching null
        val zustand = when (m.groupValues[1]) {
            "freigegeben" -> FreigabeZustand.FREIGEGEBEN
            "abgelehnt" -> FreigabeZustand.ABGELEHNT
            else -> FreigabeZustand.ABGELAUFEN
        }
        zustand to m.groupValues[2]
    }.getOrNull()

    /**
     * Freigaben aus dem Verlauf von #schwarm-freigaben. Notices und Quittungen zählen nur vom Hub;
     * die erste Quittung entscheidet, wie im Hub. Fehlt einer Quittung die Thread-Beziehung, gehört
     * sie zur letzten Notice mit derselben Auftragsnummer davor.
     */
    fun freigabenLesen(nachrichten: List<Nachricht>): Gelesen<Freigabe> = runCatching {
        val notices = LinkedHashMap<String, Pair<Nachricht, FreigabeText>>()
        for (n in nachrichten) {
            if (!n.vomHub || n.threadWurzel != null) continue
            freigabeLesen(n.text)?.let { notices[n.eventId] = n to it }
        }
        val quittungen = HashMap<String, Pair<FreigabeZustand, Long>>()
        val verbraucht = HashSet<String>()
        for (n in nachrichten.sortedBy { it.zeit }) {
            if (!n.vomHub) continue
            val (zustand, id) = quittungLesen(n.text) ?: continue
            val ziel = n.threadWurzel?.let { notices[it] }?.takeIf { it.second.auftragId == id }
                ?: notices.values.filter { it.second.auftragId == id && it.first.zeit <= n.zeit }.maxByOrNull { it.first.zeit }
                ?: continue
            verbraucht += n.eventId
            quittungen.putIfAbsent(ziel.first.eventId, zustand to n.zeit)
        }
        val liste = notices.values.map { (n, f) ->
            val q = quittungen[n.eventId]
            val meine = n.eigeneReaktionen.map(::zeichen).toSet()
            Freigabe(
                eventId = n.eventId,
                raumId = n.raumId,
                auftragId = f.auftragId,
                stufe = f.stufe,
                kette = f.kette,
                was = f.was,
                ergebnis = f.ergebnis,
                grenzen = f.grenzen,
                gesendet = n.zeit,
                ablauf = n.zeit + f.fristMin * 60_000L,
                zustand = q?.first ?: FreigabeZustand.OFFEN,
                quittiert = q?.second,
                meineReaktion = listOf("✅", "❌", "🛑").firstOrNull { it in meine },
            )
        }.sortedByDescending { it.gesendet }
        Gelesen(liste, nachrichten.filter { it.threadWurzel == null && it.eventId !in notices && it.eventId !in verbraucht })
    }.getOrElse { Gelesen(emptyList(), nachrichten.filter { it.threadWurzel == null }) }

    // ── Pläne, Tore und Hinweise ────────────────────────────────────────────

    private val planZeichen = Regex("""📋\uFE0F?\s*Plan""")
    private val auftragNummer = Regex("""\bT-\d{1,8}\b""")
    private val ablaufName = Regex("""Ablauf\s+([^\s,.;:#]+)(?:\s+#(\d+))?""")

    /** Tore, die länger liegen, gelten als überholt: Der Hub hat den Ablauf dann längst beendet. */
    private const val TOR_FRIST_MS = 24 * 3_600_000L

    /** Vom Hub oder einem seiner Puppets (`@_sw_…`, nur der Appservice darf die anlegen). */
    fun vomSchwarm(n: Nachricht): Boolean = n.vomHub || n.absender.startsWith("@_sw_")

    /**
     * Ein Plan als Rückfrage im Thread der Auftragskarte (Punkt 8): Die Notice beginnt mit „❓“
     * („❓ T-0042 · <Agent>“) und enthält „📋 Plan“, meist in der zweiten Zeile.
     */
    fun istPlan(n: Nachricht): Boolean {
        val t = n.text.trimStart()
        return n.notice && vomSchwarm(n) && t.startsWith("❓") && planZeichen.containsMatchIn(t)
    }

    /** „🚦 Ablauf code-änderung, Schritt 2/4 fertig (T-0043). Weiter? ✅ / ❌“ (Punkt 11). */
    fun istTor(n: Nachricht): Boolean = n.notice && vomSchwarm(n) && n.text.trimStart().startsWith("🚦")

    /** Auftragsnummern im Text, etwa aus „🔎 Ähnlich: T-0123 (✅ …), …“ (Punkt 9). */
    fun auftragsnummern(text: String): List<String> = auftragNummer.findAll(text).map { it.value }.distinct().toList()

    /** „🆕“ und „🗑“ der Plum-Brücke in #ag-plum (Frame `meldung`), neueste zuerst. */
    fun plumHinweise(nachrichten: List<Nachricht>, plum: String, anzahl: Int = 10): List<Nachricht> =
        nachrichten.filter { n ->
            val t = n.text.trimStart()
            n.notice && n.absender == plum && n.threadWurzel == null && (t.startsWith("🆕") || t.startsWith("🗑"))
        }.sortedByDescending { it.zeit }.take(anzahl)

    /**
     * Pläne und Tore aus allen geladenen Räumen.
     *
     * Einen Plan postet der Hub zweimal: als ❓ im Thread der Karte und als „❓ <Agent> fragt zu T-…“ in
     * der Lobby. Deine Reaktion wirkt auf beiden; die App fasst sie je Auftrag zusammen. Ein Plan wartet,
     * solange du auf keine der beiden reagiert hast, er der neueste seines Auftrags ist und der Auftrag
     * noch auf die Rückfrage wartet.
     *
     * Ein Tor („🚦 Ablauf <name> #<nr>, Schritt …“) steht im Thread seines Ablaufs. Es wartet ohne deine
     * Reaktion, solange danach nichts mehr vom Hub in diesem Thread kam, es das neueste seines Ablaufs
     * ist und nicht älter als 24 h.
     */
    fun entscheidungenLesen(verlaeufe: Map<String, Verlauf>, auftraege: List<Auftrag>, jetzt: Long): List<Entscheidung> =
        runCatching {
            val alle = verlaeufe.values.flatMap { it.nachrichten }
            fun meine(n: Nachricht): String? = n.eigeneReaktionen.map(::zeichen).let { r -> listOf("✅", "❌").firstOrNull { it in r } }

            val plaene = alle.filter(::istPlan).map { n ->
                val auftrag = auftraege.firstOrNull { it.raumId == n.raumId && it.threadWurzel != null && it.threadWurzel == n.threadWurzel }
                    ?: auftragsnummern(n.text).firstNotNullOfOrNull { id -> auftraege.firstOrNull { it.id == id } }
                Triple(n, auftrag, auftrag?.id ?: auftragsnummern(n.text).firstOrNull())
            }
            val ausPlaenen = plaene.groupBy { it.third ?: it.first.eventId }.flatMap { (_, gruppe) ->
                val neueste = gruppe.maxOf { it.first.zeit }
                // Die Notice im Thread der Karte ist das Original; ohne sie gilt die neueste als Original.
                val original = gruppe.filter { it.first.threadWurzel != null }.maxByOrNull { it.first.zeit }?.first
                    ?: gruppe.maxByOrNull { it.first.zeit }?.first
                val mein = gruppe.sortedByDescending { it.first.zeit }.firstNotNullOfOrNull { meine(it.first) }
                gruppe.map { (n, auftrag, id) ->
                    // Eine Kopie gilt als aktuell, solange sie nicht älter ist als der neueste Plan des Auftrags.
                    val aktuell = n.zeit >= neueste - 5 * 60_000L
                    Entscheidung(
                        EntscheidungsArt.PLAN, n, id, null, meine(n) ?: mein,
                        offen = mein == null && aktuell && (auftrag == null || auftrag.zustand == Zustand.RUECKFRAGE),
                        kopie = n.eventId != original?.eventId,
                    )
                }
            }

            val tore = alle.filter(::istTor)
            fun schluessel(n: Nachricht): Pair<String, String?> {
                val m = ablaufName.find(n.text)
                val ablauf = m?.let { it.groupValues[1] + (it.groupValues[2].takeIf { nr -> nr.isNotEmpty() }?.let { nr -> "#$nr" } ?: "") }
                return n.raumId + "|" + (n.threadWurzel ?: "") to ablauf
            }
            val neuestesTor = tore.groupBy(::schluessel).mapValues { (_, l) -> l.maxOf { it.zeit } }
            val ausToren = tore.map { n ->
                val mein = meine(n)
                val m = ablaufName.find(n.text)
                // Kam danach noch etwas vom Hub in denselben Thread, ist der Ablauf weiter (oder beendet).
                val weiter = n.threadWurzel != null && alle.any {
                    it.vomHub && it.raumId == n.raumId && it.threadWurzel == n.threadWurzel && it.zeit > n.zeit && it.eventId != n.eventId
                }
                Entscheidung(
                    EntscheidungsArt.TOR, n, auftragsnummern(n.text).firstOrNull(),
                    m?.groupValues?.get(1)?.let { name -> name + (m.groupValues[2].takeIf { it.isNotEmpty() }?.let { " #$it" } ?: "") },
                    mein,
                    offen = mein == null && !weiter && neuestesTor[schluessel(n)] == n.zeit && jetzt - n.zeit < TOR_FRIST_MS,
                )
            }
            (ausPlaenen + ausToren).sortedByDescending { it.nachricht.zeit }
        }.getOrDefault(emptyList())

    // ── Alarme ──────────────────────────────────────────────────────────────

    /** Vor diesem Teil der letzten Zeile steht der Fingerabdruck: „ · ✅ quittieren“, früher „ · ✅ schliessen“. */
    private const val BEDIENUNG = " · ✅"
    private val fingerabdruckForm = Regex("""^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,127}$""")
    private val nurLink = Regex("""^https?://\S+$""")
    private val anstiegZeile = Regex("""jetzt\s+(info|warn|crit):\s*(.*)$""")
    private val stummStunden = Regex("""\((\d{1,3})\s*h\)""")
    private val nameVorAntwort = Regex("""^(?:✅|⬆)\uFE0F?\s*(?:(?:🚨|⚠\uFE0F?|ℹ\uFE0F?)\s*)?(.+?):\s*(?:behoben|jetzt)\b""")

    /** Stufe aus dem Zeichen am Zeilenanfang (ℹ️ ⚠️ 🚨) und der Rest der Zeile. */
    fun stufeLesen(zeile: String): Pair<AlarmStufe, String>? {
        val z = zeile.trimStart()
        val (zeichen, stufe) = listOf("🚨" to AlarmStufe.CRIT, "⚠" to AlarmStufe.WARN, "ℹ" to AlarmStufe.INFO)
            .firstOrNull { z.startsWith(it.first) } ?: return null
        return stufe to z.removePrefix(zeichen).removePrefix("\uFE0F").trim()
    }

    /**
     * ```
     * ⚠️ paperless: unhealthy seit 3 min
     * <Text, beliebig viele Zeilen>
     * <Link>
     * docker-health:paperless · ✅ quittieren · 🔕 24 h stumm
     * ```
     * Bis 2026-09-26 hiess es „✅ schliessen“; beides gilt. Ohne die letzte Zeile mit dem
     * Fingerabdruck ist es kein Alarm, sondern eine einfache Meldung.
     */
    fun alarmLesen(text: String, vomHub: Boolean): AlarmText? = runCatching {
        val zeilen = text.lines().map { it.trimEnd() }.dropLastWhile { it.isBlank() }
        if (zeilen.size < 2) return@runCatching null
        val letzte = zeilen.last()
        val pos = letzte.indexOf(BEDIENUNG)
        if (pos <= 0) return@runCatching null
        val fingerabdruck = letzte.substring(0, pos).trim()
        if (!fingerabdruckForm.matches(fingerabdruck)) return@runCatching null
        val (stufe, kopf) = stufeLesen(zeilen.first()) ?: (AlarmStufe.INFO to zeilen.first().trim())
        // Nur der Hub setzt einen Namen davor; bei einem Puppet gehört „paperless: …“ zum Titel.
        val geteilt = vomHub && kopf.contains(": ")
        val name = if (geteilt) kopf.substringBefore(": ").trim().ifBlank { null } else null
        val titel = if (geteilt) kopf.substringAfter(": ").trim() else kopf
        val mitte = zeilen.subList(1, zeilen.size - 1)
        val link = mitte.lastOrNull()?.trim()?.takeIf { nurLink.matches(it) }
        val rest = if (link != null) mitte.dropLast(1) else mitte
        AlarmText(stufe, name, titel.ifBlank { fingerabdruck }, rest.joinToString("\n").trim(), link, fingerabdruck)
    }.getOrNull()

    /**
     * Alarme aus dem Verlauf von #schwarm-alarme. Antworten zählen nur vom Hub oder von der Quelle
     * der Notice: Anstieg, Behebung, Quittieren, Stumm und Laut, in der Reihenfolge ihrer Zeit.
     */
    fun alarmeLesen(nachrichten: List<Nachricht>): Gelesen<Alarm> = runCatching {
        val staende = LinkedHashMap<String, AlarmStand>()
        val verbraucht = HashSet<String>()
        for (n in nachrichten.sortedBy { it.zeit }) {
            if (n.threadWurzel == null) {
                val alarm = alarmLesen(n.text, n.vomHub)
                if (alarm != null) {
                    staende[n.eventId] = AlarmStand(n, alarm)
                    continue
                }
            }
            val ziel = if (n.threadWurzel != null) staende[n.threadWurzel] else nachzuegler(n, staende.values)
            if (ziel == null || (!n.vomHub && n.absender != ziel.notice.absender)) continue
            if (ziel.anwenden(n)) verbraucht += n.eventId
        }
        Gelesen(
            staende.values.map { it.alarm() },
            nachrichten.filter { it.threadWurzel == null && it.eventId !in staende && it.eventId !in verbraucht },
        )
    }.getOrElse { Gelesen(emptyList(), nachrichten.filter { it.threadWurzel == null }) }

    /**
     * War die Notice noch nicht draussen, als der Hub Anstieg oder Behebung schrieb, kommt die
     * Antwort ohne Thread direkt danach. Sie gehört zur letzten offenen Notice derselben Quelle.
     */
    private fun nachzuegler(n: Nachricht, staende: Collection<AlarmStand>): AlarmStand? {
        val erste = n.text.lineSequence().firstOrNull()?.trim().orEmpty()
        val ohneZeichen = erste.removePrefix("✅").removePrefix("\uFE0F").trim()
        val behebung = erste.startsWith("✅") && !istQuittung(ohneZeichen) && ohneZeichen.contains("behoben")
        if (!erste.startsWith("⬆") && !behebung) return null
        val name = nameVorAntwort.find(erste)?.groupValues?.get(1)?.trim()
        return staende.lastOrNull {
            it.notice.absender == n.absender && it.zustand == AlarmZustand.OFFEN && it.notice.zeit <= n.zeit &&
                (!n.vomHub || it.text.name == name)
        }
    }

    /**
     * Die Antwort des Hubs auf dein ✅: „✅ quittiert von Vale · meldet sich erst wieder, wenn er
     * behoben war oder schlimmer wird“, bis 2026-09-26 „✅ geschlossen von Vale“. Sie nennt auch
     * „behoben“, darum wird sie vor der Behebung geprüft.
     */
    private fun istQuittung(ohneZeichen: String): Boolean =
        ohneZeichen.startsWith("quittiert") || ohneZeichen.startsWith("geschlossen")

    private class AlarmStand(val notice: Nachricht, val text: AlarmText) {
        var stufe = text.stufe
        var zustand = AlarmZustand.OFFEN
        var beendet: Long? = null
        var beendetText: String? = null
        var anstieg: String? = null
        var stummBis: Long? = null
        var stummGeaendert = 0L
        var zuletzt = notice.zeit

        /** Eine Antwort anwenden; `false`, wenn sie kein Teil des Lebenslaufs ist. */
        fun anwenden(a: Nachricht): Boolean {
            val erste = a.text.lineSequence().firstOrNull()?.trim().orEmpty()
            val ohneZeichen = erste.removePrefix("✅").removePrefix("\uFE0F").trim()
            when {
                erste.startsWith("⬆") -> {
                    val m = Lebenslauf.anstiegZeile.find(erste) ?: return false
                    val neu = AlarmStufe.von(m.groupValues[1]) ?: return false
                    if (neu.ordinal > stufe.ordinal) stufe = neu
                    anstieg = m.groupValues[2].trim().ifBlank { null }
                }
                erste.startsWith("✅") && Lebenslauf.istQuittung(ohneZeichen) -> beenden(AlarmZustand.QUITTIERT, a.zeit, ohneZeichen)
                erste.startsWith("✅") && ohneZeichen.contains("behoben") -> beenden(AlarmZustand.BEHOBEN, a.zeit, ohneZeichen)
                erste.startsWith("🔕") && erste.contains("stumm") -> {
                    val stunden = Lebenslauf.stummStunden.find(erste)?.groupValues?.get(1)?.toLongOrNull()?.takeIf { it in 1..168 } ?: 24L
                    stummBis = a.zeit + stunden * 3_600_000L
                    stummGeaendert = a.zeit
                }
                erste.startsWith("🔔") && erste.contains("laut") -> {
                    stummBis = null
                    stummGeaendert = a.zeit
                }
                else -> return false
            }
            zuletzt = maxOf(zuletzt, a.zeit)
            return true
        }

        private fun beenden(wie: AlarmZustand, zeit: Long, text: String) {
            if (zustand != AlarmZustand.OFFEN) return // der erste Abschluss zählt
            zustand = wie
            beendet = zeit
            beendetText = text.ifBlank { null }
        }

        fun alarm() = Alarm(
            eventId = notice.eventId,
            raumId = notice.raumId,
            quelle = text.name?.let { if (it == "hub") "Hub" else it } ?: notice.absenderName,
            absender = notice.absender,
            stufe = stufe,
            ersteStufe = text.stufe,
            titel = text.titel,
            text = text.text,
            link = text.link,
            fingerabdruck = text.fingerabdruck,
            zeit = notice.zeit,
            zustand = zustand,
            beendet = beendet,
            beendetText = beendetText,
            anstieg = anstieg,
            stummBis = stummBis,
            stummGeaendert = stummGeaendert,
            zuletzt = zuletzt,
            meineReaktionen = notice.eigeneZeiten.mapKeys { Lebenslauf.zeichen(it.key) },
        )
    }
}
