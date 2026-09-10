import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { githubService } from '../services/github.js';
import { githubCli } from '../services/githubCli.js';

const router = Router();

// Validation schemas
const createRepoSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  description: z.string().max(500).optional(),
  private: z.boolean().optional(),
  auto_init: z.boolean().optional(),
});

// `z.string().url()` happily accepts `file://`, `git://` and `ssh://`, which as a
// clone source reads local directories and as a remote is somewhere to push
// commits to. The service layer enforces the same rule for every caller; this is
// the earlier, cheaper rejection.
const githubUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      if (/^git@github\.com:[\w.-]+\/[\w.-]+(\.git)?$/.test(value)) return true;
      try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        return parsed.protocol === 'https:' && (host === 'github.com' || host === 'www.github.com');
      } catch {
        return false;
      }
    },
    { message: 'Must be an https://github.com/... URL' }
  );

/** A ref or remote name that git would otherwise read as an option. */
const gitNameSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('-'), { message: 'Must not start with "-"' });

const cloneRepoSchema = z.object({
  url: githubUrlSchema,
  targetDir: z.string().min(1),
  branch: gitNameSchema.optional(),
});

const pushSchema = z.object({
  workingDirectory: z.string().min(1),
  remote: gitNameSchema.optional(),
  branch: gitNameSchema.optional(),
  force: z.boolean().optional(),
});

const addRemoteSchema = z.object({
  workingDirectory: z.string().min(1),
  remoteName: gitNameSchema,
  repoUrl: githubUrlSchema,
});

// Validate token
router.get('/token/validate', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const result = await githubService.validateToken(userId);
  res.json({ success: true, data: result });
});

// Get authenticated user
router.get('/user', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const user = await githubService.getUser(userId);

  if (!user) {
    throw new AppError('Failed to get GitHub user', 401, 'GITHUB_AUTH_ERROR');
  }

  res.json({ success: true, data: user });
});

// List repositories
router.get('/repos', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const page = parseInt(req.query.page as string) || 1;
  const perPage = Math.min(parseInt(req.query.per_page as string) || 30, 100);

  const result = await githubService.listRepos(userId, page, perPage);
  res.json({ success: true, data: result });
});

// Create repository
router.post('/repos', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createRepoSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const result = await githubService.createRepo(userId, parsed.data);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to create repository', 400, 'CREATE_REPO_ERROR');
  }

  res.status(201).json({ success: true, data: result.repo });
});

// Clone repository
router.post('/clone', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = cloneRepoSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { url, targetDir, branch } = parsed.data;
  const result = await githubService.cloneRepo(userId, url, targetDir, branch);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to clone repository', 400, 'CLONE_ERROR');
  }

  res.json({ success: true, data: { path: result.path } });
});

// Push to GitHub
router.post('/push', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = pushSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { workingDirectory, remote, branch, force } = parsed.data;
  const result = await githubService.pushToGitHub(userId, workingDirectory, remote, branch, force);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to push to GitHub', 400, 'PUSH_ERROR');
  }

  res.json({ success: true });
});

// Add remote
router.post('/remote', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = addRemoteSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { workingDirectory, remoteName, repoUrl } = parsed.data;
  const result = await githubService.addRemote(userId, workingDirectory, remoteName, repoUrl);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to add remote', 400, 'REMOTE_ERROR');
  }

  res.json({ success: true });
});

// Get rate limit status
router.get('/rate-limit', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const status = await githubService.getRateLimitStatus(userId);

  if (!status) {
    throw new AppError('Failed to get rate limit status', 401, 'GITHUB_AUTH_ERROR');
  }

  res.json({ success: true, data: status });
});

// ── gh-backed collaboration surface ──────────────────────────────────────────
// Pull requests, CI, issues and releases go through the CLI rather than
// Octokit: gh is authenticated once for the deployment, so these work without
// each user first creating a personal access token.

const workdirSchema = z.object({ workingDirectory: z.string().min(1) });
const listQuerySchema = workdirSchema.extend({
  state: z.enum(['open', 'closed', 'merged', 'all']).optional().default('open'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  branch: z.string().max(255).optional(),
});

function parseQuery<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }
  return parsed.data;
}

