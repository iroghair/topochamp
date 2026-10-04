// Building questions: display names, multiple-choice options and accepted answers.
import { haversineKm, inBox } from './geo';
import type { LoadedPack } from './packs';
import { shuffle, type Rng } from './scheduler';
import { normalize } from './text';
import type { Item, ItemType, Lang } from './types';

/** Types that can stand in for each other as wrong options. */
const TYPE_GROUP: Record<ItemType, string> = {
  country: 'country',
  part: 'province',
  province: 'province',
  city: 'city',
  river: 'river',
  sea: 'water',
  lake: 'water',
  mountains: 'landscape',
  island: 'landscape',
  region: 'landscape',
};

export const sameGroup = (a: ItemType, b: ItemType): boolean => TYPE_GROUP[a] === TYPE_GROUP[b];

export type NameOf = (item: Item) => string;

/** A list entry's name: the spelling from the sheet, or the map's name in the language. */
export function makeNameOf(customNames: Map<string, string>, lang: Lang): NameOf {
  return (item) => customNames.get(item.id) ?? (lang === 'en' ? (item.en ?? item.nl) : item.nl);
}

/**
 * Names that appear more than once on the list (Groningen the city and the province)
 * get the type added in questions: "Groningen (stad)".
 */
export function makeLabelOf(listItems: Item[], nameOf: NameOf, typeName: (t: ItemType) => string): NameOf {
  const counts = new Map<string, number>();
  for (const i of listItems) counts.set(normalize(nameOf(i)), (counts.get(normalize(nameOf(i))) ?? 0) + 1);
  return (item) => {
    const name = nameOf(item);
    return (counts.get(normalize(name)) ?? 0) > 1 ? `${name} (${typeName(item.t)})` : name;
  };
}

/**
 * Options for a multiple-choice question: the answer plus wrong options of the same type,
 * first from the learning list, then from the rest of the map. With 8 options, some of
 * the wrong ones are places close to the answer, which makes it harder.
 */
export function choiceOptions(
  target: Item,
  count: number,
  listItems: Item[],
  pack: LoadedPack,
  labelOf: NameOf,
  rng: Rng = Math.random,
): Item[] {
  const listIds = new Set(listItems.map((i) => i.id));
  const fits = (i: Item) => i.id !== target.id && sameGroup(i.t, target.t);
  const fromList = listItems.filter(fits);
  const importance = (i: Item) => (i.d ? 1e12 : 0) + (i.pop ?? 0);
  const fromMap = pack.file.items
    .filter((i) => fits(i) && !listIds.has(i.id) && inBox([i.x, i.y], pack.file.view))
    .sort((a, b) => importance(b) - importance(a))
    .slice(0, 40);

  const chosen: Item[] = [];
  const names = new Set([normalize(labelOf(target))]);
  const take = (candidates: Item[], n: number) => {
    for (const c of candidates) {
      if (chosen.length >= n) return;
      const key = normalize(labelOf(c));
      if (names.has(key)) continue;
      names.add(key);
      chosen.push(c);
    }
  };
  const wanted = count - 1;
  if (count >= 8) {
    const byDistance = [...fromList, ...fromMap].sort(
      (a, b) => haversineKm([a.x, a.y], [target.x, target.y]) - haversineKm([b.x, b.y], [target.x, target.y]),
    );
    take(byDistance, Math.floor(wanted / 2));
  }
  take(shuffle(fromList, rng), wanted);
  take(shuffle(fromMap, rng), wanted);
  return shuffle([target, ...chosen], rng);
}

/** Names accepted when typing the answer. The first one is shown as the right spelling. */
export function acceptedNames(item: Item, label: string, lang: Lang, strict: boolean): string[] {
  const local = lang === 'en' ? (item.en ?? item.nl) : item.nl;
  if (strict) return [label, local];
  return [label, local, item.nl, item.en ?? '', ...(item.a ?? [])].filter(Boolean);
}
