package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/app` — the Android build itself: update metadata and crash reports. */
interface AppApi {
    /** GET /api/app/version — returns latest Android APK metadata */
    suspend fun checkAppVersion(): ApiResponse<AppVersionInfo>

    /** POST /api/app/crash-report — sent once on the start after a crash. */
    suspend fun reportCrash(input: CrashReportInput): ApiResponse<JsonElement>
}

class AppApiImpl(private val http: ApiHttp) : AppApi {

    override suspend fun checkAppVersion(): ApiResponse<AppVersionInfo> =
        http.get("/api/app/version")

    override suspend fun reportCrash(input: CrashReportInput): ApiResponse<JsonElement> =
        http.post("/api/app/crash-report") { setBody(input) }
}
