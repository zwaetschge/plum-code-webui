package com.claudewebui.app.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException
import org.junit.Assert.*
import org.junit.Test
import java.net.UnknownHostException

class AppErrorTest {
    @Test fun onlyExpiredAuthenticationRequestsReauthentication() {
        assertTrue(ApiHttpException(401, "/api/test", null).toAppError() is AppError.Unauthorized)
        val forbidden = ApiHttpException(403, "/api/test", null).toAppError()
        assertTrue(forbidden is AppError.Server)
        assertFalse(forbidden.isRetryable)
        assertTrue(ApiHttpException(429, "/api/test", null).toAppError().isRetryable)
        assertTrue(ApiHttpException(503, "/api/test", null).toAppError().isRetryable)
    }

    @Test fun retryableConnectivityIsDistinctFromIncompatiblePayload() {
        assertTrue(UnknownHostException().toAppError() is AppError.Network)
        val contract = SerializationException("missing field").toAppError()
        assertTrue(contract is AppError.Contract)
        assertFalse(contract.isRetryable)
    }

    @Test fun apiCallPropagatesCancellationAndPreservesMappedError() = runBlocking {
        val cancellation = CancellationException("screen closed")
        try {
            apiCall<Unit> { throw cancellation }
            fail("Cancellation was swallowed")
        } catch (actual: CancellationException) {
            assertSame(cancellation, actual)
        }
        val original = AppError.Network(UnknownHostException())
        val result = apiCall<Unit> { throw AppErrorException(original) }
        assertSame(original, result.appErrorOrNull())
    }
}
