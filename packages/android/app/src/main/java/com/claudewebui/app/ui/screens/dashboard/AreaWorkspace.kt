package com.claudewebui.app.ui.screens.dashboard

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuOpen
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.app.R
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.motion.PlumMotionTokens
import com.claudewebui.app.ui.motion.plumSwitchTransform
import com.claudewebui.app.ui.screens.chat.ChatScreen
import com.claudewebui.app.ui.theme.LocalReduceMotion
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.koin.compose.viewmodel.koinViewModel

/**
 * Area, per-area selection and overlays of the Chat · Task · Code · Schwarm
 * workspace. One instance is shared by the phone layout and the two-column
 * layout, so folding or unfolding keeps the area and what was open in it.
 *
 * Selections are per area: Chat → a model-chat id, Task/Code → a CLI session
 * id. The right column never shows another area's item.
 */
@Stable
class AreaWorkspaceState internal constructor(
    area: String,
    selections: Map<String, String>,
    settled: Collection<String>,
    listVisible: Boolean,
    showPersonalization: Boolean,
    workspacePath: String?,
    messageSessionId: String?,
    messageId: String?,
    messageChatId: String?,
) {
    var area by mutableStateOf(area)
    var listVisible by mutableStateOf(listVisible)
    var showPersonalization by mutableStateOf(showPersonalization)
    var workspacePath by mutableStateOf(workspacePath)

    private val selected = mutableStateMapOf<String, String>().apply { putAll(selections) }

    /** Areas whose selection was already decided (by the user or one auto-open). */
    private val settledAreas = mutableStateListOf<String>().apply { addAll(settled) }

    /** A search hit to jump to once the selected session opens. */
    var messageSessionId by mutableStateOf(messageSessionId)
        private set
    var messageId by mutableStateOf(messageId)
        private set
    var messageChatId by mutableStateOf(messageChatId)
        private set

    fun selection(area: String): String? = selected[area]

    fun isSettled(area: String): Boolean = area in settledAreas

    fun markSettled(area: String) { if (area !in settledAreas) settledAreas.add(area) }

    fun select(area: String, id: String?, messageId: String? = null, chatId: String? = null) {
        if (id == null) selected.remove(area) else selected[area] = id
        markSettled(area)
        messageSessionId = if (messageId != null) id else null
        this.messageId = messageId
        messageChatId = if (messageId != null) chatId else null
    }

    /** Forgets the area's open item without counting as a decision (phone area switch). */
    fun clearSelection(area: String) { selected.remove(area) }

    /** Closes [id] wherever it is selected (Back from a full-screen detail). */
    fun deselect(id: String) {
        selected.entries.filter { it.value == id }.map { it.key }.forEach { select(it, null) }
    }

    fun selectArea(next: String) {
        area = next
        showPersonalization = false
        workspacePath = null
    }

    companion object {
        val Saver: Saver<AreaWorkspaceState, Any> = listSaver(
            save = { state ->
                listOf(
                    state.area,
                    ArrayList(state.selected.flatMap { listOf(it.key, it.value) }),
                    ArrayList(state.settledAreas.toList()),
                    state.listVisible,
                    state.showPersonalization,
                    state.workspacePath,
                    state.messageSessionId,
                    state.messageId,
                    state.messageChatId,
                )
            },
            restore = { saved ->
                val flat = (saved[1] as List<*>).map { it as String }
                AreaWorkspaceState(
                    area = saved[0] as String,
                    selections = flat.chunked(2).filter { it.size == 2 }.associate { it[0] to it[1] },
                    settled = (saved[2] as List<*>).map { it as String },
                    listVisible = saved[3] as Boolean,
                    showPersonalization = saved[4] as Boolean,
                    workspacePath = saved[5] as String?,
                    messageSessionId = saved[6] as String?,
                    messageId = saved[7] as String?,
                    messageChatId = saved[8] as String?,
                )
            },
        )
    }
}

@Composable
fun rememberAreaWorkspaceState(): AreaWorkspaceState = rememberSaveable(saver = AreaWorkspaceState.Saver) {
    AreaWorkspaceState("chat", emptyMap(), emptyList(), true, false, null, null, null, null)
}

