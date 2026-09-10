import { Router } from 'express';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import multer from 'multer';
import archiver from 'archiver';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { get as pgGet } from '../db/pg.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { sanitizeFilename, ALLOWED_UPLOAD_MIME_TYPES } from '../utils/sanitize.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';
import type { FileInfo, DirectoryContents } from '@plum-code-webui/shared';
import { applyUntrustedFileHeaders } from '../utils/untrustedFile.js';

// CSV parsing helper
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0] || '');
  const rows = lines.slice(1).map(parseRow);

  return { headers, rows };
}

/**
 * Work out where an upload goes.
 *
 * Multer calls `destination` the moment it reaches the file part, so `req.body`
 * only holds the text fields that were sent *before* it — whether
 * `targetDirectory` in the body is visible at all depends on the order the
 * client happened to append its form fields in. The query parameter is the
 * dependable channel and is checked first; `sessionId` is accepted as well so a
 * client can just name the session and let the server resolve its working
 * directory (the Android file manager did exactly that and every upload failed
 * with "Target directory is required").
 */
async function resolveUploadDirectory(req: Express.Request): Promise<string> {
  const query = (req as unknown as { query: Record<string, unknown> }).query;
  const body = ((req as unknown as { body?: Record<string, unknown> }).body || {}) as Record<
    string,
    unknown
  >;
  const pick = (value: unknown): string =>
    typeof value === 'string' && value.trim() ? value.trim() : '';

  const targetDir = pick(query.targetDirectory) || pick(body.targetDirectory);
  if (targetDir) return targetDir;

  const sessionId = pick(query.sessionId) || pick(body.sessionId);
  if (sessionId) {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const row = (await pgGet(
      'SELECT working_directory AS workingDirectory FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    )) as { workingDirectory?: string } | undefined;
    if (row?.workingDirectory) return row.workingDirectory;
  }

  throw new Error(
    'Target directory is required — pass ?targetDirectory=… or ?sessionId=… in the query string'
  );
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    let targetDir: string;
    try {
      targetDir = await resolveUploadDirectory(req);
    } catch (err) {
      return cb(err as Error, '');
    }
    try {
      const resolvedPath = path.resolve(targetDir);
      if (!isAllowedBasePath(resolvedPath)) {
        return cb(new Error('Path not allowed'), '');
      }
      // Ensure directory exists
      await fs.mkdir(resolvedPath, { recursive: true });
      cb(null, resolvedPath);
    } catch (err) {
      cb(err as Error, '');
    }
  },
  filename: (_req, file, cb) => {
    // Sanitize filename to prevent path traversal and other attacks
    const sanitized = sanitizeFilename(file.originalname);
    cb(null, sanitized);
  },
});

// File filter for MIME type validation
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  // Allow known MIME types
  if (ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  // Browsers often send empty or generic MIME types for code/config files.
  // Allow files with no MIME type or with a text/* type we haven't listed.
  if (!file.mimetype || file.mimetype === '' || file.mimetype.startsWith('text/')) {
    cb(null, true);
    return;
  }
  console.warn(
    `Upload rejected: unsupported MIME type ${file.mimetype} for file ${file.originalname}`
  );
  cb(null, false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

const router = Router();

// Get home directory and common paths
router.get('/home', requireAuth, async (_req, res) => {
  const homeDir = os.homedir();

  // Check for common directory names (English and German variants)
  const possiblePaths = [
    { name: 'Home', paths: [homeDir] },
    {
      name: 'Documents',
      paths: [path.join(homeDir, 'Documents'), path.join(homeDir, 'Dokumente')],
    },
    { name: 'Projects', paths: [path.join(homeDir, 'Projects'), path.join(homeDir, 'Projekte')] },
    {
      name: 'Desktop',
      paths: [path.join(homeDir, 'Desktop'), path.join(homeDir, 'Schreibtisch')],
    },
    { name: 'Downloads', paths: [path.join(homeDir, 'Downloads')] },
  ];

  const commonPaths: { name: string; path: string }[] = [];

  for (const item of possiblePaths) {
    // Find the first path that exists
    for (const p of item.paths) {
      try {
        await fs.access(p);
        // Path exists, check if it's allowed
        if (isAllowedBasePath(p)) {
          commonPaths.push({ name: item.name, path: p });
          break; // Found one, move to next item
        }
      } catch {
        // Path doesn't exist, try next
      }
    }
  }

  res.json({
    success: true,
    data: {
      homeDir,
      allowedPaths: config.allowedBasePaths,
      commonPaths,
    },
  });
});

// Validate path is within allowed directories
function validatePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (!isAllowedBasePath(resolvedPath)) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }

  return resolvedPath;
}

// Get file extension
function getExtension(filename: string): string | undefined {
  const ext = path.extname(filename);
  return ext ? ext.slice(1) : undefined;
}

