import { Octokit } from '@octokit/rest';
import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import type { GitHubUser, GitHubRepo, CreateRepoRequest } from '@plum-code-webui/shared';
import { getGitHubTokenForUser } from '../routes/settings.js';
import { AppError } from '../middleware/errorHandler.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';
import { stripBackendSecretsFromEnv } from '../utils/childProcessEnv.js';

const GIT_AUTH_ENVIRONMENT = [
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_TERMINAL_PROMPT',
];

/**
 * The environment for a git call that may need the user's GitHub token.
 *
 * The token used to be written into the remote URL. A clone kept it in
 * `.git/config` for good, a failed push left it there too, and either way it
 * sat on git's command line and in its error messages. It now reaches git as an
 * HTTP header for github.com through the process environment and is never
 * stored. Git also runs without the backend's own secrets.
 */
export function gitHubAuthEnvironment(
  token: string | null,
  base: NodeJS.ProcessEnv = stripBackendSecretsFromEnv()
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    // simple-git refuses GIT_* variables it was not told about.
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  }
  return env;
}

function gitForGitHub(token: string | null, baseDir?: string): SimpleGit {
  return simpleGit({
    ...(baseDir ? { baseDir } : {}),
    // The config entries above are built here, not taken from a request.
    unsafe: { allowUnsafeConfigEnvCount: true },
    allowEnvironment: GIT_AUTH_ENVIRONMENT,
  }).env(gitHubAuthEnvironment(token));
}

/** A github.com URL without embedded credentials, or null when it has none. */
export function withoutUrlCredentials(url: string): string | null {
  const match = /^https:\/\/[^@/]+@github\.com\/(.*)$/.exec(url);
  return match ? `https://github.com/${match[1]}` : null;
}

/** Git echoes URLs and headers in its errors; none of it should leave with a token in it. */
function describeGitError(error: unknown, token: string | null, fallback: string): string {
  let message = error instanceof Error ? error.message : fallback;
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    message = message.split(token).join('***').split(basic).join('***');
  }
  return message.replace(/https:\/\/[^@/\s]+@github\.com\//g, 'https://github.com/');
}

/**
 * The `gh`-backed sibling service resolves every working directory through
 * `isAllowedBasePath` before it runs anything; this older Octokit path did not,
 * so `POST /api/github/clone` could drop a repository anywhere the process can
 * write, and push/remote ran git against arbitrary directories. Same boundary,
 * same place, so the two paths cannot drift apart again.
 */
function resolveWorkspacePath(workingDirectory: string, label: string): string {
  const resolved = path.resolve(workingDirectory);
  if (!isAllowedBasePath(resolved)) {
    throw new AppError(`${label} is not an allowed path`, 403, 'FORBIDDEN_PATH');
  }
  return resolved;
}

/**
 * `z.string().url()` also accepts `file://`, `ssh://` and `git://`, which for a
 * clone means reading local directories or reaching internal git hosts, and for
 * a remote means a place to push commits to. This service talks to github.com
 * and nothing else — the Octokit client is not host-configurable either — so
 * that is the whole allowlist.
 */
