package com.claudewebui.swarm

import com.claudewebui.swarm.data.Nachricht
import com.claudewebui.swarm.data.matrix.SchwarmJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/** Gemeinsame Bausteine der Tests: Konten wie live, nur mit einer Beispiel-Domain. */
const val HUB = "@schwarm:example.ch"
const val VALE = "@zwaetschge:example.ch"
const val BETRIEB = "@_sw_betrieb:example.ch"
const val CLAUDE = "@_sw_claude-code:example.ch"

const val MIN = 60_000L

/** Eine Nachricht im Verlauf; ohne Angabe eine Notice des Hubs auf oberster Ebene. */
fun nachricht(
    id: String,
    text: String,
    zeit: Long = 0L,
    raum: String = "!raum",
    von: String = HUB,
    name: String = if (von == HUB) "Hub" else von.removePrefix("@").substringBefore(':'),
    notice: Boolean = true,
    thread: String? = null,
    eigene: Map<String, Long> = emptyMap(),
) = Nachricht(
    eventId = id,
    raumId = raum,
    absender = von,
    absenderName = name,
    zeit = zeit,
    text = text,
    notice = notice,
    threadWurzel = thread,
    bearbeitet = false,
    reaktionen = eigene.mapValues { 1 },
    eigeneReaktionen = eigene.keys,
    auftragId = null,
    vonMir = von == VALE,
    vomHub = von == HUB,
    eigeneZeiten = eigene,
)

fun json(text: String): JsonObject = SchwarmJson.parseToJsonElement(text).jsonObject
