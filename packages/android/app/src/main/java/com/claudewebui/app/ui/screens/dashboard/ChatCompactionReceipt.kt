package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable
internal fun ChatCompactionReceipt(compaction: JsonObject?) {
    if (compaction == null) return
    var expanded by remember { mutableStateOf(false) }
    val status = compaction["status"]?.jsonPrimitive?.contentOrNull
    val covered = compaction["coveredTurns"]?.jsonPrimitive?.intOrNull ?: 0
    val total = compaction["olderTurns"]?.jsonPrimitive?.intOrNull ?: 0
    val remaining = compaction["remainingTurns"]?.jsonPrimitive?.intOrNull ?: 0
    val through = compaction["throughSeq"]?.jsonPrimitive?.longOrNull ?: 0
    Column {
        TextButton(onClick = { expanded = !expanded }) { Text(when (status) { "running" -> "Verlauf wird verdichtet …"; "failed" -> "Verdichtung nicht verfügbar"; else -> "Verlauf · $covered ${if (covered == 1) "Beitrag" else "Beiträge"} verdichtet" }) }
        if (expanded) Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (covered > 0) Text((if (total == 1) "Ein früherer Beitrag" else "$covered von $total früheren Beiträgen") + " · bis Beitrag $through", style = MaterialTheme.typography.labelSmall)
            if (remaining > 0) Text(if (remaining == 1) "Ein weiterer Beitrag fehlt in dieser Verdichtung." else "$remaining weitere Beiträge fehlen in dieser Verdichtung.", style = MaterialTheme.typography.bodySmall)
            val truncated = (compaction["truncatedTurnIds"] as? JsonArray)?.size ?: 0
            if (truncated > 0) Text(if (truncated == 1) "Ein Beitrag mit gekürztem Auszug" else "$truncated Beiträge mit gekürzten Auszügen", style = MaterialTheme.typography.bodySmall)
            compaction["summary"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) }
            compaction["error"]?.jsonPrimitive?.contentOrNull?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
