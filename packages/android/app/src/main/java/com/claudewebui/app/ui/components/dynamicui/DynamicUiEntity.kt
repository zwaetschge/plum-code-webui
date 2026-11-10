package com.claudewebui.app.ui.components.dynamicui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.SubdirectoryArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.motion.pressScale
import com.claudewebui.app.ui.theme.PlumTheme
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject

/** Routes `entity:Title` links to the entity sheet; everything else opens as before. */
class DynamicUiUriHandler(private val parent: UriHandler, private val onEntity: (String) -> Unit) : UriHandler {
    override fun openUri(uri: String) {
        val title = parseUiEntityHref(uri)
        if (title != null) onEntity(title) else parent.openUri(uri)
    }
}

/** What the entity sheet shows: a Wikipedia title in an optional language. */
data class UiEntityRequest(val title: String, val lang: String? = null)

/**
 * Bottom sheet with the Wikipedia summary of [request] (inline `entity:`
 * links and `openEntity` actions). [load] returns the `UiResult<'entity'>`
 * envelope from `GET /api/assistant/ui/entity`; [preset] skips the request.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DynamicUiEntitySheet(request: UiEntityRequest, load: suspend (UiEntityRequest) -> JsonObject?, onDismiss: () -> Unit) {
    val palette = PlumTheme.palette
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    var state by remember(request) { mutableStateOf<Pair<UiEntityData?, String?>?>(null) }
    LaunchedEffect(request) {
        state = try {
            val envelope = load(request)?.let { UiLiveResult(it) }
            val data = if (envelope?.status == "resolved") decodeLive<UiEntityData>(envelope.data) else null
            data to (if (data == null) envelope?.error else null)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            null to failure.message
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = if (palette.isLight) androidx.compose.ui.graphics.Color.White else palette.surfaceStrong.copy(alpha = 1f)) {
        Column(
            Modifier.fillMaxWidth().heightIn(min = 240.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val current = state
            when {
                current == null -> {
                    DuiSkeleton(Modifier.fillMaxWidth().aspectRatio(16f / 10f), RoundedCornerShape(16.dp))
                    DuiSkeletonLine(.6f, 18.dp)
                    DuiSkeletonLine(.4f, 12.dp)
                    repeat(3) { DuiSkeletonLine(if (it == 2) .7f else 1f, 12.dp) }
                }
                current.first != null -> EntityContent(current.first!!, palette, large = true)
                else -> Row(Modifier.fillMaxWidth().padding(vertical = 24.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Outlined.ErrorOutline, null, tint = palette.muted, modifier = Modifier.size(20.dp))
                    Column {
                        Text(request.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.text)
                        Text(current.second ?: stringResource(R.string.dynamic_ui_entity_failed), style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    }
                }
            }
        }
    }
}

/**
 * Suggestion chips under the latest answer (Dynamic UI v2 `followups`).
 * A tap sends the text as the next message; they are never part of the
 * copied answer. Rows rise in one after another on a fresh answer.
 */
@Composable
fun DynamicUiFollowups(items: List<String>, enabled: Boolean, onSelect: (String) -> Unit, modifier: Modifier = Modifier, animate: Boolean = true) {
    val chips = remember(items) { sanitizeDynamicUiFollowups(items) }
    if (chips.isEmpty()) return
    val palette = PlumTheme.palette
    val label = stringResource(R.string.dynamic_ui_followups)
    Column(modifier.fillMaxWidth().padding(top = 4.dp).semantics { contentDescription = label }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chips.forEachIndexed { index, text ->
            val source = remember { MutableInteractionSource() }
            Row(
                Modifier
                    .duiRise(animate, index + 1)
                    .widthIn(max = 520.dp)
                    .pressScale(source)
                    .clip(RoundedCornerShape(18.dp))
                    .background(palette.text.copy(alpha = if (palette.isLight) .04f else .05f))
                    .border(1.dp, palette.duiEdge, RoundedCornerShape(18.dp))
                    .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button) { onSelect(text) }
                    .heightIn(min = 40.dp)
                    .padding(start = 12.dp, end = 16.dp, top = 9.dp, bottom = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(20.dp).clip(CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.SubdirectoryArrowRight, null, tint = palette.accent, modifier = Modifier.size(16.dp))
                }
                Text(text, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp), color = if (enabled) palette.text else palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
