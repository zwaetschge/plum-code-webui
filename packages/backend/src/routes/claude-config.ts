import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isValidGitHubRepo, isValidGitUrl, sanitizeShellArg } from '../utils/sanitize.js';
import { resolveConfigHome } from '../utils/configPaths.js';
import { importSkillIntoCatalog } from '../utils/skillImport.js';
import { listSkillLibrary, readSkillLibraryItem } from '../utils/skillLibrary.js';
import {
  buildFallbackDesignMd,
  importDesignMdPreset,
  serializeDesignMd,
} from '../utils/designMd.js';
import {
  ensureLeanSkillCatalog,
  findSkillDirectory,
  registerActiveSkill,
  setSkillRuntimeEnabled,
  unregisterSkill,
} from '../utils/leanSkillCatalog.js';

const router = Router();

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  filePath: string;
  source: 'user' | 'project';
  enabled: boolean;
}

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  dirPath: string;
  source: 'user' | 'marketplace';
  enabled: boolean;
  marketplace?: string;
  installPath?: string;
  installedAt?: string;
}

interface MarketplaceInfo {
  id: string;
  name: string;
  source: {
    source: 'github' | 'git';
    repo?: string;
    url?: string;
  };
  installLocation: string;
  lastUpdated: string;
  plugins?: MarketplacePluginInfo[];
}

interface MarketplacePluginInfo {
  name: string;
  description: string;
  version: string;
  author?: { name: string; email?: string };
  category?: string;
}

// Generate frontmatter from agent/skill data
function generateFrontmatter(data: Record<string, string | undefined>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== '') {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// Parse YAML frontmatter from markdown
function parseMarkdownFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const frontmatter: Record<string, string> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const yamlContent = content.substring(3, endIndex).trim();
      body = content.substring(endIndex + 3).trim();

      // Simple YAML parsing (key: value pairs)
      yamlContent.split('\n').forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          frontmatter[key] = value;
        }
      });
    }
  }

  return { frontmatter, body };
}

// Sanitize filename to prevent path traversal
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 100);
}

// Ensure directory exists
async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

// Read agents from a directory
async function readAgentsFromDir(dir: string, source: 'user' | 'project'): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [];

  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      // Check for both enabled (.md) and disabled (.md.disabled) files
      const isDisabled = file.endsWith('.md.disabled');
      const isEnabled = file.endsWith('.md') && !isDisabled;

      if (!isEnabled && !isDisabled) continue;

      const filePath = path.join(dir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { frontmatter, body } = parseMarkdownFrontmatter(content);

        const baseName = file.replace('.md.disabled', '').replace('.md', '');
        const name = frontmatter.name || baseName;
        agents.push({
          id: `${source}-${baseName}`,
          name,
          description: frontmatter.description || body.substring(0, 200),
          tools: frontmatter.tools?.split(',').map((t) => t.trim()),
          model: frontmatter.model,
          filePath,
          source,
          enabled: isEnabled,
        });
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return agents;
}

// GET /api/claude-config/agents - List all agents
router.get('/agents', requireAuth, async (req, res) => {
  const configHome = resolveConfigHome(req.query.provider);
  const userAgentsDir = path.join(configHome, 'agents');

  const userAgents = await readAgentsFromDir(userAgentsDir, 'user');

  res.json({
    success: true,
    data: userAgents,
  });
});

// GET /api/claude-config/skills - Search the active and on-demand skill catalog.
router.get('/skills', requireAuth, async (req, res) => {
  const configHome = resolveConfigHome(req.query.provider);
  const library = String(req.query.library || 'skill');
  const kind =
    library === 'all'
      ? undefined
      : library === 'design' || library === 'writing'
        ? library
        : 'skill';
  const query = String(req.query.query || '')
    .trim()
    .toLowerCase();
  const status = String(req.query.status || 'all');
  let userSkills = await listSkillLibrary(configHome, { kind });
  if (status === 'active') userSkills = userSkills.filter((skill) => skill.enabled);
  if (status === 'on-demand') userSkills = userSkills.filter((skill) => !skill.enabled);
  if (query) {
    userSkills = userSkills.filter((skill) =>
      [skill.name, skill.baseName, skill.description, skill.libraryKind, ...(skill.aliases || [])]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }

  res.json({
    success: true,
    data: userSkills,
  });
});

// GET /api/claude-config/style-library - List session-selectable style templates
router.get('/style-library', requireAuth, async (req, res) => {
  const configHome = resolveConfigHome(req.query.provider);
  const [designStyles, writingStyles] = await Promise.all([
    listSkillLibrary(configHome, { kind: 'design' }),
    listSkillLibrary(configHome, { kind: 'writing' }),
  ]);

  res.json({
    success: true,
    data: {
      designStyles,
      writingStyles,
    },
  });
});

const designMdUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    cb(null, lower === 'design.md' || lower.endsWith('.design.md') || lower.endsWith('.md'));
  },
});

