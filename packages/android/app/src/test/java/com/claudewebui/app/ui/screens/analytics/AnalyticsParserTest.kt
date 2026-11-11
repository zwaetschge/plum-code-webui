package com.claudewebui.app.ui.screens.analytics

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalyticsParserTest {
    @Test
    fun `uses current server models and never invents fallback models`() {
        val summary = Json.parseToJsonElement(
            """{
                "totals":{"totalTokens":4200,"apiEquivalentCost":1.25,"totalRequests":3,"pricingCoveragePercent":100},
                "byProvider":[{"provider":"Kimi","total_tokens":3000,"requests":2,"models":1,"api_equivalent_cost":0.9}],
                "byModel":[
                    {"model":"kimi-code/k3","provider":"Kimi","total_tokens":3000,"requests":2,"api_equivalent_cost":0.9,"pricing_known":true},
                    {"model":"gpt-5.6-sol","provider":"Codex","total_tokens":1200,"requests":1,"api_equivalent_cost":0.35,"pricing_known":true}
                ],
                "bySession":[],
                "pricingAudit":{"missingPricingModels":[]}
            }""".trimIndent(),
        ).jsonObject
        val timeline = Json.parseToJsonElement(
            """[{"date":"2026-08-02","total_tokens":4200,"cost":1.25,"requests":3}]""",
        ).jsonArray

        val parsed = AnalyticsParser.parse(summary, timeline)

        assertEquals(listOf("kimi-code/k3", "gpt-5.6-sol"), parsed.modelUsage.map { it.modelName })
        assertTrue(parsed.providerUsage.any { it.name == "Kimi" })
        assertEquals(4200L, parsed.timeline.single().tokenCount)
        assertFalse(parsed.modelUsage.any { it.modelName == "gpt-5.5" || it.modelName == "z-ai/glm-5.1" })
    }

    @Test
    fun `vibe usage is coloured as its own provider family`() {
        // The backend attributes Vibe turns to the "Vibe" family, so the chart
        // must not fall back to the grey "Other" colour for them.
        val summary = Json.parseToJsonElement(
            """{
                "totals":{"totalTokens":900,"apiEquivalentCost":2.4,"totalRequests":2,"pricingCoveragePercent":100},
                "byProvider":[{"provider":"Vibe","total_tokens":900,"requests":2,"models":1,"api_equivalent_cost":2.4}],
                "byModel":[
                    {"model":"mistral-medium-3.5","provider":"Vibe","total_tokens":900,"requests":2,"api_equivalent_cost":2.4,"pricing_known":true}
                ],
                "bySession":[
                    {"session_id":"v1","session_name":"Vibe refactor","total_tokens":900,"requests":2,"api_equivalent_cost":2.4,"provider":"Vibe","last_active":"2026-08-03T10:00:00Z"}
                ],
                "pricingAudit":{"missingPricingModels":[]}
            }""".trimIndent(),
        ).jsonObject
        val timeline = Json.parseToJsonElement("[]").jsonArray

        val parsed = AnalyticsParser.parse(summary, timeline)

        val provider = parsed.providerUsage.single()
        assertEquals("Vibe", provider.name)
        assertEquals(0xFFFF7000L, provider.color)
        assertEquals(0xFFFF7000L, parsed.modelUsage.single().color)
        assertEquals(2.4, provider.costUsd, 0.0001)
    }

    @Test
    fun `subagent groups parse with big counts and sort by tokens`() {
        val root = Json.parseToJsonElement(
            """{"period":"7d","unknownKey":1,"groups":[
                {"kind":"worker","provider":"pi","providerLabel":"Pi","model":"m","runs":2,"totalTokens":10,"costUsd":0.5},
                {"kind":"agent","provider":"claude","providerLabel":"Claude Code","agentType":"fork","model":"x","runs":3,"sessions":1,"totalTokens":5000000000,"costUsd":12.5,"lastUsedAt":null}
            ],"totals":{"totalTokens":5000000010,"costUsd":13.0,"runs":5,"windowTotalTokens":10000000020,"sharePercent":50.0}}""",
        )
        val usage = AnalyticsParser.parseSubagents(root)
        assertEquals(listOf("agent", "worker"), usage.groups.map { it.kind })
        assertEquals(5_000_000_000L, usage.groups.first().totalTokens)
        assertEquals("fork", usage.groups.first().agentType)
        assertEquals(50.0, usage.sharePercent, 0.0)
    }

    @Test
    fun `old backend answer without groups parses to empty subagent usage`() {
        val old = Json.parseToJsonElement("""{"agents":[{"name":"a"}],"totals":{"agents":3,"tokens":9}}""")
        val usage = AnalyticsParser.parseSubagents(old)
        assertTrue(usage.groups.isEmpty())
        assertEquals(0.0, usage.sharePercent, 0.0)
        assertTrue(AnalyticsParser.parseSubagents(null).groups.isEmpty())
        assertTrue(AnalyticsParser.parseSubagents(Json.parseToJsonElement("[]")).groups.isEmpty())
    }
}
