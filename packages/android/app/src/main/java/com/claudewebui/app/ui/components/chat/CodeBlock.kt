package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.ui.theme.PlumTheme
import androidx.compose.ui.res.stringResource
import com.claudewebui.app.R
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import kotlinx.coroutines.delay

// ── Syntax Highlighting Colors ───────────────────────────────────────────────

private object SyntaxColors {
    val background = Color(0xFF1E1E1C)
    val defaultText = Color(0xFFD4D4D4)
    val keyword = Color(0xFF569CD6)
    val string = Color(0xFFCE9178)
    val comment = Color(0xFF6A9955)
    val number = Color(0xFFB5CEA8)
    val type = Color(0xFF4EC9B0)
    val function = Color(0xFFDCDCAA)
    val variable = Color(0xFF9CDCFE)
    val operator = Color(0xFFD4D4D4)
    val punctuation = Color(0xFFD4D4D4)
    val annotation = Color(0xFFDCDCAA)
    val constant = Color(0xFF4FC1FF)
    val lineNumber = Color(0xFF858585)
    val headerBg = Color(0xFF2D2D2B)
    val divider = Color(0xFF3E3E3C)
}

// ── Token Types ───────────────────────────────────────────────────────────────

private enum class TokenType {
    DEFAULT, KEYWORD, STRING, COMMENT, NUMBER, TYPE, FUNCTION, VARIABLE, OPERATOR, ANNOTATION
}

// ── Language Keyword Sets ─────────────────────────────────────────────────────

private val KOTLIN_KEYWORDS = setOf(
    "fun", "val", "var", "class", "object", "interface", "enum", "sealed", "data",
    "abstract", "open", "override", "final", "private", "protected", "internal", "public",
    "companion", "lateinit", "lazy", "by", "in", "out", "reified", "inline", "noinline",
    "crossinline", "return", "if", "else", "when", "for", "while", "do", "try", "catch",
    "finally", "throw", "import", "package", "as", "is", "it", "true", "false", "null",
    "this", "super", "init", "constructor", "get", "set", "field", "suspend", "coroutine"
)

private val JAVA_KEYWORDS = setOf(
    "public", "private", "protected", "static", "final", "abstract", "class", "interface",
    "extends", "implements", "import", "package", "new", "return", "if", "else", "for",
    "while", "do", "try", "catch", "finally", "throw", "throws", "void", "int", "long",
    "double", "float", "boolean", "char", "byte", "short", "null", "true", "false",
    "this", "super", "instanceof", "enum", "synchronized", "volatile", "transient",
    "native", "strictfp", "assert", "break", "continue", "switch", "case", "default"
)

private val TYPESCRIPT_KEYWORDS = setOf(
    "const", "let", "var", "function", "class", "interface", "type", "enum", "namespace",
    "module", "import", "export", "from", "default", "return", "if", "else", "for", "of",
    "in", "while", "do", "try", "catch", "finally", "throw", "new", "this", "super",
    "extends", "implements", "abstract", "static", "readonly", "public", "private", "protected",
    "null", "undefined", "true", "false", "async", "await", "typeof", "instanceof", "void",
    "never", "any", "string", "number", "boolean", "object", "symbol", "as", "keyof", "infer"
)

private val PYTHON_KEYWORDS = setOf(
    "def", "class", "import", "from", "as", "return", "if", "elif", "else", "for", "while",
    "in", "not", "and", "or", "is", "None", "True", "False", "try", "except", "finally",
    "raise", "with", "yield", "lambda", "pass", "break", "continue", "global", "nonlocal",
    "assert", "del", "print", "self", "super", "property", "staticmethod", "classmethod",
    "async", "await"
)

private val BASH_KEYWORDS = setOf(
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "in", "esac",
    "function", "return", "exit", "echo", "export", "local", "readonly", "shift", "source",
    "trap", "eval", "exec", "set", "unset"
)

