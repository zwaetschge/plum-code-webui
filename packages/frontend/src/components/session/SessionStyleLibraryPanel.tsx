import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Loader2, Palette, PenLine, Search, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  getDesignDisplayName,
  getDesignPreviewPresentation,
  getDesignSlug,
} from './designPreviewTemplates';
import type {
  ApiResponse,
  CLIProvider,
  Session,
  SkillLibraryItem,
  StyleLibraryResponse,
  WritingStyleType,
} from '@plum-code-webui/shared';

interface SessionStyleLibraryPanelProps {
  sessionId: string;
  provider: CLIProvider;
  kind: 'design' | 'writing';
  selectedSkill: string | null;
  onSessionUpdated: (session: Session) => void;
  className?: string;
}

interface DesignMdImportResult {
  status: 'imported' | 'skipped';
  skill?: {
    baseName: string;
    name: string;
    description: string;
    dirPath: string;
  };
  reason?: string;
  skillName?: string;
}

const libraryCopy = {
  design: {
    title: 'UI Style Library',
    empty: 'No UI style templates found',
    search: 'Search UI styles',
    clear: 'No UI style',
    selected: 'Active UI style',
    toast: 'UI-Stil geändert',
    icon: Palette,
  },
  writing: {
    title: 'Writing Style Library',
    empty: 'No writing style templates found',
    search: 'Search writing styles',
    clear: 'No writing style',
    selected: 'Active writing style',
    toast: 'Schreibstil geändert',
    icon: PenLine,
  },
} as const;

const writingStyleTypeCopy: Record<
  WritingStyleType,
  { label: string; description: string; selectedLabel: string }
> = {
  persona: {
    label: 'Personas',
    description: 'Assistant voice, roleplay, and character presets',
    selectedLabel: 'Persona',
  },
  author: {
    label: 'Author styles',
    description: 'Narrative craft and prose influence without changing identity',
    selectedLabel: 'Author style',
  },
  prose: {
    label: 'General writing',
    description: 'Tone, copy, email, and prose conventions',
    selectedLabel: 'Writing style',
  },
};

function getItems(data: StyleLibraryResponse | undefined, kind: 'design' | 'writing') {
  return kind === 'design' ? data?.designStyles || [] : data?.writingStyles || [];
}

function getWritingStyleType(item: SkillLibraryItem): WritingStyleType {
  return item.writingStyleType || 'persona';
}

const writingStyleTypeOrder: WritingStyleType[] = ['author', 'persona', 'prose'];

interface DesignCardTheme {
  bg: string;
  border: string;
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  pattern: string;
  preview: string;
  fontFamily: string;
  radius: string;
  previewRadius: string;
  shadow: string;
  titleTransform?: CSSProperties['textTransform'];
  titleWeight?: CSSProperties['fontWeight'];
}

