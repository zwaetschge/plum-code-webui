package com.claudewebui.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.util.Log
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.claudewebui.app.core.notifications.LocalNotificationManager
import com.claudewebui.app.core.diagnostics.Breadcrumbs
import com.claudewebui.app.core.diagnostics.CrashReporter
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.core.security.SessionRenewal
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.widget.WidgetHub
import com.claudewebui.app.widget.WidgetRefreshWorker
import com.claudewebui.app.di.appModule
import com.claudewebui.app.di.databaseModule
import com.claudewebui.app.di.networkModule
import com.claudewebui.app.di.viewModelModule
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin
import org.koin.core.logger.Level
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class ClaudeWebUIApp : Application(), SingletonImageLoader.Factory {

    private companion object {
        const val TAG = "ClaudeWebUIApp"
    }

    /** Outlives every screen; used for the token renewal check on foreground. */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * App-wide Coil loader: chat media hangs off an authenticated route, so
     * every image request carries the Bearer token.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(
                    OkHttpNetworkFetcherFactory(
                        callFactory = {
                            okhttp3.OkHttpClient.Builder()
                                .addInterceptor { chain ->
                                    val token = TokenStore.getToken()
                                    val request = if (token != null) {
                                        chain.request().newBuilder()
                                            .addHeader("Authorization", "Bearer $token")
                                            .build()
                                    } else {
                                        chain.request()
                                    }
                                    chain.proceed(request)
                                }
                                .build()
                        }
                    )
                )
            }
            .build()

    override fun onCreate() {
        super.onCreate()

        // Before anything else, so a crash during the rest of startup is still
        // caught and reported on the next launch.
        CrashReporter.install(this)
        Breadcrumbs.add("lifecycle", "Application.onCreate")

        // Initialize secure token storage before anything else
        TokenStore.init(this)
        if (TokenStore.wasResetOnStartup) Breadcrumbs.add("security", "TokenStore reset on startup")
        if (TokenStore.isEmergencyMode) Breadcrumbs.add("security", "TokenStore in emergency mode")

        val koin = startKoin {
            androidLogger(Level.ERROR)
            androidContext(this@ClaudeWebUIApp)
            modules(appModule, networkModule, databaseModule, viewModelModule)
        }.koin

        // Keeps home-screen widgets AND the Wear companion fed. Not gated on
        // widgets existing: the watch tile/complication read the same snapshot,
        // so a widget-less phone with a paired watch still needs the refresh.
        //
        // Off the main thread: WorkManager.getInstance() opens its own Room
        // database and reads the work spec table on first use, which is
        // measurable cold-start time for something nobody sees for another
        // few seconds. Enqueueing is idempotent (KEEP / REPLACE), so ordering
        // against the rest of onCreate does not matter.
        appScope.launch {
            runCatching {
                WidgetRefreshWorker.ensurePeriodic(this@ClaudeWebUIApp)
                WidgetRefreshWorker.refreshNow(this@ClaudeWebUIApp)
            }.onFailure { Log.w(TAG, "Widget refresh scheduling failed", it) }
        }

        // Wire background notifications to the live socket. Without this the
        // manager never observes anything and no notification ever fires.
        LocalNotificationManager.init(
            context = this,
            socket = koin.get(),
            sessionRepository = koin.get(),
        )
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(activity: Activity) {
                if (started++ != 0) return
                Breadcrumbs.add("lifecycle", "app foregrounded")
                LocalNotificationManager.onAppForegrounded()
                // Slide the login forward while the app is in use. Done here
                // rather than at a fixed interval because the token only has to
                // outlive the gaps between sessions, and an install opened once
                // a week should never see the 7-day expiry at all.
                appScope.launch {
                    SessionRenewal.renewIfDue(koin.get<ApiClient>()) {
                        // The live socket authenticated with the old token and
                        // keeps using it until it reconnects.
                        koin.get<SocketManager>().forceReconnect()
                    }
                }
            }
            override fun onActivityStopped(activity: Activity) {
                if (--started != 0) return
                Breadcrumbs.add("lifecycle", "app backgrounded")
                LocalNotificationManager.onAppBackgrounded()
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}
