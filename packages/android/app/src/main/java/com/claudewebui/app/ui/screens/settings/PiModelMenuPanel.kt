package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Chooses which of Pi's runnable models the session menus offer, mirroring the
 * WebUI's Pi settings. The stored list (`cliProviderModelLists.pi`) keeps the
 * default first; an empty list offers every model, including ones a provider
 * adds later. The server narrows `/api/cli-providers` by the same list.
 */
@Composable
fun PiModelMenuPanel(
    catalog: List<String>?,
    stored: List<String>,
    providerDefault: String?,
    saving: Boolean,
    onSave: (List<String>) -> Unit,
) {
    val res = LocalContext.current.resources
    var query by remember { mutableStateOf("") }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(res.getString(R.string.pi_models_menu_title), color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            if (catalog == null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = PlumAccent)
                    Text(res.getString(R.string.pi_models_loading), color = PlumMuted, fontSize = 12.sp)
                }
                return@Column
            }
            if (catalog.isEmpty()) {
                Text(res.getString(R.string.pi_models_none), color = PlumMuted, fontSize = 12.sp)
                return@Column
            }

            val available = catalog.toSet()
            val picked = stored.filter { it in available }
            val customised = picked.isNotEmpty()
            val visible = if (customised) picked.toSet() else available
            val defaultModel = when {
                customised -> picked.first()
                providerDefault != null && providerDefault in available -> providerDefault
                else -> catalog.first()
            }

            fun save(next: Set<String>, nextDefault: String?) {
                if (next.isEmpty()) return
                val head = nextDefault?.takeIf { it in next }
                val rest = catalog.filter { it in next && it != head }
                onSave(listOfNotNull(head) + rest)
            }

            Text(
                if (customised) {
                    res.getString(R.string.pi_models_menu_custom, visible.size, catalog.size)
                } else {
                    res.getString(R.string.pi_models_menu_all, catalog.size)
                },
                color = PlumMuted,
                fontSize = 12.sp,
            )
            if (customised) {
                Text(
                    res.getString(R.string.pi_models_show_all),
                    color = PlumAccent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = !saving) { onSave(emptyList()) }
                        .padding(vertical = 4.dp),
                )
            }

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text(res.getString(R.string.pi_models_search), fontSize = 13.sp) },
                modifier = Modifier.fillMaxWidth(),
            )

            val needle = query.trim().lowercase()
            val groups = catalog
                .filter { needle.isEmpty() || it.lowercase().contains(needle) }
                .groupBy { model -> model.substringBefore('/', "other") }
            if (groups.isEmpty()) {
                Text(res.getString(R.string.pi_models_no_match), color = PlumMuted, fontSize = 12.sp)
            }
            groups.forEach { (providerId, models) ->
                val shown = models.count { it in visible }
                val allShown = shown == models.size
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(providerId, color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text("$shown/${models.size}", color = PlumAccent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    val canToggle = !saving && !(allShown && shown == visible.size)
                    Text(
                        res.getString(if (allShown) R.string.pi_models_group_none else R.string.pi_models_group_all),
                        color = if (canToggle) PlumMuted else PlumMuted.copy(alpha = 0.4f),
                        fontSize = 12.sp,
                        modifier = Modifier
                            .padding(start = 10.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(enabled = canToggle) {
                                val next = visible.toMutableSet()
                                if (allShown) next.removeAll(models.toSet()) else next.addAll(models)
                                save(next, defaultModel.takeIf { it in next })
                            }
                            .padding(horizontal = 6.dp, vertical = 4.dp),
                    )
                }
                models.forEach { model ->
                    val on = model in visible
                    val isDefault = model == defaultModel
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (on) PlumSubtleFill else androidx.compose.ui.graphics.Color.Transparent)
                            .padding(start = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            Modifier
                                .weight(1f)
                                .clickable(
                                    enabled = !saving && !(on && visible.size == 1),
                                    role = Role.Checkbox,
                                ) {
                                    val next = visible.toMutableSet()
                                    if (on) next.remove(model) else next.add(model)
                                    save(next, defaultModel.takeIf { it in next })
                                }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(
                                Modifier
                                    .size(18.dp)
                                    .clip(RoundedCornerShape(5.dp))
                                    .background(if (on) PlumAccent else androidx.compose.ui.graphics.Color.Transparent)
                                    .border(1.dp, if (on) PlumAccent else PlumBorder, RoundedCornerShape(5.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (on) Icon(Icons.Outlined.Check, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(13.dp))
                            }
                            Text(
                                model.substringAfter('/'),
                                color = if (on) PlumText else PlumMuted,
                                fontSize = 13.sp,
                                fontFamily = FontFamily.Monospace,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Box(
                            Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable(enabled = !saving && !isDefault) {
                                    save(visible + model, model)
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                if (isDefault) Icons.Filled.Star else Icons.Outlined.StarBorder,
                                contentDescription = res.getString(
                                    if (isDefault) R.string.pi_models_is_default else R.string.pi_models_make_default,
                                ),
                                tint = if (isDefault) PlumAmber else PlumMuted.copy(alpha = 0.6f),
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
