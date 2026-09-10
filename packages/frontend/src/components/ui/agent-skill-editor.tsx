import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Bot, Wand2, Save, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@plum-code-webui/shared';

interface AgentData {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  prompt: string;
  enabled?: boolean;
}

interface SkillData {
  name: string;
  description: string;
  allowedTools?: string[];
  model?: string;
  content: string;
  enabled?: boolean;
}

interface EditorProps {
  type: 'agent' | 'skill';
  mode: 'create' | 'edit';
  initialData?: Partial<AgentData | SkillData>;
  editName?: string; // Original name when editing
  configProvider?: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function AgentSkillEditor({
  type,
  mode,
  initialData,
  editName,
  configProvider,
  onClose,
  onSaved,
}: EditorProps) {
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isAgent = type === 'agent';
  const providerKey = configProvider || 'default';
  const withProvider = (endpoint: string) => {
    if (!configProvider) return endpoint;
    return `${endpoint}${endpoint.includes('?') ? '&' : '?'}provider=${encodeURIComponent(configProvider)}`;
  };

  // Fetch full content when editing
  const { data: routedModelGroups = [] } = useQuery({
    queryKey: ['subagent-models'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data: Array<{ group: string; models: string[] }>;
      }>('/api/settings/subagent-models');
      return response.data.data;
    },
  });

  const { data: fetchedData, isLoading: isLoadingContent } = useQuery({
    queryKey: [isAgent ? 'claude-agent-detail' : 'claude-skill-detail', providerKey, editName],
    queryFn: async () => {
      const endpoint = isAgent
        ? `/api/claude-config/agent/${editName}`
        : `/api/claude-config/skill/${editName}`;
      const response = await api.get<
        ApiResponse<{
          name: string;
          description: string;
          tools?: string[];
          allowedTools?: string[];
          model?: string;
          prompt?: string;
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
    tools:
      type === 'agent'
        ? (initialData as AgentData)?.tools?.join(', ') || ''
        : (initialData as SkillData)?.allowedTools?.join(', ') || '',
    model: initialData?.model || '',
    content:
      type === 'agent'
        ? (initialData as AgentData)?.prompt || ''
        : (initialData as SkillData)?.content || '',
  });

  // Update form when fetched data arrives
  useEffect(() => {
    if (fetchedData) {
      setFormData({
        name: fetchedData.name || '',
        description: fetchedData.description || '',
        tools: isAgent
          ? fetchedData.tools?.join(', ') || ''
          : fetchedData.allowedTools?.join(', ') || '',
        model: fetchedData.model || '',
        content: isAgent ? fetchedData.prompt || '' : fetchedData.content || '',
      });
    }
  }, [fetchedData, isAgent]);
  const Icon = isAgent ? Bot : Wand2;
  const colorClass = isAgent ? 'text-primary' : 'text-green-600 dark:text-green-400';
  const bgColorClass = isAgent ? 'bg-primary/10' : 'bg-green-500/10';

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const endpoint = isAgent ? '/api/claude-config/agents' : '/api/claude-config/skills';
      const payload = isAgent
        ? {
            name: formData.name,
            description: formData.description,
            tools: formData.tools
              ? formData.tools
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined,
            model: formData.model || undefined,
            prompt: formData.content,
          }
        : {
            name: formData.name,
            description: formData.description,
            allowedTools: formData.tools
              ? formData.tools
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined,
            model: formData.model || undefined,
            content: formData.content,
          };
      const response = await api.post<ApiResponse<unknown>>(withProvider(endpoint), payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [isAgent ? 'claude-agents' : 'claude-skills', providerKey],
      });
      toast({ title: `${isAgent ? 'Agent' : 'Skill'} created successfully` });
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
      const endpoint = isAgent
        ? `/api/claude-config/agent/${editName}`
        : `/api/claude-config/skill/${editName}`;
      const payload = isAgent
        ? {
            name: formData.name,
            description: formData.description,
            tools: formData.tools
              ? formData.tools
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined,
            model: formData.model || undefined,
            prompt: formData.content,
          }
        : {
            name: formData.name,
            description: formData.description,
            allowedTools: formData.tools
              ? formData.tools
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined,
            model: formData.model || undefined,
            content: formData.content,
          };
      const response = await api.put<ApiResponse<unknown>>(withProvider(endpoint), payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [isAgent ? 'claude-agents' : 'claude-skills', providerKey],
      });
      toast({ title: `${isAgent ? 'Agent' : 'Skill'} updated successfully` });
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
      const endpoint = isAgent
        ? `/api/claude-config/agent/${editName}`
        : `/api/claude-config/skill/${editName}`;
      const response = await api.delete<ApiResponse<unknown>>(withProvider(endpoint));
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [isAgent ? 'claude-agents' : 'claude-skills', providerKey],
      });
      toast({ title: `${isAgent ? 'Agent' : 'Skill'} deleted` });
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
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-card rounded-2xl border shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b bg-muted/30">
          <div className={cn('p-2.5 rounded-xl', bgColorClass)}>
            <Icon className={cn('h-5 w-5', colorClass)} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {mode === 'create' ? 'Create' : 'Edit'} {isAgent ? 'Agent' : 'Skill'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isAgent
                ? 'Define a custom agent with specialized behavior'
                : 'Create a reusable skill with specific capabilities'}
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
                  placeholder={isAgent ? 'my-custom-agent' : 'my-custom-skill'}
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
                  placeholder="A brief description of what this does..."
                  className="h-11"
                />
              </div>

              {/* Tools */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{isAgent ? 'Tools' : 'Allowed Tools'}</label>
                <Input
                  value={formData.tools}
                  onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
                  placeholder="Read, Write, Bash, Glob"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated list of tools this {type} can use.
                </p>
              </div>

              {/* Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Model (optional)</label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Default (inherit from parent)</option>
                  <option value="opus">Claude Opus</option>
                  <option value="sonnet">Claude Sonnet</option>
                  <option value="haiku">Claude Haiku</option>
                  {/* Routed models: the backend model router sends these to the
                      provider configured for them (Z.AI, or any upstream under
                      Settings → Z.AI → Subagent-Upstreams) while the main
                      agent stays on the Claude plan. The groups come from the
                      server so this list cannot drift from what actually
                      routes. */}
                  {routedModelGroups.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Content/Prompt */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {isAgent ? 'System Prompt' : 'Skill Content'} *
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder={
                    isAgent
                      ? 'You are a specialized agent that...'
                      : 'This skill provides the ability to...'
                  }
                  required
                  rows={10}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {isAgent
                    ? "The system prompt that defines this agent's behavior and capabilities."
                    : "The markdown content that describes this skill's purpose and usage."}
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
              className="gap-2"
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
interface AgentSkillEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'agent' | 'skill';
  mode: 'create' | 'edit';
  initialData?: Partial<AgentData | SkillData>;
  editName?: string;
  configProvider?: string;
}

export function AgentSkillEditorDialog({
  open,
  onOpenChange,
  type,
  mode,
  initialData,
  editName,
  configProvider,
}: AgentSkillEditorDialogProps) {
  if (!open) return null;

  return (
    <AgentSkillEditor
      type={type}
      mode={mode}
      initialData={initialData}
      editName={editName}
      configProvider={configProvider}
      onClose={() => onOpenChange(false)}
    />
  );
}
