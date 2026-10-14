import { TaskLimits } from '@/components/assistant/TaskLimits';
import { PersonalWorkspaceStarter } from '@/components/assistant/PersonalWorkspaceStarter';
import { TaskBoard } from '@/components/assistant/TaskBoard';
import { TaskResults, taskResultsReviewed } from '@/components/assistant/TaskResults';
import { CollectionWorkspace } from '@/components/assistant/CollectionWorkspace';
import { ComparisonStarter } from '@/components/assistant/ComparisonWorkspace';
import { TaskImages } from '@/components/assistant/TaskImages';
import { NativeRoutineControls } from '@/components/assistant/NativeRoutineControls';
import { LibrarySearch } from '@/components/assistant/LibrarySearch';
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import './task.css';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  ListTodo,
  Code2,
  Plus,
  ArrowRight,
  Bot,
  BookOpen,
  FileText,
  RefreshCw,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AssistantResource,
  AssistantOverview,
  CLIProvider,
  Session,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deliverAssistant } from '@/services/assistantOutbox';
import { AssistantOutbox } from '@/components/assistant/AssistantOutbox';
import { SharePanel } from '@/components/assistant/SharePanel';
import { ArtifactViewer } from '@/components/assistant/ArtifactViewer';
import { CoursePlayer } from '@/components/assistant/CoursePlayer';
import { MeetingAudio } from '@/components/assistant/MeetingAudio';
import { OfficeSource } from '@/components/assistant/OfficeSource';
import { VoiceSelect } from '@/components/assistant/VoiceSelect';
import { ResourcePicker } from '@/components/assistant/ResourcePicker';
import { LessonEditor, type EditableLesson } from '@/components/assistant/LessonEditor';
import { VoiceComposer } from '@/components/assistant/VoiceComposer';
import { ApiChatStarter } from '@/components/assistant/ApiChatStarter';
import { DatasetImport } from '@/components/assistant/DatasetImport';
import { WebSourceImport, WebSourceWatch } from '@/components/assistant/WebSource';

