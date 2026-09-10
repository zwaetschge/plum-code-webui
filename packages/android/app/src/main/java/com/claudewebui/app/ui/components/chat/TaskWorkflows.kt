package com.claudewebui.app.ui.components.chat

import androidx.annotation.StringRes
import com.claudewebui.app.R

/** Same six starter workflows and stable IDs as the WebUI taskWorkflows.ts. */
data class TaskWorkflow(
    val id: String,
    @StringRes val title: Int,
    @StringRes val description: Int,
    @StringRes val prompt: Int,
)

val taskWorkflows: List<TaskWorkflow> = listOf(
    TaskWorkflow("quick-brief", R.string.workflow_quick_brief_title, R.string.workflow_quick_brief_description, R.string.workflow_quick_brief_prompt),
    TaskWorkflow("research-brief", R.string.workflow_research_brief_title, R.string.workflow_research_brief_description, R.string.workflow_research_brief_prompt),
    TaskWorkflow("draft-message", R.string.workflow_draft_message_title, R.string.workflow_draft_message_description, R.string.workflow_draft_message_prompt),
    TaskWorkflow("plan-project", R.string.workflow_plan_project_title, R.string.workflow_plan_project_description, R.string.workflow_plan_project_prompt),
    TaskWorkflow("creative-direction", R.string.workflow_creative_direction_title, R.string.workflow_creative_direction_description, R.string.workflow_creative_direction_prompt),
    TaskWorkflow("decision-support", R.string.workflow_decision_support_title, R.string.workflow_decision_support_description, R.string.workflow_decision_support_prompt),
)
