import { get as pgGet, all as pgAll, run as pgRun } from '../db/pg.js';
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { safeJsonParse } from '../utils/json.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

interface CustomAgent {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model: string;
  allowed_tools: string | null;
  permission_mode: string;
  icon: string;
  color: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

// Get all custom agents for the user
router.get('/', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const agents = (await pgAll(
      `
      SELECT id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color, enabled, created_at, updated_at
      FROM custom_agents
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
      authReq.userId
    )) as unknown as CustomAgent[];

    // Parse allowed_tools JSON for each agent
    const parsedAgents = agents.map((agent) => ({
      ...agent,
      allowedTools: safeJsonParse<string[]>(agent.allowed_tools, []),
      enabled: !!agent.enabled,
    }));

    res.json({ success: true, data: parsedAgents });
  } catch (error) {
    console.error('Error fetching custom agents:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch custom agents' } });
  }
});

// Get a specific custom agent
router.get('/:agentId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const { agentId } = req.params;

  try {
    const agent = (await pgGet(
      `
      SELECT id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color, enabled, created_at, updated_at
      FROM custom_agents
      WHERE id = ? AND user_id = ?
    `,
      agentId,
      authReq.userId
    )) as unknown as CustomAgent | undefined;

    if (!agent) {
      return res.status(404).json({ success: false, error: { message: 'Agent not found' } });
    }

    res.json({
      success: true,
      data: {
        ...agent,
        allowedTools: safeJsonParse<string[]>(agent.allowed_tools, []),
        enabled: !!agent.enabled,
      },
    });
  } catch (error) {
    console.error('Error fetching custom agent:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch custom agent' } });
  }
});

// Create a custom agent
router.post('/', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const {
    name,
    description,
    systemPrompt,
    model = 'gpt-5.5',
    allowedTools = [],
    permissionMode = 'auto-accept',
    icon = 'bot',
    color = 'violet',
  } = req.body;

  if (!name || !systemPrompt) {
    return res.status(400).json({
      success: false,
      error: { message: 'Name and system prompt are required' },
    });
  }

  try {
    const agentId = randomUUID();

    await pgRun(
      `
      INSERT INTO custom_agents (id, user_id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      agentId,
      authReq.userId,
      name,
      description || null,
      systemPrompt,
      model,
      JSON.stringify(allowedTools),
      permissionMode,
      icon,
      color
    );

    const agent = (await pgGet(
      `
      SELECT id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color, enabled, created_at, updated_at
      FROM custom_agents
      WHERE id = ?
    `,
      agentId
    )) as unknown as CustomAgent;

    res.json({
      success: true,
      data: {
        ...agent,
        allowedTools: safeJsonParse<string[]>(agent.allowed_tools, []),
        enabled: !!agent.enabled,
      },
    });
  } catch (error) {
    console.error('Error creating custom agent:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create custom agent' } });
  }
});

