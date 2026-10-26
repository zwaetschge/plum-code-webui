import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  FolderSearch,
  Loader2,
  Pencil,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type { ApiResponse } from '@plum-code-webui/shared';

import { AgentSkillEditorDialog } from '@/components/ui/agent-skill-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  AGENT_INITIAL_COUNT,
  AGENT_PAGE_SIZE,
  CAPABILITY_INITIAL_COUNT,
  CAPABILITY_PAGE_SIZE,
  getNextVisibleCount,
  getVisibleItems,
} from '@/lib/progressiveList';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';

import {
  filterAgents,
  filterSkills,
  getSkillCatalogCounts,
  type AgentInfo,
  type SkillInfo,
  type SkillStatusFilter,
} from './capabilityCatalog';

interface CapabilityCatalogSectionsProps {
  agents?: AgentInfo[];
  skills?: SkillInfo[];
  configProvider: string;
}

interface EditingItem {
  name: string;
  data: Record<string, unknown>;
}

export function CapabilityCatalogSections({
  agents,
  skills,
  configProvider,
}: CapabilityCatalogSectionsProps) {
  const queryClient = useQueryClient();
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentVisibleCount, setAgentVisibleCount] = useState(AGENT_INITIAL_COUNT);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillStatusFilter, setSkillStatusFilter] = useState<SkillStatusFilter>('all');
  const [skillVisibleCount, setSkillVisibleCount] = useState(CAPABILITY_INITIAL_COUNT);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorType, setEditorType] = useState<'agent' | 'skill'>('agent');
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const skillImportInputRef = useRef<HTMLInputElement | null>(null);

  const withProvider = (endpoint: string) =>
    `${endpoint}${endpoint.includes('?') ? '&' : '?'}provider=${encodeURIComponent(configProvider)}`;

  const filteredAgents = useMemo(
    () => filterAgents(agents, agentSearchQuery),
    [agentSearchQuery, agents]
  );
  const visibleAgents = useMemo(
    () => getVisibleItems(filteredAgents, agentVisibleCount),
    [agentVisibleCount, filteredAgents]
  );
  const filteredSkills = useMemo(
    () => filterSkills(skills, skillSearchQuery, skillStatusFilter),
    [skillSearchQuery, skillStatusFilter, skills]
  );
  const visibleSkills = useMemo(
    () => getVisibleItems(filteredSkills, skillVisibleCount),
    [filteredSkills, skillVisibleCount]
  );
  const { activeSkillCount, skillPackageCount, stylePresetCount } = useMemo(
    () => getSkillCatalogCounts(skills),
    [skills]
  );

  useEffect(() => {
    setAgentVisibleCount(AGENT_INITIAL_COUNT);
  }, [agentSearchQuery]);

  useEffect(() => {
    setSkillVisibleCount(CAPABILITY_INITIAL_COUNT);
  }, [skillSearchQuery, skillStatusFilter]);

  const toggleAgentMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(
        withProvider(`/api/claude-config/agent/${name}/toggle`)
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-agents', configProvider] });
      toast({ title: data?.enabled ? 'Agent enabled' : 'Agent disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const toggleSkillMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(
        withProvider(`/api/claude-config/skill/${name}/toggle`)
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-skills', configProvider] });
      toast({ title: data?.enabled ? 'Skill enabled' : 'Skill disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const importSkillsMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const response = await api.post<
        ApiResponse<{
          imported: Array<{ name: string; dirPath: string }>;
          skipped: Array<{ file: string; skillName?: string; reason: string }>;
          errors: Array<{ file: string; error: string }>;
        }>
      >(withProvider('/api/claude-config/skills/import'), form);
      return response.data.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-skills', configProvider] });
      const importedCount = data.imported.length;
      const skippedCount = data.skipped.length;
      const errorCount = data.errors.length;
      const parts = [`${importedCount} imported`];
      if (skippedCount) parts.push(`${skippedCount} skipped`);
      if (errorCount) parts.push(`${errorCount} errors`);
      toast({
        title: importedCount > 0 ? 'Skills imported' : 'No skills imported',
        description: parts.join(' · '),
        variant: errorCount > 0 ? 'destructive' : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    },
  });

  const handleSkillImportFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    importSkillsMutation.mutate(Array.from(files));
    if (skillImportInputRef.current) skillImportInputRef.current.value = '';
  };

  const openAgentEditor = (mode: 'create' | 'edit', agent?: AgentInfo) => {
    setEditorType('agent');
    setEditorMode(mode);
    if (agent) {
      const baseName =
        agent.filePath.split('/').pop()?.replace('.md.disabled', '').replace('.md', '') ||
        agent.name;
      setEditingItem({
        name: baseName,
        data: {
          name: agent.name,
          description: agent.description,
          tools: agent.tools,
          model: agent.model,
          prompt: '',
        },
      });
    } else {
      setEditingItem(null);
    }
    setEditorOpen(true);
  };

  const openSkillEditor = (mode: 'create' | 'edit', skill?: SkillInfo) => {
    setEditorType('skill');
    setEditorMode(mode);
    if (skill) {
      const baseName = skill.dirPath.split('/').pop()?.replace('.disabled', '') || skill.name;
      setEditingItem({
        name: baseName,
        data: {
          name: skill.name,
          description: skill.description,
          allowedTools: skill.allowedTools,
          model: skill.model,
          content: '',
        },
      });
    } else {
      setEditingItem(null);
    }
    setEditorOpen(true);
  };

  return (
    <>
      <section id="agents">
        <div className="settings-section-headband">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Agents</h2>
            {agents && agents.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                {agents.length}
              </span>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => openAgentEditor('create')}
            className="gap-1.5 h-8 px-3 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {agents && agents.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={agentSearchQuery}
                onChange={(event) => setAgentSearchQuery(event.target.value)}
                placeholder="Search agents and tools..."
                className="h-9 pl-9 pr-9"
              />
              {agentSearchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                  onClick={() => setAgentSearchQuery('')}
                  aria-label="Clear agent search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <span className="shrink-0 px-1 text-xs text-muted-foreground">
              {filteredAgents.length} match{filteredAgents.length === 1 ? '' : 'es'}
            </span>
          </div>
        )}

        {agents && agents.length > 0 && filteredAgents.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleAgents.map((agent) => {
                const baseName =
                  agent.filePath.split('/').pop()?.replace('.md.disabled', '').replace('.md', '') ||
                  agent.name;
                return (
                  <Card
                    key={agent.id}
                    className={cn(
                      'capability-card group relative overflow-hidden transition-all hover:shadow-md',
                      agent.enabled ? 'hover:border-primary/30' : 'opacity-60 hover:opacity-80'
                    )}
                  >
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            'p-2 rounded-lg shrink-0',
                            agent.enabled
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold truncate">{agent.name}</p>
                            {!agent.enabled && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                Disabled
                              </span>
                            )}
                            {agent.model && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                {agent.model}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {agent.description || 'No description'}
                          </p>
                          {agent.tools && agent.tools.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {agent.tools.slice(0, 3).map((tool) => (
                                <span
                                  key={tool}
                                  className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground"
                                >
                                  {tool}
                                </span>
                              ))}
                              {agent.tools.length > 3 && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground">
                                  +{agent.tools.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="capability-card-actions z-20 flex shrink-0 gap-1 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => toggleAgentMutation.mutate(baseName)}
                            title={agent.enabled ? 'Disable' : 'Enable'}
                            aria-label={`${agent.enabled ? 'Disable' : 'Enable'} ${agent.name}`}
                            aria-pressed={agent.enabled}
                          >
                            {agent.enabled ? (
                              <ToggleRight className="h-4 w-4 text-green-600" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openAgentEditor('edit', agent)}
                            title="Edit"
                            aria-label={`Edit ${agent.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                    <div
                      className={cn(
                        'absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary/50 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity',
                        !agent.enabled && 'from-muted-foreground/30 to-muted-foreground/10'
                      )}
                    />
                  </Card>
                );
              })}
            </div>
            {visibleAgents.length < filteredAgents.length && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() =>
                    setAgentVisibleCount((count) =>
                      getNextVisibleCount(count, filteredAgents.length, AGENT_PAGE_SIZE)
                    )
                  }
                >
                  Show {Math.min(AGENT_PAGE_SIZE, filteredAgents.length - visibleAgents.length)}{' '}
                  more agents
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-4 rounded-full bg-primary/10 mb-4">
                <Bot className="h-8 w-8 text-primary/50" />
              </div>
              <p className="font-medium text-muted-foreground mb-1">
                {agentSearchQuery ? 'No matching agents' : 'No agents found'}
              </p>
              <p className="text-sm text-muted-foreground/70 max-w-xs mb-4">
                {agentSearchQuery
                  ? 'Try another name, tool, or model.'
                  : "Create custom agents to extend Claude's capabilities"}
              </p>
              {!agentSearchQuery && (
                <Button size="sm" onClick={() => openAgentEditor('create')} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Agent
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section id="skills">
        <div className="settings-section-headband">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Skills</h2>
            {skills && skills.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
                {activeSkillCount} active · {skillPackageCount} skills · {stylePresetCount} presets
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={skillImportInputRef}
              type="file"
              multiple
              accept=".md,.skill,.zip"
              className="hidden"
              onChange={(event) => handleSkillImportFiles(event.target.files)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => skillImportInputRef.current?.click()}
              disabled={importSkillsMutation.isPending}
              className="gap-1.5 h-8 px-3 text-xs"
              title="Import .md or .skill/.zip files"
            >
              {importSkillsMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Import
            </Button>
            <Button
              size="sm"
              onClick={() => openSkillEditor('create')}
              className="gap-1.5 h-8 px-3 text-xs bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>

        {skills && skills.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={skillSearchQuery}
                onChange={(event) => setSkillSearchQuery(event.target.value)}
                placeholder="Search skills, styles, and capabilities..."
                className="h-9 pl-9 pr-9"
              />
              {skillSearchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                  onClick={() => setSkillSearchQuery('')}
                  aria-label="Clear skill search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <Select
              value={skillStatusFilter}
              onValueChange={(value) => setSkillStatusFilter(value as SkillStatusFilter)}
            >
              <SelectTrigger className="h-9 w-full sm:w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All capabilities</SelectItem>
                <SelectItem value="active">Active context</SelectItem>
                <SelectItem value="on-demand">On demand</SelectItem>
              </SelectContent>
            </Select>
            <span className="shrink-0 px-1 text-xs text-muted-foreground">
              {filteredSkills.length} match{filteredSkills.length === 1 ? '' : 'es'}
            </span>
          </div>
        )}

        {skills && skills.length > 0 ? (
          filteredSkills.length > 0 ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleSkills.map((skill) => {
                  const baseName = skill.baseName || skill.name;
                  const isStylePreset = skill.entryType === 'style';
                  return (
                    <Card
                      key={skill.id}
                      className={cn(
                        'capability-card group relative overflow-hidden transition-all hover:shadow-md',
                        skill.enabled
                          ? 'hover:border-green-500/30'
                          : !isStylePreset && 'opacity-80 hover:opacity-100'
                      )}
                    >
                      <CardContent className="pt-5 pb-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              'p-2 rounded-lg shrink-0',
                              skill.enabled
                                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            <Wand2 className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <p className="font-semibold truncate">{skill.name}</p>
                              {!skill.enabled && !isStylePreset && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 shrink-0">
                                  On demand
                                </span>
                              )}
                              {isStylePreset && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 shrink-0">
                                  Style preset
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0 capitalize">
                                {skill.libraryKind}
                              </span>
                              {skill.model && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                  {skill.model}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {skill.description || 'No description'}
                            </p>
                            {skill.allowedTools && skill.allowedTools.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {skill.allowedTools.map((tool) => (
                                  <span
                                    key={tool}
                                    className="px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-600 dark:text-green-400"
                                  >
                                    {tool}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="capability-card-actions z-20 flex shrink-0 gap-1 transition-opacity">
                            {!isStylePreset && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => toggleSkillMutation.mutate(baseName)}
                                title={
                                  skill.enabled
                                    ? 'Move to on-demand catalog'
                                    : 'Expose in the global runtime context'
                                }
                                aria-label={
                                  skill.enabled
                                    ? `Move ${skill.name} to the on-demand catalog`
                                    : `Expose ${skill.name} in the global runtime context`
                                }
                                aria-pressed={skill.enabled}
                              >
                                {skill.enabled ? (
                                  <ToggleRight className="h-4 w-4 text-green-600" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openSkillEditor('edit', skill)}
                              title="Edit"
                              aria-label={`Edit ${skill.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                      <div
                        className={cn(
                          'absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-green-500/50 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity',
                          !skill.enabled &&
                            !isStylePreset &&
                            'from-muted-foreground/30 to-muted-foreground/10'
                        )}
                      />
                    </Card>
                  );
                })}
              </div>
              {visibleSkills.length < filteredSkills.length && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSkillVisibleCount((count) =>
                        getNextVisibleCount(count, filteredSkills.length, CAPABILITY_PAGE_SIZE)
                      )
                    }
                  >
                    Show{' '}
                    {Math.min(CAPABILITY_PAGE_SIZE, filteredSkills.length - visibleSkills.length)}{' '}
                    more capabilities
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <FolderSearch className="mb-3 h-7 w-7 text-muted-foreground/60" />
                <p className="font-medium text-muted-foreground">No matching capabilities</p>
                <p className="mt-1 text-sm text-muted-foreground/70">
                  Try another term or include on-demand skills.
                </p>
              </CardContent>
            </Card>
          )
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-4 rounded-full bg-green-500/10 mb-4">
                <Wand2 className="h-8 w-8 text-green-500/50" />
              </div>
              <p className="font-medium text-muted-foreground mb-1">No skills found</p>
              <p className="text-sm text-muted-foreground/70 max-w-xs mb-4">
                Create custom skills to add reusable capabilities
              </p>
              <Button
                size="sm"
                onClick={() => openSkillEditor('create')}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                <Plus className="h-4 w-4" />
                Create Skill
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      <AgentSkillEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        type={editorType}
        mode={editorMode}
        initialData={editingItem?.data}
        editName={editingItem?.name}
        configProvider={configProvider}
      />
    </>
  );
}
