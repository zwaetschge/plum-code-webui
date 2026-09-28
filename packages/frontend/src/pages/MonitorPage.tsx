import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  LayoutGrid,
  Paperclip,
  Plus,
  RefreshCw,
  Replace,
  Send,
  Square,
  X,
} from 'lucide-react';
import type { PermissionAction, Session } from '@plum-code-webui/shared';
import { useSessionStore } from '@/stores/sessionStore';
import { socketService } from '@/services/socket';
import { getSessionRunState, type SessionRunTone } from '@/lib/sessionRunState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/** How many sessions the grid shows at once — the same four as the Android app. */
const SLOT_COUNT = 4;
const STORAGE_KEY = 'plum-monitor-slots-v1';
/** Tail of live text a tile keeps on screen. */
const TAIL_CHARS = 2_000;

type Slots = (string | null)[];

function loadSlots(): Slots | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return Array.from({ length: SLOT_COUNT }, (_, index) => {
      const value = parsed[index];
      return typeof value === 'string' && value ? value : null;
    });
  } catch {
    return null;
  }
}

function saveSlots(slots: Slots): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Storage full or blocked: the choice simply does not survive a reload.
  }
}

/**
 * Pick the sessions worth watching when the user has not chosen any: busy
 * ones first, then whatever moved most recently.
 */
function defaultSlots(sessions: Session[]): Slots {
  const ranked = [...sessions]
    .sort((a, b) => {
      const busyA = a.runtime?.busy || a.status === 'running' ? 1 : 0;
      const busyB = b.runtime?.busy || b.status === 'running' ? 1 : 0;
      if (busyA !== busyB) return busyB - busyA;
      const stampA = a.runtime?.lastActivityAt || a.lastActivity || a.updatedAt;
      const stampB = b.runtime?.lastActivityAt || b.lastActivity || b.updatedAt;
      return stampB.localeCompare(stampA);
    })
    .map((session) => session.id);
  return Array.from({ length: SLOT_COUNT }, (_, index) => ranked[index] ?? null);
}

const TONE_DOT: Record<SessionRunTone, string> = {
  'needs-you': 'bg-amber-400',
  working: 'bg-emerald-400',
  'live-idle': 'bg-sky-400',
  idle: 'bg-muted-foreground/50',
  error: 'bg-red-400',
};

const TONE_BORDER: Record<SessionRunTone, string> = {
  'needs-you': 'border-amber-400/60',
  working: 'border-emerald-400/50',
  'live-idle': 'border-sky-400/40',
  idle: 'border-border',
  error: 'border-red-400/60',
};

/**
 * Four sessions, live, side by side.
 *
 * The session page shows one conversation in full; the dashboard shows every
 * session's verdict. Neither shows what four agents are saying right now.
 * Each tile here streams its session's live output, offers the approval or
 * question that is blocking it, and takes a follow-up in place.
 */
