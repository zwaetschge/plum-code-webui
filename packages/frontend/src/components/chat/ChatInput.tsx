import { useChatDraft } from '@/hooks/useChatDraft';
import { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import {
  MessageCircle,
  Send,
  Paperclip,
  Loader2,
  Sparkles,
  X,
  FileText,
  FileCode,
  File as FileIcon,
  StopCircle,
  Mic,
  MicOff,
  Zap,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandMenu } from '@/components/chat/CommandMenu';
import { cn } from '@/lib/utils';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import type { Command, SessionSurface } from '@plum-code-webui/shared';
import type { FileUploadProgress, SendMessageAck } from '@/services/socket';

type AttachmentType = 'image' | 'text' | 'pdf' | 'document';
type ActiveFollowupMode = 'queue' | 'steer';

interface FileAttachment {
  id: string;
  file: File;
  preview: string | null;
  type: AttachmentType;
}

export const CHAT_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 25 * 1024 * 1024,
  // Base64 expands by roughly one third and the WebSocket frame is capped at
  // 50 MB. Keeping raw files to 32 MB leaves honest room for JSON overhead.
  maxTotalBytes: 32 * 1024 * 1024,
} as const;

export interface ChatSendOptions {
  clientMessageId: string;
  signal?: AbortSignal;
  onUploadProgress?: (progress: FileUploadProgress) => void;
}

type ChatSendResult = void | SendMessageAck | Promise<void | SendMessageAck>;

interface AttachmentSelection {
  accepted: File[];
  errors: string[];
}

interface DeliveryState {
  clientMessageId: string;
  status: 'pending' | 'queued' | 'sent' | 'failed';
  message: string;
  attachments: FileAttachment[];
  error?: string;
}

export function selectChatAttachments(
  currentCount: number,
  currentBytes: number,
  files: File[]
): AttachmentSelection {
  const accepted: File[] = [];
  const errors: string[] = [];
  let nextCount = currentCount;
  let nextBytes = currentBytes;

  for (const file of files) {
    if (nextCount >= CHAT_ATTACHMENT_LIMITS.maxFiles) {
      errors.push(`${file.name}: only ${CHAT_ATTACHMENT_LIMITS.maxFiles} files are allowed`);
      continue;
    }
    if (file.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
      errors.push(`${file.name}: exceeds the 25 MB per-file limit`);
      continue;
    }
    if (nextBytes + file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
      errors.push(`${file.name}: would exceed the 32 MB total limit`);
      continue;
    }
    accepted.push(file);
    nextCount += 1;
    nextBytes += file.size;
  }

  return { accepted, errors };
}

function formatAttachmentErrors(errors: string[]): string {
  if (errors.length <= 2) return errors.join('. ');
  return `${errors.slice(0, 2).join('. ')}. ${errors.length - 2} more file(s) were skipped.`;
}

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `message-${Date.now().toString(36)}-${generateId()}`;
}

function isRejectedSend(
  result: void | SendMessageAck
): result is Extract<SendMessageAck, { status: 'rejected' }> {
  return !!result && result.status === 'rejected';
}

function getAttachmentType(mimeType: string, filename: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    filename.match(
      /\.(md|txt|json|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|sql|sh|html|css|xml|csv)$/i
    )
  ) {
    return 'text';
  }
  return 'document';
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

interface ChatInputProps {
  chatId: string | null;
  sessionId: string;
  onSendMessage: (message: string, options?: ChatSendOptions) => ChatSendResult;
  onSendMessageWithFiles: (
    message: string,
    files: File[],
    options?: ChatSendOptions
  ) => ChatSendResult;
  onCommandExecute: (input: string) => Promise<void>;
  onInterrupt?: () => void;
  commands?: Command[];
  selectedToolName?: string | null;
  selectedCliTool?: string | null;
  disabled?: boolean;
  isSending?: boolean;
  isExecutingTool?: boolean;
  isActive?: boolean;
  queuesWhileActive?: boolean;
  steersWhileActive?: boolean;
  surface?: SessionSurface;
  activeStatusLabel?: string;
  activeStatusDetail?: string;
  activeFollowupMode?: ActiveFollowupMode;
  onActiveFollowupModeChange?: (checked: boolean) => void;
  fastModeActive?: boolean;
  fastModePending?: boolean;
  onFastModeToggle?: () => void;
  queueDepth?: number;
  onOpenRun?: () => void;
}

