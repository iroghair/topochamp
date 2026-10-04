import { readFileSync } from 'node:fs';
import { neighbors } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import { preparePack } from '../src/lib/packs';
import type { PackFile } from '../src/lib/types';

const load = (id: string) => JSON.parse(readFileSync(`public/packs/${id}.json`, 'utf8')) as PackFile;

describe('colouring countries and provinces', () => {
  for (const id of ['NLD', 'europe', 'world']) {
    it(`never gives neighbours the same tone (${id})`, () => {
      const file = load(id);
      const pack = preparePack(file);
      const geoms = (file.topo.objects.units as GeometryCollection).geometries;
      const nb = neighbors(geoms);
      geoms.forEach((g, i) => {
        for (const j of nb[i]) expect(pack.unitTones.get(String(g.id))).not.toBe(pack.unitTones.get(String(geoms[j].id)));
      });
    });
  }
});

describe('parts of countries on the Europe map', () => {
  it('has Vlaanderen, Wallonië, Engeland, Schotland, … with a shape', () => {
    const pack = preparePack(load('europe'));
    const parts = pack.file.items.filter((i) => i.t === 'part').map((i) => i.nl);
    expect(parts).toEqual(expect.arrayContaining(['Vlaanderen', 'Wallonië', 'Engeland', 'Schotland', 'Wales', 'Noord-Ierland']));
    for (const i of pack.file.items.filter((x) => x.t === 'part')) expect(pack.shapes.get(i.id)?.layer).toBe('parts');
  });
});