// POST /api/claude-config/style-library/design-md/import - Import DESIGN.md as a design preset.
router.post(
  '/style-library/design-md/import',
  requireAuth,
  requireAdmin,
  designMdUpload.single('file'),
  async (req, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No DESIGN.md file provided (field name: file)' },
      });
    }

    const conflict = String(req.query.conflict || 'skip') === 'overwrite' ? 'overwrite' : 'skip';
    const configHome = resolveConfigHome(req.query.provider);
    const result = await importDesignMdPreset(file.buffer, file.originalname, configHome, {
      conflict,
    });

    res.json({
      success: true,
      data: result,
    });
  }
);

// GET /api/claude-config/style-library/design/:name/design-md - Export a design preset as DESIGN.md.
router.get('/style-library/design/:name/design-md', requireAuth, async (req, res) => {
  const configHome = resolveConfigHome(req.query.provider);
  const name = req.params.name;
  if (!name) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Design style name missing' },
    });
  }

  const style = await readSkillLibraryItem(configHome, name, {
    includeDisabled: true,
  });

  if (!style || style.libraryKind !== 'design') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Design style not found' },
    });
  }

  const content = style.designMd
    ? serializeDesignMd(style.designMd)
    : buildFallbackDesignMd({
        baseName: style.baseName,
        name: style.name,
        description: style.description,
        content: style.content,
      });
  const filename = `${style.baseName}-DESIGN.md`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

// GET /api/claude-config/agent/:name - Get agent content
router.get('/agent/:name', requireAuth, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const agentsDir = path.join(configHome, 'agents');

  // Try both enabled and disabled paths
  let filePath = path.join(agentsDir, `${name}.md`);
  let enabled = true;

  try {
    await fs.access(filePath);
  } catch {
    filePath = path.join(agentsDir, `${name}.md.disabled`);
    enabled = false;
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    res.json({
      success: true,
      data: {
        name: frontmatter.name || name,
        description: frontmatter.description || '',
        tools: frontmatter.tools?.split(',').map((t) => t.trim()),
        model: frontmatter.model,
        prompt: body,
        filePath,
        enabled,
      },
    });
  } catch {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Agent not found' },
    });
  }
});

// POST /api/claude-config/agents - Create new agent
router.post('/agents', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, tools, model, prompt } = req.body;

  if (!name || !prompt) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name and prompt are required' },
    });
  }

  const configHome = resolveConfigHome(req.query.provider);
  const agentsDir = path.join(configHome, 'agents');
  await ensureDir(agentsDir);

  const sanitizedName = sanitizeFilename(name);
  const filePath = path.join(agentsDir, `${sanitizedName}.md`);

  // Check if agent already exists
  try {
    await fs.access(filePath);
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Agent with this name already exists' },
    });
  } catch {
    // File doesn't exist, we can create it
  }

  const frontmatter = generateFrontmatter({
    name,
    description,
    tools: tools?.join(', '),
    model,
  });

  const content = `${frontmatter}\n\n${prompt}`;
  await fs.writeFile(filePath, content, 'utf-8');

  res.json({
    success: true,
    data: {
      id: `user-${sanitizedName}`,
      name,
      description,
      tools,
      model,
      filePath,
      source: 'user',
      enabled: true,
    },
  });
});

// PUT /api/claude-config/agent/:name - Update agent
router.put('/agent/:name', requireAuth, requireAdmin, async (req, res) => {
  const paramName = req.params.name ?? '';
  const { name, description, tools, model, prompt } = req.body;

  const configHome = resolveConfigHome(req.query.provider);
  const agentsDir = path.join(configHome, 'agents');

  // Find existing file (enabled or disabled)
  let oldFilePath = path.join(agentsDir, `${paramName}.md`);
  let wasEnabled = true;

  try {
    await fs.access(oldFilePath);
  } catch {
    oldFilePath = path.join(agentsDir, `${paramName}.md.disabled`);
    wasEnabled = false;
    try {
      await fs.access(oldFilePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }
  }

  const frontmatter = generateFrontmatter({
    name: name || paramName,
    description,
    tools: tools?.join(', '),
    model,
  });

  const content = `${frontmatter}\n\n${prompt}`;

  // If name changed, rename the file
  const sanitizedName = sanitizeFilename(name || paramName);
  const extension = wasEnabled ? '.md' : '.md.disabled';
  const newFilePath = path.join(agentsDir, `${sanitizedName}${extension}`);

  if (oldFilePath !== newFilePath) {
    await fs.unlink(oldFilePath);
  }

  await fs.writeFile(newFilePath, content, 'utf-8');

  res.json({
    success: true,
    data: {
      id: `user-${sanitizedName}`,
      name: name || paramName,
      description,
      tools,
      model,
      filePath: newFilePath,
      source: 'user',
      enabled: wasEnabled,
    },
  });
});

// PUT /api/claude-config/agent/:name/toggle - Toggle agent enabled state
router.put('/agent/:name/toggle', requireAuth, requireAdmin, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const agentsDir = path.join(configHome, 'agents');

  const enabledPath = path.join(agentsDir, `${name}.md`);
  const disabledPath = path.join(agentsDir, `${name}.md.disabled`);

  try {
    await fs.access(enabledPath);
    // Currently enabled, disable it
    await fs.rename(enabledPath, disabledPath);
    res.json({ success: true, data: { enabled: false } });
  } catch {
    try {
      await fs.access(disabledPath);
      // Currently disabled, enable it
      await fs.rename(disabledPath, enabledPath);
      res.json({ success: true, data: { enabled: true } });
    } catch {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }
  }
});

