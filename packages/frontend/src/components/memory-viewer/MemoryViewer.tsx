import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain,
  Eye,
  Edit3,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Columns,
  Loader2,
  Plus,
  Trash2,
  FileText,
  ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import ReactMarkdown from 'react-markdown';

interface MemoryViewerProps {
  workingDirectory: string;
  className?: string;
}

interface MemoryFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

interface MemoryListResponse {
  success: boolean;
  data?: { memoryDir: string; files: MemoryFile[] };
}

interface MemoryContentResponse {
  success: boolean;
  data?: { path: string; content: string; size: number; modifiedAt: string };
}

interface MemoryWriteResponse {
  success: boolean;
}

export function MemoryViewer({ workingDirectory, className }: MemoryViewerProps) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('preview');
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const debouncedContent = useDebounce(content, 1000);
  const hasChanges = content !== originalContent;
  // The path the user actually typed in. The debounced text lags a full second
  // behind a file switch, and saving it against the newly selected path used to
  // overwrite that file with the previous file's body.
  const editedPathRef = useRef<string | null>(null);

  // Load file content
  const loadFileContent = useCallback(
    async (file: MemoryFile) => {
      setLoadingContent(true);
      setError(null);
      setSelectedFile(file);
      editedPathRef.current = null;

      try {
        const response = await api.get<MemoryContentResponse>(
          `/api/memories/content?path=${encodeURIComponent(file.path)}&workingDirectory=${encodeURIComponent(workingDirectory)}`
        );

        if (response.data.success && response.data.data) {
          setContent(response.data.data.content);
          setOriginalContent(response.data.data.content);
        }
      } catch {
        setError('Failed to load file');
        setContent('');
        setOriginalContent('');
      } finally {
        setLoadingContent(false);
      }
    },
    [workingDirectory]
  );

  // Load file list
  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<MemoryListResponse>(
        `/api/memories?workingDirectory=${encodeURIComponent(workingDirectory)}`
      );

      if (response.data.success && response.data.data) {
        setFiles(response.data.data.files);
        // Auto-select MEMORY.md if nothing selected
        if (!selectedFile && response.data.data.files.length > 0) {
          const memoryMd = response.data.data.files.find((f) => f.name === 'MEMORY.md');
          if (memoryMd) {
            loadFileContent(memoryMd);
          }
        }
      }
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [loadFileContent, selectedFile, workingDirectory]);

  useEffect(() => {
    if (workingDirectory) {
      loadFiles();
    }
  }, [workingDirectory, loadFiles]);

  const saveContent = useCallback(
    async (nextContent: string) => {
      if (!selectedFile) return;

      setSaving(true);
      setError(null);

      try {
        const response = await api.put<MemoryWriteResponse>('/api/memories/content', {
          path: selectedFile.path,
          content: nextContent,
          workingDirectory,
        });

        if (response.data.success) {
          setOriginalContent(nextContent);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } else {
          setError('Failed to save file');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save file');
      } finally {
        setSaving(false);
      }
    },
    [selectedFile, workingDirectory]
  );

  // Auto-save
  useEffect(() => {
    if (
      selectedFile &&
      editedPathRef.current === selectedFile.path &&
      debouncedContent &&
      debouncedContent !== originalContent
    ) {
      saveContent(debouncedContent);
    }
  }, [debouncedContent, originalContent, saveContent, selectedFile]);

  const createFile = async () => {
    if (!newFileName.trim()) return;

    const fileName = newFileName.endsWith('.md') ? newFileName : `${newFileName}.md`;

    try {
      const response = await api.post<MemoryWriteResponse>('/api/memories', {
        name: fileName,
        content: '',
        workingDirectory,
      });

      if (response.data.success) {
        setShowNewFileInput(false);
        setNewFileName('');
        await loadFiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create file');
    }
  };

  const deleteFile = async (file: MemoryFile) => {
    if (file.name === 'MEMORY.md') return; // Protect main memory file

    try {
      await api.delete(
        `/api/memories?path=${encodeURIComponent(file.path)}&workingDirectory=${encodeURIComponent(workingDirectory)}`
      );

      if (selectedFile?.path === file.path) {
        setSelectedFile(null);
        setContent('');
        setOriginalContent('');
      }
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  // File list view
  if (!selectedFile) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            <h3 className="font-medium">Memories</h3>
            <span className="text-xs text-muted-foreground">
              {files.length} file{files.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNewFileInput(true)}
              title="New memory file"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={loadFiles} disabled={loading} title="Reload">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* New file input */}
        {showNewFileInput && (
          <div className="shrink-0 flex items-center gap-2 p-3 border-b bg-muted/30">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFile();
                if (e.key === 'Escape') {
                  setShowNewFileInput(false);
                  setNewFileName('');
                }
              }}
              placeholder="filename.md"
              className="flex-1 text-sm bg-background border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <Button
              aria-label="Datei anlegen"
              title="Datei anlegen"
              variant="ghost"
              size="sm"
              onClick={createFile}
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* File list */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No memory files yet</p>
              <p className="text-xs mt-1">Claude Code will create them during sessions</p>
            </div>
          ) : (
            <div className="p-1">
              {files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => loadFileContent(file)}
                  className={cn(
                    'flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-sm',
                    'hover:bg-muted/70 transition-colors group'
                  )}
                >
                  <FileText
                    className={cn(
                      'h-4 w-4 shrink-0',
                      file.name === 'MEMORY.md' ? 'text-purple-500' : 'text-muted-foreground'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">
                      {file.name}
                      {file.name === 'MEMORY.md' && (
                        <span className="ml-1.5 text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-1.5 py-0.5 rounded">
                          Main
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(file.modifiedAt)} · {formatSize(file.size)}
                    </div>
                  </div>
                  {file.name !== 'MEMORY.md' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFile(file);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-opacity"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  // File editor view
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setSelectedFile(null);
              setContent('');
              setOriginalContent('');
              loadFiles();
            }}
            title="Back to list"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <FileText
            className={cn(
              'h-4 w-4',
              selectedFile.name === 'MEMORY.md' ? 'text-purple-500' : 'text-muted-foreground'
            )}
          />
          <h3 className="font-medium text-sm truncate">{selectedFile.name}</h3>
          {hasChanges && (
            <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex border rounded-md">
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 rounded-r-none', viewMode === 'edit' && 'bg-muted')}
              onClick={() => setViewMode('edit')}
              title="Edit only"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 rounded-none border-x', viewMode === 'split' && 'bg-muted')}
              onClick={() => setViewMode('split')}
              title="Split view"
            >
              <Columns className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 rounded-l-none', viewMode === 'preview' && 'bg-muted')}
              onClick={() => setViewMode('preview')}
              title="Preview only"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            variant="default"
            size="sm"
            onClick={() => saveContent(content)}
            disabled={saving || !hasChanges}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : saved ? (
              <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex">
        {loadingContent ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Editor */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div className={cn('flex-1 min-w-0', viewMode === 'split' && 'border-r')}>
                <Textarea
                  value={content}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    editedPathRef.current = selectedFile?.path ?? null;
                    setContent(e.target.value);
                  }}
                  placeholder="Write your memory notes here..."
                  className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
                />
              </div>
            )}

            {/* Preview */}
            {(viewMode === 'preview' || viewMode === 'split') && (
              <div className="flex-1 min-w-0">
                <ScrollArea className="h-full">
                  <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{content || '*No content yet*'}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span className="truncate">{selectedFile.name}</span>
        <span>{content.length} chars</span>
      </div>
    </div>
  );
}

export default MemoryViewer;
