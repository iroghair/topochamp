// Learning lists: which places of a map are practised, with the spelling from the school sheet.
import { addCustomItems, defaultItemIds, type LoadedPack } from './packs';
import { newId, readJson, writeJson } from './storage';
import type { Item } from './types';

export interface ListEntry {
  /** Item id in the pack (or of a custom item). */
  id: string;
  /** Name as written on the school sheet; missing = the map's name in the current language. */
  name?: string;
}

export interface LearningList {
  id: string;
  name: string;
  packId: string;
  entries: ListEntry[];
  /** Places that are not in the map data, added by hand or looked up online. */
  custom?: Item[];
  updated: number;
}

export const DEFAULT_LIST = 'default';

export const lists: { all: LearningList[] } = $state({ all: readJson<LearningList[]>('lists', []) });

$effect.root(() => {
  $effect(() => writeJson('lists', $state.snapshot(lists.all)));
});

export const listsForPack = (packId: string): LearningList[] => lists.all.filter((l) => l.packId === packId);

export const getList = (id: string): LearningList | undefined => lists.all.find((l) => l.id === id);

export function saveList(list: Omit<LearningList, 'id' | 'updated'> & { id?: string }): LearningList {
  const saved: LearningList = { ...list, id: list.id ?? newId(), updated: Date.now() };
  const i = lists.all.findIndex((l) => l.id === saved.id);
  if (i >= 0) lists.all[i] = saved;
  else lists.all.push(saved);
  return saved;
}

export function deleteList(id: string): void {
  lists.all = lists.all.filter((l) => l.id !== id);
}

/** The entries of a list for a pack, dropping places the pack doesn't have. */
export function resolveEntries(listId: string | undefined, pack: LoadedPack): ListEntry[] {
  const list = listId && listId !== DEFAULT_LIST ? getList(listId) : undefined;
  if (!list || list.packId !== pack.file.id) return defaultItemIds(pack).map((id) => ({ id }));
  addCustomItems(pack, list.custom ?? []);
  return list.entries.filter((e) => pack.items.has(e.id));
}
