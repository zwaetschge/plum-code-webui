package com.claudewebui.wear

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableIntStateOf
import androidx.lifecycle.lifecycleScope
import com.claudewebui.wear.ui.PlumWearApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Watch app: usage rings with forecast, open approvals and questions with
 * answer buttons, recent sessions with a voice or quick reply — live over the
 * watch's own bridge connection while visible. Not paired yet, it shows the
 * pairing hint over the phone snapshot as before.
 */
class WearMainActivity : ComponentActivity() {

    private val requestedPage = mutableIntStateOf(-1)
    private lateinit var bridge: PlumBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bridge = PlumBridge.get(this)
        if (savedInstanceState == null) requestedPage.intValue = intent.getIntExtra(EXTRA_PAGE, -1)
        // The listener only hears pairing changes; an app installed after
        // pairing picks the DataItem up here.
        lifecycleScope.launch(Dispatchers.IO) {
            if (PairingStore.syncFromDataLayer(applicationContext)) {
                RefreshWorker.schedule(applicationContext)
            }
        }
        setContent {
            PlumWearApp(
                bridge = bridge,
                requestedPage = requestedPage.intValue,
                onPageRequestHandled = { requestedPage.intValue = -1 },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        requestedPage.intValue = intent.getIntExtra(EXTRA_PAGE, -1)
    }

    override fun onStart() {
        super.onStart()
        bridge.start()
    }

    override fun onStop() {
        bridge.stop()
        super.onStop()
    }

    companion object {
        const val EXTRA_PAGE = "page"
        const val PAGE_USAGE = 0
        const val PAGE_APPROVALS = 1
        const val PAGE_SESSIONS = 2
    }
}
