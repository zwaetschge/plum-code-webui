import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProviderStore } from '@/stores/providerStore';
import { UI_PROVIDER_META, type UiProvider } from '@/lib/providers';
import { MemoizedMarkdown } from './MemoizedMarkdown';
import { ProviderLoader } from './providerAnimations/ProviderLoader';
import { StreamingCursor, streamingContentClass } from './providerAnimations/StreamingCursor';
import { normalizeClaudeDisplayContent } from '@/lib/claudeDisplay';
import { ProviderToolNotice } from './ProviderToolNotice';
import 'katex/dist/katex.min.css';

interface StreamingContentProps {
  content: string;
  onResponse?: (response: string) => void;
  provider?: UiProvider;
  providerLabel?: string;
}

const LIVE_MARKDOWN_CHAR_LIMIT = 6000;
const WORD_REVEAL_INTERVAL_MS = 64;
const WORD_REVEAL_SPACE_INTERVAL_MS = 10;
const WORD_REVEAL_FAST_LAG_CHARS = 420;
const WORD_REVEAL_MAX_LAG_CHARS = 1100;
const WORD_REVEAL_DISABLE_CHAR_LIMIT = 24000;

// Strip ANSI escape codes for clean text.
//
// This runs over the entire accumulated answer on every flush — dozens of times
// a second on a long stream. Everything except the legacy Claude CLI arrives as
// clean assistant deltas from the backend and contains no escapes at all, so a
// single scan for the escape byte skips the alternating regex and the copy of
// the whole string that comes with it. Cheaper than caching a stripped head,
// and without the risk of splitting an escape sequence across the boundary.
function stripAnsi(text: string): string {
  if (!text.includes('\x1b')) return text;
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[\?[0-9;]*[a-zA-Z]/g, '');
}

