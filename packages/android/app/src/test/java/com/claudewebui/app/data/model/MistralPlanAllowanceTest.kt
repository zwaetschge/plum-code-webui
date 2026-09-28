package com.claudewebui.app.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * One Mistral plan carries two monthly allowances and Plum tracks them apart:
 * `mistral` for API/Studio traffic routed through Pi/OpenCode, `vibe` for the
 * turns the Vibe harness books. These cover the client side of that split —
 * the presets the budget editor offers and the shape
 * `GET /api/usage/limits?provider=vibe` answers with.
 */
class MistralPlanAllowanceTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun allowancesCarryThePublishedProPresets() {
        assertEquals("api", MistralAllowance.API.id)
        assertEquals("vibe", MistralAllowance.VIBE.id)
        assertEquals(25.5, MistralAllowance.API.presetEur, 0.0001)
        assertEquals(255.0, MistralAllowance.VIBE.presetEur, 0.0001)
    }

    @Test
    fun unknownAllowanceFallsBackToTheApiSide() {
        assertEquals(MistralAllowance.VIBE, MistralAllowance.fromId("VIBE"))
        assertEquals(MistralAllowance.VIBE, MistralAllowance.fromId(" vibe "))
        assertEquals(MistralAllowance.API, MistralAllowance.fromId("api"))
        // A ledger without an explicit allowance predates the split and was
        // always the API budget; guessing "vibe" would inflate it tenfold.
        assertEquals(MistralAllowance.API, MistralAllowance.fromId(null))
        assertEquals(MistralAllowance.API, MistralAllowance.fromId("nonsense"))
    }

    @Test
    fun vibeLimitsResponseDecodesIntoThePlanTracker() {
        val response = json.decodeFromString<UsageLimitsResponse>(
            """
            {
              "success": true,
              "supported": true,
              "provider": "vibe",
              "data": {
                "subscriptionType": "Vibe Code allowance",
                "rateLimitTier": "Monthly allowance",
                "fiveHour": null,
                "sevenDay": {
                  "utilization": 42,
                  "resetsAt": "2026-09-01T00:00:00.000Z",
                  "windowSeconds": 2678400,
                  "used": 107.1,
                  "limit": 255,
                  "remaining": 147.9,
                  "unit": "eur"
                },
                "sevenDaySonnet": null,
                "additional": [],
                "source": "local-estimate",
                "planUsage": {
                  "periodStart": "2026-08-01T00:00:00.000Z",
                  "periodEnd": "2026-09-01T00:00:00.000Z",
                  "spend": 107.1,
                  "tokens": 1200000,
                  "requests": 38,
                  "budget": 255.0,
                  "currency": "EUR",
                  "allowance": "vibe",
                  "billingDay": 1
                }
              }
            }
            """.trimIndent(),
        )

        assertTrue(response.supported)
        assertEquals("vibe", response.provider)
        val data = requireNotNull(response.data)
        // Vibe has no rolling five-hour window; the month rides in the long slot.
        assertNull(data.fiveHour)
        // Utilization is a whole percent Int, so a fractional answer would fail
        // to decode and blank the card.
        assertEquals(42, requireNotNull(data.sevenDay).utilization)
        assertEquals("eur", data.sevenDay?.unit)
        val plan = requireNotNull(data.planUsage)
        assertEquals(MistralAllowance.VIBE, plan.allowanceKind)
        assertEquals(255.0, plan.budget ?: 0.0, 0.0001)
        assertEquals("EUR", plan.currency)
        assertEquals(1, plan.billingDay)
        assertEquals(107.1, plan.spend, 0.0001)
        assertEquals(1_200_000L, plan.tokens)
        assertEquals(38L, plan.requests)
    }

    @Test
    fun vibeBudgetEditSendsTheVibeAllowance() {
        val config = MistralPlanConfig(
            monthlyBudget = MistralAllowance.VIBE.presetEur,
            currency = "EUR",
            allowance = MistralAllowance.VIBE.id,
            billingDay = 3,
        )
        val body = Json.encodeToString(config)
        assertTrue(body.contains("\"allowance\":\"vibe\""))
        assertTrue(body.contains("\"monthlyBudget\":255.0"))
        assertTrue(body.contains("\"billingDay\":3"))
    }

    @Test
    fun onlyThePlanLedgersReportAMonthlyWindow() {
        assertTrue(UsageLimitProvider.VIBE.isMonthlyPlan)
        assertTrue(UsageLimitProvider.MISTRAL.isMonthlyPlan)
        assertFalse(UsageLimitProvider.KIMI.isMonthlyPlan)
        assertFalse(UsageLimitProvider.CODEX.isMonthlyPlan)
        // The widget and the analytics screen iterate this enum for their quota
        // rows, so Vibe has to be part of the fetch list to be tracked at all.
        assertTrue(UsageLimitProvider.entries.any { it.id == "vibe" && it.label == "Vibe" })
    }
}
