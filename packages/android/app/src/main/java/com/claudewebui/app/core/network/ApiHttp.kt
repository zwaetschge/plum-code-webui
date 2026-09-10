package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.ApiResponse
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Non-2xx from the backend, reduced to a message a user can act on. The server
 * message wins when the body was the backend's JSON error envelope.
 */
class ApiHttpException(
    val status: Int,
    val path: String,
    val serverMessage: String? = null,
) : Exception(
    serverMessage ?: when (status) {
        502, 503, 504 -> "Server unavailable ($status) — it may be restarting. Try again shortly."
        401, 403 -> "Not authorized ($status) — sign in again."
        404 -> "Not found ($status): $path"
        429 -> "Rate limited (429) — wait a moment and retry."
        else -> "Server error ($status) on $path"
    }
)

/**
 * The HTTP plumbing every feature API shares: one Ktor [HttpClient] on the
 * OkHttp engine, the JSON configuration, base-URL resolution from [TokenStore],
 * bearer injection through [AuthInterceptorPlugin], and the typed request
 * helpers ([get], [post], [put], [patch], [delete]) that decode the response
 * body into whatever the caller's return type asks for.
 *
 * Feature APIs live in `core.network.api` and receive one of these; [ApiClient]
 * composes them back into a single facade so call sites stay unchanged.
 */
class ApiHttp {

    companion object {
        const val DEFAULT_BASE_URL = "http://localhost:3001"
    }

    val json: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }

    val client: HttpClient = HttpClient(OkHttp) {
        // A 5xx from a restarting backend (or Traefik in front of it) carries a
        // text/plain body; without expectSuccess Ktor would try to decode that
        // as JSON and surface a raw NoTransformationFoundException dialog.
        // Fail with a readable message instead, and ride out short blips by
        // retrying idempotent GETs.
        expectSuccess = true
        HttpResponseValidator {
            handleResponseExceptionWithRequest { exception, request ->
                val response = (exception as? ResponseException)?.response
                    ?: return@handleResponseExceptionWithRequest
                // Backend errors ship {success:false, error:{message}} — keep
                // that message when present; proxy errors are plain text and
                // fall back to a status-based one.
                val serverMessage = runCatching {
                    this@ApiHttp.json
                        .decodeFromString<ApiResponse<JsonElement>>(response.bodyAsText())
                        .error?.message
                }.getOrNull()
                throw ApiHttpException(
                    status = response.status.value,
                    path = request.url.encodedPath,
                    serverMessage = serverMessage,
                )
            }
        }
        install(HttpRequestRetry) {
            maxRetries = 2
            retryIf { req, response ->
                req.method == HttpMethod.Get && response.status.value in 500..599
            }
            exponentialDelay()
        }
        install(ContentNegotiation) {
            json(this@ApiHttp.json)
        }
        install(AuthInterceptorPlugin)
        install(Logging) {
            level = LogLevel.NONE // Set to LogLevel.BODY for debugging
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 30_000
        }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
    }

    /** Resolved on every call so a server-URL change applies without a restart. */
    val baseUrl: String
        get() = TokenStore.getServerUrl() ?: DEFAULT_BASE_URL

    fun url(path: String): String = "$baseUrl$path"

    /** Encode one Express route segment without turning spaces into '+'. */
    fun pathSegment(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    fun sha256Hex(bytes: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }

    // ------------------------------------------------------------------------
    // Typed request helpers. `T` is inferred from the caller's return type, the
    // same way `.body()` was inferred before the split. The backend's
    // `{success, data, error}` envelope is left intact: callers still receive
    // `ApiResponse<T>` and decide themselves how to treat `success = false`.
    // ------------------------------------------------------------------------

    suspend inline fun <reified T> get(
        path: String,
        block: HttpRequestBuilder.() -> Unit = {},
    ): T = client.get(url(path), block).body()

    suspend inline fun <reified T> post(
        path: String,
        block: HttpRequestBuilder.() -> Unit = {},
    ): T = client.post(url(path), block).body()

    suspend inline fun <reified T> put(
        path: String,
        block: HttpRequestBuilder.() -> Unit = {},
    ): T = client.put(url(path), block).body()

    suspend inline fun <reified T> patch(
        path: String,
        block: HttpRequestBuilder.() -> Unit = {},
    ): T = client.patch(url(path), block).body()

    suspend inline fun <reified T> delete(
        path: String,
        block: HttpRequestBuilder.() -> Unit = {},
    ): T = client.delete(url(path), block).body()

    /** Raw response for callers that want status or text rather than JSON. */
    suspend fun rawGet(path: String, block: HttpRequestBuilder.() -> Unit = {}): HttpResponse =
        client.get(url(path), block)

    fun close() {
        client.close()
    }
}
