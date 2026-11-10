package com.claudewebui.swarm

/**
 * Ob „Teilen → Schwarm“ ein geteiltes Bild lesen darf. Echte Teilen-Menüs reichen `content://`-URIs
 * mit einer Leseberechtigung weiter; ein `file://`-Pfad oder ein Provider der App selbst würde die
 * exportierte Activity dazu bringen, Dateien aus Plums eigenem Speicher zu kopieren.
 *
 * @param schema Schema der URI (`content`, `file`, …).
 * @param authority Authority der URI.
 * @param providerPaket Paket, dem der auflösende ContentProvider gehört (null = unbekannt).
 * @param eigenesPaket Paket der App selbst.
 */
fun geteiltesBildErlaubt(
    schema: String?,
    authority: String?,
    providerPaket: String?,
    eigenesPaket: String,
): Boolean {
    if (!schema.equals("content", ignoreCase = true)) return false
    val auth = authority?.trim().orEmpty()
    if (auth.isEmpty()) return false
    // Eigene Provider heissen `<applicationId>.<name>`; dazu der Paketvergleich für alles Übrige.
    val eigene = auth.split(';').any { it == eigenesPaket || it.startsWith("$eigenesPaket.") }
    if (eigene) return false
    if (providerPaket != null && providerPaket == eigenesPaket) return false
    return true
}
