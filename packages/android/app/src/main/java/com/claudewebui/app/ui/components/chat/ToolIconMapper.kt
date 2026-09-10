package com.claudewebui.app.ui.components.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

// ── Tool Icon & Color Mapping ─────────────────────────────────────────────────

data class ToolDisplayInfo(
    val label: String,
    val icon: ImageVector,
    val color: Color,
)

data class AgentDisplayInfo(
    val label: String,
    val icon: ImageVector,
    val color: Color,
    val description: String,
)

object ToolIconMapper {

    @Composable

    fun forTool(toolName: String): ToolDisplayInfo {
        val name = toolName.lowercase().trim()
        return when {
            name == "read" -> ToolDisplayInfo(
                label = stringResource(R.string.component_read_file),
                icon = Icons.Outlined.Description,
                color = Color(0xFF3B82F6),
            )
            name == "write" -> ToolDisplayInfo(
                label = stringResource(R.string.component_write_file),
                icon = Icons.Outlined.Edit,
                color = Color(0xFF22C55E),
            )
            name == "edit" -> ToolDisplayInfo(
                label = stringResource(R.string.component_edit_file),
                icon = Icons.Outlined.DriveFileRenameOutline,
                color = Color(0xFFF59E0B),
            )
            name == "multiedit" -> ToolDisplayInfo(
                label = stringResource(R.string.component_multi_edit),
                icon = Icons.Outlined.EditNote,
                color = Color(0xFFF59E0B),
            )
            name == "bash" -> ToolDisplayInfo(
                label = stringResource(R.string.component_bash),
                icon = Icons.Outlined.Terminal,
                color = Color(0xFF8B5CF6),
            )
            name == "glob" -> ToolDisplayInfo(
                label = stringResource(R.string.component_find_files),
                icon = Icons.Outlined.FolderOpen,
                color = Color(0xFF06B6D4),
            )
            name == "grep" -> ToolDisplayInfo(
                label = stringResource(R.string.component_search),
                icon = Icons.Outlined.Search,
                color = Color(0xFFEC4899),
            )
            name == "todowrite" -> ToolDisplayInfo(
                label = stringResource(R.string.component_update_todos),
                icon = Icons.Outlined.Checklist,
                color = Color(0xFF10B981),
            )
            name == "websearch" -> ToolDisplayInfo(
                label = stringResource(R.string.component_web_search),
                icon = Icons.Outlined.TravelExplore,
                color = Color(0xFF3B82F6),
            )
            name == "webfetch" -> ToolDisplayInfo(
                label = stringResource(R.string.component_fetch_url),
                icon = Icons.Outlined.Download,
                color = Color(0xFF3B82F6),
            )
            name == "notebookedit" || name == "notebookread" -> ToolDisplayInfo(
                label = if (name == "notebookread") stringResource(R.string.component_read_notebook) else stringResource(R.string.component_edit_notebook),
                icon = Icons.Outlined.Book,
                color = Color(0xFFF59E0B),
            )
            name == "agent" || name.contains("agent") -> ToolDisplayInfo(
                label = stringResource(R.string.component_agent),
                icon = Icons.Outlined.Psychology,
                color = Color(0xFFCC785C),
            )
            else -> ToolDisplayInfo(
                label = toolName,
                icon = Icons.Outlined.Build,
                color = Color(0xFF6B7280),
            )
        }
    }

    @Composable

    fun forAgent(agentType: String): AgentDisplayInfo {
        val type = agentType.lowercase().replace("-", " ").replace("_", " ").trim()
        return when {
            type.contains("explore") || type.contains("explorer") -> AgentDisplayInfo(
                label = stringResource(R.string.component_explorer),
                icon = Icons.Outlined.ManageSearch,
                color = Color(0xFF06B6D4),
                description = stringResource(R.string.component_explores_codebase_and_maps_structure),
            )
            type.contains("backend") -> AgentDisplayInfo(
                label = stringResource(R.string.component_backend_dev),
                icon = Icons.Outlined.Storage,
                color = Color(0xFF3B82F6),
                description = stringResource(R.string.component_implements_server_side_logic),
            )
            type.contains("frontend") -> AgentDisplayInfo(
                label = stringResource(R.string.component_frontend_dev),
                icon = Icons.Outlined.Palette,
                color = Color(0xFFEC4899),
                description = stringResource(R.string.component_implements_ui_and_components),
            )
            type.contains("fullstack") || type.contains("full stack") -> AgentDisplayInfo(
                label = stringResource(R.string.component_fullstack_dev),
                icon = Icons.Outlined.Layers,
                color = Color(0xFF8B5CF6),
                description = stringResource(R.string.component_delivers_end_to_end_features),
            )
            type.contains("test") -> AgentDisplayInfo(
                label = stringResource(R.string.component_test_engineer),
                icon = Icons.Outlined.BugReport,
                color = Color(0xFF22C55E),
                description = stringResource(R.string.component_writes_and_runs_tests),
            )
            type.contains("debug") -> AgentDisplayInfo(
                label = stringResource(R.string.component_debugger),
                icon = Icons.Outlined.PestControl,
                color = Color(0xFFEF4444),
                description = stringResource(R.string.component_diagnoses_and_fixes_issues),
            )
            type.contains("security") || type.contains("audit") -> AgentDisplayInfo(
                label = stringResource(R.string.component_security_auditor),
                icon = Icons.Outlined.Security,
                color = Color(0xFFF59E0B),
                description = stringResource(R.string.component_reviews_code_for_security_risks),
            )
            type.contains("architect") -> AgentDisplayInfo(
                label = stringResource(R.string.component_architect),
                icon = Icons.Outlined.AccountTree,
                color = Color(0xFF10B981),
                description = stringResource(R.string.component_designs_system_architecture),
            )
            type.contains("devops") || type.contains("deploy") -> AgentDisplayInfo(
                label = stringResource(R.string.component_devops),
                icon = Icons.Outlined.CloudUpload,
                color = Color(0xFF6366F1),
                description = stringResource(R.string.component_handles_infrastructure_and_deployment),
            )
            type.contains("database") || type.contains("db") -> AgentDisplayInfo(
                label = stringResource(R.string.component_database),
                icon = Icons.Outlined.TableChart,
                color = Color(0xFF14B8A6),
                description = stringResource(R.string.component_designs_schemas_and_queries),
            )
            type.contains("doc") || type.contains("writer") -> AgentDisplayInfo(
                label = stringResource(R.string.component_docs_writer),
                icon = Icons.Outlined.Article,
                color = Color(0xFF64748B),
                description = stringResource(R.string.component_creates_documentation),
            )
            type.contains("research") -> AgentDisplayInfo(
                label = stringResource(R.string.component_researcher),
                icon = Icons.Outlined.Biotech,
                color = Color(0xFF8B5CF6),
                description = stringResource(R.string.component_gathers_and_synthesizes_information),
            )
            type.contains("plan") -> AgentDisplayInfo(
                label = stringResource(R.string.component_planner),
                icon = Icons.Outlined.Assignment,
                color = Color(0xFF0EA5E9),
                description = stringResource(R.string.component_creates_implementation_plans),
            )
            else -> AgentDisplayInfo(
                label = agentType.replaceFirstChar { it.uppercase() },
                icon = Icons.Outlined.SmartToy,
                color = Color(0xFFCC785C),
                description = stringResource(R.string.component_specialized_agent),
            )
        }
    }
}
