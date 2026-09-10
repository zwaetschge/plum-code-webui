package com.claudewebui.app.core.network.api

import com.claudewebui.app.core.network.ApiHttp
import com.claudewebui.app.data.model.*
import io.ktor.client.request.*

/** `/api/categories` — session categories. */
interface CategoriesApi {
    /** GET /api/categories */
    suspend fun getCategories(): ApiResponse<List<Category>>

    /** POST /api/categories */
    suspend fun createCategory(input: CreateCategoryInput): ApiResponse<Category>

    /** PATCH /api/categories/:id */
    suspend fun updateCategory(id: String, input: UpdateCategoryInput): ApiResponse<Category>

    /** DELETE /api/categories/:id */
    suspend fun deleteCategory(id: String): ApiResponse<Unit>
}

class CategoriesApiImpl(private val http: ApiHttp) : CategoriesApi {

    override suspend fun getCategories(): ApiResponse<List<Category>> =
        http.get("/api/categories")

    override suspend fun createCategory(input: CreateCategoryInput): ApiResponse<Category> =
        http.post("/api/categories") { setBody(input) }

    override suspend fun updateCategory(id: String, input: UpdateCategoryInput): ApiResponse<Category> =
        http.patch("/api/categories/$id") { setBody(input) }

    override suspend fun deleteCategory(id: String): ApiResponse<Unit> =
        http.delete("/api/categories/$id")
}