/** Last opened item per area, so the two-column layout can reopen it once. */
private object AreaLastOpened {
    private const val PREFS = "area_workspace"
    fun get(context: Context, area: String): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("last_$area", null)
    fun set(context: Context, area: String, id: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("last_$area", id).apply()
    }
}

/**
 * A CLI session that should open inside the workspace. The standalone chat
 * route hands over through here when the window is wide (unfolding while a
 * session is open full-screen, or a deep link on a tablet).
 */
object AreaWorkspaceHandoff {
    data class Request(val sessionId: String, val messageId: String?, val chatId: String?)

    private val _pending = MutableStateFlow<Request?>(null)
    val pending: StateFlow<Request?> = _pending.asStateFlow()

    fun open(sessionId: String, messageId: String? = null, chatId: String? = null) {
        _pending.value = Request(sessionId, messageId, chatId)
    }

    fun clear() { _pending.value = null }
}

/** What the right column (or full-width pane) shows. */
private data class PaneKey(val area: String, val id: String?)

/**
 * The Chat · Task · Code · Schwarm workspace for every window size.
 *
 * Compact windows keep the phone flow: area selector on top, one column, list
 * → detail. Expanded windows (unfolded Fold, tablets) show the selected area's
 * list on the left and exactly one item of that area on the right; Schwarm
 * uses the full width.
 *
 * Fold changes do not hard-switch: a violet seam lights up along the hinge,
 * the list column unfolds out of it like a book page, and the open item glides
 * into the right column. The item is a movable content, so it keeps its state
 * (scroll position, composer text) across the layout change.
 */
