package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * The `api/android` routes — ADB devices and the shared emulator, as surfaced
 * by the android-app-creator backend. Mirrors the WebUI's AndroidDevicePanel so
 * a phone can pair and drive a test device without a desktop.
 */

@Serializable
data class AndroidLiveDevice(
    val serial: String,
    val state: String? = null,
    val model: String? = null,
    val product: String? = null,
    val device: String? = null,
    val friendlyName: String? = null,
)

@Serializable
data class AndroidKnownDevice(
    val serial: String,
    val host: String? = null,
    val port: Int? = null,
    val friendlyName: String? = null,
    val autoReconnect: Boolean = false,
    val lastSeenAt: String? = null,
    val lastConnectedAt: String? = null,
)

@Serializable
data class AndroidDeviceSnapshot(
    val live: List<AndroidLiveDevice> = emptyList(),
    val known: List<AndroidKnownDevice> = emptyList(),
    val selectedSerial: String? = null,
)

@Serializable
data class AndroidEmulatorStatus(
    val status: String = "unknown",
    val avd: String? = null,
    val port: Int? = null,
    val vncUrl: String? = null,
)

@Serializable
data class AndroidPairInput(
    val sessionId: String? = null,
    val host: String,
    val port: Int,
    val pairingCode: String,
    val friendlyName: String? = null,
)

@Serializable
data class AndroidConnectInput(
    val sessionId: String? = null,
    val host: String,
    val port: Int = 5555,
    val friendlyName: String? = null,
    /**
     * Serial to drop once the new port answers. Wireless debugging hands out a
     * fresh port on every restart, which would otherwise leave one remembered
     * entry per port for the same phone.
     */
    val replaceSerial: String? = null,
)
