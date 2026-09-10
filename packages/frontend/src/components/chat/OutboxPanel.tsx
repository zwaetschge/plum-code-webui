import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { socketService } from '@/services/socket';
import { useSessionStore } from '@/stores/sessionStore';

export function OutboxPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(() => socketService.getOutboxEntries());
  const sessions = useSessionStore((state) => state.sessions);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const refresh = () => setEntries(socketService.getOutboxEntries());
    const show = () => {
      refresh();
      setOpen(true);
    };
    window.addEventListener('plum:open-outbox', show);
    window.addEventListener('plum:outbox-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('plum:open-outbox', show);
      window.removeEventListener('plum:outbox-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2">
          <Inbox className="h-5 w-5" />
          Outbox ({entries.length})
        </DialogTitle>
        <DialogDescription>
          Messages saved in this browser. Accepted messages leave this list; failed messages stay
          until you discard them.
        </DialogDescription>
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {entries.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">No messages waiting to be sent.</p>
        )}
        {entries.map((entry) => (
          <article
            key={entry.clientMessageId}
            className="min-w-0 space-y-3 rounded-xl border bg-background p-4"
          >
            <div>
              <Link
                className="font-medium underline underline-offset-4"
                onClick={() => setOpen(false)}
                to={`/session/${encodeURIComponent(entry.sessionId)}`}
              >
                {sessions.find((session) => session.id === entry.sessionId)?.name ?? 'Open session'}
              </Link>
              <p className="break-all text-xs text-muted-foreground">
                Chat: {entry.chatId ?? 'Original chat'} ·{' '}
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{entry.message}</p>
            {!!entry.uploadIds?.length && (
              <p className="text-sm text-muted-foreground">
                {entry.uploadIds.length} attachment(s)
              </p>
            )}
            <p className="text-sm" role="status">
              {entry.sending
                ? 'Waiting for server confirmation'
                : (entry.error ?? 'Saved locally · waiting to send')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(entry.message);
                    setNotice('Text copied.');
                  } catch {
                    setNotice('Copy unavailable. Select the message text to copy it.');
                  }
                }}
              >
                Copy text
              </Button>
              {entry.retryable !== false && (
                <Button
                  size="sm"
                  disabled={entry.sending}
                  onClick={() => void socketService.retryOutboxEntry(entry.clientMessageId)}
                >
                  Retry
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={entry.sending}
                onClick={() => socketService.discardOutboxEntry(entry.clientMessageId)}
              >
                Discard
              </Button>
            </div>
          </article>
        ))}
      </DialogContent>
    </Dialog>
  );
}
