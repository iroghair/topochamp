// Matching names from a school sheet (pasted text) to the places in a map pack.
import type { LoadedPack } from './packs';
import { allowedTypos, levenshtein, normalize } from './text';
import type { Item, ItemType } from './types';

/** Words that say what kind of place is meant, as in "Groningen (provincie)". */
const TYPE_WORDS: Record<string, ItemType> = {
  stad: 'city',
  plaats: 'city',
  dorp: 'city',
  hoofdstad: 'city',
  city: 'city',
  town: 'city',
  capital: 'city',
  provincie: 'province',
  prov: 'province',
  province: 'province',
  staat: 'province',
  state: 'province',
  deelstaat: 'province',
  regio: 'province',
  landsdeel: 'part',
  gewest: 'part',
  land: 'country',
  country: 'country',
  rivier: 'river',
  river: 'river',
  zee: 'sea',
  sea: 'sea',
  oceaan: 'sea',
  ocean: 'sea',
  baai: 'sea',
  bay: 'sea',
  golf: 'sea',
  gulf: 'sea',
  meer: 'lake',
  lake: 'lake',
  gebergte: 'mountains',
  mountains: 'mountains',
  bergen: 'mountains',
  eiland: 'island',
  eilanden: 'island',
  island: 'island',
  islands: 'island',
  gebied: 'region',
  region: 'region',
};

export interface ParsedLine {
  /** The name as written on the sheet, without numbering or type hint. */
  text: string;
  type?: ItemType;
  /** Another name given in brackets, as in "Ural (Oeral)". */
  alt?: string;
}

/** Splits pasted text into names: one per line (also tabs, semicolons and commas). */
export function parseList(text: string): ParsedLine[] {
  return text
    .split(/[\n\r\t;,]+/)
    .map((raw) =>
      raw
        .replace(/^\s*(\d+[.)]|[-•*–·])\s*/, '') // "1. Amsterdam", "- Amsterdam"
        .trim(),
    )
    .filter((s) => s.length > 0)
    .map((s) => {
      const m = s.match(/^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/);
      if (m && m[1].trim()) {
        const type = TYPE_WORDS[normalize(m[2])];
        if (type) return { text: m[1].trim(), type };
        // Not a type: another name for the place, unless it is a short code such as "(NH)".
        if (m[2].length > 2 && m[2] !== m[2].toUpperCase()) return { text: m[1].trim(), alt: m[2].trim() };
      }
      return { text: s };
    });
}

export interface Candidate {
  item: Item;
  /** 3 = exact name, 2 = alternative name, 1 = close spelling. */
  quality: 1 | 2 | 3;
  typos: number;
}

/** A searchable index of all names of the places in a pack. */
export class NameIndex {
  private readonly byName = new Map<string, { item: Item; quality: 2 | 3 }[]>();
  private readonly keys: string[];

  constructor(readonly pack: LoadedPack) {
    for (const item of pack.items.values()) {
      const add = (name: string | undefined, quality: 2 | 3) => {
        if (!name) return;
        const key = normalize(name);
        if (!key) return;
        const list = this.byName.get(key) ?? [];
        if (!list.some((c) => c.item.id === item.id)) list.push({ item, quality });
        else if (quality === 3) list.find((c) => c.item.id === item.id)!.quality = 3;
        this.byName.set(key, list);
      };
      add(item.nl, 3);
      add(item.en, 3);
      for (const a of item.a ?? []) add(a, 2);
    }
    this.keys = [...this.byName.keys()];
  }

  /** Places whose name matches, best first. */
  find(text: string, type?: ItemType): Candidate[] {
    const key = normalize(text);
    if (!key) return [];
    let found: Candidate[] = (this.byName.get(key) ?? []).map((c) => ({ ...c, typos: 0 }));
    if (!found.length) {
      const max = allowedTypos(text);
      for (const k of this.keys) {
        if (Math.abs(k.length - key.length) > max) continue;
        const typos = levenshtein(key, k);
        if (typos <= max) for (const c of this.byName.get(k)!) found.push({ item: c.item, quality: 1, typos });
      }
    }
    if (type) found = found.filter((c) => c.item.t === type);
    const seen = new Set<string>();
    return found
      .sort((a, b) => b.quality - a.quality || a.typos - b.typos || importance(b.item, this.pack) - importance(a.item, this.pack))
      .filter((c) => !seen.has(c.item.id) && seen.add(c.item.id));
  }