// Parse Claude CLI output into structured content
function parseClaudeOutput(content: string): {
  type: 'trust' | 'selection' | 'thinking' | 'response' | 'welcome' | 'empty' | 'plan_mode';
  path?: string;
  title?: string;
  options?: { number: string; label: string; selected: boolean }[];
  thinkingTime?: string;
  message?: string;
  isIdeating?: boolean;
  welcomeData?: {
    version: string;
    model: string;
    workingDir: string;
  };
} {
  const cleanContent = stripAnsi(content);

  // Check for trust prompt FIRST (highest priority - needs user action)
  const trustMatch = cleanContent.match(
    /Do you trust the files in this folder\?[\s\S]*?(\/[^\s\n]+)/
  );
  if (trustMatch && trustMatch[1]) {
    return { type: 'trust', path: trustMatch[1] };
  }

  // Check for selection prompts EARLY (they need user interaction)
  // Look for "Enter to select" footer which indicates a selection dialog
  if (cleanContent.includes('Enter to select') || cleanContent.includes('Tab/Arrow keys')) {
    const optionMatches = cleanContent.matchAll(
      /(?:❯\s*)?(\d+)\.\s*([^\n]+?)(?:\s+[A-Z][^\n]*)?$/gm
    );
    const options: { number: string; label: string; selected: boolean }[] = [];

    for (const match of optionMatches) {
      const num = match[1] ?? '';
      let label = match[2] ?? '';
      // Clean up the label
      label = label.replace(/\s+A\s+.*$/, '').trim();
      if (label && !label.includes('for shortcuts') && !label.includes('Enter to select')) {
        options.push({
          number: num,
          label: label,
          selected: cleanContent.includes(`❯ ${num}.`) || cleanContent.includes(`❯${num}.`),
        });
      }
    }

    if (options.length >= 2) {
      // Find the question/title
      const lines = cleanContent.split('\n').filter((l) => l.trim());
      const titleLine = lines.find(
        (l) =>
          l.includes('?') &&
          !l.match(/^\s*❯?\s*\d+\./) &&
          !l.includes('for shortcuts') &&
          !l.includes('Enter to select')
      );

      return { type: 'selection', title: titleLine?.trim() || 'Select an option', options };
    }
  }

  // Check for plan mode (but not if there's actual content after it)
  if (cleanContent.includes('Entered plan mode') && !cleanContent.includes('Enter to select')) {
    // Extract any message after the plan mode indicator
    const planModeMatch = cleanContent.match(/(?:Entered plan mode|plan mode)[^\n]*\n?([\s\S]*)/i);
    const planMessage = planModeMatch?.[1]?.trim() || '';

    // Clean up the message - remove repeated status lines
    const cleanMessage = planMessage
      .split('\n')
      .filter(
        (l) =>
          !l.includes('Ideating') &&
          !l.includes('Cooking') &&
          !l.includes('? for shortcuts') &&
          !l.includes('esc to interrupt') &&
          !l.includes('plan mode on') &&
          !l.match(/^[✶✻✽·✢*]\s*$/) &&
          !l.match(/^─+$/) &&
          !l.match(/^>\s*$/) &&
          l.trim()
      )
      .join('\n')
      .replace(/Claude is now exploring[\s\S]*?approval\.\s*/i, '')
      .trim();

    // If there's meaningful content after plan mode message, show it as response
    if (cleanMessage.length > 30) {
      return {
        type: 'response',
        message: cleanMessage,
      };
    }

    return {
      type: 'plan_mode',
      message: 'Claude is exploring the codebase and designing an implementation approach...',
    };
  }

  // Check for Claude's actual response (starts with ● or similar bullet)
  // This takes priority over thinking state and welcome screen
  const responseMatch = cleanContent.match(
    /[●○◉◎]\s*([\s\S]*?)(?:(?:\n\s*>\s*$|\n\s*[✶✻✽·✢*]\s|\n\s*\? for shortcuts|\n\s*Hatching)[\s\S]*$|$)/
  );
  if (responseMatch && responseMatch[1]) {
    const message = responseMatch[1]
      .trim()
      .replace(/\s*\? for shortcuts\s*$/g, '')
      .replace(/\s*>\s*$/g, '')
      .replace(/\s*Hatching[\s\S]*$/g, '')
      .trim();

    if (message && message.length > 5) {
      return {
        type: 'response',
        message,
      };
    }
  }

  // Check for general text content that doesn't match other patterns
  // This catches responses that don't start with bullets
  const lines = cleanContent.split('\n').filter((l) => l.trim());
  const textContent = lines
    .filter(
      (l) =>
        !l.includes('Cooking') &&
        !l.includes('Hatching') &&
        !l.includes('? for shortcuts') &&
        !l.match(/^[✶✻✽·✢*]\s/) &&
        !l.match(/^>\s*$/) &&
        !l.includes('esc to interrupt')
    )
    .join('\n')
    .trim();

  if (textContent.length > 20) {
    return {
      type: 'response',
      message: textContent,
    };
  }

  // Check for selection prompts (numbered options with specific patterns)
  // Only detect if there's a clear question/title before the options
  const hasQuestion = cleanContent.includes('?') && !cleanContent.includes('? for shortcuts');
  if (hasQuestion) {
    const optionMatches = cleanContent.matchAll(/(\d+)\.\s*([^\n]+)/g);
    const options: { number: string; label: string; selected: boolean }[] = [];

    for (const match of optionMatches) {
      const num = match[1] ?? '';
      const label = match[2] ?? '';
      // Skip if it looks like a list item in regular text
      if (label.trim() && !label.includes('for shortcuts')) {
        options.push({
          number: num,
          label: label.trim(),
          selected: cleanContent.includes(`❯ ${num}`) || cleanContent.includes(`❯${num}`),
        });
      }
    }

    if (options.length >= 2 && options.length <= 5) {
      const lines = cleanContent.split('\n').filter((l) => l.trim());
      const title =
        lines.find(
          (l) =>
            l.includes('?') &&
            !l.match(/^\d+\./) &&
            !l.includes('❯') &&
            !l.includes('for shortcuts')
        ) || '';

      return { type: 'selection', title: title.trim(), options };
    }
  }

  // Check for thinking/processing state
  const thinkingPatterns = [
    /Ideating….*?thought for (\d+s?)/i,
    /Ideating….*?thinking/i,
    /Ideating…/i,
    /Hatching….*?thinking/i,
    /Hatching….*?thought for (\d+s?)/i,
    /Cooking…/i,
    /thinking\.\.\./i,
    /processing/i,
  ];

  let thinkingTime = '';
  let isThinking = false;
  let isIdeating = false;

  for (const pattern of thinkingPatterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      isThinking = true;
      isIdeating = /Ideating/i.test(cleanContent);
      if (match[1]) {
        thinkingTime = match[1];
      }
      break;
    }
  }

  // If still thinking with no response yet
  if (isThinking) {
    return { type: 'thinking', thinkingTime, isIdeating };
  }

  // Check for welcome screen ONLY if no response was found
  if (cleanContent.includes('Claude Code v') && cleanContent.includes('Welcome')) {
    const versionMatch = cleanContent.match(/Claude Code v([\d.]+)/);
    const modelMatch = cleanContent.match(/(?:Opus|Sonnet|Haiku)[\s\d.]+/i);
    const dirMatch = cleanContent.match(/~\/[^\s│╯]+/);

    return {
      type: 'welcome',
      welcomeData: {
        version: versionMatch?.[1] || '',
        model: modelMatch?.[0]?.trim() || 'Claude',
        workingDir: dirMatch?.[0] || '',
      },
    };
  }

  return { type: 'empty' };
}