@Composable
fun AreaWorkspace(
    expanded: Boolean,
    onNavigateToSettings: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit,
    onNavigateToFiles: (String, String) -> Unit,
    onNavigateToGit: (String) -> Unit,
    onNavigateToCheckpoints: (String) -> Unit,
    onNavigateToNotes: (String) -> Unit,
    onNavigateToMemory: (String) -> Unit,
    onNavigateToDevTools: (String, String) -> Unit,
    viewModel: DashboardViewModel = koinViewModel(),
) {
    val context = LocalContext.current
    val ws = rememberAreaWorkspaceState()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val reduce = LocalReduceMotion.current
    val area = ws.area

    fun openSession(sessionId: String, messageId: String? = null, chatId: String? = null) {
        val surface = state.sessions.firstOrNull { it.id == sessionId }?.surface
        val target: String = when {
            surface == "task" -> "task"
            surface == "code" -> "code"
            ws.area == "task" -> "task"
            else -> "code"
        }
        if (ws.area != target || ws.showPersonalization || ws.workspacePath != null) ws.selectArea(target)
        ws.select(target, sessionId, messageId, chatId)
        AreaLastOpened.set(context, target, sessionId)
    }

    fun openChat(chatId: String?) {
        ws.select("chat", chatId)
        if (chatId != null) AreaLastOpened.set(context, "chat", chatId)
    }

    // ---- Hand-over from the standalone chat route ----
    val handoff by AreaWorkspaceHandoff.pending.collectAsState()
    LaunchedEffect(handoff, state.sessions, state.isInitialLoading) {
        val request = handoff ?: return@LaunchedEffect
        // Wait for the session list so the session lands in its own area.
        if (state.isInitialLoading && state.sessions.none { it.id == request.sessionId }) return@LaunchedEffect
        AreaWorkspaceHandoff.clear()
        openSession(request.sessionId, request.messageId, request.chatId)
    }

    // ---- Auto-open: the last opened item of an area, once, two columns only ----
    LaunchedEffect(expanded, area, state.sessions) {
        if (!expanded || area == "swarm" || ws.isSettled(area) || ws.selection(area) != null) return@LaunchedEffect
        if (area == "chat") {
            ws.markSettled("chat")
            AreaLastOpened.get(context, "chat")?.let { ws.select("chat", it) }
        } else {
            if (state.sessions.isEmpty()) return@LaunchedEffect
            ws.markSettled(area)
            val last = AreaLastOpened.get(context, area)
            if (last != null && state.sessions.any { it.id == last && it.surface == area }) ws.select(area, last)
        }
    }

    // ---- Movable contents: one instance each, moved between layouts ----
    val modelChat = remember {
        movableContentOf { topInset: Dp, historyOpen: Boolean, onHistoryDismiss: () -> Unit ->
            AssistantModelChat(
                topInset = topInset,
                historyOpen = historyOpen,
                onHistoryDismiss = onHistoryDismiss,
                onAreaSelect = { ws.selectArea(it) },
                onAgentChats = {},
                selectedChatId = ws.selection("chat"),
                onChatSelected = { openChat(it) },
            )
        }
    }
    // Access-ordered, so an item that is on screen is never the eldest entry.
    val cliDetails = remember {
        object : LinkedHashMap<String, @Composable (Boolean) -> Unit>(16, .75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, @Composable (Boolean) -> Unit>?) = size > 12
        }
    }
    fun cliDetail(sessionId: String): @Composable (Boolean) -> Unit = cliDetails.getOrPut(sessionId) {
        movableContentOf { inSplit: Boolean ->
            val resources = LocalContext.current.resources
            ChatScreen(
                sessionId = sessionId,
                showBackButton = true,
                // Two columns: the leading button collapses the list (focus
                // mode) and brings it back. Full-screen: a plain back arrow.
                navigationIcon = if (!inSplit) null else if (ws.listVisible) Icons.AutoMirrored.Outlined.MenuOpen else Icons.Outlined.Menu,
                navigationLabel = if (!inSplit) null else resources.getString(
                    if (ws.listVisible) R.string.workspace_hide_list else R.string.workspace_show_list,
                ),
                initialMessageId = if (ws.messageSessionId == sessionId) ws.messageId else null,
                initialChatId = if (ws.messageSessionId == sessionId) ws.messageChatId else null,
                onNavigateBack = { if (inSplit) ws.listVisible = !ws.listVisible else ws.deselect(sessionId) },
                onNavigateToFiles = { directory -> onNavigateToFiles(sessionId, directory) },
                onNavigateToGit = { onNavigateToGit(sessionId) },
                onNavigateToCheckpoints = onNavigateToCheckpoints,
                onNavigateToNotes = onNavigateToNotes,
                onNavigateToMemory = onNavigateToMemory,
                onNavigateToDevTools = { directory -> onNavigateToDevTools(sessionId, directory) },
            )
        }
    }

    val fullWidth = area == "swarm" || ws.showPersonalization || ws.workspacePath != null
    val selectionHere = if (area == "task" || area == "code") ws.selection(area) else null
    // The list column is shown in two-column windows, except in focus mode —
    // and never hidden while Task/Code has nothing open, or the right column
    // would offer nothing to go back to.
    val listTarget = expanded && !fullWidth && (ws.listVisible || (area != "chat" && selectionHere == null))

    // ---- Seam choreography ----
    val presence = remember { Animatable(if (listTarget) 1f else 0f) }
    val seamGlow = remember { Animatable(0f) }
    val seamLength = remember { Animatable(0f) }
    // Separate effects: a selection change during the fold choreography may
    // restart the list animation, but must never cut the seam off mid-glow.
    var seamExpanded by remember { mutableStateOf(expanded) }
    LaunchedEffect(expanded) {
        if (expanded == seamExpanded) return@LaunchedEffect
        seamExpanded = expanded
        if (reduce) return@LaunchedEffect
        // 0–180 ms: the seam grows from the middle up and down; it then glows
        // on and fades into the divider by ~650 ms.
        seamLength.snapTo(0f)
        seamGlow.snapTo(1f)
        seamLength.animateTo(1f, tween(180, easing = PlumMotionTokens.EnterEasing))
        delay(300)
        seamGlow.animateTo(0f, tween(PlumMotionTokens.EXIT_MS, easing = PlumMotionTokens.ExitEasing))
    }
    var listExpanded by remember { mutableStateOf(expanded) }
    LaunchedEffect(listTarget, expanded, reduce) {
        val target = if (listTarget) 1f else 0f
        val foldChange = expanded != listExpanded
        listExpanded = expanded
        if (reduce) {
            presence.snapTo(target); seamGlow.snapTo(0f); seamLength.snapTo(0f)
            return@LaunchedEffect
        }
        // On a fold change the list starts 80 ms after the seam, then unfolds
        // (or folds back) with the menu spring.
        if (foldChange) delay(80)
        presence.animateTo(target, PlumMotionTokens.menuSpring())
    }
    val listComposed by remember { derivedStateOf { presence.value > 0.001f } }
    val seamComposed by remember { derivedStateOf { seamGlow.value > 0.001f } }
    // Stays in the split arrangement until the list has folded away and the
    // seam has faded, then hands over to the phone layout.
    val splitLayout = expanded || listComposed || seamComposed

    val selectArea: (String) -> Unit = { next -> viewModel.clearSelection(); ws.selectArea(next) }

    // ---- Left column: area selector + the list of the selected area ----
    val listColumn = remember {
        movableContentOf {
            val slideIn = with(LocalDensity.current) { 48.dp.roundToPx() }
            val slideOut = with(LocalDensity.current) { 36.dp.roundToPx() }
            val reduceList = LocalReduceMotion.current
            val columnArea = ws.area
            Column(Modifier.fillMaxSize().statusBarsPadding()) {
                Box(Modifier.padding(top = 8.dp, start = 10.dp, end = 10.dp)) {
                    PlumAreaSelector(
                        columnArea, selectArea,
                        onPersonalize = if (columnArea == "task" || columnArea == "code") ({ ws.showPersonalization = true }) else null,
                        trailingIcon = if (columnArea == "chat") Icons.AutoMirrored.Outlined.MenuOpen else null,
                        trailingLabel = if (columnArea == "chat") stringResource(R.string.workspace_hide_list) else null,
                        onTrailing = if (columnArea == "chat") ({ ws.listVisible = false }) else null,
                    )
                }
                AnimatedContent(
                    targetState = columnArea,
                    transitionSpec = { areaSwitchTransform(areaIndex(initialState), areaIndex(targetState), reduceList, slideIn, slideOut) },
                    modifier = Modifier.fillMaxSize(),
                    label = "workspace_list_area",
                ) { listArea ->
                    when (listArea) {
                        "chat" -> ModelChatHistoryList(
                            selectedChatId = ws.selection("chat"),
                            onSelect = { openChat(it.id) },
                            onNewChat = { openChat(null) },
                            modifier = Modifier.fillMaxSize().padding(start = 10.dp, end = 10.dp, top = 8.dp),
                            listModifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(bottom = 24.dp),
                        )
                        "task", "code" -> DashboardListScreen(
                            onNavigateToChat = { openSession(it) },
                            onNavigateToMessage = { sessionId, messageId, chatId -> openSession(sessionId, messageId, chatId) },
                            onNavigateToSettings = onNavigateToSettings,
                            onNavigateMain = onNavigateMain,
                            viewModel = viewModel,
                            embedded = true,
                            selectedSessionId = ws.selection(listArea),
                            assistantArea = listArea,
                            selectArea = selectArea,
                            onPersonalize = { ws.showPersonalization = true },
                            onModelChat = { selectArea("chat") },
                            topInset = 0.dp,
                        )
                        else -> Box(Modifier.fillMaxSize())
                    }
                }
            }
        }
    }

    // ---- Right column / full-width pane ----
    @Composable
    fun Pane(key: PaneKey) {
        val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
        when {
            key.area == "personalization" -> AssistantPersonalizationScreen(
                onClose = { ws.showPersonalization = false },
                onOpenFeature = { ws.showPersonalization = false; ws.workspacePath = it },
            )
            key.area.startsWith("web:") -> AssistantWebWorkspace(
                path = key.area.removePrefix("web:"), area = ws.area, onAreaSelect = selectArea,
                onClose = { ws.workspacePath = null; ws.area = "code" },
                onPersonalize = { ws.showPersonalization = true },
                onNavigateToChat = { openSession(it) },
                onNativeChat = { ws.workspacePath = null; ws.area = "chat" },
            )
            key.area == "swarm" -> SwarmPane(selectArea)
            key.area == "chat" -> Box(Modifier.fillMaxSize()) {
                // Focus mode: a slim top band carries the button that brings
                // the conversation list back.
                modelChat(statusTop + if (ws.listVisible) 8.dp else 52.dp, false) {}
                if (!ws.listVisible) Box(Modifier.statusBarsPadding().padding(start = 8.dp, top = 4.dp)) {
                    PlumIconButton(
                        Icons.Outlined.Menu,
                        stringResource(R.string.workspace_show_list),
                        onClick = { ws.listVisible = true },
                        tint = PlumText,
                    )
                }
            }
            key.id != null -> cliDetail(key.id)(true)
            else -> AreaStartState(
                area = key.area,
                latest = state.sessions.filter { it.surface == key.area }.maxByOrNull { it.updatedAt },
                onNew = { viewModel.requestNewSession() },
                onContinue = { openSession(it) },
            )
        }
    }

    PlumBackdrop {
        if (splitLayout) {
            var rootX by remember { mutableFloatStateOf(0f) }
            var rootWidth by remember { mutableIntStateOf(0) }
            var dividerX by remember { mutableFloatStateOf(-1f) }
            Box(
                Modifier.fillMaxSize().onGloballyPositioned {
                    rootX = it.positionInWindow().x
                    rootWidth = it.size.width
                },
            ) {
                val split: @Composable () -> Unit = {
                    SplitPane(
                        presence = { presence.value },
                        listTarget = listTarget,
                        listComposed = listComposed || listTarget,
                        onDivider = { dividerX = it - rootX },
                        list = { listColumn() },
                        detail = {
                            val paneKey = when {
                                ws.showPersonalization -> PaneKey("personalization", null)
                                ws.workspacePath != null -> PaneKey("web:${ws.workspacePath}", null)
                                else -> PaneKey(area, selectionHere)
                            }
                            val density = LocalDensity.current
                            val slideIn = with(density) { 48.dp.roundToPx() }
                            val slideOut = with(density) { 36.dp.roundToPx() }
                            val rise = with(density) { 16.dp.roundToPx() }
                            val exit = with(density) { 8.dp.roundToPx() }
                            AnimatedContent(
                                targetState = paneKey,
                                transitionSpec = {
                                    if (initialState.area == targetState.area) plumSwitchTransform(reduce, rise, exit)
                                    else areaSwitchTransform(areaIndex(initialState.area), areaIndex(targetState.area), reduce, slideIn, slideOut)
                                },
                                modifier = Modifier.fillMaxSize(),
                                label = "workspace_pane",
                            ) { key -> Pane(key) }
                        },
                    )
                }
                // The rail belongs to the wide window only; while the list
                // folds back on the narrow screen there is no room for it.
                if (expanded) {
                    PlumNavScaffold(
                        selected = MainDestination.SESSIONS,
                        onNavigate = onNavigateMain,
                        badgeCount = state.attentionCount,
                    ) { _ -> split() }
                } else split()
                if (seamComposed) FoldSeam(
                    hingeX = { rootWidth / 2f },
                    dividerX = { dividerX },
                    presence = { presence.value },
                    glow = { seamGlow.value },
                    length = { seamLength.value },
                )
            }
        } else {
            CompactWorkspace(
                ws = ws,
                selectionHere = selectionHere,
                reduce = reduce,
                viewModel = viewModel,
                modelChat = modelChat,
                cliDetail = { cliDetail(it) },
                onOpenSession = { sessionId, messageId, chatId -> openSession(sessionId, messageId, chatId) },
                onNavigateToSettings = onNavigateToSettings,
                onNavigateMain = onNavigateMain,
            )
        }
    }
}