private fun getKeywordsForLanguage(lang: String): Set<String> = when (lang.lowercase()) {
    "kotlin", "kt" -> KOTLIN_KEYWORDS
    "java" -> JAVA_KEYWORDS
    "typescript", "ts", "tsx", "javascript", "js", "jsx" -> TYPESCRIPT_KEYWORDS
    "python", "py" -> PYTHON_KEYWORDS
    "bash", "sh", "shell", "zsh" -> BASH_KEYWORDS
    else -> emptySet()
}

// ── Simple Tokenizer ──────────────────────────────────────────────────────────

private data class Token(val text: String, val type: TokenType)

private fun tokenize(code: String, language: String): List<Token> {
    val keywords = getKeywordsForLanguage(language)
    val tokens = mutableListOf<Token>()
    var i = 0
    val len = code.length

    while (i < len) {
        val ch = code[i]

        // Line comment //
        if (i + 1 < len && ch == '/' && code[i + 1] == '/') {
            val end = code.indexOf('\n', i).let { if (it < 0) len else it }
            tokens.add(Token(code.substring(i, end), TokenType.COMMENT))
            i = end
            continue
        }

        // Block comment /* */
        if (i + 1 < len && ch == '/' && code[i + 1] == '*') {
            val end = code.indexOf("*/", i + 2).let { if (it < 0) len else it + 2 }
            tokens.add(Token(code.substring(i, end), TokenType.COMMENT))
            i = end
            continue
        }

        // Python/shell comment #
        if (ch == '#' && language in listOf("python", "py", "bash", "sh", "shell")) {
            val end = code.indexOf('\n', i).let { if (it < 0) len else it }
            tokens.add(Token(code.substring(i, end), TokenType.COMMENT))
            i = end
            continue
        }

        // String literal " or '
        if (ch == '"' || ch == '\'') {
            val quote = ch
            val sb = StringBuilder().append(ch)
            i++
            while (i < len) {
                val c = code[i]
                sb.append(c)
                if (c == '\\' && i + 1 < len) {
                    i++
                    sb.append(code[i])
                } else if (c == quote) {
                    i++
                    break
                }
                i++
            }
            tokens.add(Token(sb.toString(), TokenType.STRING))
            continue
        }

        // Template literal `
        if (ch == '`') {
            val sb = StringBuilder().append(ch)
            i++
            while (i < len) {
                val c = code[i]
                sb.append(c)
                if (c == '\\' && i + 1 < len) {
                    i++
                    sb.append(code[i])
                } else if (c == '`') {
                    i++
                    break
                }
                i++
            }
            tokens.add(Token(sb.toString(), TokenType.STRING))
            continue
        }

        // Number
        if (ch.isDigit() || (ch == '-' && i + 1 < len && code[i + 1].isDigit() &&
                    (i == 0 || !code[i - 1].isLetterOrDigit()))) {
            val sb = StringBuilder()
            if (ch == '-') { sb.append(ch); i++ }
            while (i < len && (code[i].isDigit() || code[i] == '.' || code[i] == 'x' ||
                        code[i] == 'X' || code[i] in 'a'..'f' || code[i] in 'A'..'F' ||
                        code[i] == 'L' || code[i] == 'f')) {
                sb.append(code[i]); i++
            }
            tokens.add(Token(sb.toString(), TokenType.NUMBER))
            continue
        }

        // Annotation @ (for Kotlin/Java/Python)
        if (ch == '@') {
            val sb = StringBuilder().append(ch)
            i++
            while (i < len && (code[i].isLetterOrDigit() || code[i] == '_')) {
                sb.append(code[i]); i++
            }
            tokens.add(Token(sb.toString(), TokenType.ANNOTATION))
            continue
        }

        // Word (keyword or identifier)
        if (ch.isLetter() || ch == '_') {
            val sb = StringBuilder()
            while (i < len && (code[i].isLetterOrDigit() || code[i] == '_')) {
                sb.append(code[i]); i++
            }
            val word = sb.toString()
            val type = when {
                keywords.contains(word) -> TokenType.KEYWORD
                word[0].isUpperCase() -> TokenType.TYPE
                i < len && code[i] == '(' -> TokenType.FUNCTION
                else -> TokenType.DEFAULT
            }
            tokens.add(Token(word, type))
            continue
        }

        // Default
        tokens.add(Token(ch.toString(), TokenType.DEFAULT))
        i++
    }

    return tokens
}