type ParsedStreamingOutput = ReturnType<typeof parseClaudeOutput>;

function parseProviderOutput(content: string, provider: UiProvider): ParsedStreamingOutput {
  // Codex/OpenCode stream clean assistant deltas through the backend. The
  // heavy terminal-screen parser exists for legacy Claude CLI output only.
  if (provider !== 'claude' && provider !== 'zai') {
    const cleanContent = stripAnsi(content);
    return cleanContent.trim() ? { type: 'response', message: cleanContent } : { type: 'empty' };
  }

  return parseClaudeOutput(content);
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a.charCodeAt(index) === b.charCodeAt(index)) {
    index += 1;
  }
  return index;
}

function takeRevealSlice(remaining: string, maxTokens: number): string {
  let consumed = '';
  let rest = remaining;

  for (let index = 0; index < maxTokens && rest; index += 1) {
    const match = rest.match(/^(\s+|[^\s]+)/);
    const token = match?.[0] ?? rest.charAt(0);
    consumed += token;
    rest = rest.slice(token.length);
  }

  return consumed;
}

function useWordRevealText(target: string): string {
  const [visible, setVisible] = useState('');
  const targetRef = useRef(target);
  const visibleRef = useRef('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = target;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || target.length > WORD_REVEAL_DISABLE_CHAR_LIMIT) {
      visibleRef.current = target;
      setVisible(target);
      return;
    }

    if (!target.startsWith(visibleRef.current)) {
      const prefixLength = commonPrefixLength(target, visibleRef.current);
      const nextVisible = target.slice(0, prefixLength);
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
    }

    const tick = () => {
      const current = visibleRef.current;
      const wanted = targetRef.current;

      if (current === wanted) {
        timerRef.current = null;
        return;
      }

      if (!wanted.startsWith(current)) {
        const prefixLength = commonPrefixLength(wanted, current);
        const nextVisible = wanted.slice(0, prefixLength);
        visibleRef.current = nextVisible;
        setVisible(nextVisible);
      } else {
        const remaining = wanted.slice(current.length);
        const lag = wanted.length - current.length;
        const burst =
          lag > WORD_REVEAL_MAX_LAG_CHARS ? 10 : lag > WORD_REVEAL_FAST_LAG_CHARS ? 4 : 1;
        const slice = takeRevealSlice(remaining, burst);
        const nextVisible = current + slice;
        visibleRef.current = nextVisible;
        setVisible(nextVisible);
      }

      const delay = /\s$/.test(visibleRef.current)
        ? WORD_REVEAL_SPACE_INTERVAL_MS
        : WORD_REVEAL_INTERVAL_MS;
      timerRef.current = window.setTimeout(tick, delay);
    };

    if (timerRef.current === null && targetRef.current !== visibleRef.current) {
      timerRef.current = window.setTimeout(tick, 0);
    }
  }, [target]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  return visible;
}