const SECTIONS = [
  ['/', 'Übersicht'],
  ['/chat', 'Plum Chat'],
  ['/tasks', 'Plum Task'],
  ['/code', 'Plum Code'],
  ['/assistant/agents', 'Agenten'],
  ['/swarm', 'Schwarm'],
  ['/assistant/profiles', 'Profile'],
  ['/assistant/projects', 'Wissen'],
  ['/assistant/memory', 'Gedächtnis'],
  ['/assistant/artifacts', 'Ergebnisse'],
  ['/collaborate', 'Gemeinsame Dokumente'],
  ['/assistant/routines', 'Routinen'],
  ['/assistant/collections', 'Sammlungen'],
  ['/assistant/meetings', 'Meetings'],
  ['/assistant/courses', 'Lernen'],
  ['/assistant/event-subscriptions', 'Quellenbeobachtung'],
] as const;
/** What each library page is for, in plain words (title, intro, button, empty state). */
const SECTION_INFO: Record<string, { title: string; intro: string; add: string; empty: string }> = {
  projects: {
    title: 'Projekte',
    intro: 'Bündle Quellen und Anweisungen zu einem Thema. Plum nutzt sie in passenden Gesprächen.',
    add: 'Neues Projekt',
    empty: 'Lege ein Projekt an, zum Beispiel „Steuern 2026“ oder „Hausbau“.',
  },
  sources: {
    title: 'Quellen',
    intro: 'Dokumente, Notizen und Webseiten, auf die sich Plum beim Antworten stützen darf.',
    add: 'Text hinzufügen',
    empty: 'Lade eine Datei hoch oder füge einen Text hinzu.',
  },
  artifacts: {
    title: 'Ergebnisse',
    intro: 'Was Plum für dich erstellt hat: Dokumente, Tabellen, Präsentationen, Bilder.',
    add: 'Neues Ergebnis',
    empty: 'Ergebnisse aus Chats und Aufgaben landen automatisch hier.',
  },
  memory: {
    title: 'Gedächtnis',
    intro: 'Was sich Plum über dich merkt. Du kannst Einträge prüfen, ändern oder löschen.',
    add: 'Etwas merken',
    empty: 'Noch nichts gemerkt. Schreib z. B. „Ich bin Vegetarier“ oder „Antworte kurz“.',
  },
  profiles: {
    title: 'Profile',
    intro: 'Rollen für Gespräche: eigene Anweisungen, Sprache, Stimme und Gedächtnis.',
    add: 'Neues Profil',
    empty: 'Lege ein Profil an, zum Beispiel „Lernpartner“ oder „Lektor“.',
  },
  agents: {
    title: 'Agenten',
    intro: 'Deine Agenten mit Zustand und Fähigkeiten.',
    add: 'Neuer Agent',
    empty: 'Noch keine Agenten.',
  },
  routines: {
    title: 'Routinen',
    intro: 'Wiederkehrende Aufträge, etwa ein Morgenbriefing an Werktagen.',
    add: 'Neue Routine',
    empty: 'Starte mit einer Vorlage wie dem Morgenbriefing.',
  },
  collections: {
    title: 'Sammlungen',
    intro: 'Fasse Quellen, Ergebnisse und Gespräche zu einer Mappe zusammen.',
    add: 'Neue Sammlung',
    empty: 'Lege eine Sammlung an, um Zusammengehöriges zu bündeln.',
  },
  meetings: {
    title: 'Besprechungen',
    intro: 'Aufnahmen und Transkripte mit Protokoll und daraus abgeleiteten Aufgaben.',
    add: 'Neue Besprechung',
    empty: 'Füge ein Transkript ein oder nimm eine Besprechung auf.',
  },
  courses: {
    title: 'Kurse',
    intro: 'Lernpfade mit Lektionen und Fragen, aus deinen Quellen erstellt.',
    add: 'Neuer Kurs',
    empty: 'Lege einen Kurs an oder lass Plum einen aus deinen Quellen erstellen.',
  },
  'event-subscriptions': {
    title: 'Ereignisse',
    intro: 'Beobachte eine Quelle und lass Plum handeln, sobald sie sich ändert.',
    add: 'Neue Beobachtung',
    empty: 'Wähle eine Quelle aus, die Plum für dich im Blick behalten soll.',
  },
};
/** German labels for stored enum values in the editor. */
const OPTION_LABELS: Record<string, string> = {
  personal: 'Persönlich',
  project: 'Nur in einem Projekt',
  agent: 'Nur für einen Agenten',
  off: 'Aus',
  read: 'Nur lesen',
  'read-write': 'Lesen und merken',
  document: 'Dokument',
  table: 'Tabelle',
  slides: 'Präsentation',
  code: 'Code',
  design: 'Design',
  research: 'Recherche',
  dataset: 'Datensatz',
  notebook: 'Notebook',
  image: 'Bild',
  audio: 'Audio',
  video: 'Video',
  latex: 'LaTeX',
  app: 'App',
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'CSV',
  html: 'HTML',
  text: 'Text',
};
const LABELS: Record<string, string> = Object.fromEntries(
  SECTIONS.map(([path, label]) => [path.split('/').pop() || 'overview', label])
);
LABELS.sources = 'Quellen';
for (const [key, info] of Object.entries(SECTION_INFO)) LABELS[key] = info.title;
const PROVIDERS: CLIProvider[] = ['codex', 'opencode', 'pi', 'kimi', 'vibe', 'zai', 'claude'];
const STATUS: Record<string, string> = {
  draft: 'Entwurf',
  queued: 'Wartet auf Start',
  running: 'In Arbeit',
  waiting_input: 'Ergebnis / Rückfrage',
  paused: 'Pausiert',
  completed: 'Erledigt',
  cancelled: 'Abgebrochen',
  failed: 'Fehlgeschlagen',
  interrupted: 'Unterbrochen',
};
const TEMPLATES: Record<string, Record<string, unknown>> = {
  profiles: {
    instructions: '',
    provider: 'codex',
    model: '',
    language: 'German',
    voice: 'Rufus Beck',
    memory: 'off',
    projectId: '',
  },
  tasks: {
    goal: '',
    provider: 'codex',
    status: 'draft',
    priority: 0,
    deliverables: [],
    agentId: '',
    sourceIds: [],
    profileId: '',
    parentId: '',
  },
  projects: { description: '', instructions: '' },
  sources: { text: '', citation: '', mimeType: 'text/plain', projectId: '' },
  memory: { text: '', scope: 'personal', projectId: '', agentId: '' },
  artifacts: { type: 'document', content: '', format: 'markdown', tags: [], sourceIds: [] },
  routines: {
    goal: '',
    schedule: 'werktags 07:00',
    timezone: 'Europe/Zurich',
    enabled: false,
    owner: 'matrix',
    agentId: '',
  },
  collections: { description: '', resourceIds: [] },
  meetings: { transcript: '', summary: '', taskIds: [] },
  courses: { description: '', lessons: [] },
  'event-subscriptions': {
    sourceId: '',
    profileId: '',
    event: 'source.changed',
    goal: '',
    enabled: false,
  },
};
const ROUTINE_PRESETS = [
  {
    id: 'morning',
    title: 'Mein Morgenbriefing',
    schedule: 'werktags 07:00',
    goal: 'Erstelle mein kurzes Morgenbriefing aus tatsächlich verfügbaren persönlichen Quellen und dem Schwarm-Stand: heute relevante Termine, offene Rückfragen, fällige Aufgaben und drei priorisierte nächste Schritte. Nenne Quellen und Datenstand. Fehlende Kalender-/Mailzugänge ausdrücklich kenntlich machen; keine Termine oder Fakten erfinden. Vorschläge getrennt von bestätigten Fakten ausgeben.',
  },
  {
    id: 'evening',
    title: 'Mein Tagesrückblick',
    schedule: 'täglich 21:00',
    goal: 'Fasse meinen Tag anhand tatsächlich verfügbarer Aufgaben und Schwarm-Rückmeldungen zusammen: erledigte Ergebnisse, offene Punkte, bestätigte Kosten und der nächste sinnvolle Schritt. Unbekannte Kosten bleiben unbekannt. Keine Nachricht oder Aufgabe ohne meine ausdrückliche Entscheidung versenden/starten.',
  },
  {
    id: 'weekly',
    title: 'Mein Wochenüberblick',
    schedule: 'mo 08:00',
    goal: 'Erstelle meinen Wochenüberblick aus verfügbaren eigenen Projektständen, Quellen und offenen Aufgaben. Ordne nach Frist und Bedeutung, zeige ungeklärte Abhängigkeiten und Quellenstand, und schlage höchstens fünf nächste Schritte vor. Veraltete oder nicht zugängliche Informationen kenntlich machen; keine automatischen Zusatzaufträge erzeugen.',
  },
] as const;
const FIELD_LABELS: Record<string, string> = {
  instructions: 'Systemprompt',
  goal: 'Ziel',
  provider: 'Provider',
  language: 'Sprache',
  voice: 'Stimme',
  memory: 'Gedächtnis',
  description: 'Beschreibung',
  text: 'Inhalt',
  scope: 'Gilt für',
  content: 'Ergebnis',
  type: 'Ergebnistyp',
  format: 'Format',
  citation: 'Quellenangabe',
  url: 'Quellenlink',
  schedule: 'Zeitplan',
  timezone: 'Zeitzone',
  priority: 'Priorität',
  budgetUsd: 'Budget (USD)',
  dueAt: 'Frist',
  transcript: 'Transkript',
  summary: 'Protokoll',
  model: 'Modell (leer = Standard)',
  projectId: 'Projekt',
  profileId: 'Profil',
  agentId: 'Agent',
  parentId: 'Übergeordneter Auftrag',
};
function useAssistantList(
  collection: string,
  enabled = true,
  search = '',
  filters: { status?: string; sort?: 'updated' | 'priority' | 'deadline' } = {}
) {
  const account = useAuthStore((state) => state.user?.id);
  const query = useInfiniteQuery({
    queryKey: ['assistant', 'resources', collection, search, account, filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: AssistantResource[] }>(
          `/api/assistant/${collection}?${new URLSearchParams({ offset: String(pageParam), limit: '50', ...(search ? { search } : {}), ...filters })}`
        )
      ).data.data,
    getNextPageParam: (last, _pages, lastOffset) =>
      last.length === 50 ? lastOffset + 50 : undefined,
    enabled,
    refetchInterval: collection === 'tasks' ? 5000 : false,
  });
  const entries = useMemo(
    () => [
      ...new Map(
        (query.data?.pages.flat() ?? []).map((resource) => [resource.id, resource])
      ).values(),
    ],
    [query.data]
  );
  return { ...query, data: query.data ? entries : undefined };
}
function resourcePath(item: Pick<AssistantResource, 'id' | 'kind'>) {
  if (item.kind === 'api-chat') return `/chat/model/${item.id}`;
  return `${item.kind === 'task' ? '/assistant/tasks' : `/assistant/${item.kind === 'memory' ? 'memory' : item.kind + 's'}`}?resource=${item.id}`;
}

export function AssistantPage() {
  const owner = useAuthStore((state) => state.user?.id);
  return <AssistantAccountPage key={owner ?? 'signed-out'} />;
}

