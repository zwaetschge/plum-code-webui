package com.claudewebui.app.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

// Disposal runs on the Compose main thread. Closing a TLS socket can send a
// close_notify packet, so cancellation and pool eviction must both run on IO.
// This scope outlives the disposed screen and its cancelled coroutine scope.
private val workspaceCleanupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

internal fun disposeWorkspaceHttpClient(client: OkHttpClient): Job =
    workspaceCleanupScope.launch {
        try {
            client.dispatcher.cancelAll()
        } finally {
            try {
                client.connectionPool.evictAll()
            } finally {
                client.dispatcher.executorService.shutdown()
            }
        }
    }
