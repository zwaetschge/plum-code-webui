package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/**
 * `/api/preview` — the web preview dev server.
 *
 * These routes answer with the bare object rather than the ApiResponse
 * envelope used elsewhere, so the return types are the payloads directly.
 */
interface PreviewApi {
    /** GET /api/preview/config */
    suspend fun getPreviewConfig(): PreviewConfig

    /** GET /api/preview/ports — probes the common dev-server ports. */
    suspend fun getPreviewPorts(projectPath: String? = null): PreviewPortScan

    /** POST /api/preview/start */
    suspend fun startPreview(projectPath: String, script: String = ""): PreviewProcess

    /** POST /api/preview/stop */
    suspend fun stopPreview(projectPath: String, script: String = ""): PreviewProcess
}

class PreviewApiImpl(private val http: ApiHttp) : PreviewApi {

    override suspend fun getPreviewConfig(): PreviewConfig =
        http.get("/api/preview/config")

    override suspend fun getPreviewPorts(projectPath: String?): PreviewPortScan =
        http.get("/api/preview/ports") { projectPath?.let { parameter("projectPath", it) } }

    override suspend fun startPreview(projectPath: String, script: String): PreviewProcess =
        http.post("/api/preview/start") { setBody(PreviewStartInput(projectPath, script)) }

    override suspend fun stopPreview(projectPath: String, script: String): PreviewProcess =
        http.post("/api/preview/stop") { setBody(PreviewStartInput(projectPath, script)) }
}
