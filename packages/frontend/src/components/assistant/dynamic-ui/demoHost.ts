import { uiLiveKey, type UiResult } from '@plum-code-webui/shared';
import type { DynamicUiHost } from './host';
import { DEMO_ENTITIES } from './fixtures-v2';

/*
 * The demo page renders without network access to third parties: fixture
 * image URLs become generated SVG illustrations, entity links read fixtures.
 */

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
function seeded(seed: number) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (state % 10000) / 10000;
  };
}

const PALETTES = [
  ['#2b3a67', '#f6a96b', '#ffd38a', '#8a6f9e', '#5b4b7d', '#2f2850'],
  ['#4b9be0', '#d6ecfb', '#fff6d5', '#9cb9cf', '#6489a5', '#33556f'],
  ['#1d2b53', '#ff8c69', '#ffcf73', '#8a5479', '#553a60', '#2a1f3b'],
  ['#3a78c4', '#e9f3fc', '#ffffff', '#c3d0dd', '#7f95aa', '#435a70'],
  ['#86c0e6', '#f3f8ea', '#fff3c9', '#86ad84', '#55825f', '#2e5641'],
] as const;

function ridge(rand: () => number, base: number, amplitude: number, peaks: number, spike?: number) {
  const points: string[] = ['0,600'];
  const steps = 18;
  for (let index = 0; index <= steps; index++) {
    const x = (index / steps) * 800;
    let y = base - Math.abs(Math.sin((index / steps) * Math.PI * peaks + rand() * 0.6)) * amplitude;
    y += (rand() - 0.5) * amplitude * 0.35;
    if (spike !== undefined && Math.abs(x - spike) < 70)
      y = base - amplitude * 2.1 + Math.abs(x - spike) * 2.2;
    points.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  points.push('800,600');
  return points.join(' ');
}

function landscape(name: string) {
  const seed = hash(name);
  const rand = seeded(seed);
  const palette = PALETTES[seed % PALETTES.length]!;
  const [skyTop, skyBottom, sun, m1, m2, m3] = palette;
  const alpine = /matterhorn|jungfrau|alps|glacier/.test(name);
  const lake = /lake|see|marathon/.test(name);
  const spike = /matterhorn/.test(name) ? 300 + rand() * 200 : undefined;
  const sunX = 140 + rand() * 520;
  const sunY = 120 + rand() * 110;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient>
<radialGradient id="g"><stop offset="0" stop-color="${sun}" stop-opacity=".9"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/></radialGradient>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m2}"/><stop offset="1" stop-color="${skyTop}"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#s)"/>
<circle cx="${sunX}" cy="${sunY}" r="150" fill="url(#g)"/><circle cx="${sunX}" cy="${sunY}" r="38" fill="${sun}"/>
<polygon points="${ridge(rand, 360, 110, 2.2, spike)}" fill="${m1}"/>
${alpine ? `<polygon points="${ridge(rand, 330, 70, 3.1)}" fill="#f4f8fc" opacity=".55"/>` : ''}
<polygon points="${ridge(rand, 430, 80, 3.4)}" fill="${m2}"/>
<polygon points="${ridge(rand, 500, 50, 4.6)}" fill="${m3}"/>
${lake ? `<rect y="470" width="800" height="130" fill="url(#w)" opacity=".92"/><g stroke="${sun}" stroke-opacity=".45" stroke-width="3"><line x1="${sunX - 60}" x2="${sunX + 60}" y1="500" y2="500"/><line x1="${sunX - 36}" x2="${sunX + 36}" y1="522" y2="522"/><line x1="${sunX - 18}" x2="${sunX + 18}" y1="544" y2="544"/></g>` : ''}
</svg>`;
}

function bike(name: string) {
  const seed = hash(name);
  const palette = PALETTES[(seed >> 3) % PALETTES.length]!;
  const frame = ['#e2574c', '#2f6fde', '#1f9d74', '#f2a93b'][seed % 4];
  const cargo = name.includes('cargo');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[0]}"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#s)"/>
<polygon points="${ridge(seeded(seed), 420, 70, 2.6)}" fill="${palette[4]}" opacity=".55"/>
<rect y="470" width="800" height="130" fill="${palette[5]}"/>
<g fill="none" stroke="#1d2433" stroke-width="14"><circle cx="250" cy="420" r="92"/><circle cx="${cargo ? 600 : 560}" cy="420" r="92"/></g>
<g fill="none" stroke="#e8ecf2" stroke-width="3" opacity=".5"><circle cx="250" cy="420" r="70"/><circle cx="${cargo ? 600 : 560}" cy="420" r="70"/></g>
<g fill="none" stroke="${frame}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path d="M250 420 L360 300 L500 300 L${cargo ? 600 : 560} 420 M360 300 L405 420 L500 300 M405 420 L250 420"/><path d="M500 300 L480 250 L530 240"/><path d="M360 300 L345 265"/></g>
<rect x="318" y="248" width="64" height="18" rx="9" fill="#1d2433"/>
<rect x="372" y="318" width="70" height="30" rx="8" fill="#1d2433" opacity=".85"/>
${cargo ? '<rect x="420" y="250" width="150" height="110" rx="10" fill="#b98a55" stroke="#8a6338" stroke-width="6"/>' : ''}
</svg>`;
}

