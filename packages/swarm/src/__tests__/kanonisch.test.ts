import { describe, expect, it } from 'vitest';
import { kanonisch } from '../appservice/client.js';

describe('kanonisch (Raumversion 12 verbietet Kommazahlen)', () => {
  it('macht Kommazahlen zu Text und lässt ganze Zahlen stehen', () => {
    const karte = {
      v: 1,
      limits: { parallel: 1, budget_usd_day: 3, usd_per_minute: 0.025 },
      tags: [1.5, 2],
      name: 'Brian',
    };
    expect(kanonisch(karte)).toEqual({
      v: 1,
      limits: { parallel: 1, budget_usd_day: 3, usd_per_minute: '0.025' },
      tags: ['1.5', 2],
      name: 'Brian',
    });
  });
  it('behandelt Zahlen ausserhalb des sicheren Bereichs als Text', () => {
    expect(kanonisch({ gross: 2 ** 60, neg: -1, null: null, ok: true })).toEqual({
      gross: String(2 ** 60),
      neg: -1,
      null: null,
      ok: true,
    });
  });
});
