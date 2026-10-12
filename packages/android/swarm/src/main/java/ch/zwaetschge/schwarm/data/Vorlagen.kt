package com.claudewebui.swarm.data

import android.content.Context
import com.claudewebui.swarm.data.matrix.SchwarmJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.math.BigDecimal
import java.util.UUID

/** Höchstens so viele Favoriten zeigen Übersicht und Widget (SCHNITTSTELLEN-app.md, Punkt 19). */
const val FAVORITEN_MAX = 6

/**
 * Eine Vorlage für einen Auftrag, nur auf diesem Gerät: Agent, Ziel mit Platzhaltern wie
 * `{container}`, dazu Budget und Frist als Hinweis für den Agenten.
 */
@Serializable
data class Vorlage(
    val id: String = UUID.randomUUID().toString(),
    val titel: String,
    val agent: String,
    val ziel: String,
    val budgetUsd: Double? = null,
    val budgetMin: Int? = null,
    val frist: String? = null,
    val favorit: Boolean = false,
) {
    val platzhalter: List<String> get() = VorlagenText.platzhalter(ziel)
}

object VorlagenText {
    private val platzhalterForm = Regex("""\{([^{}\n]{1,40})\}""")

    /** Die Namen der Platzhalter in der Reihenfolge ihres ersten Auftretens. */
    fun platzhalter(ziel: String): List<String> =
        platzhalterForm.findAll(ziel).map { it.groupValues[1].trim() }.filter { it.isNotEmpty() }.distinct().toList()

    fun einsetzen(ziel: String, werte: Map<String, String>): String =
        platzhalterForm.replace(ziel) { m -> werte[m.groupValues[1].trim()]?.trim()?.ifEmpty { null } ?: m.value }

    /** 0.5 → „0.5“, 1.0 → „1“: so, wie man es tippen würde. */
    fun zahl(d: Double): String = runCatching { BigDecimal.valueOf(d).stripTrailingZeros().toPlainString() }.getOrDefault(d.toString())

    /** „Budget: 0.5 USD / 20 min · Frist: 2h“, oder `null` ohne Budget und Frist. */
    fun zusatz(v: Vorlage): String? {
        val budget = listOfNotNull(v.budgetUsd?.let { "${zahl(it)} USD" }, v.budgetMin?.let { "$it min" })
            .takeIf { it.isNotEmpty() }?.joinToString(" / ", prefix = "Budget: ")
        val frist = v.frist?.trim()?.ifBlank { null }?.let { "Frist: $it" }
        return listOfNotNull(budget, frist).takeIf { it.isNotEmpty() }?.joinToString(" · ")
    }

    /**
     * Der fertige Befehl: `!auftrag @agent <ziel>`, mit Budget oder Frist als letzte Zeile im Ziel.
     * Der Hub liest die Zeile heute nicht, sie ist ein Hinweis für den Agenten.
     */
    fun befehl(v: Vorlage, werte: Map<String, String>): String {
        val ziel = einsetzen(v.ziel, werte).trim().replace(Regex("""\s+"""), " ")
        return "!auftrag @${v.agent} $ziel" + (zusatz(v)?.let { "\n$it" } ?: "")
    }
}

/** Vorlagen als JSON in den App-Einstellungen. Kein Geheimnis darin, darum ohne Verschlüsselung. */
class VorlagenSpeicher(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("schwarm_vorlagen", Context.MODE_PRIVATE)
    private val liste = ListSerializer(Vorlage.serializer())

    fun alle(): List<Vorlage> = runCatching {
        prefs.getString("vorlagen", null)?.let { SchwarmJson.decodeFromString(liste, it) }
    }.getOrNull().orEmpty()

    fun speichern(vorlagen: List<Vorlage>) {
        prefs.edit().putString("vorlagen", SchwarmJson.encodeToString(liste, vorlagen)).apply()
    }

    fun favoriten(): List<Vorlage> = alle().filter { it.favorit }.take(FAVORITEN_MAX)
}
