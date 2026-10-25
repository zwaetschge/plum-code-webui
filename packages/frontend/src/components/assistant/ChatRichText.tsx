import { createContext, memo, useContext, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { api } from '@/services/api';
import { nativeShell } from '@/lib/nativeShell';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const SourceFiles = createContext<Array<{ id: string; revision: number }>>([]);
interface PythonFile {
  name: string;
  data: Uint8Array;
}
/** No same-origin permission, credentials, network or native bridge is granted to generated code. */
export function CodePlayground({ code, language }: { code: string; language: string }) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState(code),
    [run, setRun] = useState(0),
    [executed, setExecuted] = useState(code);
  const sources = useContext(SourceFiles),
    owner = useAuthStore((s) => s.user?.id);
  const [files, setFiles] = useState<PythonFile[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const html = ['html', 'svg'].includes(language.toLowerCase());
  const python = ['python', 'py'].includes(language.toLowerCase());
  const sandboxUrl = new URL(
    'chat-sandbox.html',
    (nativeShell()?.apiBase ?? window.location.origin) + '/'
  ).href;
  const delivered = useRef(-1);
  const openRun = async () => {
    setLoading(true);
    setError('');
    try {
      const loaded: PythonFile[] = [];
      let bytes = 0;
      if (python)
        for (const source of [
          ...new Map(sources.map((s) => [`${s.id}:${s.revision}`, s])).values(),
        ].slice(0, 10)) {
          try {
            const response = await api.download(
              `/api/assistant/sources/${source.id}/file?revision=${source.revision}`
            );
            const header = response.headers.get('content-disposition') ?? '';
            const name = decodeURIComponent(
              /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1] ??
                /filename="([^"]+)"/i.exec(header)?.[1] ??
                `source-${loaded.length + 1}.txt`
            ).replace(/[\\/\u0000-\u001f]/g, '_');
            const data = new Uint8Array(await response.arrayBuffer());
            bytes += data.length;
            if (bytes > 25 * 1024 * 1024) throw new Error('Python-Dateien überschreiten 25 MB');
            loaded.push({ name, data });
          } catch (failure) {
            if (
              !(
                failure &&
                typeof failure === 'object' &&
                'status' in failure &&
                failure.status === 404
              )
            )
              throw failure;
            const resource = (
              await api.get<{ data: { title: string; body: { text?: string } } }>(
                `/api/assistant/sources/${source.id}?revision=${source.revision}`
              )
            ).data.data;
            const data = new TextEncoder().encode(resource.body.text ?? '');
            bytes += data.length;
            if (bytes > 25 * 1024 * 1024) throw new Error('Python-Dateien überschreiten 25 MB');
            loaded.push({ name: resource.title.replace(/[\\/\u0000-\u001f]/g, '_'), data });
          }
        }
      if (useAuthStore.getState().user?.id !== owner) return;
      setFiles(loaded);
      setSource(code);
      setExecuted(code);
      delivered.current = -1;
      setOpen(true);
    } catch (failure) {
      if (useAuthStore.getState().user?.id === owner)
        setError(failure instanceof Error ? failure.message : 'Dateien nicht verfügbar');
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2 not-prose">
        <span className="text-xs text-muted-foreground">{language || 'Code'}</span>
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(code)}>
          Kopieren
        </Button>
        {(html || python) && (
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void openRun()}>
            {python ? 'Python ausführen' : 'Vorschau'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <pre className="overflow-x-auto rounded-lg border p-3">
        <code>{code}</code>
      </pre>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[90dvh] overflow-y-auto">
          <DialogTitle>{python ? 'Python' : 'Vorschau'}</DialogTitle>
          <textarea
            aria-label="Code"
            className="w-full min-h-40 rounded-lg border bg-background p-3 font-mono text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Button
            onClick={() => {
              setExecuted(source);
              setRun((n) => n + 1);
            }}
          >
            {python ? 'Ausführen' : 'Aktualisieren'}
          </Button>
          <iframe
            key={run}
            title={python ? 'Python-Ergebnis' : 'HTML-Vorschau'}
            sandbox="allow-scripts"
            onLoad={(event) => {
              if (delivered.current === run) return;
              delivered.current = run;
              event.currentTarget.contentWindow?.postMessage(
                { kind: python ? 'python' : 'html', code: executed, files: python ? files : [] },
                '*'
              );
            }}
            referrerPolicy="no-referrer"
            className="h-80 w-full rounded-lg border bg-white text-black"
            src={sandboxUrl}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <div className="not-prose my-3">{children}</div>,
  code: ({ className, children, ...props }) => {
    const language = /language-([\w+-]+)/.exec(className ?? '')?.[1] ?? '';
    const code = String(children).replace(/\n$/, '');
    return language || String(children).includes('\n') ? (
      <CodePlayground code={code} language={language} />
    ) : (
      <code {...props}>{children}</code>
    );
  },
};
export const ChatRichText = memo(function ChatRichText({
  text,
  sourceVersions = [],
}: {
  text: string;
  sourceVersions?: Array<{ id: string; revision: number }>;
}) {
  return (
    <SourceFiles.Provider value={sourceVersions}>
      <div className="prose prose-sm max-w-none break-words dark:prose-invert [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_th]:border-b [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border-b [&_td]:px-3 [&_td]:py-2 [&_pre]:max-w-full">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      </div>
    </SourceFiles.Provider>
  );
});