export function MonitorPage() {
  const navigate = useNavigate();
  const sessions = useSessionStore((state) => state.sessions);

  const [slots, setSlots] = useState<Slots>(
    () => loadSlots() ?? Array.from({ length: SLOT_COUNT }, () => null)
  );
  const [slotsChosen, setSlotsChosen] = useState<boolean>(() => loadSlots() !== null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // A default set exactly once, the first time the session list is available.
  useEffect(() => {
    if (slotsChosen || sessions.length === 0) return;
    setSlots(defaultSlots(sessions));
    setSlotsChosen(true);
  }, [sessions, slotsChosen]);

  const slotIds = useMemo(() => slots.filter((id): id is string => Boolean(id)), [slots]);
  const slotKey = slotIds.join('|');

  // Rooms for every tile. The open session page owns its own subscription, so
  // it is left joined when this page goes away.
  useEffect(() => {
    const ids = slotKey ? slotKey.split('|') : [];
    ids.forEach((id) => socketService.subscribeToSession(id));
    return () => {
      const active = useSessionStore.getState().activeSessionId;
      ids.forEach((id) => {
        if (id !== active) socketService.unsubscribeFromSession(id);
      });
    };
  }, [slotKey]);

  const assign = useCallback((slot: number, sessionId: string) => {
    setSlots((current) => {
      const next = [...current];
      const previous = next.indexOf(sessionId);
      if (previous >= 0 && previous !== slot) next[previous] = null;
      next[slot] = sessionId;
      saveSlots(next);
      return next;
    });
    setSlotsChosen(true);
    setPickerSlot(null);
  }, []);

  const clear = useCallback((slot: number) => {
    setSlots((current) => {
      const next = [...current];
      next[slot] = null;
      saveSlots(next);
      return next;
    });
    setSlotsChosen(true);
    setPickerSlot(null);
  }, []);

  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );

  const workingCount = useSessionStore(
    (state) =>
      slotIds.filter((id) => {
        const session = sessionsById.get(id);
        if (!session) return false;
        return getSessionRunState(session, {
          activity: state.activity[id],
          activeAgent: state.activeAgent[id],
          agentRuns: state.agentRuns[id],
          streamingContent: state.streamingContent[id],
          tools: state.toolExecutions[id],
          queue: state.queueState[id],
          lifecycle: state.lifecycle[id],
          pendingApprovals: state.pendingApprovalCounts[id],
        }).isWorking;
      }).length
  );

  return (
    <div className="dashboard-layout">
      <div className="dashboard-shell space-y-4">
        <header className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Monitor</h1>
            <p className="text-xs text-muted-foreground">
              {slotIds.length} of {SLOT_COUNT} sessions · {workingCount} working
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              slotIds.forEach((id) => socketService.reconnectToSession(id));
              toast({ title: 'Monitor refreshed' });
            }}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
        </header>

        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          style={{ minHeight: 'calc(100vh - 11rem)' }}
        >
          {slots.map((sessionId, slot) => {
            const session = sessionId ? sessionsById.get(sessionId) : undefined;
            if (!sessionId || !session) {
              return (
                <button
                  key={`empty-${slot}`}
                  type="button"
                  onClick={() => setPickerSlot(slot)}
                  className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  <Plus className="mb-2 h-6 w-6" />
                  <span className="font-medium text-foreground">Slot {slot + 1}</span>
                  <span className="text-xs">Click to watch a session here</span>
                </button>
              );
            }
            return (
              <MonitorTile
                key={sessionId}
                session={session}
                onOpen={() => navigate(`/session/${sessionId}`)}
                onSwap={() => setPickerSlot(slot)}
                onClear={() => clear(slot)}
              />
            );
          })}
        </div>
      </div>

      <Dialog open={pickerSlot !== null} onOpenChange={(open) => !open && setPickerSlot(null)}>
        <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Session for slot {(pickerSlot ?? 0) + 1}</DialogTitle>
            <DialogDescription>
              Busy sessions first, then the most recently active.
            </DialogDescription>
          </DialogHeader>
          <SessionPickerList
            sessions={sessions}
            chosen={new Set(slotIds)}
            onPick={(id) => pickerSlot !== null && assign(pickerSlot, id)}
            onClear={pickerSlot !== null && slots[pickerSlot] ? () => clear(pickerSlot) : undefined}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionPickerList({
  sessions,
  chosen,
  onPick,
  onClear,
}: {
  sessions: Session[];
  chosen: Set<string>;
  onPick: (id: string) => void;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState('');
  const ordered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...sessions]
      .filter(
        (session) =>
          !needle ||
          session.name.toLowerCase().includes(needle) ||
          session.workingDirectory.toLowerCase().includes(needle)
      )
      .sort((a, b) => {
        const busyA = a.runtime?.busy || a.status === 'running' ? 1 : 0;
        const busyB = b.runtime?.busy || b.status === 'running' ? 1 : 0;
        if (busyA !== busyB) return busyB - busyA;
        const stampA = a.runtime?.lastActivityAt || a.lastActivity || a.updatedAt;
        const stampB = b.runtime?.lastActivityAt || b.lastActivity || b.updatedAt;
        return stampB.localeCompare(stampA);
      });
  }, [query, sessions]);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions"
          autoFocus
        />
        {onClear && (
          <Button variant="ghost" size="sm" onClick={onClear} className="text-red-500">
            Clear slot
          </Button>
        )}
      </div>
      <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
        {ordered.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onPick(session.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition hover:bg-accent',
              chosen.has(session.id) ? 'border-primary/50' : 'border-border'
            )}
          >
            <span
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                session.runtime?.busy || session.status === 'running'
                  ? 'bg-emerald-400'
                  : session.status === 'error'
                    ? 'bg-red-400'
                    : 'bg-muted-foreground/50'
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{session.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {session.runtime?.activitySummary || session.workingDirectory}
              </span>
            </span>
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">
              {session.cliProvider}
            </span>
          </button>
        ))}
        {ordered.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No matching sessions.
          </p>
        )}
      </div>
    </div>
  );
}

