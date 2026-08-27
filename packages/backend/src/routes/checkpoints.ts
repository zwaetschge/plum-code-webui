import {
  get as pgGet,
  all as pgAll,
  run as pgRun,
  transaction as pgTransaction,
} from '../db/pg.js';
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get all checkpoints for a session
router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { sessionId } = req.params;

  try {
    // Verify session belongs to user
    const session = await pgGet(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      authReq.userId
    );

    if (!session) {
      return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    const checkpoints = await pgAll(
      `
      SELECT id, session_id, name, description, message_count, created_at
      FROM session_checkpoints
      WHERE session_id = ?
      ORDER BY created_at DESC
    `,
      sessionId
    );

    res.json({ success: true, data: checkpoints });
  } catch (error) {
    console.error('Error fetching checkpoints:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch checkpoints' } });
  }
});

// Get a specific checkpoint
router.get('/:checkpointId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { checkpointId } = req.params;

  try {
    const checkpoint = (await pgGet(
      `
      SELECT c.*, s.user_id
      FROM session_checkpoints c
      JOIN sessions s ON s.id = c.session_id
      WHERE c.id = ?
    `,
      checkpointId
    )) as unknown as
      | {
          id: string;
          session_id: string;
          name: string;
          description: string;
          message_count: number;
          snapshot_data: string;
          created_at: string;
          user_id: string;
        }
      | undefined;

    if (!checkpoint) {
      return res.status(404).json({ success: false, error: { message: 'Checkpoint not found' } });
    }

    if (checkpoint.user_id !== authReq.userId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    // Parse snapshot data
    const snapshotData = JSON.parse(checkpoint.snapshot_data);

    res.json({
      success: true,
      data: {
        id: checkpoint.id,
        sessionId: checkpoint.session_id,
        name: checkpoint.name,
        description: checkpoint.description,
        messageCount: checkpoint.message_count,
        createdAt: checkpoint.created_at,
        snapshot: snapshotData,
      },
    });
  } catch (error) {
    console.error('Error fetching checkpoint:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch checkpoint' } });
  }
});

// Create a checkpoint
router.post('/', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { sessionId, name, description } = req.body;

  if (!sessionId || !name) {
    return res
      .status(400)
      .json({ success: false, error: { message: 'Session ID and name are required' } });
  }

  try {
    // Verify session belongs to user
    const session = (await pgGet(
      'SELECT id, working_directory FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      authReq.userId
    )) as unknown as { id: string; working_directory: string } | undefined;

    if (!session) {
      return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    // Get current messages for the session
    const messages = await pgAll(
      `
      -- Only columns that exist. The list used to name tool_calls, tool_results,
      -- is_partial, is_interrupted, cost_usd and model, none of which are on this
      -- table, so every attempt to create a checkpoint failed with "no such
      -- column: tool_calls" and surfaced as a 500.
      SELECT id, role, content, chat_id, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `,
      sessionId
    );

    // Create snapshot data
    const snapshotData = {
      messages,
      workingDirectory: session.working_directory,
      timestamp: new Date().toISOString(),
    };

    const checkpointId = randomUUID();

    await pgRun(
      `
      INSERT INTO session_checkpoints (id, session_id, name, description, message_count, snapshot_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      checkpointId,
      sessionId,
      name,
      description || null,
      messages.length,
      JSON.stringify(snapshotData)
    );

    const checkpoint = await pgGet(
      `
      SELECT id, session_id, name, description, message_count, created_at
      FROM session_checkpoints
      WHERE id = ?
    `,
      checkpointId
    );

    res.json({ success: true, data: checkpoint });
  } catch (error) {
    console.error('Error creating checkpoint:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create checkpoint' } });
  }
});

// Update a checkpoint (name/description only)
router.put('/:checkpointId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { checkpointId } = req.params;
  const { name, description } = req.body;

  try {
    // Verify checkpoint belongs to user
    const checkpoint = (await pgGet(
      `
      SELECT c.id, s.user_id
      FROM session_checkpoints c
      JOIN sessions s ON s.id = c.session_id
      WHERE c.id = ?
    `,
      checkpointId
    )) as unknown as { id: string; user_id: string } | undefined;

    if (!checkpoint) {
      return res.status(404).json({ success: false, error: { message: 'Checkpoint not found' } });
    }

    if (checkpoint.user_id !== authReq.userId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    await pgRun(
      `
      UPDATE session_checkpoints
      SET name = COALESCE(?, name), description = ?
      WHERE id = ?
    `,
      name,
      description || null,
      checkpointId
    );

    const updated = await pgGet(
      `
      SELECT id, session_id, name, description, message_count, created_at
      FROM session_checkpoints
      WHERE id = ?
    `,
      checkpointId
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating checkpoint:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update checkpoint' } });
  }
});

// Delete a checkpoint
router.delete('/:checkpointId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { checkpointId } = req.params;

  try {
    // Verify checkpoint belongs to user
    const checkpoint = (await pgGet(
      `
      SELECT c.id, s.user_id
      FROM session_checkpoints c
      JOIN sessions s ON s.id = c.session_id
      WHERE c.id = ?
    `,
      checkpointId
    )) as unknown as { id: string; user_id: string } | undefined;

    if (!checkpoint) {
      return res.status(404).json({ success: false, error: { message: 'Checkpoint not found' } });
    }

    if (checkpoint.user_id !== authReq.userId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    await pgRun('DELETE FROM session_checkpoints WHERE id = ?', checkpointId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting checkpoint:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete checkpoint' } });
  }
});

// Restore a checkpoint (replaces session messages with checkpoint state)
router.post('/:checkpointId/restore', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { checkpointId } = req.params;

  try {
    // Get checkpoint with user verification
    const checkpoint = (await pgGet(
      `
      SELECT c.*, s.user_id
      FROM session_checkpoints c
      JOIN sessions s ON s.id = c.session_id
      WHERE c.id = ?
    `,
      checkpointId
    )) as unknown as
      | { id: string; session_id: string; snapshot_data: string; user_id: string }
      | undefined;

    if (!checkpoint) {
      return res.status(404).json({ success: false, error: { message: 'Checkpoint not found' } });
    }

    if (checkpoint.user_id !== authReq.userId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    const snapshotData = JSON.parse(checkpoint.snapshot_data);

    await pgTransaction(async (tx) => {
      await tx.run('DELETE FROM messages WHERE session_id = ?', checkpoint.session_id);

      for (const msg of snapshotData.messages) {
        await tx.run(
          `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_results,
                                 is_partial, is_interrupted, cost_usd, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          msg.id,
          checkpoint.session_id,
          msg.role,
          msg.content,
          msg.tool_calls,
          msg.tool_results,
          msg.is_partial ? 1 : 0,
          msg.is_interrupted ? 1 : 0,
          msg.cost_usd,
          msg.model,
          msg.created_at
        );
      }
    });

    res.json({
      success: true,
      data: {
        sessionId: checkpoint.session_id,
        messagesRestored: snapshotData.messages.length,
      },
    });
  } catch (error) {
    console.error('Error restoring checkpoint:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to restore checkpoint' } });
  }
});

