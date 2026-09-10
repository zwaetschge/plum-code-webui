package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** `/api/oracle/browser` — the remote-controlled browser of one session. */
interface OracleBrowserApi {
    suspend fun getOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState>

    suspend fun startOracleBrowser(
        sessionId: String,
        targetUrl: String?,
    ): ApiResponse<OracleBrowserState>

    suspend fun stopOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState>

    suspend fun reloadOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState>

    suspend fun navigateOracleBrowser(
        sessionId: String,
        targetUrl: String,
    ): ApiResponse<OracleBrowserState>

    suspend fun getOracleFrame(sessionId: String): ByteArray

    suspend fun clickOracleBrowser(sessionId: String, xRatio: Float, yRatio: Float)

    suspend fun wheelOracleBrowser(sessionId: String, deltaY: Float)

    suspend fun keyOracleBrowser(sessionId: String, key: String, code: String? = null)

    suspend fun textOracleBrowser(sessionId: String, text: String)
}

class OracleBrowserApiImpl(private val http: ApiHttp) : OracleBrowserApi {

    override suspend fun getOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState> =
        http.get("/api/oracle/browser/$sessionId")

    override suspend fun startOracleBrowser(
        sessionId: String,
        targetUrl: String?,
    ): ApiResponse<OracleBrowserState> =
        http.post("/api/oracle/browser/$sessionId/start") { setBody(OracleStartInput(targetUrl)) }

    override suspend fun stopOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState> =
        http.post("/api/oracle/browser/$sessionId/stop")

    override suspend fun reloadOracleBrowser(sessionId: String): ApiResponse<OracleBrowserState> =
        http.post("/api/oracle/browser/$sessionId/reload")

    override suspend fun navigateOracleBrowser(
        sessionId: String,
        targetUrl: String,
    ): ApiResponse<OracleBrowserState> =
        http.post("/api/oracle/browser/$sessionId/navigate") { setBody(OracleNavigateInput(targetUrl)) }

    override suspend fun getOracleFrame(sessionId: String): ByteArray =
        http.get("/api/oracle/browser/$sessionId/frame")

    override suspend fun clickOracleBrowser(sessionId: String, xRatio: Float, yRatio: Float) {
        http.client.post(http.url("/api/oracle/browser/$sessionId/click")) {
            setBody(OracleClickInput(xRatio, yRatio))
        }
    }

    override suspend fun wheelOracleBrowser(sessionId: String, deltaY: Float) {
        http.client.post(http.url("/api/oracle/browser/$sessionId/wheel")) {
            setBody(OracleWheelInput(.5f, .5f, deltaY = deltaY))
        }
    }

    override suspend fun keyOracleBrowser(sessionId: String, key: String, code: String?) {
        http.client.post(http.url("/api/oracle/browser/$sessionId/key")) {
            setBody(OracleKeyInput(key, code))
        }
    }

    override suspend fun textOracleBrowser(sessionId: String, text: String) {
        http.client.post(http.url("/api/oracle/browser/$sessionId/text")) {
            setBody(OracleTextInput(text))
        }
    }
}
