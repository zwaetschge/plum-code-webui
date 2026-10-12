/** Document presets only: neither a connected account nor a runtime identity. */
export const PERSONAL_WORKSPACES = {
  health: {
    title: 'Gesundheitsunterlagen',
    description:
      'Befunde, Terminnotizen und eigene Fragen anhand deiner Originalunterlagen ordnen.',
    instructions:
      'Work only with the explicitly selected project documents. Preserve dates, units, reference ranges and the exact source revision; distinguish a documented finding from an inference and an unanswered question. Summarise records and prepare questions for appointments. Do not invent diagnoses, measurements, current medication or access to a health account. Never carry health details into a different project or persistent personal memory.',
  },
  finance: {
    title: 'Finanzunterlagen',
    description:
      'Abrechnungen, Ausgaben und Vertragsfragen mit Datum, Währung und Belegen vergleichen.',
    instructions:
      'Work only with the explicitly selected project documents. Preserve dates, currencies, reporting periods and the exact source revision. Show the inputs and arithmetic for totals; distinguish recorded amounts from assumptions and missing data. Summarise statements, expenses and contract terms. Do not invent current prices, exchange rates or access to a bank account. Do not place trades or payments; the Trader is a separate runtime. Never carry financial details into a different project or persistent personal memory.',
  },
} as const;
export type PersonalWorkspacePreset = keyof typeof PERSONAL_WORKSPACES;
