import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderKey,
  FolderTree,
  Globe,
  LayoutList,
  List,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/file-tree/file-icons';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ApiResponse, DirectoryContents, FileInfo } from '@plum-code-webui/shared';

interface WorkspaceFilesProps {
  workingDirectory?: string;
  onFileOpen?: (path: string, content: string) => void;
  onManageDirectories?: () => void;
  className?: string;
}

interface PreviewConfig {
  enabled: boolean;
  hostname: string | null;
}

interface StaticPreviewTarget {
  projectPath: string;
  filePath: string;
  relativePath: string;
  name: string;
  urlPath: string;
  size: number;
  modifiedAt: string;
}

interface CSVPreviewData {
  type: 'csv';
  path: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

interface XLSXPreviewData {
  type: 'xlsx';
  path: string;
  sheets: Record<string, { headers: string[]; rows: string[][]; totalRows: number }>;
  sheetNames: string[];
}

interface JSONPreviewData {
  type: 'json';
  path: string;
  content: unknown;
  size: number;
}

interface TextPreviewData {
  type: 'text';
  path: string;
  content: string;
  size: number;
}

type PreviewData = CSVPreviewData | XLSXPreviewData | JSONPreviewData | TextPreviewData;
type ViewMode = 'simple' | 'compact' | 'detailed';
type MediaKind = 'image' | 'pdf' | 'video' | 'audio';

type ViewerState =
  | { kind: 'empty' }
  | { kind: 'directory'; directory: FileInfo }
  | { kind: 'loading'; file: FileInfo }
  | {
      kind: 'html';
      file: FileInfo;
      target: StaticPreviewTarget | null;
      inlineHtml?: string;
      projectPath: string;
    }
  | { kind: 'data'; file: FileInfo; data: PreviewData }
  | { kind: 'media'; file: FileInfo; url: string; mediaKind: MediaKind; contentType: string }
  | { kind: 'unsupported'; file: FileInfo; message: string }
  | { kind: 'error'; file: FileInfo; message: string };

interface TreeState {
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  children: Record<string, FileInfo[]>;
  errors: Record<string, string | null>;
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.bash',
  '.bat',
  '.c',
  '.cc',
  '.cjs',
  '.clj',
  '.cmd',
  '.conf',
  '.config',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.cxx',
  '.dockerfile',
  '.env',
  '.erl',
  '.ex',
  '.exs',
  '.fish',
  '.go',
  '.graphql',
  '.gql',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.less',
  '.log',
  '.lua',
  '.mjs',
  '.md',
  '.mdx',
  '.php',
  '.prisma',
  '.properties',
  '.ps1',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.sass',
  '.scala',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
]);

const TEXT_PREVIEW_FILENAMES = new Set([
  '.env',
  '.env.example',
  '.env.local',
  '.eslintrc',
  '.gitignore',
  '.prettierrc',
  'dockerfile',
  'makefile',
  'readme',
  'license',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function parentDirectory(filePath: string, fallback: string): string {
  const index = filePath.lastIndexOf('/');
  return index > 0 ? filePath.slice(0, index) : fallback;
}

function extension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index).toLowerCase() : '';
}

function isHtmlFile(filename: string): boolean {
  return /\.html?$/i.test(filename);
}

function isTextPreviewFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (TEXT_PREVIEW_FILENAMES.has(lower)) return true;
  return TEXT_PREVIEW_EXTENSIONS.has(extension(lower));
}

function mediaKindForFile(filename: string): MediaKind | null {
  const ext = extension(filename);
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
    return 'image';
  }
  if (ext === '.pdf') return 'pdf';
  if (['.mp4', '.webm', '.mov', '.m4v', '.ogv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext)) return 'audio';
  return null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 104_857.6) / 10} MB`;
  return `${Math.round(bytes / 107_374_182.4) / 10} GB`;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function encodePreviewPath(relativePath: string): string {
  return `/${relativePath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function previewOrigin(hostname: string): string {
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  return `${protocol}://${hostname}`;
}

function buildStaticUrl(hostname: string, target: StaticPreviewTarget): string {
  return `${previewOrigin(hostname)}${encodePreviewPath(target.relativePath)}`;
}

function buildStaticInitUrl(hostname: string, target: StaticPreviewTarget): string {
  return `${previewOrigin(hostname)}${target.urlPath}`;
}

function normalizeAbsoluteFilePath(value: string): string {
  const parts: string[] = [];
  value
    .replace(/\\/g, '/')
    .split('/')
    .forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') {
        parts.pop();
        return;
      }
      parts.push(part);
    });
  return `/${parts.join('/')}`;
}