// List directory contents
router.get('/', requireAuth, async (req, res) => {
  const dirPath = req.query.path as string;

  if (!dirPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(dirPath);

  try {
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (entry): Promise<FileInfo | null> => {
        const fullPath = path.join(resolvedPath, entry.name);
        try {
          const stats = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            extension: entry.isFile() ? getExtension(entry.name) : undefined,
          };
        } catch {
          // Skip files we can't stat (permission denied, etc.)
          return null;
        }
      })
    );

    // Filter out null entries (files we couldn't stat)
    const validFiles = files.filter((f): f is FileInfo => f !== null);

    // Sort: directories first, then by name
    validFiles.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const result: DirectoryContents = {
      path: resolvedPath,
      files: validFiles,
    };

    res.json({ success: true, data: result });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('Directory not found', 404, 'NOT_FOUND');
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new AppError('Path is not a directory', 400, 'NOT_DIRECTORY');
    }
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new AppError('Permission denied', 403, 'PERMISSION_DENIED');
    }
    throw err;
  }
});

// Get file content
router.get('/content', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
    }

    // Limit file size (e.g., 1MB)
    if (stats.size > 1024 * 1024) {
      throw new AppError('File too large', 400, 'FILE_TOO_LARGE');
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');

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

// Create directory
router.post('/mkdir', requireAuth, async (req, res) => {
  const { path: dirPath } = req.body;

  if (!dirPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(dirPath);

  try {
    await fs.mkdir(resolvedPath, { recursive: true });
    res.json({ success: true, data: { path: resolvedPath } });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AppError('Directory already exists', 409, 'ALREADY_EXISTS');
    }
    throw err;
  }
});

// Save file content
router.put('/content', requireAuth, async (req, res) => {
  const { path: filePath, content } = req.body;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  if (content === undefined) {
    throw new AppError('Content is required', 400, 'MISSING_CONTENT');
  }

  const resolvedPath = validatePath(filePath);

  try {
    // Check if the path is a file (not a directory)
    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.isDirectory()) {
        throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
      }
    } catch (err) {
      // File doesn't exist - that's okay, we'll create it
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new AppError('Permission denied', 403, 'PERMISSION_DENIED');
    }
    throw err;
  }
});

// Delete file or directory
router.delete('/', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true });
    } else {
      await fs.unlink(resolvedPath);
    }

    res.json({ success: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File or directory not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
});

// Upload files (with rate limiting)
router.post('/upload', requireAuth, rateLimiters.upload, (req, res) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: { message: 'File too large (max 50MB)', code: 'FILE_TOO_LARGE' },
          });
        }
        return res.status(400).json({
          success: false,
          error: { message: err.message, code: err.code },
        });
      }
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 'UPLOAD_ERROR' },
      });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No files uploaded', code: 'NO_FILES' },
      });
    }

    const uploadedFiles = files.map((file) => ({
      name: file.originalname,
      path: file.path,
      size: file.size,
    }));

    return res.json({
      success: true,
      data: { files: uploadedFiles },
    });
  });
});

