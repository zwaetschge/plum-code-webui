package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.call.*
import io.ktor.client.plugins.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.http.*
import kotlinx.serialization.json.JsonElement

/** `/api/files` — workspace browsing, reading, writing and uploads. */
interface FilesApi {
    /**
     * GET /api/files?path=:path — directory listing.
     *
     * The router mounts this on the collection root; there is no `/directory`
     * sub-path, and calling one returned HTML 404 that failed to decode.
     */
    suspend fun getDirectory(path: String): ApiResponse<DirectoryContents>

    /** GET /api/files/home — returns homeDir plus allowed/common paths. */
    suspend fun getHomePaths(): ApiResponse<HomePaths>

    /**
     * POST /api/files/upload (multipart; multer only accepts the field name "files").
     *
     * The destination goes in the query string, not the form body: multer decides
     * where to write the moment it reaches the file part, so a body field is only
     * visible if it happens to be appended first. [targetDirectory] is the
     * directory the file manager is currently showing; without it the server falls
     * back to the session's working directory.
     */
    suspend fun uploadFile(
        sessionId: String,
        fileName: String,
        fileBytes: ByteArray,
        mimeType: String,
        targetDirectory: String? = null,
    ): ApiResponse<JsonElement>

    /** GET /api/files/content — read a text file (server rejects >1 MB). */
    suspend fun getFileContent(path: String): ApiResponse<FileContent>

    /** PUT /api/files/content — write a file back to the workspace. */
    suspend fun saveFileContent(path: String, content: String): ApiResponse<JsonElement>

    /** GET /api/files/download — raw file bytes, no JSON envelope. */
    suspend fun downloadFile(path: String): ByteArray

    /**
     * GET /api/files/download-folder — the directory streamed as one ZIP.
     * The server skips node_modules/.git/.pnpm-store unless `full=1`.
     */
    suspend fun downloadFolderArchive(path: String, full: Boolean = false): ByteArray
}

class FilesApiImpl(private val http: ApiHttp) : FilesApi {

    override suspend fun getDirectory(path: String): ApiResponse<DirectoryContents> =
        http.get("/api/files") { parameter("path", path) }

    override suspend fun getHomePaths(): ApiResponse<HomePaths> =
        http.get("/api/files/home")

    override suspend fun uploadFile(
        sessionId: String,
        fileName: String,
        fileBytes: ByteArray,
        mimeType: String,
        targetDirectory: String?,
    ): ApiResponse<JsonElement> {
        val query = buildString {
            append("?sessionId=").append(sessionId.encodeURLParameter())
            if (!targetDirectory.isNullOrBlank()) {
                append("&targetDirectory=").append(targetDirectory.encodeURLParameter())
            }
        }
        return http.client.submitFormWithBinaryData(
            url = http.url("/api/files/upload$query"),
            formData = formData {
                append("sessionId", sessionId)
                append("files", fileBytes, Headers.build {
                    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                    append(HttpHeaders.ContentType, mimeType)
                })
            }
        ).body()
    }

    override suspend fun getFileContent(path: String): ApiResponse<FileContent> =
        http.get("/api/files/content") { parameter("path", path) }

    override suspend fun saveFileContent(path: String, content: String): ApiResponse<JsonElement> =
        http.put("/api/files/content") { setBody(SaveFileInput(path, content)) }

    override suspend fun downloadFile(path: String): ByteArray =
        http.get("/api/files/download") {
            parameter("path", path)
            timeout { requestTimeoutMillis = DOWNLOAD_TIMEOUT_MS; socketTimeoutMillis = DOWNLOAD_TIMEOUT_MS }
        }

    override suspend fun downloadFolderArchive(path: String, full: Boolean): ByteArray =
        http.get("/api/files/download-folder") {
            parameter("path", path)
            if (full) parameter("full", "1")
            // The archive is built while it streams; a large tree easily
            // outlives the 30 s default.
            timeout { requestTimeoutMillis = DOWNLOAD_TIMEOUT_MS; socketTimeoutMillis = DOWNLOAD_TIMEOUT_MS }
        }

    private companion object {
        const val DOWNLOAD_TIMEOUT_MS = 10 * 60_000L
    }
}