/**
 * Phone flow: the area dashboard, and a CLI session pushed over it full-screen.
 * Back returns to the area's list.
 */
@Composable
private fun CompactWorkspace(
    ws: AreaWorkspaceState,
    selectionHere: String?,
    reduce: Boolean,
    viewModel: DashboardViewModel,
    modelChat: @Composable (Dp, Boolean, () -> Unit) -> Unit,
    cliDetail: (String) -> @Composable (Boolean) -> Unit,
    onOpenSession: (String, String?, String?) -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit,
) {
    BackHandler(enabled = selectionHere != null) { ws.select(ws.area, null) }
    AnimatedContent(
        targetState = selectionHere,
        transitionSpec = {
            if (reduce) {
                EnterTransition.None togetherWith ExitTransition.None
            } else if (targetState != null && initialState == null) {
                (slideInHorizontally(tween(PlumMotionTokens.SWITCH_IN_MS, easing = PlumMotionTokens.EnterEasing)) { it } +
                    fadeIn(tween(PlumMotionTokens.SWITCH_IN_MS / 2))) togetherWith
                    (slideOutHorizontally(tween(PlumMotionTokens.SWITCH_IN_MS, easing = PlumMotionTokens.ExitEasing)) { -it / 4 } +
                        fadeOut(tween(PlumMotionTokens.SWITCH_IN_MS)))
            } else if (targetState == null) {
                (slideInHorizontally(tween(PlumMotionTokens.SWITCH_IN_MS, easing = PlumMotionTokens.EnterEasing)) { -it / 4 } +
                    fadeIn(tween(PlumMotionTokens.SWITCH_IN_MS / 2))) togetherWith
                    (slideOutHorizontally(tween(PlumMotionTokens.SWITCH_IN_MS, easing = PlumMotionTokens.ExitEasing)) { it } +
                        fadeOut(tween(PlumMotionTokens.SWITCH_IN_MS)))
            } else {
                fadeIn(tween(240)) togetherWith fadeOut(tween(240))
            }
        },
        modifier = Modifier.fillMaxSize(),
        label = "workspace_compact",
    ) { sessionId ->
        if (sessionId == null) {
            DashboardScreen(
                onNavigateToChat = { onOpenSession(it, null, null) },
                onNavigateToMessage = { s, m, c -> onOpenSession(s, m, c) },
                onNavigateToSettings = onNavigateToSettings,
                onNavigateMain = onNavigateMain,
                viewModel = viewModel,
                workspace = ws,
                modelChat = modelChat,
            )
        } else {
            cliDetail(sessionId)(false)
        }
    }
}