private fun colorForToken(type: TokenType): Color = when (type) {
    TokenType.KEYWORD -> SyntaxColors.keyword
    TokenType.STRING -> SyntaxColors.string
    TokenType.COMMENT -> SyntaxColors.comment
    TokenType.NUMBER -> SyntaxColors.number
    TokenType.TYPE -> SyntaxColors.type
    TokenType.FUNCTION -> SyntaxColors.function
    TokenType.VARIABLE -> SyntaxColors.variable
    TokenType.OPERATOR -> SyntaxColors.operator
    TokenType.ANNOTATION -> SyntaxColors.annotation
    else -> SyntaxColors.defaultText
}

private fun buildHighlightedCode(code: String, language: String): AnnotatedString {
    val tokens = tokenize(code, language)
    return buildAnnotatedString {
        for (token in tokens) {
            withStyle(SpanStyle(color = colorForToken(token.type))) {
                append(token.text)
            }
        }
    }
}

// ── CodeBlock Composable ──────────────────────────────────────────────────────

@Composable
fun CodeBlock(
    code: String,
    language: String = "",
    modifier: Modifier = Modifier,
    showLineNumbers: Boolean = false,
) {
    val componentTokens = PlumTheme.tokens
    val clipboardManager = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    val scrollState = rememberScrollState()

    val highlightedCode = remember(code, language) {
        if (language.isNotEmpty()) buildHighlightedCode(code, language)
        else AnnotatedString(code)
    }

    val lines = remember(code) { code.lines() }

    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(componentTokens.radius.sm))
            .background(SyntaxColors.background)
    ) {
        // Header bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(SyntaxColors.headerBg)
                .padding(horizontal = componentTokens.spacing.md, vertical = componentTokens.spacing.inline),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = language.ifEmpty { stringResource(R.string.component_code) },
                style = MaterialTheme.typography.labelSmall,
                color = SyntaxColors.lineNumber,
                fontFamily = JetBrainsMonoFamily,
                fontSize = 11.sp,
            )
            IconButton(
                onClick = {
                    clipboardManager.setText(AnnotatedString(code))
                    copied = true
                },
                modifier = Modifier.size(28.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.ContentCopy,
                    contentDescription = if (copied) stringResource(R.string.component_copied) else stringResource(R.string.component_copy_code),
                    tint = if (copied) Color(0xFF22C55E) else SyntaxColors.lineNumber,
                    modifier = Modifier.size(componentTokens.sizing.iconXs),
                )
            }
        }

        // Divider
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(SyntaxColors.divider)
        )

        // Code content
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(scrollState)
                .padding(componentTokens.spacing.md)
        ) {
            // Line numbers
            if (showLineNumbers && lines.size > 1) {
                Column(
                    modifier = Modifier.padding(end = componentTokens.spacing.lg),
                    horizontalAlignment = Alignment.End,
                ) {
                    lines.forEachIndexed { idx, _ ->
                        Text(
                            text = "${idx + 1}",
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = JetBrainsMonoFamily,
                            color = SyntaxColors.lineNumber,
                            fontSize = 12.sp,
                            lineHeight = 20.sp,
                        )
                    }
                }
            }

            // Code text
            Text(
                text = if (language.isNotEmpty()) highlightedCode else AnnotatedString(code),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = JetBrainsMonoFamily,
                    fontSize = 12.sp,
                    lineHeight = 20.sp,
                    color = SyntaxColors.defaultText,
                ),
            )
        }
    }
}

// ── Inline Code Span ──────────────────────────────────────────────────────────

@Composable
fun InlineCode(
    code: String,
    modifier: Modifier = Modifier,
) {
    val componentTokens = PlumTheme.tokens
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(componentTokens.radius.xs))
            .background(SyntaxColors.background)
            .padding(horizontal = componentTokens.spacing.inline, vertical = componentTokens.spacing.xxs)
    ) {
        Text(
            text = code,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontFamily = JetBrainsMonoFamily,
                fontSize = 13.sp,
                color = Color(0xFFCE9178),
            ),
        )
    }
}
