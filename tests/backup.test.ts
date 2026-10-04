import { beforeAll, describe, expect, it } from 'vitest';
import { shareLink, sharedListFromHash } from '../src/lib/backup';
import type { LearningList } from '../src/lib/lists.svelte';

beforeAll(() => {
  (globalThis as unknown as { location: unknown }).location = { origin: 'https://example.org', pathname: '/topochamp/' };
});

const list: LearningList = {
  id: 'abc',
  name: 'Topo hoofdstuk 3',
  packId: 'NLD',
  entries: [{ id: 't:2743477' }, { id: 't:2747351', name: 'Den Bosch' }, { id: 'x:texel' }],
  custom: [
    {
      id: 'x:texel',
      t: 'island',
      nl: 'Texel',
      x: 4.8,
      y: 53.08,
      src: 'osm',
      geo: { type: 'Polygon', coordinates: [[[4.7, 53], [4.7, 53.2], [4.9, 53.2], [4.9, 53], [4.7, 53]]] },
    },
  ],
  updated: 0,
};

describe('sharing a list as a link', () => {
  it('survives the round trip', async () => {
    const link = await shareLink(list);
    expect(link.startsWith('https://example.org/topochamp/#list=z')).toBe(true);
    const shared = await sharedListFromHash(new URL(link).hash);
    expect(shared).toEqual({ name: list.name, packId: 'NLD', entries: list.entries, custom: list.custom });
  });

  it('keeps links short', async () => {
    const big = { ...list, entries: Array.from({ length: 200 }, (_, i) => ({ id: `t:${2740000 + i}` })) };
    const link = await shareLink(big);
    expect(link.length).toBeLessThan(2500);
  });

  it('ignores addresses without a valid list', async () => {
    expect(await sharedListFromHash('#nothing')).toBeNull();
    await expect(sharedListFromHash('#list=zbroken')).rejects.toThrow();
  });
});
