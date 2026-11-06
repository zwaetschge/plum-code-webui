package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Watch
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.wear.WatchNode
import com.claudewebui.app.wear.WatchPairing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

/**
 * A connected watch that runs the Plum app (`plum_wear` capability) while this
 * phone has not paired one, or null. Nothing once paired or once the hint was
 * dismissed.
 */
@Composable
internal fun rememberUnpairedWatch(): WatchNode? {
    val context = LocalContext.current
    val pairing by remember { WatchPairing.state(context) }.collectAsStateWithLifecycle()
    val dismissed by remember { WatchPairing.hintDismissed(context) }.collectAsStateWithLifecycle()
    var candidate by remember { mutableStateOf<WatchNode?>(null) }
    val wanted = pairing == null && !dismissed
    LaunchedEffect(wanted) {
        candidate = null
        // Watches connect later than the phone app starts; look again now and then.
        while (wanted) {
            candidate = WatchPairing.connectedWatches(context).firstOrNull { it.hasPlum }
            delay(60_000)
        }
    }
    return candidate.takeIf { wanted }
}

/** One-time dashboard prompt: pair the watch right here, or wave it away for good. */
@Composable
internal fun WatchPairingHintCard(watch: WatchNode, api: ApiClient = koinInject()) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    GlassPanel(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Outlined.Watch, null, tint = PlumAccent, modifier = Modifier.size(24.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.watch_hint_title), color = PlumText, fontWeight = FontWeight.SemiBold)
                    Text(
                        error ?: stringResource(R.string.watch_hint_detail, watch.displayName),
                        color = if (error != null) PlumRed else PlumMuted,
                        fontSize = 12.sp,
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { WatchPairing.dismissHint(context) }, enabled = !busy) {
                    Text(stringResource(R.string.watch_hint_later))
                }
                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                WatchPairing.pair(context, api, watch)
                                error = null
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (failure: Exception) {
                                error = context.getString(
                                    R.string.watch_pair_failed,
                                    failure.message ?: failure.javaClass.simpleName,
                                )
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                ) {
                    Text(stringResource(if (busy) R.string.watch_pairing_busy else R.string.watch_hint_pair))
                }
            }
        }
    }
}
