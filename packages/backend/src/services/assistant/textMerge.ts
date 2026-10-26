import { AppError } from '../../middleware/errorHandler.js';

function change(base: string, next: string) {
  let start = 0;
  while (start < base.length && start < next.length && base[start] === next[start]) start++;
  let suffix = 0;
  while (
    suffix < base.length - start &&
    suffix < next.length - start &&
    base[base.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  return { start, end: base.length - suffix, text: next.slice(start, next.length - suffix) };
}
/** Merge independent edits; overlapping edits stay a visible conflict, never last-writer-wins. */
export function mergeDocumentText(base: string, current: string, proposed: string) {
  if (current === base || current === proposed) return proposed;
  if (proposed === base) return current;
  const a = change(base, current),
    b = change(base, proposed);
  if (a.start === b.start || !(a.end <= b.start || b.end <= a.start))
    throw new AppError(
      'Gleichzeitige Änderungen überschneiden sich. Dein Entwurf bleibt erhalten.',
      409,
      'DOCUMENT_MERGE_CONFLICT'
    );
  const edits = [a, b].sort((left, right) => right.start - left.start);
  let result = base;
  for (const edit of edits)
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
