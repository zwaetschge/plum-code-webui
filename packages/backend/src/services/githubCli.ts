import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { AppError } from '../middleware/errorHandler.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';

const execFileAsync = promisify(execFile);

/**
 * Pull requests, CI runs, issues and releases through the `gh` CLI.
 *
 * The Octokit path in services/github.ts needs a personal access token that
 * each user has to create and paste in Settings; most never do, so those
 * features are dead for them. `gh` is authenticated once for the whole
 * deployment, so everything here works without per-user setup — at the cost of
 * acting as the single logged-in account, which is the right trade for a
 * single-operator instance.
 *
 * Every call is execFile with an argument array: no shell, so branch names and
 * PR titles cannot break out into command injection.
 */

const GH_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  author: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergeable?: string;
  reviewDecision?: string;
  statusCheckRollup?: { state: string; total: number; failed: number };
}

export interface GitHubWorkflowRun {
  databaseId: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  event: string;
  url: string;
  createdAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  author: string;
  url: string;
  createdAt: string;
  labels: string[];
}

export interface GitHubRelease {
  tagName: string;
  name: string;
  isDraft: boolean;
  isLatest: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
}

function resolveRepoPath(workingDirectory: string): string {
  const resolved = path.resolve(workingDirectory);
  if (!isAllowedBasePath(resolved)) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }
  return resolved;
}

async function gh<T>(args: string[], cwd: string, parse: true): Promise<T>;
async function gh(args: string[], cwd: string, parse?: false): Promise<string>;
async function gh<T>(args: string[], cwd: string, parse = false): Promise<T | string> {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: GH_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      // gh reads its token from the config dir, never from the session env.
      env: { ...process.env, GH_PAGER: '', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    });
    if (!parse) return stdout.trim();
    const text = stdout.trim();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    const stderr =
      typeof error === 'object' && error && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : '';
    const message = stderr || (error instanceof Error ? error.message : 'gh failed');

    if (/gh auth login|not logged into/i.test(message)) {
      throw new AppError(
        'GitHub CLI is not authenticated. Run: gh auth login',
        401,
        'GH_NOT_AUTHENTICATED'
      );
    }
    if (/could not determine|not a git repository|no git remotes/i.test(message)) {
      throw new AppError('No GitHub repository for this directory', 404, 'GH_NO_REPO');
    }
    if (/command not found|ENOENT/i.test(message)) {
      throw new AppError('GitHub CLI is not installed', 503, 'GH_MISSING');
    }
    throw new AppError(message.slice(0, 500), 502, 'GH_ERROR');
  }
}

