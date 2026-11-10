import type { ReactNode } from 'react';

/**
 * A tiny, safe syntax colouring for `code` nodes: comments, strings, numbers,
 * keywords and calls become spans with token classes. No HTML is produced
 * from the source; unknown languages still get strings and numbers.
 */
const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue def default del do elif else enum export extends false final finally fn for from func function go if impl import in interface is lambda let loop match mod module mut new nil none null of package pass private protected pub public raise return self static struct super switch this throw trait true try type typeof undefined use val var void when where while with yield ' +
    'select insert update delete where join left right inner outer group order by having limit values set into create table drop alter and or not'
  ).split(' ')
);
const HASH_COMMENT =
  /^(py|python|sh|bash|shell|zsh|rb|ruby|r|yaml|yml|toml|perl|pl|make|dockerfile|ps1|powershell)$/i;
const SQL = /^(sql|psql|mysql|sqlite)$/i;

export function highlightCode(code: string, language: string): ReactNode[] {
  const hash = HASH_COMMENT.test(language);
  const sql = SQL.test(language);
  const comment = hash
    ? String.raw`#[^\n]*`
    : sql
      ? String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`
      : String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`;
  const pattern = new RegExp(
    [
      `(${comment})`,
      String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\]|\\.)*\`)`,
      String.raw`(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-f]+\b)`,
      String.raw`([A-Za-z_$][\w$]*)(?=\s*\()`,
      String.raw`([A-Za-z_$][\w$]*)`,
    ].join('|'),
    'gi'
  );
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(code.slice(last, index));
    const [text, isComment, isString, isNumber, isCall, word] = match;
    const kind = isComment
      ? 'comment'
      : isString
        ? 'string'
        : isNumber
          ? 'number'
          : isCall
            ? KEYWORDS.has(isCall.toLowerCase())
              ? 'keyword'
              : 'call'
            : word && KEYWORDS.has(sql ? word.toLowerCase() : word)
              ? 'keyword'
              : null;
    out.push(
      kind ? (
        <span key={key++} className={`dui-tok-${kind}`}>
          {text}
        </span>
      ) : (
        text
      )
    );
    last = index + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