function AssistantAccountPage() {
  const account = useAuthStore((state) => state.user?.id);
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const section =
    location.pathname === '/'
      ? 'overview'
      : location.pathname === '/chat'
        ? 'chat'
        : location.pathname === '/tasks'
          ? 'tasks'
          : location.pathname.split('/')[2] || 'overview';
  const [editing, setEditing] = useState<AssistantResource | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState<Record<string, unknown>>({});
  const [prompt, setPrompt] = useState('');
  const [profileId, setProfileId] = useState('');
  const [provider, setProvider] = useState<CLIProvider>('codex');
  const [temporary, setTemporary] = useState(false);
  const [chatMode, setChatMode] = useState<'agent' | 'model'>('agent');
  const [files, setFiles] = useState<File[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceProjectId, setSourceProjectId] = useState('');
  useEffect(() => {
    if (section === 'sources')
      setSourceProjectId(new URLSearchParams(location.search).get('project') ?? '');
  }, [section, location.search]);
  const [selected, setSelected] = useState<AssistantResource | null>(null);
  const selectedPanel = useRef<HTMLElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId) {
      selectedPanel.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      selectedPanel.current?.focus({ preventScroll: true });
    }
  }, [selectedId]);
  const analysisOrigin = selected?.body.notebookOrigin as
    | { notebookId: string; notebookRevision: number }
    | undefined;
  const [taskImageBusy, setTaskImageBusy] = useState(false);
  useEffect(() => setTaskImageBusy(false), [selected?.id]);
  const [search, setSearch] = useState('');
  const [taskStatus, setTaskStatus] = useState(''),
    [taskSort, setTaskSort] = useState<'updated' | 'priority' | 'deadline'>('updated'),
    [taskTree, setTaskTree] = useState(true);
  useEffect(() => {
    setCreating(false);
    setEditing(null);
    setSelected(null);
    setError('');
    setSearch('');
    setTaskStatus('');
    setTaskSort('updated');
  }, [section]);
  const overview = useQuery({
    queryKey: ['assistant', 'overview', account],
    queryFn: async () =>
      (await api.get<{ data: AssistantOverview }>('/api/assistant/overview')).data.data,
    refetchInterval: 10000,
  });
  const resources = useAssistantList(
    section,
    !!TEMPLATES[section],
    search,
    section === 'tasks' ? { ...(taskStatus ? { status: taskStatus } : {}), sort: taskSort } : {}
  );
  const profiles = useAssistantList('profiles');
  const projects = useAssistantList('projects');
  const modelChats = useAssistantList('api-chats', section === 'chat');
  const selectedTask = useQuery({
    queryKey: ['assistant', 'selected-task', account, selected?.id],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource }>(`/api/assistant/tasks/${selected!.id}`)).data
        .data,
    enabled: selected?.kind === 'task' && !creating,
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (selected?.kind !== 'task' || creating) return;
    const candidates = [selectedTask.data, resources.data?.find((item) => item.id === selected.id)];
    const latest = candidates
      .filter((item): item is AssistantResource => item?.id === selected.id)
      .sort((a, b) => b.revision - a.revision)[0];
    if (latest && latest.revision > selected.revision) setSelected(latest);
  }, [resources.data, selectedTask.data, selected, creating]);
  useEffect(() => {
    const resourceId = new URLSearchParams(location.search).get('resource');
    if (!resourceId || !TEMPLATES[section]) return;
    let active = true;
    void api
      .get<{ data: AssistantResource }>(
        `/api/assistant/${section}/${encodeURIComponent(resourceId)}${new URLSearchParams(location.search).get('revision') ? `?revision=${encodeURIComponent(new URLSearchParams(location.search).get('revision')!)}` : ''}`
      )
      .then((response) => {
        if (active) setSelected(response.data.data);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [location.search, section]);
  const sessions = useQuery({
    queryKey: ['assistant', 'chat-sessions', account],
    queryFn: async () => (await api.get<{ data: Session[] }>('/api/sessions')).data.data,
    enabled: section === 'chat',
    refetchInterval: 15000,
  });
  const [versions, setVersions] = useState<
    Array<{ revision: number; body: Record<string, unknown>; title: string }>
  >([]);
  useEffect(() => {
    setVersions([]);
  }, [selected?.id]);
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['assistant'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const cleaned = Object.fromEntries(
        Object.entries(body).filter(
          ([key, value]) =>
            !(
              ['profileId', 'projectId', 'agentId', 'parentId', 'taskId', 'sourceId'].includes(
                key
              ) && value === ''
            )
        )
      );
      const payload = {
        title,
        body: cleaned,
        ...(editing ? { expectedRevision: editing.revision } : {}),
      };
      return editing
        ? api.patch(`/api/assistant/${section}/${editing.id}`, payload)
        : api.post(`/api/assistant/${section}`, payload);
    },
    onSuccess: () => {
      setCreating(false);
      setEditing(null);
      setSelected(null);
      setError('');
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const startChat = useMutation({
    mutationFn: async () => {
      const data = new FormData();
      data.append('name', prompt.trim().slice(0, 80) || 'Neues Gespräch');
      data.append('surface', 'chat');
      data.append('cliProvider', provider);
      data.append('mode', 'auto-accept');
      if (profileId) data.append('profileId', profileId);
      if (temporary) data.append('temporary', 'true');
      if (prompt.trim()) data.append('initialMessage', prompt.trim());
      files.forEach((file) => data.append('files', file));
      return (await api.post<{ data: Session }>('/api/sessions', data)).data.data;
    },
    onSuccess: (session) => navigate(`/chat/session/${session.id}`),
    onError: (e) => setError(e.message),
  });
  const importSource = useMutation({
    mutationFn: async () => {
      if (!sourceFile) throw new Error('Datei auswählen');
      const data = new FormData();
      data.append('file', sourceFile);
      if (sourceProjectId) data.append('projectId', sourceProjectId);
      return (await api.post<{ data: AssistantResource }>('/api/assistant/sources/import', data))
        .data.data;
    },
    onSuccess: (resource) => {
      setSelected(resource);
      setSourceFile(null);
      setError('');
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const command = useMutation({
    mutationFn: async ({
      task,
      action,
      text,
    }: {
      task: AssistantResource;
      action: string;
      text?: string;
    }) =>
      deliverAssistant(
        `/api/assistant/tasks/${task.id}/commands`,
        {
          commandId: crypto.randomUUID(),
          expectedRevision: task.revision,
          action,
          ...(text ? { text } : {}),
        },
        `${task.title}: ${action}`
      ),
    onSuccess: () => {
      setError('');
      void cache.invalidateQueries({ queryKey: ['assistant', 'selected-task', account] });
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const visible = useMemo(
    () =>
      (resources.data ?? []).filter((item) =>
        `${item.title} ${JSON.stringify(item.body)}`.toLowerCase().includes(search.toLowerCase())
      ),
    [resources.data, search]
  );
  const edit = (item?: AssistantResource) => {
    setEditing(item ?? null);
    setTitle(item?.title ?? '');
    setBody({ ...TEMPLATES[section], ...item?.body });
    setCreating(true);
    setSelected(null);
    setError('');
  };
  useEffect(() => {
    if (section === 'tasks' && new URLSearchParams(location.search).get('new') === 'true') {
      setCreating(true);
      setEditing(null);
      setTitle('');
      setBody({ ...TEMPLATES.tasks });
      navigate('/assistant/tasks', { replace: true });
    }
  }, [section, location.search, navigate]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  const renderField = (key: string, value: unknown) => {
    if (section === 'memory' && key === 'projectId' && body.scope !== 'project') return null;
    if (section === 'memory' && key === 'agentId' && body.scope !== 'agent') return null;
    if (
      [
        'sessionId',
        'originSessionId',
        'originResourceId',
        'originTurnId',
        'sourceVersions',
        'attempts',
        'assetId',
        'sha256',
        'filename',
        'byteSize',
        'office',
        'truncated',
        'pageCount',
        'pages',
        'ingestedAt',
        'textEdited',
        'originalTranscript',
        'words',
        'audioAssetId',
        'recordedAt',
        'evidence',
        'importOrigin',
        'capture',
        'mimeType',
      ].includes(key)
    )
      return null;
    if (section === 'event-subscriptions' && key === 'enabled')
      return (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => setBody({ ...body, enabled: event.target.checked })}
          />
          Bei einer neuen Quellrevision einen Task-Entwurf vorschlagen. Es startet kein Agent
          automatisch.
        </label>
      );
    if (section === 'event-subscriptions' && key === 'event') return null;

    if (key === 'lessons' && Array.isArray(value))
      return (
        <fieldset key={key} className="space-y-3">
          <legend className="font-medium">Lektionen</legend>
          {value.map((lesson: EditableLesson, index) => (
            <LessonEditor
              key={index}
              lesson={lesson}
              onChange={(next) =>
                setBody({ ...body, lessons: value.map((item, i) => (i === index ? next : item)) })
              }
              onRemove={() => setBody({ ...body, lessons: value.filter((_, i) => i !== index) })}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={value.length >= 100}
            onClick={() =>
              setBody({
                ...body,
                lessons: [...value, { title: '', content: '', completed: false }],
              })
            }
          >
            Lektion hinzufügen
          </Button>
        </fieldset>
      );
    if (Array.isArray(value) && ['deliverables', 'tags'].includes(key))
      return (
        <label key={key} className="grid gap-2 text-sm">
          {key === 'deliverables'
            ? 'Gewünschte Ergebnisse · eines pro Zeile'
            : 'Tags · eines pro Zeile'}
          <textarea
            className="min-h-24 rounded-md border bg-background p-2"
            value={value.join('\n')}
            onChange={(event) => setBody({ ...body, [key]: event.target.value.split('\n') })}
          />
        </label>
      );
    if (Array.isArray(value) && ['sourceIds', 'taskIds', 'resourceIds'].includes(key))
      return (
        <ResourcePicker
          key={key}
          label={
            key === 'sourceIds'
              ? 'Quellen'
              : key === 'taskIds'
                ? 'Zugehörige Aufträge'
                : 'Einträge in dieser Sammlung'
          }
          value={value}
          onChange={(ids) =>
            setBody({
              ...body,
              [key]: ids,
              ...(key === 'resourceIds' && Array.isArray(body.favoriteIds)
                ? { favoriteIds: body.favoriteIds.filter((id) => ids.includes(String(id))) }
                : {}),
            })
          }
          kind={key === 'sourceIds' ? 'source' : key === 'taskIds' ? 'task' : undefined}
          maximum={
            key === 'resourceIds' ? 1000 : key === 'sourceIds' && section === 'tasks' ? 20 : 100
          }
          excludeId={editing?.id}
        />
      );
    if (['profileId', 'projectId', 'parentId', 'sourceId', 'taskId'].includes(key))
      return (
        <ResourcePicker
          key={key}
          label={FIELD_LABELS[key] || key}
          value={typeof value === 'string' && value ? [value] : []}
          maximum={1}
          kind={
            key === 'profileId'
              ? 'profile'
              : key === 'projectId'
                ? 'project'
                : key === 'sourceId'
                  ? 'source'
                  : 'task'
          }
          excludeId={editing?.id}
          onChange={(ids) => setBody({ ...body, [key]: ids[0] ?? '' })}
        />
      );
    if (
      ['status', 'owner', 'mimeType', 'audioAssetId', 'originalTranscript'].includes(key) ||
      Array.isArray(value) ||
      typeof value === 'boolean'
    )
      return null;
    const options =
      key === 'provider'
        ? PROVIDERS
        : key === 'memory'
          ? ['off', 'read', 'read-write']
          : key === 'scope'
            ? ['personal', 'project', 'agent']
            : key === 'type'
              ? [
                  'document',
                  'table',
                  'slides',
                  'code',
                  'design',
                  'research',
                  'dataset',
                  'notebook',
                  'image',
                  'audio',
                  'video',
                  'latex',
                  'app',
                ]
              : key === 'format'
                ? ['markdown', 'json', 'csv', 'html', 'text']
                : null;
    if (key === 'agentId')
      return (
        <label key={key} className="grid gap-2 text-sm">
          Agent
          <select
            className="rounded-md border bg-background p-2"
            value={String(value ?? '')}
            aria-label="Agent"
            onChange={(event) => setBody({ ...body, agentId: event.target.value })}
          >
            <option value="">
              {section === 'routines' ? 'Nativen Agenten wählen' : 'Gewählter CLI-Provider'}
            </option>
            {overview.data?.agents
              .filter(
                (agent) =>
                  section !== 'routines' ||
                  (agent.id.startsWith('matrix:') &&
                    !agent.retired &&
                    agent.schemaVersion === 1 &&
                    ['native', 'worker'].includes(agent.mode ?? ''))
              )
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.state ? ` · ${agent.state}` : ''}
                </option>
              ))}
          </select>
        </label>
      );
    if (key === 'voice')
      return (
        <VoiceSelect
          key={key}
          label={FIELD_LABELS[key] || key}
          value={String(value ?? '')}
          onChange={(next) => setBody({ ...body, [key]: next })}
        />
      );
    return (
      <label key={key} className="grid gap-2 text-sm">
        <span>{FIELD_LABELS[key] || key}</span>
        {options ? (
          <select
            className="rounded-md border bg-background px-3 py-2"
            value={String(value ?? '')}
            onChange={(e) => setBody({ ...body, [key]: e.target.value })}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {OPTION_LABELS[option] ?? option}
              </option>
            ))}
          </select>
        ) : [
            'instructions',
            'goal',
            'description',
            'text',
            'content',
            'transcript',
            'summary',
          ].includes(key) ? (
          <textarea
            className="min-h-32 w-full rounded-md border bg-background p-3"
            value={String(value ?? '')}
            onChange={(e) => setBody({ ...body, [key]: e.target.value })}
          />
        ) : (
          <Input
            type={typeof value === 'number' ? 'number' : 'text'}
            value={String(value ?? '')}
            onChange={(e) =>
              setBody({
                ...body,
                [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value,
              })
            }
          />
        )}
      </label>
    );
  };
  const sectionInfo = SECTION_INFO[section];
  const TaskWorkspace = section === 'tasks' ? 'div' : Fragment;
  const TaskListColumn = section === 'tasks' ? 'div' : Fragment;
  const TaskToolbar = section === 'tasks' ? 'div' : Fragment;
  const TaskFields = section === 'tasks' ? 'div' : Fragment;
  return (
    <main
      className={
        section === 'tasks' ? 'plum-task-page' : 'mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8'
      }
    >
      <AssistantOutbox />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          {section === 'tasks' && (
            <p className="text-sm text-muted-foreground">Deine Aufgaben, gemeinsam erledigt</p>
          )}
          <h1 className="text-2xl font-semibold">
            {section === 'overview' ? 'Plum' : LABELS[section] || section}
          </h1>
          {sectionInfo && <p className="mt-1 text-sm text-muted-foreground">{sectionInfo.intro}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            aria-label="Aktualisieren"
            title="Aktualisieren"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {sectionInfo && !!TEMPLATES[section] && !creating && (
            <Button onClick={() => edit()}>
              <Plus className="mr-2 h-4 w-4" />
              {sectionInfo.add}
            </Button>
          )}
          {section === 'tasks' && !creating && (
            <Button onClick={() => edit()}>
              <Plus className="mr-2 h-4 w-4" />
              Neue Aufgabe
            </Button>
          )}
        </div>
      </header>

      {section === 'overview' && (
        <Link
          to="/mini"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline focus-visible:outline"
        >
          Plum Mini öffnen
        </Link>
      )}
      {section === 'overview' && <LibrarySearch key={account} />}
      {(error || overview.error || resources.error || sessions.error) && (
        <div role="alert" className="rounded-md border border-destructive bg-card p-3 text-sm">
          {error || overview.error?.message || resources.error?.message || sessions.error?.message}
          <Button
            className="ml-3"
            variant="ghost"
            size="sm"
            onClick={() => {
              setError('');
              refresh();
            }}
          >
            Erneut versuchen
          </Button>
        </div>
      )}
      {section === 'overview' && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                path: '/chat',
                title: 'Plum Chat',
                text: 'Fragen, Ideen und persönliche Gespräche.',
                icon: MessageSquare,
              },
              {
                path: '/tasks',
                title: 'Plum Task',
                text: 'Ziele verfolgen und Ergebnisse erhalten.',
                icon: ListTodo,
              },
              {
                path: '/code',
                title: 'Plum Code',
                text: 'Projekte, Code und Git bearbeiten.',
                icon: Code2,
              },
            ].map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className="rounded-lg border bg-card p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <item.icon className="mb-4 h-6 w-6 text-primary" />
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
              </Link>
            ))}
          </div>
          <h2 className="text-lg font-semibold">Offene Arbeit</h2>
          {overview.isLoading ? (
            <p role="status">Wird geladen …</p>
          ) : (
            <ResourceList
              items={(overview.data?.tasks ?? []).filter(
                (t) => !['completed', 'cancelled'].includes(String(t.body.status))
              )}
              onSelect={setSelected}
            />
          )}
          <h2 className="text-lg font-semibold">Zuletzt bearbeitet</h2>
          <ResourceList
            items={overview.data?.recent ?? []}
            onSelect={(item) => navigate(resourcePath(item))}
          />
        </>
      )}
      {section === 'artifacts' && (
        <>
          <ComparisonStarter
            onCreated={(artifact) => navigate(`/assistant/artifacts?resource=${artifact.id}`)}
          />
          <DatasetImport
            onCreated={(artifact) => navigate(`/assistant/artifacts?resource=${artifact.id}`)}
          />
        </>
      )}
      {section === 'sources' && (
        <WebSourceImport
          onCreated={(source) => {
            refresh();
            navigate(`/assistant/sources?resource=${source.id}`);
          }}
        />
      )}
      {section === 'projects' && <PersonalWorkspaceStarter key={account} onCreated={refresh} />}
      {section === 'chat' && (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Gesprächsart">
            <Button
              variant={chatMode === 'agent' ? 'default' : 'outline'}
              aria-pressed={chatMode === 'agent'}
              onClick={() => setChatMode('agent')}
            >
              Agentengespräch
            </Button>
            <Button
              variant={chatMode === 'model' ? 'default' : 'outline'}
              aria-pressed={chatMode === 'model'}
              onClick={() => setChatMode('model')}
            >
              Modellchat
            </Button>
          </div>
          {chatMode === 'model' ? (
            <ApiChatStarter />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                startChat.mutate();
              }}
              className="space-y-4 rounded-lg border bg-card p-4 md:p-6"
            >
              <h2 className="font-semibold">Ein neues Agentengespräch</h2>
              <label className="grid gap-2 text-sm">
                Deine Nachricht
                <textarea
                  className="min-h-32 rounded-md border bg-background p-3"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Wobei kann Plum helfen?"
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={temporary}
                  onChange={(event) => {
                    setTemporary(event.target.checked);
                    if (event.target.checked) setProvider('codex');
                  }}
                />
                <span>
                  Temporäres Gespräch (Codex): kein persönliches Gedächtnis, kein CLI-Verlauf auf
                  Disk. Plum löscht Gespräch und Arbeitsdateien nach 24 Stunden. Inhaltsfreie
                  Verbrauchswerte bleiben erhalten.
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  Profil
                  <select
                    className="rounded-md border bg-background p-2"
                    value={profileId}
                    onChange={(e) => {
                      const profile = profiles.data?.find((p) => p.id === e.target.value);
                      setProfileId(e.target.value);
                      if (profile && !temporary) setProvider(profile.body.provider as CLIProvider);
                    }}
                  >
                    <option value="">Persönlicher Assistent</option>
                    {profiles.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  Provider
                  <select
                    className="rounded-md border bg-background p-2"
                    value={provider}
                    disabled={temporary}
                    onChange={(e) => setProvider(e.target.value as CLIProvider)}
                  >
                    {(
                      overview.data?.agents.map((a) => a.provider).filter(Boolean) ?? PROVIDERS
                    ).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <VoiceComposer
                text={prompt}
                voice={String(
                  profiles.data?.find((profile) => profile.id === profileId)?.body.voice ??
                    'Rufus Beck'
                )}
                onTranscription={(text) => setPrompt((old) => (old ? `${old}\n${text}` : text))}
              />
              <label className="grid gap-2 text-sm">
                Dateien
                <input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {files.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {files.map((f) => f.name).join(', ')}
                </p>
              )}
              <Button disabled={startChat.isPending}>
                <MessageSquare className="mr-2 h-4 w-4" />
                {startChat.isPending ? 'Gespräch startet …' : 'Gespräch starten'}
              </Button>
            </form>
          )}
          <h2 className="text-lg font-semibold">Deine Gespräche</h2>
          {sessions.isLoading ? (
            <p role="status">Wird geladen …</p>
          ) : (
            <div className="grid gap-3">
              {sessions.data
                ?.filter((s) => s.surface === 'chat')
                .map((s) => (
                  <Link
                    key={s.id}
                    to={`/session/${s.id}`}
                    className="rounded-md border bg-card p-4"
                  >
                    <span className="font-medium">{s.name}</span>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {s.lastMessage || s.cliProvider}
                    </p>
                  </Link>
                ))}
            </div>
          )}
          {!!modelChats.data?.length && (
            <>
              <h2 className="text-lg font-semibold">Deine Modellgespräche</h2>
              <div className="grid gap-3">
                {modelChats.data.map((chat) => (
                  <Link
                    key={chat.id}
                    to={`/chat/model/${chat.id}`}
                    className="min-w-0 rounded-md border bg-card p-4"
                  >
                    <span className="font-medium">{chat.title}</span>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {String(chat.body.providerId)} / {String(chat.body.model)}
                    </p>
                  </Link>
                ))}
              </div>
              {modelChats.hasNextPage && (
                <Button variant="outline" onClick={() => void modelChats.fetchNextPage()}>
                  Weitere Modellgespräche
                </Button>
              )}
            </>
          )}
          {modelChats.isError && <p role="alert">Modellgespräche konnten nicht geladen werden.</p>}
        </>
      )}
      {section === 'agents' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {overview.data?.agents.map((agent) => (
            <article key={agent.id} className="rounded-lg border bg-card p-4">
              <Bot className="mb-2 h-5 w-5" />
              <h2 className="font-semibold">{agent.name}</h2>
              <p className="text-sm text-muted-foreground">
                {agent.source === 'cli' ? 'CLI-Laufzeit' : 'Native Schwarm-Laufzeit'} ·{' '}
                {agent.available ? 'Verfügbar' : 'Nicht verbunden'}
              </p>
              <p className="mt-2 text-sm">{agent.capabilities.join(' · ')}</p>
            </article>
          ))}
        </div>
      )}
      <TaskWorkspace {...(section === 'tasks' ? { className: 'plum-task-workspace' } : {})}>
        <TaskListColumn {...(section === 'tasks' ? { className: 'plum-task-list' } : {})}>
          {!!TEMPLATES[section] && !creating && (
            <>
              {section === 'sources' && (
                <form
                  className="space-y-3 rounded-md border bg-card p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    importSource.mutate();
                  }}
                >
                  <h2 className="font-semibold">Datei als Wissensquelle</h2>
                  <label className="grid gap-2 text-sm">
                    Datei
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx"
                      onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    Wissensprojekt
                    <select
                      className="rounded-md border bg-background p-2"
                      value={sourceProjectId}
                      onChange={(event) => setSourceProjectId(event.target.value)}
                    >
                      <option value="">Ohne Projekt</option>
                      {projects.data?.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button disabled={!sourceFile || importSource.isPending}>
                    {importSource.isPending ? 'Wird eingelesen …' : 'Quelle übernehmen'}
                  </Button>
                </form>
              )}
              <TaskToolbar {...(section === 'tasks' ? { className: 'plum-task-toolbar' } : {})}>
                <div className={section === 'tasks' ? 'plum-task-search' : 'flex flex-wrap gap-3'}>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Suchen</span>
                    <Input
                      placeholder="Suchen …"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {section === 'projects' && (
                    <Button variant="outline" onClick={() => navigate('/assistant/sources')}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      Quellen
                    </Button>
                  )}
                </div>
                {section === 'tasks' && (
                  <div className="plum-task-filters">
                    <label className="grid gap-1 text-sm">
                      Taskstatus
                      <select
                        aria-label="Taskstatus"
                        className="rounded-md border bg-background p-2"
                        value={taskStatus}
                        onChange={(event) => setTaskStatus(event.target.value)}
                      >
                        <option value="">Alle Zustände</option>
                        {Object.entries(STATUS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm">
                      Reihenfolge
                      <select
                        aria-label="Taskreihenfolge"
                        className="rounded-md border bg-background p-2"
                        value={taskSort}
                        onChange={(event) => setTaskSort(event.target.value as typeof taskSort)}
                      >
                        <option value="updated">Zuletzt geändert</option>
                        <option value="priority">Priorität</option>
                        <option value="deadline">Frist</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={taskTree}
                        onChange={(event) => setTaskTree(event.target.checked)}
                      />
                      Teilaufträge als Baum
                    </label>
                  </div>
                )}
              </TaskToolbar>
              {resources.isLoading ? (
                <p role="status">Wird geladen …</p>
              ) : (
                <div className="space-y-3">
                  {section === 'tasks' ? (
                    <TaskBoard
                      items={visible}
                      tree={taskTree}
                      labels={STATUS}
                      onSelect={setSelected}
                      selectedId={selected?.id}
                    />
                  ) : (
                    <ResourceList
                      items={visible}
                      onSelect={setSelected}
                      empty={
                        sectionInfo &&
                        !search && {
                          text: sectionInfo.empty,
                          action: sectionInfo.add,
                          onAction: () => edit(),
                        }
                      }
                    />
                  )}
                  {resources.hasNextPage && (
                    <Button
                      variant="outline"
                      disabled={resources.isFetchingNextPage}
                      onClick={() => void resources.fetchNextPage()}
                    >
                      {resources.isFetchingNextPage ? 'Wird geladen …' : 'Weitere Einträge laden'}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          {creating && (
            <form
              onSubmit={submit}
              className={
                section === 'tasks'
                  ? 'plum-task-editor space-y-4'
                  : 'space-y-4 rounded-lg border bg-card p-4 md:p-6'
              }
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  {section === 'tasks'
                    ? editing
                      ? 'Aufgabe bearbeiten'
                      : 'Neue Aufgabe'
                    : editing
                      ? `${sectionInfo?.title ?? 'Eintrag'} bearbeiten`
                      : (sectionInfo?.add ?? 'Neu erstellen')}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setEditing(null);
                  }}
                  aria-label="Schliessen"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {section === 'routines' && (
                <label className="grid gap-2 text-sm">
                  Persönliche Vorlage
                  <select
                    aria-label="Routinevorlage"
                    className="rounded-md border bg-background p-2"
                    defaultValue=""
                    onChange={(event) => {
                      const preset = ROUTINE_PRESETS.find((item) => item.id === event.target.value);
                      if (preset) {
                        setTitle(preset.title);
                        setBody({
                          ...TEMPLATES.routines,
                          goal: preset.goal,
                          schedule: preset.schedule,
                          agentId: body.agentId ?? '',
                        });
                      }
                    }}
                  >
                    <option value="">Individuell</option>
                    {ROUTINE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <TaskFields {...(section === 'tasks' ? { className: 'plum-task-fields' } : {})}>
                <label className="grid gap-2 text-sm">
                  Name
                  <Input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                {Object.entries(body).map(([key, value]) => renderField(key, value))}
              </TaskFields>
              {section === 'routines' && (
                <p className="text-xs text-muted-foreground">
                  Speichert eine persönliche Vorlage. Den tatsächlichen Zeitplan aktivierst du
                  danach beim bestehenden Schwarm-Koordinator; seine Rückmeldung bestätigt den
                  Stand.
                </p>
              )}
              {section === 'meetings' && (
                <VoiceComposer
                  onAudioFile={async (file) => {
                    const data = new FormData();
                    data.append('file', file);
                    const meeting = (
                      await api.post<{ data: AssistantResource }>(
                        '/api/assistant/meetings/import',
                        data
                      )
                    ).data.data;
                    setCreating(false);
                    setSelected(meeting);
                    refresh();
                  }}
                  text={String(body.summary ?? body.transcript ?? '')}
                  onTranscription={(text) =>
                    setBody((old) => ({ ...old, transcript: String(old.transcript ?? '') + text }))
                  }
                />
              )}
              <Button disabled={save.isPending}>
                {save.isPending ? 'Wird gespeichert …' : 'Speichern'}
              </Button>
            </form>
          )}
        </TaskListColumn>
        {selected && (
          <article
            ref={selectedPanel}
            tabIndex={-1}
            aria-labelledby="assistant-selected-title"
            className={
              section === 'tasks'
                ? 'plum-task-detail scroll-mt-20 space-y-4'
                : 'scroll-mt-20 space-y-4 rounded-lg border bg-card p-4 md:p-6'
            }
          >
            <div className="flex justify-between gap-3">
              <div>
                <h2 id="assistant-selected-title" className="text-lg font-semibold">
                  {selected.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Revision {selected.revision} ·{' '}
                  {new Date(selected.updatedAt).toLocaleString('de-CH')}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setSelected(null)} aria-label="Schliessen">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {selected.kind === 'artifact' ? (
              <ArtifactViewer
                artifact={selected}
                onSaved={() => {
                  const saved = selected,
                    captured = account;
                  void api
                    .get<{ data: AssistantResource }>(`/api/assistant/artifacts/${saved.id}`)
                    .then((response) => {
                      if (useAuthStore.getState().user?.id === captured)
                        setSelected(response.data.data);
                    })
                    .catch((failure) => {
                      if (useAuthStore.getState().user?.id === captured)
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : 'Gespeichertes Ergebnis konnte nicht geladen werden'
                        );
                    });
                  refresh();
                }}
              />
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {String(
                    selected.body.result ??
                      selected.body.content ??
                      selected.body.text ??
                      selected.body.goal ??
                      selected.body.description ??
                      selected.body.instructions ??
                      ''
                  )}
                </ReactMarkdown>
              </div>
            )}
            {['artifact', 'project'].includes(selected.kind) && <SharePanel resource={selected} />}
            {selected.kind === 'source' && (
              <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
                Quelldatei als neue Revision ersetzen
                <input
                  type="file"
                  className="sr-only"
                  accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.pptx,text/*,application/pdf"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    try {
                      const form = new FormData();
                      form.append('file', file);
                      form.append('expectedRevision', String(selected.revision));
                      const next = (
                        await api.post<{ data: AssistantResource }>(
                          `/api/assistant/sources/${selected.id}/import`,
                          form
                        )
                      ).data.data;
                      setSelected(next);
                      refresh();
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : 'Quelldatei konnte nicht ersetzt werden'
                      );
                    }
                  }}
                />
              </label>
            )}
            {selected.kind === 'source' && selected.body.truncated === true && (
              <p role="status" className="text-sm">
                Der Text wurde auf die Importgrenze gekürzt. Für vollständige Auswertung die Quelle
                in Abschnitten importieren.
              </p>
            )}
            {selected.kind === 'source' && !!selected.body.office && (
              <OfficeSource
                key={`${selected.id}:${selected.revision}`}
                source={selected}
                onCreated={(artifact) => {
                  refresh();
                  navigate(`/assistant/artifacts?resource=${artifact.id}`);
                }}
              />
            )}
            {selected.kind === 'source' && (
              <WebSourceWatch
                key={selected.id}
                source={selected}
                onUpdated={(source) => {
                  setSelected(source);
                  refresh();
                }}
              />
            )}
            {selected.kind === 'source' && typeof selected.body.assetId === 'string' && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const response = await api.download(
                      `/api/assistant/sources/${selected.id}/file?revision=${selected.revision}`
                    );
                    const url = URL.createObjectURL(await response.blob());
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = String(selected.body.filename ?? selected.title);
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Originaldatei konnte nicht geladen werden'
                    );
                  }
                }}
              >
                Originaldatei herunterladen
              </Button>
            )}
            {selected.kind === 'course' && Array.isArray(selected.body.lessons) && (
              <CoursePlayer
                course={selected}
                onChanged={(next) => {
                  setSelected(next);
                  refresh();
                }}
              />
            )}
            {selected.kind === 'collection' && Array.isArray(selected.body.resourceIds) && (
              <CollectionWorkspace
                collection={selected}
                onSaved={(resource) => {
                  setSelected(resource);
                  refresh();
                }}
              />
            )}
            {selected.kind === 'meeting' && <MeetingAudio meeting={selected} />}
            {selected.kind === 'meeting' && (
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const data = new FormData();
                    data.append('surface', 'chat');
                    data.append('cliProvider', 'codex');
                    data.append('name', `Protokoll: ${selected.title}`.slice(0, 100));
                    data.append(
                      'initialMessage',
                      `Erstelle ein Protokoll und klare nächste Schritte aus diesem Transkript. Speichere das Protokoll mit plum_create_artifact und mögliche Aufgaben als Entwürfe mit plum_create_task. Gib Unsicherheiten und unklare Sprecher an.\n\n${String(selected.body.transcript ?? '')}`
                    );
                    const session = (await api.post<{ data: Session }>('/api/sessions', data)).data
                      .data;
                    navigate(`/chat/session/${session.id}`);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Protokoll konnte nicht gestartet werden'
                    );
                  }
                }}
              >
                Protokoll und nächste Schritte ausarbeiten
              </Button>
            )}
            {typeof selected.body.sessionId === 'string' && (
              <Link
                to={`/session/${selected.body.sessionId}`}
                className="flex items-center gap-2 text-sm text-primary"
              >
                Auftragsgespräch öffnen
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {typeof selected.body.originResourceId === 'string' && (
              <Link
                className="text-sm text-primary underline"
                to={`/chat/model/${selected.body.originResourceId}`}
              >
                Ursprungsgespräch öffnen
              </Link>
            )}
            {selected.kind === 'task' && <TaskLimits taskId={selected.id} />}
            {selected.kind === 'task' && (
              <TaskResults
                key={`${selected.id}:${selected.revision}`}
                task={selected}
                onChanged={(task) => {
                  setSelected((current) =>
                    current?.id === task.id && current.revision > task.revision ? current : task
                  );
                  refresh();
                }}
              />
            )}
            {selected.kind === 'task' && analysisOrigin && (
              <Link
                className="text-sm text-primary underline"
                to={`/assistant/artifacts?resource=${analysisOrigin.notebookId}&revision=${analysisOrigin.notebookRevision}`}
              >
                Ursprüngliches Analyse-Notebook öffnen
              </Link>
            )}
            {selected.kind === 'routine' && (
              <NativeRoutineControls
                key={`${account}:${selected.id}:${selected.revision}`}
                routine={selected}
              />
            )}
            {selected.kind === 'task' && (
              <TaskImages
                key={selected.id}
                task={selected}
                onBusy={setTaskImageBusy}
                onChanged={(task) => {
                  setSelected(task);
                  refresh();
                }}
              />
            )}
            {selected.kind === 'task' && (
              <p className="text-sm">
                {STATUS[String(selected.body.status)] ?? (selected.body.status as string)}
                {selected.body.nativeTaskId ? ` · ${selected.body.nativeTaskId}` : ''}
                {selected.body.nativeState ? ` · ${selected.body.nativeState}` : ''}
              </p>
            )}
            {typeof selected.body.matrixRoomId === 'string' &&
              typeof selected.body.matrixThreadId === 'string' && (
                <Link
                  className="text-sm text-primary underline"
                  to={`/swarm?${new URLSearchParams({ room: selected.body.matrixRoomId, thread: selected.body.matrixThreadId })}`}
                >
                  Ursprung im Schwarm öffnen
                </Link>
              )}
            {typeof selected.body.matrixCardRoomId === 'string' &&
              typeof selected.body.matrixCardEventId === 'string' && (
                <Link
                  className="ml-3 text-sm text-primary underline"
                  to={`/swarm?${new URLSearchParams({ room: selected.body.matrixCardRoomId, thread: selected.body.matrixCardEventId })}`}
                >
                  Native Auftragskarte öffnen
                </Link>
              )}
            {selected.kind === 'task' ? (
              <div className="flex flex-wrap gap-2">
                {['draft', 'failed', 'cancelled', 'completed', 'interrupted'].includes(
                  String(selected.body.status)
                ) && (
                  <Button
                    disabled={command.isPending || taskImageBusy}
                    onClick={() =>
                      command.mutate({
                        task: selected,
                        action: selected.body.status === 'draft' ? 'submit' : 'retry',
                      })
                    }
                  >
                    {' '}
                    {selected.body.status === 'draft' ? 'Starten' : 'Neuer Versuch'}
                  </Button>
                )}
                {selected.body.status === 'waiting_input' &&
                  !String(selected.body.agentId ?? '').startsWith('matrix:') && (
                    <>
                      <Button
                        disabled={command.isPending || !taskResultsReviewed(selected, account)}
                        onClick={() => command.mutate({ task: selected, action: 'complete' })}
                      >
                        Ergebnis akzeptieren
                      </Button>
                      <form
                        className="flex w-full gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const value = new FormData(e.currentTarget).get('reply');
                          if (value)
                            command.mutate({
                              task: selected,
                              action: 'input',
                              text: String(value),
                            });
                        }}
                      >
                        <Input required name="reply" placeholder="Folgeanweisung oder Antwort" />
                        <Button disabled={command.isPending}>Senden</Button>
                      </form>
                    </>
                  )}
                {!['completed', 'cancelled', 'failed'].includes(String(selected.body.status)) && (
                  <Button
                    variant="outline"
                    disabled={command.isPending}
                    onClick={() => command.mutate({ task: selected, action: 'cancel' })}
                  >
                    Abbrechen
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => edit(selected)}>
                  {selected.kind === 'artifact' ? 'Metadaten bearbeiten' : 'Bearbeiten'}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      setVersions(
                        (
                          await api.get<{ data: typeof versions }>(
                            `/api/assistant/${section}/${selected.id}/versions`
                          )
                        ).data.data
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : 'Verlauf konnte nicht geladen werden'
                      );
                    }
                  }}
                >
                  Versionen
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api.delete(`/api/assistant/${section}/${selected.id}`, {
                        body: JSON.stringify({ expectedRevision: selected.revision }),
                      });
                      setSelected(null);
                      refresh();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : 'Eintrag konnte nicht entfernt werden'
                      );
                    }
                  }}
                >
                  Archivieren
                </Button>
              </div>
            )}
            {versions.length > 0 && (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.revision}>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setSelected({
                          ...selected,
                          body: v.body,
                          title: v.title,
                          revision: v.revision,
                        })
                      }
                    >
                      Revision {v.revision} ansehen
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        )}
      </TaskWorkspace>
    </main>
  );
}
function ResourceList({
  items,
  onSelect,
  empty,
}: {
  items: AssistantResource[];
  onSelect: (item: AssistantResource) => void;
  empty?: { text: string; action: string; onAction: () => void } | false;
}) {
  if (!items.length)
    return empty ? (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <p>{empty.text}</p>
        <Button size="sm" onClick={empty.onAction}>
          <Plus className="mr-2 h-4 w-4" />
          {empty.action}
        </Button>
      </div>
    ) : (
      <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
        Noch keine Einträge.
      </p>
    );
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <button
          key={item.id}
          className="flex w-full items-start gap-3 rounded-md border bg-card p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => onSelect(item)}
        >
          <FileText className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="font-medium">{item.title}</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {item.body.status
                ? STATUS[String(item.body.status)] || String(item.body.status)
                : item.kind === 'artifact' && item.body.type === 'notebook'
                  ? 'Versionierte Datenanalyse'
                  : item.kind === 'artifact' && item.body.format === 'json'
                    ? item.body.type === 'table'
                      ? 'Berechenbare Tabelle'
                      : 'Strukturiertes Ergebnis'
                    : String(
                        item.body.description ??
                          item.body.text ??
                          item.body.content ??
                          item.body.instructions ??
                          ''
                      ).slice(0, 180)}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
      ))}
    </div>
  );
}
