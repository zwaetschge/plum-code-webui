import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DockablePanel =
  | 'files'
  | 'tasks'
  | 'config'
  | 'mesh'
  | 'designStyle'
  | 'writingStyle'
  | 'android'
  | 'tools'
  | 'browser'
  | 'git'
  | 'github'
  | 'checkpoints'
  | 'notes'
  | 'preview'
  | 'toolLog';

interface PanelDockState {
  pinned: Record<DockablePanel, boolean>;
  togglePin: (panel: DockablePanel) => void;
  setPinned: (panel: DockablePanel, pinned: boolean) => void;
  unpinAll: () => void;
}

export const usePanelDockStore = create<PanelDockState>()(
  persist(
    (set) => ({
      pinned: {
        files: false,
        tasks: false,
        config: false,
        mesh: false,
        designStyle: false,
        writingStyle: false,
        android: false,
        tools: false,
        browser: false,
        git: false,
        github: false,
        checkpoints: false,
        notes: false,
        preview: false,
        toolLog: false,
      },
      togglePin: (panel) =>
        set((state) => ({
          pinned: { ...state.pinned, [panel]: !state.pinned[panel] },
        })),
      setPinned: (panel, pinned) =>
        set((state) => ({
          pinned: { ...state.pinned, [panel]: pinned },
        })),
      unpinAll: () =>
        set({
          pinned: {
            files: false,
            tasks: false,
            config: false,
            mesh: false,
            designStyle: false,
            writingStyle: false,
            android: false,
            tools: false,
            browser: false,
            git: false,
            github: false,
            checkpoints: false,
            notes: false,
            preview: false,
            toolLog: false,
          },
        }),
    }),
    {
      name: 'claude-webui-panel-dock',
    }
  )
);
