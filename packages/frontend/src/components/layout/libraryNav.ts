import type { ComponentType } from 'react';
import {
  BellRing,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  FileStack,
  FolderKanban,
  GraduationCap,
  Layers,
  Repeat,
  UserRound,
} from 'lucide-react';

export type LibrarySection = {
  slug: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/** Library sections shown in the chat's side panel (`?library=<slug>`). */
export const LIBRARY_SECTIONS: LibrarySection[] = [
  { slug: 'projects', label: 'Projekte', icon: FolderKanban },
  { slug: 'sources', label: 'Quellen', icon: BookOpen },
  { slug: 'artifacts', label: 'Ergebnisse', icon: FileStack },
  { slug: 'memory', label: 'Gedächtnis', icon: Brain },
  { slug: 'profiles', label: 'Assistenten', icon: UserRound },
  { slug: 'agents', label: 'Agenten', icon: Bot },
  { slug: 'routines', label: 'Routinen', icon: Repeat },
  { slug: 'collections', label: 'Sammlungen', icon: Layers },
  { slug: 'meetings', label: 'Besprechungen', icon: CalendarClock },
  { slug: 'courses', label: 'Kurse', icon: GraduationCap },
  { slug: 'event-subscriptions', label: 'Ereignisse', icon: BellRing },
];

export const LIBRARY_PARAM = 'library';

/** Current path with the library panel opened on `slug`. */
export function libraryHref(pathname: string, search: string, slug: string) {
  if (slug === 'projects' || slug === 'profiles')
    return '/chat/' + (slug === 'projects' ? 'projects' : 'assistants');
  const params = new URLSearchParams(search);
  params.delete('resource');
  params.delete('revision');
  params.set(LIBRARY_PARAM, slug);
  return `${pathname}?${params}`;
}