function portrait(name: string) {
  const warm = name.includes('ada');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
<defs><radialGradient id="b" cx=".45" cy=".35" r=".8"><stop offset="0" stop-color="${warm ? '#c8b28c' : '#a9b2a0'}"/><stop offset="1" stop-color="${warm ? '#4d3c2a' : '#3a4034'}"/></radialGradient>
<radialGradient id="f" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#f1d6b8"/><stop offset="1" stop-color="#c99d7a"/></radialGradient></defs>
<rect width="400" height="500" fill="url(#b)"/>
<path d="M60 500 C70 380 140 340 200 340 C260 340 330 380 340 500 Z" fill="${warm ? '#2c2a3e' : '#24221f'}"/>
${warm ? '<path d="M120 500 C130 420 160 380 200 380 C240 380 270 420 280 500 Z" fill="#4a4566" opacity=".6"/>' : '<path d="M175 345 L200 420 L225 345 Z" fill="#efe9de"/>'}
<rect x="178" y="270" width="44" height="80" rx="20" fill="#d9b18f"/>
<ellipse cx="200" cy="215" rx="68" ry="84" fill="url(#f)"/>
<path d="${warm ? 'M128 220 C120 120 180 110 200 112 C232 110 284 124 274 222 C264 170 236 150 200 150 C160 150 138 172 128 220 Z' : 'M134 200 C130 150 160 130 200 128 C240 130 270 150 266 200 C255 172 232 160 200 160 C168 160 145 172 134 200 Z'}" fill="${warm ? '#3b2618' : '#cfc8bd'}"/>
${warm ? '<ellipse cx="132" cy="236" rx="16" ry="30" fill="#3b2618"/><ellipse cx="268" cy="236" rx="16" ry="30" fill="#3b2618"/>' : '<path d="M140 250 C150 300 175 315 200 316 C225 315 250 300 260 250 C250 275 230 290 200 290 C170 290 150 275 140 250 Z" fill="#d8d2c8"/>'}
</svg>`;
}

function machine(name: string) {
  const rand = seeded(hash(name));
  const gears = Array.from({ length: 7 }, () => ({
    x: 60 + rand() * 680,
    y: 60 + rand() * 480,
    r: 40 + rand() * 90,
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
<rect width="800" height="600" fill="#2b2117"/>
${gears
  .map(
    (gear, index) =>
      `<g transform="translate(${gear.x.toFixed(0)} ${gear.y.toFixed(0)})"><circle r="${gear.r.toFixed(0)}" fill="none" stroke="${index % 2 ? '#c99a4a' : '#e2b867'}" stroke-width="${(gear.r / 4).toFixed(0)}" stroke-dasharray="14 9"/><circle r="${(gear.r * 0.55).toFixed(0)}" fill="${index % 2 ? '#8c6a33' : '#a8823f'}"/><circle r="${(gear.r * 0.16).toFixed(0)}" fill="#2b2117"/></g>`
  )
  .join('')}
</svg>`;
}

const toUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Fixture image for a demo URL: illustration by name, `broken` fails. */
export function demoImage(src: string): string {
  const name =
    src
      .split('/')
      .pop()
      ?.replace(/\.\w+$/, '') ?? src;
  if (name.includes('broken')) throw new Error('Bild nicht verfügbar');
  if (name.startsWith('portrait')) return toUrl(portrait(name));
  if (name.startsWith('bike')) return toUrl(bike(name));
  if (name.startsWith('machine')) return toUrl(machine(name));
  if (name === 'news-robot') return toUrl(machine(name));
  return toUrl(landscape(name.replace(/-thumb$/, '').replace(/-large$/, '')));
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Tiles accept raster data URLs only: the demo SVG becomes a JPEG. */
async function rasterize(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  canvas.getContext('2d')?.drawImage(image, 0, 0, 800, 600);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export const demoDynamicUiHost: DynamicUiHost = {
  loadImage: async (src) => {
    await wait(120 + (hash(src) % 260));
    return demoImage(src);
  },
  loadImageData: async (src) => {
    await wait(120 + (hash(src) % 260));
    return rasterize(demoImage(src));
  },
  loadEntity: async (title, lang) => {
    await wait(260);
    const data = DEMO_ENTITIES[title.replace(/_/g, ' ')];
    const node = { type: 'entity', id: 'entity', title, ...(lang ? { lang } : {}) } as const;
    const key = uiLiveKey(node);
    return data
      ? ({ type: 'entity', key, status: 'resolved', data } satisfies UiResult<'entity'>)
      : ({
          type: 'entity',
          key,
          status: 'failed',
          error: 'Kein Wikipedia-Artikel gefunden.',
          retryable: false,
        } satisfies UiResult<'entity'>);
  },
};