/**
 * Two columns: the list on the left, the item on the right. Only transforms
 * and alpha animate: the list turns in like a book page around its right edge
 * while the item, already laid out in its final column, glides into place.
 */
@Composable
private fun SplitPane(
    presence: () -> Float,
    listTarget: Boolean,
    listComposed: Boolean,
    onDivider: (Float) -> Unit,
    list: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    val configuration = androidx.compose.ui.platform.LocalConfiguration.current
    val listWidth = (configuration.screenWidthDp * .34f).coerceIn(264f, 320f).dp
    val density = LocalDensity.current
    val listPx = with(density) { listWidth.toPx() }
    val background = com.claudewebui.app.ui.theme.PlumTheme.palette.background
    Box(Modifier.fillMaxSize()) {
        val target = if (listTarget) 1f else 0f
        Box(
            Modifier.fillMaxSize()
                .padding(start = if (listTarget) listWidth else 0.dp)
                .graphicsLayer { translationX = (presence() - target) * listPx },
        ) { detail() }
        if (listComposed) Box(
            Modifier.width(listWidth).fillMaxHeight().zIndex(1f)
                .onGloballyPositioned { onDivider(it.positionInWindow().x + it.size.width) }
                .graphicsLayer {
                    val p = presence()
                    alpha = p.coerceIn(0f, 1f)
                    rotationY = -18f * (1f - p)
                    transformOrigin = TransformOrigin(1f, .5f)
                    cameraDistance = 14f * this.density
                }
                // Covers the item gliding underneath while the page turns;
                // invisible at rest so the column keeps the shared backdrop.
                .drawBehind {
                    val p = presence().coerceIn(0f, 1f)
                    val cover = (4f * p * (1f - p)).coerceIn(0f, 1f) * .9f
                    if (cover > 0.01f) drawRect(background.copy(alpha = cover))
                },
        ) {
            list()
            VerticalDivider(Modifier.align(Alignment.CenterEnd).fillMaxHeight(), color = PlumBorder)
        }
    }
}

