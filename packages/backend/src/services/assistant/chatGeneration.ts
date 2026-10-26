import { estimateModelCost } from '@plum-code-webui/shared';
import {
  apiChatEndpoint,
  streamApiChat,
  type ApiMessage,
  type ApiStreamResult,
  type ApiUsage,
} from './apiTransport.js';
import { chatToolset } from './chatTools.js';
import type { ChatOptions } from './chatOptions.js';
import { redactSensitiveText } from '../../utils/sanitize.js';

export interface ChatToolEvent {
  id: string;
  name: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  arguments?: string;
  result?: string;
}
export interface ChatComparison {
  providerId: string;
  model: string;
  response: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  usage?: ApiUsage | null;
}
export interface ChatWorkbench {
  toolEvents: ChatToolEvent[];
  comparisons: ChatComparison[];
  sources: unknown[];
  documentSourceIds: string[];
}
export async function generateChat(options: {
  userId: string;
  providerId: string;
  model: string;
  system: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  effort?: Parameters<typeof streamApiChat>[6];
  settings: ChatOptions;
  onUsage?: (
    key: string,
    providerId: string,
    model: string,
    status: 'running' | 'completed' | 'failed',
    usage: ApiUsage | null
  ) => Promise<void>;
  workbench: ChatWorkbench;
  onText: (text: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  approveTool?: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
    onReady: () => Promise<void>
  ) => Promise<boolean>;
}): Promise<ApiStreamResult & { costUsd: number | null }> {
  const { userId, signal, workbench, settings } = options;
  const ledger: Array<{ model: string; usage: ApiUsage | null }> = [];
  const tools = await chatToolset(userId, settings, signal);
  try {
    const endpoint = await apiChatEndpoint(userId, options.providerId, options.model);
    const history = [...options.messages];
    const primary = async () => {
      for (let round = 0; round <= 6; round++) {
        let text = '';
        const key = round ? `round:${round}` : '';
        await options.onUsage?.(key, options.providerId, options.model, 'running', null);
        let result: ApiStreamResult;
        try {
          result = await streamApiChat(
            endpoint,
            options.model,
            options.system,
            history,
            signal,
            async (delta) => {
              text += delta;
              await options.onText(delta);
            },
            options.effort,
            {
              tools: round < 6 ? tools.tools : [],
              temperature: settings.temperature,
              maxOutputTokens: settings.maxOutputTokens,
            }
          );
        } catch (error) {
          await options.onUsage?.(key, options.providerId, options.model, 'failed', null);
          throw error;
        }
        await options.onUsage?.(key, options.providerId, result.model, 'completed', result.usage);
        ledger.push({ model: result.model, usage: result.usage });
        if (!result.toolCalls?.length) return result;
        if (round >= 6) throw new Error('Werkzeuglimit erreicht');
        history.push({
          role: 'assistant',
          content: text,
          toolCalls: result.toolCalls,
          nativeBlocks: result.nativeBlocks,
        });
        for (const call of result.toolCalls.slice(0, 12)) {
          signal.throwIfAborted();
          const event: ChatToolEvent = { id: call.id, name: call.name, status: 'running' };
          workbench.toolEvents.push(event);
          await options.onUpdate();
          try {
            const args = JSON.parse(call.arguments);
            if (!args || Array.isArray(args) || typeof args !== 'object')
              throw new Error('Ungültige Werkzeugargumente');
            if (tools.requiresApproval(call.name)) {
              if (!options.approveTool) throw new Error('Werkzeugentscheidung nicht verfügbar');
              event.status = 'waiting';
              event.arguments = redactSensitiveText(JSON.stringify(args)).slice(0, 16000);
              // Create the durable request before publishing its decision controls.
              if (!(await options.approveTool(call.id, call.name, args, options.onUpdate))) {
                event.result = 'Werkzeugaufruf vom Nutzer abgelehnt. Keine Ausführung.';
                event.status = 'failed';
              } else {
                signal.throwIfAborted();
                event.result = await tools.call(call.name, args, true);
                event.status = 'completed';
              }
            } else {
              event.result = await tools.call(call.name, args);
              event.status = 'completed';
            }
          } catch {
            event.result = 'Werkzeugaufruf fehlgeschlagen. Keine Ergebnisse verfügbar.';
            event.status = 'failed';
          }
          history.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: event.result,
          });
          await options.onUpdate();
        }
        if (result.toolCalls.length > 12) throw new Error('Zu viele Werkzeugaufrufe');
      }
      throw new Error('Werkzeuglimit erreicht');
    };
    const seen = new Set([`${options.providerId}:${options.model}`]);
    const candidates = settings.comparisonModels.filter((c) => {
      const key = `${c.providerId}:${c.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    workbench.comparisons = candidates.map((c) => ({ ...c, response: '', status: 'running' }));
    await options.onUpdate();
    const runs = await Promise.allSettled([
      primary(),
      ...workbench.comparisons.map(async (candidate, index) => {
        const key = `compare:${index}`;
        await options.onUsage?.(key, candidate.providerId, candidate.model, 'running', null);
        try {
          const other = await apiChatEndpoint(userId, candidate.providerId, candidate.model);
          let last = 0;
          const result = await streamApiChat(
            other,
            candidate.model,
            options.system +
              '\nAnswer directly using the supplied sources. This comparison run has no tools.',
            options.messages,
            signal,
            async (text) => {
              if (candidate.response.length + text.length > 50000) throw new Error('Antwortlimit');
              candidate.response += text;
              if (Date.now() - last > 500) {
                last = Date.now();
                await options.onUpdate();
              }
            },
            options.effort,
            { temperature: settings.temperature, maxOutputTokens: settings.maxOutputTokens }
          );
          await options.onUsage?.(
            key,
            candidate.providerId,
            result.model,
            'completed',
            result.usage
          );
          candidate.usage = result.usage;
          candidate.status = 'completed';
          ledger.push({ model: result.model, usage: result.usage });
        } catch {
          await options.onUsage?.(key, candidate.providerId, candidate.model, 'failed', null);
          candidate.status = 'failed';
          candidate.error = signal.aborted ? 'Gestoppt' : 'Modellantwort fehlgeschlagen';
        }
        await options.onUpdate();
      }),
    ]);
    const main = runs[0]!;
    if (main.status !== 'fulfilled' || !main.value)
      throw main.status === 'rejected' ? main.reason : new Error('Antwort fehlt');
    const usage: ApiUsage = { input: 0, output: 0, cached: 0, cacheWrite: 0 };
    let cost = 0,
      known = true;
    for (const item of ledger) {
      if (!item.usage) {
        known = false;
        continue;
      }
      for (const key of ['input', 'output', 'cached', 'cacheWrite'] as const)
        usage[key] += item.usage[key];
      const price = estimateModelCost(item.model, {
        inputTokens: item.usage.input,
        outputTokens: item.usage.output,
        cacheReadTokens: item.usage.cached,
        cacheCreationTokens: item.usage.cacheWrite,
      });
      if (price.known) cost += price.cost;
      else known = false;
    }
    return {
      ...main.value,
      usage: ledger.some((l) => l.usage) ? usage : null,
      costUsd: known ? cost : null,
    };
  } finally {
    tools.close();
  }
}
