import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { DiscoveredProject } from '@plum-code-webui/shared';

const router = Router();

// Path where Claude Code stores its project data
const getClaudeProjectsDir = () => path.join(os.homedir(), '.claude', 'projects');

/**
 * Decode Claude's path encoding format
 * Claude encodes paths by replacing slashes with hyphens
 * e.g., "-Users-name-project" → "/Users/name/project"
 * e.g., "-mnt-data-projects-myapp" → "/mnt/data/projects/myapp"
 */
function decodeClaudePath(encodedPath: string): string {
  // The format is: -path-to-directory (leading hyphen, hyphens as separators)
  // Convert hyphens back to slashes, but be careful about the leading one
  if (!encodedPath.startsWith('-')) {
    // If it doesn't start with hyphen, it might be a different format
    return encodedPath;
  }

  // Replace leading hyphen with slash, then remaining hyphens with slashes
  return encodedPath.replace(/-/g, '/');
}

/**
 * Extract project name from path
 */
function getProjectName(projectPath: string): string {
  return path.basename(projectPath);
}

// Get all discovered projects
router.get('/', requireAuth, async (_req, res) => {
  const projectsDir = getClaudeProjectsDir();
  const discoveredProjects: DiscoveredProject[] = [];

  try {
    // Check if the projects directory exists
    await fs.access(projectsDir);

    // Read all directories in ~/.claude/projects
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const claudeProjectPath = path.join(projectsDir, entry.name);
      const decodedPath = decodeClaudePath(entry.name);

      try {
        // Get stats for the project directory
        const stats = await fs.stat(claudeProjectPath);

        // Read session files in the project directory
        const projectFiles = await fs.readdir(claudeProjectPath);
        const sessionFiles = projectFiles.filter(
          (f) => f.endsWith('.json') || f.endsWith('.jsonl')
        );

        // Check if the original project path still exists
        let hasSession = false;
        try {
          await fs.access(decodedPath);
          hasSession = true;
        } catch {
          // Project directory no longer exists
        }

        discoveredProjects.push({
          id: Buffer.from(entry.name).toString('base64'),
          name: getProjectName(decodedPath),
          path: decodedPath,
          claudeProjectPath,
          hasSession,
          lastModified: stats.mtime.toISOString(),
          sessionFiles,
        });
      } catch (err) {
        // Skip directories we can't read
        console.warn(`Could not read project directory ${entry.name}:`, err);
      }
    }

    // Sort by last modified date, newest first
    discoveredProjects.sort(
      (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    res.json({ success: true, data: discoveredProjects });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Projects directory doesn't exist yet - that's okay
      res.json({ success: true, data: [] });
      return;
    }
    throw err;
  }
});

// Get session files for a specific project
router.get('/:id/sessions', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  if (!projectId) {
    throw new AppError('Project ID is required', 400, 'MISSING_PROJECT_ID');
  }
  const projectsDir = getClaudeProjectsDir();

  // Decode the project ID to get the directory name
  const dirName = Buffer.from(projectId, 'base64').toString('utf-8');
  const claudeProjectPath = path.join(projectsDir, dirName);

  try {
    const files = await fs.readdir(claudeProjectPath);
    const sessionFiles = [];

    for (const file of files) {
      if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;

      const filePath = path.join(claudeProjectPath, file);
      const stats = await fs.stat(filePath);

      sessionFiles.push({
        name: file,
        path: filePath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    // Sort by modification time, newest first
    sessionFiles.sort(
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );

    res.json({ success: true, data: sessionFiles });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      res.json({ success: true, data: [] });
      return;
    }
    throw err;
  }
});

export default router;
