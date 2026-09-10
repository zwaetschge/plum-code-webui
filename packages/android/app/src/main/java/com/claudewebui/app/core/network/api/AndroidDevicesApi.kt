package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*
import kotlinx.serialization.json.JsonElement

/** `/api/android` — test devices and the emulator behind the android-app-creator bridge. */
interface AndroidDevicesApi {
    suspend fun getAndroidDevices(sessionId: String? = null): ApiResponse<AndroidDeviceSnapshot>

    suspend fun reconnectAndroidDevices(): ApiResponse<AndroidDeviceSnapshot>

    suspend fun pairAndroidDevice(input: AndroidPairInput): ApiResponse<JsonElement>

    suspend fun connectAndroidDevice(input: AndroidConnectInput): ApiResponse<JsonElement>

    suspend fun disconnectAndroidDevice(serial: String): ApiResponse<JsonElement>

    suspend fun forgetAndroidDevice(serial: String): ApiResponse<JsonElement>

    suspend fun getAndroidEmulatorStatus(): ApiResponse<AndroidEmulatorStatus>

    suspend fun startAndroidEmulator(): ApiResponse<JsonElement>

    suspend fun stopAndroidEmulator(): ApiResponse<JsonElement>
}

class AndroidDevicesApiImpl(private val http: ApiHttp) : AndroidDevicesApi {

    override suspend fun getAndroidDevices(sessionId: String?): ApiResponse<AndroidDeviceSnapshot> =
        http.get("/api/android/devices") { sessionId?.let { parameter("sessionId", it) } }

    override suspend fun reconnectAndroidDevices(): ApiResponse<AndroidDeviceSnapshot> =
        http.post("/api/android/devices/reconnect-all")

    override suspend fun pairAndroidDevice(input: AndroidPairInput): ApiResponse<JsonElement> =
        http.post("/api/android/devices/pair") { setBody(input) }

    override suspend fun connectAndroidDevice(input: AndroidConnectInput): ApiResponse<JsonElement> =
        http.post("/api/android/devices/connect") { setBody(input) }

    override suspend fun disconnectAndroidDevice(serial: String): ApiResponse<JsonElement> =
        http.post("/api/android/devices/${http.pathSegment(serial)}/disconnect")

    override suspend fun forgetAndroidDevice(serial: String): ApiResponse<JsonElement> =
        http.delete("/api/android/devices/${http.pathSegment(serial)}")

    override suspend fun getAndroidEmulatorStatus(): ApiResponse<AndroidEmulatorStatus> =
        http.get("/api/android/emulator/status")

    override suspend fun startAndroidEmulator(): ApiResponse<JsonElement> =
        http.post("/api/android/emulator/start") { setBody(emptyMap<String, String>()) }

    override suspend fun stopAndroidEmulator(): ApiResponse<JsonElement> =
        http.post("/api/android/emulator/stop") { setBody(emptyMap<String, String>()) }
}
