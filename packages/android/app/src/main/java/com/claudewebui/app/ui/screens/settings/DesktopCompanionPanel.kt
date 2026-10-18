package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.BrowserConnection
import com.claudewebui.app.data.model.DesktopRule
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

private val DESKTOP_MODES = listOf(
    "control" to R.string.desktop_mode_control,
    "guide" to R.string.desktop_mode_guide,
    "paused" to R.string.desktop_mode_paused,
)

/**
 * Plum Desktop, as in the WebUI settings: connected computers with mode and
 * demonstrations, per-app rules, and the installer command for another computer.
 */
@Composable
fun DesktopCompanionPanel(api: ApiClient = koinInject()) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var desktops by remember { mutableStateOf<List<BrowserConnection>>(emptyList()) }
    var rules by remember { mutableStateOf<List<DesktopRule>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var match by remember { mutableStateOf("") }
    var computer by remember { mutableStateOf("") }
    var command by remember { mutableStateOf<String?>(null) }
    var actionBusy by remember { mutableStateOf(false) }

    fun run(block: suspend () -> Unit) {
        scope.launch {
            try { block(); error = null }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
        }
    }
    fun saveRules(next: List<DesktopRule>) {
        rules = next
        run { api.setDesktopRules(next).data?.let { rules = it } }
    }
    LaunchedEffect(Unit) {
        run { rules = api.getDesktopRules().data.orEmpty() }
    }
    LaunchedEffect(refresh) {
        while (true) {
            try {
                desktops = api.getBrowserBridgeStatus().data?.connections.orEmpty().filter { it.client.kind == "desktop" }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {}
            delay(2_000)
        }
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(stringResource(R.string.desktop_title), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.desktop_description), color = PlumMuted, fontSize = 12.sp)
            error?.let { Text(it, color = PlumRed, fontSize = 12.sp) }

            if (desktops.isEmpty()) Text(stringResource(R.string.desktop_none), color = PlumMuted, fontSize = 12.sp)
            desktops.forEach { desktop ->
                val mode = desktop.mode ?: if (desktop.paused) "paused" else "control"
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("● ${desktop.client.label}", color = if (mode == "paused") PlumAccent else PlumGreen, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Plum Desktop ${desktop.client.version} · ${desktop.client.platform}", color = PlumMuted, fontSize = 11.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        DESKTOP_MODES.forEach { (id, label) ->
                            FilterChip(selected = mode == id, onClick = {
                                run { api.setDesktopMode(id, desktop.id); delay(600); refresh++ }
                            }, label = { Text(stringResource(label)) })
                        }
                    }
                    DesktopActivityCard(desktop.id, desktop.desktopActivity, actionBusy) { input ->
                        run {
                            actionBusy = true
                            try { api.desktopAction(input); delay(600); refresh++ }
                            finally { actionBusy = false }
                        }
                    }
                    if (desktop.recording) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.desktop_recording), color = PlumRed, fontSize = 12.sp)
                        Button(onClick = { run { api.desktopRecord("stop", desktop.id); delay(600); refresh++ } }) { Text(stringResource(R.string.desktop_record_stop)) }
                        TextButton(onClick = { run { api.desktopRecord("cancel", desktop.id); delay(600); refresh++ } }) { Text(stringResource(R.string.desktop_record_cancel)) }
                    } else OutlinedButton(onClick = { run { api.desktopRecord("start", desktop.id); delay(600); refresh++ } }) {
                        Text(stringResource(R.string.desktop_record_start))
                    }
                }
            }

            Text(stringResource(R.string.desktop_rules), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.desktop_rules_hint), color = PlumMuted, fontSize = 11.sp)
            rules.forEachIndexed { index, rule ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(rule.match, Modifier.weight(1f), color = PlumText, fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    FilterChip(selected = rule.mode == "block", onClick = {
                        saveRules(rules.mapIndexed { i, r -> if (i == index) r.copy(mode = if (r.mode == "block") "ask" else "block") else r })
                    }, label = { Text(stringResource(if (rule.mode == "block") R.string.desktop_rule_block else R.string.desktop_rule_ask)) })
                    IconButton(onClick = { saveRules(rules.filterIndexed { i, _ -> i != index }) }) {
                        Icon(Icons.Outlined.Delete, stringResource(R.string.desktop_rule_remove), tint = PlumMuted, modifier = Modifier.size(18.dp))
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(match, { match = it }, label = { Text(stringResource(R.string.desktop_rule_new)) }, singleLine = true, modifier = Modifier.weight(1f))
                TextButton(enabled = match.isNotBlank(), onClick = { saveRules(rules + DesktopRule(match.trim(), "ask")); match = "" }) {
                    Text(stringResource(R.string.desktop_rule_add))
                }
            }

            Text(stringResource(R.string.desktop_install), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(computer, { computer = it }, label = { Text(stringResource(R.string.desktop_install_name)) }, singleLine = true, modifier = Modifier.weight(1f))
                TextButton(onClick = { run { command = api.createDesktopInstall(computer.trim().ifEmpty { "Desktop" }).data?.command } }) {
                    Text(stringResource(R.string.desktop_install_create))
                }
            }
            command?.let { line ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(line, Modifier.weight(1f), color = PlumText, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    IconButton(onClick = { clipboard.setText(AnnotatedString(line)) }) {
                        Icon(Icons.Outlined.ContentCopy, stringResource(R.string.desktop_install_copy), tint = PlumMuted)
                    }
                }
                Text(stringResource(R.string.desktop_install_hint), color = PlumMuted, fontSize = 11.sp)
            }
        }
    }
}
