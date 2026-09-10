package com.claudewebui.app.di

import com.claudewebui.app.core.network.NetworkMonitor
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.core.updates.AppUpdateChecker
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

val appModule = module {

    /**
     * TokenStore is a singleton object — expose it as a Koin single so it can
     * be injected into repositories and network components.
     */
    single<TokenStore> { TokenStore }

    /**
     * NetworkMonitor observes connectivity changes via ConnectivityManager.
     */
    single { NetworkMonitor(androidContext()) }

    /**
     * AppUpdateChecker polls /api/app/version and handles APK download/install.
     */
    single { AppUpdateChecker(androidContext(), get()) }
}
