import { ChevronDown } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ConnectionSection {
  id: string;
  title: string;
  icon: ReactElement;
  /** Short state shown next to the title, e.g. "1 Gerät verbunden". */
  summary?: string;
  content: ReactNode;
}

/**
 * Verbindungen: one container with a section per connection kind (Android
 * devices, SSH hosts, browser). Sections are independent and stay
 * open by default so a single tap reaches each one.
 */
export function ConnectionsPanel({
  sections,
  focus,
  className,
}: {
  sections: ConnectionSection[];
  /** Section opened on top when the panel was requested for one kind. */
  focus?: string | null;
  className?: string;
}) {
  const ordered = focus
    ? [...sections].sort((a, b) => Number(b.id === focus) - Number(a.id === focus))
    : sections;
  return (
    <div className={cn('flex min-h-0 flex-col gap-2 overflow-auto p-2', className)}>
      {ordered.map((section) => (
        <details key={section.id} className="session-connection-section" open>
          <summary className="session-connection-summary">
            <span className="session-connection-icon">{section.icon}</span>
            <span className="min-w-0 flex-1 truncate">{section.title}</span>
            {section.summary && <span className="session-connection-state">{section.summary}</span>}
            <ChevronDown className="session-connection-chevron h-3.5 w-3.5" aria-hidden="true" />
          </summary>
          <div className="session-connection-body">{section.content}</div>
        </details>
      ))}
    </div>
  );
}
