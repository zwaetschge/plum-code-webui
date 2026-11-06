package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class CLIProviderConfig(
    val id: String,
    val name: String,
    val defaultModel: String? = null,
    val models: List<String> = emptyList(),
    val enabled: Boolean = true,
    val available: Boolean = false,
)

/**
 * One harness of `GET /api/cli-providers/diagnostics`. For Pi, [models] is every
 * runnable model, while `/api/cli-providers` lists only the ones picked for the
 * session menu.
 */
@Serializable
data class CliProviderDiagnostic(
    val id: String,
    val defaultModel: String? = null,
    val modelCount: Int = 0,
    val models: List<String> = emptyList(),
)

/**
 * One entry of the per-user model provider registry (`/api/model-providers`):
 * the key, base URL and model list Pi, model chat and voice resolve from.
 * The key is write-only — the server answers `***` and [hasKey].
 */
@Serializable
data class ModelProvider(
    val id: String,
    val name: String,
    val apiKey: String = "",
    val hasKey: Boolean = false,
    val envVars: List<String> = emptyList(),
    val baseUrl: String? = null,
    val enabled: Boolean = true,
    val models: List<String> = emptyList(),
    /** False keeps this provider (models and key) out of Pi; model chat still uses it. */
    val pi: Boolean = true,
)

/**
 * `PUT /api/model-providers/providers`. A null [models] keeps the stored list;
 * an empty one falls back to whatever the model catalog knows for [id].
 */
@Serializable
data class SaveModelProviderInput(
    val id: String,
    val name: String,
    val apiKey: String? = null,
    val baseUrl: String? = null,
    val enabled: Boolean = true,
    val models: List<String>? = null,
    /** Null keeps the stored choice; nullable so `true` is sent despite encodeDefaults = false. */
    val pi: Boolean? = null,
)

@Serializable
data class ModelProviderTest(
    val connected: Boolean = false,
    val message: String = "",
    val envVars: List<String> = emptyList(),
    val modelCount: Int = 0,
)
