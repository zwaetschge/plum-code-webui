import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, resolve, isAbsolute, sep } from 'path';
import { homedir } from 'os';
import type {
  Command,
  ParsedCommand,
  CommandExecutionResult,
  BuiltinCommandName,
  CLIProvider,
} from '@plum-code-webui/shared';
import { CLI_FORWARDED_COMMANDS } from '@plum-code-webui/shared';
import { listCodexFeatures } from '../utils/codexCli.js';
import { listSkillLibrary } from '../utils/skillLibrary.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';
import { AppError } from '../middleware/errorHandler.js';

export function resolveAllowedCommandPath(inputPath: string): string {
  const resolvedPath = resolve(inputPath);
  if (!isAllowedBasePath(resolvedPath)) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }
  return resolvedPath;
}

// Built-in command definitions (native WebUI handlers)
const BUILTIN_COMMAND_DEFS: Record<BuiltinCommandName, Omit<Command, 'name' | 'scope'>> = {
  help: {
    description: 'Show available commands',
    arguments: [],
  },
  clear: {
    description: 'Clear chat history (UI only)',
    arguments: [],
  },
  reset: {
    description: 'Alias for /clear — start a new conversation',
    arguments: [],
  },
  new: {
    description: 'Create a new session',
    arguments: [],
  },
  model: {
    description: 'Show or change the current model',
    arguments: ['model_name'],
  },
  status: {
    description: 'Show session status',
    arguments: [],
  },
  cost: {
    description: 'Show current token usage and cost',
    arguments: [],
  },
  context: {
    description: 'Show current context usage',
    arguments: [],
  },
  usage: {
    description: 'Show current token usage and provider limits',
    arguments: [],
  },
  compact: {
    description: 'Compact provider context when supported',
    arguments: [],
  },
  rename: {
    description: 'Rename the current session',
    arguments: ['name'],
  },
  copy: {
    description: 'Copy the last assistant response (or Nth-latest) to clipboard',
    arguments: ['N'],
  },
  export: {
    description: 'Export the current conversation as text',
    arguments: ['filename'],
  },
  resume: {
    description: 'Open the session picker to resume a conversation',
    arguments: [],
  },
  continue: {
    description: 'Alias for /resume',
    arguments: [],
  },
  theme: {
    description: 'Open appearance controls',
    arguments: [],
  },
  permissions: {
    description: 'Open permissions settings',
    arguments: [],
  },
  memory: {
    description: 'Open memory and instruction files',
    arguments: [],
  },
  mcp: {
    description: 'Show MCP server guidance for the active provider',
    arguments: [],
  },
  hooks: {
    description: 'Show permission hook status',
    arguments: [],
  },
  skills: {
    description: 'List shared skills available to sessions',
    arguments: [],
  },
  agents: {
    description: 'List shared agents available to sessions',
    arguments: [],
  },
  diff: {
    description: 'Show uncommitted git diff',
    arguments: [],
  },
  feedback: {
    description: 'Submit feedback about the WebUI',
    arguments: ['report'],
  },
  bug: {
    description: 'Alias for /feedback',
    arguments: ['report'],
  },
  doctor: {
    description: 'Diagnose and verify the WebUI installation',
    arguments: [],
  },
  features: {
    description: 'List Codex feature flags',
    arguments: [],
  },
  imagegen: {
    description: 'Run Codex image generation via $imagegen',
    arguments: ['prompt'],
  },
  goal: {
    description: 'Set, view, pause, resume, or clear a Codex task goal',
    arguments: ['objective|pause|resume|clear'],
  },
  subagents: {
    description: 'Show Codex subagent workflow guidance',
    arguments: [],
  },
  'web-search': {
    description: 'Show Codex web-search mode guidance',
    arguments: [],
  },
  auth: {
    description: 'Open the provider login flow',
    arguments: ['provider?'],
  },
  hermes: {
    description: 'Alias for opening the Codex provider login flow',
    arguments: ['auth|model'],
  },
};

