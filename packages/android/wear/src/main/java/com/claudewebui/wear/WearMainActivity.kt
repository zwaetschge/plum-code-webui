package com.claudewebui.wear

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Watch companion screen: quick stats, the pending-approval list with
 * Approve/Deny buttons, and the open questions with one button per option.
 * Responses go to the phone over the data layer; the phone answers the backend
 * and pushes a fresh snapshot back.
 */
class WearMainActivity : Activity() {

    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(content)
        })
        render(WearSnapshotStore.cached(this))
    }

    override fun onResume() {
        super.onResume()
        executor.execute {
            val snapshot = WearSnapshotStore.readLive(this)
            runOnUiThread { render(snapshot) }
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun render(snapshot: WearSnapshot) {
        content.removeAllViews()
        content.addView(text("Plum Code", 15f, 0xFFCC785C.toInt(), bold = true).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        content.addView(
            text(
                "${snapshot.running} running · ${WearSnapshotStore.fmtTokens(snapshot.tokensToday)} tok · " +
                    "$%.2f".format(snapshot.costToday),
                12f,
                0xFFB7B2C0.toInt(),
            ).apply { gravity = Gravity.CENTER_HORIZONTAL }
        )
        content.addView(spacer(10))

        if (snapshot.approvals.isEmpty() && snapshot.questions.isEmpty()) {
            content.addView(
                text("Nothing waiting on you 🎉", 13f, 0xFF8A8494.toInt()).apply {
                    gravity = Gravity.CENTER_HORIZONTAL
                }
            )
            return
        }

        if (snapshot.approvals.isNotEmpty()) {
            content.addView(text("Approvals", 13f, Color.WHITE, bold = true))
            snapshot.approvals.forEach { approval ->
                content.addView(spacer(8))
                content.addView(text(approval.toolName, 13f, Color.WHITE, bold = true))
                content.addView(text(approval.sessionName, 11f, 0xFF8A8494.toInt()))
                content.addView(LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    addView(actionButton("Approve", 0xFF14532D.toInt()) { respond(approval, true) })
                    addView(spacerH(8))
                    addView(actionButton("Deny", 0xFF7F1D1D.toInt()) { respond(approval, false) })
                })
            }
        }

        if (snapshot.questions.isNotEmpty()) {
            if (snapshot.approvals.isNotEmpty()) content.addView(spacer(14))
            content.addView(text("Questions", 13f, Color.WHITE, bold = true))
            snapshot.questions.forEach { question -> renderQuestion(question) }
        }
    }

    /**
     * One question card. Options become one full-width button each, stacked —
     * a round watch face has no room for more than a couple of words per row,
     * and stacking keeps every label readable however long it is.
     */
    private fun renderQuestion(question: WearQuestion) {
        content.addView(spacer(8))
        content.addView(
            text(question.prompt.ifBlank { "Waiting for an answer" }, 13f, Color.WHITE, bold = true)
        )
        content.addView(text(question.sessionName, 11f, 0xFF8A8494.toInt()))
        if (question.answerable) {
            question.options.forEach { option ->
                content.addView(spacer(4))
                content.addView(
                    actionButton(option, 0xFF3B2A5C.toInt()) { answer(question, option) }
                        .apply {
                            layoutParams = LinearLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.WRAP_CONTENT,
                            )
                        }
                )
            }
        } else {
            // Multi-select, free text or several questions at once: there is no
            // honest one-tap answer, so the watch only offers a way out.
            content.addView(text("Answer on the phone", 11f, 0xFFA78BFA.toInt()))
        }
        content.addView(spacer(4))
        content.addView(
            actionButton("Dismiss", 0xFF3F3B46.toInt()) { answer(question, null) }.apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                )
            }
        )
    }

    /** [option] null rejects the question instead of answering it. */
    private fun answer(question: WearQuestion, option: String?) {
        val payload = JSONObject().apply {
            put("sessionId", question.sessionId)
            put("requestId", question.requestId)
            put("providerSessionId", question.providerSessionId)
            if (option != null) put("answer", option)
        }
        send(payload, WearSnapshotStore.PATH_QUESTION_RESPONSE) { cached ->
            cached.copy(
                questions = cached.questions.filterNot { it.requestId == question.requestId },
            )
        }
    }

    private fun respond(approval: WearApproval, approve: Boolean) {
        val payload = JSONObject().apply {
            put("sessionId", approval.sessionId)
            put("requestId", approval.requestId)
            put("approve", approve)
        }
        send(payload, WearSnapshotStore.PATH_APPROVAL_RESPONSE) { cached ->
            cached.copy(
                approvals = cached.approvals.filterNot { it.requestId == approval.requestId },
            )
        }
    }

    /**
     * Ships one answer to the phone and, only if it got there, applies [evict]
     * to the cached snapshot so the row disappears.
     */
    private fun send(
        payload: JSONObject,
        path: String,
        evict: (WearSnapshot) -> WearSnapshot,
    ) {
        executor.execute {
            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
            // One node, not all of them. Every node that receives this runs
            // WearBridgeService and POSTs the same answer, so a user paired
            // with both a phone and a tablet answered the request twice.
            val sent = runCatching {
                val nodes = Tasks.await(
                    Wearable.getNodeClient(this).connectedNodes,
                    3, TimeUnit.SECONDS,
                )
                nodes.any { node ->
                    runCatching {
                        Tasks.await(
                            Wearable.getMessageClient(this).sendMessage(node.id, path, bytes),
                            3, TimeUnit.SECONDS,
                        )
                    }.isSuccess
                }
            }.getOrDefault(false)

            // Optimistic, but only once the phone has the message — otherwise a
            // watch out of Bluetooth range silently swallowed the answer.
            if (sent) {
                val cached = WearSnapshotStore.cached(this)
                runOnUiThread { render(evict(cached)) }
            } else {
                runOnUiThread {
                    Toast.makeText(this, "Phone unreachable — not sent", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // ── View helpers ───────────────────────────────────────────────────────

    private fun text(value: String, sizeSp: Float, color: Int, bold: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = sizeSp
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
        }

    private fun actionButton(label: String, background: Int, onClick: () -> Unit) =
        Button(this).apply {
            text = label
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(background)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { onClick() }
        }

    private fun spacer(heightDp: Int) = TextView(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(heightDp))
    }

    private fun spacerH(widthDp: Int) = TextView(this).apply {
        layoutParams = LinearLayout.LayoutParams(dp(widthDp), ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
