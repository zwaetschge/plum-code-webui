package com.claudewebui.app.ui.screens.settings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.R
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackground
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumContentWidth
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.theme.AppThemeOption
import com.claudewebui.app.ui.theme.AppThemeStore
import com.claudewebui.app.ui.theme.LocalReduceMotion

/*
 * Building blocks of the settings hierarchy: inset rounded groups of rows with
 * a coloured icon tile, a trailing value and a chevron, plus a small page stack
 * that pushes and pops subpages the way the system settings app does.
 */

/** Colour family of a row's icon tile. Fixed hues so a row is recognisable at a glance. */
enum class TileTone { Accent, Blue, Green, Amber, Orange, Red, Pink, Violet, Indigo, Teal, Gray }

@Composable
private fun tileColor(tone: TileTone): Color {
    val eink = AppThemeStore.theme.collectAsState().value == AppThemeOption.EINK
    if (eink) return PlumText
    return when (tone) {
        TileTone.Accent -> PlumAccent
        TileTone.Blue -> Color(0xFF0A84FF)
        TileTone.Green -> Color(0xFF30B95A)
        TileTone.Amber -> Color(0xFFE5A50A)
        TileTone.Orange -> Color(0xFFF2780C)
        TileTone.Red -> Color(0xFFE5484D)
        TileTone.Pink -> Color(0xFFE3428A)
        TileTone.Violet -> Color(0xFF8E5BD9)
        TileTone.Indigo -> Color(0xFF5B5BD6)
        TileTone.Teal -> Color(0xFF1C9DAF)
        TileTone.Gray -> Color(0xFF7D8590)
    }
}

@Composable
fun SettingsIconTile(icon: ImageVector, tone: TileTone, size: Dp = 30.dp, color: Color? = null) {
    val eink = AppThemeStore.theme.collectAsState().value == AppThemeOption.EINK
    Box(
        Modifier.size(size).background(if (eink || color == null) tileColor(tone) else color, RoundedCornerShape(size * 0.27f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = if (eink) PlumBackground else Color.White, modifier = Modifier.size(size * 0.6f))
    }
}

/** Rows of one inset group; dividers are drawn between them automatically. */
class SettingsGroupScope {
    internal class Entry(val hasIcon: Boolean, val content: @Composable () -> Unit)
    internal val entries = mutableListOf<Entry>()

    /** A row. [hasIcon] decides whether the divider above the next row is inset past the tile. */
    fun item(hasIcon: Boolean = true, content: @Composable () -> Unit) {
        entries += Entry(hasIcon, content)
    }
}

@Composable
fun SettingsGroup(
    header: String? = null,
    footer: String? = null,
    modifier: Modifier = Modifier,
    build: SettingsGroupScope.() -> Unit,
) {
    val scope = SettingsGroupScope().apply(build)
    if (scope.entries.isEmpty() && header == null && footer == null) return
    Column(modifier.fillMaxWidth()) {
        if (header != null) Text(
            header,
            color = PlumMuted,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 7.dp),
        )
        if (scope.entries.isNotEmpty()) GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
            Column(Modifier.fillMaxWidth()) {
                scope.entries.forEachIndexed { index, entry ->
                    entry.content()
                    if (index < scope.entries.lastIndex) {
                        val inset = if (scope.entries[index + 1].hasIcon && entry.hasIcon) 58.dp else 16.dp
                        Box(Modifier.padding(start = inset).fillMaxWidth().height(1.dp).background(PlumBorder.copy(alpha = .6f)))
                    }
                }
            }
        }
        if (footer != null) Text(
            footer,
            color = PlumMuted,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 7.dp),
        )
    }
}

/**
 * One settings row: tile, title with optional subtitle, optional trailing value
 * and a chevron when it opens something. [trailing] replaces value and chevron.
 */
