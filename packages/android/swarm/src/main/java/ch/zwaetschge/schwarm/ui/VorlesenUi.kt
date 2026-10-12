package com.claudewebui.swarm.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Der Mini-Spieler fürs Vorlesen (App 2.2): Titel, „bereitet vor …“ bis Stück 1 da ist, dann „Stück x
 * von y“, Pause und Stopp. Stopp schickt `abbrechen` an den Hub. Fehler und Abbruch bleiben stehen, bis
 * du sie schliesst. `unten`: der Spieler ist das unterste Element und rückt über die Navigationsleiste.
 */
@Composable
fun VorleseLeiste(vm: SchwarmViewModel, unten: Boolean) {
    val v by vm.vorlesen.collectAsStateWithLifecycle()
    AnimatedVisibility(visible = v != null, enter = expandVertically(), exit = shrinkVertically()) {
        val z = v ?: return@AnimatedVisibility
        val f = MaterialTheme.colorScheme
        val problem = z.fehler != null || z.abgebrochen
        Surface(
            color = if (z.fehler != null) f.errorContainer else f.secondaryContainer,
            contentColor = if (z.fehler != null) f.onErrorContainer else f.onSecondaryContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(if (unten) Modifier.windowInsetsPadding(WindowInsets.navigationBars) else Modifier) {
                val von = z.von
                if (!problem && von != null && von > 0) {
                    LinearProgressIndicator(
                        progress = { ((z.nr - if (z.spielt || z.fertig) 0.5f else 1f) / von).coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else if (!problem && !z.fertig) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    when {
                        z.fehler != null -> Icon(Icons.Outlined.ErrorOutline, null)
                        z.wartet -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else -> Icon(Icons.AutoMirrored.Outlined.VolumeUp, null)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        // Mit Stimme (App 2.3): „Vorlesen · Brian (Jonas)“, darunter Stand und Titel.
                        Text(
                            "Vorlesen · ${z.stimme ?: z.titel}",
                            style = MaterialTheme.typography.labelLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val stand = when {
                            z.fehler != null -> z.fehler
                            z.abgebrochen -> "abgebrochen"
                            z.fertig -> "fertig"
                            z.nr == 1 && z.wartet -> "bereitet vor …"
                            z.wartet -> "Stück ${z.nr}${von?.let { " von $it" } ?: ""} · lädt …"
                            z.pausiert -> "Stück ${z.nr}${von?.let { " von $it" } ?: ""} · Pause"
                            else -> "Stück ${z.nr}${von?.let { " von $it" } ?: ""}"
                        }
                        Text(
                            if (z.stimme != null && z.fehler == null) "$stand · ${z.titel}" else stand,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (!z.vorbei) {
                        IconButton(onClick = { if (z.pausiert) vm.vorlesenWeiter() else vm.vorlesenPause() }) {
                            Icon(if (z.pausiert) Icons.Outlined.PlayArrow else Icons.Outlined.Pause, if (z.pausiert) "Weiter" else "Pause")
                        }
                        IconButton(onClick = { vm.vorlesenStopp() }) { Icon(Icons.Outlined.Stop, "Stopp") }
                    } else {
                        IconButton(onClick = { vm.vorlesenStopp() }) { Icon(Icons.Outlined.Close, "Schliessen") }
                    }
                }
            }
        }
    }
}
