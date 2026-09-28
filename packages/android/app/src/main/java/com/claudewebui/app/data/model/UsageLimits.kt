package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Models for `GET /api/usage/limits?provider=<id>` — live account quota straight
 * from the upstream provider (ChatGPT/Codex, Anthropic, Z.AI, Kimi, …).
 *
 * The envelope is *not* the generic [ApiResponse]: it carries a `supported`
 * flag alongside `data`, because execution harnesses like OpenCode and Pi have
 * no account of their own and answer `supported: false` with an explanatory
 * error instead of failing the request.
 */

@Serializable
data class UsageLimitWindow(
    val utilization: Int = 0,
    val resetsAt: String? = null,
    val windowSeconds: Long? = null,
    val used: Double? = null,
    val limit: Double? = null,
    val remaining: Double? = null,
    val unit: String? = null,
)

@Serializable
data class AdditionalUsageLimit(
    val name: String,
    val utilization: Int = 0,
    val resetsAt: String? = null,
    val windowSeconds: Long? = null,
)

@Serializable
data class UsageLimitData(
    val subscriptionType: String? = null,
    val rateLimitTier: String? = null,
    val fiveHour: UsageLimitWindow? = null,
    val sevenDay: UsageLimitWindow? = null,
    val sevenDaySonnet: UsageLimitWindow? = null,
    val additional: List<AdditionalUsageLimit> = emptyList(),
    /**
     * Both Mistral plan allowances (API/Studio and Vibe Code): Plum's own
     * ledger for the billing month, because Mistral publishes no quota API.
     */
    val planUsage: PlanUsage? = null,
)

@Serializable
data class PlanUsage(
    val periodStart: String? = null,
    val periodEnd: String? = null,
    /** In [currency]; list prices taken 1:1. */
    val spend: Double = 0.0,
    val tokens: Long = 0,
    val requests: Long = 0,
    val budget: Double? = null,
    val currency: String = "EUR",
    /** "api" (API/Studio allowance) or "vibe" (Vibe Code allowance). */
    val allowance: String = "api",
    val billingDay: Int = 1,
) {
    /** Which of the plan's two allowances this month belongs to. */
    val allowanceKind: MistralAllowance get() = MistralAllowance.fromId(allowance)
}

/**
 * `GET/PUT /api/usage/plan/mistral` and `GET/PUT /api/usage/plan/vibe` — the
 * allowance of one Mistral plan the configured credential draws on. Both
 * endpoints speak this same shape; only the stored budget differs.
 */
@Serializable
data class MistralPlanConfig(
    val monthlyBudget: Double? = null,
    val currency: String = "EUR",
    val allowance: String = "api",
    val billingDay: Int = 1,
)

/**
 * The two monthly allowances of a single Mistral plan.
 *
 * `api` is what a regular console key spends (how Pi and OpenCode reach
 * Mistral), `vibe` is the much larger Vibe Code allowance that the Vibe harness
 * and a key created under Code › Vibe CLI draw on. Plum keeps one ledger per
 * allowance, so the budget editor has to say which one it is writing.
 */
enum class MistralAllowance(val id: String, val presetEur: Double) {
    API("api", 25.5),
    VIBE("vibe", 255.0);

    companion object {
        fun fromId(id: String?): MistralAllowance =
            entries.firstOrNull { it.id.equals(id?.trim(), ignoreCase = true) } ?: API
    }
}

@Serializable
data class UsageLimitsResponse(
    val success: Boolean = false,
    val supported: Boolean = false,
    val provider: String = "",
    val data: UsageLimitData? = null,
    val error: ApiError? = null,
)

/**
 * Providers that expose an account-level quota API. Mirrors
 * `ACCOUNT_USAGE_LIMIT_PROVIDERS` in the WebUI's `lib/providers.ts`, plus the
 * two Mistral plan ledgers (`mistral` for the API/Studio allowance, `vibe` for
 * the Vibe Code allowance) which `GET /api/usage/limits` answers from Plum's
 * own usage history rather than from an upstream quota endpoint.
 */
enum class UsageLimitProvider(val id: String, val label: String) {
    CODEX("codex", "Codex"),
    CLAUDE("claude", "Claude"),
    ZAI("zai", "Z.AI"),
    KIMI("kimi", "Kimi"),
    /** Mistral Vibe: the plan's Vibe Code allowance, tracked apart from `mistral`. */
    VIBE("vibe", "Vibe"),
    ALIBABA("alibaba", "Alibaba"),
    MISTRAL("mistral", "Mistral");

    /**
     * Whether the long window is Plum's own billing-month ledger rather than an
     * upstream rolling week. Both Mistral allowances reset on the billing day,
     * so labelling them "Weekly" would promise a reset that never happens.
     */
    val isMonthlyPlan: Boolean get() = this == MISTRAL || this == VIBE
}
