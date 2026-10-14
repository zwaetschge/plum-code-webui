import { readSkillLibraryItem } from './skillLibrary.js';

const STYLE_TEMPLATE_MAX_CHARS = 12000;

export interface StyleSelection {
  designStyleSkill?: string | null;
  writingStyleSkill?: string | null;
}

function truncateStyleTemplate(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= STYLE_TEMPLATE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, STYLE_TEMPLATE_MAX_CHARS).trimEnd()}\n\n[Template truncated by WebUI: continue following the visible guidance and load the skill file if more detail is needed.]`;
}

/**
 * Prompt block for the selected style-library presets (design and/or writing).
 * Shared by CLI sessions (Task/Code) and API model chats.
 */
export async function buildSessionStyleContextFromSelection(
  selection: StyleSelection,
  configHome: string
): Promise<string | null> {
  if (!selection.designStyleSkill && !selection.writingStyleSkill) {
    return null;
  }

  const lines: string[] = [];
  lines.push('<session-style-library>');
  lines.push(
    'The following templates are active for this WebUI session. They override generic style defaults but do not override explicit user instructions in the current prompt.'
  );

  if (selection.designStyleSkill) {
    const style = await readSkillLibraryItem(configHome, selection.designStyleSkill);
    if (style?.libraryKind === 'design') {
      lines.push('');
      lines.push(`## Active UI Style Template: ${style.name}`);
      lines.push(`Source: ~/.claude/skills/${style.baseName}/SKILL.md`);
      if (style.description) lines.push(`Description: ${style.description}`);
      lines.push(
        'Apply this template whenever the user asks for frontend, WebUI, interface, visual design, layout, component, page, app, or styling work.'
      );
      lines.push('');
      lines.push(truncateStyleTemplate(style.content));

      if (style.designMd) {
        lines.push('');
        lines.push(`## Active DESIGN.md: ${style.designMd.name}`);
        lines.push(`Source: ~/.claude/skills/${style.baseName}/DESIGN.md`);
        lines.push(
          'Treat this DESIGN.md as the structured source of truth for visual identity tokens and rationale. Use token values when they conflict with generic style preferences.'
        );
        lines.push('');
        lines.push('```markdown');
        lines.push(truncateStyleTemplate(style.designMd.raw));
        lines.push('```');
      }
    }
  }

  if (selection.writingStyleSkill) {
    const style = await readSkillLibraryItem(configHome, selection.writingStyleSkill);
    if (style?.libraryKind === 'writing') {
      const styleType = style.writingStyleType || 'persona';
      lines.push('');
      lines.push(
        `## Active ${
          styleType === 'author'
            ? 'Author Style'
            : styleType === 'prose'
              ? 'Writing Style'
              : 'Persona'
        } Template: ${style.name}`
      );
      lines.push(`Source: ~/.claude/skills/${style.baseName}/SKILL.md`);
      if (style.description) lines.push(`Description: ${style.description}`);
      if (styleType === 'author') {
        lines.push(
          'Apply this template as an authorial prose influence for narrative, copy, and longer explanations. Do not claim to be the author, do not quote or recreate existing passages, and keep code, commands, filenames, and technical facts precise.'
        );
      } else if (styleType === 'prose') {
        lines.push(
          'Apply this template to prose quality, tone, copy, emails, explanations, and narrative text. Keep code, commands, filenames, and technical facts precise.'
        );
      } else {
        lines.push(
          'Apply this template as the assistant persona or voice for prose, explanations, copy, and narrative text. Keep code, commands, filenames, and technical facts precise.'
        );
      }
      lines.push('');
      lines.push(truncateStyleTemplate(style.content));
    }
  }

  lines.push('</session-style-library>');
  return lines.length > 3 ? lines.join('\n') : null;
}
