package com.claudewebui.swarm.data.matrix

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.contentLength
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import java.net.URLEncoder
import java.util.UUID
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/** Fehler der Client-Server-API, mit `errcode` für die Behandlung (M_UNKNOWN_TOKEN, M_LIMIT_EXCEEDED …). */
class MatrixFehler(val status: Int, val errcode: String?, text: String, val retryAfterMs: Long? = null) :
    Exception(text)

/**
 * Ein schlanker Client für genau die Teile der Matrix Client-Server-API, die der Schwarm
 * braucht. Kein SDK: Die Schwarm-Räume sind unverschlüsselt, und so bleibt die App klein.
 */
class MatrixClient(baseUrl: String, private val token: String? = null) {
    val basis = baseUrl.trimEnd('/')
    private val mxcForm = Regex("""^mxc://([A-Za-z0-9.\-]+(?::\d{1,5})?)/([A-Za-z0-9_\-]+)$""")

    private val http = HttpClient(OkHttp) {
        expectSuccess = false
        install(ContentNegotiation) { json(SchwarmJson) }
        install(HttpTimeout) {
            connectTimeoutMillis = 15_000
            requestTimeoutMillis = 75_000
            socketTimeoutMillis = 75_000
        }
    }

    fun schliessen() = http.close()

    private fun teil(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private suspend fun pruefe(antwort: HttpResponse): HttpResponse {
        if (antwort.status.isSuccess()) return antwort
        val text = antwort.bodyAsText()
        val f = runCatching { SchwarmJson.decodeFromString(Fehler.serializer(), text) }.getOrNull()
        throw MatrixFehler(
            antwort.status.value,
            f?.errcode,
            f?.error ?: "HTTP ${antwort.status.value}",
            f?.retryAfterMs,
        )
    }

    private fun io.ktor.client.request.HttpRequestBuilder.anmelden() {
        token?.let { bearerAuth(it) }
    }

    suspend fun wellKnown(domain: String): String? = runCatching {
        val a = http.get("https://$domain/.well-known/matrix/client")
        if (!a.status.isSuccess()) null
        else SchwarmJson.decodeFromString(WellKnown.serializer(), a.bodyAsText()).homeserver?.baseUrl
    }.getOrNull()

    suspend fun versionen(): Boolean = runCatching {
        http.get("$basis/_matrix/client/versions").status.isSuccess()
    }.getOrDefault(false)

    suspend fun login(benutzer: String, passwort: String, geraet: String): LoginAntwort {
        val a = http.post("$basis/_matrix/client/v3/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginAnfrage(identifier = Kennung(user = benutzer), password = passwort, geraetename = geraet))
        }
        return pruefe(a).body()
    }

    suspend fun abmelden() {
        pruefe(http.post("$basis/_matrix/client/v3/logout") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        })
    }

    suspend fun aliasAufloesen(alias: String): String? {
        val a = http.get("$basis/_matrix/client/v3/directory/room/${teil(alias)}") { anmelden() }
        if (a.status.value == 404) return null
        return pruefe(a).body<AliasAntwort>().roomId
    }

    suspend fun beitreten(raumOderAlias: String): String {
        val a = http.post("$basis/_matrix/client/v3/join/${teil(raumOderAlias)}") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
        return pruefe(a).body<RaumIdAntwort>().roomId
    }

    suspend fun sync(filter: String, since: String?, timeoutMs: Long): SyncAntwort {
        val a = http.get("$basis/_matrix/client/v3/sync") {
            anmelden()
            parameter("filter", filter)
            parameter("timeout", timeoutMs)
            if (since != null) parameter("since", since)
        }
        return pruefe(a).body()
    }