export const githubCli = {
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['auth', 'status'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  },

  async repoInfo(workingDirectory: string) {
    const cwd = resolveRepoPath(workingDirectory);
    return gh<{ nameWithOwner: string; defaultBranchRef: { name: string } | null; url: string }>(
      ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,url'],
      cwd,
      true
    );
  },

  async listPullRequests(workingDirectory: string, state = 'open', limit = 20) {
    const cwd = resolveRepoPath(workingDirectory);
    const raw = await gh<GitHubPullRequest[]>(
      [
        'pr',
        'list',
        '--state',
        state,
        '--limit',
        String(limit),
        '--json',
        'number,title,state,isDraft,author,headRefName,baseRefName,url,createdAt,updatedAt,statusCheckRollup',
      ],
      cwd,
      true
    );
    return (raw || []).map((pr) => ({
      ...pr,
      author: (pr.author as unknown as { login?: string })?.login || String(pr.author || ''),
      statusCheckRollup: summarizeChecks(pr.statusCheckRollup as unknown),
    }));
  },

  async createPullRequest(
    workingDirectory: string,
    input: { title: string; body?: string; base?: string; head?: string; draft?: boolean }
  ) {
    const cwd = resolveRepoPath(workingDirectory);
    const args = ['pr', 'create', '--title', input.title, '--body', input.body || ''];
    if (input.base) args.push('--base', input.base);
    if (input.head) args.push('--head', input.head);
    if (input.draft) args.push('--draft');
    const url = await gh(args, cwd);
    return { url: url.split('\n').filter(Boolean).pop() || url };
  },

  async mergePullRequest(
    workingDirectory: string,
    prNumber: number,
    method: 'merge' | 'squash' | 'rebase' = 'squash',
    deleteBranch = false
  ) {
    const cwd = resolveRepoPath(workingDirectory);
    const args = ['pr', 'merge', String(prNumber), `--${method}`];
    if (deleteBranch) args.push('--delete-branch');
    const output = await gh(args, cwd);
    return { output };
  },

  async listWorkflowRuns(workingDirectory: string, limit = 20, branch?: string) {
    const cwd = resolveRepoPath(workingDirectory);
    const args = [
      'run',
      'list',
      '--limit',
      String(limit),
      '--json',
      'databaseId,name,displayTitle,status,conclusion,headBranch,event,url,createdAt',
    ];
    if (branch) args.push('--branch', branch);
    return (await gh<GitHubWorkflowRun[]>(args, cwd, true)) || [];
  },

  async rerunWorkflow(workingDirectory: string, runId: number, failedOnly = false) {
    const cwd = resolveRepoPath(workingDirectory);
    const args = ['run', 'rerun', String(runId)];
    if (failedOnly) args.push('--failed');
    return { output: await gh(args, cwd) };
  },

  async runFailureLog(workingDirectory: string, runId: number) {
    const cwd = resolveRepoPath(workingDirectory);
    const log = await gh(['run', 'view', String(runId), '--log-failed'], cwd);
    // Enough to see the failing step without shipping a multi-megabyte log.
    return { log: log.slice(-20_000) };
  },

  async listIssues(workingDirectory: string, state = 'open', limit = 20) {
    const cwd = resolveRepoPath(workingDirectory);
    // The panels share one state filter with pull requests, but issues are never
    // "merged" and gh rejects the value outright.
    if (state === 'merged') state = 'all';
    const raw = await gh<GitHubIssue[]>(
      [
        'issue',
        'list',
        '--state',
        state,
        '--limit',
        String(limit),
        '--json',
        'number,title,state,author,url,createdAt,labels',
      ],
      cwd,
      true
    );
    return (raw || []).map((issue) => ({
      ...issue,
      author: (issue.author as unknown as { login?: string })?.login || String(issue.author || ''),
      labels: Array.isArray(issue.labels)
        ? (issue.labels as unknown as { name?: string }[]).map((l) => l?.name || String(l))
        : [],
    }));
  },

  async createIssue(workingDirectory: string, input: { title: string; body?: string }) {
    const cwd = resolveRepoPath(workingDirectory);
    const url = await gh(
      ['issue', 'create', '--title', input.title, '--body', input.body || ''],
      cwd
    );
    return { url: url.split('\n').filter(Boolean).pop() || url };
  },

  async listReleases(workingDirectory: string, limit = 20) {
    const cwd = resolveRepoPath(workingDirectory);
    return (
      (await gh<GitHubRelease[]>(
        [
          'release',
          'list',
          '--limit',
          String(limit),
          '--json',
          // `gh release list` has no url field; the tag is enough to build one.
          'tagName,name,isDraft,isLatest,isPrerelease,publishedAt',
        ],
        cwd,
        true
      )) || []
    );
  },
};

/**
 * gh returns one entry per check; the panels only need "is anything red".
 */
export function summarizeChecks(rollup: unknown): GitHubPullRequest['statusCheckRollup'] {
  if (!Array.isArray(rollup) || rollup.length === 0) return undefined;
  let failed = 0;
  let pending = 0;
  for (const check of rollup as { conclusion?: string; status?: string }[]) {
    const conclusion = (check?.conclusion || '').toUpperCase();
    const status = (check?.status || '').toUpperCase();
    if (conclusion === 'FAILURE' || conclusion === 'TIMED_OUT' || conclusion === 'CANCELLED') {
      failed += 1;
    } else if (!conclusion || status === 'IN_PROGRESS' || status === 'QUEUED') {
      pending += 1;
    }
  }
  const state = failed > 0 ? 'FAILURE' : pending > 0 ? 'PENDING' : 'SUCCESS';
  return { state, total: rollup.length, failed };
}
