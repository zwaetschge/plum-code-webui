package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText

/** Pinned to the front without a search; every other preset follows them. */
val CuratedDesignPresets = listOf(
    "design-plum-style",
    "design-minimal",
    "design-shadcn",
    "material-3-design",
    "design-glassmorphism",
    "design-editorial",
    "design-brutalism",
    "design-dashboard",
)

/** Readable preset name: `design-bento-modern` → "Bento Modern". */
fun ConfigSkill.designLabel(): String =
    presetKey.removePrefix("design-").removeSuffix("-design")
        .split('-').filter { it.isNotBlank() }
        .joinToString(" ") { part -> part.replaceFirstChar { it.uppercase() } }

/** Display name of a preset key within a catalogue, or null when unset. */
fun List<ConfigSkill>.presetName(key: String?, design: Boolean = false): String? {
    if (key.isNullOrBlank()) return null
    val item = firstOrNull { it.presetKey == key } ?: return key
    return if (design) item.designLabel() else item.name
}

/**
 * Writing-style preset for the composer `+` in Chat and Task: „Kein Stil"
 * plus the library grouped into prose, author and persona styles.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WritingStyleSheet(
    styles: List<ConfigSkill>,
    selected: String?,
    enabled: Boolean = true,
    onSelect: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val groups = listOf(
        "prose" to stringResource(R.string.preset_style_group_prose),
        "author" to stringResource(R.string.preset_style_group_author),
        "persona" to stringResource(R.string.preset_style_group_persona),
    )
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = PlumSurfaceStrong) {
        LazyColumn(
            Modifier.fillMaxWidth().heightIn(max = 560.dp).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item {
                Text(stringResource(R.string.preset_style_title), color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.preset_style_caption), color = PlumMuted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
            }
            item {
                PresetRow(stringResource(R.string.preset_style_none), null, selected.isNullOrBlank(), enabled) { onSelect(null) }
            }
            groups.forEach { (type, label) ->
                val groupItems = styles.filter { (it.writingStyleType ?: "persona") == type }
                if (groupItems.isNotEmpty()) {
                    item(key = "group-$type") {
                        Text(label, color = PlumMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
                    }
                    items(groupItems, key = { it.id }) { style ->
                        PresetRow(
                            style.name,
                            style.description.takeIf { it.isNotBlank() },
                            style.presetKey == selected,
                            enabled,
                        ) { onSelect(style.presetKey) }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun PresetRow(title: String, subtitle: String?, isSelected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PlumSubtleFill)
            .border(1.dp, if (isSelected) PlumAccent else PlumBorder, RoundedCornerShape(12.dp))
            .heightIn(min = 48.dp)
            .semantics { this.selected = isSelected }
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = PlumText, fontSize = 14.sp, fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, color = PlumMuted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        if (isSelected) Icon(Icons.Outlined.Check, contentDescription = null, tint = PlumAccent, modifier = Modifier.size(18.dp))
    }
}

/**
 * Design-Vorgabe as preview cards: curated presets first, then the full
 * library, plus the search. Opened from ⋯ → Darstellung in Code/Task and
 * from the personalisation default.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DesignPresetSheet(
    styles: List<ConfigSkill>,
    selected: String?,
    enabled: Boolean = true,
    title: String = stringResource(R.string.preset_design_title),
    caption: String = stringResource(R.string.preset_design_caption),
    onSelect: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by rememberSaveable { mutableStateOf("") }
    val needle = query.trim().lowercase()
    val visible = remember(styles, needle, selected) {
        if (needle.isNotEmpty()) {
            styles.filter { style ->
                listOf(style.name, style.presetKey, style.description, style.designLabel(), style.aliases.joinToString(" "))
                    .joinToString(" ").lowercase().contains(needle)
            }
        } else {
            val curated = CuratedDesignPresets.mapNotNull { key -> styles.firstOrNull { it.presetKey == key } }
            val rest = styles.filter { it !in curated }
            val active = styles.firstOrNull { it.presetKey == selected }
            if (active != null && active !in curated) listOf(active) + curated + rest.filter { it != active } else curated + rest
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = PlumSurfaceStrong) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(caption, color = PlumMuted, fontSize = 12.sp)
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text(stringResource(R.string.preset_design_search)) },
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 150.dp),
                modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (needle.isEmpty()) item(key = "none") {
                    val active = selected.isNullOrBlank()
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .aspectRatio(0.95f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (active) PlumAccent.copy(alpha = .12f) else PlumSubtleFill)
                            .border(1.dp, if (active) PlumAccent else PlumBorder, RoundedCornerShape(16.dp))
                            .semantics { this.selected = active }
                            .clickable(enabled = enabled, role = Role.RadioButton) { onSelect(null) }
                            .padding(12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(stringResource(R.string.preset_design_none), color = if (active) PlumText else PlumMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                items(visible, key = { it.id }) { style ->
                    DesignPresetCard(style, style.presetKey == selected, enabled) {
                        onSelect(if (style.presetKey == selected) null else style.presetKey)
                    }
                }
                if (needle.isNotEmpty() && visible.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(stringResource(R.string.preset_design_empty), color = PlumMuted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 24.dp))
                }
            }
        }
    }
}

@Composable
private fun DesignPresetCard(style: ConfigSkill, isSelected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (isSelected) PlumAccent.copy(alpha = .12f) else PlumSubtleFill)
            .border(if (isSelected) 2.dp else 1.dp, if (isSelected) PlumAccent else PlumBorder, RoundedCornerShape(16.dp))
            .semantics { this.selected = isSelected }
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(style.designLabel(), color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (isSelected) Icon(Icons.Outlined.Check, contentDescription = null, tint = PlumAccent, modifier = Modifier.size(16.dp))
        }
        DesignPreview(style)
        Text(style.description.ifBlank { style.presetKey }, color = PlumMuted, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 13.sp)
    }
}

private fun parseHex(value: String?): Color? {
    val hex = value?.trim()?.removePrefix("#") ?: return null
    val full = when (hex.length) {
        3 -> hex.map { "$it$it" }.joinToString("")
        6 -> hex
        else -> return null
    }
    return full.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
}

private val FallbackPalettes = listOf(
    listOf(0xFF6D3A78, 0xFFA76BB1, 0xFFFFFFFF, 0xFF18181B),
    listOf(0xFF0F766E, 0xFF5EEAD4, 0xFFF0FDFA, 0xFF042F2E),
    listOf(0xFF1D4ED8, 0xFF93C5FD, 0xFFF8FAFC, 0xFF0F172A),
    listOf(0xFFB45309, 0xFFFCD34D, 0xFFFFFBEB, 0xFF1C1917),
)

/** Miniature screen in the preset's DESIGN.md colours: header, copy lines, button, swatches. */
@Composable
private fun DesignPreview(style: ConfigSkill) {
    val colors = style.designMd?.tokens?.colors.orEmpty()
    val fallback = FallbackPalettes[(style.presetKey.hashCode() and Int.MAX_VALUE) % FallbackPalettes.size].map { Color(it) }
    fun pick(vararg names: String, index: Int): Color =
        names.firstNotNullOfOrNull { parseHex(colors[it]) } ?: fallback[index]
    val primary = pick("primary", "accent", index = 0)
    val secondary = pick("secondary", "tertiary", "accent", index = 1)
    val surface = pick("surface", "background", "neutral", index = 2)
    val text = pick("text", "on-surface", "foreground", index = 3)
    val swatches = colors.values.mapNotNull(::parseHex).take(4).ifEmpty { fallback }
    Column(
        Modifier
            .fillMaxWidth()
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(10.dp))
            .background(surface)
            .border(1.dp, text.copy(alpha = .12f), RoundedCornerShape(10.dp)),
    ) {
        Box(Modifier.fillMaxWidth().height(14.dp).background(primary))
        Column(Modifier.fillMaxWidth().weight(1f).padding(8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.fillMaxWidth(.7f).height(7.dp).clip(RoundedCornerShape(3.dp)).background(text.copy(alpha = .82f)))
            Box(Modifier.fillMaxWidth(.9f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(text.copy(alpha = .3f)))
            Box(Modifier.fillMaxWidth(.6f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(text.copy(alpha = .3f)))
            Spacer(Modifier.weight(1f))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.width(34.dp).height(12.dp).clip(CircleShape).background(primary))
                Box(Modifier.width(24.dp).height(12.dp).clip(CircleShape).background(secondary.copy(alpha = .55f)))
                Spacer(Modifier.weight(1f))
                swatches.forEach { swatch ->
                    Box(Modifier.size(9.dp).clip(CircleShape).background(swatch).border(0.5.dp, text.copy(alpha = .2f), CircleShape))
                }
            }
        }
    }
}