function splitReferenceSuffix(value: string): { pathPart: string; suffix: string } {
  const index = value.search(/[?#]/);
  if (index < 0) return { pathPart: value, suffix: '' };
  return { pathPart: value.slice(0, index), suffix: value.slice(index) };
}

function resolveInlineAssetPath(
  reference: string,
  filePath: string,
  projectPath: string
): string | null {
  const trimmed = reference.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return null;
  }

  const { pathPart, suffix } = splitReferenceSuffix(trimmed);
  if (!pathPart) return null;

  const basePath = pathPart.startsWith('/')
    ? `${projectPath}/${pathPart.slice(1)}`
    : `${parentDirectory(filePath, projectPath)}/${pathPart}`;
  return `/api/files/binary?path=${encodeURIComponent(normalizeAbsoluteFilePath(basePath))}${suffix}`;
}

function rewriteInlineSrcSet(value: string, filePath: string, projectPath: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return '';
      const [url, ...descriptor] = trimmed.split(/\s+/);
      const resolved = resolveInlineAssetPath(url ?? '', filePath, projectPath);
      return [resolved ?? url, ...descriptor].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

function rewriteInlineCssUrls(value: string, filePath: string, projectPath: string): string {
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _quote, url) => {
    const resolved = resolveInlineAssetPath(url, filePath, projectPath);
    if (!resolved) return match;
    const escaped = resolved.replace(/"/g, '%22');
    return `url("${escaped}")`;
  });
}

function buildInlineHtmlDocument(html: string, filePath: string, projectPath: string): string {
  if (typeof DOMParser === 'undefined') return html;

  const document = new DOMParser().parseFromString(html, 'text/html');
  const base = document.createElement('base');
  base.target = '_blank';
  document.head.prepend(base);

  document.querySelectorAll<HTMLElement>('[src]').forEach((element) => {
    const value = element.getAttribute('src');
    if (!value) return;
    const resolved = resolveInlineAssetPath(value, filePath, projectPath);
    if (resolved) element.setAttribute('src', resolved);
  });

  document.querySelectorAll<HTMLElement>('link[href], a[href]').forEach((element) => {
    const value = element.getAttribute('href');
    if (!value) return;
    const resolved = resolveInlineAssetPath(value, filePath, projectPath);
    if (resolved) element.setAttribute('href', resolved);
  });

  document.querySelectorAll<HTMLElement>('[srcset]').forEach((element) => {
    const value = element.getAttribute('srcset');
    if (!value) return;
    element.setAttribute('srcset', rewriteInlineSrcSet(value, filePath, projectPath));
  });

  document.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const value = element.getAttribute('style');
    if (!value) return;
    element.setAttribute('style', rewriteInlineCssUrls(value, filePath, projectPath));
  });

  document.querySelectorAll<HTMLStyleElement>('style').forEach((element) => {
    if (!element.textContent) return;
    element.textContent = rewriteInlineCssUrls(element.textContent, filePath, projectPath);
  });

  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function sortFiles(files: FileInfo[]): FileInfo[] {
  return [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchBlobUrl(filePath: string): Promise<{ url: string; contentType: string }> {
  const response = await fetch(`/api/files/binary?path=${encodeURIComponent(filePath)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(payload?.error?.message || payload?.message || 'Failed to load file');
  }
  const blob = await response.blob();
  return {
    url: URL.createObjectURL(blob),
    contentType: blob.type || response.headers.get('content-type') || 'application/octet-stream',
  };
}

async function downloadFile(filePath: string, name: string): Promise<void> {
  await downloadFromEndpoint(`/api/files/download?path=${encodeURIComponent(filePath)}`, name);
}

/** Whole directory as one ZIP (the server skips node_modules/.git by default). */
async function downloadFolder(dirPath: string, name: string): Promise<void> {
  await downloadFromEndpoint(
    `/api/files/download-folder?path=${encodeURIComponent(dirPath)}`,
    `${name || 'folder'}.zip`
  );
}

async function downloadFromEndpoint(endpoint: string, name: string): Promise<void> {
  const response = await fetch(endpoint, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(payload?.error?.message || payload?.message || 'Download failed');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function WorkspaceFiles({
  workingDirectory,
  onFileOpen,
  onManageDirectories,
  className,
}: WorkspaceFilesProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef(0);
  const blobUrlRef = useRef<string | null>(null);
  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileInfo | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>({ kind: 'empty' });
  const [isUploading, setIsUploading] = useState(false);
  const [openingEditorPath, setOpeningEditorPath] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState('');
  const [treeState, setTreeState] = useState<TreeState>({
    expanded: {},
    loading: {},
    children: {},
    errors: {},
  });

  const replaceBlobUrl = useCallback((url: string | null) => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = url;
  }, []);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PreviewConfig>('/api/preview/config')
      .then(({ data }) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false, hostname: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDirectory = useCallback(async (directoryPath: string, force = false) => {
    let shouldLoad = true;
    setTreeState((prev) => {
      if (!force && (prev.loading[directoryPath] || prev.children[directoryPath])) {
        shouldLoad = false;
        return prev;
      }
      return {
        ...prev,
        loading: { ...prev.loading, [directoryPath]: true },
        errors: { ...prev.errors, [directoryPath]: null },
      };
    });

    if (!shouldLoad) return;

    try {
      const response = await api.get<ApiResponse<DirectoryContents>>(
        `/api/files?path=${encodeURIComponent(directoryPath)}`
      );
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message || 'Failed to load directory');
      }
      const files = response.data.data.files;
      setTreeState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [directoryPath]: false },
        children: { ...prev.children, [directoryPath]: files },
        errors: { ...prev.errors, [directoryPath]: null },
      }));
    } catch (err) {
      setTreeState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [directoryPath]: false },
        errors: { ...prev.errors, [directoryPath]: errorMessage(err) },
      }));
    }
  }, []);

  useEffect(() => {
    if (!workingDirectory) return;
    replaceBlobUrl(null);
    setTreeState({
      expanded: { [workingDirectory]: true },
      loading: {},
      children: {},
      errors: {},
    });
    setSelectedPath(null);
    setSelectedEntry(null);
    setViewerState({ kind: 'empty' });
    void loadDirectory(workingDirectory, true);
  }, [loadDirectory, replaceBlobUrl, workingDirectory]);

  const showFile = useCallback(
    async (file: FileInfo) => {
      if (!workingDirectory || file.type !== 'file') return;

      const requestId = ++previewRequestRef.current;
      replaceBlobUrl(null);
      setSelectedPath(file.path);
      setSelectedEntry(file);
      setViewerState({ kind: 'loading', file });
      setActiveSheet('');

      try {
        if (isHtmlFile(file.name)) {
          let staticTarget: StaticPreviewTarget | null = null;
          if (config?.enabled && config.hostname) {
            try {
              const params = new URLSearchParams({
                projectPath: workingDirectory,
                filePath: file.path,
              });
              const { data } = await api.get<StaticPreviewTarget>(
                `/api/preview/static-file?${params.toString()}`
              );
              if (requestId !== previewRequestRef.current) return;
              staticTarget = data;
            } catch {
              // Fall through to the inline preview below. Static vhost preview depends on DNS/proxy setup.
            }
          }

          try {
            const response = await api.get<
              ApiResponse<{ path: string; content: string; size: number; modifiedAt: string }>
            >(`/api/files/content?path=${encodeURIComponent(file.path)}`);
            if (!response.data.success || !response.data.data) {
              throw new Error(response.data.error?.message || 'Failed to load HTML preview');
            }
            if (requestId !== previewRequestRef.current) return;
            setViewerState({
              kind: 'html',
              file,
              target: staticTarget,
              inlineHtml: response.data.data.content,
              projectPath: workingDirectory,
            });
          } catch (contentError) {
            if (requestId !== previewRequestRef.current) return;
            if (staticTarget) {
              setViewerState({
                kind: 'html',
                file,
                target: staticTarget,
                projectPath: workingDirectory,
              });
              return;
            }
            throw contentError;
          }
          return;
        }

        const mediaKind = mediaKindForFile(file.name);
        if (mediaKind) {
          const blob = await fetchBlobUrl(file.path);
          if (requestId !== previewRequestRef.current) {
            URL.revokeObjectURL(blob.url);
            return;
          }
          replaceBlobUrl(blob.url);
          setViewerState({
            kind: 'media',
            file,
            mediaKind,
            url: blob.url,
            contentType: blob.contentType,
          });
          return;
        }

        if (
          isTextPreviewFile(file.name) ||
          extension(file.name) === '.xlsx' ||
          extension(file.name) === '.xls'
        ) {
          const response = await api.get<ApiResponse<PreviewData>>(
            `/api/files/preview?path=${encodeURIComponent(file.path)}`
          );
          if (!response.data.success || !response.data.data) {
            throw new Error(response.data.error?.message || 'Failed to load preview');
          }
          if (requestId !== previewRequestRef.current) return;
          const data = response.data.data;
          if (data.type === 'xlsx') {
            setActiveSheet(data.sheetNames[0] ?? '');
          }
          setViewerState({ kind: 'data', file, data });
          return;
        }

        if (requestId !== previewRequestRef.current) return;
        setViewerState({
          kind: 'unsupported',
          file,
          message:
            'This file type cannot be rendered inline. File details and download are available.',
        });
      } catch (err) {
        if (requestId !== previewRequestRef.current) return;
        setViewerState({ kind: 'error', file, message: errorMessage(err) });
      }
    },
    [config, replaceBlobUrl, workingDirectory]
  );

  const selectDirectory = useCallback(
    (directory: FileInfo) => {
      replaceBlobUrl(null);
      setSelectedPath(directory.path);
      setSelectedEntry(directory);
      setViewerState({ kind: 'directory', directory });
      void loadDirectory(directory.path);
    },
    [loadDirectory, replaceBlobUrl]
  );

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      const isExpanded = Boolean(treeState.expanded[directoryPath]);
      const hasLoadedChildren = Object.prototype.hasOwnProperty.call(
        treeState.children,
        directoryPath
      );
      const isLoading = Boolean(treeState.loading[directoryPath]);

      setTreeState((prev) => {
        return {
          ...prev,
          expanded: { ...prev.expanded, [directoryPath]: !prev.expanded[directoryPath] },
        };
      });
      if (!isExpanded && !hasLoadedChildren && !isLoading) void loadDirectory(directoryPath);
    },
    [loadDirectory, treeState.children, treeState.expanded, treeState.loading]
  );

  const refreshRoot = useCallback(() => {
    if (!workingDirectory) return;
    void loadDirectory(workingDirectory, true);
  }, [loadDirectory, workingDirectory]);

  const cycleViewMode = useCallback(() => {
    setViewMode((current) => {
      if (current === 'simple') return 'compact';
      if (current === 'compact') return 'detailed';
      return 'simple';
    });
  }, []);

  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0 || !workingDirectory) return;

      let targetDirectory = workingDirectory;
      if (selectedEntry?.type === 'directory') {
        targetDirectory = selectedEntry.path;
      } else if (selectedEntry?.type === 'file') {
        targetDirectory = parentDirectory(selectedEntry.path, workingDirectory);
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        Array.from(files).forEach((file) => formData.append('files', file));
        const response = await api.post<
          ApiResponse<{ files: { name: string; path: string; size: number }[] }>
        >(`/api/files/upload?targetDirectory=${encodeURIComponent(targetDirectory)}`, formData);

        if (!response.data.success) {
          throw new Error(response.data.error?.message || 'Upload failed');
        }

        await loadDirectory(targetDirectory, true);
        if (targetDirectory !== workingDirectory) {
          await loadDirectory(workingDirectory, true);
        }
        toast({ title: 'Upload complete', description: `${files.length} file(s) added.` });
      } catch (err) {
        toast({ title: 'Upload failed', description: errorMessage(err), variant: 'destructive' });
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [loadDirectory, selectedEntry, workingDirectory]
  );

  const handleDownload = useCallback(async (file: FileInfo) => {
    try {
      if (file.type === 'directory') {
        toast({
          title: 'Preparing ZIP…',
          description: `${file.name} is being packed (node_modules and .git are skipped).`,
        });
        await downloadFolder(file.path, file.name);
      } else {
        await downloadFile(file.path, file.name);
      }
    } catch (err) {
      toast({ title: 'Download failed', description: errorMessage(err), variant: 'destructive' });
    }
  }, []);

  const handleOpenEditor = useCallback(
    async (file: FileInfo) => {
      if (!onFileOpen || file.type !== 'file') return;
      setOpeningEditorPath(file.path);
      try {
        const response = await api.get<
          ApiResponse<{ path: string; content: string; size: number; modifiedAt: string }>
        >(`/api/files/content?path=${encodeURIComponent(file.path)}`);
        if (!response.data.success || !response.data.data) {
          throw new Error(response.data.error?.message || 'Failed to read file');
        }
        onFileOpen(file.path, response.data.data.content);
      } catch (err) {
        toast({
          title: 'Open failed',
          description: errorMessage(err),
          variant: 'destructive',
        });
      } finally {
        setOpeningEditorPath(null);
      }
    },
    [onFileOpen]
  );

  const openExternal = useCallback(() => {
    if (viewerState.kind !== 'html') return;
    if (config?.hostname && viewerState.target) {
      window.open(
        buildStaticInitUrl(config.hostname, viewerState.target),
        '_blank',
        'noopener,noreferrer'
      );
      return;
    }
    if (viewerState.inlineHtml) {
      const blob = new Blob(
        [
          buildInlineHtmlDocument(
            viewerState.inlineHtml,
            viewerState.file.path,
            viewerState.projectPath
          ),
        ],
        { type: 'text/html' }
      );
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }, [config, viewerState]);

  const reloadActive = useCallback(() => {
    if (!selectedEntry) return;
    if (selectedEntry.type === 'directory') {
      void loadDirectory(selectedEntry.path, true);
    } else {
      void showFile(selectedEntry);
    }
  }, [loadDirectory, selectedEntry, showFile]);

  const filterFiles = useCallback(
    (files: FileInfo[]): FileInfo[] => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return sortFiles(files);

      return sortFiles(files).filter((file) => {
        if (file.name.toLowerCase().includes(query)) return true;
        if (file.type !== 'directory') return false;
        const children = treeState.children[file.path];
        return children ? filterFiles(children).length > 0 : false;
      });
    },
    [searchQuery, treeState.children]
  );

  const renderNode = useCallback(
    (file: FileInfo, depth: number): ReactNode => {
      const isDirectory = file.type === 'directory';
      const isExpanded = Boolean(treeState.expanded[file.path]);
      const isLoading = Boolean(treeState.loading[file.path]);
      const children = treeState.children[file.path] ?? [];
      const visibleChildren = filterFiles(children);
      const isSelected = selectedPath === file.path;
      const paddingLeft = 8 + depth * 14;

      return (
        <div key={file.path}>
          <div
            role="treeitem"
            tabIndex={0}
            aria-expanded={isDirectory ? isExpanded : undefined}
            aria-selected={isSelected}
            className={cn(
              'workspace-file-row group flex min-h-7 cursor-pointer items-center gap-1.5 rounded-sm py-0.5 pr-2 text-sm outline-none transition-colors',
              'hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-primary/50',
              isSelected && 'is-selected bg-primary/10 text-primary'
            )}
            style={{ paddingLeft }}
            title={file.path}
            onClick={(event) => {
              event.stopPropagation();
              if (isDirectory) {
                selectDirectory(file);
              } else {
                void showFile(file);
              }
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (isDirectory) {
                toggleDirectory(file.path);
              } else {
                void handleOpenEditor(file);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (isDirectory) toggleDirectory(file.path);
                else void showFile(file);
              }
              if (event.key === 'ArrowRight' && isDirectory && !isExpanded) {
                event.preventDefault();
                toggleDirectory(file.path);
              }
              if (event.key === 'ArrowLeft' && isDirectory && isExpanded) {
                event.preventDefault();
                toggleDirectory(file.path);
              }
            }}
          >
            <button
              type="button"
              className="workspace-file-disclosure flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10"
              onClick={(event) => {
                event.stopPropagation();
                if (isDirectory) toggleDirectory(file.path);
              }}
              tabIndex={-1}
            >
              {isDirectory ? (
                isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )
              ) : null}
            </button>
            <FileIcon
              filename={file.name}
              isDirectory={isDirectory}
              isOpen={isExpanded}
              className="workspace-file-icon h-4 w-4 shrink-0"
            />
            <span className="workspace-file-name min-w-0 flex-1 truncate">
              {highlightMatch(file.name, searchQuery)}
            </span>
            {viewMode === 'compact' && !isDirectory && file.size > 0 && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatBytes(file.size)}
              </span>
            )}
            {viewMode === 'detailed' && (
              <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                {!isDirectory && file.size > 0 && (
                  <span className="w-14 text-right">{formatBytes(file.size)}</span>
                )}
                <span className="hidden w-24 text-right xl:inline">
                  {formatDate(file.modifiedAt)}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="workspace-file-inline-action h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                void handleDownload(file);
              }}
              title={isDirectory ? 'Download folder as ZIP' : 'Download file'}
            >
              <Download className="h-3 w-3" />
            </Button>
          </div>

          {isDirectory && isExpanded && (
            <div role="group">
              {isLoading ? (
                <div
                  className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: paddingLeft + 24 }}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading
                </div>
              ) : visibleChildren.length > 0 ? (
                visibleChildren.map((child) => renderNode(child, depth + 1))
              ) : treeState.errors[file.path] ? (
                <div
                  className="truncate py-1 text-xs text-destructive"
                  style={{ paddingLeft: paddingLeft + 24 }}
                  title={treeState.errors[file.path] ?? undefined}
                >
                  {treeState.errors[file.path]}
                </div>
              ) : null}
            </div>
          )}
        </div>
      );
    },
    [
      filterFiles,
      handleDownload,
      handleOpenEditor,
      searchQuery,
      selectDirectory,
      selectedPath,
      showFile,
      toggleDirectory,
      treeState,
      viewMode,
    ]
  );

  if (!workingDirectory) {
    return (
      <div
        className={cn(
          'workspace-files-unavailable flex h-full items-center justify-center p-6',
          className
        )}
      >
        <div className="workspace-files-state-card max-w-md rounded-lg border bg-card p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <h3 className="mb-1 font-semibold">Workspace unavailable</h3>
          <p className="text-sm text-muted-foreground">
            This session does not expose a workspace path.
          </p>
        </div>
      </div>
    );
  }

  const rootFiles = treeState.children[workingDirectory] ?? [];
  const rootLoading = Boolean(treeState.loading[workingDirectory]);
  const rootError = treeState.errors[workingDirectory];
  const displayFiles = filterFiles(rootFiles);
  const selectedFile = selectedEntry?.type === 'file' ? selectedEntry : null;
  const canOpenEditor = Boolean(onFileOpen && selectedFile);
  const htmlUrl =
    config?.hostname && viewerState.kind === 'html' && viewerState.target
      ? buildStaticUrl(config.hostname, viewerState.target)
      : null;

  return (
    <div
      className={cn(
        'workspace-files-shell flex h-full flex-col overflow-hidden bg-background',
        className
      )}
    >
      <div className="workspace-files-topbar shrink-0 border-b bg-card/95">
        <div className="flex min-h-12 items-center gap-2 px-3 py-2">
          <span className="workspace-files-topbar-icon">
            <FolderTree className="h-4 w-4 shrink-0" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Files</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {selectedEntry ? selectedEntry.path : workingDirectory}
            </div>
          </div>
          {onManageDirectories && (
            <Button
              variant="ghost"
              size="icon"
              className="workspace-files-icon-button h-8 w-8"
              onClick={onManageDirectories}
              title="Manage allowed directories"
            >
              <FolderKey className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="workspace-files-icon-button h-8 w-8"
            onClick={reloadActive}
            disabled={!selectedEntry || rootLoading}
            title="Reload selected file or folder"
          >
            <RefreshCw className={cn('h-4 w-4', rootLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="workspace-files-icon-button h-8 w-8"
            onClick={openExternal}
            disabled={viewerState.kind !== 'html'}
            title="Open HTML preview in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="workspace-files-layout flex min-h-0 flex-1">
        <aside className="workspace-files-sidebar flex w-80 shrink-0 flex-col border-r bg-muted/15 max-lg:w-72 max-sm:w-56">
          <div className="workspace-files-sidebar-toolbar shrink-0 space-y-2 border-b p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span className="workspace-files-mini-icon">
                  <FolderTree className="h-4 w-4 shrink-0" />
                </span>
                <span className="truncate">Workspace</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-files-mini-button h-6 w-6"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  title="Upload files"
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-files-mini-button h-6 w-6"
                  onClick={cycleViewMode}
                  title={`View: ${viewMode}`}
                >
                  {viewMode === 'simple' && <List className="h-3.5 w-3.5" />}
                  {viewMode === 'compact' && <LayoutList className="h-3.5 w-3.5" />}
                  {viewMode === 'detailed' && <Table2 className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-files-mini-button h-6 w-6"
                  onClick={refreshRoot}
                  disabled={rootLoading}
                  title="Refresh workspace"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', rootLoading && 'animate-spin')} />
                </Button>
              </div>
            </div>

            <div className="workspace-files-search relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search files"
                className="h-7 pl-7 pr-7 text-sm"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-files-clear-search absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="workspace-files-tree min-h-0 flex-1 overflow-auto p-1" role="tree">
            {rootLoading && rootFiles.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rootError ? (
              <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {rootError}
              </div>
            ) : displayFiles.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No matching files' : 'No files found'}
              </div>
            ) : (
              displayFiles.map((file) => renderNode(file, 0))
            )}
          </div>

          <div className="workspace-files-footer shrink-0 border-t px-2 py-1.5">
            <p
              className="truncate font-mono text-[10px] text-muted-foreground"
              title={workingDirectory}
            >
              {workingDirectory}
            </p>
          </div>
        </aside>

        <main className="workspace-files-main flex min-w-0 flex-1 flex-col bg-background">
          <div className="workspace-files-preview-header flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-2">
            {selectedEntry ? (
              <FileIcon
                filename={selectedEntry.name}
                isDirectory={selectedEntry.type === 'directory'}
                className="h-4 w-4 shrink-0"
              />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {selectedEntry ? selectedEntry.name : 'Select a file'}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {htmlUrl
                  ? htmlUrl
                  : selectedEntry
                    ? `${selectedEntry.type}${selectedEntry.type === 'file' ? ` · ${formatBytes(selectedEntry.size)}` : ''}${selectedEntry.modifiedAt ? ` · ${formatDate(selectedEntry.modifiedAt)}` : ''}`
                    : 'Browse the workspace on the left'}
              </div>
            </div>
            {selectedFile && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="workspace-files-action-button h-7 px-2"
                  onClick={() => void handleOpenEditor(selectedFile)}
                  disabled={!canOpenEditor || openingEditorPath === selectedFile.path}
                  title="Open in editor"
                >
                  {openingEditorPath === selectedFile.path ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Code2 className="mr-1 h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">Edit</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="workspace-files-action-button h-7 px-2"
                  onClick={() => void handleDownload(selectedFile)}
                  title="Download file"
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
              </>
            )}
            {selectedEntry?.type === 'directory' && (
              <Button
                variant="ghost"
                size="sm"
                className="workspace-files-action-button h-7 px-2"
                onClick={() => void handleDownload(selectedEntry)}
                title="Download folder as ZIP (node_modules and .git are skipped)"
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download ZIP</span>
              </Button>
            )}
          </div>
          <div className="workspace-files-viewer min-h-0 flex-1 overflow-auto">
            <FileViewer
              state={viewerState}
              activeSheet={activeSheet}
              onSheetChange={setActiveSheet}
              htmlHostname={config?.hostname ?? null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function FileViewer({
  state,
  activeSheet,
  onSheetChange,
  htmlHostname,
}: {
  state: ViewerState;
  activeSheet: string;
  onSheetChange: (sheet: string) => void;
  htmlHostname: string | null;
}) {
  if (state.kind === 'empty') {
    return (
      <div className="workspace-file-empty flex h-full items-center justify-center p-6 text-center">
        <div className="workspace-files-state-card max-w-sm">
          <div className="workspace-file-empty-icon mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border bg-muted/30">
            <FolderTree className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mb-1 font-semibold">No file selected</h3>
          <p className="text-sm text-muted-foreground">Select any file to show it here.</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'directory') {
    return (
      <div className="workspace-file-directory p-4">
        <div className="workspace-file-directory-card rounded-md border bg-muted/20 p-4">
          <div className="mb-1 text-sm font-medium">{state.directory.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{state.directory.path}</div>
          <div className="mt-3 text-xs text-muted-foreground">
            Folder · Modified {formatDate(state.directory.modifiedAt) || 'unknown'}
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className="workspace-file-loading flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading {state.file.name}
      </div>
    );
  }

  if (state.kind === 'html') {
    const src =
      htmlHostname && state.target ? buildStaticInitUrl(htmlHostname, state.target) : null;
    return state.inlineHtml ? (
      <iframe
        srcDoc={buildInlineHtmlDocument(state.inlineHtml, state.file.path, state.projectPath)}
        className="workspace-html-frame h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        title={state.file.name}
      />
    ) : src ? (
      <iframe
        src={src}
        className="workspace-html-frame h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        title={state.file.name}
      />
    ) : (
      <InlineMessage
        icon={<Globe className="h-6 w-6" />}
        title="HTML preview unavailable"
        body="Static preview hostname is not configured."
      />
    );
  }

  if (state.kind === 'media') {
    if (state.mediaKind === 'image') {
      return (
        <div className="workspace-file-media flex h-full items-center justify-center bg-muted/10 p-4">
          <img
            src={state.url}
            alt={state.file.name}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    }
    if (state.mediaKind === 'pdf') {
      return (
        <iframe
          src={state.url}
          className="h-full w-full border-0 bg-white"
          title={state.file.name}
        />
      );
    }
    if (state.mediaKind === 'video') {
      return (
        <div className="flex h-full items-center justify-center bg-black p-4">
          <video src={state.url} controls className="max-h-full max-w-full" />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-4">
        <audio src={state.url} controls className="w-full max-w-lg" />
      </div>
    );
  }

  if (state.kind === 'data') {
    return (
      <PreviewDataView data={state.data} activeSheet={activeSheet} onSheetChange={onSheetChange} />
    );
  }

  if (state.kind === 'unsupported') {
    return (
      <InlineMessage
        icon={<FileText className="h-6 w-6" />}
        title={state.file.name}
        body={`${state.message} Size: ${formatBytes(state.file.size) || 'unknown'}.`}
      />
    );
  }

  return (
    <InlineMessage
      icon={<AlertTriangle className="h-6 w-6 text-amber-500" />}
      title={`Cannot show ${state.file.name}`}
      body={state.message}
    />
  );
}

function PreviewDataView({
  data,
  activeSheet,
  onSheetChange,
}: {
  data: PreviewData;
  activeSheet: string;
  onSheetChange: (sheet: string) => void;
}) {
  if (data.type === 'csv' || data.type === 'xlsx') {
    return <DataTablePreview data={data} activeSheet={activeSheet} onSheetChange={onSheetChange} />;
  }

  if (data.type === 'json') {
    return (
      <pre className="workspace-file-code-preview min-h-full overflow-auto bg-muted/20 p-4 font-mono text-sm">
        {JSON.stringify(data.content, null, 2)}
      </pre>
    );
  }

  return (
    <pre className="workspace-file-code-preview min-h-full overflow-auto whitespace-pre-wrap bg-muted/20 p-4 font-mono text-sm">
      {data.content}
    </pre>
  );
}

function DataTablePreview({
  data,
  activeSheet,
  onSheetChange,
}: {
  data: CSVPreviewData | XLSXPreviewData;
  activeSheet: string;
  onSheetChange: (sheet: string) => void;
}) {
  const table =
    data.type === 'csv'
      ? {
          headers: data.headers,
          rows: data.rows,
          totalRows: data.totalRows,
          truncated: data.truncated,
        }
      : {
          headers: data.sheets[activeSheet]?.headers ?? [],
          rows: data.sheets[activeSheet]?.rows ?? [],
          totalRows: data.sheets[activeSheet]?.totalRows ?? 0,
          truncated: false,
        };

  return (
    <div className="workspace-file-table-preview flex h-full flex-col">
      {data.type === 'xlsx' && data.sheetNames.length > 1 && (
        <div className="workspace-file-sheet-tabs flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/20 p-2">
          {data.sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onSheetChange(name)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                activeSheet === name
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="workspace-file-table-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {table.headers.map((header, index) => (
                <th key={index} className="border px-3 py-2 text-left font-medium">
                  {header || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-muted/40">
                {table.headers.map((_, colIndex) => (
                  <td key={colIndex} className="border px-3 py-1.5">
                    {row[colIndex] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="workspace-file-table-footer shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
        <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />
        {table.totalRows} rows{table.truncated ? ' (showing first 100)' : ''}
      </div>
    </div>
  );
}

function InlineMessage({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="workspace-file-inline-message flex h-full items-center justify-center p-6 text-center">
      <div className="workspace-files-state-card max-w-md">
        <div className="workspace-file-empty-icon mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
          {icon}
        </div>
        <h3 className="mb-1 font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): ReactNode {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className="rounded bg-primary/15 px-0.5 text-primary">
        {text.slice(index, index + normalizedQuery.length)}
      </span>
      {text.slice(index + normalizedQuery.length)}
    </>
  );
}

export default WorkspaceFiles;