router.get('/cli/status', requireAuth, async (_req, res) => {
  res.json({ success: true, data: { available: await githubCli.isAvailable() } });
});

router.get('/cli/repo', requireAuth, async (req, res) => {
  const { workingDirectory } = parseQuery(workdirSchema, req.query);
  res.json({ success: true, data: await githubCli.repoInfo(workingDirectory) });
});

router.get('/pulls', requireAuth, async (req, res) => {
  const { workingDirectory, state, limit } = parseQuery(listQuerySchema, req.query);
  const data = await githubCli.listPullRequests(workingDirectory, state, limit);
  res.json({ success: true, data });
});

router.post('/pulls', requireAuth, async (req, res) => {
  const body = parseQuery(
    workdirSchema.extend({
      title: z.string().trim().min(1).max(255),
      body: z.string().max(60_000).optional(),
      base: z.string().max(255).optional(),
      head: z.string().max(255).optional(),
      draft: z.boolean().optional(),
    }),
    req.body
  );
  const { workingDirectory, ...input } = body;
  res.json({ success: true, data: await githubCli.createPullRequest(workingDirectory, input) });
});

router.post('/pulls/:number/merge', requireAuth, async (req, res) => {
  const prNumber = Number(req.params.number);
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new AppError('Invalid pull request number', 400, 'VALIDATION_ERROR');
  }
  const body = parseQuery(
    workdirSchema.extend({
      method: z.enum(['merge', 'squash', 'rebase']).optional().default('squash'),
      deleteBranch: z.boolean().optional().default(false),
    }),
    req.body
  );
  const data = await githubCli.mergePullRequest(
    body.workingDirectory,
    prNumber,
    body.method,
    body.deleteBranch
  );
  res.json({ success: true, data });
});

router.get('/runs', requireAuth, async (req, res) => {
  const { workingDirectory, limit, branch } = parseQuery(listQuerySchema, req.query);
  const data = await githubCli.listWorkflowRuns(workingDirectory, limit, branch);
  res.json({ success: true, data });
});

router.post('/runs/:id/rerun', requireAuth, async (req, res) => {
  const runId = Number(req.params.id);
  if (!Number.isInteger(runId) || runId < 1) {
    throw new AppError('Invalid run id', 400, 'VALIDATION_ERROR');
  }
  const body = parseQuery(
    workdirSchema.extend({ failedOnly: z.boolean().optional().default(false) }),
    req.body
  );
  const data = await githubCli.rerunWorkflow(body.workingDirectory, runId, body.failedOnly);
  res.json({ success: true, data });
});

router.get('/runs/:id/failure-log', requireAuth, async (req, res) => {
  const runId = Number(req.params.id);
  if (!Number.isInteger(runId) || runId < 1) {
    throw new AppError('Invalid run id', 400, 'VALIDATION_ERROR');
  }
  const { workingDirectory } = parseQuery(workdirSchema, req.query);
  res.json({ success: true, data: await githubCli.runFailureLog(workingDirectory, runId) });
});

router.get('/issues', requireAuth, async (req, res) => {
  const { workingDirectory, state, limit } = parseQuery(listQuerySchema, req.query);
  const data = await githubCli.listIssues(workingDirectory, state, limit);
  res.json({ success: true, data });
});

router.post('/issues', requireAuth, async (req, res) => {
  const body = parseQuery(
    workdirSchema.extend({
      title: z.string().trim().min(1).max(255),
      body: z.string().max(60_000).optional(),
    }),
    req.body
  );
  const data = await githubCli.createIssue(body.workingDirectory, {
    title: body.title,
    body: body.body,
  });
  res.json({ success: true, data });
});

router.get('/releases', requireAuth, async (req, res) => {
  const { workingDirectory, limit } = parseQuery(listQuerySchema, req.query);
  res.json({ success: true, data: await githubCli.listReleases(workingDirectory, limit) });
});

export default router;
