package com.claudewebui.app.core.network

/**
 * The one [ApiClient] for code that runs outside Koin's UI graph — widgets, the
 * refresh worker, the Wear bridge.
 *
 * Each [ApiClient] owns an OkHttp engine with its own dispatcher threads and
 * connection pool. Building one per broadcast (an approval tap is a broadcast)
 * leaked all of that every time, because a receiver has nowhere to call
 * `close()` from. One lazily built client, shared, closed never — which is
 * correct here: it lives exactly as long as the process does.
 */
object BackgroundApi {
    val client: ApiClient by lazy { ApiClient() }
}
