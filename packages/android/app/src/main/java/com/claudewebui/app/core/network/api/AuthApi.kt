package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** `/auth/` endpoints and the Basic Auth login. */
interface AuthApi {
    /** POST /auth/dev-login */
    suspend fun devLogin(request: LoginRequest): ApiResponse<LoginResponse>

    /** POST /auth/logout */
    suspend fun logout(): ApiResponse<Unit>

    /** GET /auth/me */
    suspend fun me(): ApiResponse<AuthUser>

    /**
     * POST /auth/refresh — slide the session forward with the current token.
     *
     * The backend issues 7-day tokens. Without this the app was signed out on
     * a fixed schedule, and the socket's terminal "Invalid token" error stops
     * reconnect attempts entirely, so it looked like the server had gone away.
     */
    suspend fun refreshToken(): ApiResponse<TokenRefreshResponse>

    /** GET /auth/providers */
    suspend fun authProviders(): ApiResponse<AuthProviders>

    /** Exchange the short-lived Authelia handoff code for a Plum JWT. */
    suspend fun mobileAuthExchange(request: MobileAuthExchangeRequest): ApiResponse<LoginResponse>

    /** POST /api/basic-auth/login */
    suspend fun basicAuthLogin(request: BasicAuthLoginRequest): ApiResponse<LoginResponse>
}

class AuthApiImpl(private val http: ApiHttp) : AuthApi {

    override suspend fun devLogin(request: LoginRequest): ApiResponse<LoginResponse> =
        http.post("/auth/dev-login") { setBody(request) }

    override suspend fun logout(): ApiResponse<Unit> =
        http.post("/auth/logout")

    override suspend fun me(): ApiResponse<AuthUser> =
        http.get("/auth/me")

    override suspend fun refreshToken(): ApiResponse<TokenRefreshResponse> =
        http.post("/auth/refresh")

    override suspend fun authProviders(): ApiResponse<AuthProviders> =
        http.get("/auth/providers")

    override suspend fun mobileAuthExchange(request: MobileAuthExchangeRequest): ApiResponse<LoginResponse> =
        http.post("/auth/mobile/exchange") { setBody(request) }

    override suspend fun basicAuthLogin(request: BasicAuthLoginRequest): ApiResponse<LoginResponse> =
        http.post("/api/basic-auth/login") { setBody(request) }
}
