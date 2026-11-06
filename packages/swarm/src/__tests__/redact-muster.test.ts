// Muster aus ADR-002 §4.4 Befund 3 (Matrix-Session, §4.15): Formate, die die Auffangregel für lange
// Zufallsketten nicht erwischt, weil sie zu kurz sind oder nur Kleinbuchstaben und Ziffern haben.
import { describe, expect, it } from 'vitest';
import { hatGeheimnis, redact } from '../redact.js';

describe('Redaktion: eigene Muster', () => {
  const faelle: [string, string][] = [
    ['Synapse', 'token syt_YWRtaW4_ZXhhbXBsZQ_1a2b3c zu Ende'],
    ['MAS', 'mct_0123456789abcdefABCDEF_xyz'],
    ['Plum-Gateway', 'plum_gw_Q2FmZUJhYmUx'],
    ['AWS', 'Schlüssel AKIAIOSFODNN7EXAMPLE hier'],
    ['Z.AI', 'key 0123456789abcdef0123456789abcdef.AbCdEfGhIjKlMnOp'],
    ['Discord', 'MTE0NzQ2NjI2NjM4MDU2MjU2Mg.GzE1bC.abcdefghijklmnopqrstuvwxyz0123'],
    ['Telegram', '1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawx'],
  ];
  for (const [name, text] of faelle) {
    it(`schwärzt ${name}`, () => {
      expect(hatGeheimnis(text)).toBe(true);
      expect(redact(text)).toContain('[redigiert]');
    });
  }

  it('lässt Matrix-IDs, Auftragsnummern und Hashes in Fehlermeldungen stehen', () => {
    const text =
      '@_sw_codex-host:zwaetschge-webui.ch in !ZDexSH7UHZcz48WURbgIehuoV6IBkTYWVTPQQQubhG0, T-0142, sha 1e44841d';
    expect(redact(text)).toBe(text);
  });
});
