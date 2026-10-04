// Name comparison: normalization, typo tolerance and spelling feedback.

const SPECIAL_LETTERS: Record<string, string> = { ł: 'l', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ı: 'i', þ: 'th' };

/** Lowercase, without accents, spaces, hyphens, apostrophes or other punctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[łøæœßđıþ]/g, (c) => SPECIAL_LETTERS[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Lowercase with collapsed whitespace; accents and punctuation still count. */
export function strictForm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[’‘`]/g, "'");
}

/** Edit distance where swapping two neighbouring letters counts as one typo. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Typos allowed in lenient mode: 1 for short names, 2 for longer ones. */
export const allowedTypos = (name: string): number => (normalize(name).length <= 6 ? 1 : 2);

export type MatchResult =
  | { kind: 'exact'; name: string }
  | { kind: 'typo'; name: string; typos: number }
  | { kind: 'wrong' };

export type Spelling = 'lenient' | 'strict';

/**
 * Compares a typed answer with the accepted names of a place. The first name is the
 * "official" one (as on the learning list); the rest are alternatives.
 */
export function matchAnswer(answer: string, names: string[], spelling: Spelling): MatchResult {
  const accepted = names.filter(Boolean);
  if (!answer.trim()) return { kind: 'wrong' };
  if (spelling === 'strict') {
    const a = strictForm(answer);
    const hit = accepted.find((n) => strictForm(n) === a);
    return hit ? { kind: 'exact', name: hit } : { kind: 'wrong' };
  }
  const a = normalize(answer);
  const exact = accepted.find((n) => normalize(n) === a);
  if (exact) return { kind: 'exact', name: exact };
  let best: { name: string; typos: number } | null = null;
  for (const n of accepted) {
    const typos = levenshtein(a, normalize(n));
    if (typos <= allowedTypos(n) && (!best || typos < best.typos)) best = { name: n, typos };
  }
  return best ? { kind: 'typo', ...best } : { kind: 'wrong' };
}

export interface DiffPart {
  text: string;
  /** 'ok' = same letter, 'wrong' = typed but should be different or absent, 'missing' = should have been typed. */
  kind: 'ok' | 'wrong' | 'missing';
}

/**
 * Letter-by-letter comparison of what was typed against the correct spelling, so the
 * game can highlight the mistakes. Case and accents are compared loosely.
 */
export function spellingDiff(typed: string, correct: string): DiffPart[] {
  const fold = (c: string) => normalize(c) || c.toLowerCase();
  const a = [...typed];
  const b = [...correct];
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (fold(a[i - 1]) === fold(b[j - 1]) ? 0 : 1));
    }
  }
  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text = text + last.text;
    else parts.push({ text, kind });
  };
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (fold(a[i - 1]) === fold(b[j - 1]) ? 0 : 1)) {
      if (fold(a[i - 1]) === fold(b[j - 1])) push(b[j - 1], 'ok');
      else {
        push(b[j - 1], 'missing');
        push(a[i - 1], 'wrong');
      }
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      push(a[i - 1], 'wrong');
      i--;
    } else {
      push(b[j - 1], 'missing');
      j--;
    }
  }
  return parts.reverse();
}