// DELETE /api/claude-config/agent/:name - Delete agent
router.delete('/agent/:name', requireAuth, requireAdmin, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const agentsDir = path.join(configHome, 'agents');

  // Try both enabled and disabled paths
  const enabledPath = path.join(agentsDir, `${name}.md`);
  const disabledPath = path.join(agentsDir, `${name}.md.disabled`);

  let deleted = false;

  try {
    await fs.unlink(enabledPath);
    deleted = true;
  } catch {
    try {
      await fs.unlink(disabledPath);
      deleted = true;
    } catch {
      // Neither file exists
    }
  }

  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Agent not found' },
    });
  }
});

// GET /api/claude-config/skill/:name - Get skill content
router.get('/skill/:name', requireAuth, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const location = await findSkillDirectory(configHome, name);
  const skillDir = location?.dirPath || '';
  const enabled = location?.enabled ?? false;

  const skillFile = path.join(skillDir, 'SKILL.md');

  try {
    const content = await fs.readFile(skillFile, 'utf-8');
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    res.json({
      success: true,
      data: {
        name: frontmatter.name || name,
        description: frontmatter.description || '',
        allowedTools: frontmatter['allowed-tools']?.split(',').map((t) => t.trim()),
        model: frontmatter.model,
        content: body,
        dirPath: skillDir,
        enabled,
      },
    });
  } catch {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Skill not found' },
    });
  }
});

// POST /api/claude-config/skills - Create new skill
router.post('/skills', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, allowedTools, model, content: prompt } = req.body;

  if (!name || !prompt) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name and content are required' },
    });
  }

  const configHome = resolveConfigHome(req.query.provider);
  const skillsDir = path.join(configHome, 'skills');
  const sanitizedName = sanitizeFilename(name);
  const skillDir = path.join(skillsDir, sanitizedName);

  // Check if skill already exists
  if (await findSkillDirectory(configHome, sanitizedName)) {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Skill with this name already exists' },
    });
  }

  await ensureDir(skillDir);

  const frontmatter = generateFrontmatter({
    name,
    description,
    'allowed-tools': allowedTools?.join(', '),
    model,
  });

  const content = `${frontmatter}\n\n${prompt}`;
  const skillFile = path.join(skillDir, 'SKILL.md');
  await fs.writeFile(skillFile, content, 'utf-8');
  await registerActiveSkill(configHome, sanitizedName);

  res.json({
    success: true,
    data: {
      id: `user-${sanitizedName}`,
      name,
      description,
      allowedTools,
      model,
      dirPath: skillDir,
      source: 'user',
      enabled: true,
    },
  });
});

// PUT /api/claude-config/skill/:name - Update skill
router.put('/skill/:name', requireAuth, requireAdmin, async (req, res) => {
  const paramName = req.params.name ?? '';
  const { name, description, allowedTools, model, content: prompt } = req.body;

  const configHome = resolveConfigHome(req.query.provider);
  const location = await findSkillDirectory(configHome, paramName);
  if (!location) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Skill not found' },
    });
  }
  const oldSkillDir = location.dirPath;
  const wasEnabled = location.enabled;

  const frontmatter = generateFrontmatter({
    name: name || paramName,
    description,
    'allowed-tools': allowedTools?.join(', '),
    model,
  });

  const content = `${frontmatter}\n\n${prompt}`;

  // If name changed, rename the directory
  const sanitizedName = sanitizeFilename(name || paramName);
  const newSkillDir = path.join(path.dirname(oldSkillDir), sanitizedName);

  if (oldSkillDir !== newSkillDir) {
    await fs.rename(oldSkillDir, newSkillDir);
    await unregisterSkill(configHome, paramName);
    if (wasEnabled) await registerActiveSkill(configHome, sanitizedName);
  }

  const skillFile = path.join(newSkillDir, 'SKILL.md');
  await fs.writeFile(skillFile, content, 'utf-8');

  res.json({
    success: true,
    data: {
      id: `user-${sanitizedName}`,
      name: name || paramName,
      description,
      allowedTools,
      model,
      dirPath: newSkillDir,
      source: 'user',
      enabled: wasEnabled,
    },
  });
});

