package com.claudewebui.wear.ui

import android.net.Uri
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.ExperimentalWearFoundationApi
import androidx.wear.compose.foundation.HierarchicalFocusCoordinator
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.HorizontalPageIndicator
import androidx.wear.compose.material.PageIndicatorState
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.claudewebui.wear.PairingStore
import com.claudewebui.wear.PlumBridge
import com.claudewebui.wear.WearMainActivity

private const val ROUTE_HOME = "home"
private const val ROUTE_USAGE = "usage/{provider}"
private const val ROUTE_SESSION = "session/{sessionId}"
private const val PAGE_COUNT = 3

/**
 * Root of the watch app. Unpaired: the pairing hint over the phone snapshot.
 * Paired: three swipeable pages — „Nutzung“, „Freigaben“, „Sessions“ — with
 * swipe-to-dismiss detail screens for a provider and a session.
 */
@Composable
fun PlumWearApp(
    bridge: PlumBridge,
    requestedPage: Int,
    onPageRequestHandled: () -> Unit,
) {
    val context = LocalContext.current
    val pairing by PairingStore.flow(context).collectAsStateWithLifecycle()

    PlumWearTheme {
        if (pairing == null) {
            UnpairedScreen()
        } else {
            val navController = rememberSwipeDismissableNavController()
            LaunchedEffect(requestedPage) {
                // A tile or complication tap lands on its page, also from a detail screen.
                if (requestedPage >= 0) runCatching { navController.popBackStack(ROUTE_HOME, false) }
            }
            SwipeDismissableNavHost(navController = navController, startDestination = ROUTE_HOME) {
                composable(ROUTE_HOME) {
                    HomePager(
                        bridge = bridge,
                        requestedPage = requestedPage,
                        onPageRequestHandled = onPageRequestHandled,
                        onOpenProvider = { navController.navigate("usage/${Uri.encode(it)}") },
                        onOpenSession = { navController.navigate("session/${Uri.encode(it)}") },
                    )
                }
                composable(ROUTE_USAGE) { entry ->
                    UsageDetailScreen(bridge, entry.arguments?.getString("provider").orEmpty())
                }
                composable(ROUTE_SESSION) { entry ->
                    SessionScreen(bridge, entry.arguments?.getString("sessionId").orEmpty())
                }
            }
        }
    }
}

@OptIn(ExperimentalWearFoundationApi::class)
@Composable
private fun HomePager(
    bridge: PlumBridge,
    requestedPage: Int,
    onPageRequestHandled: () -> Unit,
    onOpenProvider: (String) -> Unit,
    onOpenSession: (String) -> Unit,
) {
    val pagerState = rememberPagerState(pageCount = { PAGE_COUNT })
    val usageList = rememberScalingLazyListState()
    val approvalsList = rememberScalingLazyListState()
    val sessionsList = rememberScalingLazyListState()
    val indicator = remember(pagerState) { PagerIndicatorState(pagerState) }

    LaunchedEffect(requestedPage) {
        if (requestedPage in 0 until PAGE_COUNT) {
            pagerState.scrollToPage(requestedPage)
            onPageRequestHandled()
        }
    }

    val currentList = when (pagerState.currentPage) {
        WearMainActivity.PAGE_USAGE -> usageList
        WearMainActivity.PAGE_APPROVALS -> approvalsList
        else -> sessionsList
    }

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = currentList) },
        pageIndicator = { HorizontalPageIndicator(pageIndicatorState = indicator) },
    ) {
        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
            // Rotary input goes to the list of the page in front only.
            HierarchicalFocusCoordinator(requiresFocus = { pagerState.currentPage == page }) {
                when (page) {
                    WearMainActivity.PAGE_USAGE -> UsagePage(bridge, usageList, onOpenProvider)
                    WearMainActivity.PAGE_APPROVALS -> ApprovalsPage(
                        bridge = bridge,
                        listState = approvalsList,
                        visible = pagerState.currentPage == page,
                    )
                    else -> SessionsPage(
                        bridge = bridge,
                        listState = sessionsList,
                        visible = pagerState.currentPage == page,
                        onOpenSession = onOpenSession,
                    )
                }
            }
        }
    }
}

/** Bridges Compose's pager to the Wear page indicator. */
private class PagerIndicatorState(private val pager: PagerState) : PageIndicatorState {
    override val pageOffset: Float get() = pager.currentPageOffsetFraction
    override val selectedPage: Int get() = pager.currentPage
    override val pageCount: Int get() = pager.pageCount
}
