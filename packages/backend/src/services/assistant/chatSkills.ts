import { realpath, readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readSkillLibraryItem } from '../../utils/skillLibrary.js';
import { resolveConfigHome } from '../../utils/configPaths.js';
import type { SkillLibraryItem } from '@plum-code-webui/shared';
import { AppError } from '../../middleware/errorHandler.js';

export async function selectedChatSkills(
  names: string[],
  configHome = resolveConfigHome('codex')
): Promise<
  Array<
    Pick<SkillLibraryItem, 'name' | 'baseName' | 'description' | 'dirPath'> & { content: string }
  >
> {
  return Promise.all(
    [...new Set(names)].map(async (name) => {
      const skill = await readSkillLibraryItem(configHome, name, { syncExternal: false });
      if (!skill || skill.libraryKind !== 'skill')
        throw new AppError(`Fachlicher Skill nicht gefunden: ${name}`, 400, 'INVALID_SKILL');
      return skill;
    })
  );
}

/** Selected skill instructions are loaded by the model only when needed. No script execution. */
export async function readChatSkill(
  names: string[],
  args: Record<string, unknown>,
  configHome = resolveConfigHome('codex')
) {
  const input = z
    .object({
      name: z.string(),
      file: z.string().max(500).optional(),
      offset: z.number().int().min(0).max(500000).default(0),
    })
    .strict()
    .parse(args);
  if (!names.includes(input.name)) throw new Error('Skill ist für diesen Chat nicht ausgewählt');
  const [skill] = await selectedChatSkills([input.name], configHome);
  const root = await realpath(skill!.dirPath);
  let content = skill!.content;
  if (input.file && input.file !== 'SKILL.md') {
    const file = await realpath(path.resolve(root, input.file));
    if (!file.startsWith(root + path.sep)) throw new Error('Datei liegt ausserhalb des Skills');
    const info = await stat(file);
    if (!info.isFile() || info.size > 500000)
      throw new Error('Skilldatei ist zu gross oder keine Textdatei');
    content = await readFile(file, 'utf8');
    if (content.includes('\0')) throw new Error('Binärdateien sind keine Skillanleitungen');
  }
  const text = content.slice(input.offset, input.offset + 16000);
  const files = !input.file
    ? (await readdir(root)).filter((name) => name !== 'SKILL.md').slice(0, 80)
    : undefined;
  return {
    name: skill!.baseName,
    file: input.file ?? 'SKILL.md',
    text,
    offset: input.offset,
    totalCharacters: content.length,
    nextOffset: input.offset + text.length < content.length ? input.offset + text.length : null,
    files,
  };
}
