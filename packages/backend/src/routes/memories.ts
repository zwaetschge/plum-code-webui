import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { isAllowedBasePath, isPathInside } from '../utils/allowedPaths.js';

const router = Router();

/**
 * Encode a working directory path to Claude's project directory format.
 * e.g., "/mnt/cache/appdata/plum-code-webui" -> "-mnt-cache-appdata-plum-code-webui"
 */
function encodeClaudePath(workingDirectory: string): string {
  return workingDirectory.replace(/\//g, '-');
}

/**
 * Get the memory directory path for a given working directory.
 * Memory files are stored in: ~/.claude/projects/<encoded-path>/memory/
 */
export function resolveMemoryDirectory(workingDirectory: string): string {
  const resolvedWorkingDirectory = path.resolve(workingDirectory);
  if (!isAllowedBasePath(resolvedWorkingDirectory)) {
    throw new AppError('Working directory not allowed', 403, 'FORBIDDEN_PATH');
  }
  const encoded = encodeClaudePath(resolvedWorkingDirectory);
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory');
}

/**
 * Validate that a file path is within the memory directory (prevent path traversal).
 */
function validateMemoryPath(filePath: string, memoryDir: string): string {
  const resolved = path.resolve(filePath);
  if (!isPathInside(memoryDir, resolved)) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }
  return resolved;
}

// List all memory files
router.get('/', requireAuth, async (req, res) => {
  const workingDirectory = req.query.workingDirectory as string;

  if (!workingDirectory) {
    throw new AppError('workingDirectory is required', 400, 'MISSING_PARAM');
  }

  const memoryDir = resolveMemoryDirectory(workingDirectory);

  try {
    await fs.access(memoryDir);
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });

    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map(async (entry) => {
          const filePath = path.join(memoryDir, entry.name);
          const stats = await fs.stat(filePath);
          return {
            name: entry.name,
            path: filePath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          };
        })
    );

    // Sort: MEMORY.md first, then by modification date (newest first)
    files.sort((a, b) => {
      if (a.name === 'MEMORY.md') return -1;
      if (b.name === 'MEMORY.md') return 1;
      return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    });

    res.json({ success: true, data: { memoryDir, files } });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      res.json({ success: true, data: { memoryDir, files: [] } });
      return;
    }
    throw err;
  }
});

// Read a memory file
router.get('/content', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;
  const workingDirectory = req.query.workingDirectory as string;

  if (!filePath || !workingDirectory) {
    throw new AppError('path and workingDirectory are required', 400, 'MISSING_PARAM');
  }

  const memoryDir = resolveMemoryDirectory(workingDirectory);
  const resolvedPath = validateMemoryPath(filePath, memoryDir);

  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const stats = await fs.stat(resolvedPath);

    res.json({
      success: true,
      data: {
        path: resolvedPath,
        content,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
});

// Write/update a memory file
router.put('/content', requireAuth, async (req, res) => {
  const { path: filePath, content, workingDirectory } = req.body;

  if (!filePath || content === undefined || !workingDirectory) {
    throw new AppError('path, content, and workingDirectory are required', 400, 'MISSING_PARAM');
  }

  const memoryDir = resolveMemoryDirectory(workingDirectory);

  // Ensure memory directory exists
  await fs.mkdir(memoryDir, { recursive: true });

  const resolvedPath = validateMemoryPath(filePath, memoryDir);

  await fs.writeFile(resolvedPath, content, 'utf-8');
  const stats = await fs.stat(resolvedPath);

  res.json({
    success: true,
    data: {
      path: resolvedPath,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    },
  });
});

// Create a new memory file
router.post('/', requireAuth, async (req, res) => {
  const { name, content, workingDirectory } = req.body;

  if (!name || !workingDirectory) {
    throw new AppError('name and workingDirectory are required', 400, 'MISSING_PARAM');
  }

  if (!name.endsWith('.md')) {
    throw new AppError('Memory files must be .md files', 400, 'INVALID_EXTENSION');
  }

  const memoryDir = resolveMemoryDirectory(workingDirectory);

  // Ensure memory directory exists
  await fs.mkdir(memoryDir, { recursive: true });

  const filePath = path.join(memoryDir, name);
  const resolvedPath = validateMemoryPath(filePath, memoryDir);

  // Check if file already exists
  try {
    await fs.access(resolvedPath);
    throw new AppError('File already exists', 409, 'ALREADY_EXISTS');
  } catch (err) {
    if ((err as AppError).statusCode === 409) throw err;
    // File doesn't exist - good
  }

  await fs.writeFile(resolvedPath, content || '', 'utf-8');
  const stats = await fs.stat(resolvedPath);

  res.json({
    success: true,
    data: {
      name,
      path: resolvedPath,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    },
  });
});

// Delete a memory file
router.delete('/', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;
  const workingDirectory = req.query.workingDirectory as string;

  if (!filePath || !workingDirectory) {
    throw new AppError('path and workingDirectory are required', 400, 'MISSING_PARAM');
  }

  const memoryDir = resolveMemoryDirectory(workingDirectory);
  const resolvedPath = validateMemoryPath(filePath, memoryDir);

  try {
    await fs.unlink(resolvedPath);
    res.json({ success: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
});

export default router;
