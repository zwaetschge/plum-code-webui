import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Server,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  SSH_ALIAS_PATTERN,
  aliasFromName,
  sshTarget,
  useSshConnectionMutations,
  useSshConnections,
  useSshKeyFiles,
  type SshConnection,
  type SshConnectionInput,
  type SshTestResult,
} from '@/lib/sshConnections';
import { cn } from '@/lib/utils';

interface FormState {
  name: string;
  alias: string;
  aliasTouched: boolean;
  host: string;
  port: string;
  user: string;
  jumpHost: string;
  tags: string;
  keySource: 'file' | 'upload';
  keyFile: string;
  privateKey: string;
  clearKey: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    alias: '',
    aliasTouched: false,
    host: '',
    port: '22',
    user: '',
    jumpHost: '',
    tags: '',
    keySource: 'file',
    keyFile: '',
    privateKey: '',
    clearKey: false,
  };
}

function formFrom(connection: SshConnection): FormState {
  return {
    name: connection.name,
    alias: connection.alias,
    aliasTouched: true,
    host: connection.host,
    port: String(connection.port),
    user: connection.user,
    jumpHost: connection.jumpHost ?? '',
    tags: connection.tags.join(', '),
    keySource: connection.keySource,
    keyFile: connection.keyFile ?? '',
    privateKey: '',
    clearKey: false,
  };
}

function toInput(form: FormState): SshConnectionInput {
  return {
    name: form.name.trim(),
    alias: form.alias.trim(),
    host: form.host.trim(),
    port: Number(form.port) || 22,
    user: form.user.trim(),
    jumpHost: form.jumpHost.trim() || null,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    keySource: form.keySource,
    keyFile: form.keySource === 'file' ? form.keyFile || null : null,
    privateKey: form.keySource === 'upload' ? form.privateKey : undefined,
    clearKey: form.clearKey || undefined,
  };
}