// PUT /api/claude-config/skill/:name/toggle - Toggle skill enabled state
router.put('/skill/:name/toggle', requireAuth, requireAdmin, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const location = await findSkillDirectory(configHome, name);
  if (!location) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Skill not found' },
    });
  }
  if (!location.runtimeConfigurable) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'STYLE_PRESET_NOT_TOGGLEABLE',
        message: 'Style presets are selected per session and are not runtime skills',
      },
    });
  }
  const enabled = !location.enabled;
  await setSkillRuntimeEnabled(configHome, name, enabled);
  res.json({ success: true, data: { enabled } });
});

// DELETE /api/claude-config/skill/:name - Delete skill
router.delete('/skill/:name', requireAuth, requireAdmin, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const location = await findSkillDirectory(configHome, name);
  const deleted = !!location;
  if (location) {
    await fs.rm(location.dirPath, { recursive: true, force: true });
    await unregisterSkill(configHome, name);
  }

  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Skill not found' },
    });
  }
});

// POST /api/claude-config/skills/import - Import skill files (.md or .skill/.zip archives)
const skillImportUpload = multer({
  storage: multer.memoryStorage(),
  // Skills are small markdown docs; 5MB per file is generous and stops accidental
  // uploads of unrelated large files.
  limits: { fileSize: 5 * 1024 * 1024, files: 200 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.skill') || lower.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

router.post(
  '/skills/import',
  requireAuth,
  requireAdmin,
  skillImportUpload.array('files', 200),
  async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILES', message: 'No skill files provided (field name: files)' },
      });
    }

    const conflict = String(req.query.conflict || 'skip') === 'overwrite' ? 'overwrite' : 'skip';
    const configHome = resolveConfigHome(req.query.provider);

    const imported: Array<{ name: string; dirPath: string }> = [];
    const skipped: Array<{ file: string; skillName?: string; reason: string }> = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const f of files) {
      try {
        const result = await importSkillIntoCatalog(f.buffer, f.originalname, configHome, {
          conflict,
        });
        if (result.status === 'imported') {
          imported.push({ name: result.skill.name, dirPath: result.skill.dirPath });
        } else {
          skipped.push({
            file: f.originalname,
            skillName: result.skillName,
            reason: result.reason,
          });
        }
      } catch (err) {
        errors.push({
          file: f.originalname,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await ensureLeanSkillCatalog(configHome);

    res.json({ success: true, data: { imported, skipped, errors } });
  }
);

// ============== PLUGINS ==============

// Read user-created plugins from ~/.claude/plugins/user/
async function readUserPlugins(configHome: string): Promise<PluginInfo[]> {
  const userPluginsDir = path.join(configHome, 'plugins', 'user');
  const plugins: PluginInfo[] = [];

  try {
    const entries = await fs.readdir(userPluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check if plugin is disabled (folder name ends with .disabled)
      const isDisabled = entry.name.endsWith('.disabled');
      const baseName = entry.name.replace('.disabled', '');

      const pluginDir = path.join(userPluginsDir, entry.name);
      const pluginFile = path.join(pluginDir, 'PLUGIN.md');

      try {
        const content = await fs.readFile(pluginFile, 'utf-8');
        const { frontmatter, body } = parseMarkdownFrontmatter(content);

        const name = frontmatter.name || baseName;
        plugins.push({
          id: `user-${baseName}`,
          name,
          description: frontmatter.description || body.substring(0, 200),
          version: frontmatter.version || '1.0.0',
          author: frontmatter.author,
          category: frontmatter.category,
          dirPath: pluginDir,
          source: 'user',
          enabled: !isDisabled,
        });
      } catch {
        // No PLUGIN.md or can't read it
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return plugins;
}

// Read marketplace-installed plugins
async function readMarketplacePlugins(configHome: string): Promise<PluginInfo[]> {
  const pluginsFile = path.join(configHome, 'plugins', 'installed_plugins.json');
  const plugins: PluginInfo[] = [];

  try {
    const content = await fs.readFile(pluginsFile, 'utf-8');
    const data = JSON.parse(content);

    if (data.plugins) {
      for (const [pluginId, installations] of Object.entries(data.plugins)) {
        const parts = pluginId.split('@');
        const name = parts[0] || pluginId;
        const marketplace = parts[1] || 'unknown';
        const installs = installations as Array<{
          version: string;
          installPath: string;
          installedAt: string;
        }>;

        if (installs.length > 0) {
          const install = installs[0];
          if (install) {
            plugins.push({
              id: pluginId,
              name,
              description: '',
              version: install.version,
              dirPath: install.installPath,
              source: 'marketplace',
              enabled: true, // Marketplace plugins are always enabled by default
              marketplace,
              installPath: install.installPath,
              installedAt: install.installedAt,
            });
          }
        }
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return plugins;
}

// Combined function to get all plugins
async function readAllPlugins(configHome: string): Promise<PluginInfo[]> {
  const [userPlugins, marketplacePlugins] = await Promise.all([
    readUserPlugins(configHome),
    readMarketplacePlugins(configHome),
  ]);
  return [...userPlugins, ...marketplacePlugins];
}

// Read known marketplaces
async function readMarketplaces(configHome: string): Promise<MarketplaceInfo[]> {
  const marketplacesFile = path.join(configHome, 'plugins', 'known_marketplaces.json');
  const marketplaces: MarketplaceInfo[] = [];

  try {
    const content = await fs.readFile(marketplacesFile, 'utf-8');
    const data = JSON.parse(content);

    for (const [id, info] of Object.entries(data)) {
      const mpInfo = info as {
        source: { source: 'github' | 'git'; repo?: string; url?: string };
        installLocation: string;
        lastUpdated: string;
      };

      const marketplace: MarketplaceInfo = {
        id,
        name: id,
        source: mpInfo.source,
        installLocation: mpInfo.installLocation,
        lastUpdated: mpInfo.lastUpdated,
      };

      // Try to read marketplace.json for plugin list
      // Check both .claude-plugin/marketplace.json and root marketplace.json
      try {
        let mpJsonPath = path.join(mpInfo.installLocation, '.claude-plugin', 'marketplace.json');
        let mpContent: string;
        try {
          mpContent = await fs.readFile(mpJsonPath, 'utf-8');
        } catch {
          // Fallback to root marketplace.json
          mpJsonPath = path.join(mpInfo.installLocation, 'marketplace.json');
          mpContent = await fs.readFile(mpJsonPath, 'utf-8');
        }
        const mpData = JSON.parse(mpContent);
        marketplace.plugins = mpData.plugins || [];
      } catch {
        // No marketplace.json
      }

      marketplaces.push(marketplace);
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return marketplaces;
}

// GET /api/claude-config/plugins - List all plugins (user + marketplace)
router.get('/plugins', requireAuth, async (req, res) => {
  const configHome = resolveConfigHome(req.query.provider);
  const plugins = await readAllPlugins(configHome);

  res.json({
    success: true,
    data: plugins,
  });
});

// GET /api/claude-config/plugin/:name - Get plugin content
router.get('/plugin/:name', requireAuth, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const userPluginsDir = path.join(configHome, 'plugins', 'user');

  // Try both enabled and disabled paths
  let pluginDir = path.join(userPluginsDir, name);
  let enabled = true;

  try {
    await fs.access(pluginDir);
  } catch {
    pluginDir = path.join(userPluginsDir, `${name}.disabled`);
    enabled = false;
  }

  const pluginFile = path.join(pluginDir, 'PLUGIN.md');

  try {
    const content = await fs.readFile(pluginFile, 'utf-8');
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    res.json({
      success: true,
      data: {
        name: frontmatter.name || name,
        description: frontmatter.description || '',
        version: frontmatter.version || '1.0.0',
        author: frontmatter.author,
        category: frontmatter.category,
        content: body,
        dirPath: pluginDir,
        enabled,
      },
    });
  } catch {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Plugin not found' },
    });
  }
});

// POST /api/claude-config/plugins - Create new plugin
router.post('/plugins', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, version, author, category, content: prompt } = req.body;

  if (!name || !prompt) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name and content are required' },
    });
  }

  const configHome = resolveConfigHome(req.query.provider);
  const userPluginsDir = path.join(configHome, 'plugins', 'user');
  const sanitizedName = sanitizeFilename(name);
  const pluginDir = path.join(userPluginsDir, sanitizedName);

  // Check if plugin already exists
  try {
    await fs.access(pluginDir);
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Plugin with this name already exists' },
    });
  } catch {
    // Directory doesn't exist, we can create it
  }

  await ensureDir(pluginDir);

  const frontmatter = generateFrontmatter({
    name,
    description,
    version: version || '1.0.0',
    author,
    category,
  });

  const content = `${frontmatter}\n\n${prompt}`;
  const pluginFile = path.join(pluginDir, 'PLUGIN.md');
  await fs.writeFile(pluginFile, content, 'utf-8');

  res.json({
    success: true,
    data: {
      id: `user-${sanitizedName}`,
      name,
      description,
      version: version || '1.0.0',
      author,
      category,
      dirPath: pluginDir,
      source: 'user',
      enabled: true,
    },
  });
});

