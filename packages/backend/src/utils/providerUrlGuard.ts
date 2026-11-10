import net from 'node:net';

/**
 * Where a user-supplied model provider URL may point.
 *
 * The provider registry is per account and its base URL is free text; the
 * server then talks to it with the server's network position. An account that
 * may run agents can reach the internal network anyway, and local model
 * servers on the LAN are a real use (`allowPrivateNetwork`). Every other
 * account is held to public hosts, so the registry is not a way to probe
 * services that only the server can see.
 *
 * Structural rules apply to everyone: http(s) only, no credentials in the URL,
 * and no query or fragment — `…/x?` in front of the appended `/models` or
 * `/chat/completions` would turn the path into anything.
 */
export function providerBaseUrlProblem(
  raw: string,
  options: { allowPrivateNetwork: boolean }
): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'The base URL is not a valid URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The base URL must start with http:// or https://.';
  }
  if (url.username || url.password) return 'The base URL must not contain credentials.';
  // Tested on the text: a bare trailing `?` parses to an empty query, and that
  // is exactly the form that swallows the appended path.
  if (/[?#]/.test(raw)) return 'The base URL must not contain a query or fragment.';
  if (options.allowPrivateNetwork) return null;

  return isPublicHost(url.hostname)
    ? null
    : 'This account can only use providers on public hosts; local and internal addresses need an operator account.';
}

/** A host name or address literal that is certainly not internal. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return false;

  if (net.isIPv4(host)) return isPublicIpv4(host);
  if (net.isIPv6(host)) return isPublicIpv6(host);

  // Names that resolve inside the deployment: single labels are container and
  // service names, the suffixes are local by definition.
  if (!host.includes('.')) return false;
  if (
    /(^|\.)(localhost|local|internal|lan|home|intranet|corp|localdomain|home\.arpa)$/.test(host)
  ) {
    return false;
  }
  return true;
}

function isPublicIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return false;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh): judge the embedded address.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted?.[1]) return isPublicIpv4(dotted[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped?.[1] && hexMapped[2]) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isPublicIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
  return true;
}