// Update a custom agent
router.put('/:agentId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const { agentId } = req.params;
  const {
    name,
    description,
    systemPrompt,
    model,
    allowedTools,
    permissionMode,
    icon,
    color,
    enabled,
  } = req.body;

  try {
    // Verify agent belongs to user
    const existing = await pgGet(
      'SELECT id FROM custom_agents WHERE id = ? AND user_id = ?',
      agentId,
      authReq.userId
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: { message: 'Agent not found' } });
    }

    await pgRun(
      `
      UPDATE custom_agents
      SET
        name = COALESCE(?, name),
        description = ?,
        system_prompt = COALESCE(?, system_prompt),
        model = COALESCE(?, model),
        allowed_tools = ?,
        permission_mode = COALESCE(?, permission_mode),
        icon = COALESCE(?, icon),
        color = COALESCE(?, color),
        enabled = COALESCE(?, enabled),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      name,
      description !== undefined ? description : null,
      systemPrompt,
      model,
      allowedTools !== undefined ? JSON.stringify(allowedTools) : null,
      permissionMode,
      icon,
      color,
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      agentId
    );

    const agent = (await pgGet(
      `
      SELECT id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color, enabled, created_at, updated_at
      FROM custom_agents
      WHERE id = ?
    `,
      agentId
    )) as unknown as CustomAgent;

    res.json({
      success: true,
      data: {
        ...agent,
        allowedTools: safeJsonParse<string[]>(agent.allowed_tools, []),
        enabled: !!agent.enabled,
      },
    });
  } catch (error) {
    console.error('Error updating custom agent:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update custom agent' } });
  }
});

// Delete a custom agent
router.delete('/:agentId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const { agentId } = req.params;

  try {
    // Verify agent belongs to user
    const existing = await pgGet(
      'SELECT id FROM custom_agents WHERE id = ? AND user_id = ?',
      agentId,
      authReq.userId
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: { message: 'Agent not found' } });
    }

    await pgRun('DELETE FROM custom_agents WHERE id = ?', agentId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting custom agent:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete custom agent' } });
  }
});

// Duplicate a custom agent
router.post('/:agentId/duplicate', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const { agentId } = req.params;

  try {
    const original = (await pgGet(
      `
      SELECT name, description, system_prompt, model, allowed_tools, permission_mode, icon, color
      FROM custom_agents
      WHERE id = ? AND user_id = ?
    `,
      agentId,
      authReq.userId
    )) as unknown as CustomAgent | undefined;

    if (!original) {
      return res.status(404).json({ success: false, error: { message: 'Agent not found' } });
    }

    const newId = randomUUID();
    const newName = `${original.name} (Copy)`;

    await pgRun(
      `
      INSERT INTO custom_agents (id, user_id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      newId,
      authReq.userId,
      newName,
      original.description,
      original.system_prompt,
      original.model,
      original.allowed_tools,
      original.permission_mode,
      original.icon,
      original.color
    );

    const agent = (await pgGet(
      `
      SELECT id, name, description, system_prompt, model, allowed_tools, permission_mode, icon, color, enabled, created_at, updated_at
      FROM custom_agents
      WHERE id = ?
    `,
      newId
    )) as unknown as CustomAgent;

    res.json({
      success: true,
      data: {
        ...agent,
        allowedTools: safeJsonParse<string[]>(agent.allowed_tools, []),
        enabled: !!agent.enabled,
      },
    });
  } catch (error) {
    console.error('Error duplicating custom agent:', error);
    res
      .status(500)
      .json({ success: false, error: { message: 'Failed to duplicate custom agent' } });
  }
});