// CLI-forwarded command descriptions (for /help listing and autocomplete)
const CLI_FORWARDED_DESCRIPTIONS: Record<string, string> = {
  btw: 'Ask a quick side question without adding to the conversation',
  debug: 'Enable debug logging and troubleshoot',
  effort:
    'Set the model effort level (none|minimal|low|medium|high|xhigh|max|ultra|ultracode|auto)',
  plan: 'Enter plan mode',
  init: 'Initialize project with an AGENTS.md guide',
  review: 'Review a pull request locally',
  recap: 'Generate a one-line session summary',
  'security-review': 'Analyze pending changes for security vulnerabilities',
  'add-dir': 'Add a working directory for file access',
  'claude-api': 'Load Claude API reference material',
  simplify: 'Review recently changed files for quality issues',
  batch: 'Orchestrate large-scale parallel changes',
  loop: 'Run a prompt repeatedly on an interval',
  proactive: 'Alias for /loop',
  'less-permission-prompts': 'Add allowlist to reduce permission prompts',
  insights: 'Generate session analysis report',
  stats: 'Visualize daily usage and streaks',
  schedule: 'Create, update, list, or run routines',
  routines: 'Alias for /schedule',
};

const PROVIDER_LABELS: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  zai: 'Z.AI Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
  kimi: 'Kimi Code',
  vibe: 'Mistral Vibe',
};

const OPENCODE_FORWARDED_COMMANDS = new Set(['init', 'review', 'security-review', 'plan']);

export class CommandService {
  private userCommandsDir: string;

  constructor() {
    this.userCommandsDir = join(homedir(), '.claude', 'commands');
  }