function MonitorTile({
  session,
  onOpen,
  onSwap,
  onClear,
}: {
  session: Session;
  onOpen: () => void;
  onSwap: () => void;
  onClear: () => void;
}) {
  const id = session.id;
  const streaming = useSessionStore((state) => state.streamingContent[id]);
  const messages = useSessionStore((state) => state.messages[id]);
  const thinking = useSessionStore((state) => state.thinking[id]);
  const activity = useSessionStore((state) => state.activity[id]);
  const activeAgent = useSessionStore((state) => state.activeAgent[id]);
  const agentRuns = useSessionStore((state) => state.agentRuns[id]);
  const tools = useSessionStore((state) => state.toolExecutions[id]);
  const queue = useSessionStore((state) => state.queueState[id]);
  const lifecycle = useSessionStore((state) => state.lifecycle[id]);
  const approvalCount = useSessionStore((state) => state.pendingApprovalCounts[id]);
  const pendingPermission = useSessionStore((state) => state.pendingPermissions[id]);
  const legacyPermission = useSessionStore((state) => state.permissionRequests[id]);
  const pendingQuestion = useSessionStore((state) => state.pendingQuestions[id]);

  const runState = getSessionRunState(session, {
    activity,
    activeAgent,
    agentRuns,
    streamingContent: streaming,
    tools,
    queue,
    lifecycle,
    pendingApprovals: approvalCount,
  });

  const lastReply = useMemo(() => {
    const list = messages ?? [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const entry = list[index];
      if (entry?.role === 'assistant' && entry.content) return entry.content;
    }
    return null;
  }, [messages]);

  const body = (streaming || lastReply || session.lastMessage || '').slice(-TAIL_CHARS);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const busy = runState.isWorking || Boolean(thinking);

  const send = async () => {
    const text = draft.trim();
    if ((!text && files.length === 0) || sending) return;
    setSending(true);
    try {
      // Files go through the same staged-upload path as the session page.
      const ack =
        files.length > 0
          ? await socketService.sendMessageWithFiles(id, text, files)
          : await socketService.sendMessage(id, text);
      if (ack && 'status' in ack && ack.status === 'rejected') {
        toast({
          title: 'Message not delivered',
          description: (ack as { error?: string }).error ?? 'The server rejected it.',
          variant: 'destructive',
        });
      } else {
        setDraft('');
        setFiles([]);
      }
    } catch (error) {
      toast({
        title: 'Message not delivered',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const respond = async (action: PermissionAction) => {
    try {
      if (pendingPermission) {
        await socketService.respondToPermission(id, pendingPermission.requestId, action);
      } else if (legacyPermission) {
        if (action === 'deny') socketService.denyPermission(id);
        else
          socketService.approvePermission(
            id,
            legacyPermission.denials.map((denial) => denial.tool_name),
            legacyPermission.originalMessage
          );
      }
    } catch (error) {
      toast({
        title: 'Could not answer approval',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const answer = async (option: string) => {
    if (!pendingQuestion) return;
    try {
      await socketService.respondToQuestion(
        id,
        pendingQuestion.requestId,
        [[option]],
        pendingQuestion.providerSessionId
      );
    } catch (error) {
      toast({
        title: 'Could not answer question',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const approvalTool =
    pendingPermission?.toolName ??
    (legacyPermission
      ? legacyPermission.denials.map((denial) => denial.tool_name).join(', ')
      : null);
  const firstQuestion = pendingQuestion?.questions[0];
  const questionOptions =
    pendingQuestion && pendingQuestion.questions.length === 1
      ? (firstQuestion?.options ?? [])
          .map((option) => option.label)
          .filter(Boolean)
          .slice(0, 3)
      : [];

  return (
    <section
      className={cn(
        'flex min-h-[220px] flex-col rounded-2xl border bg-card/70 p-3 shadow-sm backdrop-blur',
        TONE_BORDER[runState.tone]
      )}
      aria-label={`${session.name}: ${runState.label}`}
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TONE_DOT[runState.tone])} />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
          title={`Open ${session.name}`}
        >
          {session.name}
        </button>
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          {session.cliProvider}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onSwap}
          title="Change session"
        >
          <Replace className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClear}
          title="Clear slot"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOpen} title="Open chat">
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p
        className={cn(
          'mt-1 truncate text-xs',
          runState.tone === 'needs-you' || runState.tone === 'error'
            ? 'text-amber-600 dark:text-amber-300'
            : 'text-muted-foreground'
        )}
      >
        {thinking ? 'Thinking…' : runState.detail || runState.label}
      </p>

      <MonitorTail text={body} placeholder={busy ? 'Waiting for output…' : 'No output yet'} />

      {approvalTool && (
        <div className="mt-2 rounded-lg border border-amber-400/60 bg-amber-500/10 px-2 py-1.5 text-xs">
          <p className="truncate">
            Approval: <span className="font-medium">{approvalTool}</span>
          </p>
          <div className="mt-1 flex gap-1.5">
            <Button size="sm" className="h-7 px-3 text-xs" onClick={() => respond('allow_once')}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={() => respond('deny')}
            >
              Deny
            </Button>
          </div>
        </div>
      )}
      {!approvalTool && pendingQuestion && (
        <div className="mt-2 rounded-lg border border-amber-400/60 bg-amber-500/10 px-2 py-1.5 text-xs">
          <p className="line-clamp-2">{firstQuestion?.question || 'The agent asked a question'}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {questionOptions.length > 0 ? (
              questionOptions.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={() => answer(option)}
                >
                  {option}
                </Button>
              ))
            ) : (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={onOpen}>
                Answer in chat
              </Button>
            )}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {files.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px]"
            >
              <span className="max-w-[140px] truncate">{file.name}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                title="Remove attachment"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        className="mt-2 flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            if (picked.length > 0) setFiles((current) => [...current, ...picked].slice(0, 8));
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Attach files"
          disabled={sending}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" />
        </Button>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Message ${session.name}…`}
          className="h-8 text-sm"
          disabled={sending}
        />
        {busy && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-500"
            title="Interrupt"
            onClick={() => socketService.interruptSession(id)}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          type="submit"
          size="icon"
          className="h-8 w-8"
          disabled={(!draft.trim() && files.length === 0) || sending}
          title="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </section>
  );
}

/** The live text, kept scrolled to its end as it grows. */
function MonitorTail({ text, placeholder }: { text: string; placeholder: string }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (node) node.scrollTop = node.scrollHeight;
  }, [node, text]);
  return (
    <div
      ref={setNode}
      className="mt-2 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-2 font-mono text-[12px] leading-relaxed"
      style={{ maxHeight: '38vh', minHeight: '6rem' }}
    >
      {text ? text : <span className="text-muted-foreground">{placeholder}</span>}
    </div>
  );
}
export default MonitorPage;
