package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** Operations (Docker, watchdogs) and the admin surface. */
interface OperationsApi {
    /** GET /api/docker/status */
    suspend fun getDockerStatus(): ApiResponse<DockerStatus>

    /** GET /api/docker/containers */
    suspend fun getDockerContainers(): ApiResponse<List<DockerContainer>>

    /** GET /api/watchdogs — admin-only; a non-admin gets 403. */
    suspend fun getWatchdogs(): ApiResponse<List<Watchdog>>

    // ---- Admin -------------------------------------------------------------

    /** GET /api/admin/stats */
    suspend fun getAdminStats(): ApiResponse<AdminStats>

    /** GET /api/admin/users */
    suspend fun getAdminUsers(): ApiResponse<List<AdminUser>>

    /** GET /api/admin/audit-log */
    suspend fun getAuditLog(limit: Int = 50): ApiResponse<AuditLogPage>
}

class OperationsApiImpl(private val http: ApiHttp) : OperationsApi {

    override suspend fun getDockerStatus(): ApiResponse<DockerStatus> =
        http.get("/api/docker/status")

    override suspend fun getDockerContainers(): ApiResponse<List<DockerContainer>> =
        http.get("/api/docker/containers")

    override suspend fun getWatchdogs(): ApiResponse<List<Watchdog>> =
        http.get("/api/watchdogs")

    override suspend fun getAdminStats(): ApiResponse<AdminStats> =
        http.get("/api/admin/stats")

    override suspend fun getAdminUsers(): ApiResponse<List<AdminUser>> =
        http.get("/api/admin/users")

    override suspend fun getAuditLog(limit: Int): ApiResponse<AuditLogPage> =
        http.get("/api/admin/audit-log") { parameter("limit", limit) }
}
