import type { ChatContextReceipt as Receipt } from '@plum-code-webui/shared';

const learningLabels: Record<Receipt['learning']['status'], string> = {
  disabled: 'Lernen aus',
  pending: 'Noch nicht verarbeitet',
  queued: 'Lernen vorgemerkt',
  running: 'Lernt …',
  completed: 'Verarbeitet',
  failed: 'Lernen fehlgeschlagen',
  cancelled: 'Lernen abgebrochen',
  skipped: 'Nichts gespeichert',
};
const referenceLabels = {
  memory: 'Erinnerung',
  history: 'Chatrückblick',
  'project-chat': 'Projektchat',
  'writing-style': 'Schreibstil',
};

export function ChatContextReceipt({ receipt }: { receipt?: Receipt }) {
  if (!receipt) return null;
  const learned = receipt.learning;
  return (
    <details className="rounded-lg border border-border/60 text-sm">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground">
        Gedächtnis · {receipt.references.length} Kontextbelege · {learningLabels[learned.status]}
      </summary>
      <div className="space-y-3 border-t border-border/60 p-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Lesen {receipt.memoryRead ? 'an' : 'aus'}</span>
          <span>Lernen {receipt.memoryLearn ? 'an' : 'aus'}</span>
          <span>Personalisierung · Revision {receipt.personalizationRevision}</span>
          {receipt.profileRevision && <span>Assistent · Revision {receipt.profileRevision}</span>}
          {receipt.projectRevision && <span>Projekt · Revision {receipt.projectRevision}</span>}
        </div>
        {receipt.legacyNotes && <p>Gespeicherte Assistentennotizen übergeben</p>}
        {receipt.voiceHistory && <p>Frühere Sprachgespräche übergeben</p>}
        {receipt.references.map((ref, index) => (
          <details key={`${ref.kind}:${ref.id}:${index}`} className="rounded-md bg-muted/40 p-2">
            <summary className="cursor-pointer break-words">
              {referenceLabels[ref.kind]} · {ref.title}
              {ref.revision ? ` · Revision ${ref.revision}` : ''}
              {!ref.available && ' · Nicht mehr verfügbar'}
            </summary>
            {ref.text && <p className="mt-2 whitespace-pre-wrap break-words">{ref.text}</p>}
            {ref.available && ref.kind === 'project-chat' && (
              <a
                className="mt-2 inline-block underline"
                href={`/chat/model/${encodeURIComponent(ref.id)}`}
              >
                Chat öffnen
              </a>
            )}
          </details>
        ))}
        <div className="space-y-1 border-t border-border/60 pt-2">
          <p className="font-medium">{learningLabels[learned.status]}</p>
          {learned.memories.map((memory) => (
            <p key={memory.id}>
              {memory.title} · Revision {memory.revision}
              {memory.proposed ? ' · Zur Prüfung' : ''}
            </p>
          ))}
          {learned.historySaved && <p>Chatrückblick gespeichert</p>}
          {learned.writingStyleSaved && <p>Schreibstil aktualisiert</p>}
          {learned.status === 'completed' &&
            !learned.memories.length &&
            !learned.historySaved &&
            !learned.writingStyleSaved && <p>Keine bleibenden Einträge</p>}
        </div>
      </div>
    </details>
  );
}
