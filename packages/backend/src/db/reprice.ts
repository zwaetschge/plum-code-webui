import type { TransactionScope } from './pg.js';
import { LLM_PRICING_RATE_CARD_VERSION, resolveModelPricing } from '@plum-code-webui/shared';

/**
 * Bring `usage_history.cost_usd` back in line with the current price table.
 *
 * Costs are estimates derived from token counts, not amounts anyone was
 * actually invoiced, so a stored row is only ever as good as the rate card that
 * was loaded when it was written. Mixing two cards inside one `SUM(cost_usd)`
 * produces a number that means nothing — and the rate card does move: the entry
 * for Claude Sonnet 5 carries "Anthropic introductory API pricing through
 * 2026-08-31" in its own source string.
 *
 * `LLM_PRICING_RATE_CARD_VERSION` is part of the migration id, so bumping the
 * constant schedules exactly one repricing pass on the next boot of every
 * deployment, and never repeats it.
 */
export const REPRICE_MIGRATION_ID = `004-reprice-${LLM_PRICING_RATE_CARD_VERSION}`;

/**
 * Rows whose model the current card does not recognise are left alone rather
 * than zeroed. "Unknown models remain unpriced" is the rule for *new* rows;
 * applying it backwards would silently destroy the only cost figure those rows
 * ever had. The analytics "Pricing Health" panel keeps showing them as a delta,
 * which is the honest signal that the card has no entry for that model.
 */
export async function repriceUsageHistory(tx: TransactionScope): Promise<number> {
  const models = (await tx.all(
    'SELECT DISTINCT model FROM usage_history WHERE model IS NOT NULL AND model <> ?',
    ''
  )) as Array<{ model: string }>;

  let repriced = 0;
  for (const { model } of models) {
    const pricing = resolveModelPricing(model);
    if (!pricing) continue;

    // Per-row arithmetic in SQL: the price is constant for the model, the token
    // counts are not. One statement per distinct model instead of one per row.
    // Rounded to micro-dollars so repeated passes converge instead of drifting
    // through float noise.
    const result = await tx.run(
      `UPDATE usage_history
          SET cost_usd = round(
            (
              input_tokens::numeric          / 1000000 * ?
              + output_tokens::numeric        / 1000000 * ?
              + cache_read_tokens::numeric    / 1000000 * ?
              + cache_creation_tokens::numeric / 1000000 * ?
            )::numeric, 6)
        WHERE model = ?`,
      pricing.input,
      pricing.output,
      pricing.cacheRead,
      pricing.cacheWrite,
      model
    );
    repriced += result.changes;
  }

  if (repriced > 0) {
    console.log(
      `[migrations] Repriced ${repriced} usage_history rows to rate card ${LLM_PRICING_RATE_CARD_VERSION}`
    );
  }
  return repriced;
}
