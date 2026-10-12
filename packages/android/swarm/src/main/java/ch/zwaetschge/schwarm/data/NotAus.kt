package com.claudewebui.swarm.data

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.net.URI
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * Not-Aus ohne Matrix (Punkt 18, SCHNITTSTELLEN-app.md): ein EC-Schlüssel P-256 im Android-Keystore,
 * der nur signieren kann und das Gerät nie verlässt. Angemeldet wird er einmal mit
 * `!geraet neu <name> <spki>`; danach signiert die App jeden Not-Aus selbst und schickt ihn direkt an
 * den Hub, auch wenn Synapse nicht antwortet.
 */
object NotAusSchluessel {
    const val ALIAS = "plum-swarm-notaus"

    /** So lange gilt eine Bestätigung mit Biometrie oder PIN für den Schlüssel. */
    private const val GUELTIG_S = 30

    private fun keystore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun vorhanden(): Boolean = runCatching { keystore().containsAlias(ALIAS) }.getOrDefault(false)

    /**
     * Erzeugt den Schlüssel, nach Möglichkeit mit Benutzer-Authentifizierung (Biometrie oder PIN).
     * Ohne Displaysperre lässt Android das nicht zu; dann entsteht er ohne, und die App fragt nur nach.
     * Liefert, ob der Schlüssel die Authentifizierung verlangt.
     */
    fun erzeugen(context: Context): Boolean {
        if (vorhanden()) return mitBiometrie()
        val gesperrt = context.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true
        if (gesperrt && runCatching { erzeugen(true) }.isSuccess) return true
        runCatching { keystore().deleteEntry(ALIAS) }
        erzeugen(false)
        return false
    }

    private fun erzeugen(mitAuth: Boolean) {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .apply {
                if (mitAuth) {
                    setUserAuthenticationRequired(true)
                    if (Build.VERSION.SDK_INT >= 30) {
                        setUserAuthenticationParameters(
                            GUELTIG_S,
                            KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        setUserAuthenticationValidityDurationSeconds(GUELTIG_S)
                    }
                }
            }
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(spec)
            generateKeyPair()
        }
    }

    fun loeschen() {
        runCatching { keystore().deleteEntry(ALIAS) }
    }

    /** Der öffentliche Schlüssel als SubjectPublicKeyInfo (DER). */
    fun spki(): ByteArray? = runCatching { keystore().getCertificate(ALIAS)?.publicKey?.encoded }.getOrNull()

    /** Die Geräte-ID wie im Hub: die ersten 16 Hex-Zeichen von sha256(spki-DER). */
    fun geraetId(): String? = spki()?.let { geraetIdVon(it) }

    fun geraetIdVon(spki: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(spki)).take(16)

    /** Verlangt der Schlüssel eine Bestätigung mit Biometrie oder PIN? */
    fun mitBiometrie(): Boolean = runCatching {
        val schluessel = keystore().getKey(ALIAS, null) as PrivateKey
        val info = KeyFactory.getInstance(schluessel.algorithm, "AndroidKeyStore").getKeySpec(schluessel, KeyInfo::class.java)
        info.isUserAuthenticationRequired
    }.getOrDefault(false)

    /** SHA256withECDSA, die Signatur in DER. Wirft, wenn die Bestätigung fehlt oder abgelaufen ist. */
    fun signieren(text: String): ByteArray {
        val schluessel = keystore().getKey(ALIAS, null) as? PrivateKey
            ?: throw IllegalStateException("Kein Not-Aus-Schlüssel auf diesem Gerät.")
        return Signature.getInstance("SHA256withECDSA").run {
            initSign(schluessel)
            update(text.toByteArray(Charsets.UTF_8))
            sign()
        }
    }
}

internal fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

/** base64url ohne Padding, wie der Hub es erwartet. */
internal fun base64url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)

/** Was die App vom Not-Aus-Weg weiss, ohne Geheimnis: Adresse, Gerätename, letzte Antwort. */
class NotAusSpeicher(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("plum_swarm_notaus", Context.MODE_PRIVATE)

    var domain: String?
        get() = prefs.getString("domain", null)
        set(v) = prefs.edit().putString("domain", v).apply()

    /** Die Adresse aus dem Event `ch.zwaetschge.swarm.notaus`, damit sie auch ohne Matrix bekannt ist. */
    var url: String?
        get() = prefs.getString("url", null)
        set(v) = prefs.edit().putString("url", v).apply()

    var name: String?
        get() = prefs.getString("name", null)
        set(v) = prefs.edit().putString("name", v).apply()

    /** Stand die Geräte-ID zuletzt im Event des Hubs? */
    var angemeldet: Boolean
        get() = prefs.getBoolean("angemeldet", false)
        set(v) = prefs.edit().putBoolean("angemeldet", v).apply()

    fun vergessen() {
        prefs.edit().remove("name").remove("angemeldet").apply()
    }
}

/** Die Antwort des Hubs auf einen Not-Aus, oder was schiefging. */
data class NotAusAntwort(
    val aktion: String,
    val status: Int,
    val ok: Boolean,
    val eingefroren: Boolean? = null,
    val offen: Int? = null,
    val laufend: Int? = null,
    val fehler: String? = null,
    /** Der Hub war nicht zu erreichen (Relay 502 oder kein Netz): Die App zeigt den letzten Stand. */
    val hubWeg: Boolean = false,
    val zeit: Long = System.currentTimeMillis(),
)

object NotAusDraht {
    private val zufall = SecureRandom()

