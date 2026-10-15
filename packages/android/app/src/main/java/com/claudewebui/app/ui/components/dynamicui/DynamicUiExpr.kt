package com.claudewebui.app.ui.components.dynamicui

import java.math.BigDecimal

/**
 * Safe expression language for Dynamic UI, a port of
 * `packages/shared/src/utils/dynamicUiExpr.ts`. Formulas such as
 * `start * (1 + rate / 100) ^ years` are tokenised, parsed into an AST and
 * interpreted against a fixed operator and function whitelist. There is no
 * reflection, no property access and no way to reach the host.
 *
 * Values follow the JavaScript model of the WebUI: [Double], [String],
 * [Boolean] or `null`.
 */

typealias UiRow = Map<String, Any?>

sealed interface ExprNode {
    data class Num(val v: Double) : ExprNode
    data class Str(val v: String) : ExprNode
    data class Bool(val v: Boolean) : ExprNode
    data class Id(val name: String) : ExprNode
    data class Unary(val op: String, val arg: ExprNode) : ExprNode
    data class Binary(val op: String, val left: ExprNode, val right: ExprNode) : ExprNode
    data class Cond(val test: ExprNode, val yes: ExprNode, val no: ExprNode) : ExprNode
    data class Call(val fn: String, val args: List<ExprNode>) : ExprNode
}

class ExprException(message: String) : Exception(message)

const val EXPR_MAX_LENGTH = 400
private const val MAX_NODES = 200

private sealed interface Token {
    data class Num(val v: Double) : Token
    data class Str(val v: String) : Token
    data class Id(val v: String) : Token
    data class Op(val v: String) : Token
}