export function SshTestBadge({ result }: { result?: SshTestResult | null }) {
  if (!result) return null;
  return (
    <p
      className={cn(
        'mt-1 flex items-start gap-1.5 whitespace-pre-wrap break-words text-xs',
        result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        {result.message}
        <span className="text-muted-foreground"> · {Math.round(result.durationMs)} ms</span>
      </span>
    </p>
  );
}

/**
 * Settings → Verbindungen: the global SSH host list. Keys are chosen from the
 * read-only ~/.ssh mount by name or pasted/uploaded once; neither is ever
 * shown again (only "Schlüssel hinterlegt").
 */
export function SshConnectionsPanel() {
  const { data: connections = [], isLoading } = useSshConnections();
  const { save, remove, test } = useSshConnectionMutations();
  const [editing, setEditing] = useState<SshConnection | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SshTestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const { data: keyFiles } = useSshKeyFiles(editing !== null);

  const openForm = (target: SshConnection | 'new') => {
    setEditing(target);
    setForm(target === 'new' ? emptyForm() : formFrom(target));
    setFormError(null);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'name' && !current.aliasTouched) next.alias = aliasFromName(String(value));
      if (key === 'alias') next.aliasTouched = true;
      return next;
    });

  const readKeyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 16_384) {
      setFormError('Die Schlüsseldatei ist zu gross.');
      return;
    }
    set('privateKey', await file.text());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const input = toInput(form);
    if (!input.name || !input.host || !input.user) {
      setFormError('Name, Host und Benutzer sind Pflicht.');
      return;
    }
    if (!SSH_ALIAS_PATTERN.test(input.alias)) {
      setFormError('Alias: Kleinbuchstaben, Ziffern und Bindestriche, höchstens 41 Zeichen.');
      return;
    }
    try {
      await save.mutateAsync({ id: editing === 'new' ? undefined : editing?.id, input });
      setEditing(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
    }
  };

  const runTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await test.mutateAsync(id);
      setResults((current) => ({ ...current, [id]: result }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [id]: {
          ok: false,
          message: error instanceof Error ? error.message : 'Test fehlgeschlagen.',
          durationMs: 0,
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const confirmDelete = (connection: SshConnection) => {
    if (!window.confirm(`„${connection.name}“ löschen? Sessions verlieren den Zugriff.`)) return;
    remove.mutate(connection.id);
  };

  const editingConnection = editing && editing !== 'new' ? editing : null;
  const existingKey = !!editingConnection?.keyConfigured;

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade Verbindungen …
        </p>
      ) : connections.length === 0 && editing === null ? (
        <p className="text-sm text-muted-foreground">Noch keine SSH-Hosts angelegt.</p>
      ) : null}

      <ul className="space-y-2">
        {connections.map((connection) => (
          <li key={connection.id} className="rounded-lg border border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{connection.name}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{connection.alias}</code>
              <span className="text-xs text-muted-foreground">{sshTarget(connection)}</span>
              {connection.jumpHost && (
                <span className="text-xs text-muted-foreground">via {connection.jumpHost}</span>
              )}
              <span
                className={cn(
                  'flex items-center gap-1 text-xs',
                  connection.keyConfigured ? 'text-muted-foreground' : 'text-destructive'
                )}
              >
                <KeyRound className="h-3 w-3" />
                {connection.keyConfigured
                  ? connection.keySource === 'file'
                    ? `~/.ssh/${connection.keyFile}`
                    : 'Schlüssel hinterlegt'
                  : 'Kein Schlüssel'}
              </span>
              {connection.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-border px-2 text-[11px]">
                  {tag}
                </span>
              ))}
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void runTest(connection.id)}
                  disabled={testing === connection.id}
                >
                  {testing === connection.id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plug className="mr-1 h-3.5 w-3.5" />
                  )}
                  Testen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Bearbeiten"
                  onClick={() => openForm(connection)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Löschen"
                  onClick={() => confirmDelete(connection)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <SshTestBadge result={results[connection.id]} />
          </li>
        ))}
      </ul>

      {editing === null ? (
        <Button type="button" size="sm" onClick={() => openForm('new')}>
          <Plus className="mr-1 h-3.5 w-3.5" /> SSH-Host hinzufügen
        </Button>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-3 rounded-lg border border-border bg-card px-3 py-3"
        >
          <p className="text-sm font-medium">
            {editing === 'new' ? 'Neuer SSH-Host' : `${editing.name} bearbeiten`}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ssh-name">Name</Label>
              <Input
                id="ssh-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Build-Server"
                maxLength={80}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ssh-alias">Alias für den Agenten</Label>
              <Input
                id="ssh-alias"
                value={form.alias}
                onChange={(e) => set('alias', e.target.value.toLowerCase())}
                placeholder="build"
                maxLength={41}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ssh-host">Host</Label>
              <Input
                id="ssh-host"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="build.example.org"
              />
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div className="space-y-1">
                <Label htmlFor="ssh-user">Benutzer</Label>
                <Input
                  id="ssh-user"
                  value={form.user}
                  onChange={(e) => set('user', e.target.value)}
                  placeholder="deploy"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ssh-port">Port</Label>
                <Input
                  id="ssh-port"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => set('port', e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ssh-jump">Jump-Host (optional)</Label>
              <Input
                id="ssh-jump"
                value={form.jumpHost}
                onChange={(e) => set('jumpHost', e.target.value)}
                placeholder="ops@bastion:22"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ssh-tags">Tags (kommagetrennt)</Label>
              <Input
                id="ssh-tags"
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="prod, web"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Schlüssel</legend>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={form.keySource === 'file' ? 'default' : 'outline'}
                onClick={() => set('keySource', 'file')}
              >
                Aus ~/.ssh
              </Button>
              <Button
                type="button"
                size="sm"
                variant={form.keySource === 'upload' ? 'default' : 'outline'}
                onClick={() => set('keySource', 'upload')}
              >
                Hochladen / einfügen
              </Button>
            </div>
            {form.keySource === 'file' ? (
              keyFiles && !keyFiles.available ? (
                <p className="text-xs text-muted-foreground">
                  Kein ~/.ssh im Container eingebunden. Lade den Schlüssel stattdessen hoch.
                </p>
              ) : (
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={form.keyFile}
                  onChange={(e) => set('keyFile', e.target.value)}
                  aria-label="Schlüsseldatei"
                >
                  <option value="">Schlüsseldatei wählen …</option>
                  {(keyFiles?.files ?? []).map((file) => (
                    <option key={file} value={file}>
                      {file}
                    </option>
                  ))}
                  {form.keyFile && !(keyFiles?.files ?? []).includes(form.keyFile) && (
                    <option value={form.keyFile}>{form.keyFile} (nicht gefunden)</option>
                  )}
                </select>
              )
            ) : (
              <div className="space-y-2">
                {existingKey && editingConnection?.keySource === 'upload' && (
                  <p className="text-xs text-muted-foreground">
                    Schlüssel hinterlegt. Leer lassen, um ihn zu behalten.
                  </p>
                )}
                <Textarea
                  value={form.privateKey}
                  onChange={(e) => set('privateKey', e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono text-xs"
                />
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary">
                  <Upload className="h-3.5 w-3.5" />
                  Datei wählen
                  <input type="file" className="hidden" onChange={(e) => void readKeyFile(e)} />
                </label>
                <p className="text-xs text-muted-foreground">
                  Wird verschlüsselt gespeichert und nie wieder angezeigt. Schlüssel mit Passphrase
                  funktionieren nicht (Batch-Modus).
                </p>
              </div>
            )}
            {existingKey && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.clearKey}
                  onChange={(e) => set('clearKey', e.target.checked)}
                />
                Schlüssel entfernen
              </label>
            )}
          </fieldset>

          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Speichern
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
