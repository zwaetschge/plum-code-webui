package com.claudewebui.app.ui.screens.devtools

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill

/**
 * ADB test devices and the shared emulator, mirroring the WebUI's
 * AndroidDevicePanel. Pairing needs the code Android shows under
 * Developer options → Wireless debugging → Pair device with pairing code;
 * that dialog also prints the pairing port, which differs from the 5555
 * connect port.
 */
@Composable
fun AndroidDevicesPanel(state: DevToolsUiState, viewModel: DevToolsViewModel) {
    val snapshot = state.deviceSnapshot
    val busy = state.isDeviceActionPending || state.isLoadingDevices

    var host by remember { mutableStateOf("") }
    var pairPort by remember { mutableStateOf("") }
    var pairCode by remember { mutableStateOf("") }
    var connectPort by remember { mutableStateOf("5555") }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {

        // ── Emulator ────────────────────────────────────────────────────────
        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
            Column(
                Modifier.fillMaxWidth().padding(15.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Emulator",
                        color = PlumText,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    val status = state.emulatorStatus?.status ?: "unknown"
                    StatusPill(
                        status,
                        if (status == "running") PlumGreen else PlumMuted,
                    )
                }
                state.emulatorStatus?.avd?.let {
                    Text("AVD $it", color = PlumMuted, fontSize = 12.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionText("Start", busy) { viewModel.startEmulator() }
                    ActionText("Stop", busy) { viewModel.stopEmulator() }
                    ActionText("Refresh", busy) { viewModel.loadDevices() }
                }
            }
        }

        // ── Connected devices ───────────────────────────────────────────────
        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
            Column(
                Modifier.fillMaxWidth().padding(15.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Connected",
                        color = PlumText,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    ActionText("Reconnect all", busy) { viewModel.reconnectDevices() }
                }
                val live = snapshot?.live.orEmpty()
                if (live.isEmpty()) {
                    Text(
                        if (state.isLoadingDevices) "Loading…" else "No device connected",
                        color = PlumMuted,
                        fontSize = 12.sp,
                    )
                }
                live.forEach { device ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                device.friendlyName ?: device.model ?: device.serial,
                                color = PlumText,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(device.serial, device.state).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 11.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (device.serial == snapshot?.selectedSerial) {
                            StatusPill("session", PlumAccent)
                        }
                        ActionText("Disconnect", busy) { viewModel.disconnectDevice(device.serial) }
                    }
                }
            }
        }

        // ── Remembered devices ──────────────────────────────────────────────
        val known = snapshot?.known.orEmpty()
            .filterNot { k -> snapshot?.live.orEmpty().any { it.serial == k.serial } }
        if (known.isNotEmpty()) {
            GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                Column(
                    Modifier.fillMaxWidth().padding(15.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Text("Remembered", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    known.forEach { device ->
                        val host = device.host ?: device.serial.substringBefore(':')
                        val knownPort =
                            device.port
                                ?: device.serial.substringAfter(':', "5555").toIntOrNull()
                                ?: 5555
                        // Wireless debugging changes the port on every restart, so the
                        // remembered one is usually stale. Let it be corrected in place
                        // instead of sending the user back through the pair flow.
                        var portInput by remember(device.serial) {
                            mutableStateOf(knownPort.toString())
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    device.friendlyName ?: device.serial,
                                    color = PlumText,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    listOfNotNull(
                                        "$host:$knownPort",
                                        device.lastSeenAt?.take(19),
                                    ).joinToString(" · "),
                                    color = PlumMuted,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            OutlinedTextField(
                                value = portInput,
                                onValueChange = { portInput = it.filter(Char::isDigit) },
                                label = { Text("Port") },
                                singleLine = true,
                                modifier = Modifier.width(96.dp),
                            )
                            ActionText("Connect", busy || portInput.isBlank()) {
                                viewModel.connectDevice(
                                    host,
                                    portInput.toIntOrNull() ?: knownPort,
                                    device.friendlyName,
                                    device.serial,
                                )
                            }
                            ActionText("Forget", busy) { viewModel.forgetDevice(device.serial) }
                        }
                    }
                }
            }
        }

        // ── Pair / connect ──────────────────────────────────────────────────
        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
            Column(
                Modifier.fillMaxWidth().padding(15.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Add a device", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Wireless debugging → Pair device with pairing code shows host, " +
                        "pairing port and code. Connect uses the other port (usually 5555).",
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it },
                    label = { Text("Host / IP") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = pairPort,
                        onValueChange = { pairPort = it.filter(Char::isDigit) },
                        label = { Text("Pair port") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = pairCode,
                        onValueChange = { pairCode = it.filter(Char::isDigit) },
                        label = { Text("Code") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
                ActionText("Pair", busy || host.isBlank() || pairPort.isBlank() || pairCode.isBlank()) {
                    viewModel.pairDevice(host.trim(), pairPort.toIntOrNull() ?: 0, pairCode.trim())
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = connectPort,
                        onValueChange = { connectPort = it.filter(Char::isDigit) },
                        label = { Text("Connect port") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    ActionText("Connect", busy || host.isBlank()) {
                        viewModel.connectDevice(host.trim(), connectPort.toIntOrNull() ?: 5555)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionText(label: String, disabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (disabled) PlumMuted else PlumAccent,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clickable(enabled = !disabled, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
    )
}
