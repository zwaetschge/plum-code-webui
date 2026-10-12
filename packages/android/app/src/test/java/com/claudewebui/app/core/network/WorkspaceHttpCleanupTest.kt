package com.claudewebui.app.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import javax.net.SocketFactory
import kotlin.concurrent.thread

class WorkspaceHttpCleanupTest {
    @Test fun closingPooledSocketsRunsOffCallerAndSurvivesScreenCancellation() = runBlocking {
        val caller = Thread.currentThread()
        val closeThreads = CopyOnWriteArrayList<Thread>()
        val sockets = CopyOnWriteArrayList<Socket>()
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val serving = thread(isDaemon = true) {
            runCatching {
                server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val reader = socket.getInputStream().bufferedReader()
                    while (!reader.readLine().isNullOrEmpty()) { }
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok".toByteArray())
                        flush()
                    }
                    // Keep the server side open so the client retains its idle connection.
                    socket.getInputStream().read()
                }
            }
        }
        val factory = object : SocketFactory() {
            override fun createSocket(): Socket = object : Socket() {
                override fun close() {
                    closeThreads.add(Thread.currentThread())
                    super.close()
                }
            }.also { sockets.add(it) }
            override fun createSocket(host: String, port: Int) = createSocket().apply { connect(java.net.InetSocketAddress(host, port)) }
            override fun createSocket(host: InetAddress, port: Int) = createSocket(host.hostAddress!!, port)
            override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int) = createSocket().apply {
                bind(java.net.InetSocketAddress(local, localPort)); connect(java.net.InetSocketAddress(host, port))
            }
            override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int) = createSocket(host.hostAddress!!, port, local, localPort)
        }
        val client = OkHttpClient.Builder().socketFactory(factory).build()
        try {
            client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/").build()).execute().use {
                assertEquals("ok", it.body!!.string())
            }
            assertEquals(1, client.connectionPool.idleConnectionCount())
            closeThreads.clear()
            val screenScope = CoroutineScope(Job() + Dispatchers.Unconfined)
            val cleanup = AtomicReference<Job>()
            screenScope.launch { cleanup.set(disposeWorkspaceHttpClient(client)) }.join()
            screenScope.cancel()
            cleanup.get().join()
            assertEquals(0, client.connectionPool.connectionCount())
            assertTrue(closeThreads.isNotEmpty())
            assertTrue(closeThreads.all { it !== caller })
            assertTrue(client.dispatcher.executorService.isShutdown)
        } finally {
            disposeWorkspaceHttpClient(client).join()
            sockets.forEach { it.close() }
            server.close()
            serving.join(5000)
        }
    }
}
