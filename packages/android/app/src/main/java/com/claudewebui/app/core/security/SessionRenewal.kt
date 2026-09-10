package com.claudewebui.app.core.security

import android.util.Base64
import android.util.Log
import com.claudewebui.app.core.network.ApiClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the stored JWT from running out under a long-lived install.
 *
 * The backend issues 7-day tokens (30 for Basic Auth) and nothing renewed
 * them, so the app was signed out on a fixed schedule regardless of how much
 * it was being used. The failure is also unusually opaque: REST starts
 * answering 401, and the socket handshake rejects with a *terminal* "Invalid
 * token" that suppresses reconnect attempts, so it looks like the server went
 * away rather than like a login expiring.
 *
 * `POST /auth/refresh` slides the window forward using the current, still
 * valid token. There is no refresh-token grant to fall back on: a device that
 * has been offline past the expiry has to sign in again, by design.
 */
object SessionRenewal {

    private const val TAG = "SessionRenewal"

    /** Renew once less than this is left — comfortably wider than a weekend offline. */
    private val RENEW_WINDOW_MS = TimeUnit.DAYS.toMillis(2)

    /**
     * Floor between attempts. Foregrounding fires on every activity start, and
     * a server that keeps handing back a near-expired token must not turn that
     * into a request per screen change.
     */
    private val MIN_RETRY_INTERVAL_MS = TimeUnit.HOURS.toMillis(1)

    private val inFlight = AtomicBoolean(false)

    @Volatile
    private var lastAttemptAt = 0L

    /**
     * Expiry of a JWT in epoch millis, or null if it carries no readable `exp`.
     *
     * Signature is deliberately not checked: this only decides whether to ask
     * the server for a new token, and the server verifies for real.
     */
    fun expiresAt(token: String): Long? = runCatching {
        val payload = token.split('.').getOrNull(1) ?: return null
        val json = String(
            Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
            Charsets.UTF_8,
        )
        JSONObject(json).optLong("exp", 0L).takeIf { it > 0L }?.let { it * 1000L }
    }.getOrNull()

    /**
     * Renew if the stored token is close to expiring.
     *
     * @param onRenewed invoked after the new token is stored, so the caller can
     *        reconnect the socket — the live connection still holds the old one.
     */
    suspend fun renewIfDue(api: ApiClient, onRenewed: () -> Unit) {
        val token = TokenStore.getToken() ?: return
        val expiry = expiresAt(token) ?: return
        val now = System.currentTimeMillis()

        // Already expired: the refresh call would 401 too, and re-login is the
        // only way out. Leave the token in place so the UI can say so.
        if (expiry <= now) return
        if (expiry - now > RENEW_WINDOW_MS) return
        if (now - lastAttemptAt < MIN_RETRY_INTERVAL_MS) return
        if (!inFlight.compareAndSet(false, true)) return

        lastAttemptAt = now
        try {
            val response = api.refreshToken()
            val fresh = response.data?.token
            if (!response.success || fresh.isNullOrBlank()) {
                Log.w(TAG, "Token renewal rejected: ${response.error?.message ?: "no token returned"}")
                return
            }
            TokenStore.setToken(fresh)
            Log.i(TAG, "Session renewed; expires ${expiresAt(fresh)}")
            onRenewed()
        } catch (e: Exception) {
            // Offline, or the server is down. The old token is still valid for
            // now, and the next foreground pass tries again.
            Log.w(TAG, "Token renewal failed: ${e.message}")
        } finally {
            inFlight.set(false)
        }
    }
}
