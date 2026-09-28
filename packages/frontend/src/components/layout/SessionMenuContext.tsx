import { createContext, useContext } from 'react';

export type NavigationView = 'sessions' | 'tools';

/** The session owns its controls; the shell supplies their single visible menu slot. */
export const SessionMenuContext = createContext<{
  target: HTMLDivElement | null;
  setDesktopTarget: (target: HTMLDivElement | null) => void;
  setMobileTarget: (target: HTMLDivElement | null) => void;
  view: NavigationView;
  setView: (view: NavigationView) => void;
  closeNavigation: () => void;
} | null>(null);

export function useSessionMenu() {
  const context = useContext(SessionMenuContext);
  if (!context) throw new Error('Session menu requires the application layout');
  return context;
}