  /** Names starting with (or containing) the text, for the "add a place" search box. */
  search(text: string, limit = 12): Item[] {
    const key = normalize(text);
    if (key.length < 2) return [];
    const starts: Item[] = [];
    const contains: Item[] = [];
    const seen = new Set<string>();
    for (const [k, list] of this.byName) {
      const bucket = k.startsWith(key) ? starts : k.includes(key) ? contains : null;
      if (!bucket) continue;
      for (const c of list) if (!seen.has(c.item.id) && seen.add(c.item.id)) bucket.push(c.item);
    }
    const rank = (a: Item, b: Item) => importance(b, this.pack) - importance(a, this.pack);
    return [...starts.sort(rank), ...contains.sort(rank)].slice(0, limit);
  }
}

/** Places on the default list and inside the map come first; bigger cities before smaller. */
function importance(item: Item, pack: LoadedPack): number {
  const [w, s, e, n] = pack.file.view;
  const inside = item.x >= w && item.x <= e && item.y >= s && item.y <= n;
  return (item.d ? 4e9 : 0) + (inside ? 2e9 : 0) + (item.t === 'city' ? (item.pop ?? 0) : 1e9);
}

const LANDSCAPE = new Set<ItemType>(['island', 'region', 'mountains']);

/** Candidates for the name and for a name in brackets ("Ural (Oeral)"), best match per place. */
function findAll(index: NameIndex, line: ParsedLine): Candidate[] {
  const found = new Map<string, Candidate>();
  for (const name of [line.text, line.alt]) {
    if (!name) continue;
    for (const c of index.find(name, line.type)) {
      const cur = found.get(c.item.id);
      if (!cur || c.quality > cur.quality || (c.quality === cur.quality && c.typos < cur.typos)) found.set(c.item.id, c);
    }
  }
  if (!found.size && line.alt) for (const c of index.find(`${line.text} (${line.alt})`, line.type)) found.set(c.item.id, c);
  return [...found.values()].sort((a, b) => b.quality - a.quality || a.typos - b.typos);
}

export type LineResult =
  | { status: 'found'; line: ParsedLine; match: Candidate; others: Item[] }
  | { status: 'ambiguous'; line: ParsedLine; options: Candidate[] }
  | { status: 'missing'; line: ParsedLine; suggestions: Item[] };

/**
 * Matches pasted lines to places. A name that fits several places is "ambiguous" and the
 * user picks, except when the choice is obvious: the same name pasted twice for two
 * places (Groningen the city and the province), or one town much bigger than the others.
 */
export function matchLines(lines: ParsedLine[], index: NameIndex): LineResult[] {
  const used = new Map<string, number>(); // how often each name was pasted so far
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(normalize(l.text), (counts.get(normalize(l.text)) ?? 0) + 1);

  return lines.map((line): LineResult => {
    const cands = findAll(index, line);
    if (!cands.length) return { status: 'missing', line, suggestions: index.search(line.text, 3) };
    const best = cands.filter((c) => c.quality === cands[0].quality && c.typos === cands[0].typos);
    const key = normalize(line.text);
    const nth = used.get(key) ?? 0;
    used.set(key, nth + 1);
    const found = (match: Candidate): LineResult => ({
      status: 'found',
      line,
      match,
      others: cands.map((c) => c.item).filter((i) => i.id !== match.item.id),
    });
    if (best.length === 1) return found(best[0]);

    // Same name pasted several times: give each paste the next place.
    if ((counts.get(key) ?? 1) > 1 && nth < best.length) return found(best[nth]);
    // One town much bigger than the others of the same name.
    const [a, b] = best.map((c) => c.item);
    if (a.t === 'city' && b.t === 'city' && (a.pop ?? 0) >= 5 * (b.pop ?? 0)) return found(best[0]);
    // A default-list place beats places that aren't, if that leaves just one.
    const defaults = best.filter((c) => c.item.d);
    if (defaults.length === 1) return found(defaults[0]);
    // A country beats an island or region of the same name (Cyprus).
    const countries = best.filter((c) => c.item.t === 'country');
    if (countries.length === 1 && best.every((c) => c === countries[0] || LANDSCAPE.has(c.item.t))) return found(countries[0]);
    return { status: 'ambiguous', line, options: best.slice(0, 6) };
  });
}

/**
 * The sheet's spelling is kept when it is another name for the place ("Den Bosch").
 * Differences in accents or punctuation, or typos, get the map's spelling.
 */
export function customName(text: string, match: Candidate): string | undefined {
  return match.quality === 2 ? text.trim() : undefined;
}
