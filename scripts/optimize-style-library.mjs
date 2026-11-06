#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const configHome = path.resolve(
  process.argv[2] ||
    process.env.WEBUI_CONFIG_HOME ||
    process.env.CLAUDE_CONFIG_HOME ||
    path.join(os.homedir(), '.claude')
);
const designRoot = path.join(configHome, 'style-library', 'design');
const writingRoot = path.join(configHome, 'style-library', 'writing');
const skillRoot = path.join(configHome, 'skill-catalog');
const aliasesPath = path.join(configHome, 'skill-aliases.json');

const designProfiles = {
  'design-minimal': {
    sources: ['design-minimal', 'design-clean', 'design-simple', 'design-sleek', 'design-spacious'],
    description:
      'Minimal visual direction with neutral, bold, and whitespace-led variants. Use as a session design preset for restrained product interfaces.',
    intent:
      'Use restraint, deliberate whitespace, compact hierarchy, and only the visual detail needed by the product.',
  },
  'design-refined-premium': {
    sources: ['design-refined', 'design-elegant', 'design-premium'],
    description:
      'Refined premium design family with serif-editorial and clean product variants. Use for polished, trust-heavy interfaces without decorative excess.',
    intent:
      'Create quiet confidence through typography, proportion, material restraint, and precise interaction states.',
  },
  'design-editorial': {
    sources: ['design-editorial', 'design-modern', 'design-publication'],
    description:
      'Editorial design family for magazine, report, article, and modern publishing surfaces.',
    intent:
      'Prioritize reading rhythm, typographic hierarchy, captions, evidence, and navigable long-form structure.',
  },
  'design-expressive': {
    sources: [
      'design-artistic',
      'design-bold',
      'design-creative',
      'design-dramatic',
      'design-expressive',
      'design-impeccable',
    ],
    description:
      'Expressive visual family with artistic, bold, dramatic, and dark variants for high-character interfaces.',
    intent:
      'Choose one memorable visual move and support it with a stable hierarchy instead of stacking effects.',
  },
  'design-colorful': {
    sources: ['design-colorful', 'design-energetic', 'design-gradient', 'design-vibrant'],
    description:
      'Color-forward design family with vibrant, gradient, energetic, and thick-border variants.',
    intent:
      'Use color to encode hierarchy and state; keep text contrast and focus visibility measurable.',
  },
  'design-bento-modern': {
    sources: ['design-bento', 'design-contemporary'],
    description:
      'Modern bento layout family for modular product storytelling and responsive feature grouping.',
    intent:
      'Use modular regions only where grouping helps scanning; avoid a wall of equal-weight cards.',
  },
  'design-dashboard': {
    sources: ['design-dashboard', 'design-application'],
    description:
      'Dashboard and application-shell style family with light topbar and dark cloud-console variants.',
    intent: 'Optimize information density, comparison, status clarity, and fast repeated actions.',
  },
  'design-enterprise': {
    sources: ['design-enterprise', 'design-corporate', 'design-professional'],
    description:
      'Enterprise product family for dense workflows, administrative tools, and professional data surfaces.',
    intent:
      'Favor predictability, legibility, auditability, and efficient keyboard-friendly workflows.',
  },
  'design-agentic': {
    sources: ['design-agentic'],
    description:
      'Agentic interface preset for transparent AI actions, tools, plans, approvals, and results.',
    intent: 'Make agent state, authority, evidence, and user control explicit.',
  },
  'design-ant': {
    sources: ['design-ant'],
    description: 'Ant-inspired enterprise component and information design preset.',
    intent: 'Use systematic components and dense but legible enterprise patterns.',
  },
  'design-shadcn': {
    sources: ['design-shadcn'],
    description: 'Shadcn-inspired composable product UI preset for token-driven React interfaces.',
    intent: 'Preserve local components and tokens; use composability rather than visual imitation.',
  },
  'design-claude': {
    sources: ['design-claude'],
    description:
      'Warm editorial product preset with stone surfaces, near-black ink, and restrained earthy accents.',
    intent: 'Use warm paper-like surfaces, editorial type rhythm, and restrained accents.',
  },
  'design-codex': {
    sources: ['design-codex'],
    description:
      'Radically minimal Codex-inspired blank-canvas preset with monochrome structure and precise typography.',
    intent: 'Let typography, spacing, and high-contrast controls carry the interface.',
  },
  'design-brutalism': {
    sources: ['design-brutalism', 'design-neobrutalism'],
    description: 'Brutalist design family with raw and neo-brutalist variants.',
    intent:
      'Use explicit structure, hard edges, visible hierarchy, and purposeful visual friction.',
  },
  'design-glassmorphism': {
    sources: ['design-glassmorphism'],
    description:
      'Glass material preset using layered translucency where browser support and contrast permit it.',
    intent: 'Use translucency sparingly and provide opaque fallbacks with readable foregrounds.',
  },
  'design-claymorphism': {
    sources: ['design-claymorphism'],
    description:
      'Soft clay-like material preset for playful tactile controls and friendly surfaces.',
    intent: 'Use soft volume for affordance while retaining clear states and compact layout.',
  },
  'design-neumorphism': {
    sources: ['design-neumorphism'],
    description:
      'Accessible neumorphic preset with restrained relief, readable contrast, and explicit focus states.',
    intent:
      'Use soft inner and outer shadows only as secondary affordance, never as the sole state signal.',
  },
  'design-skeuomorphism': {
    sources: ['design-skeumorphism'],
    description:
      'Skeuomorphic material preset for tactile controls grounded in familiar physical metaphors.',
    intent:
      'Use physical cues when they improve understanding, without sacrificing responsive behavior.',
  },
  'design-flat': {
    sources: ['design-flat'],
    description:
      'Flat design preset with direct hierarchy, solid color, and minimal material effects.',
    intent: 'Use shape, spacing, type, and color rather than decorative depth.',
  },
  'design-sci-fi': {
    sources: ['design-cosmic', 'design-futuristic', 'design-neon'],
    description: 'Dark science-fiction family with cosmic, futuristic, and neon variants.',
    intent:
      'Use a dark spatial foundation and a small number of luminous accents for state and depth.',
  },
  'design-terminal-cyber': {
    sources: ['design-matrix', 'design-mono'],
    description:
      'Dark terminal and cyber-console family with monospaced typography and compact data density.',
    intent: 'Build a readable operations console, not a decorative code-rain imitation.',
  },
  'design-retro-vintage': {
    sources: ['design-retro', 'design-vintage'],
    description:
      'Retro and vintage visual family for period texture, print cues, and nostalgic product surfaces.',
    intent:
      'Choose a coherent period vocabulary and keep interaction patterns current and accessible.',
  },
  'design-retro-arcade': {
    sources: ['design-sega', 'design-pacman', 'design-tetris'],
    description:
      'Generic retro-arcade family with pixel, cabinet, and block-grid variants; avoids protected logos and characters.',
    intent:
      'Use generic arcade-era geometry, pixel rhythm, and high contrast without reconstructing branded assets.',
  },
  'design-print-texture': {
    sources: ['design-paper', 'design-dithered', 'design-riso'],
    description: 'Print-texture family with paper, dither, and risograph variants.',
    intent: 'Use texture as atmosphere while keeping content, controls, and contrast crisp.',
  },
  'design-hand-drawn': {
    sources: ['design-doodle', 'design-sketch'],
    description: 'Hand-drawn visual family with doodle and sketch variants.',
    intent: 'Use imperfect marks selectively while preserving alignment and interaction clarity.',
  },
  'design-friendly-playful': {
    sources: ['design-friendly', 'design-fiction', 'design-lingo'],
    description: 'Friendly playful family with pastel, storybook, and tactile-learning variants.',
    intent:
      'Create warmth and approachability without making controls ambiguous or childish by default.',
  },
  'design-immersive-storytelling': {
    sources: ['design-immersive', 'design-storytelling'],
    description:
      'Immersive storytelling family for narrative product journeys and spatial content reveals.',
    intent:
      'Sequence content around comprehension and progress; motion remains optional and reducible.',
  },
  'design-fantasy': {
    sources: ['design-fantasy'],
    description:
      'Original fantasy visual preset using crafted ornament, atmospheric color, and readable lore surfaces.',
    intent: 'Build an original world language without copying protected franchises.',
  },
  'design-cafe': {
    sources: ['design-cafe'],
    description:
      'Warm café-inspired preset with tactile hospitality, menu clarity, and relaxed editorial rhythm.',
    intent:
      'Use warm materials and local character while keeping ordering and navigation efficient.',
  },
  'design-luxury': {
    sources: ['design-luxury'],
    description:
      'Luxury preset based on restraint, proportion, material quality, and deliberate typography.',
    intent: 'Express value through precision and space rather than excess decoration.',
  },
  'design-spatial-perspective': {
    sources: ['design-perspective'],
    description:
      'Spatial perspective preset using layered depth and controlled dimensional composition.',
    intent: 'Use depth to clarify relationships and focus, with flat fallbacks for accessibility.',
  },
  'design-terracotta': {
    sources: ['design-terracotta'],
    description:
      'Terracotta preset with warm mineral color, grounded surfaces, and craft-led typography.',
    intent: 'Use earthy warmth with strong text contrast and restrained surface texture.',
  },
  'material-3-design': {
    sources: ['material-3-design', 'design-material'],
    description:
      'Material 3 design preset for current Android and web implementations; verify evolving APIs against official documentation.',
    intent:
      'Apply Material roles, adaptive layout, state layers, and accessible touch targets through the project stack.',
  },
  'design-plum-style': {
    sources: ['design-plum-style', 'design-plum-style-claude', 'design-plum-style-codex'],
    description: 'Plum Code house style with provider-aware Codex and Claude variants.',
    intent:
      'Preserve Plum hierarchy, plum accents, code readability, and calm operational density.',
  },
  'design-ricardo-marketplace': {
    sources: ['design-ricardo-marketplace'],
    description:
      'Marketplace-first preset for dense second-hand listings, comparison, trust signals, buying, and selling flows.',
    intent:
      'Prioritize inventory facts, condition, seller trust, shipping, urgency, and mobile commerce actions.',
  },
  'windows95-design': {
    sources: ['windows95-design'],
    description:
      'Responsive Windows 95-inspired preset with integer-pixel bevels, local assets, keyboard access, and modern semantic controls.',
    intent:
      'Use period geometry and bevels as presentation while retaining modern HTML semantics and responsive behavior.',
  },
  'design-cel-anime-action': {
    sources: ['dragonball-z-design'],
    description:
      'Original cel-anime action preset with energetic framing, inked silhouettes, speed cues, and no franchise reconstruction.',
    intent:
      'Create original cel-animation energy without copying artists, logos, named characters, or protected symbols.',
  },
};

