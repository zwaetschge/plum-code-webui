package com.claudewebui.app.ui.screens.devtools

import com.claudewebui.app.R
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
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    val snapshot = state.deviceSnapshot
    val busy = state.isDeviceActionPending || state.isLoadingDevices

    var host by remember { mutableStateOf("") }
    var pairPort by remember { mutableStateOf("") }
    var pairCode by remember { mutableStateOf("") }
    var connectPort by remember { mutableStateOf("5555") }

    Column(verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.compact)) {

        // ── Emulator ────────────────────────────────────────────────────────
        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
            Column(
                Modifier.fillMaxWidth().padding(15.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        screenResources.getString(R.string.devtools_emulator_50b5d),
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
                    Text(screenResources.getString(R.string.devtools_avd_1_s_543e0, it), color = PlumMuted, fontSize = 12.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
                    ActionText(screenResources.getString(R.string.devtools_start_952f3), busy) { viewModel.startEmulator() }
                    ActionText(screenResources.getString(R.string.devtools_stop_9e253), busy) { viewModel.stopEmulator() }
                    ActionText(screenResources.getString(R.string.devtools_refresh_56e3b), busy) { viewModel.loadDevices() }
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
                        screenResources.getString(R.string.devtools_connected_c2f9b),
                        color = PlumText,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    ActionText(screenResources.getString(R.string.devtools_reconnect_all_c27d3), busy) { viewModel.reconnectDevices() }
                }
                val live = snapshot?.live.orEmpty()
                if (live.isEmpty()) {
                    Text(
                        if (state.isLoadingDevices) screenResources.getString(R.string.devtools_loading_33ce4) else screenResources.getString(R.string.devtools_no_device_connected_0a90a),
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
                        ActionText(screenResources.getString(R.string.devtools_disconnect_ed28e), busy) { viewModel.disconnectDevice(device.serial) }
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
                    Text(screenResources.getString(R.string.devtools_remembered_4d3eb), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
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
                                label = { Text(screenResources.getString(R.string.devtools_port_fe035)) },
                                singleLine = true,
                                modifier = Modifier.width(96.dp),
                            )
                            ActionText(screenResources.getString(R.string.devtools_connect_b6546), busy || portInput.isBlank()) {
                                viewModel.connectDevice(
                                    host,
                                    portInput.toIntOrNull() ?: knownPort,
                                    device.friendlyName,
                                    device.serial,
                                )
                            }
                            ActionText(screenResources.getString(R.string.devtools_forget_03d5d), busy) { viewModel.forgetDevice(device.serial) }
                        }
                    }
                }
            }
        }

        // ── Pair / connect ──────────────────────────────────────────────────
        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
            Column(
                Modifier.fillMaxWidth().padding(15.dp),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
            ) {
                Text(screenResources.getString(R.string.devtools_add_a_device_f9086), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text(
                    screenResources.getString(R.string.devtools_wireless_debugging_pair_device_with_pairing_code_shows_host_53034) +
                        screenResources.getString(R.string.devtools_pairing_port_and_code_connect_uses_the_other_port_usually_5555_5c9dd),
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it },
                    label = { Text(screenResources.getString(R.string.devtools_host_ip_4c833)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
                    OutlinedTextField(
                        value = pairPort,
                        onValueChange = { pairPort = it.filter(Char::isDigit) },
                        label = { Text(screenResources.getString(R.string.devtools_pair_port_890ed)) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = pairCode,
                        onValueChange = { pairCode = it.filter(Char::isDigit) },
                        label = { Text(screenResources.getString(R.string.devtools_code_adac6)) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
                ActionText(screenResources.getString(R.string.devtools_pair_2537f), busy || host.isBlank() || pairPort.isBlank() || pairCode.isBlank()) {
                    viewModel.pairDevice(host.trim(), pairPort.toIntOrNull() ?: 0, pairCode.trim())
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = connectPort,
                        onValueChange = { connectPort = it.filter(Char::isDigit) },
                        label = { Text(screenResources.getString(R.string.devtools_connect_port_6a01a)) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    ActionText(screenResources.getString(R.string.devtools_connect_b6546), busy || host.isBlank()) {
                        viewModel.connectDevice(host.trim(), connectPort.toIntOrNull() ?: 5555)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionText(label: String, disabled: Boolean, onClick: () -> Unit) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    Text(
        label,
        color = if (disabled) PlumMuted else PlumAccent,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clickable(enabled = !disabled, onClick = onClick)
            .padding(horizontal = screenTokens.spacing.sm, vertical = screenTokens.spacing.inline),
    )
}
