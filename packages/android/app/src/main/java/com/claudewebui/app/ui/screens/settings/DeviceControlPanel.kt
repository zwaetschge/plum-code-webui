package com.claudewebui.app.ui.screens.settings

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.claudewebui.app.R
import com.claudewebui.app.core.devicecontrol.DeviceControlAccessibilityService
import com.claudewebui.app.core.devicecontrol.DeviceControlPrefs
import com.claudewebui.app.core.devicecontrol.DeviceControlService
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import kotlinx.coroutines.delay

/**
 * Device control, as in the WebUI settings' Browser page: this phone pairs
 * with the Plum backend when its accessibility service is on, and Plum
 * sessions can then read and operate it — the on-device replacement for adb.
 */
@Composable
fun DeviceControlPanel() {
    val context = LocalContext.current
    var accessibilityOn by remember { mutableStateOf(DeviceControlAccessibilityService.isRunning) }
    var connected by remember { mutableStateOf(DeviceControlService.connected.value) }
    var enabled by remember { mutableStateOf(DeviceControlPrefs.isEnabled(context)) }

    // Live status while the page is visible.
    LaunchedEffect(Unit) {
        while (true) {
            accessibilityOn = DeviceControlAccessibilityService.isRunning
            connected = DeviceControlService.connected.value
            delay(2000)
        }
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(stringResource(R.string.device_control_title), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.device_control_subtitle), color = PlumMuted, fontSize = 12.sp)

            val statusText = when {
                connected -> stringResource(R.string.device_control_status_connected)
                accessibilityOn && enabled -> stringResource(R.string.device_control_status_connecting)
                accessibilityOn && !enabled -> stringResource(R.string.device_control_status_paused)
                else -> stringResource(R.string.device_control_status_accessibility_off)
            }
            Text(
                statusText,
                color = if (connected) PlumGreen else PlumMuted,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )

            if (!accessibilityOn) {
                Text(stringResource(R.string.device_control_enable_hint), color = PlumMuted, fontSize = 12.sp)
                Button(onClick = { openAccessibilitySettings(context) }) {
                    Text(stringResource(R.string.device_control_open_accessibility))
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(stringResource(R.string.device_control_pause), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.device_control_pause_footer), color = PlumMuted, fontSize = 11.sp)
                    }
                    Spacer(Modifier.width(10.dp))
                    Switch(
                        checked = enabled,
                        onCheckedChange = { next ->
                            enabled = next
                            DeviceControlPrefs.setEnabled(context, next)
                            if (next) {
                                ContextCompat.startForegroundService(context, DeviceControlService.intent(context))
                            } else {
                                DeviceControlService.stop(context)
                            }
                        },
                    )
                }
                OutlinedButton(onClick = { openAccessibilitySettings(context) }) {
                    Text(stringResource(R.string.device_control_open_accessibility))
                }
            }
        }
    }
}

private fun openAccessibilitySettings(context: Context) {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { context.startActivity(intent) }
}