// Get preset agent templates
router.get('/presets/templates', async (_req: Request, res: Response) => {
  // Provide some built-in presets users can start with
  const presets = [
    {
      id: 'code-reviewer',
      name: 'Code Reviewer',
      description: 'Reviews code for best practices, bugs, and improvements',
      systemPrompt: `You are an expert code reviewer. Your role is to:
- Review code for bugs, security vulnerabilities, and potential issues
- Suggest improvements for code quality, readability, and maintainability
- Follow industry best practices and coding standards
- Provide constructive, actionable feedback
- Consider performance implications

Be thorough but constructive in your reviews.`,
      icon: 'search',
      color: 'blue',
    },
    {
      id: 'documentation-writer',
      name: 'Documentation Writer',
      description: 'Creates clear, comprehensive documentation',
      systemPrompt: `You are a technical documentation specialist. Your role is to:
- Write clear, concise documentation
- Create comprehensive API documentation
- Write user guides and tutorials
- Document code with proper comments
- Ensure documentation is accessible to the target audience

Focus on clarity and completeness.`,
      icon: 'file-text',
      color: 'green',
    },
    {
      id: 'test-engineer',
      name: 'Test Engineer',
      description: 'Writes comprehensive tests and improves test coverage',
      systemPrompt: `You are a test engineering expert. Your role is to:
- Write comprehensive unit tests
- Create integration and end-to-end tests
- Improve test coverage
- Identify edge cases and error conditions
- Follow testing best practices (AAA pattern, mocking, etc.)

Prioritize test quality and coverage.`,
      icon: 'check-circle',
      color: 'cyan',
    },
    {
      id: 'refactoring-expert',
      name: 'Refactoring Expert',
      description: 'Improves code structure and reduces technical debt',
      systemPrompt: `You are a refactoring and code quality expert. Your role is to:
- Identify code smells and technical debt
- Apply appropriate refactoring patterns
- Improve code structure and organization
- Reduce complexity and duplication
- Maintain backward compatibility

Make incremental, safe improvements.`,
      icon: 'settings',
      color: 'orange',
    },
    {
      id: 'security-auditor',
      name: 'Security Auditor',
      description: 'Identifies security vulnerabilities and recommends fixes',
      systemPrompt: `You are a security auditing expert. Your role is to:
- Identify security vulnerabilities (OWASP Top 10, etc.)
- Review authentication and authorization logic
- Check for injection attacks, XSS, CSRF
- Verify secure data handling practices
- Recommend security improvements

Prioritize critical security issues.`,
      icon: 'shield',
      color: 'red',
    },
    {
      id: 'performance-optimizer',
      name: 'Performance Optimizer',
      description: 'Identifies and fixes performance bottlenecks',
      systemPrompt: `You are a performance optimization expert. Your role is to:
- Identify performance bottlenecks
- Optimize database queries and algorithms
- Reduce memory usage and CPU overhead
- Improve load times and responsiveness
- Suggest caching strategies

Focus on measurable performance improvements.`,
      icon: 'zap',
      color: 'yellow',
    },
    {
      id: 'devops-engineer',
      name: 'DevOps Engineer',
      description: 'Handles CI/CD, Docker, Kubernetes, and infrastructure',
      systemPrompt: `You are a DevOps and infrastructure expert. Your role is to:
- Configure CI/CD pipelines (GitHub Actions, GitLab CI, etc.)
- Write and optimize Dockerfiles and docker-compose configurations
- Set up Kubernetes manifests and Helm charts
- Configure infrastructure as code (Terraform, Pulumi)
- Optimize build and deployment processes
- Implement monitoring and logging solutions

Focus on automation, reproducibility, and security best practices.`,
      icon: 'settings',
      color: 'cyan',
    },
    {
      id: 'database-specialist',
      name: 'Database Specialist',
      description: 'Expert in database design, SQL, and data modeling',
      systemPrompt: `You are a database and data modeling expert. Your role is to:
- Design efficient database schemas
- Write and optimize SQL queries
- Create and manage database migrations
- Implement data validation and constraints
- Optimize query performance with indexes
- Design data access patterns and repositories

Prioritize data integrity, performance, and maintainability.`,
      icon: 'code',
      color: 'violet',
    },
    {
      id: 'git-operations',
      name: 'Git Operations',
      description: 'Handles complex git workflows and version control',
      systemPrompt: `You are a Git and version control expert. Your role is to:
- Resolve complex merge conflicts
- Manage branch strategies and workflows
- Perform interactive rebasing and history cleanup
- Set up git hooks and automation
- Handle submodules and subtrees
- Recover from git disasters

Always prioritize preserving work and maintaining clean history.`,
      icon: 'code',
      color: 'orange',
    },
    {
      id: 'debugging-expert',
      name: 'Debugging Expert',
      description: 'Diagnoses bugs, errors, and performance issues',
      systemPrompt: `You are a debugging and troubleshooting expert. Your role is to:
- Diagnose error messages and stack traces
- Identify root causes of bugs
- Profile and fix performance bottlenecks
- Analyze logs and metrics
- Create minimal reproduction cases
- Suggest debugging strategies and tools

Be systematic: gather evidence, form hypotheses, test methodically.`,
      icon: 'search',
      color: 'red',
    },
    {
      id: 'system-architect',
      name: 'System Architect',
      description: 'Designs system architecture and technical solutions',
      systemPrompt: `You are a software architect. Your role is to:
- Design system architectures and component interactions
- Evaluate technology choices and trade-offs
- Create technical specifications and diagrams
- Define API contracts and data flows
- Plan for scalability and maintainability
- Document architectural decisions (ADRs)

Consider both immediate needs and long-term evolution.`,
      icon: 'zap',
      color: 'blue',
    },
  ];

  res.json({ success: true, data: presets });
});

export default router;
