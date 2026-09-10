package com.claudewebui.app.ui.components.dashboard

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.role
import com.claudewebui.app.R
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.ui.theme.ClaudeWebUITheme

// ── Preset Colors ─────────────────────────────────────────────────────────────

private val presetColors = listOf(
    "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
    "#f97316", "#f59e0b", "#22c55e", "#10b981",
    "#06b6d4", "#3b82f6", "#64748b", "#78716c",
)

// ── CategoryManager ───────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryManager(
    categories: List<Category>,
    onDismiss: () -> Unit,
    onCreate: (name: String, color: String) -> Unit,
    onUpdate: (id: String, name: String, color: String) -> Unit,
    onDelete: (id: String) -> Unit,
    onReorder: (List<Category>) -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var showAddForm by remember { mutableStateOf(false) }
    var editingCategory by remember { mutableStateOf<Category?>(null) }
    var deletingCategory by remember { mutableStateOf<Category?>(null) }

    // Mutable local order for drag-to-reorder
    var orderedCategories by remember(categories) { mutableStateOf(categories) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = {
            Box(
                modifier = Modifier
                    .padding(top = componentTokens.spacing.md, bottom = componentTokens.spacing.xs)
                    .size(width = 36.dp, height = componentTokens.spacing.xs)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = componentTokens.spacing.xl)
                .padding(bottom = componentTokens.spacing.xxl),
        ) {
            // ── Header ───────────────────────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.component_categories),
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.weight(1f),
                )
                FilledIconButton(
                    onClick = { showAddForm = !showAddForm },
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ),
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = stringResource(R.string.component_add_category),
                        modifier = Modifier.size(componentTokens.sizing.iconInline),
                    )
                }
            }

            Spacer(modifier = Modifier.height(componentTokens.spacing.lg))

            // ── Add / Edit Form ───────────────────────────────────────────────
            if (showAddForm || editingCategory != null) {
                CategoryForm(
                    initial = editingCategory,
                    onSubmit = { name, color ->
                        if (editingCategory != null) {
                            onUpdate(editingCategory!!.id, name, color)
                            editingCategory = null
                        } else {
                            onCreate(name, color)
                        }
                        showAddForm = false
                    },
                    onCancel = {
                        showAddForm = false
                        editingCategory = null
                    },
                )
                Spacer(modifier = Modifier.height(componentTokens.spacing.lg))
            }

            // ── Category List ─────────────────────────────────────────────────
            if (orderedCategories.isEmpty() && !showAddForm) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = stringResource(R.string.component_no_categories_yet),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(componentTokens.spacing.inline))
                        TextButton(onClick = { showAddForm = true }) {
                            Text(stringResource(R.string.component_create_your_first_category))
                        }
                    }
                }
            } else {
                // Simple list with manual reorder via move-up/down buttons
                // (Full drag-to-reorder requires external library; this gives the
                //  core functionality without adding a dependency.)
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(minOf(orderedCategories.size * 68, 340).dp),
                    state = rememberLazyListState(),
                    verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.inline),
                ) {
                    itemsIndexed(
                        items = orderedCategories,
                        key = { _, cat -> cat.id },
                    ) { index, cat ->
                        CategoryRow(
                            category = cat,
                            canMoveUp = index > 0,
                            canMoveDown = index < orderedCategories.lastIndex,
                            onMoveUp = {
                                val newList = orderedCategories.toMutableList()
                                newList.add(index - 1, newList.removeAt(index))
                                orderedCategories = newList
                                onReorder(newList)
                            },
                            onMoveDown = {
                                val newList = orderedCategories.toMutableList()
                                newList.add(index + 1, newList.removeAt(index))
                                orderedCategories = newList
                                onReorder(newList)
                            },
                            onEdit = { editingCategory = cat; showAddForm = false },
                            onDelete = { deletingCategory = cat },
                        )
                    }
                }
            }
        }
    }

    // ── Delete confirmation ───────────────────────────────────────────────────
    deletingCategory?.let { cat ->
        AlertDialog(
            onDismissRequest = { deletingCategory = null },
            title = { Text(stringResource(R.string.component_delete_category)) },
            text = {
                Text(
                    stringResource(R.string.component_delete_category_body, cat.name),
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onDelete(cat.id)
                    deletingCategory = null
                }) {
                    Text(stringResource(R.string.component_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingCategory = null }) {
                    Text(stringResource(R.string.component_cancel))
                }
            },
        )
    }
}

// ── Category Row ──────────────────────────────────────────────────────────────

