import { useState, useEffect, memo } from 'react';
import {
  FileText,
  Search,
  Edit3,
  Terminal,
  Globe,
  FolderSearch,
  GitBranch,
  CheckSquare,
  Cpu,
  Wrench,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Brain,
  Bug,
  Server,
  Shield,
  Gauge,
  BookOpen,
  Database,
  Layers,
  Rocket,
  FlaskConical,
  Palette,
  Code2,
  Smartphone,
} from 'lucide-react';
import type { ToolExecution } from '@plum-code-webui/shared';
import { ToolLoader } from './providerAnimations/ToolLoader';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ToolExecutionCardProps {
  execution: ToolExecution;
}

// Map subagent types to display info
const agentTypeMap: Record<string, { icon: typeof Wrench; label: string }> = {
  Explore: { icon: Search, label: 'Explorer' },
  Plan: { icon: BookOpen, label: 'Planner' },
  'general-purpose': { icon: Brain, label: 'General Agent' },
  'research-bot': { icon: Globe, label: 'Research' },
  'frontend-developer': { icon: Code2, label: 'Frontend Dev' },
  'mobile-developer': { icon: Smartphone, label: 'Mobile Dev' },
  'backend-dev': { icon: Server, label: 'Backend Dev' },
  'fullstack-dev': { icon: Layers, label: 'Fullstack Dev' },
  'api-designer': { icon: Wrench, label: 'API Designer' },
  'ui-designer': { icon: Palette, label: 'UI Designer' },
  'devops-engineer': { icon: Rocket, label: 'DevOps' },
  'database-specialist': { icon: Database, label: 'Database' },
  'git-operations': { icon: GitBranch, label: 'Git Ops' },
  'debugging-expert': { icon: Bug, label: 'Debugger' },
  'system-architect': { icon: Layers, label: 'Architect' },
  'test-engineer': { icon: FlaskConical, label: 'Test Engineer' },
  'security-auditor': { icon: Shield, label: 'Security' },
  'performance-optimizer': { icon: Gauge, label: 'Performance' },
  'release-manager': { icon: Rocket, label: 'Release' },
  'data-engineer': { icon: Database, label: 'Data Engineer' },
  'documentation-writer': { icon: BookOpen, label: 'Docs' },
  'statusline-setup': { icon: Terminal, label: 'Status Line' },
};

// Map tool names to icons and labels
export const getToolDisplay = (
  toolName: string,
  input?: unknown
): { icon: typeof Wrench; label: string; inputLabel: string } => {
  // For Task/Agent tools, extract subagent_type for better display
  if (toolName === 'Task' || toolName === 'Agent') {
    const inputObj = input as Record<string, unknown> | undefined;
    const subagentType = inputObj?.subagent_type as string | undefined;

    if (subagentType && agentTypeMap[subagentType]) {
      const agent = agentTypeMap[subagentType];
      return { icon: agent.icon, label: agent.label, inputLabel: 'Task' };
    }

    if (subagentType) {
      return { icon: Brain, label: subagentType, inputLabel: 'Task' };
    }

    return { icon: Cpu, label: 'Agent', inputLabel: 'Task' };
  }

  const toolMap: Record<string, { icon: typeof Wrench; label: string; inputLabel: string }> = {
    Write: { icon: FileText, label: 'Write', inputLabel: 'File' },
    Read: { icon: Search, label: 'Read', inputLabel: 'File' },
    Edit: { icon: Edit3, label: 'Edit', inputLabel: 'File' },
    Bash: { icon: Terminal, label: 'Bash', inputLabel: 'Command' },
    WebFetch: { icon: Globe, label: 'Fetch', inputLabel: 'URL' },
    WebSearch: { icon: Globe, label: 'Search', inputLabel: 'Query' },
    Glob: { icon: FolderSearch, label: 'Glob', inputLabel: 'Pattern' },
    Grep: { icon: Search, label: 'Grep', inputLabel: 'Pattern' },
    LS: { icon: FolderSearch, label: 'List', inputLabel: 'Path' },
    TodoWrite: { icon: CheckSquare, label: 'Todo', inputLabel: 'Tasks' },
    Git: { icon: GitBranch, label: 'Git', inputLabel: 'Command' },
  };

  return toolMap[toolName] || { icon: Wrench, label: toolName, inputLabel: 'Input' };
};

// Extract the main input value for preview
const getInputPreview = (toolName: string, input: unknown): string => {
  if (!input) return '';
  if (typeof input === 'string') return input;

  const inputObj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return String(inputObj.command || inputObj.description || '');
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(inputObj.file_path || '');
    case 'Glob':
    case 'Grep':
      return String(inputObj.pattern || '');
    case 'WebFetch':
      return String(inputObj.url || '');
    case 'WebSearch':
      return String(inputObj.query || '');
    case 'Task':
    case 'Agent':
      return String(inputObj.description || inputObj.prompt || '');
    default:
      return JSON.stringify(input).substring(0, 100);
  }
};