// PUT /api/claude-config/plugin/:name - Update plugin
router.put('/plugin/:name', requireAuth, requireAdmin, async (req, res) => {
  const paramName = req.params.name ?? '';
  const { name, description, version, author, category, content: prompt } = req.body;

  const configHome = resolveConfigHome(req.query.provider);
  const userPluginsDir = path.join(configHome, 'plugins', 'user');

  // Find existing directory (enabled or disabled)
  let oldPluginDir = path.join(userPluginsDir, paramName);
  let wasEnabled = true;

  try {
    await fs.access(oldPluginDir);
  } catch {
    oldPluginDir = path.join(userPluginsDir, `${paramName}.disabled`);
    wasEnabled = false;
    try {
      await fs.access(oldPluginDir);
    } catch {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plugin not found' },
      });
    }
  }

  const frontmatter = generateFrontmatter({
    name: name || paramName,
    description,
    version: version || '1.0.0',
    author,
    category,
  });

  const content = `${frontmatter}\n\n${prompt}`;

  // If name changed, rename the directory
  const sanitizedName = sanitizeFilename(name || paramName);
  const suffix = wasEnabled ? '' : '.disabled';
  const newPluginDir = path.join(userPluginsDir, `${sanitizedName}${suffix}`);

  if (oldPluginDir !== newPluginDir) {
    await fs.rename(oldPluginDir, newPluginDir);
  }

  const pluginFile = path.join(newPluginDir, 'PLUGIN.md');
  await fs.writeFile(pluginFile, content, 'utf-8');

  res.json({
    success: true,
    data: {
      id: `user-${sanitizedName}`,
      name: name || paramName,
      description,
      version: version || '1.0.0',
      author,
      category,
      dirPath: newPluginDir,
      source: 'user',
      enabled: wasEnabled,
    },
  });
});

