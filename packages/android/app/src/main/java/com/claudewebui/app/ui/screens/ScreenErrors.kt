package com.claudewebui.app.ui.screens

import android.content.Context
import com.claudewebui.app.core.diagnostics.Breadcrumbs
import com.claudewebui.app.core.network.toAppError
import kotlinx.coroutines.CancellationException

/** Record the action and failure category; never put request bodies or credentials in diagnostics. */
internal fun Throwable.screenErrorMessage(screen: String, action: String, context: Context? = null): String {
    if (this is CancellationException) throw this
    val appError = toAppError()
    Breadcrumbs.add("screen", "$screen.$action: ${appError.javaClass.simpleName}")
    return if (context == null) appError.userMessage() else appError.userMessage(context)
}
