// Backups (everything in one file) and sharing a learning list as a link.
import type { LearningList, ListEntry } from './lists.svelte';
import { readJson, writeJson } from './storage';
import type { Item } from './types';

interface Backup {
  app: 'topochamp';
  v: 1;
  exported: string;
  settings: unknown;
  players: { list: { id: string }[]; currentId: string };
  progress: Record<string, unknown>;
  lists: unknown[];
}

export function makeBackup(): Backup {
  const players = readJson<Backup['players']>('players', { list: [], currentId: '' });
  return {
    app: 'topochamp',
    v: 1,
    exported: new Date().toISOString(),
    settings: readJson('settings', {}),
    players,
    progress: Object.fromEntries(players.list.map((p) => [p.id, readJson(`progress.${p.id}`, {})])),
    lists: readJson('lists', []),
  };
}

export function downloadBackup(): void {
  const blob = new Blob([JSON.stringify(makeBackup(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `topochamp-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Replaces everything stored with the backup. The page must be reloaded afterwards. */
export async function restoreBackup(file: File): Promise<void> {
  const data = JSON.parse(await file.text()) as Backup;
  if (data?.app !== 'topochamp' || !Array.isArray(data.players?.list) || !Array.isArray(data.lists)) {
    throw new Error('not a TopoChamp backup');
  }
  writeJson('settings', data.settings ?? {});
  writeJson('players', data.players);
  for (const [id, progress] of Object.entries(data.progress ?? {})) writeJson(`progress.${id}`, progress);
  writeJson('lists', data.lists);
}

/* ───── sharing a list as a link ───── */

export interface SharedList {
  name: string;
  packId: string;
  entries: ListEntry[];
  custom: Item[];
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A link that opens TopoChamp and offers to add the list. Long shapes are left out to keep it short. */
export async function shareLink(list: LearningList): Promise<string> {
  let custom = list.custom ?? [];
  const payload = () => JSON.stringify({ n: list.name, p: list.packId, e: list.entries, c: custom });
  if (payload().length > 8000) custom = custom.map(({ geo: _geo, ...rest }) => rest);
  const json = new TextEncoder().encode(payload());
  const code =
    typeof CompressionStream === 'function' ? 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw'))) : 'j' + toBase64Url(json);
  return `${location.origin}${location.pathname}#list=${code}`;
}

/** Reads a shared list from the page address (#list=…), if there is one. */
export async function sharedListFromHash(hash: string): Promise<SharedList | null> {
  const m = hash.match(/^#list=([zj])([\w-]+)$/);
  if (!m) return null;
  let bytes: Uint8Array = fromBase64Url(m[2]);
  if (m[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof d.n !== 'string' || typeof d.p !== 'string' || !Array.isArray(d.e)) return null;
  return { name: d.n, packId: d.p, entries: d.e, custom: Array.isArray(d.c) ? d.c : [] };
}