function assertGitHubUrl(url: string, label: string): string {
  const scpLike = /^git@github\.com:[\w.-]+\/[\w.-]+(\.git)?$/;
  if (scpLike.test(url)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(`${label} is not a valid URL`, 400, 'INVALID_REPO_URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (host !== 'github.com' && host !== 'www.github.com')) {
    throw new AppError(`${label} must be an https://github.com/... URL`, 400, 'INVALID_REPO_URL');
  }
  return url;
}

export class GitHubService {
  private async getOctokit(userId: string): Promise<Octokit | null> {
    const token = await getGitHubTokenForUser(userId);
    if (!token) return null;
    return new Octokit({ auth: token });
  }

  async validateToken(
    userId: string
  ): Promise<{ valid: boolean; user?: GitHubUser; scopes?: string[]; error?: string }> {
    const octokit = await this.getOctokit(userId);
    if (!octokit) {
      return { valid: false, error: 'No GitHub token configured' };
    }

    try {
      const { data, headers } = await octokit.rest.users.getAuthenticated();
      const scopes = (headers['x-oauth-scopes'] as string)?.split(', ').filter(Boolean) || [];

      return {
        valid: true,
        user: {
          login: data.login,
          id: data.id,
          avatar_url: data.avatar_url,
          name: data.name,
          email: data.email,
          public_repos: data.public_repos,
        },
        scopes,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid token',
      };
    }
  }

  async getUser(userId: string): Promise<GitHubUser | null> {
    const octokit = await this.getOctokit(userId);
    if (!octokit) return null;

    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      return {
        login: data.login,
        id: data.id,
        avatar_url: data.avatar_url,
        name: data.name,
        email: data.email,
        public_repos: data.public_repos,
      };
    } catch {
      return null;
    }
  }

  async listRepos(
    userId: string,
    page = 1,
    perPage = 30
  ): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
    const octokit = await this.getOctokit(userId);
    if (!octokit) {
      return { repos: [], hasMore: false };
    }

    try {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: 'updated',
        direction: 'desc',
        per_page: perPage,
        page,
      });

      const repos: GitHubRepo[] = data.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        html_url: repo.html_url,
        description: repo.description,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        default_branch: repo.default_branch,
        created_at: repo.created_at || '',
        updated_at: repo.updated_at || '',
        pushed_at: repo.pushed_at || '',
        size: repo.size,
        stargazers_count: repo.stargazers_count,
        language: repo.language,
      }));

      return {
        repos,
        hasMore: data.length === perPage,
      };
    } catch {
      return { repos: [], hasMore: false };
    }
  }

  async createRepo(
    userId: string,
    request: CreateRepoRequest
  ): Promise<{ success: boolean; repo?: GitHubRepo; error?: string }> {
    const octokit = await this.getOctokit(userId);
    if (!octokit) {
      return { success: false, error: 'No GitHub token configured' };
    }

    try {
      const { data } = await octokit.rest.repos.createForAuthenticatedUser({
        name: request.name,
        description: request.description,
        private: request.private ?? false,
        auto_init: request.auto_init ?? false,
      });

      return {
        success: true,
        repo: {
          id: data.id,
          name: data.name,
          full_name: data.full_name,
          private: data.private,
          html_url: data.html_url,
          description: data.description,
          clone_url: data.clone_url,
          ssh_url: data.ssh_url,
          default_branch: data.default_branch,
          created_at: data.created_at || '',
          updated_at: data.updated_at || '',
          pushed_at: data.pushed_at || '',
          size: data.size,
          stargazers_count: data.stargazers_count,
          language: data.language,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create repository',
      };
    }
  }

  async cloneRepo(
    userId: string,
    url: string,
    targetDir: string,
    branch?: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const token = await getGitHubTokenForUser(userId);
    assertGitHubUrl(url, 'Repository URL');
    const cloneTarget = resolveWorkspacePath(targetDir, 'Target directory');

    try {
      const git = gitForGitHub(token);
      const cloneOptions: string[] = [];

      if (branch) {
        cloneOptions.push('--branch', branch);
      }

      // The plain URL: the token authenticates the request and stays out of the repository.
      await git.clone(url, cloneTarget, cloneOptions);

      return {
        success: true,
        path: cloneTarget,
      };
    } catch (error) {
      return {
        success: false,
        error: describeGitError(error, token, 'Failed to clone repository'),
      };
    }
  }

  async pushToGitHub(
    userId: string,
    workingDirectory: string,
    remote = 'origin',
    branch?: string,
    force = false
  ): Promise<{ success: boolean; error?: string }> {
    const token = await getGitHubTokenForUser(userId);
    const repoPath = resolveWorkspacePath(workingDirectory, 'Working directory');

    try {
      const git = gitForGitHub(token, repoPath);

      // Get current branch if not specified
      const currentBranch = branch || (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

      // Check if remote exists
      const remotes = await git.getRemotes(true);
      const remoteExists = remotes.some((r) => r.name === remote);

      if (!remoteExists) {
        return { success: false, error: `Remote '${remote}' not found` };
      }

      // A repository cloned before the token moved out of the URL still carries
      // it in its remote; take it out now that it is not needed there.
      const remoteUrl = remotes.find((r) => r.name === remote)?.refs.push || '';
      const cleanUrl = withoutUrlCredentials(remoteUrl);
      if (cleanUrl) await git.remote(['set-url', remote, cleanUrl]);

      // Push
      const pushOptions: string[] = [];
      if (force) {
        pushOptions.push('--force');
      }

      await git.push(remote, currentBranch, pushOptions);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: describeGitError(error, token, 'Failed to push to GitHub'),
      };
    }
  }

  async addRemote(
    _userId: string,
    workingDirectory: string,
    remoteName: string,
    repoUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    assertGitHubUrl(repoUrl, 'Remote URL');
    const repoPath = resolveWorkspacePath(workingDirectory, 'Working directory');

    try {
      const git: SimpleGit = simpleGit(repoPath);

      // Check if remote already exists
      const remotes = await git.getRemotes();
      if (remotes.some((r) => r.name === remoteName)) {
        // Update existing remote
        await git.remote(['set-url', remoteName, repoUrl]);
      } else {
        // Add new remote
        await git.addRemote(remoteName, repoUrl);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add remote',
      };
    }
  }

  async getRateLimitStatus(
    userId: string
  ): Promise<{ remaining: number; limit: number; reset: Date } | null> {
    const octokit = await this.getOctokit(userId);
    if (!octokit) return null;

    try {
      const { data } = await octokit.rest.rateLimit.get();
      return {
        remaining: data.rate.remaining,
        limit: data.rate.limit,
        reset: new Date(data.rate.reset * 1000),
      };
    } catch {
      return null;
    }
  }
}

export const githubService = new GitHubService();
