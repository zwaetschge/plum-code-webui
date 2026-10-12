package com.claudewebui.swarm

import android.Manifest
import android.content.Intent
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudewebui.swarm.ui.SchwarmThema
import com.claudewebui.swarm.ui.SchwarmViewModel
import com.claudewebui.swarm.ui.SchwarmWurzel
import com.claudewebui.swarm.ui.Sprung
import java.io.File

class MainActivity : ComponentActivity() {
    private val vm: SchwarmViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Aus einer Benachrichtigung gleich an die richtige Stelle, auch wenn die App schon läuft.
        // Nach einem Neuaufbau (etwa Dichtewechsel) nicht noch einmal springen.
        if (savedInstanceState == null) zielOeffnen(intent)
        addOnNewIntentListener { zielOeffnen(it) }
        setContent {
            SchwarmThema {
                // Long-Poll nur, solange die App sichtbar ist.
                LifecycleEventEffect(Lifecycle.Event.ON_START) { vm.vordergrund(true) }
                LifecycleEventEffect(Lifecycle.Event.ON_STOP) { vm.vordergrund(false) }

                val sitzung by vm.sitzung.collectAsStateWithLifecycle()
                val kontext = LocalContext.current
                val anfrage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                LaunchedEffect(sitzung != null) {
                    if (sitzung != null && Build.VERSION.SDK_INT >= 33 &&
                        ContextCompat.checkSelfPermission(kontext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    ) {
                        anfrage.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    SchwarmWurzel(vm)
                }
            }
        }
    }

    /**
     * Hell und dunkel wechseln ohne Neustart (uiMode in configChanges): Die Symbole der Statusleiste
     * folgen sonst dem alten Modus und verschwinden auf dunklem Grund.
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        enableEdgeToEdge()
    }

    private fun zielOeffnen(intent: Intent?) {
        when (intent?.getStringExtra(ZIEL)) {
            ZIEL_FREIGABEN -> vm.springen(Sprung.FREIGABEN)
            // Kürzel am App-Symbol, Widget „Braucht dich“ und Schnellkachel (App 2.5).
            ZIEL_NEUER_CHAT -> vm.springen(Sprung.NEUER_CHAT)
            ZIEL_NEUER_AUFTRAG -> vm.springen(Sprung.NEUER_AUFTRAG)
            ZIEL_AKTUELL -> vm.springen(Sprung.AKTUELL)
            ZIEL_NOTAUS -> vm.springen(Sprung.NOTAUS)
        }
        // „Brian hat geantwortet“: gleich in den Chat.
        intent?.getStringExtra(ZIEL_CHAT)?.takeIf { it.startsWith("$") && it.length < 256 }?.let { vm.springen(Sprung.ChatS(it)) }
        // „Teilen → Schwarm“ über TeilenActivity: ein neuer Chat in Allgemein, vorbelegt.
        if (intent?.action == Intent.ACTION_SEND) {
            val betreff = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
            val zusammen = if (betreff.isNotEmpty() && !text.contains(betreff)) "$betreff\n$text".trim() else text
            // Das Bild hat TeilenActivity schon in den eigenen Cache gelegt; nur dort wird gelesen.
            val ordner = File(cacheDir, TeilenActivity.GETEILT).canonicalFile
            val bild = intent.getStringExtra(BILD_DATEI)?.let { File(it).canonicalFile }
                ?.takeIf { it.parentFile == ordner && it.isFile }
                ?.let { Uri.fromFile(it) }
            if (intent.getBooleanExtra(BILD_FEHLER, false)) vm.melden("Das geteilte Bild liess sich nicht lesen.")
            vm.teilen(zusammen, bild)
            // Nicht noch einmal beim nächsten Neuaufbau.
            intent.action = null
        }
        // Ein Favorit aus dem Widget: Die App fragt die Platzhalter ab und schickt erst nach deinem Okay.
        intent?.getStringExtra(VORLAGE)?.takeIf { it.length in 1..64 }?.let { vm.vorlageStarten(it) }
    }

    companion object {
        /** Extra in Benachrichtigungen: welche Stelle die App zeigen soll. */
        const val ZIEL = "ch.zwaetschge.schwarm.ZIEL"
        const val ZIEL_FREIGABEN = "freigaben"
        const val ZIEL_NEUER_CHAT = "neuer_chat"
        const val ZIEL_NEUER_AUFTRAG = "neuer_auftrag"
        const val ZIEL_AKTUELL = "aktuell"
        const val ZIEL_NOTAUS = "notaus"

        /** Extras von TeilenActivity: das geteilte Bild als Datei im Cache, oder dass es nicht ging. */
        const val BILD_DATEI = "ch.zwaetschge.schwarm.BILD_DATEI"
        const val BILD_FEHLER = "ch.zwaetschge.schwarm.BILD_FEHLER"

        /** Extra in „Brian hat geantwortet“: die Wurzel des Chats. */
        const val ZIEL_CHAT = "ch.zwaetschge.schwarm.CHAT"

        /** Extra aus dem Favoriten-Widget: die ID einer Vorlage. */
        const val VORLAGE = "ch.zwaetschge.schwarm.VORLAGE"
    }
}
