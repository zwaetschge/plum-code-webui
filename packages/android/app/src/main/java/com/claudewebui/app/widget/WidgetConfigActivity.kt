package com.claudewebui.app.widget

import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider

/**
 * Shown by the launcher when any Plum widget is placed. Collects the
 * per-instance options and confirms the widget; cancelling aborts placement,
 * which is the AppWidget contract for configure activities.
 */
class WidgetConfigActivity : ComponentActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        // Abort by default so a back press cancels placement cleanly.
        setResult(RESULT_CANCELED)
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        setContent {
            ConfigSheet(
                initial = WidgetConfigStore.load(this, appWidgetId),
                onConfirm = { config ->
                    WidgetConfigStore.save(this, appWidgetId, config)
                    WidgetHub.pushAll(this)
                    WidgetRefreshWorker.refreshNow(this)
                    setResult(
                        RESULT_OK,
                        Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
                    )
                    finish()
                },
            )
        }
    }
}

@Composable
private fun ConfigSheet(initial: WidgetConfig, onConfirm: (WidgetConfig) -> Unit) {
    var period by remember { mutableStateOf(initial.period) }
    var provider by remember { mutableStateOf(initial.provider) }
    var translucent by remember { mutableStateOf(initial.translucent) }
    val accent = Color(0xFFCC785C)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xCC000000)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
                .background(Color(0xFF16121F), RoundedCornerShape(24.dp))
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(stringResource(R.string.native_widget_options), color = accent, fontSize = 16.sp, fontWeight = FontWeight.Bold)

            SectionLabel(stringResource(R.string.native_range))
            RadioRow(stringResource(R.string.native_today_title), period == "24h") { period = "24h" }
            RadioRow(stringResource(R.string.native_week_title), period == "7d") { period = "7d" }

            SectionLabel(stringResource(R.string.native_provider_filter))
            RadioRow(stringResource(R.string.native_all_providers), provider == null) { provider = null }
            CLIProvider.active.forEach { p ->
                RadioRow(p.displayName, provider == p.displayName) { provider = p.displayName }
            }

            SectionLabel(stringResource(R.string.native_appearance))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { translucent = !translucent },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(R.string.native_translucent),
                    color = Color(0xFFEDEBF0),
                    fontSize = 14.sp,
                    modifier = Modifier.weight(1f),
                )
                Switch(checked = translucent, onCheckedChange = { translucent = it })
            }

            Button(
                onClick = { onConfirm(WidgetConfig(period, provider, translucent)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = accent),
            ) {
                Text(stringResource(R.string.native_add_widget), color = Color.White)
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        color = Color(0xFF8A8494),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 12.dp, bottom = 2.dp),
    )
}

@Composable
private fun RadioRow(label: String, selected: Boolean, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onSelect)
        Text(label, color = Color(0xFFEDEBF0), fontSize = 14.sp)
    }
}

