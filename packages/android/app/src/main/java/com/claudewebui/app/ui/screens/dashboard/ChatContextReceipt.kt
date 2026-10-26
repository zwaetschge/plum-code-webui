package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable
internal fun ChatContextReceipt(receipt: JsonObject?, onOpenChat: (String) -> Unit) {
    if (receipt == null) return
    var expanded by remember { mutableStateOf(false) }
    val references = receipt["references"] as? JsonArray ?: JsonArray(emptyList())
    val learning = receipt["learning"] as? JsonObject ?: JsonObject(emptyMap())
    val status = learning["status"]?.jsonPrimitive?.contentOrNull ?: "skipped"
    val label = when (status) {
        "disabled" -> "Lernen aus"
        "pending" -> "Noch nicht verarbeitet"
        "queued" -> "Lernen vorgemerkt"
        "running" -> "Lernt …"
        "completed" -> "Verarbeitet"
        "failed" -> "Lernen fehlgeschlagen"
        "cancelled" -> "Lernen abgebrochen"
        else -> "Nichts gespeichert"
    }
    Column(Modifier.fillMaxWidth()) {
        TextButton(onClick = { expanded = !expanded }) { Text("Gedächtnis · ${references.size} Kontextbelege · $label") }
        if (expanded) {
            Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Lesen ${if (receipt["memoryRead"]?.jsonPrimitive?.booleanOrNull == true) "an" else "aus"} · Lernen ${if (receipt["memoryLearn"]?.jsonPrimitive?.booleanOrNull == true) "an" else "aus"}", style = MaterialTheme.typography.labelMedium)
                listOf("personalizationRevision" to "Personalisierung", "profileRevision" to "Assistent", "projectRevision" to "Projekt").forEach { (key, name) ->
                    receipt[key]?.jsonPrimitive?.longOrNull?.let { Text("$name · Revision $it", style = MaterialTheme.typography.labelSmall) }
                }
                if (receipt["legacyNotes"]?.jsonPrimitive?.booleanOrNull == true) Text("Gespeicherte Assistentennotizen übergeben")
                if (receipt["voiceHistory"]?.jsonPrimitive?.booleanOrNull == true) Text("Frühere Sprachgespräche übergeben")
                references.forEach { value ->
                    val ref = value.jsonObject
                    var showText by remember(ref) { mutableStateOf(false) }
                    val title = ref["title"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    val available = ref["available"]?.jsonPrimitive?.booleanOrNull == true
                    val revision = ref["revision"]?.jsonPrimitive?.longOrNull
                    TextButton(onClick = { showText = !showText }) { Text(title + (revision?.let { " · Revision $it" } ?: "") + if (!available) " · Nicht mehr verfügbar" else "") }
                    if (showText) {
                        ref["text"]?.jsonPrimitive?.contentOrNull?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        if (available && ref["kind"]?.jsonPrimitive?.contentOrNull == "project-chat") {
                            ref["id"]?.jsonPrimitive?.contentOrNull?.let { id -> TextButton(onClick = { onOpenChat(id) }) { Text("Chat öffnen") } }
                        }
                    }
                }
                HorizontalDivider()
                Text(label, style = MaterialTheme.typography.labelMedium)
                val memories = learning["memories"] as? JsonArray ?: JsonArray(emptyList())
                memories.forEach { value ->
                    val memory = value.jsonObject
                    Text("${memory["title"]?.jsonPrimitive?.contentOrNull.orEmpty()} · Revision ${memory["revision"]?.jsonPrimitive?.contentOrNull.orEmpty()}${if (memory["proposed"]?.jsonPrimitive?.booleanOrNull == true) " · Zur Prüfung" else ""}", style = MaterialTheme.typography.bodySmall)
                }
                val history = learning["historySaved"]?.jsonPrimitive?.booleanOrNull == true
                val style = learning["writingStyleSaved"]?.jsonPrimitive?.booleanOrNull == true
                if (history) Text("Chatrückblick gespeichert")
                if (style) Text("Schreibstil aktualisiert")
                if (status == "completed" && memories.isEmpty() && !history && !style) Text("Keine bleibenden Einträge")
            }
        }
    }
}
