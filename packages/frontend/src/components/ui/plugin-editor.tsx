import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Puzzle, Save, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@plum-code-webui/shared';

interface PluginData {
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  content: string;
  enabled?: boolean;
}

interface EditorProps {
  mode: 'create' | 'edit';
  initialData?: Partial<PluginData>;
  editName?: string;
  configProvider?: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function PluginEditor({
  mode,
  initialData,
  editName,
  configProvider,
  onClose,
  onSaved,
}: EditorProps) {
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const providerKey = configProvider || 'default';
  const withProvider = (endpoint: string) => {
    if (!configProvider) return endpoint;
    return `${endpoint}${endpoint.includes('?') ? '&' : '?'}provider=${encodeURIComponent(configProvider)}`;
  };

  // Fetch full content when editing
  const { data: fetchedData, isLoading: isLoadingContent } = useQuery({
    queryKey: ['claude-plugin-detail', providerKey, editName],
    queryFn: async () => {
      const endpoint = `/api/claude-config/plugin/${editName}`;
      const response = await api.get<
        ApiResponse<{
          name: string;
          description: string;
          version: string;
          author?: string;
          category?: string;
          content?: string;
        }>
      >(withProvider(endpoint));
      return response.data.data;
    },
    enabled: mode === 'edit' && !!editName,
  });

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    version: initialData?.version || '1.0.0',
    author: initialData?.author || '',
    category: initialData?.category || '',
    content: initialData?.content || '',
  });

  // Update form when fetched data arrives
  useEffect(() => {
    if (fetchedData) {
      setFormData({
        name: fetchedData.name || '',
        description: fetchedData.description || '',
        version: fetchedData.version || '1.0.0',
        author: fetchedData.author || '',
        category: fetchedData.category || '',
        content: fetchedData.content || '',
      });
    }
  }, [fetchedData]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const endpoint = '/api/claude-config/plugins';
      const payload = {
        name: formData.name,
        description: formData.description,
        version: formData.version || '1.0.0',
        author: formData.author || undefined,
        category: formData.category || undefined,
        content: formData.content,
      };
      const response = await api.post<ApiResponse<unknown>>(withProvider(endpoint), payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', providerKey] });
      toast({ title: 'Plugin created successfully' });
      onSaved?.();
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      const endpoint = `/api/claude-config/plugin/${editName}`;
      const payload = {
        name: formData.name,
        description: formData.description,
        version: formData.version || '1.0.0',
        author: formData.author || undefined,
        category: formData.category || undefined,
        content: formData.content,
      };
      const response = await api.put<ApiResponse<unknown>>(withProvider(endpoint), payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', providerKey] });
      toast({ title: 'Plugin updated successfully' });
      onSaved?.();
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const endpoint = `/api/claude-config/plugin/user-${editName}`;
      const response = await api.delete<ApiResponse<unknown>>(withProvider(endpoint));
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', providerKey] });
      toast({ title: 'Plugin deleted' });
      onSaved?.();
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      createMutation.mutate();
    } else {
      updateMutation.mutate();
    }
  };

  const isPending =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-dialog relative w-full max-w-2xl max-h-[90vh] rounded-2xl border shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b bg-muted/30">
          <div className="p-2.5 rounded-xl bg-violet-500/10">
            <Puzzle className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {mode === 'create' ? 'Create' : 'Edit'} Plugin
            </h2>
            <p className="text-sm text-muted-foreground">
              Define a custom plugin to extend Claude's capabilities
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          {isLoadingContent ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading content...</span>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="my-custom-plugin"
                  required
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Used as the identifier. Use lowercase with hyphens.
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="A brief description of what this plugin does..."
                  className="h-11"
                />
              </div>

              {/* Version and Author */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Version</label>
                  <Input
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                    placeholder="1.0.0"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Author</label>
                  <Input
                    value={formData.author}
                    onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                    placeholder="Your Name"
                    className="h-11"
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a category...</option>
                  <option value="productivity">Productivity</option>
                  <option value="development">Development</option>
                  <option value="writing">Writing</option>
                  <option value="analysis">Analysis</option>
                  <option value="automation">Automation</option>
                  <option value="integration">Integration</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Content */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Plugin Content *</label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="# Plugin Documentation&#10;&#10;This plugin provides...&#10;&#10;## Usage&#10;&#10;..."
                  required
                  rows={12}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  The markdown content that defines this plugin's behavior and documentation.
                </p>
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t bg-muted/30">
          {mode === 'edit' && !showDeleteConfirm ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : mode === 'edit' && showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">Delete permanently?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => deleteMutation.mutate()}
                disabled={isPending}
              >
                Yes, delete
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              onClick={handleSubmit}
              disabled={!formData.name || !formData.content || isPending}
              className={cn('gap-2', 'bg-violet-600 hover:bg-violet-700')}
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Saving...' : mode === 'create' ? 'Create' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Dialog wrapper
interface PluginEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialData?: Partial<PluginData>;
  editName?: string;
  configProvider?: string;
}

export function PluginEditorDialog({
  open,
  onOpenChange,
  mode,
  initialData,
  editName,
  configProvider,
}: PluginEditorDialogProps) {
  if (!open) return null;

  return (
    <PluginEditor
      mode={mode}
      initialData={initialData}
      editName={editName}
      configProvider={configProvider}
      onClose={() => onOpenChange(false)}
    />
  );
}
