package com.claudewebui.swarm.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.swarm.data.SchwarmZustand
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Das Bildmodell, das Brian Fotos beschreibt (auxiliary.vision in seiner config.yaml). */
const val BRIAN_VISION = "ds/v4-flash-vision"

private val tag = DateTimeFormatter.ofPattern("dd.MM.").withZone(ZoneId.of("Europe/Zurich"))
private fun usd(cent: Int?): String = cent?.let { "%.2f".format(it / 100.0) } ?: "?"

/**
 * LiteLLM in der App (App 2.10): Brians Weg zu Modellen ausserhalb von Z.AI. Budget des Schlüssels schwarm-brian,
 * seine Ersatzkette mit Stand je Glied, das Bildmodell und alle Modelle, die er pro Chat nehmen darf. Wählen
 * tust du ein Modell oben im Chat (Chip „Modell“), es gilt dann nur für diesen Chat.
 */
@Composable
fun LiteLlmAnsicht(z: SchwarmZustand, a: Aktionen, zurueck: () -> Unit) {
    val l = z.hub.litellm
    val brian = z.hub.modelle["brian"]
    Scaffold(
        topBar = {
            SchwarmLeiste("LiteLLM", "Brians Modelle ausserhalb von Z.AI", zurueck = if (a.zurueckPfeil) zurueck else null) {
                if (a.breit) IconButton(onClick = a.schliessen) { Icon(Icons.Outlined.Close, "Schliessen") }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(top = pad.calculateTopPadding()).verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            if (l == null) {
                LeerHinweis(Icons.Outlined.Psychology, "Noch kein Stand", "Der Hub meldet LiteLLM ab dem Release vom 28.09. alle 5 min.")
                return@Column
            }
            if (!l.erreichbar) {
                HinweisKarte(Icons.Outlined.ErrorOutline, "LiteLLM nicht erreichbar", l.fehler ?: "Der Hub bekommt keine Antwort von llm-hub.", StatusKritisch, Modifier.padding(16.dp))
            }
            Abschnitt("Budget · Schlüssel schwarm-brian", Modifier.padding(horizontal = 12.dp))
            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                Text(
                    "${usd(l.ausgabenCent)} von ${usd(l.budgetCent)} USD" + (l.zeitraum?.let { " je $it" } ?: ""),
                    style = MaterialTheme.typography.titleMedium,
                )
                l.anteil?.let { anteil ->
                    LinearProgressIndicator(
                        progress = { anteil },
                        color = if (anteil >= 0.9f) StatusKritisch else if (anteil >= 0.7f) StatusWarnung else MaterialTheme.colorScheme.primary,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    )
                }
                Text(
                    listOfNotNull(
                        l.zurueck?.let { "Neu ab ${tag.format(Instant.ofEpochMilli(it))}" },
                        l.stand?.let { "Stand ${vorText(it)}" },
                        "Mistral (Brians Hauptmodell) rechnet über dein Mistral-Abo ab und zählt hier nicht mit.",
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider(Modifier.padding(top = 12.dp))
            Abschnitt("Brians Kette", Modifier.padding(horizontal = 12.dp))
            val kette = listOfNotNull(brian?.standard?.modell ?: brian?.modell) + (brian?.standard?.fallback ?: emptyList())
            kette.forEachIndexed { i, id ->
                val lite = id.contains('/')
                val da = !lite || l.hat(id)
                ListItem(
                    leadingContent = {
                        Icon(
                            if (da) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null,
                            tint = if (da) StatusGut else StatusWarnung,
                        )
                    },
                    headlineContent = { Text("${if (i == 0) "Hauptmodell" else "Ersatz $i"}: ${brian?.name(id) ?: id}") },
                    supportingContent = {
                        Text(
                            when {
                                !lite -> "Z.AI GLM-Coding-Plan, direkt"
                                id == "mistral/glm-5.3" && da -> "Mistral-API über LiteLLM"
                                da -> "über LiteLLM"
                                id.startsWith("mistral/") -> "Fehlt noch: Den Mistral-Schlüssel trägt `ops/litellm-mistral.mjs` ein. Bis dahin springt Brian gleich zum nächsten Glied."
                                else -> "Fehlt in LiteLLM oder auf dem Schlüssel; Brian überspringt es."
                            },
                        )
                    },
                )
            }
            ListItem(
                leadingContent = { Icon(Icons.Outlined.Image, null, tint = if (l.hat(BRIAN_VISION)) StatusGut else StatusWarnung) },
                headlineContent = { Text("Bilder: DeepSeek V4 Flash Vision") },
                supportingContent = {
                    Text("Schickst du Brian ein Foto, beschreibt es dieses Modell, und Brian antwortet mit der Beschreibung. GLM-5.3 selbst sieht keine Bilder.")
                },
            )
            HorizontalDivider()
            Abschnitt("Modelle pro Chat (${l.modelle.size})", Modifier.padding(horizontal = 12.dp))
            Text(
                "Im Chat oben auf das Modell tippen → „Nur dieser Chat · LiteLLM“. Brian behält dabei seine Werkzeuge und sein Gedächtnis.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            l.modelle.groupBy { it.second }.forEach { (anbieter, liste) ->
                ListItem(
                    headlineContent = { Text(anbieter) },
                    supportingContent = { Text(liste.joinToString(", ") { it.first.substringAfter('/') }) },
                )
            }
        }
    }
}