// Preview file (CSV, XLSX with data extraction)
router.get('/preview', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;
  const maxRows = parseInt(req.query.maxRows as string) || 100;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);
  const ext = path.extname(resolvedPath).toLowerCase();

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
    }

    // Handle different file types
    if (ext === '.csv') {
      // Limit file size for CSV (5MB)
      if (stats.size > 5 * 1024 * 1024) {
        throw new AppError('File too large for preview', 400, 'FILE_TOO_LARGE');
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');
      const parsed = parseCSV(content);

      return res.json({
        success: true,
        data: {
          type: 'csv',
          path: resolvedPath,
          headers: parsed.headers,
          rows: parsed.rows.slice(0, maxRows),
          totalRows: parsed.rows.length,
          truncated: parsed.rows.length > maxRows,
        },
      });
    }

    if (ext === '.xlsx' || ext === '.xls') {
      // exceljs replaces xlsx (CVE-2023-30533 / prototype pollution). .xls (legacy BIFF)
      // is not supported by exceljs — reject early with a clear message.
      if (ext === '.xls') {
        throw new AppError(
          'Legacy .xls files are not supported. Re-save as .xlsx.',
          415,
          'UNSUPPORTED_FORMAT'
        );
      }
      try {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(resolvedPath);

        const sheets: Record<string, { headers: string[]; rows: string[][]; totalRows: number }> =
          {};
        const sheetNames: string[] = [];

        workbook.eachSheet((sheet) => {
          sheetNames.push(sheet.name);

          const allRows: string[][] = [];
          sheet.eachRow({ includeEmpty: false }, (row) => {
            const values = row.values as unknown[];
            // ExcelJS row.values is 1-indexed with index 0 undefined — drop it.
            const cells = Array.isArray(values) ? values.slice(1) : [];
            allRows.push(cells.map((c) => (c == null ? '' : String(c))));
          });

          const headers = allRows[0] ?? [];
          const dataRows = allRows.slice(1, maxRows + 1);

          sheets[sheet.name] = {
            headers,
            rows: dataRows,
            totalRows: Math.max(allRows.length - 1, 0),
          };
        });

        return res.json({
          success: true,
          data: {
            type: 'xlsx',
            path: resolvedPath,
            sheets,
            sheetNames,
          },
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Failed to parse Excel file', 400, 'PARSE_ERROR');
      }
    }

    if (ext === '.json') {
      // Limit file size (2MB)
      if (stats.size > 2 * 1024 * 1024) {
        throw new AppError('File too large for preview', 400, 'FILE_TOO_LARGE');
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');
      try {
        const parsed = JSON.parse(content);
        return res.json({
          success: true,
          data: {
            type: 'json',
            path: resolvedPath,
            content: parsed,
            size: stats.size,
          },
        });
      } catch {
        throw new AppError('Invalid JSON file', 400, 'PARSE_ERROR');
      }
    }

    // For other text files, return raw content
    if (stats.size > 1024 * 1024) {
      throw new AppError('File too large for preview', 400, 'FILE_TOO_LARGE');
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    return res.json({
      success: true,
      data: {
        type: 'text',
        path: resolvedPath,
        content,
        size: stats.size,
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
});

// Download file as attachment
router.get('/download', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
    }

    const filename = path.basename(resolvedPath).replace(/[\r\n"]/g, '');
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_') || 'download';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);

    const stream = createReadStream(resolvedPath);
    stream.pipe(res);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
});

// Directory trees that are never worth shipping in a workspace download: they
// are regenerated from the lockfile or the remote, and they dwarf everything
// else. `?full=1` includes them anyway.
const FOLDER_DOWNLOAD_SKIPPED_DIRS = ['node_modules', '.git', '.pnpm-store'];

// Download a directory as a streamed ZIP archive
router.get('/download-folder', requireAuth, async (req, res) => {
  const dirPath = req.query.path as string;
  const includeAll = req.query.full === '1' || req.query.full === 'true';

  if (!dirPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(dirPath);

  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('Directory not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new AppError('Path is not a directory', 400, 'NOT_DIRECTORY');
  }

  const folderName = (path.basename(resolvedPath) || 'folder').replace(/[\r\n"]/g, '');
  const filename = `${folderName}.zip`;
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Content-Type', 'application/zip');
  // The size is unknown up front; the archive streams straight to the socket.
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  let finished = false;
  archive.on('warning', (err) => {
    // ENOENT/EACCES on a single entry (file vanished mid-walk, unreadable
    // socket) should not kill the whole download.
    console.warn(`[FILES] Folder download warning for ${resolvedPath}: ${err.message}`);
  });
  archive.on('error', (err) => {
    console.error(`[FILES] Folder download failed for ${resolvedPath}:`, err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: { message: 'Failed to build archive', code: 'ARCHIVE_FAILED' },
      });
    } else {
      res.destroy(err);
    }
  });
  res.on('close', () => {
    // Client went away: stop walking the tree instead of compressing into the void.
    if (!finished) archive.abort();
  });

  archive.pipe(res);
  const skipped = includeAll ? [] : FOLDER_DOWNLOAD_SKIPPED_DIRS;
  archive.glob(
    '**/*',
    {
      cwd: resolvedPath,
      dot: true,
      follow: false,
      // `skip` stops the walk at the directory itself; `ignore` covers anything
      // the matcher still reports underneath it.
      skip: skipped.map((dir) => `**/${dir}`),
      ignore: skipped.map((dir) => `**/${dir}/**`),
    },
    { prefix: folderName }
  );
  await archive.finalize();
  finished = true;
});

// Get file as binary (for PDFs, images, etc.)
router.get('/binary', requireAuth, async (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);
  const ext = path.extname(resolvedPath).toLowerCase();

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
    }

    // Limit file size (20MB for binary files)
    if (stats.size > 20 * 1024 * 1024) {
      throw new AppError('File too large', 400, 'FILE_TOO_LARGE');
    }

    // Set appropriate content type
    const contentTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.htm': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.cjs': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.xml': 'application/xml; charset=utf-8',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.m4v': 'video/x-m4v',
      '.ogv': 'video/ogg',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.wasm': 'application/wasm',
    };

    const forcedDownload = applyUntrustedFileHeaders(res, resolvedPath);
    if (!forcedDownload) {
      const contentType = contentTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
    }
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const stream = createReadStream(resolvedPath);
    stream.pipe(res);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
});

export default router;
