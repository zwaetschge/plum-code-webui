package com.claudewebui.swarm.data.matrix

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Ein JSON für alles: Matrix schickt mehr Felder, als die App braucht. */
val SchwarmJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    isLenient = true
    encodeDefaults = true
}

@Serializable
data class Kennung(val type: String = "m.id.user", val user: String)

@Serializable
data class LoginAnfrage(
    val type: String = "m.login.password",
    val identifier: Kennung,
    val password: String,
    @SerialName("initial_device_display_name") val geraetename: String,
)

@Serializable
data class LoginAntwort(
    @SerialName("user_id") val userId: String,
    @SerialName("access_token") val accessToken: String,
    @SerialName("device_id") val deviceId: String,
)

@Serializable
data class Fehler(
    val errcode: String? = null,
    val error: String? = null,
    @SerialName("retry_after_ms") val retryAfterMs: Long? = null,
)

@Serializable
data class WellKnown(@SerialName("m.homeserver") val homeserver: BasisUrl? = null)

@Serializable
data class BasisUrl(@SerialName("base_url") val baseUrl: String)

@Serializable
data class AliasAntwort(@SerialName("room_id") val roomId: String)

@Serializable
data class EventIdAntwort(@SerialName("event_id") val eventId: String)

@Serializable
data class RaumIdAntwort(@SerialName("room_id") val roomId: String)

/** Ein Matrix-Event. Stripped State aus Einladungen hat weder ID noch Zeit. */
@Serializable
data class Ereignis(
    val type: String,
    @SerialName("event_id") val eventId: String? = null,
    val sender: String = "",
    @SerialName("origin_server_ts") val ts: Long = 0,
    val content: JsonObject = JsonObject(emptyMap()),
    @SerialName("state_key") val stateKey: String? = null,
    val redacts: String? = null,
)

@Serializable
data class SyncAntwort(
    @SerialName("next_batch") val nextBatch: String,
    val rooms: RaeumeSync? = null,
    /** Account-Daten des Kontos, hier `m.direct` und `ch.zwaetschge.schwarm.allgemein`. */
    @SerialName("account_data") val kontoDaten: Ereignisliste? = null,
)

@Serializable
data class Ereignisliste(val events: List<Ereignis> = emptyList())

/** Die Zusammenfassung eines Raums (mit `lazy_load_members`): wie viele beigetreten und eingeladen sind. */
@Serializable
data class Zusammenfassung(
    @SerialName("m.joined_member_count") val beigetreten: Int? = null,
    @SerialName("m.invited_member_count") val eingeladen: Int? = null,
    @SerialName("m.heroes") val helden: List<String>? = null,
)

@Serializable
data class MedienAntwort(@SerialName("content_uri") val contentUri: String)

@Serializable
data class RaeumeSync(
    val join: Map<String, BeigetretenerRaum> = emptyMap(),
    val invite: Map<String, EingeladenerRaum> = emptyMap(),
    val leave: Map<String, VerlassenerRaum> = emptyMap(),
)

@Serializable
data class BeigetretenerRaum(
    val timeline: Zeitleiste? = null,
    val state: Zustandsblock? = null,
    /** `m.receipt` und `m.typing`. */
    val ephemeral: Ereignisliste? = null,
    /** Raum-Account-Daten, hier `m.fully_read`. */
    @SerialName("account_data") val kontoDaten: Ereignisliste? = null,
    val summary: Zusammenfassung? = null,
)

@Serializable
data class VerlassenerRaum(val timeline: Zeitleiste? = null)

@Serializable
data class Zeitleiste(
    val events: List<Ereignis> = emptyList(),
    val limited: Boolean = false,
    @SerialName("prev_batch") val prevBatch: String? = null,
)

@Serializable
data class Zustandsblock(val events: List<Ereignis> = emptyList())

@Serializable
data class EingeladenerRaum(@SerialName("invite_state") val inviteState: Zustandsblock? = null)

@Serializable
data class Nachrichtenseite(
    val chunk: List<Ereignis> = emptyList(),
    val start: String? = null,
    val end: String? = null,
    val state: List<Ereignis> = emptyList(),
)

@Serializable
data class Beziehungsseite(
    val chunk: List<Ereignis> = emptyList(),
    @SerialName("next_batch") val nextBatch: String? = null,
)
