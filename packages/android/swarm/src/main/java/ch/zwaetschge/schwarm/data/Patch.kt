package com.claudewebui.swarm.data

/**
 * Ein Unified Diff, wie ihn Code-Aufträge als `.patch` liefern (Punkt 13): `git diff` oder
 * `git format-patch`, je Datei mit Kopf, Hunks und Zeilen. Nur Text; was nicht passt, bleibt als
 * Kontextzeile stehen, damit nie etwas verschwindet. Werfen darf hier nichts.
 */
enum class PatchArt { KOPF, HUNK, PLUS, MINUS, KONTEXT, HINWEIS }

data class PatchZeile(val art: PatchArt, val text: String, val alt: Int?, val neu: Int?)

data class PatchDatei(
    val pfad: String,
    /** Vorher und nachher, wenn die Datei umbenannt, neu oder gelöscht ist. */
    val altPfad: String?,
    val plus: Int,
    val minus: Int,
    val zeilen: List<PatchZeile>,
    val binaer: Boolean,
) {
    val neu: Boolean get() = altPfad == "/dev/null"
    val geloescht: Boolean get() = pfad == "/dev/null"
}

data class Patch(
    /** Was vor dem ersten Diff steht, bei `format-patch` etwa Betreff und Beschreibung. */
    val vorspann: List<String>,
    val dateien: List<PatchDatei>,
) {
    val plus: Int get() = dateien.sumOf { it.plus }
    val minus: Int get() = dateien.sumOf { it.minus }
}

object PatchLeser {
    private val diffGit = Regex("""^diff --git a/(.+?) b/(.+)$""")
    private val hunk = Regex("""^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@""")

    private class Bau(var pfad: String, var altPfad: String?) {
        val zeilen = ArrayList<PatchZeile>()
        var plus = 0
        var minus = 0
        var binaer = false
        var alt = 0
        var neu = 0
        var imHunk = false

        fun fertig() = PatchDatei(pfad, altPfad?.takeIf { it != pfad }, plus, minus, zeilen.toList(), binaer)
    }

    private fun ohnePraefix(p: String): String {
        val t = p.substringBefore('\t').trim()
        return when {
            t == "/dev/null" -> t
            t.startsWith("a/") || t.startsWith("b/") -> t.substring(2)
            else -> t
        }
    }

    fun lesen(text: String): Patch = runCatching {
        val vorspann = ArrayList<String>()
        val dateien = ArrayList<PatchDatei>()
        var bau: Bau? = null
        val zeilen = text.replace("\r\n", "\n").split('\n')
        var i = 0
        while (i < zeilen.size) {
            val z = zeilen[i]
            // Die Signatur von format-patch („-- “, dann die Git-Version) gehört nicht mehr zum Diff.
            if (z == "-- " && bau != null && i >= zeilen.size - 4) break
            val git = diffGit.find(z)
            // Ohne „diff --git“ beginnt eine Datei mit „--- a/…“ und „+++ b/…“ direkt danach.
            val nurKopf = git == null && z.startsWith("--- ") && zeilen.getOrNull(i + 1)?.startsWith("+++ ") == true &&
                (bau == null || bau.imHunk || bau.zeilen.any { it.art != PatchArt.KOPF })
            when {
                git != null -> {
                    bau?.let { dateien += it.fertig() }
                    bau = Bau(git.groupValues[2], git.groupValues[1]).also { it.zeilen += PatchZeile(PatchArt.KOPF, z, null, null) }
                }
                nurKopf -> {
                    bau?.let { dateien += it.fertig() }
                    bau = Bau(ohnePraefix(zeilen[i + 1].removePrefix("+++ ")), ohnePraefix(z.removePrefix("--- ")))
                    bau.zeilen += PatchZeile(PatchArt.KOPF, z, null, null)
                    bau.zeilen += PatchZeile(PatchArt.KOPF, zeilen[i + 1], null, null)
                    i += 2
                    continue
                }
                bau == null -> vorspann += z
                else -> {
                    val b = bau
                    val h = hunk.find(z)
                    when {
                        h != null -> {
                            b.alt = h.groupValues[1].toIntOrNull() ?: 0
                            b.neu = h.groupValues[3].toIntOrNull() ?: 0
                            b.imHunk = true
                            b.zeilen += PatchZeile(PatchArt.HUNK, z, null, null)
                        }
                        !b.imHunk -> {
                            when {
                                z.startsWith("--- ") -> b.altPfad = ohnePraefix(z.removePrefix("--- "))
                                z.startsWith("+++ ") -> b.pfad = ohnePraefix(z.removePrefix("+++ ")).let { if (it == "/dev/null") "/dev/null" else it }
                                z.startsWith("Binary files") || z.startsWith("GIT binary patch") -> b.binaer = true
                            }
                            b.zeilen += PatchZeile(PatchArt.KOPF, z, null, null)
                        }
                        z.startsWith("+") -> {
                            b.zeilen += PatchZeile(PatchArt.PLUS, z, null, b.neu)
                            b.neu++
                            b.plus++
                        }
                        z.startsWith("-") -> {
                            b.zeilen += PatchZeile(PatchArt.MINUS, z, b.alt, null)
                            b.alt++
                            b.minus++
                        }
                        z.startsWith("\\") -> b.zeilen += PatchZeile(PatchArt.HINWEIS, z, null, null)
                        z.startsWith(" ") || z.isEmpty() -> {
                            // Eine leere Zeile am Ende des Texts ist kein Kontext.
                            if (z.isEmpty() && i == zeilen.lastIndex) break
                            b.zeilen += PatchZeile(PatchArt.KONTEXT, z, b.alt, b.neu)
                            b.alt++
                            b.neu++
                        }
                        // Etwa die Signatur „-- “ von format-patch am Schluss oder ein neuer Kopf.
                        else -> {
                            b.imHunk = false
                            b.zeilen += PatchZeile(PatchArt.KOPF, z, null, null)
                        }
                    }
                }
            }
            i++
        }
        bau?.let { dateien += it.fertig() }
        Patch(vorspann.dropLastWhile { it.isBlank() }, dateien)
    }.getOrElse { Patch(text.lines(), emptyList()) }
}