@Composable
fun SettingsRow(
    title: String,
    icon: ImageVector? = null,
    tone: TileTone = TileTone.Gray,
    subtitle: String? = null,
    value: String? = null,
    tileColor: Color? = null,
    enabled: Boolean = true,
    destructive: Boolean = false,
    chevron: Boolean = true,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            SettingsIconTile(icon, if (destructive) TileTone.Red else tone, color = if (destructive) null else tileColor)
            Spacer(Modifier.size(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                color = when {
                    destructive -> PlumRed
                    enabled -> PlumText
                    else -> PlumMuted
                },
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = PlumMuted, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) {
            Spacer(Modifier.size(8.dp))
            trailing()
        } else {
            if (!value.isNullOrBlank()) Text(
                value,
                color = PlumMuted,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 10.dp).widthIn(max = 170.dp),
            )
            if (onClick != null && chevron) Icon(
                Icons.Outlined.ChevronRight, null,
                tint = PlumMuted.copy(alpha = if (enabled) 1f else .5f),
                modifier = Modifier.padding(start = 4.dp).size(20.dp),
            )
        }
    }
}

/** A switch row; the whole row toggles, the switch is only the indicator. */
@Composable
fun SettingsSwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    icon: ImageVector? = null,
    tone: TileTone = TileTone.Gray,
    subtitle: String? = null,
    enabled: Boolean = true,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            SettingsIconTile(icon, tone)
            Spacer(Modifier.size(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, color = if (enabled) PlumText else PlumMuted, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = PlumMuted, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.size(10.dp))
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

/** A row whose value is one of a few options, chosen from an anchored menu. */
@Composable
fun SettingsMenuRow(
    title: String,
    selected: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    icon: ImageVector? = null,
    tone: TileTone = TileTone.Gray,
    enabled: Boolean = true,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        SettingsRow(
            title = title,
            icon = icon,
            tone = tone,
            value = options.firstOrNull { it.first == selected }?.second ?: selected,
            enabled = enabled && options.isNotEmpty(),
            onClick = { open = true },
        )
        DropdownMenu(open, { open = false }) {
            options.forEach { (id, label) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    trailingIcon = if (id == selected) ({ Icon(Icons.Outlined.Check, null, tint = PlumAccent) }) else null,
                    onClick = { open = false; if (id != selected) onSelect(id) },
                )
            }
        }
    }
}

/** A row in a picker page: checkmark on the selected option. */
@Composable
fun SettingsOptionRow(
    title: String,
    selected: Boolean,
    onClick: () -> Unit,
    subtitle: String? = null,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(start = 16.dp, end = if (trailing != null) 4.dp else 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.size(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, color = if (enabled) PlumText else PlumMuted, fontSize = 15.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium)
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = PlumMuted, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
            if (selected) Icon(Icons.Outlined.Check, stringResource(R.string.settings_hub_voice_selected), tint = PlumAccent, modifier = Modifier.size(22.dp))
        }
        trailing?.invoke()
    }
}

/**
 * A text field inside a group. Edits are reported as they happen (the owner
 * saves debounced); [onCommit] fires when focus leaves, so nothing waits on the
 * debounce once the user moves on.
 */
@Composable
fun SettingsTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    onCommit: () -> Unit,
    limit: Int,
    multiline: Boolean = false,
    enabled: Boolean = true,
) {
    var focused by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = { onValueChange(it.take(limit)) },
        label = { Text(label) },
        enabled = enabled,
        singleLine = !multiline,
        minLines = if (multiline) 3 else 1,
        maxLines = if (multiline) 10 else 1,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .onFocusChanged { state ->
                if (focused && !state.isFocused) onCommit()
                focused = state.isFocused
            },
    )
}

/** Inline message inside a group (errors, empty states) with an optional action. */
@Composable
fun SettingsMessage(text: String, error: Boolean = false, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(text, color = if (error) MaterialTheme.colorScheme.error else PlumMuted, fontSize = 13.sp, lineHeight = 18.sp)
        if (actionLabel != null && onAction != null) Text(
            actionLabel,
            color = PlumAccent,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            modifier = Modifier.clickable(role = Role.Button, onClick = onAction).padding(vertical = 6.dp),
        )
    }
}