    /** Der signierte Text: `schwarm-notaus|v1|<aktion>|<geraet>|<zeit>|<nonce>`. */
    fun text(aktion: String, geraet: String, zeit: Long, nonce: String): String =
        "schwarm-notaus|v1|$aktion|$geraet|$zeit|$nonce"

    /** 16 Zufallsbytes als 32 Hex-Zeichen; der Hub nimmt jede Nonce nur einmal an. */
    fun nonce(): String = ByteArray(16).also(zufall::nextBytes).let(::hex)

    /**
     * Die Adresse muss HTTPS sein und zur Domain des Kontos gehören, sonst ginge eine Signatur an
     * einen fremden Server. `null`, wenn sie nicht passt.
     */
    fun urlPruefen(url: String?, domain: String): String? = runCatching {
        val u = URI(url ?: return null)
        val host = u.host?.lowercase() ?: return null
        val d = domain.lowercase().substringBefore(':')
        if (u.scheme != "https" || u.userInfo != null) return null
        if (host != d && !host.endsWith(".$d")) return null
        u.toString()
    }.getOrNull()

    /** Der Körper des POST: Gerät, Zeit, Nonce, Aktion, bei `push` die Adresse, und die Signatur über den Text. */
    fun koerper(aktion: String, geraet: String, zeit: Long, nonce: String, signatur: ByteArray, endpoint: String? = null): String =
        buildJsonObject {
            put("geraet", JsonPrimitive(geraet))
            put("zeit", JsonPrimitive(zeit))
            put("nonce", JsonPrimitive(nonce))
            put("aktion", JsonPrimitive(aktion))
            if (endpoint != null) put("endpoint", JsonPrimitive(endpoint))
            put("signatur", JsonPrimitive(base64url(signatur)))
        }.toString()

    /**
     * Signieren und senden. `stopp` friert ein wie `!stop` und bricht alle offenen Aufträge ab (die
     * Worker bekommen `cancel`), `stand` liest nur, `weiter` taut auf wie `!weiter`. Wirft nur, wenn
     * schon das Signieren scheitert (etwa ohne Bestätigung).
     */
    suspend fun ausloesen(url: String, aktion: String, endpoint: String? = null): NotAusAntwort {
        val geraet = NotAusSchluessel.geraetId() ?: throw IllegalStateException("Kein Not-Aus-Schlüssel auf diesem Gerät.")
        val zeit = System.currentTimeMillis()
        val nonce = nonce()
        // Bei `push` ist die Adresse mitsigniert (Sofort-Benachrichtigungen, App 2.5).
        val signatur = NotAusSchluessel.signieren(text(aktion, geraet, zeit, nonce) + if (aktion == "push") "|$endpoint" else "")
        require(aktion in setOf("stopp", "stand", "weiter", "push"))
        val http = HttpClient(OkHttp) {
            expectSuccess = false
            followRedirects = false
            install(HttpTimeout) {
                connectTimeoutMillis = 10_000
                requestTimeoutMillis = 20_000
                socketTimeoutMillis = 20_000
            }
        }
        return try {
            val a = http.post(url) { setBody(TextContent(koerper(aktion, geraet, zeit, nonce, signatur, endpoint), ContentType.Application.Json)) }
            antwortLesen(aktion, a.status.value, runCatching { a.bodyAsText() }.getOrDefault(""))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            NotAusAntwort(
                aktion, 0, false,
                fehler = "Hub nicht erreichbar: ${e.message ?: e.javaClass.simpleName}. Ohne Hub läuft ohnehin nichts Neues an.",
                hubWeg = true,
            )
        } finally {
            http.close()
        }
    }

    /** `{ ok, aktion, stand: { eingefroren, offen, laufend } }`; bei Fehlern der Grund aus dem Status. */
    fun antwortLesen(aktion: String, status: Int, text: String): NotAusAntwort {
        val o = runCatching { SchwarmJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: JsonObject(emptyMap())
        val stand = o.notAusObj("stand")
        val ok = status in 200..299 && (o.notAusWahr("ok") ?: true)
        val grund = when (status) {
            in 200..299 -> null
            400 -> "Die Anfrage war ungültig (400)."
            401 -> "Gerät unbekannt oder Signatur falsch (401). Ist dieses Gerät beim Hub angemeldet?"
            409 -> "Diese Nonce kennt der Hub schon (409). Bitte noch einmal auslösen."
            425 -> "Die Uhr des Geräts weicht mehr als 60 s ab (425). Prüfe Datum und Uhrzeit."
            429 -> "Zu viele Versuche (429). Warte kurz und versuche es dann noch einmal."
            502 -> "Hub nicht erreichbar (502). Ohne Hub läuft ohnehin nichts Neues an."
            else -> "Der Hub antwortet mit HTTP $status."
        }
        return NotAusAntwort(
            aktion = o.notAusStr("aktion")?.takeIf { it in setOf("stopp", "stand", "weiter") } ?: aktion,
            status = status,
            ok = ok,
            eingefroren = stand?.notAusWahr("eingefroren"),
            offen = stand?.notAusZahl("offen")?.toInt(),
            laufend = stand?.notAusZahl("laufend")?.toInt(),
            fehler = grund ?: o.notAusStr("fehler") ?: o.notAusStr("error"),
            hubWeg = status == 502,
        )
    }
}

private val SchwarmJson = Json { ignoreUnknownKeys = true }
private fun JsonObject.notAusObj(key: String): JsonObject? = this[key] as? JsonObject
private fun JsonObject.notAusStr(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.notAusWahr(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
private fun JsonObject.notAusZahl(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
