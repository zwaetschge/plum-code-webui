package com.claudewebui.swarm.data

import kotlinx.serialization.Serializable

/**
 * Einstellungen im Konto statt nur auf dem Gerät (App 2.9, Verbesserung 7): Vorlagen mit Favoriten, Vorlesen,
 * PDF-Seiten, Screenshot-Sperre und die von Hand abgehakten Schritte der Einrichtung. Nach einer Neuinstallation
 * oder auf einem zweiten Gerät ist alles wieder da. Es gewinnt der neuere Stand (`zeit`); was ein Gerät nicht
 * kennt, lässt es stehen. Nicht hierher gehören Schlüssel, Push-Adresse und App-Sperre: die sind je Gerät.
 */
const val KONTO_EINSTELLUNGEN = "ch.zwaetschge.schwarm.einstellungen"

@Serializable
data class KontoEinstellungen(
    val v: Int = 1,
    val zeit: Long = 0,
    /** Das Gerät, das zuletzt geschrieben hat (Matrix-Gerät), nur zur Anzeige. */
    val geraet: String? = null,
    val vorlagen: List<Vorlage>? = null,
    val antwortenVorlesen: Boolean? = null,
    val pdfSeiten: Boolean? = null,
    val screenshotsSperren: Boolean? = null,
    val einrichtungErledigt: List<String>? = null,
)
