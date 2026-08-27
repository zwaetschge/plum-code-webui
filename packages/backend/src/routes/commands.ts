import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { commandService } from '../services/commands.js';

const router = Router();

// Get available commands
router.get('/', requireAuth, async (req, res) => {
  const projectPath = req.query.projectPath as string | undefined;
  const commands = await commandService.getAvailableCommands(projectPath);

  res.json({ success: true, data: commands });
});

// Execute a command
router.post('/execute', requireAuth, async (req, res) => {
  const { input, projectPath, sessionId, currentModel, provider, usage } = req.body;

  const parsed = commandService.parseCommand(input);
  if (!parsed) {
    res.json({
      success: false,
      data: {
        success: false,
        error: 'Invalid command format. Commands must start with /',
      },
    });
    return;
  }

  const result = await commandService.executeCommand(parsed, {
    projectPath,
    sessionId,
    currentModel,
    provider,
    usage,
  });

  res.json({ success: true, data: result });
});

// Process file references in text
router.post('/process-files', requireAuth, async (req, res) => {
  const { text, workingDirectory } = req.body;

  if (!text || !workingDirectory) {
    res.json({ success: true, data: { text } });
    return;
  }

  const processed = await commandService.processFileReferences(text, workingDirectory);
  res.json({ success: true, data: { text: processed } });
});

// Parse command (without executing)
router.post('/parse', requireAuth, async (_req, res) => {
  const { input } = _req.body;

  const parsed = commandService.parseCommand(input);
  res.json({ success: true, data: parsed });
});

export default router;
