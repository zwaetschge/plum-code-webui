/**
 * Minimal IP / CIDR matcher for "is this TCP peer one of my reverse proxies?".
 *
 * Deliberately dependency-free: `proxy-addr` ships with Express but is not a
 * direct dependency here, and under pnpm's strict node_modules layout it is not
 * resolvable from this package.
 *
 * Only the direct socket peer is ever passed in — never a value taken from a
 * request header, which is what the whole check exists to distrust.
 */

const LOOPBACK = ['127.0.0.0/8', '::1/128'];
const PRIVATE = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
];

type ParsedAddress = { value: bigint; bits: 32 | 128 };

function parseIPv4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIPv6(text: string): bigint | null {
  // An IPv4-mapped tail ("::ffff:10.0.0.1") is expanded to two hex groups first.
  let work = text;
  const lastColon = work.lastIndexOf(':');
  const tail = lastColon >= 0 ? work.slice(lastColon + 1) : '';
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    const high = (v4 >> 16n) & 0xffffn;
    const low = v4 & 0xffffn;
    work = `${work.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = work.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;

  let groups: string[];
  if (rest === null) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  }

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/** Normalize an address string. IPv4-mapped IPv6 collapses to plain IPv4 so a
 *  `10.0.0.0/8` rule still matches a peer reported as `::ffff:10.1.2.3`. */
export function parseAddress(text: string | undefined | null): ParsedAddress | null {
  if (!text) return null;
  let work = text.trim();
  if (!work) return null;
  // Strip a bracketed / zone-suffixed form: "[::1]" or "fe80::1%eth0".
  if (work.startsWith('[') && work.endsWith(']')) work = work.slice(1, -1);
  const zone = work.indexOf('%');
  if (zone >= 0) work = work.slice(0, zone);

  if (work.includes(':')) {
    const lower = work.toLowerCase();
    if (lower.startsWith('::ffff:') && lower.includes('.')) {
      const v4 = parseIPv4(work.slice(work.lastIndexOf(':') + 1));
      if (v4 !== null) return { value: v4, bits: 32 };
    }
    const v6 = parseIPv6(work);
    return v6 === null ? null : { value: v6, bits: 128 };
  }

  const v4 = parseIPv4(work);
  return v4 === null ? null : { value: v4, bits: 32 };
}

function matchesRule(addr: ParsedAddress, rule: string): boolean {
  const slash = rule.indexOf('/');
  const base = parseAddress(slash >= 0 ? rule.slice(0, slash) : rule);
  if (!base || base.bits !== addr.bits) return false;

  const prefix = slash >= 0 ? Number(rule.slice(slash + 1)) : base.bits;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > base.bits) return false;

  const shift = BigInt(base.bits - prefix);
  return addr.value >> shift === base.value >> shift;
}

/**
 * @param address the direct socket peer (`req.socket.remoteAddress`)
 * @param rules   IPs, CIDRs, or the keywords `loopback`, `private`/`uniquelocal`, `any`
 *
 * An address that cannot be parsed is never trusted, not even under `any` —
 * "I could not tell who this is" is not an answer to trust.
 */
export function isTrustedAddress(address: string | undefined | null, rules: string[]): boolean {
  if (rules.length === 0) return false;
  const addr = parseAddress(address);
  if (!addr) return false;

  for (const raw of rules) {
    const rule = raw.trim().toLowerCase();
    if (!rule) continue;
    if (rule === 'any' || rule === '*') return true;
    if (rule === 'loopback') {
      if (LOOPBACK.some((cidr) => matchesRule(addr, cidr))) return true;
      continue;
    }
    if (rule === 'private' || rule === 'uniquelocal') {
      if (PRIVATE.some((cidr) => matchesRule(addr, cidr))) return true;
      continue;
    }
    if (matchesRule(addr, rule)) return true;
  }
  return false;
}