@Composable
private fun CategoryRow(
    category: Category,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.md))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.compact),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Color indicator
        Box(
            modifier = Modifier
                .size(componentTokens.spacing.md)
                .clip(RoundedCornerShape(50))
                .background(parseHexColor(category.color)),
        )
        Spacer(modifier = Modifier.width(componentTokens.spacing.md))

        // Name
        Text(
            text = category.name,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )

        // Drag handle (visual affordance)
        Icon(
            imageVector = Icons.Default.DragHandle,
            contentDescription = null,
            modifier = Modifier.size(componentTokens.sizing.iconInline),
            tint = MaterialTheme.colorScheme.outlineVariant,
        )

        Spacer(modifier = Modifier.width(componentTokens.spacing.xs))

        // Edit
        IconButton(
            onClick = onEdit,
            modifier = Modifier.size(componentTokens.sizing.touchTarget),
        ) {
            Icon(
                imageVector = Icons.Default.Edit,
                contentDescription = stringResource(R.string.component_edit),
                modifier = Modifier.size(componentTokens.sizing.iconSm),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // Delete
        IconButton(
            onClick = onDelete,
            modifier = Modifier.size(componentTokens.sizing.touchTarget),
        ) {
            Icon(
                imageVector = Icons.Default.Delete,
                contentDescription = stringResource(R.string.component_delete),
                modifier = Modifier.size(componentTokens.sizing.iconSm),
                tint = MaterialTheme.colorScheme.error,
            )
        }
    }
}

// ── Category Form ─────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoryForm(
    initial: Category?,
    onSubmit: (name: String, color: String) -> Unit,
    onCancel: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    var name by remember(initial) { mutableStateOf(initial?.name ?: "") }
    var selectedColor by remember(initial) { mutableStateOf(initial?.color ?: presetColors.first()) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.lg))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(componentTokens.spacing.lg),
    ) {
        Text(
            text = if (initial != null) stringResource(R.string.component_edit_category) else stringResource(R.string.component_new_category),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(modifier = Modifier.height(componentTokens.spacing.md))

        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(stringResource(R.string.component_category_name)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(
                onDone = { if (name.isNotBlank()) onSubmit(name.trim(), selectedColor) }
            ),
            shape = RoundedCornerShape(componentTokens.radius.chip),
        )

        Spacer(modifier = Modifier.height(componentTokens.spacing.md))

        Text(
            text = stringResource(R.string.component_color),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(componentTokens.spacing.sm))

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
            verticalArrangement = Arrangement.spacedBy(componentTokens.spacing.sm),
        ) {
            presetColors.forEach { colorHex ->
                ColorSwatch(
                    colorHex = colorHex,
                    isSelected = selectedColor == colorHex,
                    onClick = { selectedColor = colorHex },
                )
            }
        }

        Spacer(modifier = Modifier.height(componentTokens.spacing.lg))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onCancel) {
                Text(stringResource(R.string.component_cancel))
            }
            Spacer(modifier = Modifier.width(componentTokens.spacing.sm))
            Button(
                onClick = { if (name.isNotBlank()) onSubmit(name.trim(), selectedColor) },
                enabled = name.isNotBlank(),
                shape = RoundedCornerShape(componentTokens.radius.chip),
            ) {
                Text(if (initial != null) stringResource(R.string.component_save) else stringResource(R.string.component_create))
            }
        }
    }
}

// ── Color Swatch ──────────────────────────────────────────────────────────────

@Composable
private fun ColorSwatch(
    colorHex: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val componentTokens = PlumTheme.tokens
    val color = parseHexColor(colorHex)
    val description = stringResource(R.string.component_color_choice, colorHex)
    val borderColor by animateColorAsState(
        targetValue = if (isSelected) color else Color.Transparent,
        animationSpec = tween(componentTokens.motion.fast),
        label = "swatchBorder",
    )

    Box(
        modifier = Modifier
            .size(componentTokens.sizing.touchTarget)
            .semantics { contentDescription = description; selected = isSelected; role = androidx.compose.ui.semantics.Role.RadioButton }
            .clip(RoundedCornerShape(componentTokens.radius.sm))
            .background(color)
            .border(
                width = 2.5.dp,
                color = borderColor,
                shape = RoundedCornerShape(componentTokens.radius.sm),
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (isSelected) {
            Icon(
                imageVector = Icons.Default.Check,
                contentDescription = null,
                modifier = Modifier.size(componentTokens.sizing.iconSm),
                tint = Color.White,
            )
        }
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

@Preview(showBackground = true)
@Composable
private fun CategoryManagerPreview() {
    ClaudeWebUITheme {
        CategoryManager(
            categories = listOf(
                Category("1", "u", "Work", "#6366f1", "folder", 0, ""),
                Category("2", "u", "Personal", "#22c55e", "folder", 1, ""),
                Category("3", "u", "Research", "#f59e0b", "folder", 2, ""),
            ),
            onDismiss = {},
            onCreate = { _, _ -> },
            onUpdate = { _, _, _ -> },
            onDelete = {},
            onReorder = {},
        )
    }
}