function compactText(value: string, maxLength = 96): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 1).trim()}...`;
}

function stripShellWrapper(command: string): string {
  const trimmed = command.trim();
  const shellMatch = trimmed.match(/^(?:\/bin\/)?(?:ba)?sh\s+-lc\s+(['"])([\s\S]*)\1$/);
  return shellMatch?.[2] ? shellMatch[2].trim() : trimmed;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function getChangeSummary(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const inputObj = input as Record<string, unknown>;
  const changes = inputObj.changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;

  const files = changes
    .map((change) => {
      if (!change || typeof change !== 'object') return null;
      const changeObj = change as Record<string, unknown>;
      const path = String(
        changeObj.path || changeObj.file || changeObj.file_path || changeObj.filename || ''
      );
      return path ? basename(path) : null;
    })
    .filter((value): value is string => !!value);

  if (files.length === 0) {
    return `Updates ${changes.length} file${changes.length === 1 ? '' : 's'}`;
  }

  const uniqueFiles = Array.from(new Set(files));
  if (uniqueFiles.length === 1) return `Updates ${uniqueFiles[0]}`;
  return `Updates ${uniqueFiles.length} files`;
}

function describeShellCommand(command: string): { title: string; description: string } {
  const inner = stripShellWrapper(command);
  const lower = inner.toLowerCase();
  const commandPreview = compactText(inner, 110);

  if (lower.includes('plum-rebuild.sh')) {
    return {
      title: 'Deploying rebuild',
      description: 'Asks the rebuild sidecar to rebuild and restart the WebUI.',
    };
  }
  if (lower.includes('rebuild-robot-status') || lower.includes('rebuild-robot.log')) {
    return {
      title: 'Checking rebuild status',
      description: 'Reads the rebuild sidecar status and recent deploy log.',
    };
  }
  if (lower.includes('typecheck') || lower.includes('tsc')) {
    return { title: 'Checking TypeScript', description: 'Runs the frontend/backend type checker.' };
  }
  if (lower.includes('prettier --write')) {
    return {
      title: 'Formatting code',
      description: 'Applies the repository formatter to the touched files.',
    };
  }
  if (lower.includes('prettier --check')) {
    return {
      title: 'Checking formatting',
      description: 'Verifies files against the repository formatter.',
    };
  }
  if (lower.startsWith('rg ') || lower.includes(' rg ')) {
    return {
      title: 'Searching codebase',
      description: 'Finds matching files and symbols in the project.',
    };
  }
  if (
    lower.startsWith('sed ') ||
    lower.startsWith('cat ') ||
    lower.startsWith('nl ') ||
    lower.startsWith('tail ') ||
    lower.startsWith('head ')
  ) {
    return {
      title: 'Reading project files',
      description: 'Loads the relevant source or log context.',
    };
  }
  if (lower.startsWith('curl ') || lower.includes(' curl ')) {
    return {
      title: 'Checking service response',
      description: 'Calls a local or remote endpoint to verify behavior.',
    };
  }
  if (lower.startsWith('ss ') || lower.startsWith('netstat ') || lower.includes(' lsof ')) {
    return {
      title: 'Checking open ports',
      description: 'Inspects which services are listening locally.',
    };
  }
  if (lower.startsWith('git status')) {
    return { title: 'Checking git status', description: 'Reviews the current worktree state.' };
  }
  if (lower.startsWith('git diff')) {
    return { title: 'Reviewing changes', description: 'Reads the diff for the current edits.' };
  }
  if (lower.includes('pnpm') && lower.includes('build')) {
    return {
      title: 'Building app',
      description: 'Compiles the project to catch build-time issues.',
    };
  }
  if (lower.includes('pnpm') && lower.includes('test')) {
    return { title: 'Running tests', description: 'Executes the relevant test suite.' };
  }

  return { title: 'Running command', description: commandPreview };
}

function getToolNarrative(
  toolName: string,
  input: unknown,
  fallbackLabel: string
): { title: string; description: string; detail: string } {
  const preview = getInputPreview(toolName, input);
  const normalized = toolName.replace(/[_\s.-]/g, '').toLowerCase();
  const detail = preview ? compactText(stripShellWrapper(preview), 140) : '';

  if (
    normalized.includes('bash') ||
    normalized.includes('shell') ||
    normalized.includes('command')
  ) {
    const shell = describeShellCommand(preview);
    return { ...shell, detail };
  }

  if (toolName === 'Task' || toolName === 'Agent') {
    return {
      title: fallbackLabel,
      description: detail || 'Runs a focused subagent task.',
      detail,
    };
  }

  if (
    normalized.includes('edit') ||
    normalized.includes('write') ||
    normalized.includes('filechange')
  ) {
    const changeSummary = getChangeSummary(input);
    return {
      title: changeSummary || (detail ? `Editing ${basename(detail)}` : 'Editing files'),
      description: changeSummary ? 'Applies source changes.' : detail || 'Applies source changes.',
      detail,
    };
  }

  if (normalized.includes('read')) {
    return {
      title: detail ? `Reading ${basename(detail)}` : 'Reading files',
      description: detail || 'Loads source context.',
      detail,
    };
  }

  if (normalized.includes('grep') || normalized.includes('glob') || normalized.includes('search')) {
    return {
      title: 'Searching project',
      description: detail || 'Finds matching files and symbols.',
      detail,
    };
  }

  if (normalized.includes('todo')) {
    return {
      title: 'Updating task list',
      description: 'Keeps the active work checklist in sync.',
      detail,
    };
  }

  return {
    title: fallbackLabel,
    description: detail || 'Runs a tool step.',
    detail,
  };
}

// Format full input for the detail dialog.
const formatInput = (toolName: string, input: unknown): { label: string; value: string }[] => {
  if (!input) return [];
  if (typeof input === 'string') return [{ label: 'Input', value: input }];

  const inputObj = input as Record<string, unknown>;
  const result: { label: string; value: string }[] = [];

  switch (toolName) {
    case 'Bash':
      if (inputObj.command) result.push({ label: 'Command', value: String(inputObj.command) });
      // `description` is the agent's one-line summary of the command, not a path.
      // Labelled "Working directory" it read as a claim about where the command
      // ran — the opposite of what the detail dialog exists for.
      if (inputObj.description)
        result.push({ label: 'Description', value: String(inputObj.description) });
      if (inputObj.cwd) result.push({ label: 'Working directory', value: String(inputObj.cwd) });
      if (inputObj.timeout) result.push({ label: 'Timeout', value: `${inputObj.timeout}ms` });
      break;
    case 'Read':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.offset) result.push({ label: 'Offset', value: String(inputObj.offset) });
      if (inputObj.limit) result.push({ label: 'Limit', value: String(inputObj.limit) });
      break;
    case 'Write':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.content) result.push({ label: 'Content', value: String(inputObj.content) });
      break;
    case 'Edit':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.old_string) result.push({ label: 'Find', value: String(inputObj.old_string) });
      if (inputObj.new_string)
        result.push({ label: 'Replace', value: String(inputObj.new_string) });
      break;
    case 'Glob':
      if (inputObj.pattern) result.push({ label: 'Pattern', value: String(inputObj.pattern) });
      if (inputObj.path) result.push({ label: 'Path', value: String(inputObj.path) });
      break;
    case 'Grep':
      if (inputObj.pattern) result.push({ label: 'Pattern', value: String(inputObj.pattern) });
      if (inputObj.path) result.push({ label: 'Path', value: String(inputObj.path) });
      if (inputObj.glob) result.push({ label: 'Glob', value: String(inputObj.glob) });
      break;
    case 'WebFetch':
      if (inputObj.url) result.push({ label: 'URL', value: String(inputObj.url) });
      if (inputObj.prompt) result.push({ label: 'Prompt', value: String(inputObj.prompt) });
      break;
    case 'WebSearch':
      if (inputObj.query) result.push({ label: 'Query', value: String(inputObj.query) });
      break;
    case 'Task':
    case 'Agent':
      if (inputObj.description)
        result.push({ label: 'Description', value: String(inputObj.description) });
      if (inputObj.prompt) result.push({ label: 'Prompt', value: String(inputObj.prompt) });
      if (inputObj.subagent_type)
        result.push({ label: 'Agent Type', value: String(inputObj.subagent_type) });
      break;
    default:
      result.push({ label: 'Input', value: JSON.stringify(input, null, 2) });
  }

  return result;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function LiveDuration({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="text-[10px] font-mono text-blue-400 tabular-nums ml-1">
      {formatDuration(elapsed)}
    </span>
  );
}

// Status icon component
const StatusIcon = ({ status }: { status: 'started' | 'completed' | 'error' }) => {
  switch (status) {
    case 'started':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
};

function buildDetailedExplanation(params: {
  description: string;
  toolName: string;
  status: ToolExecution['status'];
  duration: number | null;
  isSubagent: boolean;
}): string {
  const statusText =
    params.status === 'started'
      ? 'This action is still running.'
      : params.status === 'error'
        ? 'This action failed.'
        : 'This action completed.';
  const durationText =
    params.duration != null ? ` Runtime: ${formatDuration(params.duration)}.` : '';
  const toolText = params.isSubagent
    ? ` It launched a focused ${params.toolName} workflow.`
    : ` Tool: ${params.toolName}.`;
  return `${params.description} ${statusText}${durationText}${toolText}`
    .replace(/\s+/g, ' ')
    .trim();
}

export const ToolExecutionCard = memo(function ToolExecutionCard({
  execution,
}: ToolExecutionCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const { icon: Icon, label } = getToolDisplay(execution.toolName, execution.input);
  const narrative = execution.actionSummary
    ? {
        title: execution.actionSummary.title,
        description: execution.actionSummary.explanation,
        detail: getInputPreview(execution.toolName, execution.input),
      }
    : getToolNarrative(execution.toolName, execution.input, label);
  const summaryPending = execution.actionSummary?.source === 'agent-pending';

  const hasInput = execution.input !== undefined && execution.input !== null;
  const hasOutput = Boolean(execution.result || execution.error);
  const hasDetails = hasInput || hasOutput || Boolean(narrative.description);

  const formattedInput = formatInput(execution.toolName, execution.input);

  // Duration
  const duration = execution.completedAt ? execution.completedAt - execution.timestamp : null;
  const isRunning = execution.status === 'started';

  // Subagent runs (Task/Agent tools) get distinct styling so that nested agent
  // activity is obvious at a glance in the message timeline.
  const isSubagent = execution.toolName === 'Task' || execution.toolName === 'Agent';

  const containerClass = cn(
    'tool-card',
    isSubagent && 'is-subagent',
    isRunning && 'is-running',
    summaryPending && 'is-summary-pending',
    execution.status === 'completed' && 'is-completed',
    execution.status === 'error' && 'is-error'
  );
  const kindLabel = isSubagent ? 'Agent' : label;
  const detailExplanation = buildDetailedExplanation({
    description: narrative.description,
    toolName: execution.toolName,
    status: execution.status,
    duration,
    isSubagent,
  });

  return (
    <>
      <button
        type="button"
        className={cn(containerClass, hasDetails && 'is-clickable')}
        onClick={() => setDetailOpen(true)}
        aria-label={`Open details for ${narrative.title}`}
      >
        <span className="tool-card-head">
          {isRunning ? (
            <span className="tool-card-icon is-loader">
              <ToolLoader toolName={execution.toolName} size={24} />
            </span>
          ) : (
            <span className="tool-card-icon">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className="tool-card-copy">
            <span className="tool-card-title-row">
              <span className="tool-card-title">{narrative.title}</span>
              <span className="tool-card-kind">{summaryPending ? 'Template' : kindLabel}</span>
            </span>
            <span className="tool-card-description">{narrative.description}</span>
          </span>
          {isRunning ? (
            <LiveDuration startedAt={execution.timestamp} />
          ) : duration != null ? (
            <span className={cn('tool-card-duration', duration > 5000 && 'is-slow')}>
              {formatDuration(duration)}
            </span>
          ) : null}
          <ChevronRight className="tool-card-chevron h-3 w-3" />
          <StatusIcon status={execution.status} />
        </span>
      </button>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="tool-detail-dialog">
          <DialogHeader className="tool-detail-header">
            <div className="tool-detail-heading">
              <span className="tool-detail-icon">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="tool-detail-title">{narrative.title}</DialogTitle>
                <DialogDescription className="tool-detail-description">
                  {kindLabel} · {execution.status}
                  {duration != null ? ` · ${formatDuration(duration)}` : ''}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <section className="tool-detail-summary">
            <span className="tool-detail-section-label">What happened</span>
            <p>{detailExplanation}</p>
          </section>

          {formattedInput.length > 0 && (
            <section className="tool-detail-section">
              <span className="tool-detail-section-label">Raw input</span>
              <div className="tool-detail-stack">
                {formattedInput.map((item, idx) => (
                  <div key={idx} className="tool-detail-raw-block">
                    <span className="tool-detail-raw-label">{item.label}</span>
                    <pre>{item.value}</pre>
                  </div>
                ))}
              </div>
            </section>
          )}

          {execution.result && (
            <section className="tool-detail-section">
              <span className="tool-detail-section-label">Raw output</span>
              <div className="tool-detail-raw-block">
                <pre>{execution.result}</pre>
              </div>
            </section>
          )}

          {execution.error && (
            <section className="tool-detail-section">
              <span className="tool-detail-section-label is-error">Error</span>
              <div className="tool-detail-raw-block is-error">
                <pre>{execution.error}</pre>
              </div>
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
