package com.claudewebui.swarm.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Modelle je Agent (SCHNITTSTELLEN-app.md, App 2.2): State-Event `ch.zwaetschge.swarm.modelle` in der
 * Lobby, `state_key` = Agent. Gesetzt wird mit `!modell` in der Lobby; die App baut nur den Befehl.
 */
const val SCHWARM_MODELLE = "ch.zwaetschge.swarm.modelle"

/** Stimmen je Agent (App 2.3): die Liste aus Vocarium, die Stimme des Hubs und der Standard. */
const val SCHWARM_STIMMEN = "ch.zwaetschge.swarm.stimmen"

/** Eine Stimme; `engine` kikiri (deutsch, schnell), omnivoice (Charakter) oder etwas anderes. */
data class Stimme(val id: String, val name: String, val sprache: String?, val engine: String?)

data class StimmenStand(
    val stimmen: List<Stimme>,
    /** Die Stimme für die Notices des Hubs (`@schwarm`). */
    val hub: String?,
    val hubStandard: String?,
    /** Die Stimme für alle anderen, auch für deine eigenen Nachrichten. */
    val standard: String?,
) {
    fun stimme(id: String?): Stimme? = id?.let { i -> stimmen.firstOrNull { it.id == i } }

    /** Der Anzeigename; unbekannte IDs bleiben, wie sie sind. */
    fun name(id: String?): String? = id?.let { i -> stimme(i)?.name ?: i }
}

/** Ein wählbares Modell; `anbieter` nur, wenn der Hub ihn nennt (für `/model … --provider`). */
data class ModellWahl(val id: String, val name: String, val anbieter: String? = null)

/** Modell, Ersatzkette und Aufwand, etwa der Standard eines Agenten. */
data class ModellGrund(val modell: String?, val fallback: List<String>, val aufwand: String?)

data class ModellStand(
    val agent: String,
    /** claude, codex, plum, hermes, extern oder keins. */
    val art: String,
    val einstellbar: Boolean,
    val modell: String?,
    val fallback: List<String>,
    val aufwand: String?,
    val standard: ModellGrund?,
    val modelle: List<ModellWahl>,
    val aufwaende: List<String>,
    val fallbackAenderbar: Boolean,
    /** Wie viele Ersatzmodelle der Agent nimmt (claude-code 1, plum 2, codex-host 3). */
    val fallbackMax: Int,
    /** naechster-auftrag, neue-sitzung oder sofort. */
    val wirkt: String?,
    val hinweis: String?,
    /** Nur für einen Chat in Allgemein wählbar (Brian), etwa GPT-5.6-Sol über das ChatGPT-Abo. */
    val nurChat: List<ModellWahl>,
    val geaendertVon: String?,
    val geaendertAm: Long?,
    /** Brians Antwort auf den letzten Wechsel, erste Zeile. */
    val bestaetigung: String?,
    /** Die wirksame Stimme beim Vorlesen und die aus dem Katalog (App 2.3). */
    val stimme: String? = null,
    val stimmeStandard: String? = null,
) {
    val ohneModell: Boolean get() = art == "keins"
    val extern: Boolean get() = art == "extern"

    /** Der Anzeigename eines Modells; unbekannte IDs bleiben, wie sie sind. */
    fun name(id: String?): String? = id?.let { i -> (modelle + nurChat).firstOrNull { it.id == i }?.name ?: i }

    fun wahl(id: String?): ModellWahl? = id?.let { i -> (modelle + nurChat).firstOrNull { it.id == i } }

    val wirktText: String
        get() = when (wirkt) {
            "naechster-auftrag" -> "wirkt ab dem nächsten Auftrag"
            "neue-sitzung" -> "wirkt für neue Sitzungen"
            "sofort" -> "wirkt sofort"
            null, "" -> ""
            else -> "wirkt: $wirkt"
        }

    /** Steht alles auf dem Standard des Katalogs? */
    val aufStandard: Boolean
        get() = standard != null && modell == standard.modell && fallback == standard.fallback && aufwand == standard.aufwand
}

