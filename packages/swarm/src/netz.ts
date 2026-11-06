/** Kleine Netzprüfungen für mehrere Bausteine (Türsteher, Betrieb). */
import { isIP } from 'node:net';

/** Öffentliche IPv4/IPv6-Adresse, normalisiert, oder null. Private Netze, Loopback und Multicast zählen nicht. */
export function oeffentlicheIp(roh: string): string | null {
  const ip = String(roh ?? '').trim();
  const art = isIP(ip);
  if (!art) return null;
  if (art === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
      return null;
    return ip;
  }
  const klein = ip.toLowerCase();
  if (
    klein === '::1' ||
    klein === '::' ||
    klein.startsWith('fe80:') ||
    klein.startsWith('fc') ||
    klein.startsWith('fd') ||
    klein.startsWith('ff')
  )
    return null;
  return klein;
}