  // Parse command string into name and arguments
  parseCommand(input: string): ParsedCommand | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0]?.toLowerCase();
    if (!name) return null;

    return {
      name,
      args: parts.slice(1),
      rawArgs: parts.slice(1).join(' '),
    };
  }

  // Get all available commands (builtin + user + project)
  async getAvailableCommands(projectPath?: string): Promise<Command[]> {
    const commands: Command[] = [];

    // Add built-in commands
    for (const [name, def] of Object.entries(BUILTIN_COMMAND_DEFS)) {
      commands.push({
        name,
        scope: 'builtin',
        ...def,
      });
    }

    // Add user commands
    const userCommands = await this.loadCommandsFromDir(this.userCommandsDir, 'user');
    commands.push(...userCommands);

    // Add project commands if projectPath provided
    if (projectPath) {
      const allowedProjectPath = resolveAllowedCommandPath(projectPath);
      const projectCommandsDir = join(allowedProjectPath, '.claude', 'commands');
      const projectCommands = await this.loadCommandsFromDir(
        projectCommandsDir,
        'project',
        allowedProjectPath
      );
      commands.push(...projectCommands);
    }

    return commands;
  }

  private async listMarkdownBasenames(dir: string): Promise<string[]> {
    try {
      const stats = await stat(dir);
      if (!stats.isDirectory()) return [];
      const files = await readdir(dir);
      return files
        .filter((file) => file.endsWith('.md') && !file.endsWith('.md.disabled'))
        .map((file) => basename(file, '.md'))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private async listSkillNames(): Promise<string[]> {
    const skills = await listSkillLibrary(join(homedir(), '.claude'), {
      kind: 'skill',
      enabledOnly: true,
    });
    return skills.map((skill) => skill.baseName).sort((a, b) => a.localeCompare(b));
  }

  // Load commands from a directory
  private async loadCommandsFromDir(
    dir: string,
    scope: 'user' | 'project',
    projectPath?: string
  ): Promise<Command[]> {
    const commands: Command[] = [];

    try {
      const stats = await stat(dir);
      if (!stats.isDirectory()) return commands;

      const files = await readdir(dir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      for (const file of mdFiles) {
        const content = await readFile(join(dir, file), 'utf-8');
        const command = this.parseCommandFile(file, content, scope, projectPath);
        if (command) {
          commands.push(command);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return commands;
  }

  // Parse a command file with YAML frontmatter
  private parseCommandFile(
    filename: string,
    content: string,
    scope: 'user' | 'project',
    projectPath?: string
  ): Command | null {
    const name = basename(filename, '.md');

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (frontmatterMatch && frontmatterMatch[1] && frontmatterMatch[2]) {
      const yamlContent = frontmatterMatch[1];
      const templateContent = frontmatterMatch[2].trim();

      // Simple YAML parsing for our use case
      const description =
        this.extractYamlValue(yamlContent, 'description') ?? `Custom command: ${name}`;
      const argsStr = this.extractYamlValue(yamlContent, 'arguments');
      const args = argsStr ? this.parseYamlArray(argsStr) : [];

      return {
        name,
        description,
        arguments: args,
        scope,
        content: templateContent,
        projectPath,
      };
    }

    // No frontmatter, use entire content as template
    return {
      name,
      description: `Custom command: ${name}`,
      scope,
      content: content.trim(),
      projectPath,
    };
  }

  // Extract a value from YAML
  private extractYamlValue(yaml: string, key: string): string | null {
    const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    const match = yaml.match(regex);
    return match && match[1] ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  }

  // Parse a YAML array (simple format: ["a", "b"])
  private parseYamlArray(str: string): string[] {
    const match = str.match(/^\[(.+)\]$/);
    if (!match || !match[1]) return [];
    return match[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
  }

  // Execute a command
  async executeCommand(
    parsed: ParsedCommand,
    context: {
      projectPath?: string;
      sessionId?: string;
      currentModel?: string;
      provider?: CLIProvider;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        totalTokens?: number;
        contextWindow?: number;
        contextUsedPercent?: number;
        cost: number;
      };
    }
  ): Promise<CommandExecutionResult> {
    // Check built-in commands first (WebUI-native handlers)
    if (parsed.name in BUILTIN_COMMAND_DEFS) {
      if (parsed.name === 'auth' || parsed.name === 'hermes') {
        return this.executeAuthCommand(parsed);
      }
      return this.executeBuiltinCommand(parsed.name as BuiltinCommandName, parsed, context);
    }

    // Check CLI-forwarded commands (Claude Code CLI handles these natively)
    if ((CLI_FORWARDED_COMMANDS as readonly string[]).includes(parsed.name)) {
      const provider = context.provider || 'codex';
      if (provider === 'codex' && parsed.name === 'review') {
        const rawCommand = `/${parsed.name}${parsed.rawArgs ? ' ' + parsed.rawArgs : ''}`;
        return {
          success: true,
          action: 'forward_to_cli',
          response: rawCommand,
        };
      }
      if (provider === 'opencode') {
        if (OPENCODE_FORWARDED_COMMANDS.has(parsed.name)) {
          const rawCommand = `/${parsed.name}${parsed.rawArgs ? ' ' + parsed.rawArgs : ''}`;
          return {
            success: true,
            action: 'forward_to_cli',
            response: rawCommand,
          };
        }
        return {
          success: false,
          error: `/${parsed.name} is a Claude Code native command and is not available in OpenCode. Use /init, /review, /security-review, /plan, a WebUI command, or ask OpenCode in plain language.`,
        };
      }
      if (provider === 'vibe') {
        // Vibe answers its own versions (/help, /compact, /mcp …).
        return {
          success: true,
          action: 'forward_to_cli',
          response: `/${parsed.name}${parsed.rawArgs ? ' ' + parsed.rawArgs : ''}`,
        };
      }
      if (provider !== 'claude' && provider !== 'zai') {
        return {
          success: false,
          error: `/${parsed.name} is a Claude Code native command and is not available in ${PROVIDER_LABELS[provider]}. Use a WebUI command or ask ${PROVIDER_LABELS[provider]} in plain language.`,
        };
      }
      const rawCommand = `/${parsed.name}${parsed.rawArgs ? ' ' + parsed.rawArgs : ''}`;
      return {
        success: true,
        action: 'forward_to_cli',
        response: rawCommand,
      };
    }

    // Load available commands (user/project custom commands)
    const commands = await this.getAvailableCommands(context.projectPath);
    const command = commands.find((c) => c.name === parsed.name && c.scope !== 'builtin');

    if (!command || !command.content) {
      // Vibe has its own commands and exposes every skill as /<name>; let it
      // answer anything Plum does not know itself.
      if (context.provider === 'vibe') {
        return {
          success: true,
          action: 'forward_to_cli',
          response: `/${parsed.name}${parsed.rawArgs ? ' ' + parsed.rawArgs : ''}`,
        };
      }
      return {
        success: false,
        error: `Unknown command: /${parsed.name}. Type /help for available commands.`,
      };
    }

    // Process command template
    const processedContent = this.processTemplate(command.content, parsed.args, parsed.rawArgs);

    return {
      success: true,
      action: 'send_message',
      response: processedContent,
    };
  }

  private async executeAuthCommand(parsed: ParsedCommand): Promise<CommandExecutionResult> {
    const sub = (parsed.args[0] || '').toLowerCase();
    if (parsed.name === 'hermes' && sub && sub !== 'auth' && sub !== 'model') {
      return {
        success: false,
        error: `Unknown command: /${parsed.name} ${parsed.rawArgs}. Use /auth or /hermes auth to open the login flow.`,
      };
    }

    return {
      success: true,
      action: 'open_login',
      data: { provider: 'codex' },
      response: 'Opening Codex login flow…',
    };
  }

  // Execute a built-in command
  private async executeBuiltinCommand(
    name: BuiltinCommandName,
    parsed: ParsedCommand,
    context: {
      projectPath?: string;
      sessionId?: string;
      currentModel?: string;
      provider?: CLIProvider;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        totalTokens?: number;
        contextWindow?: number;
        contextUsedPercent?: number;
        cost: number;
      };
    }
  ): Promise<CommandExecutionResult> {
    switch (name) {
      case 'help': {
        const commands = await this.getAvailableCommands(context.projectPath);
        const provider = context.provider || 'codex';
        const providerLabel = PROVIDER_LABELS[provider];
        const builtinList = commands
          .filter((c) => c.scope === 'builtin')
          .map((c) => `/${c.name} — ${c.description}`)
          .join('\n');
        const cliList =
          provider === 'claude' || provider === 'zai'
            ? Object.entries(CLI_FORWARDED_DESCRIPTIONS)
                .map(([name, desc]) => `/${name} — ${desc}`)
                .join('\n')
            : provider === 'opencode'
              ? Array.from(OPENCODE_FORWARDED_COMMANDS)
                  .map((name) => `/${name} — ${CLI_FORWARDED_DESCRIPTIONS[name]}`)
                  .join('\n')
              : '';
        const customList = commands
          .filter((c) => c.scope !== 'builtin')
          .map((c) => `/${c.name} — ${c.description} [${c.scope}]`)
          .join('\n');
        const sections = [`**Built-in commands (WebUI, ${providerLabel}):**\n${builtinList}`];
        if (cliList) {
          sections.push(`**Claude Code native commands:**\n${cliList}`);
        }
        if (customList) sections.push(`**Custom commands:**\n${customList}`);
        return {
          success: true,
          response: `Available commands:\n\n${sections.join('\n\n')}`,
        };
      }

      case 'skills': {
        const skills = await this.listSkillNames();
        return {
          success: true,
          response: skills.length
            ? `Available skills:\n${skills.map((skill) => `- ${skill}`).join('\n')}`
            : 'No shared skills found.',
        };
      }

      case 'features': {
        if (context.provider !== 'codex') {
          return {
            success: true,
            response: 'Codex feature flags only apply when the active provider is Codex.',
          };
        }
        const features = await listCodexFeatures();
        const stable = features.filter((feature) => feature.stage === 'stable');
        const experimental = features.filter((feature) => feature.stage !== 'stable');
        const render = (items: typeof features) =>
          items
            .slice(0, 40)
            .map(
              (feature) => `- ${feature.enabled ? 'on' : 'off'} ${feature.name} (${feature.stage})`
            )
            .join('\n');
        return {
          success: true,
          response: [
            '**Codex feature flags**',
            '',
            stable.length ? `Stable:\n${render(stable)}` : null,
            experimental.length ? `Other:\n${render(experimental)}` : null,
            '',
            'Change flags from Settings → General → Codex CLI.',
          ]
            .filter(Boolean)
            .join('\n'),
        };
      }

      case 'imagegen': {
        const prompt = parsed.rawArgs.trim();
        if (context.provider !== 'codex') {
          return {
            success: false,
            error:
              '/imagegen is a Codex shortcut. Switch this session to Codex to use Codex image generation.',
          };
        }
        if (!prompt) {
          return {
            success: false,
            error: 'Usage: /imagegen <prompt>',
          };
        }
        return {
          success: true,
          action: 'send_message',
          response: `$imagegen ${prompt}`,
        };
      }

      case 'goal': {
        if (context.provider !== 'codex') {
          const provider = context.provider || 'codex';
          return {
            success: false,
            error: `/goal is a Codex native command and is not available in ${PROVIDER_LABELS[provider]}. Switch this session to Codex to use durable task goals.`,
          };
        }

        const rawArgs = parsed.rawArgs.trim();
        if (rawArgs.length > 4000) {
          return {
            success: false,
            error:
              '/goal objectives must be at most 4,000 characters. Put longer instructions in a file and point the goal at that file.',
          };
        }

        return {
          success: true,
          action: 'forward_to_cli',
          response: rawArgs ? `/goal ${rawArgs}` : '/goal',
          data: {
            recordMessage: false,
            updateLastMessage: false,
          },
        };
      }

      case 'subagents':
        return {
          success: true,
          response:
            context.provider === 'codex'
              ? 'Codex subagents are available when you explicitly ask for parallel agents in your prompt. Persist project handoff notes and agent instructions in AGENTS.md. Example: "Use two subagents: one to inspect backend routes and one to inspect frontend state, then merge the findings."'
              : 'Subagent behavior is provider-specific. Persist project handoff notes and agent instructions in AGENTS.md; switch this session to Codex for Codex subagent workflows.',
        };

      case 'web-search':
        return {
          success: true,
          action: 'open_settings',
          response:
            context.provider === 'codex'
              ? 'Opening Codex settings. Web search can be set to Auto, Cached, Live, or Disabled.'
              : 'Opening settings. Codex web search applies to Codex sessions only.',
          data: { tab: 'general' },
        };

      case 'agents': {
        const agents = await this.listMarkdownBasenames(join(homedir(), '.claude', 'agents'));
        return {
          success: true,
          response: agents.length
            ? `Available agents:\n${agents.map((agent) => `- ${agent}`).join('\n')}`
            : 'No shared agents found.',
        };
      }

      case 'mcp': {
        const provider = context.provider || 'codex';
        return {
          success: true,
          response: [
            `MCP servers are loaded for ${PROVIDER_LABELS[provider]} at session start.`,
            provider === 'codex'
              ? 'Codex also loads a local `oracle` second-opinion server for GPT-backed reviews.'
              : null,
            'Manage mirrored server definitions in Settings or `~/.claude/settings.json`; Codex appends its own local MCP entries in `~/.codex/config.toml` during backend startup.',
            'Start a fresh chat after changing MCP config.',
          ]
            .filter((line): line is string => typeof line === 'string')
            .join('\n'),
        };
      }

      case 'memory':
        return {
          success: true,
          action: 'open_settings',
          response: 'Opening memory and instruction settings.',
          data: { tab: 'agents' },
        };

      case 'hooks':
        return {
          success: true,
          response:
            context.provider === 'claude' || context.provider === 'zai'
              ? 'Claude permission hooks are managed by the WebUI permission prompt bridge.'
              : 'Codex does not use Claude hook files. WebUI maps session modes to Codex sandbox and approval settings at process spawn.',
        };

      case 'context':
        if (context.usage) {
          return {
            success: true,
            response: [
              'Context Usage:',
              `  Used: ${(context.usage.totalTokens ?? context.usage.inputTokens).toLocaleString()} tokens`,
              context.usage.contextWindow
                ? `  Window: ${context.usage.contextWindow.toLocaleString()} tokens`
                : null,
              context.usage.contextUsedPercent !== undefined
                ? `  Percent: ${context.usage.contextUsedPercent}%`
                : null,
              `  Model: ${context.currentModel || 'gpt-5.5'}`,
            ]
              .filter(Boolean)
              .join('\n'),
          };
        }
        return {
          success: true,
          response: 'No context usage data available for this session yet.',
        };

      case 'usage':
        if (context.usage) {
          return {
            success: true,
            response: [
              'Token Usage:',
              `  Input: ${context.usage.inputTokens.toLocaleString()} tokens`,
              context.usage.cacheReadTokens
                ? `  Cache read: ${context.usage.cacheReadTokens.toLocaleString()} tokens`
                : null,
              `  Output: ${context.usage.outputTokens.toLocaleString()} tokens`,
              `  Cost: $${context.usage.cost.toFixed(4)}`,
              '',
              'Provider rate limits are shown in the context popover.',
            ]
              .filter((line) => line !== null)
              .join('\n'),
          };
        }
        return {
          success: true,
          response: 'No usage data available for this session yet.',
        };

      case 'clear':
        return {
          success: true,
          action: 'clear',
          response: 'Chat history cleared.',
        };

      case 'reset':
        return {
          success: true,
          action: 'clear',
          response: 'Starting a new conversation.',
        };

      case 'new':
        return {
          success: true,
          action: 'new_session',
          response: 'Creating new session…',
        };

      case 'rename': {
        const newName = parsed.rawArgs.trim();
        if (!newName) {
          return {
            success: false,
            error: 'Usage: /rename <new name>',
          };
        }
        return {
          success: true,
          action: 'rename_session',
          response: `Renaming session to "${newName}".`,
          data: { name: newName },
        };
      }

      case 'copy': {
        const n = parsed.args[0] ? Number.parseInt(parsed.args[0], 10) : 1;
        return {
          success: true,
          action: 'copy_response',
          response:
            n > 1
              ? `Copying ${n}th-latest response to clipboard.`
              : 'Copying last response to clipboard.',
          data: { n: Number.isFinite(n) && n > 0 ? n : 1 },
        };
      }

      case 'export': {
        const filename = parsed.args[0]?.trim();
        return {
          success: true,
          action: 'export_conversation',
          response: filename ? `Exporting conversation to ${filename}.` : 'Exporting conversation…',
          data: { filename },
        };
      }

      case 'resume':
      case 'continue':
        return {
          success: true,
          action: 'resume_session',
          response: 'Opening session picker…',
        };

      case 'theme':
        return {
          success: true,
          action: 'open_settings',
          response: 'Opening appearance controls…',
          data: { tab: 'general', section: 'appearance' },
        };

      case 'permissions':
        return {
          success: true,
          action: 'open_permissions',
          response: 'Opening permissions settings…',
        };

      case 'diff':
        return {
          success: true,
          action: 'open_diff',
          response: 'Loading uncommitted git diff…',
        };

      case 'feedback':
      case 'bug': {
        const report = parsed.rawArgs.trim();
        return {
          success: true,
          action: 'open_feedback',
          response: report ? `Submitting feedback: ${report}` : 'Opening feedback form…',
          data: report ? { report } : undefined,
        };
      }

      case 'doctor':
        return {
          success: true,
          action: 'show_doctor',
          response: 'Running WebUI diagnostics…',
        };

      case 'model':
        if (parsed.args.length === 0) {
          return {
            success: true,
            response: `Current model: ${context.currentModel || 'gpt-5.5'}`,
          };
        }
        return {
          success: true,
          action: 'model_change',
          response: `Model changed to: ${parsed.args[0]}`,
          data: { model: parsed.args[0] },
        };

      case 'status':
        return {
          success: true,
          response: [
            `Session: ${context.sessionId || 'N/A'}`,
            `Model: ${context.currentModel || 'gpt-5.5'}`,
            `Project: ${context.projectPath || 'None'}`,
          ].join('\n'),
        };

      case 'cost':
        if (context.usage) {
          return {
            success: true,
            response: [
              'Token Usage:',
              `  Input: ${context.usage.inputTokens.toLocaleString()} tokens`,
              `  Output: ${context.usage.outputTokens.toLocaleString()} tokens`,
              `  Cost: $${context.usage.cost.toFixed(4)}`,
            ].join('\n'),
          };
        }
        return {
          success: true,
          response: 'No usage data available for this session.',
        };

      case 'compact':
        if (
          context.provider === 'codex' ||
          context.provider === 'opencode' ||
          context.provider === 'pi' ||
          context.provider === 'vibe'
        ) {
          const rawArgs = parsed.rawArgs.trim();
          return {
            success: true,
            action: 'forward_to_cli',
            response: rawArgs ? `/compact ${rawArgs}` : '/compact',
          };
        }
        return {
          success: true,
          action: 'clear',
          data: { toggleCompact: true },
          response: 'Compact mode toggled.',
        };

      default:
        return {
          success: false,
          error: `Unknown built-in command: /${name}`,
        };
    }
  }

  // Process command template with arguments
  private processTemplate(template: string, args: string[], rawArgs: string): string {
    let result = template;

    // Replace $ARGUMENTS with full args string
    result = result.replace(/\$ARGUMENTS/g, rawArgs);

    // Replace $1, $2, etc. with individual args
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg !== undefined) {
        result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), arg);
      }
    }

    // Clean up any remaining placeholders
    result = result.replace(/\$\d+/g, '');

    return result.trim();
  }

  // Process @filename references in text (reads file content).
  // Sandbox rule: `@…` references must resolve inside the session's working
  // directory. Absolute paths and `..` traversals are rejected so attacker-
  // controlled prompt content cannot exfiltrate files like `~/.claude/.credentials.json`
  // or `/etc/passwd` into the LLM context.
  async processFileReferences(text: string, workingDirectory: string): Promise<string> {
    const fileRefRegex = /@([\w./\-_]+)/g;
    let result = text;
    let match;

    const rootResolved = resolveAllowedCommandPath(workingDirectory);
    const rootPrefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;

    while ((match = fileRefRegex.exec(text)) !== null) {
      const fileName = match[1];
      if (!fileName) continue;
      if (isAbsolute(fileName) || fileName.startsWith('~')) continue;

      const filePath = resolve(rootResolved, fileName);
      if (filePath !== rootResolved && !filePath.startsWith(rootPrefix)) continue;

      try {
        const content = await readFile(filePath, 'utf-8');
        result = result.replace(match[0], `\n\`\`\`\n${content}\n\`\`\`\n`);
      } catch {
        // File doesn't exist or can't be read, leave reference as-is
      }
    }

    return result;
  }
}

export const commandService = new CommandService();
