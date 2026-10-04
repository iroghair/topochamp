// Player profiles and their learning progress, stored in the browser.
import { NEW_PROGRESS, updateProgress, type ItemProgress } from './scheduler';
import { newId, readJson, removeKey, writeJson } from './storage';
import type { Direction } from './types';

export interface Player {
  id: string;
  name: string;
  avatar: string;
}

export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐢', '🦉', '🐬', '🐝', '🐧', '🦖'];

interface PlayersState {
  list: Player[];
  currentId: string;
}

function initial(): PlayersState {
  const saved = readJson<PlayersState | null>('players', null);
  if (saved?.list.length) return saved;
  const first = { id: newId(), name: 'Speler 1', avatar: AVATARS[0] };
  return { list: [first], currentId: first.id };
}

export const players: PlayersState = $state(initial());

$effect.root(() => {
  $effect(() => writeJson('players', $state.snapshot(players)));
});

export function currentPlayer(): Player {
  return players.list.find((p) => p.id === players.currentId) ?? players.list[0];
}

export function addPlayer(name: string, avatar: string): Player {
  const p = { id: newId(), name: name.trim() || 'Speler', avatar };
  players.list.push(p);
  players.currentId = p.id;
  return p;
}

export function updatePlayer(id: string, name: string, avatar: string): void {
  const p = players.list.find((x) => x.id === id);
  if (p) Object.assign(p, { name: name.trim() || p.name, avatar });
}

export function removePlayer(id: string): void {
  if (players.list.length <= 1) return;
  players.list = players.list.filter((p) => p.id !== id);
  if (players.currentId === id) players.currentId = players.list[0].id;
  removeKey(`progress.${id}`);
  progressCache.delete(id);
}

/* Progress per player: `${direction}:${itemId}` → ItemProgress. Progress is per place,
   not per list, so a place learned in one list also counts in another. */

type ProgressMap = Record<string, ItemProgress>;
const progressCache = new Map<string, ProgressMap>();

function progressOf(playerId: string): ProgressMap {
  let map = progressCache.get(playerId);
  if (!map) {
    map = readJson<ProgressMap>(`progress.${playerId}`, {});
    progressCache.set(playerId, map);
  }
  return map;
}

export function getProgress(playerId: string, dir: Direction, itemId: string): ItemProgress {
  return progressOf(playerId)[`${dir}:${itemId}`] ?? NEW_PROGRESS;
}

export function recordAnswer(playerId: string, dir: Direction, itemId: string, correct: boolean): ItemProgress {
  const map = progressOf(playerId);
  const key = `${dir}:${itemId}`;
  const next = updateProgress(map[key] ?? NEW_PROGRESS, correct);
  map[key] = next;
  writeJson(`progress.${playerId}`, map);
  return next;
}

export function exportProgress(playerId: string): ProgressMap {
  return { ...progressOf(playerId) };
}

export function importProgress(playerId: string, data: ProgressMap): void {
  progressCache.set(playerId, { ...data });
  writeJson(`progress.${playerId}`, data);
}