private val OPERATORS = listOf("<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "^", "(", ")", ",", "?", ":", "<", ">", "!")
private val NUMBER = Regex("^(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")
private val IDENT = Regex("^[A-Za-z_][A-Za-z0-9_]*")

private fun isIdentStart(c: Char) = c in 'A'..'Z' || c in 'a'..'z' || c == '_'

private fun tokenize(source: String): List<Token> {
    val tokens = ArrayList<Token>()
    var i = 0
    while (i < source.length) {
        val c = source[i]
        if (c.isWhitespace()) { i++; continue }
        if (c in '0'..'9' || c == '.') {
            val match = NUMBER.find(source.substring(i)) ?: throw ExprException("Ungültige Zahl bei $i")
            tokens += Token.Num(match.value.toDouble())
            i += match.value.length
            continue
        }
        if (c == '"' || c == '\'') {
            val end = source.indexOf(c, i + 1)
            if (end < 0) throw ExprException("Offene Zeichenkette")
            tokens += Token.Str(source.substring(i + 1, end))
            i = end + 1
            continue
        }
        if (isIdentStart(c)) {
            val match = IDENT.find(source.substring(i))!!
            tokens += Token.Id(match.value)
            i += match.value.length
            continue
        }
        val op = OPERATORS.firstOrNull { source.startsWith(it, i) } ?: throw ExprException("Unerwartetes Zeichen \"$c\"")
        tokens += Token.Op(op)
        i += op.length
    }
    return tokens
}

private val BINARY = mapOf(
    "||" to 1, "&&" to 2, "==" to 3, "!=" to 3, "<" to 4, "<=" to 4, ">" to 4, ">=" to 4,
    "+" to 5, "-" to 5, "*" to 6, "/" to 6, "%" to 6, "^" to 8,
)

/** Parses a formula into an AST, or throws [ExprException] with a readable reason. */
fun parseExpr(source: String): ExprNode {
    if (source.length > EXPR_MAX_LENGTH) throw ExprException("Ausdruck zu lang")
    val tokens = tokenize(source)
    var pos = 0
    var nodes = 0
    fun peek(): Token? = tokens.getOrNull(pos)
    fun isOp(v: String): Boolean = (peek() as? Token.Op)?.v == v
    fun expect(v: String) { if (!isOp(v)) throw ExprException("\"$v\" erwartet"); pos++ }
    fun <N : ExprNode> make(node: N): N { if (++nodes > MAX_NODES) throw ExprException("Ausdruck zu komplex"); return node }

    lateinit var expression: (Int) -> ExprNode

    fun primary(): ExprNode {
        val token = tokens.getOrNull(pos++) ?: throw ExprException("Unvollständiger Ausdruck")
        return when (token) {
            is Token.Num -> make(ExprNode.Num(token.v))
            is Token.Str -> make(ExprNode.Str(token.v))
            is Token.Id -> {
                if (token.v == "true" || token.v == "false") return make(ExprNode.Bool(token.v == "true"))
                if (isOp("(")) {
                    pos++
                    val args = ArrayList<ExprNode>()
                    if (!isOp(")")) {
                        do { args += expression(0) } while (isOp(",") && ++pos > 0)
                    }
                    expect(")")
                    if (token.v !in FUNCTIONS) throw ExprException("Unbekannte Funktion ${token.v}")
                    return make(ExprNode.Call(token.v, args))
                }
                make(ExprNode.Id(token.v))
            }
            is Token.Op -> when (token.v) {
                "(" -> { val inner = expression(0); expect(")"); inner }
                "-", "!", "+" -> make(ExprNode.Unary(token.v, expression(7)))
                else -> throw ExprException("Unerwartetes \"${token.v}\"")
            }
        }
    }

    expression = fun(minPrecedence: Int): ExprNode {
        var left = primary()
        while (true) {
            val token = peek() as? Token.Op ?: break
            if (token.v == "?" && minPrecedence == 0) {
                pos++
                val yes = expression(0)
                expect(":")
                val no = expression(0)
                left = make(ExprNode.Cond(left, yes, no))
                continue
            }
            val precedence = BINARY[token.v] ?: break
            if (precedence < minPrecedence) break
            pos++
            // ^ is right-associative, everything else left-associative.
            val right = expression(if (token.v == "^") precedence else precedence + 1)
            left = make(ExprNode.Binary(token.v, left, right))
        }
        return left
    }

    val ast = expression(0)
    if (pos != tokens.size) throw ExprException("Unerwartetes Ende des Ausdrucks")
    return ast
}

interface ExprScope {
    /** State, computed values, loop variables or row fields; null when unknown. */
    fun lookup(name: String): Any?
    /** Rows of a named dataset or view, for the *Of aggregate functions. */
    fun rows(name: String): List<UiRow>
}

// ── JavaScript value semantics ──────────────────────────────────────────────

/** The formula engine's numeric coercion: null and blank text are NaN. */
fun uiNum(value: Any?): Double = when (value) {
    is Double -> value
    is Number -> value.toDouble()
    is Boolean -> if (value) 1.0 else 0.0
    is String -> if (value.isNotBlank()) jsStringToNumber(value.trim()).takeIf { it.isFinite() } ?: Double.NaN else Double.NaN
    else -> Double.NaN
}

/** JavaScript `Number(value)`: null and blank text are 0. */
fun jsNumber(value: Any?): Double = when (value) {
    null -> 0.0
    is String -> if (value.isBlank()) 0.0 else jsStringToNumber(value.trim())
    else -> uiNum(value)
}

private fun jsStringToNumber(text: String): Double = when (text) {
    "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
    "-Infinity" -> Double.NEGATIVE_INFINITY
    else -> if (text.any { it == 'd' || it == 'D' || it == 'f' || it == 'F' }) Double.NaN else text.toDoubleOrNull() ?: Double.NaN
}

fun uiTruthy(value: Any?): Boolean = when (value) {
    null -> false
    is Double -> value != 0.0 && !value.isNaN()
    is Number -> value.toDouble().let { it != 0.0 && !it.isNaN() }
    is Boolean -> value
    is String -> value.isNotEmpty()
    else -> true
}

/** JavaScript `String(value)` for the value types of the engine. */
fun jsString(value: Any?): String = when (value) {
    null -> "null"
    is Double -> jsNumberString(value)
    is Number -> jsNumberString(value.toDouble())
    else -> value.toString()
}

fun jsNumberString(value: Double): String {
    if (value.isNaN()) return "NaN"
    if (value.isInfinite()) return if (value > 0) "Infinity" else "-Infinity"
    if (value == 0.0) return "0"
    val abs = Math.abs(value)
    val decimal = BigDecimal(value.toString())
    if (abs >= 1e-6 && abs < 1e21) return decimal.stripTrailingZeros().toPlainString()
    val stripped = decimal.stripTrailingZeros()
    val digits = stripped.unscaledValue().abs().toString()
    val exponent = digits.length - 1 - stripped.scale()
    val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
    return (if (value < 0) "-" else "") + mantissa + "e" + (if (exponent >= 0) "+" else "") + exponent
}

private fun column(scope: ExprScope, view: Any?, field: Any?): List<Double> {
    val key = jsString(field)
    return scope.rows(jsString(view)).map { uiNum(it[key]) }.filter { it.isFinite() }
}

private fun jsMin(values: List<Double>): Double {
    var result = Double.POSITIVE_INFINITY
    for (value in values) { if (value.isNaN()) return Double.NaN; if (value < result || (value == 0.0 && result == 0.0 && 1 / value < 0)) result = value }
    return result
}

private fun jsMax(values: List<Double>): Double {
    var result = Double.NEGATIVE_INFINITY
    for (value in values) { if (value.isNaN()) return Double.NaN; if (value > result) result = value }
    return result
}

private fun jsRound(x: Double): Double = if (x.isNaN() || x.isInfinite() || Math.abs(x) >= 4.503599627370496E15) x else Math.floor(x + 0.5)

internal typealias Fn = (List<Any?>, ExprScope) -> Any?

internal fun fn(body: Fn): Fn = body

/** Argument [index] as a number; a missing argument is NaN unless a default is given. */
private fun List<Any?>.n(index: Int, default: Double = Double.NaN): Double = if (index < size) uiNum(this[index]) else default

/** The complete set of functions a model may call. */
internal val FUNCTIONS: Map<String, Fn> = mapOf(
    "min" to fn { args, _ -> jsMin(args.map(::uiNum)) },
    "max" to fn { args, _ -> jsMax(args.map(::uiNum)) },
    "abs" to fn { args, _ -> Math.abs(args.n(0)) },
    "floor" to fn { args, _ -> Math.floor(args.n(0)) },
    "ceil" to fn { args, _ -> Math.ceil(args.n(0)) },
    "sqrt" to fn { args, _ -> Math.sqrt(args.n(0)) },
    "log" to fn { args, _ -> Math.log(args.n(0)) },
    "log10" to fn { args, _ -> Math.log10(args.n(0)) },
    "exp" to fn { args, _ -> Math.exp(args.n(0)) },
    "pow" to fn { args, _ -> jsPow(args.n(0), args.n(1)) },
    "round" to fn { args, _ ->
        val x = args.n(0)
        val digits = args.n(1, 0.0)
        val bounded = Math.max(0.0, Math.min(10.0, if (digits.isNaN()) Double.NaN else truncate(digits)))
        val factor = jsPow(10.0, bounded)
        jsRound(x * factor) / factor
    },
    "clamp" to fn { args, _ -> jsMin(listOf(args.n(2), jsMax(listOf(args.n(1), args.n(0))))) },
    "if" to fn { args, _ -> if (uiTruthy(args.getOrNull(0))) args.getOrNull(1) else args.getOrNull(2) },
    // Payment per period for a loan: rate per period, number of periods, present value.
    "pmt" to fn { args, _ ->
        val rate = args.n(0); val periods = args.n(1); val present = args.n(2)
        if (rate == 0.0) present / periods else (present * rate) / (1 - jsPow(1 + rate, -periods))
    },
    // Future value: rate per period, periods, payment per period, present value.
    "fv" to fn { args, _ ->
        val rate = args.n(0); val periods = args.n(1); val payment = args.n(2, 0.0); val present = args.n(3, 0.0)
        if (rate == 0.0) present + payment * periods
        else present * jsPow(1 + rate, periods) + (payment * (jsPow(1 + rate, periods) - 1)) / rate
    },
    "sumOf" to fn { args, scope -> column(scope, args.getOrNull(0) ?: "", args.getOrNull(1) ?: "").sum() },
    "avgOf" to fn { args, scope -> column(scope, args.getOrNull(0) ?: "", args.getOrNull(1) ?: "").let { if (it.isEmpty()) 0.0 else it.sum() / it.size } },
    "minOf" to fn { args, scope -> column(scope, args.getOrNull(0) ?: "", args.getOrNull(1) ?: "").let { if (it.isEmpty()) 0.0 else jsMin(it) } },
    "maxOf" to fn { args, scope -> column(scope, args.getOrNull(0) ?: "", args.getOrNull(1) ?: "").let { if (it.isEmpty()) 0.0 else jsMax(it) } },
    "countOf" to fn { args, scope -> scope.rows(jsString(args.getOrNull(0) ?: "")).size.toDouble() },
)

private fun truncate(x: Double): Double = if (x < 0) Math.ceil(x) else Math.floor(x)

/** JavaScript `**`: unlike Java, `1 ** NaN` and `(±1) ** ±Infinity` are NaN. */
private fun jsPow(base: Double, exponent: Double): Double {
    if (exponent.isNaN()) return Double.NaN
    if (Math.abs(base) == 1.0 && exponent.isInfinite()) return Double.NaN
    return Math.pow(base, exponent)
}

private fun jsEquals(a: Any?, b: Any?): Boolean {
    if (a is Double || b is Double) { val x = uiNum(a); val y = uiNum(b); return x == y }
    return a == b
}

/** Interprets a parsed formula. Unknown names evaluate to null. */
fun evalExpr(node: ExprNode, scope: ExprScope): Any? = when (node) {
    is ExprNode.Num -> node.v
    is ExprNode.Str -> node.v
    is ExprNode.Bool -> node.v
    is ExprNode.Id -> scope.lookup(node.name)
    is ExprNode.Unary -> {
        val value = evalExpr(node.arg, scope)
        when (node.op) { "!" -> !uiTruthy(value); "-" -> -uiNum(value); else -> uiNum(value) }
    }
    is ExprNode.Cond -> if (uiTruthy(evalExpr(node.test, scope))) evalExpr(node.yes, scope) else evalExpr(node.no, scope)
    is ExprNode.Call -> FUNCTIONS[node.fn]?.invoke(node.args.map { evalExpr(it, scope) }, scope)
    is ExprNode.Binary -> when (node.op) {
        "&&" -> uiTruthy(evalExpr(node.left, scope)) && uiTruthy(evalExpr(node.right, scope))
        "||" -> uiTruthy(evalExpr(node.left, scope)) || uiTruthy(evalExpr(node.right, scope))
        else -> {
            val a = evalExpr(node.left, scope)
            val b = evalExpr(node.right, scope)
            when (node.op) {
                "+" -> if (a is String || b is String) (if (a == null) "" else jsString(a)) + (if (b == null) "" else jsString(b)) else uiNum(a) + uiNum(b)
                "-" -> uiNum(a) - uiNum(b)
                "*" -> uiNum(a) * uiNum(b)
                "/" -> if (uiNum(b) == 0.0) Double.NaN else uiNum(a) / uiNum(b)
                "%" -> uiNum(a) % uiNum(b)
                "^" -> jsPow(uiNum(a), uiNum(b))
                "==" -> jsEquals(a, b)
                "!=" -> !jsEquals(a, b)
                "<" -> uiNum(a) < uiNum(b)
                "<=" -> uiNum(a) <= uiNum(b)
                ">" -> uiNum(a) > uiNum(b)
                ">=" -> uiNum(a) >= uiNum(b)
                else -> null
            }
        }
    }
}

/** `{{expr}}` or `{{expr|format}}` placeholders inside display text. */
val TEMPLATE_PATTERN = Regex("""\{\{\s*([^}|]+?)\s*(?:\|\s*([a-zA-Z]+(?::[A-Za-z0-9]+)?)\s*)?\}\}""")
