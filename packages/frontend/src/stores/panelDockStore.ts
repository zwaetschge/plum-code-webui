import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Session tools that can sit beside the chat. The four fixed tools of a code
 * session (Dateien, Versionen, Vorschau, Verbindungen) and Fortschritt group
 * what used to be separate panels: Versionen holds Git, GitHub and
 * Checkpoints as tabs, Verbindungen holds the Android devices and the
 * browser, Fortschritt holds goal, todos and subagents.
 */
export type DockablePanel =
  | 'files'
  | 'progress'
  | 'config'
  | 'mesh'
  | 'designStyle'
  | 'writingStyle'
  | 'tools'
  | 'connections'
  | 'versions'
  | 'notes'
  | 'preview'
  | 'toolLog';

const DOCKABLE_PANELS: DockablePanel[] = [
  'files',
  'progress',
  'config',
  'mesh',
  'designStyle',
  'writingStyle',
  'tools',
  'connections',
  'versions',
  'notes',
  'preview',
  'toolLog',
];

/** Former single panels and the grouped panel that now contains them. */
const LEGACY_PANEL_GROUPS: Record<string, DockablePanel> = {
  tasks: 'progress',
  agents: 'progress',
  git: 'versions',
  github: 'versions',
  checkpoints: 'versions',
  android: 'connections',
  browser: 'connections',
};

function unpinnedPanels(): Record<DockablePanel, boolean> {
  return Object.fromEntries(DOCKABLE_PANELS.map((panel) => [panel, false])) as Record<
    DockablePanel,
    boolean
  >;
}

/** Carries a pinned old panel over to the grouped panel that replaced it. */
export function migratePinnedPanels(stored: Record<string, boolean> | undefined) {
  const pinned = unpinnedPanels();
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (!value) continue;
    const target = LEGACY_PANEL_GROUPS[key] ?? (key as DockablePanel);
    if (target in pinned) pinned[target] = true;
  }
  return pinned;
}

interface PanelDockState {
  pinned: Record<DockablePanel, boolean>;
  togglePin: (panel: DockablePanel) => void;
  setPinned: (panel: DockablePanel, pinned: boolean) => void;
  unpinAll: () => void;
}

export const usePanelDockStore = create<PanelDockState>()(
  persist(
    (set) => ({
      pinned: unpinnedPanels(),
      togglePin: (panel) =>
        set((state) => ({
          pinned: { ...state.pinned, [panel]: !state.pinned[panel] },
        })),
      setPinned: (panel, pinned) =>
        set((state) => ({
          pinned: { ...state.pinned, [panel]: pinned },
        })),
      unpinAll: () => set({ pinned: unpinnedPanels() }),
    }),
    {
      name: 'claude-webui-panel-dock',
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { pinned?: Record<string, boolean> } | undefined;
        return { pinned: migratePinnedPanels(state?.pinned) } as PanelDockState;
      },
    }
  )
);
