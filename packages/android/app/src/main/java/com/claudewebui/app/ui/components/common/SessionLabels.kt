package com.claudewebui.app.ui.components.common

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import com.claudewebui.app.data.model.ActiveFollowupMode
import com.claudewebui.app.data.model.ReasoningLevel
import com.claudewebui.app.data.model.ServiceTier
import com.claudewebui.app.data.model.SessionMode

private val SessionMode.labelResource: Int get() = when (this) {
    SessionMode.PLANNING -> R.string.component_mode_plan
    SessionMode.AUTO_ACCEPT -> R.string.component_mode_auto
    SessionMode.MANUAL -> R.string.component_mode_manual
    SessionMode.DANGER -> R.string.component_mode_danger
}
private val SessionMode.descriptionResource: Int get() = when (this) {
    SessionMode.PLANNING -> R.string.component_mode_plan_description
    SessionMode.AUTO_ACCEPT -> R.string.component_mode_auto_description
    SessionMode.MANUAL -> R.string.component_mode_manual_description
    SessionMode.DANGER -> R.string.component_mode_danger_description
}
private val ReasoningLevel.labelResource: Int get() = when (this) {
    ReasoningLevel.NONE -> R.string.component_none
    ReasoningLevel.MINIMAL -> R.string.component_reasoning_minimal
    ReasoningLevel.LOW -> R.string.component_reasoning_low
    ReasoningLevel.MEDIUM -> R.string.component_reasoning_medium
    ReasoningLevel.HIGH -> R.string.component_reasoning_high
    ReasoningLevel.XHIGH -> R.string.component_reasoning_xhigh
    ReasoningLevel.MAX -> R.string.component_reasoning_max
    ReasoningLevel.ULTRA -> R.string.component_reasoning_ultra
}
private val ActiveFollowupMode.labelResource: Int get() = when (this) {
    ActiveFollowupMode.QUEUE -> R.string.component_followup_queue
    ActiveFollowupMode.STEER -> R.string.component_followup_steer
}

@Composable fun SessionMode.localizedLabel(): String = stringResource(labelResource)
fun SessionMode.localizedLabel(context: Context): String = context.getString(labelResource)
@Composable fun SessionMode.localizedDescription(): String = stringResource(descriptionResource)
fun SessionMode.localizedDescription(context: Context): String = context.getString(descriptionResource)
@Composable fun ReasoningLevel.localizedLabel(): String = stringResource(labelResource)
fun ReasoningLevel.localizedLabel(context: Context): String = context.getString(labelResource)
@Composable fun ServiceTier.localizedLabel(): String = stringResource(R.string.component_service_fast)
fun ServiceTier.localizedLabel(context: Context): String = context.getString(R.string.component_service_fast)
@Composable fun ActiveFollowupMode.localizedLabel(): String = stringResource(labelResource)
fun ActiveFollowupMode.localizedLabel(context: Context): String = context.getString(labelResource)
