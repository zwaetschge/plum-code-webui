@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudewebui.swarm.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.R

@Composable
fun Anmeldung(vm: SchwarmViewModel) {
    val zustand by vm.anmeldung.collectAsStateWithLifecycle()
    var server by rememberSaveable { mutableStateOf(vm.letzterServer) }
    var benutzer by rememberSaveable { mutableStateOf(vm.letzterBenutzer) }
    // Bewusst nicht rememberSaveable: Das Passwort soll in keinem gespeicherten Zustand landen.
    var passwort by remember { mutableStateOf("") }
    var zeigen by remember { mutableStateOf(false) }
    val anmelden = { vm.anmelden(server, benutzer, passwort) }
    val notAus by vm.notAus.collectAsStateWithLifecycle()
    var notAusOffen by remember { mutableStateOf(false) }
    if (notAusOffen) {
        val z by vm.schwarm.collectAsStateWithLifecycle()
        NotAusDialog(vm, z, onSchliessen = { notAusOffen = false }, nurDirekt = true)
    }

    Box(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 440.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(painterResource(R.drawable.swarm_ic_launcher_foreground), null, Modifier.size(112.dp))
            Text("Plum Schwarm", style = MaterialTheme.typography.headlineMedium)
            Text(
                "Deine Bots über Matrix: Aufträge geben, zusehen, nachfragen, anhalten.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("Server") },
                leadingIcon = { Icon(Icons.Outlined.Dns, null) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = benutzer,
                onValueChange = { benutzer = it },
                label = { Text("Benutzer") },
                leadingIcon = { Icon(Icons.Outlined.Person, null) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = passwort,
                onValueChange = { passwort = it },
                label = { Text("Passwort") },
                leadingIcon = { Icon(Icons.Outlined.Lock, null) },
                trailingIcon = {
                    IconButton(onClick = { zeigen = !zeigen }) {
                        Icon(
                            if (zeigen) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            if (zeigen) "Passwort verbergen" else "Passwort zeigen",
                        )
                    }
                },
                singleLine = true,
                visualTransformation = if (zeigen) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (passwort.isNotEmpty()) anmelden() }),
                modifier = Modifier.fillMaxWidth(),
            )
            zustand.fehler?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Button(
                onClick = anmelden,
                enabled = !zustand.laeuft && passwort.isNotEmpty() && benutzer.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (zustand.laeuft) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Text("Anmelden")
                }
            }
            TextButton(onClick = { vm.vorschauStarten() }) { Text("Vorschau mit Beispieldaten ansehen") }
            // Auch abgemeldet bleibt der Not-Aus ohne Matrix, wenn dieses Gerät dafür angemeldet ist (Punkt 18).
            if (notAus.bereit && !notAus.vorschau) {
                OutlinedButton(onClick = { notAusOffen = true }) {
                    Icon(Icons.Outlined.PanTool, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.size(8.dp))
                    Text("Not-Aus ohne Matrix")
                }
            }
            Text(
                "Die App meldet sich als du bei Matrix an und speichert nur das Zugangstoken, " +
                    "verschlüsselt mit einem Schlüssel aus dem Android-Keystore – nie das Passwort. " +
                    "Abmelden in den Einstellungen beendet die Sitzung auch auf dem Server.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