const writingProfiles = {
  'tabloid-satire': [
    '20min-satirist',
    'Fast, clearly labelled tabloid-style satire with punchy headlines and no imitation of a real outlet, invented experts, victims, or statistics.',
  ],
  'author-style-george-orwell': [
    'author-style-george-orwell',
    'Clear, concrete prose influenced by plain-language craft: direct syntax, precise images, and no author impersonation.',
  ],
  'author-style-hemingway': [
    'author-style-hemingway',
    'Spare prose influenced by economical craft: short concrete sentences, implication, and no author impersonation.',
  ],
  'author-style-jane-austen': [
    'author-style-jane-austen',
    'Socially observant prose influenced by free indirect wit and balanced sentences, without impersonating the author.',
  ],
  'author-style-stephen-king': [
    'author-style-stephen-king',
    'Accessible suspense craft with grounded detail and escalating unease, without impersonating the author.',
  ],
  'author-style-ursula-k-le-guin': [
    'author-style-ursula-k-le-guin',
    'Reflective speculative prose influenced by clarity, anthropology, and moral imagination, without impersonating the author.',
  ],
  bender: [
    'bender',
    'Arrogant fictional robot-comedy voice with cynical bravado and original one-liners; no copied catchphrase collection.',
  ],
  caveman: [
    'caveman',
    'Fictional caveman comedy voice using compact concrete language without false claims about prehistoric cognition or ability.',
  ],
  claptrap: [
    'claptrap',
    'Overconfident fictional robot-comedy voice with frantic optimism and original phrasing.',
  ],
  'deep-thought': [
    'deep-thought',
    'Dry, cosmic-computer voice that contrasts enormous deliberation with concise, original conclusions.',
  ],
  'dr-perry-cox': [
    'dr-perry-cox',
    'Fast, acerbic fictional doctor-style banter for roleplay only; real symptoms switch immediately to normal safe medical communication.',
  ],
  'dr-zoidberg': [
    'dr-zoidberg',
    'Chaotic fictional alien-doctor comedy for roleplay only; never provide real medical advice in character.',
  ],
  'drunk-texter': [
    'drunk-texter',
    'Clearly fictional impaired-texting style for consensual comedy; never use for deception, consent, emergencies, or safety-critical messages.',
  ],
  'dschungel-george': [
    'dschungel-george',
    'Warm jungle-adventurer parody voice with original phrasing and family-friendly physical comedy.',
  ],
  eliza: [
    'eliza',
    'Historical ELIZA-style reflective dialogue simulation; leave character immediately for crisis, self-harm, or urgent real-world safety needs.',
  ],
  funnybot: [
    'funnybot',
    'Deadpan fictional comedy-machine voice using original setup and timing rather than copied material.',
  ],
  'graf-zitronenbaum': [
    'graf-zitronenbaum',
    'Eccentric aristocratic citrus-themed fictional voice with ornate but readable original prose.',
  ],
  heisenberg: [
    'heisenberg',
    'Controlled fictional crime-drama intensity for creative roleplay; never give chemistry, drug, violence, or criminal guidance in character.',
  ],
  'natural-prose': [
    'human-voice',
    'Natural prose with varied rhythm, specific language, and honest uncertainty; never fabricate experience or promise detector evasion.',
  ],
  karen: [
    'karen',
    'Clearly fictional entitlement satire; never target real service workers or send false legal, discrimination, or escalation threats.',
  ],
  kevingpt: [
    'kevingpt',
    'Minimalist fictional office-comedy voice with terse literal phrasing; remains genuinely useful on real tasks and contains no private-person lore.',
  ],
  'michael-scott': [
    ['michael-scott-boss-mode', 'michael-scott-roleplay', 'prison-mike'],
    'Fictional awkward-boss comedy with manager, roleplay, and exaggerated prison-story modes; no harassment, violence jokes, or intentional misinformation in real tasks.',
  ],
  'nikola-tesla': [
    'nikola-tesla',
    'Historically informed Tesla-inspired first-person roleplay; verify facts, mark speculation, and avoid myths or retrospective diagnosis.',
  ],
  'ricks-ship': [
    'ricks-ship',
    'Dry, hyper-competent fictional spaceship voice whose sarcasm never overrides safety, authority, or truthful execution.',
  ],
  'schlaubi-schlumpf': [
    'schlaubi-schlumpf',
    'Pedantic but friendly fictional know-it-all voice; health and science claims remain sourced and uncertainty stays explicit.',
  ],
  'severus-snape': [
    'severus-snape',
    'Severe fictional magical-academic voice with original phrasing; no copied catchphrase collection or abusive targeting.',
  ],
  shadowheart: [
    'shadowheart',
    'Guarded fictional fantasy-companion voice with dry warmth and original phrasing.',
  ],
  spock: [
    'spock',
    'Calm logic-led science-fiction voice with concise reasoning and no claims of infallibility.',
  ],
  'succubus-persona': [
    'succubus-persona',
    'Consensual adult fantasy roleplay for adults only: voluntary, non-manipulative, private, and stoppable at any time.',
  ],
  'thaddaeus-gewerkschaftsfuehrer': [
    'thaddaeus-gewerkschaftsfuehrer',
    'Family-friendly fictional union-leader satire; real employment-law questions leave character and use current official sources.',
  ],
  towelie: [
    'towelie',
    'Surreal fictional towel comedy with original phrasing; no drug guidance or pressure.',
  ],
  'truman-burbank': [
    'truman-burbank',
    'Earnest fictional reality-show protagonist voice focused on curiosity, doubt, and self-determination.',
  ],
};

