/**
 * Ein Takt für die Bausteine aus matrix/PLAN-weiter.md. So braucht `index.ts` nur eine Zeile, und jeder
 * Baustein bestimmt seinen eigenen Rhythmus. Ein Fehler in einem Baustein hält die anderen nicht auf.
 */
import type { Ctx } from './context.js'
import { releaseMelden, releaseZustand } from './release.js'
import { tuersteherVeroeffentlichen } from './tuersteher.js'
import { kontingenteVeroeffentlichen } from './kontingente.js'
import { routinenTakt, routinenVeroeffentlichen } from './routinen.js'
import { tokenpflegeTakt } from './tokenpflege.js'
import { profilTakt } from './profil.js'
import { lernenTakt } from './lernen.js'
import { gedaechtnisTakt } from './gedaechtnis.js'
import { ablaeufeTakt } from './ablaeufe.js'
import { gaesteTakt } from './gaeste.js'
import { kennzahlenTakt } from './kennzahlen.js'
import { plumRueckTakt } from './plumrueck.js'
import { modelleVeroeffentlichen } from './modelle.js'
import { vorlesenTakt } from './vorlesen.js'
import { stimmenTakt } from './stimmen.js'
import { tagesberichtTakt } from './tagesbericht.js'
import { pushTakt } from './push.js'
import { litellmTakt } from './litellm.js'

export const WEITER_TAKT_MS = Number(process.env.WEITER_TAKT_MS || 30_000)

type Baustein = { name: string; lauf: (ctx: Ctx) => Promise<unknown> }

const BAUSTEINE: Baustein[] = [
  { name: 'release', lauf: releaseMelden },
  { name: 'release-stand', lauf: releaseZustand },
  { name: 'tuersteher', lauf: tuersteherVeroeffentlichen },
  { name: 'kontingente', lauf: kontingenteVeroeffentlichen },
  { name: 'routinen', lauf: routinenTakt },
  { name: 'routinen-stand', lauf: routinenVeroeffentlichen },
  { name: 'tokenpflege', lauf: tokenpflegeTakt },
  { name: 'profil', lauf: profilTakt },
  { name: 'lernen', lauf: lernenTakt },
  { name: 'gedaechtnis', lauf: gedaechtnisTakt },
  { name: 'ablaeufe', lauf: ablaeufeTakt },
  { name: 'gaeste', lauf: gaesteTakt },
  { name: 'kennzahlen', lauf: kennzahlenTakt },
  { name: 'plum-rueck', lauf: plumRueckTakt },
  { name: 'modelle', lauf: modelleVeroeffentlichen },
  { name: 'vorlesen', lauf: vorlesenTakt },
  { name: 'stimmen', lauf: stimmenTakt },
  { name: 'tagesbericht', lauf: tagesberichtTakt },
  { name: 'ruhe', lauf: pushTakt },
  { name: 'litellm', lauf: litellmTakt },
]

/** Weitere Bausteine hängen sich hier an (Routinen, Kontingente, Token-Pflege …). */
export function bausteinDazu(name: string, lauf: (ctx: Ctx) => Promise<unknown>): void {
  if (!BAUSTEINE.some((b) => b.name === name)) BAUSTEINE.push({ name, lauf })
}

export async function weiterTakt(ctx: Ctx): Promise<void> {
  for (const b of BAUSTEINE) {
    try {
      await b.lauf(ctx)
    } catch (err) {
      ctx.log.warn({ err, baustein: b.name }, `Baustein ${b.name} fehlgeschlagen`)
    }
  }
}
