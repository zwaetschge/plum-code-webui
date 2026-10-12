import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseAssistantResearch, type AssistantResearchReport } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';

export function ResearchPreview({
  response,
  busy,
  onSave,
}: {
  response: string;
  busy: boolean;
  onSave: () => void;
}) {
  let report: AssistantResearchReport;
  try {
    report = parseAssistantResearch(response);
  } catch (error) {
    return (
      <div className="space-y-3">
        <p role="alert">
          {error instanceof Error ? error.message : 'Bericht kann nicht gelesen werden'}
        </p>
        <details>
          <summary>Originalantwort ansehen</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{response}</pre>
        </details>
      </div>
    );
  }
  return (
    <section className="space-y-4" aria-label="Dokumentrecherche prüfen">
      <h3 className="font-semibold">{report.title}</h3>
      <div className="prose prose-sm max-w-none break-words dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.report}</ReactMarkdown>
      </div>
      <details>
        <summary className="cursor-pointer">{report.claims.length} Quellenbelege ansehen</summary>
        <ol className="mt-3 space-y-3">
          {report.claims.map((claim, index) => (
            <li key={index} className="rounded-md border p-3 text-sm">
              <p>
                {index + 1}. {claim.claim}
              </p>
              <blockquote className="mt-2 border-l-2 pl-3">{claim.quote}</blockquote>
              {claim.note && <p className="mt-2 text-muted-foreground">{claim.note}</p>}
            </li>
          ))}
        </ol>
      </details>
      <p className="text-xs text-muted-foreground">
        Beim Speichern prüft Plum jedes Zitat gegen die verwendete Quellrevision. Anschliessend
        kannst du im Bericht Originalstellen öffnen und Aussagen selbst als geprüft markieren.
      </p>
      <Button disabled={busy} onClick={onSave}>
        Bericht und Belegregister speichern
      </Button>
    </section>
  );
}
