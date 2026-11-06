package com.claudewebui.app.ui.screens.settings

import android.content.Context
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.wear.WatchNode
import com.claudewebui.app.wear.WatchPairing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

/** "31. Okt., 14:20" in the device locale. */
internal fun watchPairedSince(context: Context, millis: Long): String =
    DateUtils.formatDateTime(
        context,
        millis,
        DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH,
    )

/**
 * Settings → Uhr: the watches connected to this phone, pairing one with Plum
 * (a watch-scope token handed over through the Data Layer) and unpairing it.
 */
@Composable
fun WatchPairingPanel(api: ApiClient = koinInject()) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pairing by remember { WatchPairing.state(context) }.collectAsStateWithLifecycle()
    var watches by remember { mutableStateOf<List<WatchNode>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var revokedOnServer by remember { mutableStateOf(false) }

    // Watches come and go with Bluetooth; a cheap Play Services lookup.
    LaunchedEffect(Unit) {
        while (true) {
            watches = WatchPairing.connectedWatches(context)
            loaded = true
            delay(10_000)
        }
    }
    // Revoked in the WebUI meanwhile? Then the watch is locked out and needs a new pairing.
    val pairedTokenId = pairing?.tokenId
    LaunchedEffect(pairedTokenId) {
        revokedOnServer = false
        if (pairedTokenId == null) return@LaunchedEffect
        revokedOnServer = try {
            val tokens = api.getBrowserTokens().data
            tokens != null && tokens.none { it.id == pairedTokenId && !it.revoked }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            false
        }
    }

    fun launchAction(failureText: Int, action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                action()
                error = null
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = context.getString(failureText, failure.message ?: failure.javaClass.simpleName)
            } finally {
                busy = false
            }
        }
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(stringResource(R.string.settings_hub_watch), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.watch_description), color = PlumMuted, fontSize = 12.sp)
            error?.let { Text(it, color = PlumRed, fontSize = 12.sp) }

            pairing?.let { state ->
                val connected = watches.any { it.id == state.nodeId }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "● ${stringResource(R.string.watch_paired_with, state.nodeName.ifBlank { "Wear OS" })}",
                        color = if (connected) PlumGreen else PlumAccent,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (state.issuedAt > 0L) {
                        Text(
                            stringResource(R.string.watch_paired_since, watchPairedSince(context, state.issuedAt)),
                            color = PlumMuted,
                            fontSize = 11.sp,
                        )
                    }
                    if (loaded && !connected) Text(stringResource(R.string.watch_not_connected_now), color = PlumMuted, fontSize = 11.sp)
                    if (revokedOnServer) Text(stringResource(R.string.watch_revoked_on_server), color = PlumAmber, fontSize = 12.sp)
                    OutlinedButton(
                        onClick = { launchAction(R.string.watch_unpair_failed) { WatchPairing.unpair(context, api) } },
                        enabled = !busy,
                    ) { Text(stringResource(R.string.watch_unpair), color = PlumRed) }
                }
            }

            if (loaded && watches.isEmpty()) {
                Text(stringResource(R.string.watch_none_connected), color = PlumMuted, fontSize = 12.sp)
            }
            watches.forEach { node ->
                val pairedHere = pairing?.nodeId == node.id
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(node.displayName, color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            stringResource(if (node.hasPlum) R.string.watch_app_installed else R.string.watch_app_missing),
                            color = if (node.hasPlum) PlumMuted else PlumAmber,
                            fontSize = 11.sp,
                        )
                    }
                    Button(
                        onClick = { launchAction(R.string.watch_pair_failed) { WatchPairing.pair(context, api, node) } },
                        enabled = !busy,
                    ) { Text(stringResource(if (pairedHere) R.string.watch_pair_again else R.string.watch_pair)) }
                }
            }
            if (busy) Text(stringResource(R.string.watch_pairing_busy), color = PlumMuted, fontSize = 12.sp)
        }
    }
}
