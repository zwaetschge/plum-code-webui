import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function ResourceRevisionDiff({
  collection,
  id,
  revision,
}: {
  collection: string;
  id: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false),
    [from, setFrom] = useState(Math.max(1, revision - 1)),
    [to, setTo] = useState(revision);
  const owner = useAuthStore((s) => s.user?.id);
  const diff = useQuery({
    queryKey: ['assistant', 'revision-diff', owner, collection, id, from, to],
    enabled: open,
    queryFn: async () =>
      (
        await api.get<{ data: { lines: Array<{ type: string; text: string }> } }>(
          `/api/assistant/revision-diff/${collection}/${id}?from=${from}&to=${to}`
        )
      ).data.data,
  });
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Änderungen vergleichen
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] max-w-3xl overflow-auto">
          <DialogTitle>Revisionen vergleichen</DialogTitle>
          <div className="flex flex-wrap gap-3">
            {[
              ['Vorher', from, setFrom],
              ['Nachher', to, setTo],
            ].map(([label, value, setter]) => (
              <label key={String(label)} className="grid gap-1 text-sm">
                {String(label)}
                <input
                  type="number"
                  min={1}
                  max={revision}
                  className="w-28 rounded-md border bg-background p-2"
                  value={Number(value)}
                  onChange={(e) =>
                    (setter as (v: number) => void)(
                      Math.max(1, Math.min(revision, Number(e.target.value) || 1))
                    )
                  }
                />
              </label>
            ))}
          </div>
          {diff.isPending && <p role="status">Änderungen werden geladen …</p>}
          {diff.isError && <p role="alert">Änderungen konnten nicht geladen werden.</p>}
          {diff.data && (
            <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words text-xs">
              {diff.data.lines.map((line, i) => (
                <span
                  key={i}
                  className={`block ${line.type === 'added' ? 'bg-emerald-500/15' : line.type === 'removed' ? 'bg-red-500/15' : 'text-muted-foreground'}`}
                >
                  {line.type === 'added' ? '+ ' : line.type === 'removed' ? '− ' : '  '}
                  {line.text}
                </span>
              ))}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