/**
 * Scaffold of one settings page: back button and large title, then the
 * groups. [onBack] null hides the back button (the root page).
 */
@Composable
fun SettingsPageScaffold(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    subtitle: String? = null,
    actions: @Composable () -> Unit = {},
    content: LazyListScope.() -> Unit,
) {
    // The top inset pads the container so rows scrolling up are cut below the
    // status bar instead of running behind it; the bottom inset stays scrollable
    // so the last group can rise above the floating navigation bar.
    PlumContentWidth(modifier = modifier.fillMaxSize().padding(top = contentPadding.calculateTopPadding()), max = 760.dp) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 4.dp,
                bottom = contentPadding.calculateBottomPadding() + 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            item(key = "page-header") {
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    // The root page has no parent page; it goes back to the work area.
                    val back = onBack ?: com.claudewebui.app.ui.components.common.LocalMainBack.current
                    if (back != null) {
                        PlumIconButton(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.settings_hub_back), back)
                        Spacer(Modifier.size(12.dp))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            title,
                            color = PlumText,
                            style = if (onBack == null) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-0.4).sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (subtitle != null) Text(subtitle, color = PlumMuted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    actions()
                }
            }
            content()
        }
    }
}

/** The page stack entry: the depth tells push from pop. */
private data class StackEntry(val depth: Int, val id: String)

private val PushEasing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
private val PopEasing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)

/**
 * Push/pop navigation between settings pages. A push slides the new page in
 * from the trailing edge over the old one, which drifts back a quarter width;
 * pop reverses it. Instant when motion is reduced. Each page keeps its saved
 * state (scroll position) while it sits below another one.
 */
@Composable
fun SettingsStack(
    stack: List<String>,
    onPop: () -> Unit,
    modifier: Modifier = Modifier,
    page: @Composable (String) -> Unit,
) {
    val reduce = LocalReduceMotion.current
    val holder = rememberSaveableStateHolder()
    BackHandler(enabled = stack.size > 1) { onPop() }
    AnimatedContent(
        targetState = StackEntry(stack.size, stack.lastOrNull().orEmpty()),
        transitionSpec = {
            val push = targetState.depth >= initialState.depth
            if (reduce) {
                EnterTransition.None togetherWith ExitTransition.None
            } else if (push) {
                ContentTransform(
                    slideInHorizontally(tween(380, easing = PushEasing)) { it } + fadeIn(tween(190)),
                    slideOutHorizontally(tween(380, easing = PushEasing)) { -it / 4 } + fadeOut(tween(300)),
                    targetContentZIndex = 1f,
                )
            } else {
                ContentTransform(
                    slideInHorizontally(tween(320, easing = PushEasing)) { -it / 4 } + fadeIn(tween(240)),
                    slideOutHorizontally(tween(280, easing = PopEasing)) { it } + fadeOut(tween(280)),
                    targetContentZIndex = -1f,
                )
            }
        },
        modifier = modifier.fillMaxSize(),
        label = "settings_stack",
    ) { entry ->
        holder.SaveableStateProvider("${entry.depth}:${entry.id}") {
            Box(Modifier.fillMaxSize()) { page(entry.id) }
        }
    }
}

/** Splits/joins the saveable stack string. Page ids never contain '/'. */
internal fun String.toStack(root: String): List<String> = split('/').filter { it.isNotBlank() }.ifEmpty { listOf(root) }
internal fun List<String>.toStackString(): String = joinToString("/")

/** Circular avatar letter for the account card. */
@Composable
internal fun AvatarInitial(text: String, size: Dp = 52.dp) {
    Box(
        Modifier.size(size).background(PlumAccent, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(text.take(1).uppercase().ifBlank { "P" }, color = Color.White, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Bold)
    }
}

/** Column helper so page bodies can add free content between groups. */
@Composable
internal fun SettingsBlock(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}
