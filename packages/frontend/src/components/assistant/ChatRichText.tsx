import {
  createContext,
  memo,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { parseUiEntityHref } from '@plum-code-webui/shared';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './chat-prose.css';
import { api } from '@/services/api';
import { nativeShell } from '@/lib/nativeShell';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CitationChip } from './ChatWebSources';
import { EntityLink } from './dynamic-ui/EntityLink';
import { isCitationLabel, normalizeUrl, sourceIndex, type WebSource } from './webSources';

const SourceFiles = createContext<Array<{ id: string; revision: number }>>([]);
const WebSources = createContext<Map<string, WebSource>>(new Map());

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}
const textOf = (node: HastNode | undefined): string =>
  !node
    ? ''
    : node.type === 'text'
      ? (node.value ?? '')
      : (node.children ?? []).map(textOf).join('');

/**
 * Adjacent web citations (`[3](a)[4](b)`) collapse into one chip that lists every source,
 * and a chip stays on the line of the word it supports.
 */
function rehypeCitationGroups({ index }: { index: Map<string, WebSource> }) {
  const citation = (node: HastNode) => {
    const href = node.type === 'element' && node.tagName === 'a' ? node.properties?.href : null;
    if (typeof href !== 'string') return null;
    const source = index.get(normalizeUrl(href));
    return source && isCitationLabel(textOf(node), href, source) ? href : null;
  };
  const visit = (node: HastNode) => {
    if (!node.children) return;
    node.children.forEach(visit);
    const out: HastNode[] = [];
    for (let at = 0; at < node.children.length; at++) {
      const child = node.children[at]!,
        href = citation(child);
      if (!href) {
        out.push(child);
        continue;
      }
      const hrefs = [href];
      let last = at;
      for (let next = at + 1; next < node.children.length; next++) {
        const sibling = node.children[next]!;
        if (sibling.type === 'text' && !(sibling.value ?? '').trim()) continue;
        const nextHref = citation(sibling);
        if (!nextHref) break;
        hrefs.push(nextHref);
        last = next;
      }
      const chip =
        last > at
          ? { ...child, properties: { ...child.properties, dataCiteRefs: hrefs.join(' ') } }
          : child;
      // Chips are atomic inlines, so a no-break space alone does not hold them to the last word.
      const before = out[out.length - 1];
      const word = before?.type === 'text' ? /(\S{1,24})\s*$/.exec(before.value ?? '') : null;
      if (before && word) {
        before.value = before.value!.slice(0, word.index);
        out.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['plum-cite-glue'] },
          children: [{ type: 'text', value: word[1] + '\u00a0' }, chip],
        });
      } else out.push(chip);
      at = last;
    }
    node.children = out;
  };
  return (tree: { type: string }) => {
    if (index.size) visit(tree as HastNode);
  };
}

function MarkdownLink({
  href,
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  const index = useContext(WebSources);
  const group = (props as Record<string, unknown>)['data-cite-refs'];
  // Dynamic UI v2: `[Ada Lovelace](entity:Ada_Lovelace)` opens a Wikipedia card.
  const entity = href ? parseUiEntityHref(href) : null;
  if (entity) return <EntityLink title={entity}>{children}</EntityLink>;
  if (href && index.size) {
    const sources = [
      ...new Set(
        (typeof group === 'string' ? group.split(' ') : [href])
          .map((url) => index.get(normalizeUrl(url)))
          .filter((source): source is WebSource => !!source)
      ),
    ];
    if (sources.length)
      return (
        <CitationChip
          sources={sources}
          label={
            typeof group === 'string' || isCitationLabel(textOf(node as HastNode), href, sources[0])
              ? undefined
              : children
          }
        />
      );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
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
/** Keeps `entity:` link targets (Dynamic UI entity cards); everything else as default. */
const urlTransform = (url: string) => (url.startsWith('entity:') ? url : defaultUrlTransform(url));
const markdownComponents: Components = {
  a: MarkdownLink,
  pre: ({ children }) => <div className="not-prose plum-prose-code">{children}</div>,
  // Wide tables scroll inside their frame instead of widening the answer.
  table: ({ children }) => (
    <div className="plum-prose-table">
      <table>{children}</table>
    </div>
  ),
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
  webSources,
}: {
  text: string;
  sourceVersions?: Array<{ id: string; revision: number }>;
  /** Sources of the turn; markdown links to them render as citation chips. */
  webSources?: WebSource[];
}) {
  const index = useMemo(() => sourceIndex(webSources), [webSources]);
  return (
    <SourceFiles.Provider value={sourceVersions}>
      <WebSources.Provider value={index}>
        <div className="prose prose-sm plum-prose max-w-none break-words dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, [rehypeCitationGroups, { index }]]}
            components={markdownComponents}
            urlTransform={urlTransform}
          >
            {text}
          </ReactMarkdown>
        </div>
      </WebSources.Provider>
    </SourceFiles.Provider>
  );
});
