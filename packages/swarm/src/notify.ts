/**
 * ntfy direkt vom Hub (§10.5): Er meldet auch, wenn council-core aus ist.
 * Fire-and-forget — eine Benachrichtigung darf keinen Auftrag aufhalten.
 */
import { env } from './env.js';

export interface NotifyOptions {
  title: string;
  text: string;
  /** 1–5, ntfy-Priorität. 4 = hoch, 5 = max (Klingeln). */
  priority?: number;
  tags?: string[];
}

export async function notify(
  o: NotifyOptions,
  log?: { warn: (m: unknown) => void }
): Promise<void> {
  if (!env.ntfyUrl || !env.ntfyTopic) return;
  const url = `${env.ntfyUrl.replace(/\/$/, '')}/${env.ntfyTopic}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        ...(env.ntfyToken ? { authorization: `Bearer ${env.ntfyToken}` } : {}),
        title: o.title,
        priority: String(o.priority ?? 3),
        ...(o.tags?.length ? { tags: o.tags.join(',') } : {}),
      },
      body: o.text,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log?.warn(`ntfy nicht erreicht: ${(err as Error).message}`);
  }
}