// PUT /api/claude-config/plugin/:name/toggle - Toggle plugin enabled state
router.put('/plugin/:name/toggle', requireAuth, requireAdmin, async (req, res) => {
  const name = req.params.name ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const userPluginsDir = path.join(configHome, 'plugins', 'user');

  const enabledPath = path.join(userPluginsDir, name);
  const disabledPath = path.join(userPluginsDir, `${name}.disabled`);

  try {
    await fs.access(enabledPath);
    // Currently enabled, disable it
    await fs.rename(enabledPath, disabledPath);
    res.json({ success: true, data: { enabled: false } });
  } catch {
    try {
      await fs.access(disabledPath);
      // Currently disabled, enable it
      await fs.rename(disabledPath, enabledPath);
      res.json({ success: true, data: { enabled: true } });
    } catch {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plugin not found' },
      });
    }
  }
});

// GET /api/claude-config/marketplaces - List known marketplaces
router.get('/marketplaces', requireAuth, async (req, res) => {
  const configHome = resolveConfigHome(req.query.provider);
  const marketplaces = await readMarketplaces(configHome);

  res.json({
    success: true,
    data: marketplaces,
  });
});

// POST /api/claude-config/marketplaces - Add a new marketplace
router.post('/marketplaces', requireAuth, requireAdmin, async (req, res) => {
  const { name, source, repo, url } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
    });
  }

  if (source !== 'github' && source !== 'git') {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Source must be "github" or "git"' },
    });
  }

  if (source === 'github' && !repo) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'GitHub repo is required for github source' },
    });
  }

  // Validate GitHub repo format to prevent command injection
  if (source === 'github' && repo && !isValidGitHubRepo(repo)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid GitHub repository format. Use owner/repo format.',
      },
    });
  }

  if (source === 'git' && !url) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'URL is required for git source' },
    });
  }

  // Validate git URL to prevent SSRF and command injection
  if (source === 'git' && url && !isValidGitUrl(url)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid git URL. Only HTTPS URLs to public hosts are allowed.',
      },
    });
  }

  const configHome = resolveConfigHome(req.query.provider);
  const pluginsDir = path.join(configHome, 'plugins');
  const marketplacesFile = path.join(pluginsDir, 'known_marketplaces.json');
  const sanitizedName = sanitizeFilename(name);
  const installLocation = path.join(pluginsDir, 'marketplaces', sanitizedName);

  await ensureDir(pluginsDir);
  await ensureDir(path.join(pluginsDir, 'marketplaces'));

  // Read existing marketplaces
  let marketplaces: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(marketplacesFile, 'utf-8');
    marketplaces = JSON.parse(content);
  } catch {
    // File doesn't exist yet
  }

  // Check if marketplace already exists
  if (marketplaces[sanitizedName]) {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Marketplace with this name already exists' },
    });
  }

  // Clone/fetch the marketplace repository
  try {
    await ensureDir(installLocation);

    // Build and sanitize the git URL (defense in depth - validation already happened above)
    const rawGitUrl = source === 'github' ? `https://github.com/${repo}.git` : url;
    const gitUrl = sanitizeShellArg(rawGitUrl);

    // Clone the repository using spawn with array args to prevent shell injection
    const { spawnSync } = await import('child_process');
    const result = spawnSync('git', ['clone', '--depth', '1', gitUrl, installLocation], {
      stdio: 'pipe',
      timeout: 60000,
    });

    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || 'Git clone failed');
    }

    // Add to known_marketplaces.json
    marketplaces[sanitizedName] = {
      source: source === 'github' ? { source: 'github', repo } : { source: 'git', url },
      installLocation,
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(marketplacesFile, JSON.stringify(marketplaces, null, 2), 'utf-8');

    // Read the marketplace.json if it exists
    let plugins: MarketplacePluginInfo[] = [];
    try {
      const mpJsonPath = path.join(installLocation, 'marketplace.json');
      const mpContent = await fs.readFile(mpJsonPath, 'utf-8');
      const mpData = JSON.parse(mpContent);
      plugins = mpData.plugins || [];
    } catch {
      // No marketplace.json
    }

    res.json({
      success: true,
      data: {
        id: sanitizedName,
        name: sanitizedName,
        source: source === 'github' ? { source: 'github', repo } : { source: 'git', url },
        installLocation,
        lastUpdated: new Date().toISOString(),
        plugins,
      },
    });
  } catch (error) {
    // Clean up on failure
    try {
      await fs.rm(installLocation, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'CLONE_ERROR',
        message: `Failed to clone repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    });
  }
});

// POST /api/claude-config/marketplace/:id/refresh - Refresh a marketplace
router.post('/marketplace/:id/refresh', requireAuth, requireAdmin, async (req, res) => {
  const marketplaceId = req.params.id ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const marketplacesFile = path.join(configHome, 'plugins', 'known_marketplaces.json');

  try {
    const content = await fs.readFile(marketplacesFile, 'utf-8');
    const marketplaces = JSON.parse(content);

    if (!marketplaces[marketplaceId]) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Marketplace not found' },
      });
    }

    const mpInfo = marketplaces[marketplaceId];
    const installLocation = mpInfo.installLocation;

    // Pull latest changes
    const { execSync } = await import('child_process');
    execSync('git pull --ff-only', {
      cwd: installLocation,
      stdio: 'pipe',
      timeout: 60000,
    });

    // Update lastUpdated
    marketplaces[marketplaceId].lastUpdated = new Date().toISOString();
    await fs.writeFile(marketplacesFile, JSON.stringify(marketplaces, null, 2), 'utf-8');

    // Read the marketplace.json
    // Check both .claude-plugin/marketplace.json and root marketplace.json
    let plugins: MarketplacePluginInfo[] = [];
    try {
      let mpJsonPath = path.join(installLocation, '.claude-plugin', 'marketplace.json');
      let mpContent: string;
      try {
        mpContent = await fs.readFile(mpJsonPath, 'utf-8');
      } catch {
        mpJsonPath = path.join(installLocation, 'marketplace.json');
        mpContent = await fs.readFile(mpJsonPath, 'utf-8');
      }
      const mpData = JSON.parse(mpContent);
      plugins = mpData.plugins || [];
    } catch {
      // No marketplace.json
    }

    res.json({
      success: true,
      data: {
        id: marketplaceId,
        name: marketplaceId,
        source: mpInfo.source,
        installLocation,
        lastUpdated: marketplaces[marketplaceId].lastUpdated,
        plugins,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'REFRESH_ERROR',
        message: `Failed to refresh marketplace: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    });
  }
});