// Compare two checkpoints
router.get('/compare/:checkpoint1/:checkpoint2', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { checkpoint1, checkpoint2 } = req.params;

  try {
    // Get both checkpoints
    const cp1 = (await pgGet(
      `
      SELECT c.*, s.user_id
      FROM session_checkpoints c
      JOIN sessions s ON s.id = c.session_id
      WHERE c.id = ?
    `,
      checkpoint1
    )) as unknown as
      | {
          snapshot_data: string;
          user_id: string;
          name: string;
          message_count: number;
          created_at: string;
        }
      | undefined;

    const cp2 = (await pgGet(
      `
      SELECT c.*, s.user_id
      FROM session_checkpoints c
      JOIN sessions s ON s.id = c.session_id
      WHERE c.id = ?
    `,
      checkpoint2
    )) as unknown as
      | {
          snapshot_data: string;
          user_id: string;
          name: string;
          message_count: number;
          created_at: string;
        }
      | undefined;

    if (!cp1 || !cp2) {
      return res
        .status(404)
        .json({ success: false, error: { message: 'One or both checkpoints not found' } });
    }

    if (cp1.user_id !== authReq.userId || cp2.user_id !== authReq.userId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    const snapshot1 = JSON.parse(cp1.snapshot_data);
    const snapshot2 = JSON.parse(cp2.snapshot_data);

    // Find message differences
    const messageIds1 = new Set(snapshot1.messages.map((m: { id: string }) => m.id));
    const messageIds2 = new Set(snapshot2.messages.map((m: { id: string }) => m.id));

    const onlyIn1 = snapshot1.messages.filter((m: { id: string }) => !messageIds2.has(m.id));
    const onlyIn2 = snapshot2.messages.filter((m: { id: string }) => !messageIds1.has(m.id));
    const common = snapshot1.messages.filter((m: { id: string }) => messageIds2.has(m.id));

    res.json({
      success: true,
      data: {
        checkpoint1: { name: cp1.name, messageCount: cp1.message_count, createdAt: cp1.created_at },
        checkpoint2: { name: cp2.name, messageCount: cp2.message_count, createdAt: cp2.created_at },
        comparison: {
          onlyInFirst: onlyIn1.length,
          onlyInSecond: onlyIn2.length,
          common: common.length,
          messagesOnlyInFirst: onlyIn1,
          messagesOnlyInSecond: onlyIn2,
        },
      },
    });
  } catch (error) {
    console.error('Error comparing checkpoints:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to compare checkpoints' } });
  }
});

export default router;