// Trust Dialog Component
function TrustDialog({
  path,
  providerName,
  onResponse,
}: {
  path: string;
  providerName: string;
  onResponse?: (response: string) => void;
}) {
  const [isResponding, setIsResponding] = useState(false);

  const handleResponse = (response: 'yes' | 'no') => {
    setIsResponding(true);
    const input = response === 'yes' ? '1' : '2';
    onResponse?.(input);
  };

  return (
    <Card className="p-0 overflow-hidden border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
      <div className="flex items-center gap-3 p-4 bg-amber-500/10 border-b border-amber-500/20">
        <div className="p-2 rounded-lg bg-amber-500/20">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Do you trust the files in this folder?</h3>
          <p className="text-xs text-muted-foreground">Security confirmation required</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 font-mono text-sm">
          <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">{path}</span>
        </div>

        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          <p>
            {providerName} may read, write, or execute files in this directory. Only trust folders
            from known sources.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => handleResponse('yes')}
            disabled={isResponding}
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            Yes, proceed
          </Button>
          <Button
            onClick={() => handleResponse('no')}
            disabled={isResponding}
            variant="outline"
            className="flex-1 gap-2 border-red-500/30 text-red-500 hover:bg-red-500/10"
          >
            <XCircle className="h-4 w-4" />
            No, exit
          </Button>
        </div>
      </div>
    </Card>
  );
}