// DELETE /api/claude-config/marketplace/:id - Remove a marketplace
router.delete('/marketplace/:id', requireAuth, requireAdmin, async (req, res) => {
  const marketplaceId = req.params.id ?? '';
  const configHome = resolveConfigHome(req.query.provider);
  const marketplacesFile = path.join(configHome, 'plugins', 'known_marketplaces.json');

  try {
    const content = await fs.readFile(marketplacesFile, 'utf-8');
    const marketplaces = JSON.parse(content);

    if (!marketplaces[marketplaceId]) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Marketplace not found' },
      });
    }

    const installLocation = marketplaces[marketplaceId].installLocation;

    // Remove the marketplace directory
    try {
      await fs.rm(installLocation, { recursive: true });
    } catch {
      // Directory might not exist
    }

    // Remove from known_marketplaces.json
    delete marketplaces[marketplaceId];
    await fs.writeFile(marketplacesFile, JSON.stringify(marketplaces, null, 2), 'utf-8');

    res.json({ success: true });
  } catch {
    res.status(500).json({
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete marketplace' },
    });
  }
});

// POST /api/claude-config/plugins/install - Install a plugin from a marketplace
router.post('/plugins/install', requireAuth, requireAdmin, async (req, res) => {
  const { pluginName, marketplaceId } = req.body;

  if (!pluginName || !marketplaceId) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Plugin name and marketplace ID are required' },
    });
  }

  const configHome = resolveConfigHome(req.query.provider);
  const pluginsDir = path.join(configHome, 'plugins');
  const marketplacesFile = path.join(pluginsDir, 'known_marketplaces.json');
  const installedPluginsFile = path.join(pluginsDir, 'installed_plugins.json');

  try {
    // Read marketplace info
    const mpContent = await fs.readFile(marketplacesFile, 'utf-8');
    const marketplaces = JSON.parse(mpContent);

    if (!marketplaces[marketplaceId]) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Marketplace not found' },
      });
    }

    const mpInfo = marketplaces[marketplaceId];
    const mpInstallLocation = mpInfo.installLocation;

    // Read marketplace.json to find plugin info
    const mpJsonPath = path.join(mpInstallLocation, 'marketplace.json');
    const mpJsonContent = await fs.readFile(mpJsonPath, 'utf-8');
    const mpData = JSON.parse(mpJsonContent);

    const pluginInfo = (mpData.plugins || []).find((p: { name: string }) => p.name === pluginName);

    if (!pluginInfo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plugin not found in marketplace' },
      });
    }

    // Determine plugin source path and install location
    const pluginSourcePath = path.join(mpInstallLocation, 'plugins', pluginName);
    const sanitizedPluginName = sanitizeFilename(pluginName);
    const pluginInstallPath = path.join(
      pluginsDir,
      'installed',
      marketplaceId,
      sanitizedPluginName
    );

    // Check if source plugin exists
    try {
      await fs.access(pluginSourcePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plugin directory not found in marketplace' },
      });
    }

    // Copy plugin to install location
    await ensureDir(path.join(pluginsDir, 'installed', marketplaceId));

    // Remove existing installation if any
    try {
      await fs.rm(pluginInstallPath, { recursive: true });
    } catch {
      // Doesn't exist
    }

    // Copy the plugin
    await fs.cp(pluginSourcePath, pluginInstallPath, { recursive: true });

    // Update installed_plugins.json
    let installedPlugins: {
      plugins: Record<string, Array<{ version: string; installPath: string; installedAt: string }>>;
    } = { plugins: {} };
    try {
      const ipContent = await fs.readFile(installedPluginsFile, 'utf-8');
      installedPlugins = JSON.parse(ipContent);
    } catch {
      // File doesn't exist
    }

    if (!installedPlugins.plugins) {
      installedPlugins.plugins = {};
    }

    const pluginId = `${pluginName}@${marketplaceId}`;
    installedPlugins.plugins[pluginId] = [
      {
        version: pluginInfo.version || '1.0.0',
        installPath: pluginInstallPath,
        installedAt: new Date().toISOString(),
      },
    ];

    await fs.writeFile(installedPluginsFile, JSON.stringify(installedPlugins, null, 2), 'utf-8');

    res.json({
      success: true,
      data: {
        id: pluginId,
        name: pluginName,
        description: pluginInfo.description || '',
        version: pluginInfo.version || '1.0.0',
        dirPath: pluginInstallPath,
        source: 'marketplace',
        enabled: true,
        marketplace: marketplaceId,
        installPath: pluginInstallPath,
        installedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INSTALL_ERROR',
        message: `Failed to install plugin: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    });
  }
});

// DELETE /api/claude-config/plugin/:id - Uninstall a plugin
router.delete('/plugin/:id', requireAuth, requireAdmin, async (req, res) => {
  const pluginId = decodeURIComponent(req.params.id ?? '');
  const configHome = resolveConfigHome(req.query.provider);

  // Check if it's a user plugin (id starts with 'user-')
  if (pluginId.startsWith('user-')) {
    const name = pluginId.replace('user-', '');
    const userPluginsDir = path.join(configHome, 'plugins', 'user');

    // Try both enabled and disabled paths
    const enabledPath = path.join(userPluginsDir, name);
    const disabledPath = path.join(userPluginsDir, `${name}.disabled`);

    let deleted = false;

    try {
      await fs.rm(enabledPath, { recursive: true });
      deleted = true;
    } catch {
      try {
        await fs.rm(disabledPath, { recursive: true });
        deleted = true;
      } catch {
        // Neither directory exists
      }
    }

    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plugin not found' },
      });
    }
    return;
  }

  // Handle marketplace plugin
  const pluginsFile = path.join(configHome, 'plugins', 'installed_plugins.json');

  try {
    const content = await fs.readFile(pluginsFile, 'utf-8');
    const data = JSON.parse(content);

    if (data.plugins && data.plugins[pluginId]) {
      // Remove the plugin's cache directory
      const installations = data.plugins[pluginId];
      for (const install of installations) {
        try {
          await fs.rm(install.installPath, { recursive: true });
        } catch {
          // Directory might not exist
        }
      }

      // Remove from installed_plugins.json
      delete data.plugins[pluginId];
      await fs.writeFile(pluginsFile, JSON.stringify(data, null, 2), 'utf-8');

      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plugin not found' },
      });
    }
  } catch {
    res.status(500).json({
      success: false,
      error: { code: 'READ_ERROR', message: 'Failed to read plugins file' },
    });
  }
});

export default router;