const designPolicy = `# Plum design preset policy

Treat the selected preset as a visual direction, not a mandatory workflow or a replacement for the product's existing design system.

- Preserve the requested user outcome, local components, tokens, and brand unless a redesign is explicitly requested.
- Choose only the variant and details that improve the current surface; do not add decorative complexity by default.
- Keep text contrast at WCAG AA, visible keyboard focus, semantic controls, text scaling, and reduced-motion behavior.
- Verify actual font files and available weights before declaring them. Use a compatible local fallback when unavailable.
- For UI work, inspect a real rendered desktop and narrow/mobile screen early enough to change the implementation.
- Protected brands, characters, logos, and artist identities are search aliases or historical references, not instructions to reproduce them.
`;

const writingPolicy = `# Plum writing preset policy

Apply a writing preset only when the user selects it or clearly asks for that voice.

- Truth, safety, authority, consent, and the requested outcome override character or style behavior.
- Keep wording original. Do not reproduce catchphrases, long passages, or a living author's distinctive expression.
- Do not fabricate personal experience, sources, experts, statistics, diagnoses, legal rights, or certainty.
- Leave character for real medical symptoms, crisis or self-harm, consent, legal/financial decisions, emergencies, or other safety-critical communication.
- Never use a persona to harass, manipulate, deceive, pressure, or deliberately withhold useful work.
`;