export const ChatInput = memo(function ChatInput({
  sessionId,
  chatId,
  onSendMessage,
  onSendMessageWithFiles,
  onCommandExecute,
  onInterrupt,
  commands,
  selectedToolName,
  selectedCliTool,
  disabled,
  isSending,
  isExecutingTool,
  isActive,
  queuesWhileActive,
  steersWhileActive,
  surface = 'code',
  activeStatusLabel,
  activeStatusDetail,
  activeFollowupMode,
  onActiveFollowupModeChange,
  fastModeActive = false,
  fastModePending = false,
  onFastModeToggle,
  queueDepth = 0,
  onOpenRun,
}: ChatInputProps) {
  const [input, setInput] = useChatDraft(sessionId, chatId);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const [attachmentError, setAttachmentError] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [deliveryState, setDeliveryState] = useState<DeliveryState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<number, FileUploadProgress>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<FileAttachment[]>([]);
  const dragDepthRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const deliveryPending = deliveryState?.status === 'pending';

  // Dictation appends to whatever is already typed rather than replacing it.
  const voice = useVoiceInput(
    useCallback(
      (text: string) => {
        setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
        inputRef.current?.focus();
      },
      [setInput]
    )
  );

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Quoting is triggered from a message bubble far up the tree. A window event
  // keeps that one interaction from requiring a store or prop chain through
  // every intermediate component.
  useEffect(() => {
    const onQuote = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;
      const quoted = text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${quoted}\n\n` : `${quoted}\n\n`));
      inputRef.current?.focus();
    };
    window.addEventListener('plum:quote-message', onQuote);
    return () => window.removeEventListener('plum:quote-message', onQuote);
  }, [setInput]);

  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
      });
    },
    []
  );

  useEffect(() => {
    attachmentsRef.current.forEach((attachment) => {
      if (attachment.preview) URL.revokeObjectURL(attachment.preview);
    });
    attachmentsRef.current = [];
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setAttachments([]);
    setDeliveryState(null);
    setAttachmentError('');
    setIsDraggingFiles(false);
    setUploadProgress({});
    dragDepthRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (deliveryState?.status !== 'sent') return;
    const timeout = window.setTimeout(() => setDeliveryState(null), 2_000);
    return () => window.clearTimeout(timeout);
  }, [deliveryState?.status]);

  useEffect(() => {
    const handleOutboxStatus = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          clientMessageId: string;
          sessionId: string;
          status: 'queued' | 'sent' | 'failed' | 'discarded';
          error?: string;
        }>
      ).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      setDeliveryState((current) => {
        if (!current || current.clientMessageId !== detail.clientMessageId) return current;
        if (detail.status === 'discarded') return null;
        return {
          ...current,
          status: detail.status,
          error: detail.error,
        };
      });
    };
    window.addEventListener('plum:outbox-status', handleOutboxStatus);
    return () => window.removeEventListener('plum:outbox-status', handleOutboxStatus);
  }, [sessionId]);

  // Memoized filtered commands
  const filteredCommands = useMemo(() => {
    if (!commands || !showCommandMenu) return [];
    const filter = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(filter));
  }, [commands, showCommandMenu, input]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (deliveryPending || files.length === 0) return;
      // Read via the ref so this callback keeps its identity across attachment
      // changes — its consumers re-bind the form's paste/drop handlers on every
      // identity change.
      const current = attachmentsRef.current;
      const currentBytes = current.reduce((total, attachment) => total + attachment.file.size, 0);
      const selection = selectChatAttachments(current.length, currentBytes, files);
      const newAttachments: FileAttachment[] = selection.accepted.map((file) => {
        const type = getAttachmentType(file.type, file.name);
        return {
          id: generateId(),
          file,
          preview: type === 'image' ? URL.createObjectURL(file) : null,
          type,
        };
      });

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
      setUploadProgress({});
      setAttachmentError(formatAttachmentErrors(selection.errors));
      setDeliveryState((current) => (current?.status === 'failed' ? null : current));
    },
    [deliveryPending]
  );

  const handleComposerPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    },
    [addFiles]
  );

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLFormElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      addFiles(Array.from(event.dataTransfer.files));
    },
    [addFiles]
  );

  const removeAttachment = useCallback(
    (attachmentId: string) => {
      if (deliveryPending) return;
      setAttachments((prev) => {
        const attachment = prev.find((a) => a.id === attachmentId);
        if (attachment?.preview) {
          URL.revokeObjectURL(attachment.preview);
        }
        return prev.filter((a) => a.id !== attachmentId);
      });
      setAttachmentError('');
      setUploadProgress({});
      setDeliveryState((current) => (current?.status === 'failed' ? null : current));
    },
    [deliveryPending]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      addFiles(files);
      e.target.value = '';
    },
    [addFiles]
  );

  const allowsActiveFollowup = !!queuesWhileActive || !!steersWhileActive;
  const blocksSubmitForActiveRun = !!isActive && !allowsActiveFollowup;
  const activeSubmitLabel = steersWhileActive
    ? isActive
      ? 'Steer message'
      : 'Send'
    : queuesWhileActive && isActive
      ? 'Queue message'
      : 'Send';
  const showActiveFollowupButton = !!isActive && !!activeFollowupMode;
  const canToggleActiveFollowupMode = !!onActiveFollowupModeChange;
  const showFastModeButton = !!onFastModeToggle && fastModeActive;
  const composerStatusLabel =
    (isActive ? activeStatusLabel : '') ||
    (isActive
      ? 'Response in progress'
      : queueDepth > 0
        ? `${queueDepth} queued`
        : selectedToolName
          ? `${selectedToolName} selected`
          : '');
  const composerStatusDetail =
    (isActive ? activeStatusDetail : '') ||
    (isActive
      ? steersWhileActive
        ? 'Your next message updates the current run immediately.'
        : queuesWhileActive
          ? 'Your next message waits until this response finishes.'
          : 'Wait for this response or stop it first.'
      : '');
  const composerBriefLabel = composerStatusLabel;
  const composerBriefDetail = composerStatusDetail;
  const showStatusStrip =
    !!isActive ||
    queueDepth > 0 ||
    showFastModeButton ||
    (surface === 'task' && !!selectedToolName);
  const showStatusBubble = !!composerBriefLabel || !!composerBriefDetail;
  const composerTone = isActive
    ? steersWhileActive
      ? 'steer'
      : queuesWhileActive
        ? 'queue'
        : 'blocked'
    : selectedCliTool
      ? 'tool'
      : 'idle';
  const inputPlaceholder = selectedToolName
    ? `Prompt for ${selectedToolName}...`
    : isActive
      ? steersWhileActive
        ? 'Steer the active run...'
        : queuesWhileActive
          ? 'Add a follow-up...'
          : 'Current run is active...'
      : surface === 'task'
        ? 'Give Plum a task...'
        : 'Message...';

  const sendDraft = useCallback(
    async (draft: Omit<DeliveryState, 'status' | 'error'>) => {
      setAttachmentError('');
      setDeliveryState({ ...draft, status: 'pending' });
      setUploadProgress({});
      const uploadController = draft.attachments.length > 0 ? new AbortController() : null;
      uploadAbortRef.current = uploadController;

      try {
        const options: ChatSendOptions = {
          clientMessageId: draft.clientMessageId,
          signal: uploadController?.signal,
          onUploadProgress: (progress) => {
            setUploadProgress((current) => ({
              ...current,
              [progress.fileIndex]: progress,
            }));
          },
        };
        const sendResult =
          draft.attachments.length > 0
            ? onSendMessageWithFiles(
                draft.message,
                draft.attachments.map((attachment) => attachment.file),
                options
              )
            : onSendMessage(draft.message, options);
        const acknowledgement = await Promise.resolve(sendResult);
        if (isRejectedSend(acknowledgement)) {
          throw new Error(acknowledgement.error);
        }

        draft.attachments.forEach((attachment) => {
          if (attachment.preview) URL.revokeObjectURL(attachment.preview);
        });
        attachmentsRef.current = [];
        setAttachments([]);
        setInput((current) => (current === draft.message ? '' : current));
        setShowCommandMenu(false);
        setUploadProgress({});
        if (inputRef.current) inputRef.current.style.height = 'auto';
        setDeliveryState({
          ...draft,
          status: acknowledgement?.status === 'queued-locally' ? 'queued' : 'sent',
        });
      } catch (error) {
        setDeliveryState({
          ...draft,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Message could not be sent.',
        });
      } finally {
        if (uploadAbortRef.current === uploadController) uploadAbortRef.current = null;
      }
    },
    [onSendMessage, onSendMessageWithFiles, setInput]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (
        (!input.trim() && attachments.length === 0) ||
        disabled ||
        isSending ||
        isExecutingTool ||
        blocksSubmitForActiveRun ||
        deliveryPending
      )
        return;

      const currentInput = input;
      const currentAttachments = [...attachments];

      if (currentInput.startsWith('/') && currentAttachments.length === 0) {
        setShowCommandMenu(false);
        await onCommandExecute(currentInput);
        setInput((current) => (current === currentInput ? '' : current));
        if (inputRef.current) inputRef.current.style.height = 'auto';
        return;
      }

      await sendDraft({
        clientMessageId: createClientMessageId(),
        message: currentInput,
        attachments: currentAttachments,
      });
    },
    [
      input,
      attachments,
      disabled,
      isSending,
      isExecutingTool,
      blocksSubmitForActiveRun,
      deliveryPending,
      onCommandExecute,
      sendDraft,
      setInput,
    ]
  );

  const retryFailedDelivery = useCallback(() => {
    if (deliveryState?.status !== 'failed') return;
    void sendDraft({
      clientMessageId: deliveryState.clientMessageId,
      message: deliveryState.message,
      attachments: deliveryState.attachments,
    });
  }, [deliveryState, sendDraft]);

  const cancelPendingUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  const currentUpload = useMemo(() => {
    const values = Object.values(uploadProgress).sort(
      (left, right) => left.fileIndex - right.fileIndex
    );
    return (
      values.find((progress) => ['hashing', 'uploading', 'retrying'].includes(progress.phase)) ??
      values.at(-1)
    );
  }, [uploadProgress]);

  const uploadStatusText = currentUpload
    ? currentUpload.phase === 'hashing'
      ? `Preparing ${currentUpload.fileIndex + 1}/${currentUpload.totalFiles}: ${currentUpload.fileName}`
      : currentUpload.phase === 'retrying'
        ? `Resuming ${currentUpload.fileName} · attempt ${currentUpload.attempt}/3 · ${currentUpload.progress}%`
        : currentUpload.phase === 'uploading'
          ? `Uploading ${currentUpload.fileIndex + 1}/${currentUpload.totalFiles}: ${currentUpload.fileName} · ${currentUpload.progress}%`
          : undefined
    : undefined;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      setDeliveryState((current) => (current?.status === 'failed' ? null : current));
      // Show command menu when typing /
      if (value.startsWith('/') && !value.includes(' ')) {
        setShowCommandMenu(true);
        setCommandMenuIndex(0);
      } else {
        setShowCommandMenu(false);
      }
    },
    [setInput]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showCommandMenu && filteredCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setCommandMenuIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setCommandMenuIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          const selected = filteredCommands[commandMenuIndex];
          if (selected) {
            setInput(`/${selected.name} `);
            setShowCommandMenu(false);
          }
        } else if (e.key === 'Escape') {
          setShowCommandMenu(false);
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [showCommandMenu, filteredCommands, commandMenuIndex, handleSubmit, setInput]
  );

  const handleCommandSelect = useCallback(
    (cmd: Command) => {
      setInput(`/${cmd.name} `);
      setShowCommandMenu(false);
      inputRef.current?.focus();
    },
    [setInput]
  );

  // Helper to get icon for attachment type
  const getAttachmentIcon = (type: AttachmentType) => {
    switch (type) {
      case 'text':
        return <FileCode className="h-6 w-6" />;
      case 'pdf':
        return <FileText className="h-6 w-6 text-red-500" />;
      case 'document':
        return <FileIcon className="h-6 w-6" />;
      default:
        return null;
    }
  };

  return (
    <div className="shrink-0 space-y-2">
      {(deliveryState || attachmentError) && (
        <div
          className={cn(
            'flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm',
            deliveryState?.status === 'failed' || attachmentError
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : deliveryState?.status === 'sent'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : deliveryState?.status === 'queued'
                  ? 'border-amber-500/35 bg-amber-500/10 text-foreground'
                  : 'border-primary/30 bg-primary/10 text-foreground'
          )}
          role={deliveryState?.status === 'failed' || attachmentError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {deliveryState?.status === 'pending' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : deliveryState?.status === 'sent' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : deliveryState?.status === 'queued' ? (
            <RotateCcw className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            {attachmentError ||
              (deliveryState?.status === 'pending'
                ? deliveryState.attachments.length > 0
                  ? uploadStatusText || 'Preparing attachments…'
                  : 'Waiting for server confirmation…'
                : deliveryState?.status === 'sent'
                  ? 'Sent and accepted by the server.'
                  : deliveryState?.status === 'queued'
                    ? 'Saved in the outbox. Plum will send it after reconnecting.'
                    : deliveryState?.error || 'Message could not be sent.')}
          </span>
          {deliveryState?.status === 'pending' && deliveryState.attachments.length > 0 && (
            <button
              type="button"
              onClick={cancelPendingUpload}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-current/25 px-2.5 font-medium hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}
          {deliveryState?.status === 'failed' && !attachmentError && (
            <button
              type="button"
              onClick={retryFailedDelivery}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-current/25 px-2.5 font-medium hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      )}

      {/* File attachments preview */}
      {attachments.length > 0 && (
        <div className="glass-panel w-fit max-w-full space-y-2 rounded-2xl p-3 animate-scale-in">
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>
              {attachments.length}/{CHAT_ATTACHMENT_LIMITS.maxFiles} files attached
            </span>
            <span>25 MB each · 32 MB total</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, attachmentIndex) => {
              const progress = uploadProgress[attachmentIndex];
              return (
                <div key={attachment.id} className="chat-attachment-preview relative pr-2 pt-2">
                  {attachment.type === 'image' && attachment.preview ? (
                    <img
                      src={attachment.preview}
                      alt={`Preview of ${attachment.file.name}`}
                      className="h-16 w-16 rounded-lg border border-border/40 object-cover shadow-sm"
                    />
                  ) : (
                    <div className="flex h-16 w-40 items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 shadow-sm">
                      {getAttachmentIcon(attachment.type)}
                      <span className="flex-1 truncate text-xs" title={attachment.file.name}>
                        {attachment.file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    disabled={deliveryPending}
                    className="absolute right-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Remove ${attachment.file.name}`}
                    title={`Remove ${attachment.file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {progress && (
                    <div className={cn('chat-attachment-progress', `is-${progress.phase}`)}>
                      <span>
                        {progress.phase === 'hashing'
                          ? 'Preparing'
                          : progress.phase === 'retrying'
                            ? `Retry ${progress.attempt}/3`
                            : progress.phase === 'complete'
                              ? 'Ready'
                              : progress.phase === 'cancelled'
                                ? 'Cancelled'
                                : progress.phase === 'error'
                                  ? 'Failed'
                                  : `${progress.progress}%`}
                      </span>
                      <span
                        className="chat-attachment-progress-track"
                        role="progressbar"
                        aria-label={`Upload ${attachment.file.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress.progress}
                      >
                        <span style={{ width: `${progress.progress}%` }} />
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-busy={deliveryPending}
        className={cn(
          'glass-chrome chat-composer-form relative rounded-[18px] md:rounded-2xl shadow-lg shadow-black/5 dark:shadow-black/20',
          surface === 'task' && 'is-task-composer',
          selectedCliTool && 'ring-1 ring-orange-500/30',
          isDraggingFiles && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
        )}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-background/95 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 px-6 text-center">
              <UploadCloud className="h-7 w-7 text-primary" />
              <span className="font-medium text-foreground">Drop files to attach</span>
              <span className="text-xs text-muted-foreground">
                Up to 10 files · 25 MB each · 32 MB total
              </span>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          disabled={disabled || deliveryPending}
          aria-describedby="chat-attachment-limits"
        />

        {showStatusStrip && (
          <div className={cn('composer-brief-row', `is-${composerTone}`)}>
            {showStatusBubble && (
              <div
                className="composer-now-brief"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="composer-brief-indicator">
                  {isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                </span>
                <span className="composer-brief-copy">
                  <span className="composer-brief-label">{composerBriefLabel}</span>
                  {composerBriefDetail && (
                    <span className="composer-brief-detail">{composerBriefDetail}</span>
                  )}
                </span>
                {queueDepth > 0 && <span className="composer-brief-count">{queueDepth}</span>}
                {onOpenRun && isActive && (
                  <button type="button" className="composer-brief-run" onClick={onOpenRun}>
                    Details
                  </button>
                )}
              </div>
            )}

            <div className="composer-brief-actions">
              {queueDepth > 0 && isActive && onInterrupt && (
                <button
                  type="button"
                  className="composer-bubble-button"
                  onClick={onInterrupt}
                  aria-label="Interrupt and run queued follow-up now"
                  title="Interrupt the active turn and run the queued follow-up now"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  <span>Interrupt &amp; run now</span>
                </button>
              )}
              {showActiveFollowupButton && (
                <button
                  type="button"
                  className={cn(
                    'composer-bubble-button is-followup',
                    activeFollowupMode === 'steer' && 'is-active',
                    activeFollowupMode === 'queue' && !canToggleActiveFollowupMode && 'is-active'
                  )}
                  onClick={
                    canToggleActiveFollowupMode
                      ? () => onActiveFollowupModeChange?.(activeFollowupMode !== 'steer')
                      : undefined
                  }
                  tabIndex={canToggleActiveFollowupMode ? undefined : -1}
                  aria-pressed={
                    activeFollowupMode === 'steer' ||
                    (activeFollowupMode === 'queue' && !canToggleActiveFollowupMode)
                  }
                  aria-disabled={!canToggleActiveFollowupMode}
                  aria-label={
                    canToggleActiveFollowupMode
                      ? 'Toggle active-send steering mode'
                      : 'Follow-up queue is active'
                  }
                  title={
                    activeFollowupMode === 'steer'
                      ? 'Steering is active. New messages preempt the active Codex turn.'
                      : 'Follow-up mode is active. New messages wait until the current turn finishes.'
                  }
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span>{activeFollowupMode === 'steer' ? 'Steering' : 'Follow-up'}</span>
                </button>
              )}
              {showFastModeButton && (
                <button
                  type="button"
                  className={cn('composer-bubble-button is-fast', fastModeActive && 'is-active')}
                  onClick={onFastModeToggle}
                  disabled={fastModePending}
                  aria-pressed={fastModeActive}
                  aria-label={fastModeActive ? 'Disable fast mode' : 'Enable fast mode'}
                  title={fastModeActive ? 'Disable Fast mode' : 'Enable Fast mode'}
                >
                  {fastModePending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  <span>Fast</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="composer-input-shell">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || deliveryPending}
            className="composer-control-button composer-attach-button"
            title="Attach files (10 max, 25 MB each, 32 MB total)"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          {/* Text input */}
          <div className="composer-field relative">
            {/* Command autocomplete menu */}
            {showCommandMenu && filteredCommands.length > 0 && (
              <CommandMenu
                commands={filteredCommands}
                filter=""
                selectedIndex={commandMenuIndex}
                onSelect={handleCommandSelect}
                onClose={() => setShowCommandMenu(false)}
              />
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handleComposerPaste}
              disabled={disabled || deliveryPending}
              placeholder={inputPlaceholder}
              rows={1}
              className={cn(
                'composer-textarea w-full min-h-[40px] max-h-[148px] md:max-h-[220px] bg-transparent border-0 focus:outline-none focus:ring-0 text-base md:text-sm resize-none placeholder:text-muted-foreground/60 text-foreground'
              )}
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                const maxHeight =
                  typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
                    ? 148
                    : 220;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, maxHeight) + 'px';
              }}
            />
          </div>

          <div className="composer-actions-right">
            {/* Dictation sits beside send; hidden entirely when the server has
                no transcription service configured. */}
            {voice.available && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={voice.toggle}
                disabled={voice.busy || disabled}
                className={cn(
                  'composer-control-button',
                  voice.recording && 'text-red-500 animate-pulse'
                )}
                title={voice.recording ? 'Stop dictation' : 'Dictate a message'}
                aria-label={voice.recording ? 'Stop dictation' : 'Dictate a message'}
              >
                {voice.busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : voice.recording ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
            {onInterrupt && isActive && !allowsActiveFollowup ? (
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={onInterrupt}
                className="composer-control-button composer-control-danger"
                title="Stop (Escape)"
                aria-label="Stop generation"
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  disabled ||
                  isSending ||
                  isExecutingTool ||
                  blocksSubmitForActiveRun ||
                  deliveryPending
                }
                className={cn(
                  'composer-control-button composer-control-send',
                  selectedCliTool && 'composer-control-tool'
                )}
                title={isActive ? activeSubmitLabel : 'Send'}
                aria-label={isActive ? activeSubmitLabel : 'Send message'}
              >
                {isSending || deliveryPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </form>
      <p id="chat-attachment-limits" className="px-2 text-xs text-muted-foreground">
        Drop files on the composer or paste while the message field is focused · 10 files max · 25
        MB each · 32 MB total
      </p>
    </div>
  );
});
