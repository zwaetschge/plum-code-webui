import { Octokit } from '@octokit/rest';
import { simpleGit, SimpleGit } from 'simple-git';
import type { GitHubUser, GitHubRepo, CreateRepoRequest } from '@plum-code-webui/shared';
import { getGitHubTokenForUser } from '../routes/settings.js';

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

    try {
      // Inject token into URL for private repos
      let cloneUrl = url;
      if (token && url.startsWith('https://github.com/')) {
        cloneUrl = url.replace('https://github.com/', `https://${token}@github.com/`);
      }

      const git: SimpleGit = simpleGit();
      const cloneOptions: string[] = [];

      if (branch) {
        cloneOptions.push('--branch', branch);
      }

      await git.clone(cloneUrl, targetDir, cloneOptions);

      return {
        success: true,
        path: targetDir,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clone repository',
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

    try {
      const git: SimpleGit = simpleGit(workingDirectory);

      // Get current branch if not specified
      const currentBranch = branch || (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

      // Check if remote exists
      const remotes = await git.getRemotes(true);
      const remoteExists = remotes.some((r) => r.name === remote);

      if (!remoteExists) {
        return { success: false, error: `Remote '${remote}' not found` };
      }

      // Get remote URL and inject token if needed
      const remoteUrl = remotes.find((r) => r.name === remote)?.refs.push || '';

      if (token && remoteUrl.startsWith('https://github.com/')) {
        const tokenUrl = remoteUrl.replace('https://github.com/', `https://${token}@github.com/`);
        await git.remote(['set-url', remote, tokenUrl]);
      }

      // Push
      const pushOptions: string[] = [];
      if (force) {
        pushOptions.push('--force');
      }

      await git.push(remote, currentBranch, pushOptions);

      // Reset URL to remove token
      if (token && remoteUrl.startsWith('https://github.com/')) {
        await git.remote(['set-url', remote, remoteUrl]);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to push to GitHub',
      };
    }
  }

  async addRemote(
    _userId: string,
    workingDirectory: string,
    remoteName: string,
    repoUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const git: SimpleGit = simpleGit(workingDirectory);

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
