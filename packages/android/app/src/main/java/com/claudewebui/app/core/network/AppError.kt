package com.claudewebui.app.core.network

import android.content.Context
import com.claudewebui.app.R
import io.ktor.client.call.NoTransformationFoundException
import io.ktor.client.network.sockets.ConnectTimeoutException
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.ResponseException
import io.ktor.serialization.ContentConvertException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Every failure a network call can produce, reduced to the handful of cases
 * the UI actually treats differently.
 *
 * ViewModels used to hand raw `Throwable.message` strings to the screen, so a
 * DNS failure, an expired token and a JSON mismatch all rendered as the same
 * red card with the same useless "Retry". Mapping once, here, lets a screen
 * decide from the type: retry on [Network], sign in again on [Unauthorized],
 * and stop offering retry for a [Contract] mismatch that will never succeed.
 */
sealed class AppError(open val cause: Throwable?) {

    /** No connectivity, DNS failure, or a timeout before the server answered. */
    data class Network(override val cause: Throwable?) : AppError(cause)

    /** 401 — the session is gone; a new sign-in is required. */
    data class Unauthorized(override val cause: Throwable?) : AppError(cause)

    /** 404 — the thing was deleted, or the server predates the route. */
    data class NotFound(override val cause: Throwable?) : AppError(cause)

    /** Any other non-2xx; [serverMessage] is the backend envelope's message when it sent one. */
    data class Server(
        val status: Int,
        val serverMessage: String?,
        override val cause: Throwable?,
    ) : AppError(cause)

    /** The response arrived but did not match the model — an app/server version mismatch. */
    data class Contract(override val cause: Throwable?) : AppError(cause)

    /** The coroutine was cancelled; never something to show the user. */
    data class Cancelled(override val cause: Throwable?) : AppError(cause)

    data class Unknown(override val cause: Throwable?) : AppError(cause)

    /** True when trying again without changing anything might reasonably succeed. */
    val isRetryable: Boolean
        get() = this is Network || (this is Server && (status == 429 || status >= 500))

    /** Resolve visible copy through the active Android locale. */
    fun userMessage(context: Context): String = when (this) {
        is Network -> context.getString(R.string.error_network)
        is Unauthorized -> context.getString(R.string.error_unauthorized)
        is NotFound -> context.getString(R.string.error_not_found)
        is Server -> when {
            !serverMessage.isNullOrBlank() -> context.getString(R.string.error_server_detail, serverMessage, status)
            status in 502..504 -> context.getString(R.string.error_server_unavailable, status)
            status == 429 -> context.getString(R.string.error_rate_limited)
            status == 403 -> context.getString(R.string.error_forbidden)
            status >= 500 -> context.getString(R.string.error_server, status)
            else -> context.getString(R.string.error_rejected, status)
        }
        is Contract -> context.getString(R.string.error_contract)
        is Cancelled -> context.getString(R.string.error_cancelled)
        is Unknown -> context.getString(R.string.error_unknown)
    }

    /** One short English sentence a user can act on. */
    fun userMessage(): String = when (this) {
        is Network -> "Can't reach the server. Check your connection and try again."
        is Unauthorized -> "Your session has expired. Sign in again."
        is NotFound -> "That item no longer exists on the server."
        is Server -> {
            val detail = serverMessage?.takeIf { it.isNotBlank() }
            when {
                detail != null -> "$detail ($status)"
                status in 502..504 -> "The server is unavailable ($status). It may be restarting — try again shortly."
                status == 429 -> "Too many requests. Wait a moment and retry."
                status == 403 -> "You do not have permission to perform this action."
                status >= 500 -> "The server hit an error ($status). Try again."
                else -> "The server rejected the request ($status)."
            }
        }
        is Contract -> "The server sent something this app version doesn't understand. Update the app or the server."
        is Cancelled -> "Cancelled."
        is Unknown -> cause?.message?.takeIf { it.isNotBlank() }
            ?: "Something went wrong. Try again."
    }
}

/**
 * Carries an [AppError] through `Result.failure` and `catch` blocks. The
 * exception message is the user-facing sentence, so code that still reads
 * `throwable.message` keeps working and simply gets a better string.
 */
class AppErrorException(val error: AppError) : Exception(error.userMessage(), error.cause)

/**
 * Classify a failure. Order matters: an [AppErrorException] is unwrapped as
 * is, cancellation is recognised before the IO family (it must never turn into
 * a "network" card), and the HTTP status of an [ApiHttpException] decides the
 * server-side cases.
 */
fun Throwable.toAppError(): AppError = when (this) {
    is AppErrorException -> this.error
    is CancellationException -> AppError.Cancelled(this)
    is ApiHttpException -> when (status) {
        401 -> AppError.Unauthorized(this)
        404 -> AppError.NotFound(this)
        else -> AppError.Server(status, serverMessage, this)
    }
    // A ResponseException that escaped the validator (it should not, but the
    // mapping must not depend on that) still carries the status.
    is ResponseException -> when (val status = response.status.value) {
        401 -> AppError.Unauthorized(this)
        404 -> AppError.NotFound(this)
        else -> AppError.Server(status, null, this)
    }
    is HttpRequestTimeoutException,
    is ConnectTimeoutException,
    is SocketTimeoutException,
    is UnknownHostException,
    is IOException -> AppError.Network(this)
    is SerializationException,
    is ContentConvertException,
    is NoTransformationFoundException,
    is IllegalArgumentException -> AppError.Contract(this)
    else -> AppError.Unknown(this)
}

/**
 * Run one API call and map any failure to an [AppError].
 *
 * Cancellation is rethrown, not captured: swallowing it would keep a
 * cancelled coroutine running to completion and report a phantom failure
 * for a screen the user already left.
 */
suspend inline fun <T> apiCall(crossinline block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Throwable) {
        Result.failure(AppErrorException(failure.toAppError()))
    }

/** The [AppError] behind a failed [Result], mapping foreign exceptions on the way. */
fun Result<*>.appErrorOrNull(): AppError? = exceptionOrNull()?.toAppError()
