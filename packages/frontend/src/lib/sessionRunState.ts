import type {
  Session,
  SessionLifecycleEvent,
  SessionQueueData,
  SubagentRun,
  ToolExecution,
} from '@plum-code-webui/shared';
import type { ActivityState, AgentState } from '@/stores/sessionStore';

export type SessionRunTone = 'needs-you' | 'working' | 'live-idle' | 'idle' | 'error';

export interface LiveSessionSignals {
  activity?: ActivityState;
  activeAgent?: AgentState | null;
  agentRuns?: SubagentRun[];
  streamingContent?: string;
  tools?: ToolExecution[];
  queue?: SessionQueueData | null;
  /**
   * The last account-wide lifecycle beat. Present for every session the user
   * owns, including ones that were never opened in this tab, so it outranks
   * `session.runtime` — that snapshot is only as fresh as the last list fetch.
   */
  lifecycle?: SessionLifecycleEvent | null;
  /**
   * Approvals blocking this session, from the account-wide bootstrap. Covers
   * the gap before the first lifecycle beat for this session arrives.
   */
  pendingApprovals?: number;
}

export interface SessionRunState {
  tone: SessionRunTone;
  label: string;
  detail: string;
  isWorking: boolean;
  isLive: boolean;
  runningTools: number;
  queueDepth: number;
  /** Approvals and questions blocking this session right now. */
  pendingApprovals: number;
}

function compactDetail(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function describeTool(toolName: string | null | undefined): string | undefined {
  if (!toolName) return undefined;
  const normalized = toolName.replace(/[_\s-]/g, '').toLowerCase();
  if (
    normalized.includes('bash') ||
    normalized.includes('shell') ||
    normalized.includes('command')
  ) {
    return 'Running command';
  }
  if (normalized.includes('grep') || normalized.includes('glob') || normalized.includes('search')) {
    return 'Searching files';
  }
  if (normalized.includes('read')) return 'Reading files';
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch')) {
    return 'Editing files';
  }
  if (normalized.includes('todo')) return 'Updating tasks';
  if (normalized.includes('web')) return 'Searching the web';
  return `Using ${toolName}`;
}

/** What is actually blocking the session, in the fewest words that stay true. */
function describeBlock(approvals: number, questions: number): string {
  if (approvals > 0 && questions > 0) return 'Approval and question waiting';
  if (questions > 1) return `${questions} questions waiting`;
  if (questions === 1) return 'Waiting for an answer';
  if (approvals > 1) return `${approvals} approvals waiting`;
  return 'Waiting for approval';
}

export function getSessionRunState(
  session: Session,
  signals: LiveSessionSignals = {}
): SessionRunState {
  const lifecycle = signals.lifecycle;
  const runningTools = (signals.tools ?? []).filter((tool) => tool.status === 'started').length;
  const queueDepth =
    signals.queue?.depth ?? lifecycle?.queueDepth ?? session.runtime?.queueDepth ?? 0;
  // Approvals and questions are two ways of being blocked on the same person,
  // so the row counts them together. Only the wording below tells them apart.
  const approvals = lifecycle?.pendingApprovals ?? signals.pendingApprovals ?? 0;
  const questions = lifecycle?.pendingQuestions ?? 0;
  const pendingApprovals = approvals + questions;
  const activeSubagents = [
    ...(signals.agentRuns ?? []),
    ...(session.runtime?.subagents ?? []),
  ].filter((run) => run.status === 'started');
  const hasLiveActivity =
    signals.activity?.type === 'thinking' ||
    signals.activity?.type === 'tool' ||
    !!signals.activeAgent ||
    activeSubagents.length > 0 ||
    !!signals.streamingContent ||
    runningTools > 0 ||
    !!signals.queue?.busy;

  const isWorking = (lifecycle?.busy ?? !!session.runtime?.busy) || hasLiveActivity;
  const isLive =
    !!session.runtime?.running || (lifecycle?.status ?? session.status) === 'running' || isWorking;

  // Blocked beats busy. A session waiting on a permission or a question is the
  // only state where nothing moves until the user acts, so it has to be the one
  // a glance at the row lands on first.
  if (pendingApprovals > 0) {
    return {
      tone: 'needs-you',
      label: 'Needs you',
      detail: compactDetail(lifecycle?.activitySummary, describeBlock(approvals, questions)),
      isWorking: false,
      isLive: true,
      runningTools,
      queueDepth,
      pendingApprovals,
    };
  }

  if ((lifecycle?.status ?? session.status) === 'error') {
    return {
      tone: 'error',
      label: 'Error',
      detail: 'Session error',
      isWorking: false,
      isLive,
      runningTools,
      queueDepth,
      pendingApprovals,
    };
  }

  if (isWorking) {
    const toolName = signals.activity?.type === 'tool' ? signals.activity.toolName : undefined;
    const detail = compactDetail(
      signals.activity?.message ||
        (activeSubagents.length > 1 ? `${activeSubagents.length} subagents running` : undefined) ||
        activeSubagents[0]?.description ||
        signals.activeAgent?.description ||
        describeTool(toolName) ||
        lifecycle?.activitySummary ||
        session.runtime?.activitySummary ||
        session.runtime?.currentAgentDescription ||
        describeTool(session.runtime?.currentToolName) ||
        (session.runtime?.currentAgentType
          ? `Running ${session.runtime.currentAgentType} agent`
          : undefined) ||
        (queueDepth > 0 ? `${queueDepth} queued` : undefined),
      'Agent working'
    );
    return {
      tone: 'working',
      label: 'Working',
      detail,
      isWorking: true,
      isLive: true,
      runningTools,
      queueDepth,
      pendingApprovals,
    };
  }

  if (isLive) {
    return {
      tone: 'live-idle',
      label: 'Live idle',
      detail: 'Session process is ready',
      isWorking: false,
      isLive: true,
      runningTools,
      queueDepth,
      pendingApprovals,
    };
  }

  return {
    tone: 'idle',
    label: 'Idle',
    detail: 'No active agent process',
    isWorking: false,
    isLive: false,
    runningTools,
    queueDepth,
    pendingApprovals,
  };
}
