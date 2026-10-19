import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { PROJECT_MEMORY, projectMemoryMode } from '@/components/assistant/projectMemory';

export function ChatWorkspace({
  profileId,
  projectId,
  onProfile,
  onProject,
  disabled,
}: {
  profileId: string;
  projectId: string;
  onProfile: (profile: AssistantResource | null) => void;
  onProject: (id: string) => void;
  disabled?: boolean;
}) {
  const owner = useAuthStore((s) => s.user?.id);
  const profiles = useQuery({
    queryKey: ['assistant', 'resources', 'profiles', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/profiles?limit=100')).data.data,
  });
  const projects = useQuery({
    queryKey: ['assistant', 'resources', 'projects', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/projects?limit=100')).data.data,
  });
  const project = projects.data?.find((p) => p.id === projectId);
  return (
    <section aria-label="Assistent und Projekt" className="w-full max-w-3xl space-y-2 text-left">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-[9rem] flex-1 gap-1 text-sm">
          Assistent
          <select
            className="w-full rounded-md border bg-background p-2"
            value={profileId}
            disabled={disabled}
            onChange={(e) => onProfile(profiles.data?.find((p) => p.id === e.target.value) ?? null)}
          >
            <option value="">Plum · Standard</option>
            {profiles.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[9rem] flex-1 gap-1 text-sm">
          Projekt
          <select
            className="w-full rounded-md border bg-background p-2"
            value={projectId}
            disabled={disabled}
            onChange={(e) => onProject(e.target.value)}
          >
            <option value="">Ohne Projekt</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav
        aria-label="Arbeitsbereich öffnen"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        <Link
          className="underline underline-offset-4"
          to={profileId ? '/chat/assistants/' + profileId : '/chat/assistants'}
        >
          {profileId ? 'Zum Assistenten' : 'Assistenten entdecken'}
        </Link>
        <Link
          className="underline underline-offset-4"
          to={projectId ? '/chat/projects/' + projectId : '/chat/projects'}
        >
          {projectId ? 'Zum Projekt' : 'Projekte öffnen'}
        </Link>
        {project && <span>{PROJECT_MEMORY[projectMemoryMode(project.body)].label}</span>}
      </nav>
      {(profiles.isError || projects.isError) && (
        <p role="alert" className="text-sm">
          Arbeitsbereiche konnten nicht geladen werden.{' '}
          <button
            className="underline"
            onClick={() => {
              void profiles.refetch();
              void projects.refetch();
            }}
          >
            Erneut versuchen
          </button>
        </p>
      )}
    </section>
  );
}
