import { memo, useCallback, useState } from 'react';
import { FileText, FileCode, File as FileIcon, Copy, Check, Quote } from 'lucide-react';
import { MemoizedMarkdown } from './MemoizedMarkdown';
import { buildChatMediaUrl, ChatMediaImage } from './ChatMediaImage';
import { LegacyMediaFile, LegacyMediaImage } from './LegacyMedia';
import { InteractiveOptions, detectOptions, isChoicePrompt } from './InteractiveOptions';
import { DirectoryAccessPrompt } from '@/components/session/AllowedDirectoriesDialog';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { socketService } from '@/services/socket';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { normalizeClaudeDisplayContent } from '@/lib/claudeDisplay';
import type { Message, MessageImage, MessageAttachment } from '@plum-code-webui/shared';
import type { UiProvider } from '@/lib/providers';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderToolNotice } from './ProviderToolNotice';

interface MessageBubbleProps {
  message: Message;
  sessionId: string;
  sessionStatus: string;
  /** Provider for the assistant avatar / logo. Falls back to the primary provider. */
  provider?: UiProvider;
  /** Model name shown next to the assistant name (e.g. "opus-4.7"). */
  modelLabel?: string;
  /** Display name for the assistant (default: "Assistant"). */
  assistantName?: string;
  /** Show provider/model identity for the first message in an assistant streak. */
  showAssistantIdentity?: boolean;
}

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

// One signature per message object, kept for as long as that object is alive.
//
// The comparator runs for every rendered bubble on every parent render, and it
// built three joined strings for each side each time — for messages whose media
// almost never changes. Keyed on the object identity the work happens once; a
// replaced message object is a cache miss by construction, which is exactly when
// the signature has to be recomputed anyway.
const mediaSignatureCache = new WeakMap<Message, string>();

function mediaSignature(message: Message): string {
  const cached = mediaSignatureCache.get(message);
  if (cached !== undefined) return cached;
  const signature = computeMediaSignature(message);
  mediaSignatureCache.set(message, signature);
  return signature;
}

