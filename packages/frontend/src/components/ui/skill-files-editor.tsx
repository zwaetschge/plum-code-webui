import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Button } from './button';

interface SkillFile {
  path: string;
  hash: string | null;
  content: string;
}
export function SkillFilesEditor({
  name,
  provider,
  onChanged,
}: {
  name: string;
  provider?: string;
  onChanged: () => void;
}) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState('SKILL.md');
  const [draft, setDraft] = useState<SkillFile | null>(null);
  const [newPath, setNewPath] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const base = `/api/claude-config/skill/${encodeURIComponent(name)}`;
  const endpoint = (route: string, query = '') =>
    base + route + '?' + query + (provider ? '&provider=' + encodeURIComponent(provider) : '');
  const key = ['skill-files', name, provider];
  const files = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<{ data: { files: string[]; readOnly: boolean } }>(endpoint('/files'))).data
        .data,
  });
  const file = useQuery({
    queryKey: [...key, selected],
    queryFn: async () =>
      (
        await api.get<{ data: SkillFile }>(
          endpoint('/file', 'path=' + encodeURIComponent(selected))
        )
      ).data.data,
    enabled: !!selected && draft?.hash !== null,
  });
  const history = useQuery({
    queryKey: [...key, selected, 'history'],
    queryFn: async () =>
      (
        await api.get<{ data: { hash: string; createdAt: string }[] }>(
          endpoint('/file-history', 'path=' + encodeURIComponent(selected))
        )
      ).data.data,
    enabled: !!selected,
  });
  const previous = useQuery({
    queryKey: [...key, selected, version],
    queryFn: async () =>
      (
        await api.get<{ data: SkillFile }>(
          endpoint('/file', 'path=' + encodeURIComponent(selected) + '&revision=' + version)
        )
      ).data.data,
    enabled: !!version,
  });
  const current = draft ?? file.data;
  const dirty = !!draft && (draft.hash === null || draft.content !== file.data?.content);
  async function save() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      await api.put(endpoint('/file'), {
        path: selected,
        expectedHash: current.hash,
        content: current.content,
      });
      await cache.invalidateQueries({ queryKey: key });
      setDraft(null);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 p-5">
      <select
        aria-label="Skilldatei"
        className="w-full rounded-xl border bg-background p-3"
        value={selected}
        disabled={busy || dirty}
        onChange={(e) => {
          setSelected(e.target.value);
          setDraft(null);
          setVersion('');
        }}
      >
        {[...new Set([...(files.data?.files ?? []), selected])].map((entry) => (
          <option key={entry}>{entry}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          aria-label="Neue Skilldatei"
          placeholder="references/beispiel.md"
          value={newPath}
          disabled={busy || files.data?.readOnly || dirty}
          onChange={(e) => setNewPath(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border bg-background p-2"
        />
        <Button
          type="button"
          disabled={!newPath || busy || files.data?.readOnly || dirty}
          onClick={() => {
            setSelected(newPath);
            setDraft({ path: newPath, hash: null, content: '' });
            setNewPath('');
            setVersion('');
          }}
        >
          Anlegen
        </Button>
      </div>
      {(error || files.error || file.error) && (
        <p role="alert" className="text-destructive">
          {error || String(files.error || file.error)}
        </p>
      )}
      {files.data?.readOnly && <p>Von Plum verwaltet · Schreibgeschützt</p>}
      {current && (
        <textarea
          aria-label="Dateiinhalt"
          className="min-h-64 w-full rounded-xl border bg-background p-3 font-mono text-sm"
          value={current.content}
          disabled={busy || files.data?.readOnly}
          onChange={(e) => setDraft({ ...current, content: e.target.value })}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!current || !dirty || busy || files.data?.readOnly}
          onClick={() => void save()}
        >
          Datei speichern
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setDraft(null);
            setError('');
            void cache.invalidateQueries({ queryKey: key });
          }}
        >
          Neu laden
        </Button>
      </div>
      <select
        aria-label="Dateiversion vergleichen"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        className="w-full rounded-xl border bg-background p-3"
      >
        <option value="">Versionsvergleich</option>
        {history.data?.map((entry) => (
          <option key={entry.hash} value={entry.hash}>
            {new Date(entry.createdAt).toLocaleString('de-CH')} · {entry.hash.slice(0, 8)}
          </option>
        ))}
      </select>
      {previous.data && current && (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <h3>Vorher</h3>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-xs">
              {previous.data.content}
            </pre>
          </div>
          <div className="min-w-0">
            <h3>Aktuell</h3>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-xs">
              {current.content}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