    suspend fun senden(raum: String, typ: String, inhalt: JsonObject): String {
        val txn = UUID.randomUUID().toString()
        val a = http.put("$basis/_matrix/client/v3/rooms/${teil(raum)}/send/${teil(typ)}/$txn") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(inhalt)
        }
        return pruefe(a).body<EventIdAntwort>().eventId
    }

    suspend fun reagieren(raum: String, ziel: String, schluessel: String): String =
        senden(raum, "m.reaction", buildJsonObject {
            put("m.relates_to", buildJsonObject {
                put("rel_type", kotlinx.serialization.json.JsonPrimitive("m.annotation"))
                put("event_id", kotlinx.serialization.json.JsonPrimitive(ziel))
                put("key", kotlinx.serialization.json.JsonPrimitive(schluessel))
            })
        })

    /** Eigenes Event zurücknehmen (Redaction), etwa eine alte Reaktion. */
    suspend fun zuruecknehmen(raum: String, eventId: String): String {
        val txn = UUID.randomUUID().toString()
        val a = http.put("$basis/_matrix/client/v3/rooms/${teil(raum)}/redact/${teil(eventId)}/$txn") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
        return pruefe(a).body<EventIdAntwort>().eventId
    }

    suspend fun nachrichten(raum: String, von: String?, richtung: String = "b", anzahl: Int = 50): Nachrichtenseite {
        val a = http.get("$basis/_matrix/client/v3/rooms/${teil(raum)}/messages") {
            anmelden()
            parameter("dir", richtung)
            parameter("limit", anzahl)
            if (von != null) parameter("from", von)
        }
        return pruefe(a).body()
    }

    suspend fun ereignis(raum: String, eventId: String): Ereignis {
        val a = http.get("$basis/_matrix/client/v3/rooms/${teil(raum)}/event/${teil(eventId)}") { anmelden() }
        return pruefe(a).body()
    }

    suspend fun threadAntworten(raum: String, wurzel: String, von: String? = null): Beziehungsseite {
        val a = http.get("$basis/_matrix/client/v1/rooms/${teil(raum)}/relations/${teil(wurzel)}/m.thread") {
            anmelden()
            parameter("limit", 100)
            parameter("dir", "b")
            if (von != null) parameter("from", von)
        }
        return pruefe(a).body()
    }

    /**
     * Eine Datei über authentifizierte Medien holen (Matrix 1.11): `GET /_matrix/client/v1/media/download`
     * mit dem Token. Nur `mxc://server/id`; grösser als `maxBytes` bricht ab, bevor der Speicher leidet.
     */
    suspend fun medienLaden(mxc: String, maxBytes: Long): ByteArray {
        val m = mxcForm.matchEntire(mxc.trim()) ?: throw IllegalArgumentException("Keine mxc-Adresse")
        val (server, id) = m.destructured
        val a = pruefe(http.get("$basis/_matrix/client/v1/media/download/${teil(server)}/${teil(id)}") { anmelden() })
        val laenge = a.contentLength()
        if (laenge != null && laenge > maxBytes) throw IllegalStateException("Die Datei ist zu gross (${laenge / 1024} KB).")
        val daten = a.bodyAsBytes()
        if (daten.size > maxBytes) throw IllegalStateException("Die Datei ist zu gross (${daten.size / 1024} KB).")
        return daten
    }

    /**
     * Ein Vorschaubild über authentifizierte Medien (`/_matrix/client/v1/media/thumbnail`), skaliert auf
     * höchstens `breite` × `hoehe`. Grösser als `maxBytes` bricht ab.
     */
    suspend fun vorschaubild(mxc: String, breite: Int, hoehe: Int, maxBytes: Long): ByteArray {
        val m = mxcForm.matchEntire(mxc.trim()) ?: throw IllegalArgumentException("Keine mxc-Adresse")
        val (server, id) = m.destructured
        val a = pruefe(http.get("$basis/_matrix/client/v1/media/thumbnail/${teil(server)}/${teil(id)}") {
            anmelden()
            parameter("width", breite)
            parameter("height", hoehe)
            parameter("method", "scale")
        })
        val laenge = a.contentLength()
        if (laenge != null && laenge > maxBytes) throw IllegalStateException("Das Bild ist zu gross.")
        return a.bodyAsBytes().also { if (it.size > maxBytes) throw IllegalStateException("Das Bild ist zu gross.") }
    }

    /**
     * Die Upload-Grenze des Servers (`m.upload.size`), über die authentifizierten Medien; ältere Server
     * kennen nur `/_matrix/media/v3/config`. `null`, wenn der Server keine nennt.
     */
    suspend fun medienKonfig(): Long? {
        for (pfad in listOf("/_matrix/client/v1/media/config", "/_matrix/media/v3/config")) {
            val a = http.get("$basis$pfad") { anmelden() }
            if (a.status.value == 404) continue
            val o = pruefe(a).body<JsonObject>()
            return (o["m.upload.size"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
        }
        return null
    }

    /** Eine Datei hochladen (`POST /_matrix/media/v3/upload`); liefert die `mxc://`-Adresse. */
    suspend fun hochladen(daten: ByteArray, mime: String, dateiname: String): String {
        val a = http.post("$basis/_matrix/media/v3/upload") {
            anmelden()
            parameter("filename", dateiname)
            setBody(ByteArrayContent(daten, ContentType.parse(mime)))
        }
        return pruefe(a).body<MedienAntwort>().contentUri
    }

    /** Einen Raum anlegen; liefert die Raum-ID. */
    suspend fun raumAnlegen(inhalt: JsonObject): String {
        val a = http.post("$basis/_matrix/client/v3/createRoom") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(inhalt)
        }
        return pruefe(a).body<RaumIdAntwort>().roomId
    }

    /** Account-Daten des Kontos lesen; `null`, wenn es sie nicht gibt (404). */
    suspend fun kontoDaten(benutzer: String, typ: String): JsonObject? {
        val a = http.get("$basis/_matrix/client/v3/user/${teil(benutzer)}/account_data/${teil(typ)}") { anmelden() }
        if (a.status.value == 404) return null
        return pruefe(a).body()
    }

    /**
     * Ein HTTP-Pusher für UnifiedPush (App 2.5): Synapse meldet Benachrichtigungen (etwa Brians Antworten in Allgemein)
     * an das Matrix-Gateway des Verteilers, der die App weckt. `pushkey` ist die UnifiedPush-Adresse; mit
     * `loeschen` fällt der Pusher weg.
     */
    suspend fun pusherSetzen(pushkey: String, gateway: String, geraet: String, loeschen: Boolean = false) {
        pruefe(http.post("$basis/_matrix/client/v3/pushers/set") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("pushkey", JsonPrimitive(pushkey))
                put("app_id", JsonPrimitive("ch.zwaetschge.schwarm.up"))
                if (loeschen) {
                    put("kind", JsonNull)
                } else {
                    put("kind", JsonPrimitive("http"))
                    put("app_display_name", JsonPrimitive("Schwarm"))
                    put("device_display_name", JsonPrimitive(geraet))
                    put("lang", JsonPrimitive("de"))
                    put("data", buildJsonObject {
                        put("url", JsonPrimitive(gateway))
                        put("format", JsonPrimitive("event_id_only"))
                    })
                }
            })
        })
    }

    /** Die Volltextsuche von Synapse, nur in einem Raum, neueste zuerst (App 2.7). */
    suspend fun suchen(raum: String, begriff: String, grenze: Int = 30): List<Ereignis> {
        val antwort = pruefe(http.post("$basis/_matrix/client/v3/search") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("search_categories", buildJsonObject {
                    put("room_events", buildJsonObject {
                        put("search_term", JsonPrimitive(begriff))
                        put("order_by", JsonPrimitive("recent"))
                        put("filter", buildJsonObject {
                            put("rooms", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(raum))))
                            put("limit", JsonPrimitive(grenze))
                        })
                    })
                })
            })
        })
        val o = SchwarmJson.parseToJsonElement(antwort.bodyAsText()) as? JsonObject ?: return emptyList()
        val ergebnisse = (o["search_categories"] as? JsonObject)?.get("room_events")?.let { it as? JsonObject }?.get("results")
            as? kotlinx.serialization.json.JsonArray ?: return emptyList()
        return ergebnisse.mapNotNull { r ->
            val ereignis = (r as? JsonObject)?.get("result") as? JsonObject ?: return@mapNotNull null
            runCatching { SchwarmJson.decodeFromJsonElement(Ereignis.serializer(), ereignis) }.getOrNull()
        }
    }

    suspend fun kontoDatenSetzen(benutzer: String, typ: String, inhalt: JsonObject) {
        pruefe(http.put("$basis/_matrix/client/v3/user/${teil(benutzer)}/account_data/${teil(typ)}") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(inhalt)
        })
    }

    /**
     * Lesebestätigung `m.read` für ein Event; mit `thread` als Thread-Bestätigung (Matrix 1.4), sonst für den
     * ganzen Raum bis zu diesem Event.
     */
    suspend fun lesebestaetigung(raum: String, eventId: String, thread: String? = null) {
        pruefe(http.post("$basis/_matrix/client/v3/rooms/${teil(raum)}/receipt/m.read/${teil(eventId)}") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { if (thread != null) put("thread_id", kotlinx.serialization.json.JsonPrimitive(thread)) })
        })
    }

    /** Lesezeichen `m.fully_read` (und `m.read`) setzen, damit auch Element denselben Stand zeigt. */
    suspend fun lesemarke(raum: String, eventId: String) {
        pruefe(http.post("$basis/_matrix/client/v3/rooms/${teil(raum)}/read_markers") {
            anmelden()
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("m.fully_read", kotlinx.serialization.json.JsonPrimitive(eventId))
                put("m.read", kotlinx.serialization.json.JsonPrimitive(eventId))
            })
        })
    }

    suspend fun reaktionen(raum: String, ziel: String): Beziehungsseite {
        val a = http.get("$basis/_matrix/client/v1/rooms/${teil(raum)}/relations/${teil(ziel)}/m.annotation") {
            anmelden()
            parameter("limit", 100)
        }
        return pruefe(a).body()
    }
}