/**
 * The light seam along the hinge: grows from the middle up and down, travels
 * to the column edge as the list unfolds and fades into the divider there.
 */
@Composable
private fun FoldSeam(
    hingeX: () -> Float,
    dividerX: () -> Float,
    presence: () -> Float,
    glow: () -> Float,
    length: () -> Float,
) {
    val accent = PlumAccent
    Box(
        Modifier.fillMaxHeight().width(14.dp).zIndex(2f)
            .graphicsLayer {
                val p = presence().coerceIn(0f, 1f)
                val divider = dividerX()
                val hinge = hingeX()
                val x = if (divider > 0f) hinge + (divider - hinge) * p else hinge
                translationX = x - 7.dp.toPx()
                scaleY = length()
                alpha = glow()
            }
            .drawBehind {
                drawRect(
                    Brush.horizontalGradient(listOf(Color.Transparent, accent.copy(alpha = .38f), Color.Transparent)),
                )
                val core = 2.dp.toPx()
                drawRect(
                    Brush.verticalGradient(listOf(Color.Transparent, accent, accent, Color.Transparent)),
                    topLeft = Offset((size.width - core) / 2f, 0f),
                    size = Size(core, size.height),
                )
            },
    )
}

/** Schwarm at full width, with the area selector floating on top. */
@Composable
private fun SwarmPane(selectArea: (String) -> Unit) {
    var headerPx by remember { mutableIntStateOf(0) }
    var emergency by remember { mutableStateOf(false) }
    val topInset = with(LocalDensity.current) { headerPx.toDp() }
    Box(Modifier.fillMaxSize()) {
        AssistantSwarmScreen(topInset = topInset, emergencyOpen = emergency, onEmergencyDismiss = { emergency = false }, onAreaSelect = selectArea)
        Box(
            Modifier.align(Alignment.TopCenter).widthIn(max = 640.dp).onSizeChanged { headerPx = it.height }
                .statusBarsPadding().padding(top = 12.dp, start = 16.dp, end = 16.dp),
        ) {
            PlumAreaSelector(
                "swarm", selectArea,
                trailingIcon = Icons.Outlined.Shield,
                trailingLabel = stringResource(R.string.assistant_emergency),
                onTrailing = { emergency = true },
            )
        }
    }
}

/** Task/Code with nothing open: start something new or continue the last one. */
@Composable
private fun AreaStartState(area: String, latest: Session?, onNew: () -> Unit, onContinue: (String) -> Unit) {
    val task = area == "task"
    Column(
        Modifier.fillMaxSize().statusBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(if (task) Icons.Outlined.TaskAlt else Icons.Outlined.Terminal, null, tint = PlumAccent, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(14.dp))
        Text(
            stringResource(if (task) R.string.workspace_task_start_title else R.string.workspace_code_start_title),
            style = MaterialTheme.typography.titleLarge, color = PlumText, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            stringResource(if (task) R.string.workspace_task_start_hint else R.string.workspace_code_start_hint),
            style = MaterialTheme.typography.bodyMedium, color = PlumMuted, textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 360.dp),
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onNew) {
            Icon(Icons.Outlined.Add, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(if (task) R.string.workspace_new_task else R.string.dashboard_new_session_5c881))
        }
        latest?.let { session ->
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { onContinue(session.id) }) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(if (task) R.string.workspace_continue_task else R.string.continue_latest))
                    Text(
                        session.name, color = PlumMuted, style = MaterialTheme.typography.labelSmall,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 280.dp),
                    )
                }
            }
        }
    }
}