// Selection Dialog Component
function SelectionDialog({
  title,
  options,
  onResponse,
}: {
  title: string;
  options: { number: string; label: string; selected: boolean }[];
  onResponse?: (response: string) => void;
}) {
  const [isResponding, setIsResponding] = useState(false);

  const handleSelect = (number: string) => {
    setIsResponding(true);
    onResponse?.(number);
  };

  // Parse label to separate title from description
  const parseOption = (label: string) => {
    // Pattern: "Fun/playful app A whimsical app..." or just "Fun/playful app"
    const match = label.match(/^([^A-Z]*[a-z])(\s+[A-Z].*)$/);
    if (match && match[1] && match[2]) {
      return { title: match[1].trim(), description: match[2].trim() };
    }
    return { title: label, description: '' };
  };

  return (
    <Card className="max-w-[95%] sm:max-w-[85%] md:max-w-[80%] p-0 overflow-hidden border-2 border-primary/30">
      <div className="flex items-center gap-3 p-4 bg-primary/10 border-b border-primary/20">
        <div className="p-2 rounded-lg bg-primary/20">
          <AlertTriangle className="h-5 w-5 text-primary" />
        </div>
        <h3 className="font-semibold text-base">{title || 'Select an option'}</h3>
      </div>

      <div className="p-4 space-y-2">
        {options.map((option) => {
          const { title: optTitle, description } = parseOption(option.label);
          return (
            <Button
              key={option.number}
              onClick={() => handleSelect(option.number)}
              disabled={isResponding}
              variant={option.selected ? 'default' : 'outline'}
              className={cn(
                'w-full justify-start gap-3 h-auto py-3 px-4',
                option.selected && 'ring-2 ring-primary'
              )}
            >
              <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-sm font-mono shrink-0">
                {option.number}
              </span>
              <div className="text-left">
                <div className="font-medium">{optTitle}</div>
                {description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                )}
              </div>
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

// Welcome screen component
function WelcomeScreen({
  data,
  providerName,
}: {
  data: { version: string; model: string; workingDir: string };
  providerName: string;
}) {
  return (
    <Card className="max-w-[95%] sm:max-w-md p-0 overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/5">
      <div className="p-6 text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{providerName} Ready</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data.model} · v{data.version}
          </p>
        </div>
        {data.workingDir && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 text-xs font-mono text-muted-foreground">
            <Shield className="h-3 w-3" />
            {data.workingDir}
          </div>
        )}
      </div>
    </Card>
  );
}

// Thinking indicator — shows per-provider organic loader (Template A)
function ThinkingIndicator({
  thinkingTime,
  isIdeating,
  providerLabel,
  provider,
}: {
  thinkingTime?: string;
  isIdeating?: boolean;
  providerLabel: string;
  provider: UiProvider;
}) {
  return (
    <div className={cn('pl-inline-thinking', isIdeating && 'is-ideating')}>
      <div className="pl-inline-thinking-mark">
        <ProviderLoader provider={provider} size={24} accent={isIdeating} />
      </div>
      <div className="min-w-0">
        <span className="pl-inline-thinking-title">
          {isIdeating ? `${providerLabel} ideating` : `${providerLabel} thinking`}
          <span className="pl-thinking-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        {thinkingTime && <span className="pl-inline-thinking-detail">{thinkingTime}</span>}
      </div>
    </div>
  );
}

// Plan mode indicator
function PlanModeIndicator({
  message,
  providerLabel,
}: {
  message?: string;
  providerLabel: string;
}) {
  const sanitizedMessage = message?.replace(/Claude/gi, providerLabel);
  return (
    <Card className="max-w-[95%] sm:max-w-[85%] md:max-w-[80%] p-0 overflow-hidden border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-transparent">
      <div className="flex items-center gap-3 p-4 bg-blue-500/10 border-b border-blue-500/20">
        <div className="p-2 rounded-lg bg-blue-500/20">
          <Sparkles className="h-5 w-5 text-blue-500 animate-pulse" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Plan Mode</h3>
          <p className="text-xs text-muted-foreground">Exploring and designing implementation</p>
        </div>
      </div>
      {sanitizedMessage && (
        <div className="p-4">
          <MemoizedMarkdown
            content={sanitizedMessage}
            className="prose prose-sm dark:prose-invert max-w-none"
          />
        </div>
      )}
    </Card>
  );
}

function LiveStreamingText({ message }: { message: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
      {message}
    </div>
  );
}

// The word reveal changes `visibleMessage` many times a second. Re-parsing the
// whole accumulated answer through remark+KaTeX on each tick is what made long
// streams expensive, so only the settled part (up to the last completed
// paragraph) goes through markdown; the in-flight tail renders as plain text
// until its paragraph completes. Never split inside an open code fence.
function splitSettledMarkdown(text: string): { settled: string; tail: string } {
  const boundary = text.lastIndexOf('\n\n');
  if (boundary <= 0) return { settled: '', tail: text };
  const settled = text.slice(0, boundary + 2);
  const fences = settled.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) return { settled: '', tail: text };
  return { settled, tail: text.slice(boundary + 2) };
}

// The word-fade wraps every token in its own `<span>`, and those spans stay in
// the DOM — with `will-change` on each — for as long as the message is on screen.
// Over a long answer that is thousands of composited nodes inside a container
// Virtuoso re-measures, and a screen reader reading hundreds of inline fragments
// instead of a paragraph. Only the block that is actually appearing needs the
// treatment, so the settled text is cut once more: everything before the final
// paragraph renders as ordinary markdown.
function splitTrailingBlock(settled: string): { head: string; trailing: string } {
  const withoutTrailingBreak = settled.endsWith('\n\n') ? settled.slice(0, -2) : settled;
  const boundary = withoutTrailingBreak.lastIndexOf('\n\n');
  if (boundary <= 0) return { head: '', trailing: settled };
  const head = settled.slice(0, boundary + 2);
  // A block that opens a code fence has to stay with its closing fence.
  if ((head.match(/```/g)?.length ?? 0) % 2 === 1) return { head: '', trailing: settled };
  return { head, trailing: settled.slice(boundary + 2) };
}

// Live response with markdown and LaTeX support for normal-sized partial text.
// Very long partial streams render as plain text until the final persisted
// message arrives; that avoids reparsing a large markdown document every flush.
function ClaudeResponse({ message, provider }: { message: string; provider: UiProvider }) {
  const normalized = useMemo(
    () =>
      provider === 'claude' || provider === 'zai'
        ? normalizeClaudeDisplayContent(message)
        : { message, providerTools: [], providerToolComplete: false },
    [provider, message]
  );
  const shouldUsePlainText = normalized.message.length > LIVE_MARKDOWN_CHAR_LIMIT;
  const visibleMessage = useWordRevealText(normalized.message);
  const isRevealing = visibleMessage.length < normalized.message.length;
  const { settled, tail } = useMemo(
    () => (shouldUsePlainText ? { settled: '', tail: '' } : splitSettledMarkdown(visibleMessage)),
    [shouldUsePlainText, visibleMessage]
  );
  const { head, trailing } = useMemo(() => splitTrailingBlock(settled), [settled]);

  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div
        className={cn(
          'flex-1 min-w-0 pl-stream-word-reveal',
          streamingContentClass(provider),
          isRevealing && 'is-revealing'
        )}
      >
        {visibleMessage &&
          (shouldUsePlainText ? (
            <LiveStreamingText message={visibleMessage} />
          ) : (
            <>
              {head && (
                <MemoizedMarkdown
                  content={head}
                  className="prose prose-sm dark:prose-invert max-w-none"
                />
              )}
              {trailing && (
                <MemoizedMarkdown
                  content={trailing}
                  animateWords={isRevealing}
                  className="prose prose-sm dark:prose-invert max-w-none"
                />
              )}
              {tail && <LiveStreamingText message={tail} />}
            </>
          ))}
        <ProviderToolNotice
          tools={normalized.providerTools}
          complete={normalized.providerToolComplete}
        />
        <StreamingCursor provider={provider} />
      </div>
    </div>
  );
}

export function StreamingContent({
  content,
  onResponse,
  provider,
  providerLabel: explicitProviderLabel,
}: StreamingContentProps) {
  const { uiProvider } = useProviderStore();
  const resolvedProvider = provider ?? uiProvider;
  const providerLabel = explicitProviderLabel ?? UI_PROVIDER_META[resolvedProvider].label;
  const providerName = UI_PROVIDER_META[resolvedProvider].productName;
  const parsed = useMemo(
    () => parseProviderOutput(content, resolvedProvider),
    [content, resolvedProvider]
  );

  if (parsed.type === 'welcome' && parsed.welcomeData) {
    return <WelcomeScreen data={parsed.welcomeData} providerName={providerName} />;
  }

  if (parsed.type === 'trust') {
    return <TrustDialog path={parsed.path!} providerName={providerName} onResponse={onResponse} />;
  }

  if (parsed.type === 'selection') {
    return (
      <SelectionDialog title={parsed.title!} options={parsed.options!} onResponse={onResponse} />
    );
  }

  if (parsed.type === 'plan_mode') {
    return <PlanModeIndicator message={parsed.message} providerLabel={providerLabel} />;
  }

  if (parsed.type === 'thinking') {
    return (
      <div className={cn('max-w-full', parsed.isIdeating && 'text-blue-500')}>
        <ThinkingIndicator
          thinkingTime={parsed.thinkingTime}
          isIdeating={parsed.isIdeating}
          providerLabel={providerLabel}
          provider={resolvedProvider}
        />
      </div>
    );
  }

  if (parsed.type === 'response' && parsed.message) {
    return (
      <Card className="max-w-none border-0 bg-transparent p-0 shadow-none">
        <ClaudeResponse message={parsed.message} provider={resolvedProvider} />
        {parsed.thinkingTime && (
          <div className="mt-3 pt-3 border-t flex items-center gap-2">
            <ThinkingIndicator
              thinkingTime={parsed.thinkingTime}
              providerLabel={providerLabel}
              provider={resolvedProvider}
            />
          </div>
        )}
      </Card>
    );
  }

  // Empty or unrecognized - show minimal loading state
  return (
    <Card className="max-w-none border-0 bg-transparent p-0 shadow-none overflow-hidden">
      <ThinkingIndicator providerLabel={providerLabel} provider={resolvedProvider} />
    </Card>
  );
}