object ModellLeser {
    private fun wahlen(c: JsonObject, k: String): List<ModellWahl> = c.arr(k).orEmpty().mapNotNull { el ->
        when (el) {
            is JsonObject -> {
                val id = el.str("id")?.trim()?.ifBlank { null } ?: return@mapNotNull null
                ModellWahl(id, el.str("name")?.trim()?.ifBlank { null } ?: id, el.str("anbieter")?.trim()?.ifBlank { null })
            }
            is JsonPrimitive -> el.content.trim().ifBlank { null }?.let { ModellWahl(it, it) }
            else -> null
        }
    }

    private fun liste(c: JsonObject, k: String): List<String> =
        c.arr(k).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content?.trim()?.ifBlank { null } }

    private fun wahr(c: JsonObject, k: String): Boolean = c.str(k) == "true"

    fun lesen(stateKey: String, c: JsonObject): ModellStand? {
        val agent = stateKey.ifBlank { c.str("agent").orEmpty() }.trim().ifBlank { return null }
        val standard = c.obj("standard")?.let { s ->
            ModellGrund(s.str("modell")?.ifBlank { null }, liste(s, "fallback"), s.str("aufwand")?.ifBlank { null })
        }
        return ModellStand(
            agent = agent,
            art = c.str("art")?.ifBlank { null } ?: "keins",
            einstellbar = wahr(c, "einstellbar"),
            modell = c.str("modell")?.ifBlank { null },
            fallback = liste(c, "fallback"),
            aufwand = c.str("aufwand")?.ifBlank { null },
            standard = standard,
            modelle = wahlen(c, "modelle"),
            aufwaende = liste(c, "aufwaende"),
            fallbackAenderbar = wahr(c, "fallback_aenderbar"),
            fallbackMax = c.zahl("fallback_max")?.toInt()?.coerceIn(0, 10) ?: 3,
            wirkt = c.str("wirkt")?.ifBlank { null },
            hinweis = c.str("hinweis")?.ifBlank { null },
            nurChat = wahlen(c, "nur_chat"),
            geaendertVon = c.str("geaendert_von")?.ifBlank { null },
            geaendertAm = c.zahl("geaendert_am")?.toLong(),
            bestaetigung = c.str("bestaetigung")?.ifBlank { null },
            stimme = c.str("stimme")?.ifBlank { null },
            stimmeStandard = c.str("stimme_standard")?.ifBlank { null },
        )
    }

    fun stimmen(c: JsonObject): StimmenStand = StimmenStand(
        stimmen = c.arr("stimmen").orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val id = o.str("id")?.trim()?.ifBlank { null } ?: return@mapNotNull null
            Stimme(id, o.str("name")?.trim()?.ifBlank { null } ?: id, o.str("sprache")?.ifBlank { null }, o.str("engine")?.ifBlank { null })
        },
        hub = c.str("hub")?.ifBlank { null },
        hubStandard = c.str("hub_standard")?.ifBlank { null },
        standard = c.str("standard")?.ifBlank { null },
    )
}

object ModellBefehl {
    private val sicher = Regex("""^[A-Za-z0-9._:/\-]{1,64}$""")

    fun gueltig(id: String) = sicher.matches(id)

    /**
     * `!modell @<agent> <modell> [fallback <a>,<b>|keiner] [aufwand <stufe>|standard]`. Die Ersatzkette nur,
     * wenn sie sich ändern lässt; den Aufwand nur, wenn der Agent Stufen kennt.
     */
    fun setzen(stand: ModellStand, modell: String, fallback: List<String>, aufwand: String?): String = buildString {
        append("!modell @").append(stand.agent).append(' ').append(modell)
        if (stand.fallbackAenderbar) {
            append(" fallback ").append(if (fallback.isEmpty()) "keiner" else fallback.joinToString(","))
        }
        if (stand.aufwaende.isNotEmpty()) append(" aufwand ").append(aufwand ?: "standard")
    }

    fun standard(agent: String) = "!modell @$agent standard"

    /** `!stimme @<agent> <id>`, `!stimme @<agent> standard`; für den Hub `@hub`. */
    fun stimme(ziel: String, id: String?) = "!stimme @$ziel ${id ?: "standard"}"

    /** Für einen Chat in Allgemein: Hermes' eigener Befehl, nur für diese Sitzung. */
    fun chat(wahl: ModellWahl): String = buildString {
        append("/model ").append(wahl.id)
        wahl.anbieter?.let { append(" --provider ").append(it) }
        append(" --session")
    }
}