function computeMediaSignature(message: Message): string {
  const durable = (message.media ?? [])
    .map(
      (media) =>
        `${media.id}\u0000${media.filename}\u0000${media.mimeType}\u0000${media.byteSize}\u0000${media.altText ?? ''}\u0000${media.source}`
    )
    .join('\u0001');
  const legacyImages = (message.images ?? [])
    .map((image) => `${image.filename}\u0000${image.path}`)
    .join('\u0001');
  const legacyAttachments = (message.attachments ?? [])
    .map(
      (attachment) =>
        `${attachment.filename}\u0000${attachment.path}\u0000${attachment.mimeType}\u0000${attachment.type}`
    )
    .join('\u0001');
  return `${durable}\u0002${legacyImages}\u0002${legacyAttachments}`;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const MessageBubble = memo(
  function MessageBubble({
    message,
    sessionId,
    sessionStatus,
    provider = 'codex',
    modelLabel,
    assistantName = 'Assistant',
    showAssistantIdentity = true,
  }: MessageBubbleProps) {
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState(false);

    const handleOptionSelect = useCallback(
      (selected: string) => {
        socketService.sendMessage(sessionId, selected);
      },
      [sessionId]
    );

    const handleAccessGranted = useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    }, [queryClient, sessionId]);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard may be blocked in insecure contexts — ignore silently
      }
    }, [message.content]);

    /**
     * Pull this message into the composer as a Markdown quote — the usual way
     * to say "about this specific part" without retyping it.
     */
    const handleQuote = useCallback(() => {
      const selected = window.getSelection?.()?.toString().trim();
      window.dispatchEvent(
        new CustomEvent('plum:quote-message', {
          detail: { text: selected || message.content },
        })
      );
    }, [message.content]);

    const handleMediaDownload = useCallback(
      async (mediaId: string, filename: string) => {
        const response = await api.download(buildChatMediaUrl(sessionId, mediaId));
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename || 'attachment';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      },
      [sessionId]
    );

    const timestamp = formatMessageTime(message.createdAt);
    const displayContent =
      message.role === 'assistant' && (provider === 'claude' || provider === 'zai')
        ? normalizeClaudeDisplayContent(message.content)
        : { message: message.content, providerTools: [], providerToolComplete: false };

    const durableMedia = message.media ?? [];
    const durableMediaFilenames = new Set(durableMedia.map((media) => media.filename));
    const legacyImages = message.images?.filter(
      (image) => !durableMediaFilenames.has(image.filename)
    );
    const legacyAttachments = message.attachments?.filter(
      (attachment) => !durableMediaFilenames.has(attachment.filename)
    );

    const renderAttachments = () => {
      if (!durableMedia.length && !legacyImages?.length && !legacyAttachments?.length) return null;
      return (
        <div className="flex flex-wrap gap-2 mb-3">
          {durableMedia.map((media) => {
            if (media.mimeType.startsWith('image/')) {
              return <ChatMediaImage key={media.id} media={media} sessionId={sessionId} />;
            }
            const MediaIcon =
              media.mimeType === 'application/pdf'
                ? FileText
                : media.mimeType.startsWith('text/')
                  ? FileCode
                  : FileIcon;
            return (
              <button
                type="button"
                key={media.id}
                onClick={() => void handleMediaDownload(media.id, media.filename)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 transition-opacity hover:opacity-90',
                  message.role === 'user' ? 'border-white/20 bg-white/10' : 'border-border bg-muted'
                )}
                title={media.filename}
              >
                <MediaIcon
                  className={cn('h-5 w-5', media.mimeType === 'application/pdf' && 'text-red-500')}
                />
                <span className="min-w-0">
                  <span className="block max-w-40 truncate text-xs">{media.filename}</span>
                  <span className="block text-[10px] opacity-65">
                    {formatAttachmentSize(media.byteSize)}
                  </span>
                </span>
              </button>
            );
          })}
          {(!legacyAttachments || legacyAttachments.length === 0) &&
            legacyImages?.map((img: MessageImage, imgIndex: number) => (
              <LegacyMediaImage
                key={`img-${imgIndex}`}
                url={`/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(img.filename)}`}
                alt={`Attachment ${imgIndex + 1}`}
              />
            ))}
          {legacyAttachments?.map((att: MessageAttachment, attIndex: number) => {
            const attachmentUrl =
              att.filename && att.path
                ? `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(att.filename)}`
                : null;

            if (att.type === 'image' && attachmentUrl) {
              return (
                <LegacyMediaImage key={`att-${attIndex}`} url={attachmentUrl} alt={att.filename} />
              );
            }

            const AttachmentIcon =
              att.type === 'text' ? FileCode : att.type === 'pdf' ? FileText : FileIcon;
            return (
              <LegacyMediaFile
                key={`att-${attIndex}`}
                url={attachmentUrl}
                filename={att.filename}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border',
                  message.role === 'user' ? 'border-white/20 bg-white/10' : 'border-border bg-muted'
                )}
              >
                <AttachmentIcon className={cn('h-5 w-5', att.type === 'pdf' && 'text-red-500')} />
                <span className="text-xs truncate max-w-32">{att.filename}</span>
              </LegacyMediaFile>
            );
          })}
        </div>
      );
    };

    if (message.role === 'user') {
      return (
        <div className="turn-user animate-fade-in">
          <div>
            <div className="message-copy-shell">
              <button
                onClick={handleQuote}
                className="message-copy-button"
                title="Quote in composer"
                aria-label="Quote message in composer"
              >
                <Quote className="h-3 w-3" />
              </button>
              <button
                onClick={handleCopy}
                className="message-copy-button"
                title="Copy message"
                aria-label={copied ? 'Message copied' : 'Copy message'}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
              <div className="ub-bubble">
                {renderAttachments()}
                <MemoizedMarkdown
                  content={message.content}
                  className="prose prose-sm max-w-none prose-invert"
                />
              </div>
            </div>
            <div className="user-meta">
              {timestamp && (
                <span
                  className="font-mono tabular-nums"
                  title={new Date(message.createdAt).toLocaleString()}
                >
                  {timestamp}
                </span>
              )}
              <span className="label">Du</span>
            </div>
          </div>
        </div>
      );
    }

    const copyButton = (
      <>
        <button
          onClick={handleQuote}
          className="message-copy-button"
          title="Quote in composer"
          aria-label="Quote message in composer"
        >
          <Quote className="h-3 w-3" />
        </button>
        <button
          onClick={handleCopy}
          className="message-copy-button"
          title="Copy message"
          aria-label={copied ? 'Message copied' : 'Copy message'}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </>
    );

    // Assistant turn
    return (
      <div className="turn-asst animate-fade-in">
        <div className="ai-body">
          {copyButton}
          {showAssistantIdentity && (
            <div className="asst-meta">
              <ProviderLogo provider={provider} className="asst-provider-mark" />
              <span className="asst-name">{assistantName}</span>
              {modelLabel && <span className="asst-model">{modelLabel}</span>}
            </div>
          )}
          {renderAttachments()}
          {displayContent.message && (
            <MemoizedMarkdown
              content={displayContent.message}
              className="prose prose-sm max-w-none dark:prose-invert"
            />
          )}
          <ProviderToolNotice
            tools={displayContent.providerTools}
            complete={displayContent.providerToolComplete}
          />
          {isChoicePrompt(message.content) &&
            (() => {
              const options = detectOptions(message.content);
              return options ? (
                <InteractiveOptions
                  options={options}
                  onSelect={handleOptionSelect}
                  disabled={sessionStatus === 'error'}
                />
              ) : null;
            })()}
          <DirectoryAccessPrompt
            message={message.content}
            sessionId={sessionId}
            providerLabel={assistantName}
            onAccessGranted={handleAccessGranted}
          />
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.content === next.message.content &&
      // Same object → same media; the signature strings are only built when
      // the message object was actually replaced.
      (prev.message === next.message ||
        mediaSignature(prev.message) === mediaSignature(next.message)) &&
      prev.sessionStatus === next.sessionStatus &&
      prev.provider === next.provider &&
      prev.modelLabel === next.modelLabel &&
      prev.assistantName === next.assistantName &&
      prev.showAssistantIdentity === next.showAssistantIdentity
    );
  }
);
