import { Router } from 'express';
import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'path';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';
import type { GitStatus, GitBranch, GitCommit } from '@plum-code-webui/shared';

const router = Router();

// Validate path
function validatePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (!isAllowedBasePath(resolvedPath)) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }

  return resolvedPath;
}

// Get git instance for path
function getGit(repoPath: string): SimpleGit {
  const resolvedPath = validatePath(repoPath);
  return simpleGit(resolvedPath);
}

/**
 * Reject a user-supplied ref, branch name or pathspec that would be read as a
 * git option.
 *
 * simple-git assembles `["diff", ...args]` and contributes no `--` separator of
 * its own, so any value in an argument slot that starts with a dash is an
 * option. `/api/git/compare?base=--output&head=/tmp/evil` therefore ran
 * `git diff --output /tmp/evil` and wrote the diff to an arbitrary path — only
 * `path` was ever validated against ALLOWED_BASE_PATHS, never the refs. Values
 * that look like options are refused here, and pathspecs additionally go behind
 * an explicit `--` at the call sites.
 */
function gitArg(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${label} is required`, 400, 'MISSING_PARAMS');
  }
  if (value.startsWith('-')) {
    throw new AppError(`Invalid ${label}: must not start with "-"`, 400, 'INVALID_GIT_ARGUMENT');
  }
  return value;
}

/** Same rule for a list of pathspecs. */
function gitArgs(values: unknown, label: string): string[] {
  if (!Array.isArray(values)) {
    throw new AppError(`${label} is required`, 400, 'MISSING_PARAMS');
  }
  return values.map((value) => gitArg(value, label));
}

// Get git status
router.get('/status', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const status = await git.status();

    const gitStatus: GitStatus = {
      branch: status.current || 'HEAD',
      isClean: status.isClean(),
      staged: status.staged,
      unstaged: status.modified,
      untracked: status.not_added,
    };

    res.json({ success: true, data: gitStatus });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get branches
router.get('/branches', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const branchSummary = await git.branch(['-a']);

    const branches: GitBranch[] = Object.entries(branchSummary.branches).map(([name, info]) => ({
      name,
      isCurrent: info.current,
      isRemote: name.startsWith('remotes/'),
    }));

    res.json({ success: true, data: branches });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get remotes
router.get('/remotes', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const remotes = await git.getRemotes(true);

    const result = remotes.map((remote) => ({
      name: remote.name,
      url: remote.refs.push || remote.refs.fetch || '',
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get commit log
router.get('/log', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const limit = parseInt(req.query.limit as string) || 10;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const log = await git.log({ maxCount: limit });

    const commits: GitCommit[] = log.all.map((commit) => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
    }));

    res.json({ success: true, data: commits });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Checkout branch
router.post('/checkout', requireAuth, async (req, res) => {
  const { path: repoPath, branch } = req.body;

  if (!repoPath || !branch) {
    throw new AppError('Path and branch are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    await git.checkout(gitArg(branch, 'branch'));

    res.json({ success: true, data: { branch } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    if ((err as Error).message.includes('did not match')) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }
    throw err;
  }
});

// Get diff
router.get('/diff', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string | undefined;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const diff = file ? await git.diff(['--', gitArg(file, 'file')]) : await git.diff();

    res.json({ success: true, data: { diff } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get staged diff
router.get('/diff-staged', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string | undefined;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const diffArgs = ['--cached'];
    if (file) {
      diffArgs.push('--', gitArg(file, 'file'));
    }
    const diff = await git.diff(diffArgs);

    res.json({ success: true, data: { diff } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get file diff with details
router.get('/diff-file', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string;
  const staged = req.query.staged === 'true';

  if (!repoPath || !file) {
    throw new AppError('Path and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    const diffArgs = staged
      ? ['--cached', '--', gitArg(file, 'file')]
      : ['--', gitArg(file, 'file')];
    const diff = await git.diff(diffArgs);

    // Parse diff to count additions and deletions
    const lines = diff.split('\n');
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    res.json({
      success: true,
      data: {
        file,
        diff,
        additions,
        deletions,
        staged,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Stage files
router.post('/stage', requireAuth, async (req, res) => {
  const { path: repoPath, files } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    if (files && Array.isArray(files) && files.length > 0) {
      // Stage specific files
      await git.add(['--', ...gitArgs(files, 'files')]);
    } else {
      // Stage all changes
      await git.add('.');
    }

    // Return updated status
    const status = await git.status();

    res.json({
      success: true,
      data: {
        staged: status.staged,
        unstaged: status.modified,
        untracked: status.not_added,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Unstage files
router.post('/unstage', requireAuth, async (req, res) => {
  const { path: repoPath, files } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    if (files && Array.isArray(files) && files.length > 0) {
      // Unstage specific files
      await git.reset(['HEAD', '--', ...files]);
    } else {
      // Unstage all
      await git.reset(['HEAD']);
    }

    // Return updated status
    const status = await git.status();

    res.json({
      success: true,
      data: {
        staged: status.staged,
        unstaged: status.modified,
        untracked: status.not_added,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Create commit
router.post('/commit', requireAuth, async (req, res) => {
  const { path: repoPath, message } = req.body;

  if (!repoPath || !message) {
    throw new AppError('Path and message are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    // Check if there are staged changes
    const status = await git.status();
    if (status.staged.length === 0) {
      throw new AppError('No changes staged for commit', 400, 'NO_STAGED_CHANGES');
    }

    // Create the commit
    const result = await git.commit(message);

    res.json({
      success: true,
      data: {
        hash: result.commit,
        summary: {
          changes: result.summary.changes,
          insertions: result.summary.insertions,
          deletions: result.summary.deletions,
        },
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Discard changes to a file
router.post('/discard', requireAuth, async (req, res) => {
  const { path: repoPath, file } = req.body;

  if (!repoPath || !file) {
    throw new AppError('Path and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    await git.checkout(['--', file]);

    res.json({ success: true });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Create new branch
router.post('/branch/create', requireAuth, async (req, res) => {
  const { path: repoPath, name, checkout } = req.body;

  if (!repoPath || !name) {
    throw new AppError('Path and branch name are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    // Create branch
    const branchName = gitArg(name, 'branch name');
    await git.branch([branchName]);

    // Checkout if requested
    if (checkout) {
      await git.checkout(branchName);
    }

    res.json({ success: true, data: { branch: name, checkedOut: !!checkout } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    if ((err as Error).message.includes('already exists')) {
      throw new AppError('Branch already exists', 400, 'BRANCH_EXISTS');
    }
    throw err;
  }
});

// Delete branch
router.post('/branch/delete', requireAuth, async (req, res) => {
  const { path: repoPath, name, force } = req.body;

  if (!repoPath || !name) {
    throw new AppError('Path and branch name are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    // Delete branch (force if requested)
    await git.branch([force ? '-D' : '-d', gitArg(name, 'branch name')]);

    res.json({ success: true });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    if ((err as Error).message.includes('not fully merged')) {
      throw new AppError(
        'Branch is not fully merged. Use force to delete anyway.',
        400,
        'BRANCH_NOT_MERGED'
      );
    }
    throw err;
  }
});

/**
 * Switch branches, optionally creating one. Refuses when the working tree is
 * dirty rather than silently carrying changes across — an agent session's
 * uncommitted work is too easy to lose that way.
 */
router.post('/checkout', requireAuth, async (req, res) => {
  const {
    path: repoPath,
    branch,
    create,
  } = req.body as {
    path?: string;
    branch?: string;
    create?: boolean;
  };

  if (!repoPath) throw new AppError('Path is required', 400, 'MISSING_PATH');
  if (!branch || !branch.trim()) throw new AppError('Branch is required', 400, 'MISSING_BRANCH');

  try {
    const git = getGit(repoPath);
    const status = await git.status();
    if (!create && (status.modified.length > 0 || status.staged.length > 0)) {
      throw new AppError(
        'Working tree has uncommitted changes — commit or stash first.',
        409,
        'DIRTY_WORKTREE'
      );
    }

    const targetBranch = gitArg(branch.trim(), 'branch');
    if (create) {
      await git.checkoutLocalBranch(targetBranch);
    } else {
      await git.checkout(targetBranch);
    }

    const after = await git.status();
    res.json({ success: true, data: { branch: after.current } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw new AppError((err as Error).message, 400, 'CHECKOUT_FAILED');
  }
});

// Pull from remote
router.post('/pull', requireAuth, async (req, res) => {
  const { path: repoPath, remote, branch } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    const pullOptions: string[] = [];
    if (remote) pullOptions.push(gitArg(remote, 'remote'));
    if (branch) pullOptions.push(gitArg(branch, 'branch'));

    const result = await git.pull(pullOptions);

    res.json({
      success: true,
      data: {
        files: result.files,
        insertions: result.insertions,
        deletions: result.deletions,
        summary: result.summary,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Fetch from remote
router.post('/fetch', requireAuth, async (req, res) => {
  const { path: repoPath, remote, prune } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    const fetchOptions: string[] = [];
    if (prune) fetchOptions.push('--prune');
    if (remote) fetchOptions.push(gitArg(remote, 'remote'));

    await git.fetch(fetchOptions);

    res.json({ success: true });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get remote tracking status (ahead/behind)
router.get('/remote-status', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    // Get current branch
    const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

    // Get tracking branch
    let tracking: string | null = null;
    try {
      tracking = (
        await git.raw(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`])
      ).trim();
    } catch {
      // No upstream configured
    }

    if (!tracking) {
      res.json({
        success: true,
        data: {
          branch: currentBranch,
          tracking: null,
          ahead: 0,
          behind: 0,
        },
      });
      return;
    }

    // Get ahead/behind counts
    const revList = await git.raw([
      'rev-list',
      '--left-right',
      '--count',
      `${currentBranch}...${tracking}`,
    ]);
    const [ahead, behind] = revList.trim().split('\t').map(Number);

    res.json({
      success: true,
      data: {
        branch: currentBranch,
        tracking,
        ahead: ahead || 0,
        behind: behind || 0,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get commit diff
router.get('/commit-diff', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const hash = req.query.hash as string;

  if (!repoPath || !hash) {
    throw new AppError('Path and commit hash are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    // Get diff for this commit compared to its parent
    const commitHash = gitArg(hash, 'commit hash');
    const diff = await git.diff([`${commitHash}^`, commitHash, '--']);

    // Get commit details
    const log = await git.log({ from: commitHash, to: commitHash, maxCount: 1 });
    const commit = log.all[0];

    // Parse file changes from diff
    const fileChanges: Array<{
      file: string;
      additions: number;
      deletions: number;
      status: 'added' | 'modified' | 'deleted';
    }> = [];

    // Parse the diff to extract file info
    const diffLines = diff.split('\n');
    let currentFile = '';
    let additions = 0;
    let deletions = 0;

    for (const line of diffLines) {
      if (line.startsWith('diff --git')) {
        // Save previous file if exists
        if (currentFile) {
          fileChanges.push({
            file: currentFile,
            additions,
            deletions,
            status: 'modified',
          });
        }
        // Extract new file name
        const match = line.match(/diff --git a\/.+ b\/(.+)/);
        currentFile = match && match[1] ? match[1] : '';
        additions = 0;
        deletions = 0;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      } else if (line.startsWith('new file mode')) {
        // Mark as added
        if (
          (currentFile && fileChanges.length === 0) ||
          fileChanges[fileChanges.length - 1]?.file !== currentFile
        ) {
          // Will be set when we push
        }
      } else if (line.startsWith('deleted file mode')) {
        // Mark as deleted
      }
    }

    // Push last file
    if (currentFile) {
      fileChanges.push({
        file: currentFile,
        additions,
        deletions,
        status: 'modified',
      });
    }

    res.json({
      success: true,
      data: {
        hash,
        message: commit?.message || '',
        author: commit?.author_name || '',
        date: commit?.date || '',
        diff,
        files: fileChanges,
        totalAdditions: fileChanges.reduce((sum, f) => sum + f.additions, 0),
        totalDeletions: fileChanges.reduce((sum, f) => sum + f.deletions, 0),
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    // Handle first commit (no parent)
    if ((err as Error).message.includes('unknown revision')) {
      const git = getGit(repoPath);
      const commitHash = gitArg(hash, 'commit hash');
      const diff = await git.diff(['--root', commitHash, '--']);
      const log = await git.log({ from: commitHash, to: commitHash, maxCount: 1 });
      const commit = log.all[0];

      res.json({
        success: true,
        data: {
          hash,
          message: commit?.message || '',
          author: commit?.author_name || '',
          date: commit?.date || '',
          diff,
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
        },
      });
      return;
    }
    throw err;
  }
});

// Get file content at specific commit
router.get('/file-at-commit', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const hash = req.query.hash as string;
  const file = req.query.file as string;

  if (!repoPath || !hash || !file) {
    throw new AppError('Path, commit hash, and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    const content = await git.show([`${gitArg(hash, 'commit hash')}:${gitArg(file, 'file')}`]);

    res.json({ success: true, data: { content } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    if ((err as Error).message.includes('does not exist')) {
      res.json({ success: true, data: { content: '' } });
      return;
    }
    throw err;
  }
});

// Compare two commits/refs
router.get('/compare', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const base = req.query.base as string;
  const head = req.query.head as string;

  if (!repoPath || !base || !head) {
    throw new AppError('Path, base, and head refs are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    const baseRef = gitArg(base, 'base ref');
    const headRef = gitArg(head, 'head ref');
    const diff = await git.diff([baseRef, headRef, '--']);

    // Get commit info for both refs
    const baseLog = await git.log({ from: baseRef, to: baseRef, maxCount: 1 });
    const headLog = await git.log({ from: headRef, to: headRef, maxCount: 1 });

    // Parse additions/deletions
    const diffLines = diff.split('\n');
    let additions = 0;
    let deletions = 0;

    for (const line of diffLines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    res.json({
      success: true,
      data: {
        base: {
          ref: base,
          commit: baseLog.all[0] || null,
        },
        head: {
          ref: head,
          commit: headLog.all[0] || null,
        },
        diff,
        additions,
        deletions,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Restore file from a specific commit (undo changes)
router.post('/restore', requireAuth, async (req, res) => {
  const { path: repoPath, file, commit } = req.body;

  if (!repoPath || !file) {
    throw new AppError('Path and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    if (commit) {
      // Restore from specific commit
      await git.checkout([gitArg(commit, 'commit'), '--', gitArg(file, 'file')]);
    } else {
      // Restore from HEAD (discard all changes including staged)
      await git.checkout(['HEAD', '--', gitArg(file, 'file')]);
    }

    res.json({ success: true, data: { restored: file, from: commit || 'HEAD' } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    if ((err as Error).message.includes('did not match')) {
      throw new AppError('File not found in specified commit', 404, 'FILE_NOT_FOUND');
    }
    throw err;
  }
});

// Discard all unstaged changes
router.post('/discard-all', requireAuth, async (req, res) => {
  const { path: repoPath, includeUntracked } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    // Discard all tracked file changes
    await git.checkout(['--', '.']);

    // Optionally remove untracked files
    if (includeUntracked) {
      await git.clean('f', ['-d']);
    }

    const status = await git.status();

    res.json({
      success: true,
      data: {
        isClean: status.isClean(),
        remaining: {
          staged: status.staged,
          unstaged: status.modified,
          untracked: status.not_added,
        },
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Get file history (commits that modified the file)
router.get('/file-history', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string;
  const limit = parseInt(req.query.limit as string) || 20;

  if (!repoPath || !file) {
    throw new AppError('Path and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    const log = await git.log({
      maxCount: limit,
      file: gitArg(file, 'file'),
    });

    const commits = log.all.map((commit) => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
    }));

    res.json({ success: true, data: commits });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Stash changes
router.post('/stash', requireAuth, async (req, res) => {
  const { path: repoPath, message, includeUntracked } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    const stashArgs = ['push'];
    if (message) {
      stashArgs.push('-m', message);
    }
    if (includeUntracked) {
      stashArgs.push('-u');
    }

    await git.stash(stashArgs);

    res.json({ success: true, data: { message: message || 'Changes stashed' } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// List stashes
router.get('/stash/list', requireAuth, async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const stashList = await git.stashList();

    const stashes = stashList.all.map((stash, index) => ({
      index,
      hash: stash.hash,
      message: stash.message,
      date: stash.date,
    }));

    res.json({ success: true, data: stashes });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Apply or pop stash
router.post('/stash/apply', requireAuth, async (req, res) => {
  const { path: repoPath, index, pop } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    if (index !== undefined && !Number.isInteger(Number(index))) {
      throw new AppError('Stash index must be a number', 400, 'INVALID_STASH_INDEX');
    }
    const stashRef = index !== undefined ? `stash@{${Number(index)}}` : undefined;
    const args = stashRef ? [stashRef] : [];

    if (pop) {
      await git.stash(['pop', ...args]);
    } else {
      await git.stash(['apply', ...args]);
    }

    res.json({ success: true, data: { applied: stashRef || 'stash@{0}', popped: !!pop } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

// Generate commit message using AI
router.post('/generate-commit-message', requireAuth, async (req, res) => {
  const { path: repoPath } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    // Get staged diff
    const diff = await git.diff(['--cached']);

    if (!diff.trim()) {
      throw new AppError('No staged changes to generate message for', 400, 'NO_STAGED_CHANGES');
    }

    // Limit diff size to avoid token limits
    const maxDiffLength = 8000;
    const truncatedDiff =
      diff.length > maxDiffLength
        ? diff.substring(0, maxDiffLength) + '\n\n... (diff truncated)'
        : diff;

    const prompt = `Based on this git diff, generate a concise commit message following conventional commits format (feat:, fix:, docs:, refactor:, etc.). Only output the commit message, nothing else. Keep it under 72 characters for the first line. If needed, add a blank line and bullet points for details.

Diff:
${truncatedDiff}`;

    const { runAdminLLM } = await import('../utils/adminLLM.js');
    const { text } = await runAdminLLM(prompt, { cwd: repoPath, timeoutMs: 60_000 });

    // Strip markdown fences if the model wrapped its output.
    const commitMessage = text
      .replace(/^```\w*\n?/gm, '')
      .replace(/```$/gm, '')
      .trim();

    res.json({ success: true, data: { message: commitMessage } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
});

export default router;
