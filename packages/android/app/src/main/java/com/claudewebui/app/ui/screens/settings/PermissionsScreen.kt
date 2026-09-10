package com.claudewebui.app.ui.screens.settings

import com.claudewebui.app.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Permission policy is session-scoped on the server. The former screen edited
 * an in-memory rule list that no harness consumed, so this page now documents
 * the real controls instead of presenting non-functional switches.
 */
@Composable
fun PermissionsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    val screenResources = androidx.compose.ui.platform.LocalContext.current.resources
    androidx.compose.ui.platform.LocalConfiguration.current

    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.md),
            ) {
                item {
                    PlumScreenHeader(
                        title = screenResources.getString(R.string.settings_permissions_d06d5),
                        subtitle = screenResources.getString(R.string.settings_controls_the_active_harness_per_session_04007),
                        actions = {
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                screenResources.getString(R.string.settings_back_b52b3),
                                onNavigateBack,
                            )
                        },
                    )
                }
                item {
                    PermissionFact(
                        icon = { Icon(Icons.Outlined.Security, null, tint = PlumAccent) },
                        title = screenResources.getString(R.string.settings_execution_mode_cb9e1),
                        body = screenResources.getString(R.string.settings_open_a_chat_then_session_settings_plan_auto_manual_and_danger_are_ac545),
                    )
                }
                item {
                    PermissionFact(
                        icon = { Icon(Icons.Outlined.FolderOpen, null, tint = PlumAccent) },
                        title = screenResources.getString(R.string.settings_allowed_directories_e2e89),
                        body = screenResources.getString(R.string.settings_additional_server_paths_are_managed_in_the_same_session_settings_ef0d9),
                    )
                }
                item {
                    Text(
                        screenResources.getString(R.string.settings_tool_specific_global_rules_are_not_a_plum_webui_server_concept_th_8da04),
                        color = PlumMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(screenTokens.spacing.sm),
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionFact(
    icon: @Composable () -> Unit,
    title: String,
    body: String,
) {
    val screenTokens = com.claudewebui.app.ui.theme.PlumTheme.tokens

    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(Modifier.padding(screenTokens.spacing.lg), verticalArrangement = Arrangement.spacedBy(screenTokens.spacing.sm)) {
            icon()
            Text(title, color = PlumText, fontWeight = FontWeight.Bold)
            Text(body, color = PlumMuted, fontSize = 12.sp)
        }
    }
}
