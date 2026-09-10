package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.ui.theme.PlumTheme

import com.claudewebui.app.R
import androidx.compose.ui.res.stringResource

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.MessageSearchResult
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumMuted

/** In-chat search: a query field over a result list keyed by message id. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatSearchSheet(
    query: String,
    results: List<MessageSearchResult>,
    isSearching: Boolean,
    error: String?,
    onQueryChange: (String) -> Unit,
    onResultClick: (MessageSearchResult) -> Unit,
    onDismiss: () -> Unit,
) {
    val t = PlumTheme.tokens
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(.82f)
                .padding(horizontal = t.spacing.lg),
            verticalArrangement = Arrangement.spacedBy(t.spacing.compact),
        ) {
            Text(stringResource(R.string.chat_search_title), style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                trailingIcon = if (query.isNotEmpty()) {
                    {
                        IconButton(onClick = { onQueryChange("") }) {
                            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.chat_clear_search))
                        }
                    }
                } else null,
                placeholder = { Text(stringResource(R.string.chat_search_placeholder)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
            when {
                isSearching -> LinearProgressIndicator(Modifier.fillMaxWidth())
                error != null -> Text(error, color = MaterialTheme.colorScheme.error)
                query.length >= 2 && results.isEmpty() -> Text(
                    stringResource(R.string.chat_no_matches),
                    color = PlumMuted,
                    modifier = Modifier.padding(vertical = t.spacing.section),
                )
            }
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(t.spacing.inline),
                contentPadding = PaddingValues(bottom = 28.dp),
            ) {
                items(results, key = { it.id }) { result ->
                    Surface(
                        onClick = { onResultClick(result) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(t.spacing.cozy),
                        color = MaterialTheme.colorScheme.surfaceContainer,
                    ) {
                        Column(
                            Modifier.padding(t.spacing.cozy),
                            verticalArrangement = Arrangement.spacedBy(t.spacing.xs),
                        ) {
                            Text(
                                text = result.role.replaceFirstChar { it.uppercase() },
                                style = MaterialTheme.typography.labelMedium,
                                color = PlumAccent,
                            )
                            Text(
                                text = searchSnippet(result.content, query),
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}
