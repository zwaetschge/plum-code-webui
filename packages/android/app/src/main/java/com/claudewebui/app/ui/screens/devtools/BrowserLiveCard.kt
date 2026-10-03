package com.claudewebui.app.ui.screens.devtools

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumText
import kotlinx.coroutines.delay

/**
 * Live view of the tab the session works in through the Plum Browser
 * extension (the WebUI's "Mein Browser · live"), with a pause switch.
 */
@Composable
fun BrowserLiveCard(state: DevToolsUiState, viewModel: DevToolsViewModel) {
    var watching by rememberSaveable { mutableStateOf(false) }
    val frame = state.browserLive

    LaunchedEffect(watching) {
        while (watching) {
            viewModel.loadBrowserLive()
            delay(2_500)
        }
    }

    val bitmap = remember(state.browserLiveImage) {
        state.browserLiveImage?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.browser_live_title),
                        color = PlumText,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        if (watching) frame?.info ?: stringResource(R.string.browser_live_loading)
                        else stringResource(R.string.browser_live_hint),
                        color = PlumMuted,
                        fontSize = 11.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OracleChip(
                    stringResource(if (watching) R.string.browser_live_stop else R.string.browser_live_watch),
                    disabled = false,
                ) { watching = !watching }
                if (watching && frame != null && frame.code == null) {
                    OracleChip(
                        stringResource(if (frame.paused) R.string.browser_live_resume else R.string.browser_live_pause),
                        disabled = state.isBrowserPausePending,
                        destructive = !frame.paused,
                    ) { viewModel.toggleBrowserPause() }
                }
            }
            if (watching && bitmap != null) {
                Image(
                    bitmap = bitmap,
                    contentDescription = stringResource(R.string.browser_live_image, frame?.info.orEmpty()),
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)),
                )
            }
            if (watching && frame?.paused == true) {
                Text(stringResource(R.string.browser_live_paused), color = PlumMuted, fontSize = 11.sp)
            }
        }
    }
}
