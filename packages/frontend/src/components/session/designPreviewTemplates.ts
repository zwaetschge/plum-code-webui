import type { SkillLibraryItem } from '@plum-code-webui/shared';

const DESIGN_PREVIEW_BASE_PATH = '/design-previews/';

const DESIGN_PREVIEW_FILE_OVERRIDES: Record<string, string> = {
  'material-3': 'preview-material3.html',
  material3: 'preview-material3.html',
  'material-preview': 'design-material-preview.html',
  'ricardo-marketplace': 'preview-marketplace.html',
  skeuomorphism: 'preview-skeumorphism.html',
};

const DESIGN_PREVIEW_TEMPLATE_SLUGS = new Set([
  'agentic',
  'ant',
  'bento-modern',
  'cel-anime-action',
  'console-glass',
  'console-shelf',
  'application',
  'artistic',
  'bento',
  'bold',
  'brutalism',
  'cafe',
  'claude',
  'claymorphism',
  'clean',
  'codex',
  'colorful',
  'contemporary',
  'corporate',
  'cosmic',
  'creative',
  'dashboard',
  'dithered',
  'doodle',
  'dragonball-z',
  'dramatic',
  'editorial',
  'elegant',
  'energetic',
  'enterprise',
  'expressive',
  'fantasy',
  'fiction',
  'flat',
  'friendly',
  'friendly-playful',
  'futuristic',
  'glassmorphism',
  'hand-drawn',
  'gradient',
  'immersive',
  'immersive-storytelling',
  'impeccable',
  'levels',
  'lingo',
  'luxury',
  'material',
  'material-3',
  'material-preview',
  'material3',
  'matrix',
  'minimal',
  'modern',
  'mono',
  'neobrutalism',
  'neon',
  'neumorphism',
  'pacman',
  'paper',
  'perspective',
  'plum-style',
  'print-texture',
  'refined-premium',
  'plum-style-claude',
  'plum-style-codex',
  'premium',
  'professional',
  'publication',
  'refined',
  'retro',
  'retro-arcade',
  'retro-vintage',
  'ricardo-marketplace',
  'riso',
  'sci-fi',
  'sega',
  'shadcn',
  'simple',
  'sketch',
  'skeuomorphism',
  'skeumorphism',
  'sleek',
  'spacious',
  'spatial-perspective',
  'storytelling',
  'terminal-cyber',
  'terracotta',
  'tetris',
  'vibrant',
  'vintage',
  'windows95',
]);

export type DesignPreviewPresentation = { kind: 'html'; src: string } | { kind: 'tokens' };

export function getDesignSlug(item: SkillLibraryItem): string {
  const source = item.baseName || item.name;
  return source
    .replace(/^design-/, '')
    .replace(/\.disabled$/, '')
    .replace(/-design$/, '')
    .toLowerCase();
}

export function getDesignDisplayName(item: SkillLibraryItem): string {
  const slug = getDesignSlug(item);
  const overrides: Record<string, string> = {
    'dragonball-z': 'Dragon Ball Z',
    material3: 'Material 3',
    'material-3': 'Material 3',
    'ricardo-marketplace': 'Ricardo Marketplace',
    shadcn: 'shadcn',
    windows95: 'Windows 95',
  };
  const override = overrides[slug];
  if (override) return override;

  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getDesignPreviewUrl(item: SkillLibraryItem): string {
  const slug = getDesignSlug(item);
  const fileName = DESIGN_PREVIEW_FILE_OVERRIDES[slug] || `preview-${slug}.html`;
  return `${DESIGN_PREVIEW_BASE_PATH}${fileName}`;
}

export function getDesignPreviewPresentation(item: SkillLibraryItem): DesignPreviewPresentation {
  const slug = getDesignSlug(item);
  if (DESIGN_PREVIEW_TEMPLATE_SLUGS.has(slug)) {
    return { kind: 'html', src: getDesignPreviewUrl(item) };
  }
  if (item.designMd) {
    return { kind: 'tokens' };
  }
  return { kind: 'html', src: getDesignPreviewUrl(item) };
}
