/**
 * Retention von Hand: `node dist/cli/aufraeumen.js [--tage N] [--vorschau]`
 * (ADR-002 §4.25). Ohne --tage gilt SCHWARM_RETENTION_TAGE, Standard 30.
 */
import { aufraeumen, retentionVorschau, RETENTION_TAGE } from '../wartung.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--tage');
  const tage = i >= 0 ? Number(argv[i + 1]) : RETENTION_TAGE;
  if (!Number.isFinite(tage) || tage < 1) {
    console.error('--tage braucht eine Zahl >= 1');
    process.exit(2);
  }
  const zahlen = argv.includes('--vorschau')
    ? await retentionVorschau(tage)
    : await aufraeumen(tage);
  console.log(
    `${zahlen ? 'Betrifft' : 'Gelöscht'}: ${zahlen.inbox} Inbox · ${zahlen.outbox} Outbox · ` +
      `${zahlen.artefakte} Artefakte (${zahlen.mib} MiB) · Tage ${tage}`
  );
  if (!zahlen.inbox && !zahlen.outbox && !zahlen.artefakte) console.log('Nichts zu tun.');
}

main().catch((err) => {
  console.error('Aufräumen fehlgeschlagen:', err);
  process.exit(2);
});