const pattern = {
  grid: (color: string) =>
    `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
  dots: (color: string) => `radial-gradient(circle at 1px 1px, ${color} 1.4px, transparent 1.6px)`,
  diagonal: (color: string) =>
    `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px 12px)`,
  paper: (color: string) =>
    `linear-gradient(90deg, ${color} 1px, transparent 1px), repeating-linear-gradient(0deg, transparent 0 13px, ${color} 13px 14px)`,
  blocks: (color: string) =>
    `linear-gradient(90deg, ${color} 12%, transparent 12% 24%, ${color} 24% 36%, transparent 36% 100%)`,
};

const defaultDesignTheme: DesignCardTheme = {
  bg: 'linear-gradient(135deg, #111827 0%, #1f2937 100%)',
  border: 'rgba(148, 163, 184, 0.34)',
  accent: '#38bdf8',
  accentSoft: 'rgba(56, 189, 248, 0.18)',
  text: '#f8fafc',
  muted: 'rgba(226, 232, 240, 0.74)',
  pattern: pattern.grid('rgba(255, 255, 255, 0.06)'),
  preview: 'linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(255, 255, 255, 0.08))',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  radius: '14px',
  previewRadius: '8px',
  shadow: '0 16px 34px rgba(0, 0, 0, 0.2)',
  titleWeight: 800,
};

const designThemePresets: Record<string, Partial<DesignCardTheme>> = {
  agentic: {
    bg: 'linear-gradient(135deg, #061d1b 0%, #0b2638 100%)',
    border: 'rgba(103, 232, 249, 0.38)',
    accent: '#67e8f9',
    accentSoft: 'rgba(45, 212, 191, 0.2)',
    pattern: pattern.grid('rgba(103, 232, 249, 0.08)'),
    preview: 'linear-gradient(90deg, rgba(103, 232, 249, 0.38), rgba(52, 211, 153, 0.16))',
  },
  ant: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #eaf2ff 100%)',
    border: 'rgba(22, 119, 255, 0.26)',
    accent: '#1677ff',
    accentSoft: 'rgba(22, 119, 255, 0.12)',
    text: '#172033',
    muted: 'rgba(51, 65, 85, 0.72)',
    pattern: pattern.grid('rgba(22, 119, 255, 0.08)'),
    preview: 'linear-gradient(90deg, #1677ff, #69b1ff)',
    radius: '8px',
    previewRadius: '4px',
  },
  application: {
    bg: 'linear-gradient(135deg, #261444 0%, #110b25 100%)',
    border: 'rgba(196, 181, 253, 0.34)',
    accent: '#c4b5fd',
    accentSoft: 'rgba(168, 85, 247, 0.18)',
    pattern: pattern.grid('rgba(196, 181, 253, 0.08)'),
    preview: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
  },
  artistic: {
    bg: 'linear-gradient(135deg, #fff7ed 0%, #18181b 52%, #7f1d1d 100%)',
    border: 'rgba(251, 146, 60, 0.38)',
    accent: '#fb923c',
    accentSoft: 'rgba(251, 146, 60, 0.18)',
    text: '#fff7ed',
    muted: 'rgba(255, 237, 213, 0.76)',
    pattern: pattern.diagonal('rgba(255, 255, 255, 0.12)'),
    preview: 'linear-gradient(90deg, #fb923c, #ef4444, #111827)',
    titleTransform: 'uppercase',
  },
  bento: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #dbeafe 100%)',
    border: 'rgba(15, 23, 42, 0.14)',
    accent: '#2563eb',
    accentSoft: 'rgba(37, 99, 235, 0.14)',
    text: '#0f172a',
    muted: 'rgba(51, 65, 85, 0.68)',
    pattern: pattern.blocks('rgba(37, 99, 235, 0.08)'),
    preview: 'linear-gradient(90deg, #ffffff, #bfdbfe)',
    radius: '8px',
  },
  bold: {
    bg: 'linear-gradient(135deg, #09090b 0%, #1f1f1f 100%)',
    border: 'rgba(250, 204, 21, 0.48)',
    accent: '#facc15',
    accentSoft: 'rgba(239, 68, 68, 0.2)',
    pattern: pattern.diagonal('rgba(250, 204, 21, 0.16)'),
    preview: 'linear-gradient(90deg, #facc15 0 34%, #ef4444 34% 68%, #f8fafc 68%)',
    radius: '4px',
    previewRadius: '2px',
    titleTransform: 'uppercase',
  },
  brutalism: {
    bg: 'linear-gradient(135deg, #d6d3d1 0%, #a8a29e 100%)',
    border: '#111111',
    accent: '#d9ff00',
    accentSoft: 'rgba(217, 255, 0, 0.36)',
    text: '#111111',
    muted: 'rgba(17, 17, 17, 0.7)',
    pattern: pattern.diagonal('rgba(17, 17, 17, 0.16)'),
    preview: 'linear-gradient(90deg, #111111 0 28%, #d9ff00 28% 64%, #ef4444 64%)',
    radius: '2px',
    previewRadius: '0px',
    shadow: '6px 6px 0 rgba(0, 0, 0, 0.55)',
    titleTransform: 'uppercase',
  },
  cafe: {
    bg: 'linear-gradient(135deg, #4b2e22 0%, #f3e2c7 100%)',
    border: 'rgba(245, 158, 11, 0.32)',
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.18)',
    text: '#fff7ed',
    muted: 'rgba(255, 247, 237, 0.78)',
    pattern: pattern.dots('rgba(255, 247, 237, 0.14)'),
    preview: 'linear-gradient(90deg, #7c2d12, #f8e4bd)',
    fontFamily: 'Georgia, ui-serif, serif',
  },
  claude: {
    bg: 'linear-gradient(135deg, #f3eee2 0%, #ded1bd 100%)',
    border: 'rgba(120, 79, 48, 0.28)',
    accent: '#8b5e3c',
    accentSoft: 'rgba(139, 94, 60, 0.14)',
    text: '#2d2118',
    muted: 'rgba(45, 33, 24, 0.68)',
    pattern: pattern.paper('rgba(120, 79, 48, 0.08)'),
    preview: 'linear-gradient(90deg, #8b5e3c, #f3eee2)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '10px',
  },
  claymorphism: {
    bg: 'linear-gradient(135deg, #fee2e2 0%, #dbeafe 55%, #dcfce7 100%)',
    border: 'rgba(255, 255, 255, 0.64)',
    accent: '#f472b6',
    accentSoft: 'rgba(244, 114, 182, 0.22)',
    text: '#3f2a44',
    muted: 'rgba(63, 42, 68, 0.64)',
    pattern: pattern.dots('rgba(255, 255, 255, 0.44)'),
    preview: 'linear-gradient(90deg, #f9a8d4, #93c5fd, #86efac)',
    radius: '22px',
    previewRadius: '999px',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 18px 34px rgba(148, 163, 184, 0.28)',
  },
  clean: {
    bg: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
    border: 'rgba(15, 23, 42, 0.12)',
    accent: '#0ea5e9',
    accentSoft: 'rgba(14, 165, 233, 0.1)',
    text: '#0f172a',
    muted: 'rgba(51, 65, 85, 0.68)',
    pattern: 'linear-gradient(180deg, rgba(14, 165, 233, 0.06), transparent)',
    preview: 'linear-gradient(90deg, #e0f2fe, #ffffff)',
    radius: '10px',
  },
  codex: {
    bg: 'linear-gradient(135deg, #0b0f10 0%, #14201d 100%)',
    border: 'rgba(45, 212, 191, 0.32)',
    accent: '#2dd4bf',
    accentSoft: 'rgba(45, 212, 191, 0.16)',
    pattern: pattern.grid('rgba(45, 212, 191, 0.08)'),
    preview: 'linear-gradient(90deg, #2dd4bf, #a3e635)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '8px',
    previewRadius: '3px',
  },
  colorful: {
    bg: 'linear-gradient(135deg, #fff1f2 0%, #fef3c7 35%, #dbeafe 70%, #dcfce7 100%)',
    border: 'rgba(244, 63, 94, 0.28)',
    accent: '#f43f5e',
    accentSoft: 'rgba(59, 130, 246, 0.14)',
    text: '#172033',
    muted: 'rgba(51, 65, 85, 0.7)',
    pattern: pattern.dots('rgba(244, 63, 94, 0.12)'),
    preview: 'linear-gradient(90deg, #f43f5e, #facc15, #22c55e, #3b82f6)',
    radius: '16px',
  },
  contemporary: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    border: 'rgba(15, 23, 42, 0.16)',
    accent: '#0f766e',
    accentSoft: 'rgba(15, 118, 110, 0.12)',
    text: '#111827',
    muted: 'rgba(55, 65, 81, 0.66)',
    preview: 'linear-gradient(90deg, #0f766e, #94a3b8)',
    radius: '12px',
  },
  corporate: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #dbeafe 100%)',
    border: 'rgba(30, 64, 175, 0.24)',
    accent: '#1d4ed8',
    accentSoft: 'rgba(29, 78, 216, 0.12)',
    text: '#172554',
    muted: 'rgba(30, 58, 138, 0.68)',
    pattern: pattern.grid('rgba(29, 78, 216, 0.07)'),
    preview: 'linear-gradient(90deg, #1d4ed8, #60a5fa)',
    radius: '8px',
  },
  cosmic: {
    bg: 'linear-gradient(135deg, #050816 0%, #28104e 55%, #0f766e 100%)',
    border: 'rgba(125, 211, 252, 0.36)',
    accent: '#7dd3fc',
    accentSoft: 'rgba(167, 139, 250, 0.2)',
    pattern: pattern.dots('rgba(255, 255, 255, 0.22)'),
    preview: 'linear-gradient(90deg, #7dd3fc, #a78bfa, #34d399)',
    radius: '18px',
  },
  creative: {
    bg: 'linear-gradient(135deg, #fffbeb 0%, #fef2f2 45%, #e0f2fe 100%)',
    border: 'rgba(251, 113, 133, 0.34)',
    accent: '#fb7185',
    accentSoft: 'rgba(251, 113, 133, 0.16)',
    text: '#3f1d2f',
    muted: 'rgba(63, 29, 47, 0.66)',
    pattern: pattern.diagonal('rgba(251, 113, 133, 0.12)'),
    preview: 'linear-gradient(90deg, #fb7185, #fbbf24, #38bdf8)',
    radius: '18px',
  },
  dashboard: {
    bg: 'linear-gradient(135deg, #0f172a 0%, #111827 100%)',
    border: 'rgba(34, 197, 94, 0.28)',
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.14)',
    pattern: pattern.grid('rgba(34, 197, 94, 0.08)'),
    preview: 'linear-gradient(90deg, #22c55e, #38bdf8)',
    radius: '8px',
    previewRadius: '2px',
  },
  dithered: {
    bg: 'linear-gradient(135deg, #f5f5f4 0%, #292524 100%)',
    border: 'rgba(41, 37, 36, 0.38)',
    accent: '#ef4444',
    accentSoft: 'rgba(239, 68, 68, 0.16)',
    text: '#1c1917',
    muted: 'rgba(28, 25, 23, 0.68)',
    pattern: pattern.dots('rgba(41, 37, 36, 0.26)'),
    preview: 'repeating-linear-gradient(90deg, #1c1917 0 4px, #ef4444 4px 8px, #f5f5f4 8px 12px)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '6px',
    previewRadius: '1px',
  },
  doodle: {
    bg: 'linear-gradient(135deg, #fffdf4 0%, #fef3c7 100%)',
    border: 'rgba(30, 64, 175, 0.24)',
    accent: '#2563eb',
    accentSoft: 'rgba(37, 99, 235, 0.13)',
    text: '#1e293b',
    muted: 'rgba(30, 41, 59, 0.68)',
    pattern: pattern.paper('rgba(37, 99, 235, 0.1)'),
    preview: 'linear-gradient(90deg, #2563eb, #f59e0b)',
    fontFamily: '"Comic Sans MS", "Bradley Hand", cursive',
    radius: '13px 9px 16px 8px',
  },
  dramatic: {
    bg: 'linear-gradient(135deg, #09090b 0%, #3f0a0a 100%)',
    border: 'rgba(248, 113, 113, 0.42)',
    accent: '#f87171',
    accentSoft: 'rgba(248, 113, 113, 0.16)',
    pattern:
      'linear-gradient(110deg, transparent 0 48%, rgba(248, 113, 113, 0.18) 48% 54%, transparent 54%)',
    preview: 'linear-gradient(90deg, #09090b, #f87171)',
    titleTransform: 'uppercase',
  },
  editorial: {
    bg: 'linear-gradient(135deg, #faf7ef 0%, #f4ead5 100%)',
    border: 'rgba(127, 29, 29, 0.24)',
    accent: '#991b1b',
    accentSoft: 'rgba(153, 27, 27, 0.12)',
    text: '#1c1917',
    muted: 'rgba(68, 64, 60, 0.7)',
    pattern: pattern.paper('rgba(127, 29, 29, 0.08)'),
    preview: 'linear-gradient(90deg, #991b1b 0 24%, #1c1917 24% 34%, #faf7ef 34%)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '4px',
  },
  elegant: {
    bg: 'linear-gradient(135deg, #111111 0%, #f6f0df 100%)',
    border: 'rgba(234, 179, 8, 0.32)',
    accent: '#d4af37',
    accentSoft: 'rgba(212, 175, 55, 0.18)',
    text: '#fffaf0',
    muted: 'rgba(255, 250, 240, 0.76)',
    preview: 'linear-gradient(90deg, #d4af37, #fffaf0)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '18px',
  },
  energetic: {
    bg: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 38%, #1d4ed8 100%)',
    border: 'rgba(249, 115, 22, 0.36)',
    accent: '#f97316',
    accentSoft: 'rgba(249, 115, 22, 0.2)',
    text: '#172554',
    muted: 'rgba(23, 37, 84, 0.72)',
    pattern: pattern.diagonal('rgba(249, 115, 22, 0.16)'),
    preview: 'linear-gradient(90deg, #f97316, #1d4ed8)',
    radius: '10px',
    titleTransform: 'uppercase',
  },
  enterprise: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #e5e7eb 100%)',
    border: 'rgba(55, 65, 81, 0.18)',
    accent: '#475569',
    accentSoft: 'rgba(71, 85, 105, 0.12)',
    text: '#111827',
    muted: 'rgba(55, 65, 81, 0.66)',
    pattern: pattern.grid('rgba(71, 85, 105, 0.06)'),
    preview: 'linear-gradient(90deg, #475569, #94a3b8)',
    radius: '8px',
  },
  expressive: {
    bg: 'linear-gradient(135deg, #ecfeff 0%, #fce7f3 50%, #fef3c7 100%)',
    border: 'rgba(6, 182, 212, 0.28)',
    accent: '#06b6d4',
    accentSoft: 'rgba(236, 72, 153, 0.14)',
    text: '#164e63',
    muted: 'rgba(22, 78, 99, 0.68)',
    pattern: pattern.diagonal('rgba(236, 72, 153, 0.12)'),
    preview: 'linear-gradient(90deg, #06b6d4, #ec4899, #f59e0b)',
    radius: '17px',
  },
  fantasy: {
    bg: 'linear-gradient(135deg, #052e16 0%, #3b2f16 100%)',
    border: 'rgba(250, 204, 21, 0.34)',
    accent: '#facc15',
    accentSoft: 'rgba(250, 204, 21, 0.16)',
    pattern: pattern.dots('rgba(250, 204, 21, 0.12)'),
    preview: 'linear-gradient(90deg, #166534, #facc15)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '18px 8px 18px 8px',
  },
  fiction: {
    bg: 'linear-gradient(135deg, #f5efe0 0%, #292524 100%)',
    border: 'rgba(87, 83, 78, 0.34)',
    accent: '#a16207',
    accentSoft: 'rgba(161, 98, 7, 0.16)',
    text: '#1c1917',
    muted: 'rgba(28, 25, 23, 0.68)',
    pattern: pattern.paper('rgba(87, 83, 78, 0.12)'),
    preview: 'linear-gradient(90deg, #1c1917, #a16207)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '7px',
  },
  flat: {
    bg: 'linear-gradient(135deg, #fefefe 0%, #fef08a 100%)',
    border: 'rgba(15, 23, 42, 0.2)',
    accent: '#2563eb',
    accentSoft: 'rgba(37, 99, 235, 0.14)',
    text: '#111827',
    muted: 'rgba(31, 41, 55, 0.68)',
    pattern: pattern.blocks('rgba(239, 68, 68, 0.12)'),
    preview: 'linear-gradient(90deg, #2563eb 0 33%, #ef4444 33% 66%, #facc15 66%)',
    radius: '4px',
    previewRadius: '0px',
  },
  friendly: {
    bg: 'linear-gradient(135deg, #ecfccb 0%, #cffafe 50%, #fce7f3 100%)',
    border: 'rgba(34, 197, 94, 0.24)',
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.14)',
    text: '#14532d',
    muted: 'rgba(20, 83, 45, 0.68)',
    pattern: pattern.dots('rgba(34, 197, 94, 0.16)'),
    preview: 'linear-gradient(90deg, #86efac, #67e8f9, #f9a8d4)',
    radius: '20px',
    previewRadius: '999px',
  },
  futuristic: {
    bg: 'linear-gradient(135deg, #020617 0%, #0f172a 42%, #155e75 100%)',
    border: 'rgba(34, 211, 238, 0.4)',
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.16)',
    pattern: pattern.grid('rgba(34, 211, 238, 0.12)'),
    preview: 'linear-gradient(90deg, #22d3ee, #818cf8)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '6px',
    previewRadius: '1px',
  },
  glassmorphism: {
    bg: 'linear-gradient(135deg, rgba(15, 23, 42, 0.86), rgba(14, 165, 233, 0.38))',
    border: 'rgba(255, 255, 255, 0.28)',
    accent: '#bae6fd',
    accentSoft: 'rgba(255, 255, 255, 0.16)',
    pattern: 'linear-gradient(120deg, rgba(255,255,255,0.2), transparent 42%)',
    preview: 'linear-gradient(90deg, rgba(255,255,255,0.42), rgba(125,211,252,0.22))',
    radius: '18px',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.24), 0 18px 40px rgba(2, 6, 23, 0.28)',
  },
  gradient: {
    bg: 'linear-gradient(135deg, #0ea5e9 0%, #a855f7 52%, #f97316 100%)',
    border: 'rgba(255, 255, 255, 0.32)',
    accent: '#ffffff',
    accentSoft: 'rgba(255, 255, 255, 0.18)',
    pattern: 'linear-gradient(45deg, rgba(255,255,255,0.18), transparent 36%)',
    preview: 'linear-gradient(90deg, #ffffff, rgba(255,255,255,0.34))',
    radius: '16px',
  },
  immersive: {
    bg: 'linear-gradient(135deg, #0b1120 0%, #713f12 48%, #064e3b 100%)',
    border: 'rgba(253, 186, 116, 0.34)',
    accent: '#fdba74',
    accentSoft: 'rgba(253, 186, 116, 0.16)',
    pattern: 'radial-gradient(circle at 30% 20%, rgba(253, 186, 116, 0.24), transparent 34%)',
    preview: 'linear-gradient(90deg, #fdba74, #10b981)',
    radius: '4px',
  },
  impeccable: {
    bg: 'linear-gradient(135deg, #ffffff 0%, #eef2ff 100%)',
    border: 'rgba(99, 102, 241, 0.18)',
    accent: '#6366f1',
    accentSoft: 'rgba(99, 102, 241, 0.1)',
    text: '#111827',
    muted: 'rgba(55, 65, 81, 0.64)',
    preview: 'linear-gradient(90deg, #ffffff, #c7d2fe)',
    radius: '18px',
    shadow: '0 20px 42px rgba(99, 102, 241, 0.18)',
  },
  levels: {
    bg: 'linear-gradient(135deg, #111827 0%, #312e81 100%)',
    border: 'rgba(52, 211, 153, 0.34)',
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.16)',
    pattern: pattern.blocks('rgba(52, 211, 153, 0.12)'),
    preview: 'linear-gradient(90deg, #34d399 0 20%, #facc15 20% 40%, #f97316 40% 60%, #ef4444 60%)',
    radius: '10px',
    previewRadius: '2px',
  },
  lingo: {
    bg: 'linear-gradient(135deg, #fefce8 0%, #dcfce7 55%, #e0f2fe 100%)',
    border: 'rgba(132, 204, 22, 0.28)',
    accent: '#65a30d',
    accentSoft: 'rgba(132, 204, 22, 0.16)',
    text: '#27411b',
    muted: 'rgba(39, 65, 27, 0.66)',
    pattern: pattern.dots('rgba(132, 204, 22, 0.16)'),
    preview: 'linear-gradient(90deg, #65a30d, #06b6d4)',
    radius: '16px 16px 16px 4px',
  },
  luxury: {
    bg: 'linear-gradient(135deg, #050505 0%, #1f1b12 100%)',
    border: 'rgba(217, 119, 6, 0.42)',
    accent: '#d97706',
    accentSoft: 'rgba(217, 119, 6, 0.16)',
    pattern: pattern.diagonal('rgba(217, 119, 6, 0.12)'),
    preview: 'linear-gradient(90deg, #d97706, #fde68a)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '14px',
  },
  material: {
    bg: 'linear-gradient(135deg, #ffffff 0%, #e8f0fe 100%)',
    border: 'rgba(66, 133, 244, 0.24)',
    accent: '#4285f4',
    accentSoft: 'rgba(66, 133, 244, 0.13)',
    text: '#202124',
    muted: 'rgba(60, 64, 67, 0.7)',
    preview: 'linear-gradient(90deg, #4285f4 0 34%, #34a853 34% 67%, #fbbc05 67%)',
    radius: '12px',
  },
  'material-3': {
    bg: '#fffbff',
    border: '#cac4d0',
    accent: '#6750a4',
    accentSoft: '#eaddff',
    text: '#1d1b20',
    muted: 'rgba(73, 69, 79, 0.78)',
    pattern: 'linear-gradient(180deg, #fffbff, #f7f2fa)',
    preview: '#f7f2fa',
    fontFamily: 'Roboto, "Google Sans", ui-sans-serif, system-ui, sans-serif',
    radius: '28px',
    previewRadius: '22px',
    shadow: '0 2px 8px rgba(103, 80, 164, 0.16)',
    titleWeight: 500,
  },
  matrix: {
    bg: 'linear-gradient(135deg, #020403 0%, #052e16 100%)',
    border: 'rgba(34, 197, 94, 0.42)',
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
    pattern: pattern.grid('rgba(34, 197, 94, 0.12)'),
    preview: 'repeating-linear-gradient(90deg, #22c55e 0 3px, #052e16 3px 6px)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '2px',
    previewRadius: '0px',
  },
  minimal: {
    bg: 'linear-gradient(135deg, #fafafa 0%, #ffffff 100%)',
    border: 'rgba(24, 24, 27, 0.14)',
    accent: '#18181b',
    accentSoft: 'rgba(24, 24, 27, 0.08)',
    text: '#18181b',
    muted: 'rgba(63, 63, 70, 0.62)',
    pattern: 'linear-gradient(180deg, transparent, rgba(24, 24, 27, 0.03))',
    preview: 'linear-gradient(90deg, #18181b, #e4e4e7)',
    radius: '2px',
    previewRadius: '0px',
  },
  modern: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%)',
    border: 'rgba(2, 132, 199, 0.2)',
    accent: '#0284c7',
    accentSoft: 'rgba(2, 132, 199, 0.1)',
    text: '#0f172a',
    muted: 'rgba(51, 65, 85, 0.66)',
    preview: 'linear-gradient(90deg, #0284c7, #38bdf8)',
    radius: '12px',
  },
  mono: {
    bg: 'linear-gradient(135deg, #111827 0%, #27272a 100%)',
    border: 'rgba(212, 212, 216, 0.24)',
    accent: '#d4d4d8',
    accentSoft: 'rgba(212, 212, 216, 0.12)',
    pattern: pattern.grid('rgba(212, 212, 216, 0.08)'),
    preview: 'linear-gradient(90deg, #d4d4d8, #71717a)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '4px',
    previewRadius: '1px',
  },
  neobrutalism: {
    bg: 'linear-gradient(135deg, #fef08a 0%, #fb7185 100%)',
    border: '#111111',
    accent: '#111111',
    accentSoft: 'rgba(17, 17, 17, 0.14)',
    text: '#111111',
    muted: 'rgba(17, 17, 17, 0.72)',
    pattern: pattern.grid('rgba(17, 17, 17, 0.14)'),
    preview: 'linear-gradient(90deg, #111111 0 30%, #22c55e 30% 62%, #3b82f6 62%)',
    radius: '6px',
    previewRadius: '0px',
    shadow: '7px 7px 0 rgba(17, 17, 17, 0.6)',
    titleTransform: 'uppercase',
  },
  neon: {
    bg: 'linear-gradient(135deg, #05030a 0%, #1f1147 100%)',
    border: 'rgba(34, 211, 238, 0.5)',
    accent: '#22d3ee',
    accentSoft: 'rgba(236, 72, 153, 0.2)',
    pattern: pattern.grid('rgba(236, 72, 153, 0.12)'),
    preview: 'linear-gradient(90deg, #22d3ee, #ec4899)',
    radius: '14px',
    shadow: '0 0 28px rgba(34, 211, 238, 0.22), 0 16px 34px rgba(0,0,0,0.32)',
  },
  neumorphism: {
    bg: 'linear-gradient(135deg, #e5e7eb 0%, #f8fafc 100%)',
    border: 'rgba(255, 255, 255, 0.8)',
    accent: '#64748b',
    accentSoft: 'rgba(100, 116, 139, 0.12)',
    text: '#334155',
    muted: 'rgba(51, 65, 85, 0.64)',
    preview: 'linear-gradient(90deg, #f8fafc, #cbd5e1)',
    radius: '22px',
    previewRadius: '999px',
    shadow:
      'inset 5px 5px 12px rgba(148, 163, 184, 0.32), inset -5px -5px 12px rgba(255,255,255,0.86)',
  },
  pacman: {
    bg: 'linear-gradient(135deg, #000000 0%, #111827 100%)',
    border: 'rgba(250, 204, 21, 0.46)',
    accent: '#facc15',
    accentSoft: 'rgba(37, 99, 235, 0.2)',
    pattern: pattern.dots('rgba(250, 204, 21, 0.28)'),
    preview: 'linear-gradient(90deg, #facc15 0 26%, #2563eb 26% 52%, #ef4444 52% 78%, #f9a8d4 78%)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '2px',
    previewRadius: '0px',
  },
  paper: {
    bg: 'linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)',
    border: 'rgba(120, 113, 108, 0.28)',
    accent: '#78716c',
    accentSoft: 'rgba(120, 113, 108, 0.12)',
    text: '#292524',
    muted: 'rgba(68, 64, 60, 0.7)',
    pattern: pattern.paper('rgba(120, 113, 108, 0.1)'),
    preview: 'linear-gradient(90deg, #78716c, #fef3c7)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '5px 16px 6px 12px',
  },
  perspective: {
    bg: 'linear-gradient(135deg, #eef2ff 0%, #dbeafe 100%)',
    border: 'rgba(79, 70, 229, 0.22)',
    accent: '#4f46e5',
    accentSoft: 'rgba(79, 70, 229, 0.12)',
    text: '#1e1b4b',
    muted: 'rgba(49, 46, 129, 0.68)',
    pattern: pattern.grid('rgba(79, 70, 229, 0.1)'),
    preview: 'linear-gradient(110deg, #4f46e5 0 28%, #60a5fa 28% 62%, #eef2ff 62%)',
    radius: '10px',
  },
  premium: {
    bg: 'linear-gradient(135deg, #f8fafc 0%, #c7d2fe 50%, #ffffff 100%)',
    border: 'rgba(255, 255, 255, 0.7)',
    accent: '#6366f1',
    accentSoft: 'rgba(99, 102, 241, 0.12)',
    text: '#111827',
    muted: 'rgba(55, 65, 81, 0.64)',
    preview: 'linear-gradient(90deg, #ffffff, #a5b4fc)',
    radius: '20px',
    shadow: '0 22px 46px rgba(99, 102, 241, 0.2)',
  },
  professional: {
    bg: 'linear-gradient(135deg, #f9fafb 0%, #e5e7eb 100%)',
    border: 'rgba(31, 41, 55, 0.16)',
    accent: '#374151',
    accentSoft: 'rgba(55, 65, 81, 0.1)',
    text: '#111827',
    muted: 'rgba(55, 65, 81, 0.66)',
    preview: 'linear-gradient(90deg, #374151, #9ca3af)',
    radius: '8px',
  },
  publication: {
    bg: 'linear-gradient(135deg, #f5f5f4 0%, #e7e5e4 100%)',
    border: 'rgba(28, 25, 23, 0.2)',
    accent: '#1c1917',
    accentSoft: 'rgba(28, 25, 23, 0.1)',
    text: '#1c1917',
    muted: 'rgba(68, 64, 60, 0.7)',
    pattern: pattern.paper('rgba(28, 25, 23, 0.1)'),
    preview: 'linear-gradient(90deg, #1c1917 0 18%, #78716c 18% 28%, #f5f5f4 28%)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '2px',
  },
  refined: {
    bg: 'linear-gradient(135deg, #f7fee7 0%, #ecfeff 100%)',
    border: 'rgba(20, 83, 45, 0.18)',
    accent: '#15803d',
    accentSoft: 'rgba(21, 128, 61, 0.1)',
    text: '#14532d',
    muted: 'rgba(20, 83, 45, 0.64)',
    preview: 'linear-gradient(90deg, #15803d, #a7f3d0)',
    radius: '14px',
  },
  retro: {
    bg: 'linear-gradient(135deg, #fde68a 0%, #fb923c 48%, #7c2d12 100%)',
    border: 'rgba(124, 45, 18, 0.34)',
    accent: '#7c2d12',
    accentSoft: 'rgba(124, 45, 18, 0.16)',
    text: '#431407',
    muted: 'rgba(67, 20, 7, 0.68)',
    pattern: pattern.diagonal('rgba(124, 45, 18, 0.14)'),
    preview: 'linear-gradient(90deg, #7c2d12, #facc15, #0f766e)',
    radius: '18px 4px 18px 4px',
  },
  riso: {
    bg: 'linear-gradient(135deg, #fdf2f8 0%, #fde68a 100%)',
    border: 'rgba(219, 39, 119, 0.28)',
    accent: '#db2777',
    accentSoft: 'rgba(219, 39, 119, 0.14)',
    text: '#831843',
    muted: 'rgba(131, 24, 67, 0.68)',
    pattern: pattern.dots('rgba(219, 39, 119, 0.22)'),
    preview: 'linear-gradient(90deg, #db2777, #facc15, #2563eb)',
    radius: '6px',
  },
  sega: {
    bg: 'linear-gradient(135deg, #082f49 0%, #0ea5e9 52%, #facc15 100%)',
    border: 'rgba(250, 204, 21, 0.42)',
    accent: '#facc15',
    accentSoft: 'rgba(14, 165, 233, 0.2)',
    pattern: pattern.grid('rgba(255, 255, 255, 0.12)'),
    preview: 'linear-gradient(90deg, #0ea5e9, #facc15)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '8px',
    titleTransform: 'uppercase',
  },
  shadcn: {
    bg: 'linear-gradient(135deg, #09090b 0%, #18181b 100%)',
    border: 'rgba(244, 244, 245, 0.18)',
    accent: '#fafafa',
    accentSoft: 'rgba(244, 244, 245, 0.1)',
    pattern: pattern.grid('rgba(244, 244, 245, 0.06)'),
    preview: 'linear-gradient(90deg, #fafafa, #71717a)',
    radius: '8px',
  },
  simple: {
    bg: 'linear-gradient(135deg, #ffffff 0%, #f4f4f5 100%)',
    border: 'rgba(63, 63, 70, 0.14)',
    accent: '#3f3f46',
    accentSoft: 'rgba(63, 63, 70, 0.09)',
    text: '#18181b',
    muted: 'rgba(63, 63, 70, 0.64)',
    preview: 'linear-gradient(90deg, #3f3f46, #d4d4d8)',
    radius: '8px',
  },
  sketch: {
    bg: 'linear-gradient(135deg, #fffbeb 0%, #fefce8 100%)',
    border: 'rgba(30, 41, 59, 0.24)',
    accent: '#1e293b',
    accentSoft: 'rgba(30, 41, 59, 0.1)',
    text: '#1e293b',
    muted: 'rgba(30, 41, 59, 0.66)',
    pattern: pattern.paper('rgba(30, 41, 59, 0.1)'),
    preview: 'linear-gradient(90deg, #1e293b, #f59e0b)',
    fontFamily: '"Comic Sans MS", "Bradley Hand", cursive',
    radius: '17px 10px 14px 8px',
  },
  skeumorphism: {
    bg: 'linear-gradient(135deg, #78350f 0%, #d6d3d1 100%)',
    border: 'rgba(120, 53, 15, 0.42)',
    accent: '#fbbf24',
    accentSoft: 'rgba(251, 191, 36, 0.18)',
    text: '#fff7ed',
    muted: 'rgba(255, 247, 237, 0.76)',
    pattern: pattern.diagonal('rgba(255, 247, 237, 0.1)'),
    preview: 'linear-gradient(90deg, #92400e, #fbbf24, #d6d3d1)',
    radius: '12px',
    shadow:
      'inset 0 2px 3px rgba(255,255,255,0.28), inset 0 -4px 8px rgba(0,0,0,0.22), 0 16px 34px rgba(0,0,0,0.24)',
  },
  sleek: {
    bg: 'linear-gradient(135deg, #030712 0%, #374151 100%)',
    border: 'rgba(209, 213, 219, 0.28)',
    accent: '#d1d5db',
    accentSoft: 'rgba(209, 213, 219, 0.12)',
    pattern: 'linear-gradient(115deg, rgba(255,255,255,0.18), transparent 34%)',
    preview: 'linear-gradient(90deg, #f9fafb, #6b7280)',
    radius: '14px',
  },
  spacious: {
    bg: 'linear-gradient(135deg, #ffffff 0%, #eff6ff 100%)',
    border: 'rgba(59, 130, 246, 0.14)',
    accent: '#3b82f6',
    accentSoft: 'rgba(59, 130, 246, 0.08)',
    text: '#0f172a',
    muted: 'rgba(51, 65, 85, 0.62)',
    preview: 'linear-gradient(90deg, #dbeafe, #ffffff)',
    radius: '18px',
  },
  storytelling: {
    bg: 'linear-gradient(135deg, #1c1917 0%, #7c2d12 60%, #fef3c7 100%)',
    border: 'rgba(251, 191, 36, 0.34)',
    accent: '#fbbf24',
    accentSoft: 'rgba(251, 191, 36, 0.16)',
    text: '#fff7ed',
    muted: 'rgba(255, 247, 237, 0.76)',
    pattern: pattern.paper('rgba(251, 191, 36, 0.08)'),
    preview: 'linear-gradient(90deg, #fbbf24, #7c2d12)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '12px',
  },
  terracotta: {
    bg: 'linear-gradient(135deg, #f4c7ab 0%, #c2410c 100%)',
    border: 'rgba(154, 52, 18, 0.32)',
    accent: '#9a3412',
    accentSoft: 'rgba(154, 52, 18, 0.16)',
    text: '#431407',
    muted: 'rgba(67, 20, 7, 0.68)',
    pattern: pattern.dots('rgba(154, 52, 18, 0.12)'),
    preview: 'linear-gradient(90deg, #9a3412, #fed7aa)',
    radius: '14px',
  },
  tetris: {
    bg: 'linear-gradient(135deg, #020617 0%, #111827 100%)',
    border: 'rgba(250, 204, 21, 0.42)',
    accent: '#facc15',
    accentSoft: 'rgba(59, 130, 246, 0.18)',
    pattern: pattern.grid('rgba(255, 255, 255, 0.1)'),
    preview:
      'linear-gradient(90deg, #ef4444 0 20%, #22c55e 20% 40%, #3b82f6 40% 60%, #facc15 60% 80%, #a855f7 80%)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    radius: '2px',
    previewRadius: '0px',
  },
  vibrant: {
    bg: 'linear-gradient(135deg, #f43f5e 0%, #f59e0b 35%, #22c55e 70%, #06b6d4 100%)',
    border: 'rgba(255, 255, 255, 0.34)',
    accent: '#ffffff',
    accentSoft: 'rgba(255, 255, 255, 0.18)',
    pattern: pattern.diagonal('rgba(255, 255, 255, 0.16)'),
    preview: 'linear-gradient(90deg, #ffffff, rgba(255,255,255,0.32))',
    radius: '18px',
    titleTransform: 'uppercase',
  },
  vintage: {
    bg: 'linear-gradient(135deg, #f5e6c8 0%, #b45309 100%)',
    border: 'rgba(120, 53, 15, 0.34)',
    accent: '#78350f',
    accentSoft: 'rgba(120, 53, 15, 0.14)',
    text: '#3b2414',
    muted: 'rgba(59, 36, 20, 0.68)',
    pattern: pattern.dots('rgba(120, 53, 15, 0.16)'),
    preview: 'linear-gradient(90deg, #78350f, #f5e6c8, #166534)',
    fontFamily: 'Georgia, ui-serif, serif',
    radius: '6px',
  },
  windows95: {
    bg: '#008080',
    border: '#000000',
    accent: '#000080',
    accentSoft: '#c0c0c0',
    text: '#ffffff',
    muted: '#dfdfdf',
    pattern: pattern.grid('rgba(255, 255, 255, 0.08)'),
    preview: '#c0c0c0',
    fontFamily: '"Pixelated MS Sans Serif", "MS Sans Serif", Arial, sans-serif',
    radius: '0px',
    previewRadius: '0px',
    shadow: 'inset -1px -1px 0 #000000, inset 1px 1px 0 #ffffff',
    titleWeight: 700,
  },
  'dragonball-z': {
    bg: 'linear-gradient(135deg, #f5d13a 0%, #e8761c 38%, #1c419b 100%)',
    border: '#0a0a0a',
    accent: '#e8761c',
    accentSoft: '#f5d13a',
    text: '#0a0a0a',
    muted: 'rgba(10, 10, 10, 0.74)',
    pattern: pattern.diagonal('rgba(10, 10, 10, 0.22)'),
    preview: '#6ec4e8',
    fontFamily: 'Impact, "Arial Black", ui-sans-serif, system-ui, sans-serif',
    radius: '4px',
    previewRadius: '0px',
    shadow: '6px 6px 0 rgba(10, 10, 10, 0.75)',
    titleTransform: 'uppercase',
    titleWeight: 900,
  },
};

const fallbackThemes: Array<Partial<DesignCardTheme>> = [
  { accent: '#38bdf8', bg: 'linear-gradient(135deg, #082f49, #0f172a)' },
  { accent: '#f97316', bg: 'linear-gradient(135deg, #431407, #111827)' },
  { accent: '#22c55e', bg: 'linear-gradient(135deg, #052e16, #0f172a)' },
  { accent: '#f43f5e', bg: 'linear-gradient(135deg, #4c0519, #111827)' },
  { accent: '#eab308', bg: 'linear-gradient(135deg, #422006, #111827)' },
  { accent: '#14b8a6', bg: 'linear-gradient(135deg, #134e4a, #111827)' },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

const DESIGN_PREVIEW_WIDTH = 400;
const DESIGN_PREVIEW_HEIGHT = 300;
const DESIGN_SHELL_ACCENT = '#67e8f9';
const DESIGN_SHELL_TEXT = '#f8fafc';
const DESIGN_SHELL_BORDER = 'rgba(148, 163, 184, 0.34)';
const DESIGN_SHELL_PATTERN = pattern.grid('rgba(148, 163, 184, 0.08)');
const DESIGN_PREVIEW_WINDOW_STYLE: CSSProperties = {
  borderColor: 'rgba(148, 163, 184, 0.36)',
  borderRadius: '10px',
  boxShadow: '0 14px 34px rgba(2, 6, 23, 0.28)',
};
function getDesignShellStyle(active: boolean): CSSProperties {
  return {
    background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))',
    borderColor: active ? DESIGN_SHELL_ACCENT : DESIGN_SHELL_BORDER,
    borderRadius: '14px',
    boxShadow: active
      ? `0 0 0 1px ${DESIGN_SHELL_ACCENT}, 0 18px 44px rgba(2, 6, 23, 0.34)`
      : '0 16px 38px rgba(2, 6, 23, 0.24)',
    color: DESIGN_SHELL_TEXT,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  };
}

interface DesignPreviewFrameProps {
  item: SkillLibraryItem;
  src: string;
  className?: string;
  style?: CSSProperties;
}

function DesignPreviewFrame({ item, src, className, style }: DesignPreviewFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return undefined;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };
    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const availableWidth = frameSize.width || DESIGN_PREVIEW_WIDTH;
  const availableHeight = frameSize.height || DESIGN_PREVIEW_HEIGHT;
  const scale = Math.max(
    0.1,
    Math.min(availableWidth / DESIGN_PREVIEW_WIDTH, availableHeight / DESIGN_PREVIEW_HEIGHT)
  );
  const renderedWidth = DESIGN_PREVIEW_WIDTH * scale;
  const renderedHeight = DESIGN_PREVIEW_HEIGHT * scale;
  const offsetX = Math.max(0, (availableWidth - renderedWidth) / 2);
  const offsetY = Math.max(0, (availableHeight - renderedHeight) / 2);

  return (
    <div
      ref={frameRef}
      className={cn('relative aspect-[4/3] w-full overflow-hidden bg-background', className)}
      style={style}
      aria-hidden="true"
    >
      <iframe
        title={`${item.name} design preview`}
        src={src}
        loading="lazy"
        sandbox="allow-same-origin"
        tabIndex={-1}
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{
          width: `${DESIGN_PREVIEW_WIDTH}px`,
          height: `${DESIGN_PREVIEW_HEIGHT}px`,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

function getScalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function getFirstTokenColor(item: SkillLibraryItem, names: string[]): string | undefined {
  const colors = item.designMd?.tokens.colors;
  if (!colors) return undefined;
  for (const name of names) {
    const value = colors[name];
    if (value) return value;
  }
  return Object.values(colors).find(Boolean);
}

function getDesignMdCardTheme(item: SkillLibraryItem): Partial<DesignCardTheme> | null {
  if (!item.designMd) return null;

  const primary = getFirstTokenColor(item, ['primary', 'text', 'foreground']) || '#111827';
  const surface = getFirstTokenColor(item, ['surface', 'neutral', 'background']) || '#ffffff';
  const secondary = getFirstTokenColor(item, ['secondary', 'muted', 'border']) || primary;
  const accent = getFirstTokenColor(item, ['tertiary', 'accent', 'primary']) || primary;
  const text = getFirstTokenColor(item, ['text', 'on-surface', 'foreground']) || primary;
  const typography =
    item.designMd.tokens.typography.h1 ||
    item.designMd.tokens.typography['body-md'] ||
    Object.values(item.designMd.tokens.typography)[0];
  const fontFamily = getScalarString(typography?.fontFamily);
  const radius =
    getScalarString(item.designMd.tokens.rounded.md) ||
    getScalarString(item.designMd.tokens.rounded.sm) ||
    '8px';

  return {
    bg: `linear-gradient(135deg, ${surface} 0%, ${secondary} 100%)`,
    border: `color-mix(in srgb, ${accent} 42%, transparent)`,
    accent,
    accentSoft: `color-mix(in srgb, ${accent} 18%, transparent)`,
    text,
    muted: `color-mix(in srgb, ${text} 66%, transparent)`,
    pattern: pattern.grid(`color-mix(in srgb, ${accent} 10%, transparent)`),
    preview: `linear-gradient(90deg, ${primary}, ${accent}, ${surface})`,
    fontFamily: fontFamily || defaultDesignTheme.fontFamily,
    radius,
    previewRadius: radius,
  };
}

function getDesignCardTheme(item: SkillLibraryItem): DesignCardTheme {
  const slug = getDesignSlug(item);
  const preset =
    designThemePresets[slug] || fallbackThemes[hashString(slug) % fallbackThemes.length];
  return {
    ...defaultDesignTheme,
    ...preset,
    ...(getDesignMdCardTheme(item) || {}),
  };
}

interface DesignTokenPreviewProps {
  item: SkillLibraryItem;
  theme: DesignCardTheme;
  compact?: boolean;
}

function DesignTokenPreview({ item, theme, compact = false }: DesignTokenPreviewProps) {
  const colors = Object.entries(item.designMd?.tokens.colors ?? {}).slice(0, compact ? 4 : 6);
  const typography =
    item.designMd?.tokens.typography.h1 ||
    item.designMd?.tokens.typography['body-md'] ||
    Object.values(item.designMd?.tokens.typography ?? {})[0];
  const fontFamily = getScalarString(typography?.fontFamily) || theme.fontFamily;
  const fontSize = getScalarString(typography?.fontSize) || (compact ? '1rem' : '1.25rem');
  const componentCount = Object.keys(item.designMd?.tokens.components ?? {}).length;
  const radiusValues = Object.values(item.designMd?.tokens.rounded ?? {})
    .map(getScalarString)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

  return (
    <div
      className={cn(
        'relative overflow-hidden border',
        compact ? 'mt-3 aspect-[4/3] p-3' : 'mt-4 aspect-[4/3] p-4'
      )}
      style={{
        background: theme.bg,
        borderColor: theme.border,
        borderRadius: theme.previewRadius,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
      aria-hidden="true"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{ backgroundImage: theme.pattern, backgroundSize: '16px 16px' }}
      />
      <div className="relative z-10 flex h-full flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="truncate font-semibold leading-tight"
              style={{
                color: theme.text,
                fontFamily,
                fontSize,
                fontWeight: getScalarString(typography?.fontWeight) || theme.titleWeight,
              }}
            >
              {item.designMd?.name || getDesignDisplayName(item)}
            </div>
            <div className="mt-1 truncate text-[10px]" style={{ color: theme.muted }}>
              DESIGN.md
            </div>
          </div>
          <div
            className="h-8 w-8 shrink-0 border"
            style={{
              background: theme.accent,
              borderColor: theme.border,
              borderRadius: theme.previewRadius,
            }}
          />
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {colors.map(([name, value]) => (
            <div key={name} className="min-w-0">
              <div
                className="h-7 border"
                style={{
                  background: value,
                  borderColor: theme.border,
                  borderRadius: '4px',
                }}
              />
              <div className="mt-1 truncate text-[8px]" style={{ color: theme.muted }}>
                {name}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div className="space-y-1.5">
            {[70, 44, 58].map((width, index) => (
              <div
                key={width}
                className="h-2"
                style={{
                  width: `${width}%`,
                  background: index === 0 ? theme.accent : theme.accentSoft,
                  borderRadius: radiusValues[index] || theme.previewRadius,
                }}
              />
            ))}
          </div>
          <div
            className="border px-2 py-1 text-[9px] font-semibold"
            style={{
              background: theme.accent,
              borderColor: theme.border,
              borderRadius: theme.previewRadius,
              color: getReadableColorForSolid(theme.accent),
            }}
          >
            {componentCount || colors.length}
          </div>
        </div>
      </div>
    </div>
  );
}

function getReadableColorForSolid(color: string): string {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const hex = match?.[1];
  if (!hex) return '#0f172a';

  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : hex;
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return luminance > 0.58 ? '#111827' : '#ffffff';
}

/** Card preview of one design preset: its HTML demo or its DESIGN.md tokens. */
export function DesignStylePreview({
  item,
  className,
}: {
  item: SkillLibraryItem;
  className?: string;
}) {
  const presentation = getDesignPreviewPresentation(item);
  if (presentation.kind === 'tokens') {
    return <DesignTokenPreview item={item} theme={getDesignCardTheme(item)} compact />;
  }
  return (
    <DesignPreviewFrame
      item={item}
      src={presentation.src}
      className={cn('mt-3 border', className)}
      style={DESIGN_PREVIEW_WINDOW_STYLE}
    />
  );
}

export function SessionStyleLibraryPanel({
  sessionId,
  provider,
  kind,
  selectedSkill,
  onSessionUpdated,
  className,
}: SessionStyleLibraryPanelProps) {
  const [query, setQuery] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const copy = libraryCopy[kind];
  const Icon = copy.icon;

  const { data, isLoading } = useQuery({
    queryKey: ['style-library', provider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StyleLibraryResponse>>(
        `/api/claude-config/style-library?provider=${encodeURIComponent(provider)}`
      );
      return response.data.data;
    },
  });

  const items = getItems(data, kind);
  const activeItem = items.find((item) => item.baseName === selectedSkill) || null;
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = `${item.name} ${item.baseName} ${item.description}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query]);
  const groupedWritingItems = useMemo(() => {
    if (kind !== 'writing') return [];

    return writingStyleTypeOrder
      .map((type) => ({
        type,
        items: filteredItems.filter((item) => getWritingStyleType(item) === type),
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredItems, kind]);

  const mutation = useMutation({
    mutationFn: async (nextSkill: string | null) => {
      const payload =
        kind === 'design' ? { designStyleSkill: nextSkill } : { writingStyleSkill: nextSkill };
      const response = await api.patch<ApiResponse<Session>>(
        `/api/sessions/${sessionId}/styles`,
        payload
      );
      return response.data.data;
    },
    onSuccess: (updatedSession) => {
      if (updatedSession) {
        onSessionUpdated(updatedSession);
      }
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({ title: copy.toast, description: 'Der nächste Prompt verwendet diese Auswahl.' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Stil konnte nicht geändert werden',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const importDesignMdMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post<ApiResponse<DesignMdImportResult>>(
        `/api/claude-config/style-library/design-md/import?provider=${encodeURIComponent(
          provider
        )}&conflict=overwrite`,
        form
      );
      return response.data.data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['style-library', provider] });
      if (result?.status === 'imported') {
        toast({
          title: 'DESIGN.md importiert',
          description: `${result.skill?.baseName || 'Design-Vorgabe'} ist jetzt in der Stilbibliothek.`,
        });
      } else {
        toast({
          title: 'DESIGN.md übersprungen',
          description: result?.reason || 'Die Designdatei konnte nicht importiert werden.',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'DESIGN.md-Import fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleDesignMdFile = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    importDesignMdMutation.mutate(file);
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
  };

  const exportDesignMd = async (item: SkillLibraryItem | null) => {
    if (!item) return;
    try {
      const response = await api.download(
        `/api/claude-config/style-library/design/${encodeURIComponent(
          item.baseName
        )}/design-md?provider=${encodeURIComponent(provider)}`
      );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${item.baseName}-DESIGN.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'DESIGN.md exportiert', description: `${item.baseName}-DESIGN.md` });
    } catch (error) {
      toast({
        title: 'DESIGN.md-Export fehlgeschlagen',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const renderDesignPreview = (item: SkillLibraryItem, theme: DesignCardTheme, compact = false) => {
    const presentation = getDesignPreviewPresentation(item);
    if (presentation.kind === 'tokens') {
      return <DesignTokenPreview item={item} theme={theme} compact={compact} />;
    }

    return (
      <DesignPreviewFrame
        item={item}
        src={presentation.src}
        className={cn('border', compact ? 'mt-3' : 'mt-4')}
        style={DESIGN_PREVIEW_WINDOW_STYLE}
      />
    );
  };

  const renderDesignItem = (item: SkillLibraryItem) => {
    const active = item.baseName === selectedSkill;
    const theme = getDesignCardTheme(item);
    const activeIconColor = getReadableColorForSolid(DESIGN_SHELL_ACCENT);
    const displayName = getDesignDisplayName(item);

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => mutation.mutate(active ? null : item.baseName)}
        disabled={mutation.isPending}
        aria-label={`Select ${getDesignDisplayName(item)} UI style`}
        className={cn(
          'group relative w-full overflow-hidden border p-3 text-left transition-all duration-200',
          'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
          active && 'scale-[1.01]'
        )}
        style={getDesignShellStyle(active)}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            backgroundImage: DESIGN_SHELL_PATTERN,
            backgroundSize: '18px 18px',
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1.5"
          style={{ background: active ? DESIGN_SHELL_ACCENT : 'transparent' }}
        />
        <div className="relative z-10">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className="truncate text-sm font-semibold leading-5"
                  style={{ color: DESIGN_SHELL_TEXT }}
                >
                  {displayName}
                </div>
                {item.designMd && (
                  <span
                    className="shrink-0 border px-1.5 py-0.5 text-[9px] font-semibold"
                    style={{
                      borderColor: DESIGN_SHELL_BORDER,
                      borderRadius: '5px',
                      color: DESIGN_SHELL_ACCENT,
                    }}
                  >
                    DESIGN.md
                  </span>
                )}
              </div>
            </div>
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center border"
              style={{
                background: active ? DESIGN_SHELL_ACCENT : 'rgba(148, 163, 184, 0.14)',
                borderColor: active ? DESIGN_SHELL_ACCENT : DESIGN_SHELL_BORDER,
                borderRadius: '10px',
                color: active ? activeIconColor : DESIGN_SHELL_ACCENT,
              }}
            >
              {active ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
          </div>
          {renderDesignPreview(item, theme)}
        </div>
      </button>
    );
  };

  const renderItem = (item: SkillLibraryItem) => {
    if (kind === 'design') {
      return renderDesignItem(item);
    }

    const active = item.baseName === selectedSkill;
    const styleType = getWritingStyleType(item);
    const typeCopy = writingStyleTypeCopy[styleType];
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => mutation.mutate(active ? null : item.baseName)}
        disabled={mutation.isPending}
        className={cn(
          'w-full rounded-lg border p-3 text-left transition-all',
          active
            ? 'border-primary/45 bg-primary/10 text-foreground'
            : 'border-border/55 bg-foreground/[0.025] hover:border-border hover:bg-foreground/[0.045]'
        )}
      >
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {active ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-xs font-semibold">{item.name}</div>
              <span className="shrink-0 rounded border border-border/50 bg-background/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {typeCopy.selectedLabel}
              </span>
              {item.model && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {item.model}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
              {item.description || item.baseName}
            </p>
          </div>
        </div>
      </button>
    );
  };

  const renderActiveDesignSummary = (item: SkillLibraryItem) => {
    const theme = getDesignCardTheme(item);
    const activeIconColor = getReadableColorForSolid(DESIGN_SHELL_ACCENT);
    const displayName = getDesignDisplayName(item);
    return (
      <div className="relative overflow-hidden border p-3" style={getDesignShellStyle(true)}>
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage: DESIGN_SHELL_PATTERN,
            backgroundSize: '18px 18px',
          }}
        />
        <div className="relative z-10 mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center border"
              style={{
                background: DESIGN_SHELL_ACCENT,
                borderColor: DESIGN_SHELL_ACCENT,
                borderRadius: '10px',
                color: activeIconColor,
              }}
            >
              <Check className="h-4 w-4" />
            </div>
            <div
              className="truncate text-sm font-semibold leading-5"
              style={{ color: DESIGN_SHELL_TEXT }}
            >
              {displayName}
            </div>
            {item.designMd && (
              <span
                className="shrink-0 border px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  borderColor: DESIGN_SHELL_BORDER,
                  borderRadius: '5px',
                  color: DESIGN_SHELL_ACCENT,
                }}
              >
                DESIGN.md
              </span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            onClick={() => mutation.mutate(null)}
            disabled={mutation.isPending}
            title="Clear style"
            style={{ color: DESIGN_SHELL_TEXT }}
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <div className="relative z-10">{renderDesignPreview(item, theme, true)}</div>
      </div>
    );
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="shrink-0 border-b border-border/60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{copy.title}</h3>
          {kind === 'design' && (
            <div className="ml-auto flex items-center gap-1.5">
              <input
                ref={importInputRef}
                type="file"
                accept=".md,text/markdown,text/plain"
                className="hidden"
                onChange={(event) => handleDesignMdFile(event.target.files)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => importInputRef.current?.click()}
                disabled={importDesignMdMutation.isPending}
                title="Import DESIGN.md"
              >
                {importDesignMdMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Import
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => exportDesignMd(activeItem)}
                disabled={!activeItem}
                title="Export active DESIGN.md"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 border-b border-border/50 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {copy.selected}
        </div>
        {kind === 'design' && activeItem ? (
          renderActiveDesignSummary(activeItem)
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-border/55 bg-foreground/[0.025] p-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">
                {activeItem ? activeItem.name : copy.clear}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {activeItem && kind === 'writing'
                  ? `${writingStyleTypeCopy[getWritingStyleType(activeItem)].selectedLabel} · ${activeItem.baseName}`
                  : activeItem
                    ? activeItem.baseName
                    : 'Session default'}
              </div>
            </div>
            {selectedSkill && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => mutation.mutate(null)}
                disabled={mutation.isPending}
                title="Clear style"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : kind === 'writing' && groupedWritingItems.length > 0 ? (
          <div className="space-y-4 p-3">
            {groupedWritingItems.map((group) => {
              const meta = writingStyleTypeCopy[group.type];
              return (
                <section key={group.type} className="space-y-2">
                  <div className="rounded-md border border-border/45 bg-foreground/[0.025] px-2.5 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                      {meta.label}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                      {meta.description}
                    </p>
                  </div>
                  <div className="space-y-2">{group.items.map(renderItem)}</div>
                </section>
              );
            })}
          </div>
        ) : filteredItems.length > 0 ? (
          <div className={cn(kind === 'design' ? 'space-y-3 p-3' : 'space-y-2 p-3')}>
            {filteredItems.map(renderItem)}
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">{copy.empty}</div>
        )}
      </ScrollArea>
    </div>
  );
}
