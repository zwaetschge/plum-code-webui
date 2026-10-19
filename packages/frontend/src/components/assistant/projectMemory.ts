/** ChatGPT project memory. Legacy `contextMode: 'separate'` projects read as project-only. */
export type ProjectMemoryMode = 'default' | 'project-only';
export function projectMemoryMode(body: Record<string, unknown> | undefined): ProjectMemoryMode {
  if (body?.memoryMode === 'project-only' || body?.memoryMode === 'default') return body.memoryMode;
  return body?.contextMode === 'separate' ? 'project-only' : 'default';
}
export const PROJECT_MEMORY: Record<ProjectMemoryMode, { label: string; hint: string }> = {
  default: {
    label: 'Standardgedächtnis',
    hint: 'Chats in diesem Projekt greifen aufeinander zurück und nutzen deine gespeicherten Erinnerungen und frühere Chats. Was hier gelernt wird, steht auch ausserhalb des Projekts zur Verfügung.',
  },
  'project-only': {
    label: 'Nur Projektgedächtnis',
    hint: 'Chats greifen nur auf dieses Projekt zurück: seine Chats, Erinnerungen und Quellen. Persönliche Erinnerungen und Chats ausserhalb bleiben draussen, und nichts von hier gelangt nach aussen.',
  },
};
/** Expert (profile) memory switch, matching the backend `off | read | read-write`. */
export const EXPERT_MEMORY = [
  [
    'off',
    'Aus',
    'Jedes Gespräch beginnt ohne deine persönlichen Erinnerungen, wie bei ChatGPT-GPTs. In einem Projekt gilt dessen Gedächtnis.',
  ],
  [
    'read',
    'Erinnerungen nutzen',
    'Nutzt deine gespeicherten Erinnerungen und früheren Chats, speichert aber nichts Neues.',
  ],
  [
    'read-write',
    'Nutzen und dazulernen',
    'Nutzt dein Gedächtnis und merkt sich Neues, sofern automatisches Lernen in der Personalisierung aktiv ist.',
  ],
] as const;
