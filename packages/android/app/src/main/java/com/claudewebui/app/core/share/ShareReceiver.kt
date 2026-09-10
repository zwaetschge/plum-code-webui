package com.claudewebui.app.core.share

import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.claudewebui.app.MainActivity
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import org.koin.core.context.GlobalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.InputStream

/**
 * Transparent trampoline Activity that intercepts Android share intents
 * (text, images, files) and routes the shared content into a Claude Code session.
 *
 * Handles ACTION_SEND for text, image, and application mime types.
 */
class ShareReceiver : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val sharedPayload = extractSharePayload(intent) ?: run {
            finish()
            return
        }

        setContent {
            ClaudeWebUITheme {
                SessionPickerDialog(
                    payload = sharedPayload,
                    onSessionSelected = { session ->
                        routeToSession(session.id, sharedPayload)
                        finish()
                    },
                    onNewSession = {
                        openNewSessionWithPayload(sharedPayload)
                        finish()
                    },
                    onDismiss = { finish() }
                )
            }
        }
    }

    // ── Share payload extraction ───────────────────────────────────────────────

    private fun extractSharePayload(intent: Intent?): SharePayload? {
        if (intent?.action != Intent.ACTION_SEND) return null
        val type = intent.type ?: return null

        return when {
            type.startsWith("text/") -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                    ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
                    ?: return null
                val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
                SharePayload.Text(text = text, subject = subject)
            }
            type.startsWith("image/") -> {
                val uri = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (uri != null) SharePayload.Image(uri = uri, mimeType = type) else null
            }
            else -> {
                // Generic file
                val uri = getStreamUri(intent) ?: return null
                val filename = getFilename(uri) ?: "shared_file"
                SharePayload.File(uri = uri, mimeType = type, filename = filename)
            }
        }
    }

    private fun getStreamUri(intent: Intent): Uri? {
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
    }

    private fun getFilename(uri: Uri): String? {
        return try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (cursor.moveToFirst() && nameIndex >= 0) {
                    cursor.getString(nameIndex)
                } else null
            }
        } catch (_: Exception) { null }
    }

    // ── Routing ───────────────────────────────────────────────────────────────

    private fun routeToSession(sessionId: String, payload: SharePayload) {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = android.net.Uri.parse("claudewebui://session/$sessionId")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_SHARE_PAYLOAD_TYPE, payload.type)
            when (payload) {
                is SharePayload.Text -> {
                    putExtra(EXTRA_SHARE_TEXT, payload.text)
                    payload.subject?.let { putExtra(EXTRA_SHARE_SUBJECT, it) }
                }
                is SharePayload.Image -> putExtra(EXTRA_SHARE_URI, payload.uri.toString())
                is SharePayload.File -> {
                    putExtra(EXTRA_SHARE_URI, payload.uri.toString())
                    putExtra(EXTRA_SHARE_FILENAME, payload.filename)
                }
            }
        }
        startActivity(intent)
    }

    private fun openNewSessionWithPayload(payload: SharePayload) {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = android.net.Uri.parse("claudewebui://new")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_SHARE_PAYLOAD_TYPE, payload.type)
            when (payload) {
                is SharePayload.Text -> putExtra(EXTRA_SHARE_TEXT, payload.text)
                is SharePayload.Image -> putExtra(EXTRA_SHARE_URI, payload.uri.toString())
                is SharePayload.File -> {
                    putExtra(EXTRA_SHARE_URI, payload.uri.toString())
                    putExtra(EXTRA_SHARE_FILENAME, payload.filename)
                }
            }
        }
        startActivity(intent)
    }

    companion object {
        const val EXTRA_SHARE_PAYLOAD_TYPE = "share_payload_type"
        const val EXTRA_SHARE_TEXT = "share_text"
        const val EXTRA_SHARE_SUBJECT = "share_subject"
        const val EXTRA_SHARE_URI = "share_uri"
        const val EXTRA_SHARE_FILENAME = "share_filename"

        const val PAYLOAD_TYPE_TEXT = "text"
        const val PAYLOAD_TYPE_IMAGE = "image"
        const val PAYLOAD_TYPE_FILE = "file"
    }
}

// ── Share payload sealed class ────────────────────────────────────────────────

sealed class SharePayload {
    abstract val type: String

    data class Text(val text: String, val subject: String? = null) : SharePayload() {
        override val type = ShareReceiver.PAYLOAD_TYPE_TEXT
    }
    data class Image(val uri: Uri, val mimeType: String) : SharePayload() {
        override val type = ShareReceiver.PAYLOAD_TYPE_IMAGE
    }
    data class File(val uri: Uri, val mimeType: String, val filename: String) : SharePayload() {
        override val type = ShareReceiver.PAYLOAD_TYPE_FILE
    }
}

// ── Session picker UI ─────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionPickerDialog(
    payload: SharePayload,
    onSessionSelected: (Session) -> Unit,
    onNewSession: () -> Unit,
    onDismiss: () -> Unit
) {
    var sessions by remember { mutableStateOf<List<Session>?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Load sessions via Koin DI. ShareReceiver is a ComponentActivity so the
    // Koin `get()` extension is available on the Activity instance captured via
    // LocalContext.
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            try {
                val koin = GlobalContext.get()
                val repo = koin.get<SessionRepository>()
                sessions = repo.getSessions().getOrNull() ?: emptyList()
            } catch (_: Exception) {
                sessions = emptyList()
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.native_send_to_session)) },
        text = {
            val payloadSummary = when (payload) {
                is SharePayload.Text -> "\"${payload.text.take(60)}${if (payload.text.length > 60) "…" else ""}\""
                is SharePayload.Image -> stringResource(R.string.native_image)
                is SharePayload.File -> payload.filename
            }
            Column {
                Text(
                    text = payloadSummary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(12.dp))

                when (val s = sessions) {
                    null -> CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                    else -> {
                        if (s.isEmpty()) {
                            Text(
                                text = stringResource(R.string.native_no_existing_sessions),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        } else {
                            LazyColumn(modifier = Modifier.weight(1f, fill = false)) {
                                items(s.take(8)) { session ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { selectedId = session.id }
                                            .padding(vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        RadioButton(
                                            selected = selectedId == session.id,
                                            onClick = { selectedId = session.id }
                                        )
                                        Spacer(Modifier.width(8.dp))
                                        Column {
                                            Text(
                                                text = session.name,
                                                style = MaterialTheme.typography.bodyMedium
                                            )
                                            Text(
                                                text = session.status.name.lowercase(),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = onNewSession) {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.native_new_session))
                }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        val id = selectedId
                        val s = sessions?.firstOrNull { it.id == id }
                        if (s != null) onSessionSelected(s) else onNewSession()
                    },
                    enabled = selectedId != null || sessions?.isEmpty() == true
                ) {
                    Text(stringResource(R.string.native_send))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.native_cancel)) }
        }
    )
}