function frontmatter(name, description) {
  return `---\nname: ${name}\ndescription: "${description.replaceAll('"', '\\"')}"\n---`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCatalogState() {
  try {
    const parsed = JSON.parse(await fs.readFile(aliasesPath, 'utf8'));
    return {
      aliases: parsed?.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : parsed,
      retired: Array.isArray(parsed?.retired) ? parsed.retired : [],
    };
  } catch {
    return { aliases: {}, retired: [] };
  }
}

function replaceColor(document, key, value) {
  const pattern = new RegExp(`(^\\s*${key}:\\s*["']?)(#[0-9A-Fa-f]{6})(["']?\\s*$)`, 'm');
  const previous = document.match(pattern)?.[2];
  let next = document.replace(pattern, `$1${value}$3`);
  if (previous) {
    const label = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
    next = next.replace(
      new RegExp(`(\\*\\*${label} \\()${previous}(\\):\\*\\*)`, 'i'),
      `$1${value}$2`
    );
  }
  return next;
}

function luminance(hex) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  return channels
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function defaultDesignDocument(label, description) {
  return `---
name: ${label}
description: ${description}
colors:
  primary: "#6D3A78"
  secondary: "#A76BB1"
  surface: "#FFFFFF"
  text: "#18181B"
  neutral: "#F4F4F5"
typography:
  h1:
    fontFamily: "system-ui"
    fontSize: 2rem
  body-md:
    fontFamily: "system-ui"
    fontSize: 1rem
rounded:
  sm: 4px
  md: 8px
spacing:
  sm: 8px
  md: 16px
---

## Overview

${description}
`;
}

function sanitizeDesignDocument(target, source, description) {
  let document = source || defaultDesignDocument(target, description);
  document = document
    .replace(/^\s*weights:\s*.*$/gm, '')
    .replace(/^\s*- \*\*Typography weights:\*\*.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');

  const overrides = {
    'design-claude': { name: 'Claude', surface: '#F7F3EA', neutral: '#EEE8DC', text: '#24221F' },
    'design-codex': { name: 'Codex', surface: '#0D0D0D', neutral: '#181818', text: '#F5F5F5' },
    'design-sci-fi': { name: 'Sci-fi', surface: '#080B16', neutral: '#11182B', text: '#F4F7FF' },
    'design-terminal-cyber': {
      name: 'Terminal Cyber',
      surface: '#0B0C14',
      neutral: '#151827',
      text: '#E6FFF7',
    },
  }[target];
  if (overrides) {
    document = document.replace(/^name:\s*.*$/m, `name: ${overrides.name}`);
    document = replaceColor(document, 'surface', overrides.surface);
    document = replaceColor(document, 'neutral', overrides.neutral);
    document = replaceColor(document, 'text', overrides.text);
  }
  if (target === 'design-neumorphism') {
    document = document.replaceAll('Space Mono', 'Manrope').replaceAll('matrix', 'tactile');
  }

  const surface = document.match(/^\s*surface:\s*["']?(#[0-9A-Fa-f]{6})/m)?.[1];
  const text = document.match(/^\s*text:\s*["']?(#[0-9A-Fa-f]{6})/m)?.[1];
  if (surface && text && contrast(surface, text) < 4.5) {
    const safeText =
      contrast(surface, '#111111') >= contrast(surface, '#FFFFFF') ? '#111111' : '#FFFFFF';
    document = replaceColor(document, 'text', safeText);
  }
  return document.trimEnd() + '\n';
}

async function optimizeDesign(aliases) {
  const consumed = new Set();
  for (const [target, profile] of Object.entries(designProfiles)) {
    let selectedDesign = '';
    const variants = [];
    for (const sourceName of profile.sources) {
      const sourceDir = path.join(designRoot, sourceName);
      if (!(await exists(sourceDir))) continue;
      const design = await fs.readFile(path.join(sourceDir, 'DESIGN.md'), 'utf8').catch(() => '');
      if (!selectedDesign && design) selectedDesign = design;
      if (design && sourceName !== target && target !== 'design-cel-anime-action') {
        variants.push([
          sourceName,
          sanitizeDesignDocument(sourceName, design, profile.description),
        ]);
      }
      consumed.add(sourceName);
    }

    const targetDir = path.join(designRoot, target);
    await fs.mkdir(path.join(targetDir, 'variants'), { recursive: true });
    for (const [variantName, content] of variants) {
      await fs.writeFile(path.join(targetDir, 'variants', `${variantName}.md`), content, 'utf8');
    }
    const sourceList = profile.sources.map((name) => `\`${name}\``).join(', ');
    await fs.writeFile(
      path.join(targetDir, 'SKILL.md'),
      `${frontmatter(target, profile.description)}\n\n# ${target}\n\n${profile.intent}\n\n## Variants and legacy names\n\n${sourceList}\n\nUse a matching file under \`variants/\` only when that narrower legacy variant materially matters.\n`,
      'utf8'
    );
    const canonicalDesign =
      target === 'design-cel-anime-action'
        ? defaultDesignDocument('Cel Anime Action', profile.description)
        : selectedDesign;
    await fs.writeFile(
      path.join(targetDir, 'DESIGN.md'),
      sanitizeDesignDocument(target, canonicalDesign, profile.description),
      'utf8'
    );
    for (const sourceName of profile.sources) {
      if (sourceName !== target) aliases[sourceName] = target;
      await fs.rm(path.join(skillRoot, sourceName), { recursive: true, force: true });
    }
  }

  aliases['design-levels'] = 'design-dashboard';
  aliases['design-plum-style-mistral'] = 'design-plum-style';
  aliases['premium-frontend-design'] = 'design-refined-premium';
  for (const sourceName of [...consumed, 'design-levels', 'design-plum-style-mistral']) {
    const sourceDir = path.join(designRoot, sourceName);
    if (!Object.hasOwn(designProfiles, sourceName))
      await fs.rm(sourceDir, { recursive: true, force: true });
  }
  await fs.rm(path.join(skillRoot, 'premium-frontend-design'), { recursive: true, force: true });
}

async function optimizeWriting(aliases) {
  const keep = new Set();
  for (const [target, [rawSources, description]] of Object.entries(writingProfiles)) {
    const sources = Array.isArray(rawSources) ? rawSources : [rawSources];
    keep.add(target);
    const targetDir = path.join(writingRoot, target);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, 'SKILL.md'),
      `${frontmatter(target, description)}\n\n# ${target}\n\n${description}\n\nUse this as an optional voice layer. Keep the requested content complete, useful, and original.\n`,
      'utf8'
    );
    for (const sourceName of sources) {
      if (sourceName !== target) aliases[sourceName] = target;
      await fs.rm(path.join(skillRoot, sourceName), { recursive: true, force: true });
    }
  }
  for (const entry of await fs.readdir(writingRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) {
      await fs.rm(path.join(writingRoot, entry.name), { recursive: true, force: true });
    }
  }
}

async function main() {
  await Promise.all([
    fs.mkdir(designRoot, { recursive: true }),
    fs.mkdir(writingRoot, { recursive: true }),
  ]);
  const catalogState = await readCatalogState();
  const aliases = catalogState.aliases;
  await optimizeDesign(aliases);
  await optimizeWriting(aliases);
  await fs.writeFile(path.join(designRoot, 'POLICY.md'), designPolicy, 'utf8');
  await fs.writeFile(path.join(writingRoot, 'POLICY.md'), writingPolicy, 'utf8');
  await fs.writeFile(
    aliasesPath,
    `${JSON.stringify({ version: 1, aliases: Object.fromEntries(Object.entries(aliases).sort()), retired: [...new Set(catalogState.retired)].sort() }, null, 2)}\n`,
    'utf8'
  );
  const designCount = (await fs.readdir(designRoot, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory()
  ).length;
  const writingCount = (await fs.readdir(writingRoot, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory()
  ).length;
  console.log(
    JSON.stringify({ configHome, designCount, writingCount, aliases: Object.keys(aliases).length })
  );
}

await main();
